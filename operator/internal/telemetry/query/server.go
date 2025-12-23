// Package query provides a gRPC server for querying historical telemetry data.
// This enables the SaaS platform to perform "time travel" policy simulation
// by querying past network flows and process events from the cluster.
package query

import (
	"context"
	"fmt"
	"net"
	"sync"
	"time"

	"github.com/go-logr/logr"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	"github.com/policy-hub/operator/internal/telemetry/models"
	"github.com/policy-hub/operator/internal/telemetry/simulation"
	"github.com/policy-hub/operator/internal/telemetry/storage"
)

// Server provides gRPC endpoints for querying telemetry data.
type Server struct {
	UnimplementedTelemetryQueryServer

	storageMgr *storage.Manager
	simEngine  *simulation.Engine
	log        logr.Logger
	apiKey     string

	// Server state
	mu         sync.RWMutex
	grpcServer *grpc.Server
	listener   net.Listener
	started    bool

	// Metrics
	totalQueries      int64
	totalEvents       int64
	queryErrors       int64
	totalSimulations  int64
	lastQueryTime     time.Time
}

// ServerConfig contains configuration for the query server.
type ServerConfig struct {
	// StorageManager provides access to stored telemetry data
	StorageManager *storage.Manager
	// APIKey is the key required for authentication (empty = no auth)
	APIKey string
	// Logger for logging
	Logger logr.Logger
}

// NewServer creates a new query server.
func NewServer(cfg ServerConfig) *Server {
	log := cfg.Logger.WithName("query-server")
	return &Server{
		storageMgr: cfg.StorageManager,
		simEngine: simulation.NewEngine(simulation.EngineConfig{
			StorageManager: cfg.StorageManager,
			Logger:         cfg.Logger,
		}),
		apiKey: cfg.APIKey,
		log:    log,
	}
}

// Start starts the gRPC server on the specified address.
func (s *Server) Start(ctx context.Context, address string) error {
	s.mu.Lock()
	if s.started {
		s.mu.Unlock()
		return fmt.Errorf("server already started")
	}

	listener, err := net.Listen("tcp", address)
	if err != nil {
		s.mu.Unlock()
		return fmt.Errorf("failed to listen on %s: %w", address, err)
	}

	// Create gRPC server with interceptors
	opts := []grpc.ServerOption{
		grpc.UnaryInterceptor(s.unaryAuthInterceptor),
		grpc.StreamInterceptor(s.streamAuthInterceptor),
	}

	s.grpcServer = grpc.NewServer(opts...)
	RegisterTelemetryQueryServer(s.grpcServer, s)

	s.listener = listener
	s.started = true
	s.mu.Unlock()

	s.log.Info("Starting query server", "address", address)

	// Run server in background
	go func() {
		if err := s.grpcServer.Serve(listener); err != nil {
			s.log.Error(err, "Query server failed")
		}
	}()

	// Handle shutdown
	go func() {
		<-ctx.Done()
		s.log.Info("Shutting down query server")
		s.grpcServer.GracefulStop()
	}()

	return nil
}

// Stop stops the gRPC server.
func (s *Server) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.grpcServer != nil {
		s.grpcServer.GracefulStop()
	}
	if s.listener != nil {
		s.listener.Close()
	}
	s.started = false
}

// unaryAuthInterceptor validates API key for unary RPCs.
func (s *Server) unaryAuthInterceptor(
	ctx context.Context,
	req interface{},
	info *grpc.UnaryServerInfo,
	handler grpc.UnaryHandler,
) (interface{}, error) {
	if err := s.authenticate(ctx); err != nil {
		return nil, err
	}
	return handler(ctx, req)
}

// streamAuthInterceptor validates API key for streaming RPCs.
func (s *Server) streamAuthInterceptor(
	srv interface{},
	ss grpc.ServerStream,
	info *grpc.StreamServerInfo,
	handler grpc.StreamHandler,
) error {
	if err := s.authenticate(ss.Context()); err != nil {
		return err
	}
	return handler(srv, ss)
}

