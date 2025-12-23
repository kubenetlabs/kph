package query

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/go-logr/logr"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"

	"github.com/policy-hub/operator/internal/telemetry/models"
	"github.com/policy-hub/operator/internal/telemetry/simulation"
	"github.com/policy-hub/operator/internal/telemetry/storage"
)

func TestServer_NewServer(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "query-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := storage.NewManager(storage.ManagerConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("Failed to create storage manager: %v", err)
	}
	defer mgr.Close()

	server := NewServer(ServerConfig{
		StorageManager: mgr,
		APIKey:         "test-api-key",
		Logger:         logr.Discard(),
	})

	if server == nil {
		t.Fatal("NewServer() returned nil")
	}
	if server.storageMgr == nil {
		t.Error("storageMgr should not be nil")
	}
	if server.simEngine == nil {
		t.Error("simEngine should not be nil")
	}
	if server.apiKey != "test-api-key" {
		t.Errorf("apiKey = %s, want test-api-key", server.apiKey)
	}
}

func TestServer_NewServer_NoAuth(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "query-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := storage.NewManager(storage.ManagerConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("Failed to create storage manager: %v", err)
	}
	defer mgr.Close()

	server := NewServer(ServerConfig{
		StorageManager: mgr,
		APIKey:         "",
		Logger:         logr.Discard(),
	})

	if server.apiKey != "" {
		t.Errorf("apiKey = %s, want empty", server.apiKey)
	}
}

func TestServer_Authenticate_NoAPIKey(t *testing.T) {
	server := &Server{
		apiKey: "",
		log:    logr.Discard(),
	}

	ctx := context.Background()
	err := server.authenticate(ctx)
	if err != nil {
		t.Errorf("authenticate() with no API key configured should succeed, got: %v", err)
	}
}

func TestServer_Authenticate_MissingMetadata(t *testing.T) {
	server := &Server{
		apiKey: "secret-key",
		log:    logr.Discard(),
	}

	ctx := context.Background()
	err := server.authenticate(ctx)
	if err == nil {
		t.Error("authenticate() with missing metadata should return error")
	}
}

func TestServer_Authenticate_MissingAuthHeader(t *testing.T) {
	server := &Server{
		apiKey: "secret-key",
		log:    logr.Discard(),
	}

	md := metadata.New(map[string]string{"other-header": "value"})
	ctx := metadata.NewIncomingContext(context.Background(), md)

	err := server.authenticate(ctx)
	if err == nil {
		t.Error("authenticate() with missing authorization header should return error")
	}
}

func TestServer_Authenticate_InvalidToken(t *testing.T) {
	server := &Server{
		apiKey: "correct-secret-key",
		log:    logr.Discard(),
	}

	md := metadata.New(map[string]string{"authorization": "Bearer wrong-key"})
	ctx := metadata.NewIncomingContext(context.Background(), md)

	err := server.authenticate(ctx)
	if err == nil {
		t.Error("authenticate() with invalid token should return error")
	}
}

func TestServer_Authenticate_ValidToken(t *testing.T) {
	server := &Server{
		apiKey: "correct-secret-key",
		log:    logr.Discard(),
	}

	md := metadata.New(map[string]string{"authorization": "Bearer correct-secret-key"})
	ctx := metadata.NewIncomingContext(context.Background(), md)

	err := server.authenticate(ctx)
	if err != nil {
		t.Errorf("authenticate() with valid token error = %v", err)
	}
}

func TestServer_Authenticate_ValidTokenWithoutBearer(t *testing.T) {
	server := &Server{
		apiKey: "correct-secret-key",
		log:    logr.Discard(),
	}

	md := metadata.New(map[string]string{"authorization": "correct-secret-key"})
	ctx := metadata.NewIncomingContext(context.Background(), md)

	err := server.authenticate(ctx)
	if err != nil {
		t.Errorf("authenticate() with valid token (no Bearer prefix) error = %v", err)
	}
}

func TestServer_GetStats_Initial(t *testing.T) {
	server := &Server{
		log: logr.Discard(),
	}

	stats := server.GetStats()

	if stats.TotalQueries != 0 {
		t.Errorf("TotalQueries = %d, want 0", stats.TotalQueries)
	}
	if stats.TotalSimulations != 0 {
		t.Errorf("TotalSimulations = %d, want 0", stats.TotalSimulations)
	}
	if stats.TotalEvents != 0 {
		t.Errorf("TotalEvents = %d, want 0", stats.TotalEvents)
	}
	if stats.QueryErrors != 0 {
		t.Errorf("QueryErrors = %d, want 0", stats.QueryErrors)
	}
	if stats.Started {
		t.Error("Started should be false initially")
	}
}

func TestServer_Stop_NotStarted(t *testing.T) {
	server := &Server{
		log: logr.Discard(),
	}

	// Stop before Start should not panic
	server.Stop()

	stats := server.GetStats()
	if stats.Started {
		t.Error("Started should be false after Stop")
	}
}

