package validation

import (
	"context"
	"sync"
	"time"

	"github.com/go-logr/logr"
	"sigs.k8s.io/controller-runtime/pkg/client"

	"github.com/policy-hub/operator/internal/telemetry/models"
)

// Agent validates network flows against CiliumNetworkPolicies
type Agent struct {
	matcher       *PolicyMatcher
	reporter      *Reporter
	log           logr.Logger
	flushInterval time.Duration
	policyRefresh time.Duration

	// Runtime state
	running    bool
	runningMu  sync.Mutex
	stopCh     chan struct{}
	eventsCh   chan *models.TelemetryEvent

	// Stats
	mu              sync.Mutex
	totalProcessed  int64
	totalAllowed    int64
	totalBlocked    int64
	totalNoPolicy   int64
}

// AgentOptions contains options for creating an agent
type AgentOptions struct {
	Client          client.Client
	SaaSEndpoint    string
	APIKey          string
	ClusterID       string
	FlushInterval   time.Duration
	PolicyRefresh   time.Duration
	EventBufferSize int
	EventSampleRate int
	Logger          logr.Logger
}

// NewAgent creates a new validation agent
func NewAgent(opts AgentOptions) *Agent {
	if opts.FlushInterval == 0 {
		opts.FlushInterval = time.Minute
	}
	if opts.PolicyRefresh == 0 {
		opts.PolicyRefresh = 30 * time.Second
	}
	if opts.EventBufferSize == 0 {
		opts.EventBufferSize = 1000
	}
	if opts.EventSampleRate == 0 {
		opts.EventSampleRate = 10 // Sample 1 in 10 events by default
	}

	matcher := NewPolicyMatcher(opts.Client, opts.Logger)
	reporter := NewReporter(ReporterConfig{
		Endpoint:   opts.SaaSEndpoint,
		APIKey:     opts.APIKey,
		ClusterID:  opts.ClusterID,
		MaxEvents:  100,
		SampleRate: opts.EventSampleRate,
		Logger:     opts.Logger,
	})

	return &Agent{
		matcher:       matcher,
		reporter:      reporter,
		log:           opts.Logger.WithName("validation-agent"),
		flushInterval: opts.FlushInterval,
		policyRefresh: opts.PolicyRefresh,
		eventsCh:      make(chan *models.TelemetryEvent, opts.EventBufferSize),
		stopCh:        make(chan struct{}),
	}
}

// Start starts the validation agent
func (a *Agent) Start(ctx context.Context) error {
	a.runningMu.Lock()
	if a.running {
		a.runningMu.Unlock()
		return nil
	}
	a.running = true
	a.runningMu.Unlock()

	a.log.Info("Starting validation agent",
		"flushInterval", a.flushInterval,
		"policyRefresh", a.policyRefresh,
	)

	// Initial policy refresh
	if err := a.matcher.RefreshPolicies(ctx); err != nil {
		a.log.Error(err, "Initial policy refresh failed")
		// Continue anyway - will retry
	}

	// Start background workers
	go a.processEvents(ctx)
	go a.refreshPoliciesLoop(ctx)
	go a.flushLoop(ctx)

	return nil
}

// Stop stops the validation agent
func (a *Agent) Stop() {
	a.runningMu.Lock()
	defer a.runningMu.Unlock()

	if !a.running {
		return
	}

	close(a.stopCh)
	a.running = false
	a.log.Info("Validation agent stopped")
}

// ProcessEvent processes a single telemetry event for validation
func (a *Agent) ProcessEvent(event *models.TelemetryEvent) {
	// Only process flow events
	if event.EventType != models.EventTypeFlow {
		return
	}

	// Skip events without namespace info (external traffic)
	if event.SrcNamespace == "" && event.DstNamespace == "" {
		return
	}

	// Non-blocking send to event channel
	select {
	case a.eventsCh <- event:
	default:
		// Channel full, drop event
		a.log.V(2).Info("Event channel full, dropping event")
	}
}

// processEvents processes events from the channel
func (a *Agent) processEvents(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-a.stopCh:
			return
		case event := <-a.eventsCh:
			a.validateEvent(event)
		}
	}
}

// validateEvent validates a single event
func (a *Agent) validateEvent(event *models.TelemetryEvent) {
	result := a.matcher.Match(event)
	a.reporter.Record(result)

	// Update stats
	a.mu.Lock()
	a.totalProcessed++
	switch result.Verdict {
	case VerdictAllowed:
		a.totalAllowed++
	case VerdictBlocked:
		a.totalBlocked++
	case VerdictNoPolicy:
		a.totalNoPolicy++
	}
	a.mu.Unlock()
}

// refreshPoliciesLoop periodically refreshes policies from the cluster
func (a *Agent) refreshPoliciesLoop(ctx context.Context) {
	ticker := time.NewTicker(a.policyRefresh)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-a.stopCh:
			return
		case <-ticker.C:
			if err := a.matcher.RefreshPolicies(ctx); err != nil {
				a.log.Error(err, "Failed to refresh policies")
			}
		}
	}
}

// flushLoop periodically flushes validation data to SaaS
func (a *Agent) flushLoop(ctx context.Context) {
	ticker := time.NewTicker(a.flushInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			// Final flush
			_ = a.reporter.Flush(context.Background())
			return
		case <-a.stopCh:
			// Final flush
			_ = a.reporter.Flush(context.Background())
			return
		case <-ticker.C:
			if err := a.reporter.Flush(ctx); err != nil {
				a.log.Error(err, "Failed to flush validation data")
			}
		}
	}
}

// GetStats returns agent statistics
type AgentStats struct {
	Running        bool
	TotalProcessed int64
	TotalAllowed   int64
	TotalBlocked   int64
	TotalNoPolicy  int64
	ReportsSent    int64
	ReportsFailed  int64
}

// GetStats returns the agent's current statistics
func (a *Agent) GetStats() AgentStats {
	a.mu.Lock()
	stats := AgentStats{
		TotalProcessed: a.totalProcessed,
		TotalAllowed:   a.totalAllowed,
		TotalBlocked:   a.totalBlocked,
		TotalNoPolicy:  a.totalNoPolicy,
	}
	a.mu.Unlock()

	a.runningMu.Lock()
	stats.Running = a.running
	a.runningMu.Unlock()

	sent, failed := a.reporter.GetStats()
	stats.ReportsSent = sent
	stats.ReportsFailed = failed

	return stats
}

// IsRunning returns whether the agent is running
func (a *Agent) IsRunning() bool {
	a.runningMu.Lock()
	defer a.runningMu.Unlock()
	return a.running
}