// authenticate checks the API key from metadata.
func (s *Server) authenticate(ctx context.Context) error {
	if s.apiKey == "" {
		return nil // No auth required
	}

	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return status.Error(codes.Unauthenticated, "missing metadata")
	}

	authHeaders := md.Get("authorization")
	if len(authHeaders) == 0 {
		return status.Error(codes.Unauthenticated, "missing authorization header")
	}

	// Expect "Bearer <token>" format
	token := authHeaders[0]
	if len(token) > 7 && token[:7] == "Bearer " {
		token = token[7:]
	}

	if token != s.apiKey {
		return status.Error(codes.Unauthenticated, "invalid API key")
	}

	return nil
}

// QueryEvents queries historical telemetry events.
func (s *Server) QueryEvents(ctx context.Context, req *QueryEventsRequest) (*QueryEventsResponse, error) {
	s.mu.Lock()
	s.totalQueries++
	s.lastQueryTime = time.Now()
	s.mu.Unlock()

	s.log.V(1).Info("QueryEvents called",
		"startTime", req.StartTime,
		"endTime", req.EndTime,
		"namespaces", req.Namespaces,
		"eventTypes", req.EventTypes,
		"limit", req.Limit,
	)

	// Convert to storage query
	storageReq := models.QueryEventsRequest{
		StartTime:  req.StartTime,
		EndTime:    req.EndTime,
		Namespaces: req.Namespaces,
		EventTypes: req.EventTypes,
		Limit:      req.Limit,
		Offset:     req.Offset,
	}

	// Query storage
	result, err := s.storageMgr.Query(ctx, storageReq)
	if err != nil {
		s.mu.Lock()
		s.queryErrors++
		s.mu.Unlock()
		s.log.Error(err, "Query failed")
		return nil, status.Errorf(codes.Internal, "query failed: %v", err)
	}

	// Convert to response
	events := make([]*TelemetryEvent, len(result.Events))
	for i, e := range result.Events {
		events[i] = modelEventToProto(&e)
	}

	s.mu.Lock()
	s.totalEvents += int64(len(events))
	s.mu.Unlock()

	s.log.V(1).Info("QueryEvents completed",
		"returned", len(events),
		"totalCount", result.TotalCount,
		"hasMore", result.HasMore,
	)

	return &QueryEventsResponse{
		Events:     events,
		TotalCount: result.TotalCount,
		HasMore:    result.HasMore,
	}, nil
}

// StreamEvents streams historical telemetry events.
func (s *Server) StreamEvents(req *QueryEventsRequest, stream TelemetryQuery_StreamEventsServer) error {
	s.mu.Lock()
	s.totalQueries++
	s.lastQueryTime = time.Now()
	s.mu.Unlock()

	s.log.V(1).Info("StreamEvents called",
		"startTime", req.StartTime,
		"endTime", req.EndTime,
		"namespaces", req.Namespaces,
		"limit", req.Limit,
	)

	// Convert to storage query
	storageReq := models.QueryEventsRequest{
		StartTime:  req.StartTime,
		EndTime:    req.EndTime,
		Namespaces: req.Namespaces,
		EventTypes: req.EventTypes,
		Limit:      req.Limit,
		Offset:     req.Offset,
	}

	// Query storage
	result, err := s.storageMgr.Query(stream.Context(), storageReq)
	if err != nil {
		s.mu.Lock()
		s.queryErrors++
		s.mu.Unlock()
		s.log.Error(err, "Stream query failed")
		return status.Errorf(codes.Internal, "query failed: %v", err)
	}

	// Stream events
	var streamed int64
	for _, e := range result.Events {
		event := modelEventToProto(&e)
		if err := stream.Send(event); err != nil {
			s.log.Error(err, "Failed to send event")
			return status.Errorf(codes.Internal, "failed to send: %v", err)
		}
		streamed++
	}

	s.mu.Lock()
	s.totalEvents += streamed
	s.mu.Unlock()

	s.log.V(1).Info("StreamEvents completed", "streamed", streamed)
	return nil
}