func TestModelEventToProto(t *testing.T) {
	now := time.Now()
	event := &models.TelemetryEvent{
		ID:           "test-event-123",
		Timestamp:    now,
		EventType:    models.EventTypeFlow,
		NodeName:     "node-1",
		SrcNamespace: "default",
		SrcPodName:   "frontend-abc",
		SrcPodLabels: map[string]string{"app": "frontend"},
		SrcIP:        "10.0.0.1",
		SrcPort:      32000,
		SrcProcess:   "nginx",
		SrcPID:       1234,
		SrcBinary:    "/usr/sbin/nginx",
		DstNamespace: "production",
		DstPodName:   "backend-xyz",
		DstPodLabels: map[string]string{"app": "backend"},
		DstIP:        "10.0.0.2",
		DstPort:      8080,
		Protocol:     "TCP",
		L7Type:       "HTTP",
		HTTPMethod:   "GET",
		HTTPPath:     "/api/users",
		HTTPStatus:   200,
		DNSQuery:     "",
		Syscall:      "",
		FilePath:     "",
		Verdict:      models.VerdictAllowed,
		Action:       "",
		BytesTotal:   1024,
		PacketsTotal: 10,
		Source:       "hubble",
	}

	proto := modelEventToProto(event)

	if proto.ID != "test-event-123" {
		t.Errorf("ID = %s, want test-event-123", proto.ID)
	}
	if proto.EventType != "FLOW" {
		t.Errorf("EventType = %s, want FLOW", proto.EventType)
	}
	if proto.NodeName != "node-1" {
		t.Errorf("NodeName = %s, want node-1", proto.NodeName)
	}
	if proto.SrcNamespace != "default" {
		t.Errorf("SrcNamespace = %s, want default", proto.SrcNamespace)
	}
	if proto.SrcPodName != "frontend-abc" {
		t.Errorf("SrcPodName = %s, want frontend-abc", proto.SrcPodName)
	}
	if proto.DstPort != 8080 {
		t.Errorf("DstPort = %d, want 8080", proto.DstPort)
	}
	if proto.Protocol != "TCP" {
		t.Errorf("Protocol = %s, want TCP", proto.Protocol)
	}
	if proto.HTTPMethod != "GET" {
		t.Errorf("HTTPMethod = %s, want GET", proto.HTTPMethod)
	}
	if proto.Verdict != "ALLOWED" {
		t.Errorf("Verdict = %s, want ALLOWED", proto.Verdict)
	}
	if proto.BytesTotal != 1024 {
		t.Errorf("BytesTotal = %d, want 1024", proto.BytesTotal)
	}
	if proto.Source != "hubble" {
		t.Errorf("Source = %s, want hubble", proto.Source)
	}
}

func TestModelEventToProto_ProcessEvent(t *testing.T) {
	now := time.Now()
	event := &models.TelemetryEvent{
		ID:           "process-event-456",
		Timestamp:    now,
		EventType:    models.EventTypeProcessExec,
		NodeName:     "node-2",
		SrcNamespace: "default",
		SrcPodName:   "app-pod",
		SrcProcess:   "python",
		SrcBinary:    "/usr/bin/python3",
		SrcPID:       5678,
		Syscall:      "execve",
		FilePath:     "/app/main.py",
		Action:       "LOG",
		Source:       "tetragon",
	}

	proto := modelEventToProto(event)

	if proto.EventType != "PROCESS_EXEC" {
		t.Errorf("EventType = %s, want PROCESS_EXEC", proto.EventType)
	}
	if proto.SrcProcess != "python" {
		t.Errorf("SrcProcess = %s, want python", proto.SrcProcess)
	}
	if proto.SrcBinary != "/usr/bin/python3" {
		t.Errorf("SrcBinary = %s, want /usr/bin/python3", proto.SrcBinary)
	}
	if proto.Syscall != "execve" {
		t.Errorf("Syscall = %s, want execve", proto.Syscall)
	}
	if proto.FilePath != "/app/main.py" {
		t.Errorf("FilePath = %s, want /app/main.py", proto.FilePath)
	}
	if proto.Action != "LOG" {
		t.Errorf("Action = %s, want LOG", proto.Action)
	}
	if proto.Source != "tetragon" {
		t.Errorf("Source = %s, want tetragon", proto.Source)
	}
}

func TestConvertNamespaceBreakdown(t *testing.T) {
	// Import simulation package types - we'll just test nil case here
	result := convertNamespaceBreakdown(nil)
	if result != nil {
		t.Error("convertNamespaceBreakdown(nil) should return nil")
	}
}

func TestConvertVerdictBreakdown(t *testing.T) {
	result := convertVerdictBreakdown(nil)
	if result != nil {
		t.Error("convertVerdictBreakdown(nil) should return nil")
	}
}

