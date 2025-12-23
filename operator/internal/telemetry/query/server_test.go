package query

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/go-logr/logr"
	"google.golang.org/grpc/metadata"

	"github.com/policy-hub/operator/internal/telemetry/models"
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