// GetEventCount returns event count statistics.
func (s *Server) GetEventCount(ctx context.Context, req *GetEventCountRequest) (*EventCountResponse, error) {
	s.log.V(1).Info("GetEventCount called",
		"startTime", req.StartTime,
		"endTime", req.EndTime,
		"namespaces", req.Namespaces,
	)

	// Query with limit 0 to just get counts
	storageReq := models.QueryEventsRequest{
		StartTime:  req.StartTime,
		EndTime:    req.EndTime,
		Namespaces: req.Namespaces,
		Limit:      0, // Just count, don't return events
	}

	result, err := s.storageMgr.Query(ctx, storageReq)
	if err != nil {
		s.log.Error(err, "Count query failed")
		return nil, status.Errorf(codes.Internal, "query failed: %v", err)
	}

	// Build response with counts by type
	eventsByType := make(map[string]int64)
	eventsByNode := make(map[string]int64)
	var oldestEvent, newestEvent time.Time

	for _, e := range result.Events {
		eventsByType[string(e.EventType)]++
		eventsByNode[e.NodeName]++

		if oldestEvent.IsZero() || e.Timestamp.Before(oldestEvent) {
			oldestEvent = e.Timestamp
		}
		if newestEvent.IsZero() || e.Timestamp.After(newestEvent) {
			newestEvent = e.Timestamp
		}
	}

	return &EventCountResponse{
		TotalEvents:  result.TotalCount,
		EventsByType: eventsByType,
		EventsByNode: eventsByNode,
		OldestEvent:  oldestEvent,
		NewestEvent:  newestEvent,
	}, nil
}

// SimulatePolicy evaluates a policy against historical data.
func (s *Server) SimulatePolicy(ctx context.Context, req *SimulatePolicyRequest) (*SimulatePolicyResponse, error) {
	s.mu.Lock()
	s.totalSimulations++
	s.lastQueryTime = time.Now()
	s.mu.Unlock()

	s.log.Info("SimulatePolicy called",
		"policyType", req.PolicyType,
		"startTime", req.StartTime,
		"endTime", req.EndTime,
		"namespaces", req.Namespaces,
	)

	// Convert request to simulation request
	simReq := &simulation.SimulationRequest{
		PolicyContent:  req.PolicyContent,
		PolicyType:     req.PolicyType,
		StartTime:      req.StartTime,
		EndTime:        req.EndTime,
		Namespaces:     req.Namespaces,
		IncludeDetails: req.IncludeDetails,
		MaxDetails:     req.MaxDetails,
	}

	// Run simulation
	result, err := s.simEngine.Simulate(ctx, simReq)
	if err != nil {
		s.log.Error(err, "Simulation failed")
		return nil, status.Errorf(codes.Internal, "simulation failed: %v", err)
	}

	// Convert to response
	response := &SimulatePolicyResponse{
		TotalFlowsAnalyzed:   result.TotalFlowsAnalyzed,
		AllowedCount:         result.AllowedCount,
		DeniedCount:          result.DeniedCount,
		NoChangeCount:        result.NoChangeCount,
		WouldChangeCount:     result.WouldChangeCount,
		BreakdownByNamespace: convertNamespaceBreakdown(result.BreakdownByNamespace),
		BreakdownByVerdict:   convertVerdictBreakdown(result.BreakdownByVerdict),
		Details:              convertFlowDetails(result.Details),
		Errors:               result.Errors,
		SimulationTime:       result.SimulationTime,
		Duration:             result.Duration,
	}

	s.log.Info("SimulatePolicy completed",
		"totalFlows", response.TotalFlowsAnalyzed,
		"wouldChange", response.WouldChangeCount,
		"duration", response.Duration,
	)

	return response, nil
}

// Helper functions for converting simulation types to query types