func TestConvertFlowDetails(t *testing.T) {
	result := convertFlowDetails(nil)
	if result != nil {
		t.Error("convertFlowDetails(nil) should return nil")
	}
}

func TestServerStats_Fields(t *testing.T) {
	now := time.Now()
	stats := ServerStats{
		TotalQueries:     100,
		TotalSimulations: 25,
		TotalEvents:      50000,
		QueryErrors:      5,
		LastQueryTime:    now,
		Started:          true,
	}

	if stats.TotalQueries != 100 {
		t.Errorf("TotalQueries = %d, want 100", stats.TotalQueries)
	}
	if stats.TotalSimulations != 25 {
		t.Errorf("TotalSimulations = %d, want 25", stats.TotalSimulations)
	}
	if stats.TotalEvents != 50000 {
		t.Errorf("TotalEvents = %d, want 50000", stats.TotalEvents)
	}
	if stats.QueryErrors != 5 {
		t.Errorf("QueryErrors = %d, want 5", stats.QueryErrors)
	}
	if !stats.Started {
		t.Error("Started should be true")
	}
}

func TestServer_Start_Success(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "query-start-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := storage.NewManager(storage.ManagerConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("Failed to create storage manager: %v", err)
	}
	defer mgr.Close()

	server := NewServer(ServerConfig{
		StorageManager: mgr,
		APIKey:         "",
		Logger:         logr.Discard(),
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start server on random port
	err = server.Start(ctx, "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	defer server.Stop()

	stats := server.GetStats()
	if !stats.Started {
		t.Error("Started should be true after Start()")
	}
}

func TestServer_Start_AlreadyStarted(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "query-start-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := storage.NewManager(storage.ManagerConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("Failed to create storage manager: %v", err)
	}
	defer mgr.Close()

	server := NewServer(ServerConfig{
		StorageManager: mgr,
		APIKey:         "",
		Logger:         logr.Discard(),
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	err = server.Start(ctx, "127.0.0.1:0")
	if err != nil {
		t.Fatalf("First Start() error = %v", err)
	}
	defer server.Stop()

	// Second start should fail
	err = server.Start(ctx, "127.0.0.1:0")
	if err == nil {
		t.Error("Second Start() should return error")
	}
}

func TestServer_Start_InvalidAddress(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "query-start-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := storage.NewManager(storage.ManagerConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("Failed to create storage manager: %v", err)
	}
	defer mgr.Close()

	server := NewServer(ServerConfig{
		StorageManager: mgr,
		APIKey:         "",
		Logger:         logr.Discard(),
	})

	ctx := context.Background()
	err = server.Start(ctx, "invalid-address:99999999")
	if err == nil {
		t.Error("Start() with invalid address should return error")
		server.Stop()
	}
}

func TestServer_QueryEvents_Success(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "query-events-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := storage.NewManager(storage.ManagerConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("Failed to create storage manager: %v", err)
	}
	defer mgr.Close()

	server := NewServer(ServerConfig{
		StorageManager: mgr,
		APIKey:         "",
		Logger:         logr.Discard(),
	})

	ctx := context.Background()
	now := time.Now()
	req := &QueryEventsRequest{
		StartTime: now.Add(-2 * time.Hour),
		EndTime:   now,
		Limit:     100,
	}

	// Test that query runs without error and updates stats
	resp, err := server.QueryEvents(ctx, req)
	if err != nil {
		t.Fatalf("QueryEvents() error = %v", err)
	}

	// Response should be valid (empty is ok for this test)
	if resp == nil {
		t.Fatal("QueryEvents() returned nil response")
	}

	stats := server.GetStats()
	if stats.TotalQueries != 1 {
		t.Errorf("TotalQueries = %d, want 1", stats.TotalQueries)
	}
	if !stats.LastQueryTime.After(now.Add(-1 * time.Second)) {
		t.Error("LastQueryTime should be recent")
	}
}

func TestServer_QueryEvents_WithFilters(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "query-events-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := storage.NewManager(storage.ManagerConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("Failed to create storage manager: %v", err)
	}
	defer mgr.Close()

	server := NewServer(ServerConfig{
		StorageManager: mgr,
		APIKey:         "",
		Logger:         logr.Discard(),
	})

	ctx := context.Background()
	now := time.Now()

	// Test with namespace filter
	req := &QueryEventsRequest{
		StartTime:  now.Add(-2 * time.Hour),
		EndTime:    now,
		Namespaces: []string{"default", "production"},
		EventTypes: []string{"FLOW"},
		Limit:      100,
		Offset:     10,
	}

	resp, err := server.QueryEvents(ctx, req)
	if err != nil {
		t.Fatalf("QueryEvents() with filters error = %v", err)
	}

	if resp == nil {
		t.Fatal("QueryEvents() returned nil response")
	}

	// Multiple queries should increment counter
	_, _ = server.QueryEvents(ctx, req)
	_, _ = server.QueryEvents(ctx, req)

	stats := server.GetStats()
	if stats.TotalQueries != 3 {
		t.Errorf("TotalQueries = %d, want 3", stats.TotalQueries)
	}
}

