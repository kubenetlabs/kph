package simulation

import (
	"context"
	"sync"
	"time"

	"github.com/go-logr/logr"
	"github.com/google/uuid"

	"github.com/policy-hub/operator/internal/saas"
)

// Worker processes pending simulations from SaaS and reports results.
type Worker struct {
	engine     *Engine
	saasClient *saas.Client
	log        logr.Logger

	// Configuration
	pollInterval time.Duration

	// State
	mu      sync.RWMutex
	running bool
	cancel  context.CancelFunc

	// Metrics
	totalProcessed int64
	totalErrors    int64
}

// WorkerConfig contains configuration for the simulation worker.
type WorkerConfig struct {
	Engine       *Engine
	SaaSClient   *saas.Client
	PollInterval time.Duration
	Logger       logr.Logger
}

// NewWorker creates a new simulation worker.
func NewWorker(cfg WorkerConfig) *Worker {
	pollInterval := cfg.PollInterval
	if pollInterval == 0 {
		pollInterval = 30 * time.Second
	}

	return &Worker{
		engine:       cfg.Engine,
		saasClient:   cfg.SaaSClient,
		pollInterval: pollInterval,
		log:          cfg.Logger.WithName("simulation-worker"),
	}
}

// Start begins processing pending simulations.
func (w *Worker) Start(ctx context.Context) error {
	w.mu.Lock()
	if w.running {
		w.mu.Unlock()
		return nil
	}

	ctx, cancel := context.WithCancel(ctx)
	w.cancel = cancel
	w.running = true
	w.mu.Unlock()

	w.log.Info("Starting simulation worker", "pollInterval", w.pollInterval)

	go w.run(ctx)

	return nil
}

// Stop stops the simulation worker.
func (w *Worker) Stop() {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.cancel != nil {
		w.cancel()
	}
	w.running = false
	w.log.Info("Simulation worker stopped")
}

// run is the main processing loop.
func (w *Worker) run(ctx context.Context) {
	ticker := time.NewTicker(w.pollInterval)
	defer ticker.Stop()

	// Process immediately on start
	w.processPendingSimulations(ctx)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			w.processPendingSimulations(ctx)
		}
	}
}

// processPendingSimulations fetches and processes pending simulations.
func (w *Worker) processPendingSimulations(ctx context.Context) {
	if w.saasClient == nil {
		return
	}

	// Fetch pending simulations
	resp, err := w.saasClient.FetchPendingSimulations(ctx)
	if err != nil {
		w.log.Error(err, "Failed to fetch pending simulations")
		return
	}

	if len(resp.Simulations) == 0 {
		return
	}

	w.log.Info("Processing pending simulations", "count", len(resp.Simulations))

	for _, pending := range resp.Simulations {
		if ctx.Err() != nil {
			return
		}

		w.processSimulation(ctx, &pending)
	}
}

// processSimulation runs a single simulation and reports results.
func (w *Worker) processSimulation(ctx context.Context, pending *saas.PendingSimulation) {
	startTime := time.Now()
	w.log.Info("Running simulation",
		"simulationId", pending.SimulationID,
		"policyType", pending.PolicyType,
		"startTime", pending.StartTime,
		"endTime", pending.EndTime,
	)

	// Convert SaaS request to simulation request
	simReq := &SimulationRequest{
		PolicyContent:  pending.PolicyContent,
		PolicyType:     pending.PolicyType,
		StartTime:      pending.StartTime,
		EndTime:        pending.EndTime,
		Namespaces:     pending.Namespaces,
		IncludeDetails: pending.IncludeDetails,
		MaxDetails:     pending.MaxDetails,
	}

	// Run the simulation
	simResp, err := w.engine.Simulate(ctx, simReq)
	if err != nil {
		w.mu.Lock()
		w.totalErrors++
		w.mu.Unlock()

		w.log.Error(err, "Simulation failed", "simulationId", pending.SimulationID)

		// Report failure to SaaS
		w.reportResult(ctx, pending.SimulationID, &SimulationResponse{
			Errors:         []string{err.Error()},
			SimulationTime: startTime,
			Duration:       time.Since(startTime),
		}, pending)
		return
	}

	w.mu.Lock()
	w.totalProcessed++
	w.mu.Unlock()

	// Report success to SaaS
	w.reportResult(ctx, pending.SimulationID, simResp, pending)

	w.log.Info("Simulation completed",
		"simulationId", pending.SimulationID,
		"totalFlows", simResp.TotalFlowsAnalyzed,
		"wouldChange", simResp.WouldChangeCount,
		"duration", simResp.Duration,
	)
}