func convertNamespaceBreakdown(input map[string]*simulation.NamespaceImpact) map[string]*NamespaceImpact {
	if input == nil {
		return nil
	}
	output := make(map[string]*NamespaceImpact)
	for k, v := range input {
		output[k] = &NamespaceImpact{
			Namespace:    v.Namespace,
			TotalFlows:   v.TotalFlows,
			AllowedCount: v.AllowedCount,
			DeniedCount:  v.DeniedCount,
			WouldDeny:    v.WouldDeny,
			WouldAllow:   v.WouldAllow,
			NoChange:     v.NoChange,
		}
	}
	return output
}

func convertVerdictBreakdown(input *simulation.VerdictBreakdown) *VerdictBreakdown {
	if input == nil {
		return nil
	}
	return &VerdictBreakdown{
		AllowedToAllowed: input.AllowedToAllowed,
		AllowedToDenied:  input.AllowedToDenied,
		DeniedToAllowed:  input.DeniedToAllowed,
		DeniedToDenied:   input.DeniedToDenied,
		DroppedToAllowed: input.DroppedToAllowed,
		DroppedToDenied:  input.DroppedToDenied,
	}
}

func convertFlowDetails(input []*simulation.FlowSimulationResult) []*FlowSimulationResult {
	if input == nil {
		return nil
	}
	output := make([]*FlowSimulationResult, len(input))
	for i, v := range input {
		output[i] = &FlowSimulationResult{
			Timestamp:        v.Timestamp,
			SrcNamespace:     v.SrcNamespace,
			SrcPodName:       v.SrcPodName,
			DstNamespace:     v.DstNamespace,
			DstPodName:       v.DstPodName,
			DstPort:          v.DstPort,
			Protocol:         v.Protocol,
			L7Type:           v.L7Type,
			HTTPMethod:       v.HTTPMethod,
			HTTPPath:         v.HTTPPath,
			OriginalVerdict:  v.OriginalVerdict,
			SimulatedVerdict: v.SimulatedVerdict,
			VerdictChanged:   v.VerdictChanged,
			MatchedRule:      v.MatchedRule,
			MatchReason:      v.MatchReason,
		}
	}
	return output
}

// GetStats returns server statistics.
func (s *Server) GetStats() ServerStats {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return ServerStats{
		TotalQueries:     s.totalQueries,
		TotalEvents:      s.totalEvents,
		QueryErrors:      s.queryErrors,
		TotalSimulations: s.totalSimulations,
		LastQueryTime:    s.lastQueryTime,
		Started:          s.started,
	}
}

// ServerStats contains server statistics.
type ServerStats struct {
	TotalQueries     int64
	TotalSimulations int64
	TotalEvents   int64
	QueryErrors   int64
	LastQueryTime time.Time
	Started       bool
}

// modelEventToProto converts a model event to the proto format.
func modelEventToProto(e *models.TelemetryEvent) *TelemetryEvent {
	return &TelemetryEvent{
		ID:           e.ID,
		Timestamp:    e.Timestamp,
		EventType:    string(e.EventType),
		NodeName:     e.NodeName,
		SrcNamespace: e.SrcNamespace,
		SrcPodName:   e.SrcPodName,
		SrcPodLabels: e.SrcPodLabels,
		SrcIP:        e.SrcIP,
		SrcPort:      e.SrcPort,
		SrcProcess:   e.SrcProcess,
		SrcPID:       e.SrcPID,
		SrcBinary:    e.SrcBinary,
		DstNamespace: e.DstNamespace,
		DstPodName:   e.DstPodName,
		DstPodLabels: e.DstPodLabels,
		DstIP:        e.DstIP,
		DstPort:      e.DstPort,
		Protocol:     e.Protocol,
		L7Type:       e.L7Type,
		HTTPMethod:   e.HTTPMethod,
		HTTPPath:     e.HTTPPath,
		HTTPStatus:   e.HTTPStatus,
		DNSQuery:     e.DNSQuery,
		Syscall:      e.Syscall,
		FilePath:     e.FilePath,
		Verdict:      string(e.Verdict),
		Action:       e.Action,
		BytesTotal:   e.BytesTotal,
		PacketsTotal: e.PacketsTotal,
		Source:       e.Source,
	}
}