func TestServer_GetEventCount_Success(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "query-count-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := storage.NewManager(storage.ManagerConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("Failed to create storage manager: %v", err)
	}
	defer mgr.Close()

	server := NewServer(ServerConfig{
		StorageManager: mgr,
		APIKey:         "",
		Logger:         logr.Discard(),
	})

	ctx := context.Background()
	now := time.Now()
	req := &GetEventCountRequest{
		StartTime:  now.Add(-2 * time.Hour),
		EndTime:    now,
		Namespaces: []string{"default"},
	}

	resp, err := server.GetEventCount(ctx, req)
	if err != nil {
		t.Fatalf("GetEventCount() error = %v", err)
	}

	// Response should have valid structure (counts may be 0 for empty storage)
	if resp == nil {
		t.Fatal("GetEventCount() returned nil response")
	}
	if resp.EventsByType == nil {
		t.Error("EventsByType should not be nil")
	}
	if resp.EventsByNode == nil {
		t.Error("EventsByNode should not be nil")
	}
}

func TestServer_SimulatePolicy_Success(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "query-sim-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := storage.NewManager(storage.ManagerConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("Failed to create storage manager: %v", err)
	}
	defer mgr.Close()

	server := NewServer(ServerConfig{
		StorageManager: mgr,
		APIKey:         "",
		Logger:         logr.Discard(),
	})

	ctx := context.Background()
	now := time.Now()
	req := &SimulatePolicyRequest{
		PolicyContent: `
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: test-policy
  namespace: default
spec:
  endpointSelector:
    matchLabels:
      app: backend
  ingress:
  - fromEndpoints:
    - matchLabels:
        app: frontend
    toPorts:
    - ports:
      - port: "8080"
        protocol: TCP
`,
		PolicyType:     "CILIUM_NETWORK",
		StartTime:      now.Add(-2 * time.Hour),
		EndTime:        now,
		Namespaces:     []string{"default"},
		IncludeDetails: true,
		MaxDetails:     50,
	}

	resp, err := server.SimulatePolicy(ctx, req)
	if err != nil {
		t.Fatalf("SimulatePolicy() error = %v", err)
	}

	// Response should be valid (may have 0 flows for empty storage)
	if resp == nil {
		t.Fatal("SimulatePolicy() returned nil response")
	}

	stats := server.GetStats()
	if stats.TotalSimulations != 1 {
		t.Errorf("TotalSimulations = %d, want 1", stats.TotalSimulations)
	}
	if !stats.LastQueryTime.After(now.Add(-1 * time.Second)) {
		t.Error("LastQueryTime should be recent")
	}
}

func TestServer_SimulatePolicy_InvalidPolicy(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "query-sim-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := storage.NewManager(storage.ManagerConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("Failed to create storage manager: %v", err)
	}
	defer mgr.Close()

	server := NewServer(ServerConfig{
		StorageManager: mgr,
		APIKey:         "",
		Logger:         logr.Discard(),
	})

	ctx := context.Background()
	now := time.Now()
	req := &SimulatePolicyRequest{
		PolicyContent: "invalid yaml: [",
		PolicyType:    "CILIUM_NETWORK",
		StartTime:     now.Add(-2 * time.Hour),
		EndTime:       now,
	}

	resp, err := server.SimulatePolicy(ctx, req)
	// Should return response with error, not fail
	if err != nil {
		t.Fatalf("SimulatePolicy() should not return error for invalid policy, got: %v", err)
	}
	if resp == nil {
		t.Fatal("SimulatePolicy() returned nil response")
	}
	// Errors should be captured in the response
	if len(resp.Errors) == 0 {
		t.Error("Expected errors in response for invalid policy")
	}
}