// reportResult sends simulation results back to SaaS.
func (w *Worker) reportResult(ctx context.Context, simulationID string, resp *SimulationResponse, pending *saas.PendingSimulation) {
	if w.saasClient == nil {
		return
	}

	// Convert simulation response to SaaS result format
	result := &saas.SimulationResult{
		SimulationID:       simulationID,
		PolicyContent:      pending.PolicyContent,
		PolicyType:         pending.PolicyType,
		StartTime:          pending.StartTime,
		EndTime:            pending.EndTime,
		Namespaces:         pending.Namespaces,
		TotalFlowsAnalyzed: resp.TotalFlowsAnalyzed,
		AllowedCount:       resp.AllowedCount,
		DeniedCount:        resp.DeniedCount,
		NoChangeCount:      resp.NoChangeCount,
		WouldChangeCount:   resp.WouldChangeCount,
		Errors:             resp.Errors,
		SimulationTime:     resp.SimulationTime,
		Duration:           resp.Duration,
	}

	// Convert namespace breakdown
	if resp.BreakdownByNamespace != nil {
		result.BreakdownByNS = make(map[string]*saas.NSImpact)
		for ns, impact := range resp.BreakdownByNamespace {
			result.BreakdownByNS[ns] = &saas.NSImpact{
				Namespace:    impact.Namespace,
				TotalFlows:   impact.TotalFlows,
				AllowedCount: impact.AllowedCount,
				DeniedCount:  impact.DeniedCount,
				WouldDeny:    impact.WouldDeny,
				WouldAllow:   impact.WouldAllow,
				NoChange:     impact.NoChange,
			}
		}
	}

	// Convert verdict breakdown
	if resp.BreakdownByVerdict != nil {
		result.BreakdownByVerdict = &saas.SimVerdictBreakdown{
			AllowedToAllowed: resp.BreakdownByVerdict.AllowedToAllowed,
			AllowedToDenied:  resp.BreakdownByVerdict.AllowedToDenied,
			DeniedToAllowed:  resp.BreakdownByVerdict.DeniedToAllowed,
			DeniedToDenied:   resp.BreakdownByVerdict.DeniedToDenied,
			DroppedToAllowed: resp.BreakdownByVerdict.DroppedToAllowed,
			DroppedToDenied:  resp.BreakdownByVerdict.DroppedToDenied,
		}
	}

	// Convert sample flows
	if len(resp.Details) > 0 {
		result.SampleFlows = make([]saas.SimulatedFlow, len(resp.Details))
		for i, detail := range resp.Details {
			result.SampleFlows[i] = saas.SimulatedFlow{
				Timestamp:        detail.Timestamp,
				SrcNamespace:     detail.SrcNamespace,
				SrcPodName:       detail.SrcPodName,
				DstNamespace:     detail.DstNamespace,
				DstPodName:       detail.DstPodName,
				DstPort:          detail.DstPort,
				Protocol:         detail.Protocol,
				OriginalVerdict:  detail.OriginalVerdict,
				SimulatedVerdict: detail.SimulatedVerdict,
				VerdictChanged:   detail.VerdictChanged,
				MatchedRule:      detail.MatchedRule,
				MatchReason:      detail.MatchReason,
			}
		}
	}

	// Submit to SaaS
	_, err := w.saasClient.SubmitSimulationResult(ctx, result)
	if err != nil {
		w.log.Error(err, "Failed to report simulation result", "simulationId", simulationID)
	}
}

// GetStats returns worker statistics.
func (w *Worker) GetStats() WorkerStats {
	w.mu.RLock()
	defer w.mu.RUnlock()

	return WorkerStats{
		Running:        w.running,
		TotalProcessed: w.totalProcessed,
		TotalErrors:    w.totalErrors,
	}
}

// WorkerStats contains worker statistics.
type WorkerStats struct {
	Running        bool
	TotalProcessed int64
	TotalErrors    int64
}

// RunOnce runs a single simulation and returns the result (for direct gRPC calls).
func (w *Worker) RunOnce(ctx context.Context, req *SimulationRequest) (*SimulationResponse, error) {
	return w.engine.Simulate(ctx, req)
}

// RunAndReport runs a simulation and reports to SaaS (for async processing).
func (w *Worker) RunAndReport(ctx context.Context, req *SimulationRequest) (*SimulationResponse, error) {
	// Generate simulation ID
	simID := uuid.New().String()

	// Run simulation
	resp, err := w.engine.Simulate(ctx, req)
	if err != nil {
		return nil, err
	}

	// Report to SaaS if client is available
	if w.saasClient != nil {
		pending := &saas.PendingSimulation{
			SimulationID:  simID,
			PolicyContent: req.PolicyContent,
			PolicyType:    req.PolicyType,
			StartTime:     req.StartTime,
			EndTime:       req.EndTime,
			Namespaces:    req.Namespaces,
		}
		w.reportResult(ctx, simID, resp, pending)
	}

	return resp, nil
}