func TestConvertNamespaceBreakdown_NonNil(t *testing.T) {
	input := map[string]*simulation.NamespaceImpact{
		"default": {
			Namespace:    "default",
			TotalFlows:   100,
			AllowedCount: 80,
			DeniedCount:  20,
			WouldDeny:    10,
			WouldAllow:   5,
			NoChange:     85,
		},
		"production": {
			Namespace:    "production",
			TotalFlows:   200,
			AllowedCount: 150,
			DeniedCount:  50,
			WouldDeny:    25,
			WouldAllow:   10,
			NoChange:     165,
		},
	}

	result := convertNamespaceBreakdown(input)

	if result == nil {
		t.Fatal("convertNamespaceBreakdown returned nil for non-nil input")
	}
	if len(result) != 2 {
		t.Errorf("Result length = %d, want 2", len(result))
	}

	defaultImpact := result["default"]
	if defaultImpact == nil {
		t.Fatal("default namespace not found")
	}
	if defaultImpact.Namespace != "default" {
		t.Errorf("Namespace = %s, want default", defaultImpact.Namespace)
	}
	if defaultImpact.TotalFlows != 100 {
		t.Errorf("TotalFlows = %d, want 100", defaultImpact.TotalFlows)
	}
	if defaultImpact.AllowedCount != 80 {
		t.Errorf("AllowedCount = %d, want 80", defaultImpact.AllowedCount)
	}
	if defaultImpact.DeniedCount != 20 {
		t.Errorf("DeniedCount = %d, want 20", defaultImpact.DeniedCount)
	}
	if defaultImpact.WouldDeny != 10 {
		t.Errorf("WouldDeny = %d, want 10", defaultImpact.WouldDeny)
	}
	if defaultImpact.WouldAllow != 5 {
		t.Errorf("WouldAllow = %d, want 5", defaultImpact.WouldAllow)
	}
	if defaultImpact.NoChange != 85 {
		t.Errorf("NoChange = %d, want 85", defaultImpact.NoChange)
	}
}

func TestConvertVerdictBreakdown_NonNil(t *testing.T) {
	input := &simulation.VerdictBreakdown{
		AllowedToAllowed: 700,
		AllowedToDenied:  100,
		DeniedToAllowed:  50,
		DeniedToDenied:   150,
		DroppedToAllowed: 25,
		DroppedToDenied:  75,
	}

	result := convertVerdictBreakdown(input)

	if result == nil {
		t.Fatal("convertVerdictBreakdown returned nil for non-nil input")
	}
	if result.AllowedToAllowed != 700 {
		t.Errorf("AllowedToAllowed = %d, want 700", result.AllowedToAllowed)
	}
	if result.AllowedToDenied != 100 {
		t.Errorf("AllowedToDenied = %d, want 100", result.AllowedToDenied)
	}
	if result.DeniedToAllowed != 50 {
		t.Errorf("DeniedToAllowed = %d, want 50", result.DeniedToAllowed)
	}
	if result.DeniedToDenied != 150 {
		t.Errorf("DeniedToDenied = %d, want 150", result.DeniedToDenied)
	}
	if result.DroppedToAllowed != 25 {
		t.Errorf("DroppedToAllowed = %d, want 25", result.DroppedToAllowed)
	}
	if result.DroppedToDenied != 75 {
		t.Errorf("DroppedToDenied = %d, want 75", result.DroppedToDenied)
	}
}

func TestConvertFlowDetails_NonNil(t *testing.T) {
	now := time.Now()
	input := []*simulation.FlowSimulationResult{
		{
			Timestamp:        now,
			SrcNamespace:     "default",
			SrcPodName:       "frontend",
			DstNamespace:     "default",
			DstPodName:       "backend",
			DstPort:          8080,
			Protocol:         "TCP",
			L7Type:           "HTTP",
			HTTPMethod:       "GET",
			HTTPPath:         "/api/users",
			OriginalVerdict:  "ALLOWED",
			SimulatedVerdict: "DENIED",
			VerdictChanged:   true,
			MatchedRule:      "deny-all",
			MatchReason:      "No matching ingress rule",
		},
		{
			Timestamp:        now.Add(-1 * time.Hour),
			SrcNamespace:     "production",
			SrcPodName:       "api",
			DstNamespace:     "production",
			DstPodName:       "db",
			DstPort:          5432,
			Protocol:         "TCP",
			OriginalVerdict:  "ALLOWED",
			SimulatedVerdict: "ALLOWED",
			VerdictChanged:   false,
			MatchedRule:      "allow-db",
		},
	}

	result := convertFlowDetails(input)

	if result == nil {
		t.Fatal("convertFlowDetails returned nil for non-nil input")
	}
	if len(result) != 2 {
		t.Errorf("Result length = %d, want 2", len(result))
	}

	first := result[0]
	if first.SrcNamespace != "default" {
		t.Errorf("SrcNamespace = %s, want default", first.SrcNamespace)
	}
	if first.SrcPodName != "frontend" {
		t.Errorf("SrcPodName = %s, want frontend", first.SrcPodName)
	}
	if first.DstPort != 8080 {
		t.Errorf("DstPort = %d, want 8080", first.DstPort)
	}
	if first.Protocol != "TCP" {
		t.Errorf("Protocol = %s, want TCP", first.Protocol)
	}
	if first.L7Type != "HTTP" {
		t.Errorf("L7Type = %s, want HTTP", first.L7Type)
	}
	if first.HTTPMethod != "GET" {
		t.Errorf("HTTPMethod = %s, want GET", first.HTTPMethod)
	}
	if first.HTTPPath != "/api/users" {
		t.Errorf("HTTPPath = %s, want /api/users", first.HTTPPath)
	}
	if !first.VerdictChanged {
		t.Error("VerdictChanged should be true")
	}
	if first.MatchedRule != "deny-all" {
		t.Errorf("MatchedRule = %s, want deny-all", first.MatchedRule)
	}
	if first.MatchReason != "No matching ingress rule" {
		t.Errorf("MatchReason = %s, want 'No matching ingress rule'", first.MatchReason)
	}

	second := result[1]
	if second.VerdictChanged {
		t.Error("Second result VerdictChanged should be false")
	}
}

func TestConvertFlowDetails_Empty(t *testing.T) {
	input := []*simulation.FlowSimulationResult{}
	result := convertFlowDetails(input)

	if result == nil {
		t.Error("convertFlowDetails should return empty slice, not nil")
	}
	if len(result) != 0 {
		t.Errorf("Result length = %d, want 0", len(result))
	}
}

func TestServer_UnaryAuthInterceptor_NoAuth(t *testing.T) {
	server := &Server{
		apiKey: "",
		log:    logr.Discard(),
	}

	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return "success", nil
	}

	ctx := context.Background()
	result, err := server.unaryAuthInterceptor(ctx, nil, nil, handler)
	if err != nil {
		t.Errorf("unaryAuthInterceptor() error = %v", err)
	}
	if result != "success" {
		t.Errorf("unaryAuthInterceptor() result = %v, want success", result)
	}
}

func TestServer_UnaryAuthInterceptor_ValidAuth(t *testing.T) {
	server := &Server{
		apiKey: "test-key",
		log:    logr.Discard(),
	}

	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return "success", nil
	}

	md := metadata.New(map[string]string{"authorization": "Bearer test-key"})
	ctx := metadata.NewIncomingContext(context.Background(), md)

	result, err := server.unaryAuthInterceptor(ctx, nil, nil, handler)
	if err != nil {
		t.Errorf("unaryAuthInterceptor() error = %v", err)
	}
	if result != "success" {
		t.Errorf("unaryAuthInterceptor() result = %v, want success", result)
	}
}

func TestServer_UnaryAuthInterceptor_InvalidAuth(t *testing.T) {
	server := &Server{
		apiKey: "correct-key",
		log:    logr.Discard(),
	}

	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return "success", nil
	}

	md := metadata.New(map[string]string{"authorization": "Bearer wrong-key"})
	ctx := metadata.NewIncomingContext(context.Background(), md)

	_, err := server.unaryAuthInterceptor(ctx, nil, nil, handler)
	if err == nil {
		t.Error("unaryAuthInterceptor() should return error for invalid auth")
	}
}

// mockServerStream implements grpc.ServerStream for testing
type mockServerStream struct {
	ctx context.Context
}

func (m *mockServerStream) SetHeader(metadata.MD) error  { return nil }
func (m *mockServerStream) SendHeader(metadata.MD) error { return nil }
func (m *mockServerStream) SetTrailer(metadata.MD)       {}
func (m *mockServerStream) Context() context.Context     { return m.ctx }
func (m *mockServerStream) SendMsg(msg interface{}) error { return nil }
func (m *mockServerStream) RecvMsg(msg interface{}) error { return nil }

func TestServer_StreamAuthInterceptor_NoAuth(t *testing.T) {
	server := &Server{
		apiKey: "",
		log:    logr.Discard(),
	}

	handlerCalled := false
	handler := func(srv interface{}, stream grpc.ServerStream) error {
		handlerCalled = true
		return nil
	}

	stream := &mockServerStream{ctx: context.Background()}
	err := server.streamAuthInterceptor(nil, stream, nil, handler)
	if err != nil {
		t.Errorf("streamAuthInterceptor() error = %v", err)
	}
	if !handlerCalled {
		t.Error("handler was not called")
	}
}

func TestServer_StreamAuthInterceptor_ValidAuth(t *testing.T) {
	server := &Server{
		apiKey: "test-key",
		log:    logr.Discard(),
	}

	handlerCalled := false
	handler := func(srv interface{}, stream grpc.ServerStream) error {
		handlerCalled = true
		return nil
	}

	md := metadata.New(map[string]string{"authorization": "Bearer test-key"})
	ctx := metadata.NewIncomingContext(context.Background(), md)
	stream := &mockServerStream{ctx: ctx}

	err := server.streamAuthInterceptor(nil, stream, nil, handler)
	if err != nil {
		t.Errorf("streamAuthInterceptor() error = %v", err)
	}
	if !handlerCalled {
		t.Error("handler was not called")
	}
}

func TestServer_StreamAuthInterceptor_InvalidAuth(t *testing.T) {
	server := &Server{
		apiKey: "correct-key",
		log:    logr.Discard(),
	}

	handler := func(srv interface{}, stream grpc.ServerStream) error {
		return nil
	}

	md := metadata.New(map[string]string{"authorization": "Bearer wrong-key"})
	ctx := metadata.NewIncomingContext(context.Background(), md)
	stream := &mockServerStream{ctx: ctx}

	err := server.streamAuthInterceptor(nil, stream, nil, handler)
	if err == nil {
		t.Error("streamAuthInterceptor() should return error for invalid auth")
	}
}

func TestServer_Stop_AfterStart(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "query-stop-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := storage.NewManager(storage.ManagerConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("Failed to create storage manager: %v", err)
	}
	defer mgr.Close()

	server := NewServer(ServerConfig{
		StorageManager: mgr,
		APIKey:         "",
		Logger:         logr.Discard(),
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	err = server.Start(ctx, "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}

	stats := server.GetStats()
	if !stats.Started {
		t.Error("Started should be true after Start()")
	}

	server.Stop()

	stats = server.GetStats()
	if stats.Started {
		t.Error("Started should be false after Stop()")
	}
}

// mockStreamEventsServer implements TelemetryQuery_StreamEventsServer for testing
type mockStreamEventsServer struct {
	grpc.ServerStream
	ctx        context.Context
	sentEvents []*TelemetryEvent
	sendErr    error
}

func (m *mockStreamEventsServer) Context() context.Context {
	return m.ctx
}

func (m *mockStreamEventsServer) Send(event *TelemetryEvent) error {
	if m.sendErr != nil {
		return m.sendErr
	}
	m.sentEvents = append(m.sentEvents, event)
	return nil
}

func TestServer_StreamEvents_Success(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "query-stream-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := storage.NewManager(storage.ManagerConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("Failed to create storage manager: %v", err)
	}
	defer mgr.Close()

	server := NewServer(ServerConfig{
		StorageManager: mgr,
		APIKey:         "",
		Logger:         logr.Discard(),
	})

	now := time.Now()
	req := &QueryEventsRequest{
		StartTime: now.Add(-2 * time.Hour),
		EndTime:   now,
		Limit:     100,
	}

	stream := &mockStreamEventsServer{
		ctx:        context.Background(),
		sentEvents: make([]*TelemetryEvent, 0),
	}

	err = server.StreamEvents(req, stream)
	if err != nil {
		t.Fatalf("StreamEvents() error = %v", err)
	}

	// Stats should be updated
	stats := server.GetStats()
	if stats.TotalQueries != 1 {
		t.Errorf("TotalQueries = %d, want 1", stats.TotalQueries)
	}
}

func TestServer_StreamEvents_WithFilters(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "query-stream-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := storage.NewManager(storage.ManagerConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("Failed to create storage manager: %v", err)
	}
	defer mgr.Close()

	server := NewServer(ServerConfig{
		StorageManager: mgr,
		APIKey:         "",
		Logger:         logr.Discard(),
	})

	now := time.Now()
	req := &QueryEventsRequest{
		StartTime:  now.Add(-2 * time.Hour),
		EndTime:    now,
		Namespaces: []string{"default", "production"},
		EventTypes: []string{"FLOW", "PROCESS_EXEC"},
		Limit:      100,
		Offset:     10,
	}

	stream := &mockStreamEventsServer{
		ctx:        context.Background(),
		sentEvents: make([]*TelemetryEvent, 0),
	}

	err = server.StreamEvents(req, stream)
	if err != nil {
		t.Fatalf("StreamEvents() with filters error = %v", err)
	}

	stats := server.GetStats()
	if stats.TotalQueries != 1 {
		t.Errorf("TotalQueries = %d, want 1", stats.TotalQueries)
	}
}

func TestServer_StreamEvents_MultipleStreams(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "query-stream-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := storage.NewManager(storage.ManagerConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("Failed to create storage manager: %v", err)
	}
	defer mgr.Close()

	server := NewServer(ServerConfig{
		StorageManager: mgr,
		APIKey:         "",
		Logger:         logr.Discard(),
	})

	now := time.Now()
	req := &QueryEventsRequest{
		StartTime: now.Add(-2 * time.Hour),
		EndTime:   now,
		Limit:     100,
	}

	// Run multiple streams
	for i := 0; i < 3; i++ {
		stream := &mockStreamEventsServer{
			ctx:        context.Background(),
			sentEvents: make([]*TelemetryEvent, 0),
		}
		err = server.StreamEvents(req, stream)
		if err != nil {
			t.Fatalf("StreamEvents() iteration %d error = %v", i, err)
		}
	}

	stats := server.GetStats()
	if stats.TotalQueries != 3 {
		t.Errorf("TotalQueries = %d, want 3", stats.TotalQueries)
	}
}

func TestServer_GetEventCount_NoEvents(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "query-count-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := storage.NewManager(storage.ManagerConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("Failed to create storage manager: %v", err)
	}
	defer mgr.Close()

	server := NewServer(ServerConfig{
		StorageManager: mgr,
		APIKey:         "",
		Logger:         logr.Discard(),
	})

	ctx := context.Background()
	now := time.Now()
	req := &GetEventCountRequest{
		StartTime: now.Add(-2 * time.Hour),
		EndTime:   now,
	}

	resp, err := server.GetEventCount(ctx, req)
	if err != nil {
		t.Fatalf("GetEventCount() error = %v", err)
	}

	if resp.TotalEvents != 0 {
		t.Errorf("TotalEvents = %d, want 0", resp.TotalEvents)
	}
	if resp.OldestEvent != (time.Time{}) {
		t.Error("OldestEvent should be zero for no events")
	}
	if resp.NewestEvent != (time.Time{}) {
		t.Error("NewestEvent should be zero for no events")
	}
}

func TestServer_GetEventCount_WithNamespaces(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "query-count-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := storage.NewManager(storage.ManagerConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("Failed to create storage manager: %v", err)
	}
	defer mgr.Close()

	server := NewServer(ServerConfig{
		StorageManager: mgr,
		APIKey:         "",
		Logger:         logr.Discard(),
	})

	ctx := context.Background()
	now := time.Now()
	req := &GetEventCountRequest{
		StartTime:  now.Add(-2 * time.Hour),
		EndTime:    now,
		Namespaces: []string{"default", "production", "staging"},
	}

	resp, err := server.GetEventCount(ctx, req)
	if err != nil {
		t.Fatalf("GetEventCount() error = %v", err)
	}

	if resp == nil {
		t.Fatal("GetEventCount() returned nil response")
	}
}

func TestServer_SimulatePolicy_WithOptions(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "query-sim-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := storage.NewManager(storage.ManagerConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("Failed to create storage manager: %v", err)
	}
	defer mgr.Close()

	server := NewServer(ServerConfig{
		StorageManager: mgr,
		APIKey:         "",
		Logger:         logr.Discard(),
	})

	ctx := context.Background()
	now := time.Now()

	// Test without details
	req := &SimulatePolicyRequest{
		PolicyContent: `
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: test-policy
  namespace: default
spec:
  endpointSelector: {}
`,
		PolicyType:     "CILIUM_NETWORK",
		StartTime:      now.Add(-2 * time.Hour),
		EndTime:        now,
		IncludeDetails: false,
		MaxDetails:     0,
	}

	resp, err := server.SimulatePolicy(ctx, req)
	if err != nil {
		t.Fatalf("SimulatePolicy() error = %v", err)
	}

	if resp == nil {
		t.Fatal("SimulatePolicy() returned nil response")
	}
}

func TestServer_SimulatePolicy_MultipleSimulations(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "query-sim-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := storage.NewManager(storage.ManagerConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("Failed to create storage manager: %v", err)
	}
	defer mgr.Close()

	server := NewServer(ServerConfig{
		StorageManager: mgr,
		APIKey:         "",
		Logger:         logr.Discard(),
	})

	ctx := context.Background()
	now := time.Now()
	req := &SimulatePolicyRequest{
		PolicyContent: `
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: test-policy
  namespace: default
spec:
  endpointSelector: {}
`,
		PolicyType: "CILIUM_NETWORK",
		StartTime:  now.Add(-2 * time.Hour),
		EndTime:    now,
	}

	// Run multiple simulations
	for i := 0; i < 5; i++ {
		_, err := server.SimulatePolicy(ctx, req)
		if err != nil {
			t.Fatalf("SimulatePolicy() iteration %d error = %v", i, err)
		}
	}

	stats := server.GetStats()
	if stats.TotalSimulations != 5 {
		t.Errorf("TotalSimulations = %d, want 5", stats.TotalSimulations)
	}
}

func TestServer_QueryEvents_StatsTracking(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "query-stats-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := storage.NewManager(storage.ManagerConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("Failed to create storage manager: %v", err)
	}
	defer mgr.Close()

	server := NewServer(ServerConfig{
		StorageManager: mgr,
		APIKey:         "",
		Logger:         logr.Discard(),
	})

	ctx := context.Background()
	now := time.Now()
	req := &QueryEventsRequest{
		StartTime: now.Add(-2 * time.Hour),
		EndTime:   now,
		Limit:     100,
	}

	// Initial stats
	statsBefore := server.GetStats()
	if statsBefore.TotalQueries != 0 {
		t.Errorf("Initial TotalQueries = %d, want 0", statsBefore.TotalQueries)
	}

	// Run query
	_, err = server.QueryEvents(ctx, req)
	if err != nil {
		t.Fatalf("QueryEvents() error = %v", err)
	}

	// Check stats updated
	statsAfter := server.GetStats()
	if statsAfter.TotalQueries != 1 {
		t.Errorf("TotalQueries after = %d, want 1", statsAfter.TotalQueries)
	}
	if !statsAfter.LastQueryTime.After(statsBefore.LastQueryTime) {
		t.Error("LastQueryTime should be updated")
	}
}
