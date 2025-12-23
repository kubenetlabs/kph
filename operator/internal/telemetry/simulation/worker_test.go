package simulation

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/go-logr/logr"

	"github.com/policy-hub/operator/internal/saas"
	"github.com/policy-hub/operator/internal/telemetry/storage"
)

func TestNewWorker(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "worker-test-*")
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

	engine := NewEngine(EngineConfig{
		StorageManager: mgr,
		Logger:         logr.Discard(),
	})

	worker := NewWorker(WorkerConfig{
		Engine:       engine,
		SaaSClient:   nil, // No SaaS client for testing
		PollInterval: 5 * time.Second,
		Logger:       logr.Discard(),
	})

	if worker == nil {
		t.Fatal("NewWorker() returned nil")
	}
	if worker.engine == nil {
		t.Error("engine should not be nil")
	}
	if worker.pollInterval != 5*time.Second {
		t.Errorf("pollInterval = %v, want 5s", worker.pollInterval)
	}
}

func TestNewWorker_DefaultPollInterval(t *testing.T) {
	worker := NewWorker(WorkerConfig{
		Engine:       nil,
		SaaSClient:   nil,
		PollInterval: 0, // Should use default
		Logger:       logr.Discard(),
	})

	if worker.pollInterval != 30*time.Second {
		t.Errorf("pollInterval = %v, want 30s (default)", worker.pollInterval)
	}
}

func TestWorker_StartStop(t *testing.T) {
	worker := NewWorker(WorkerConfig{
		Engine:       nil,
		SaaSClient:   nil,
		PollInterval: 100 * time.Millisecond,
		Logger:       logr.Discard(),
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start should succeed
	err := worker.Start(ctx)
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}

	stats := worker.GetStats()
	if !stats.Running {
		t.Error("Running should be true after Start()")
	}

	// Second start should be no-op
	err = worker.Start(ctx)
	if err != nil {
		t.Fatalf("Second Start() error = %v", err)
	}

	// Stop should succeed
	worker.Stop()

	stats = worker.GetStats()
	if stats.Running {
		t.Error("Running should be false after Stop()")
	}
}

func TestWorker_StopWithoutStart(t *testing.T) {
	worker := NewWorker(WorkerConfig{
		Engine:       nil,
		SaaSClient:   nil,
		PollInterval: 100 * time.Millisecond,
		Logger:       logr.Discard(),
	})

	// Stop before Start should not panic
	worker.Stop()

	stats := worker.GetStats()
	if stats.Running {
		t.Error("Running should be false")
	}
}

func TestWorker_GetStats_Initial(t *testing.T) {
	worker := NewWorker(WorkerConfig{
		Engine:       nil,
		SaaSClient:   nil,
		PollInterval: 100 * time.Millisecond,
		Logger:       logr.Discard(),
	})

	stats := worker.GetStats()

	if stats.Running {
		t.Error("Running should be false initially")
	}
	if stats.TotalProcessed != 0 {
		t.Errorf("TotalProcessed = %d, want 0", stats.TotalProcessed)
	}
	if stats.TotalErrors != 0 {
		t.Errorf("TotalErrors = %d, want 0", stats.TotalErrors)
	}
}

func TestWorker_RunOnce(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "worker-test-*")
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

	engine := NewEngine(EngineConfig{
		StorageManager: mgr,
		Logger:         logr.Discard(),
	})

	worker := NewWorker(WorkerConfig{
		Engine:       engine,
		SaaSClient:   nil,
		PollInterval: 5 * time.Second,
		Logger:       logr.Discard(),
	})

	ctx := context.Background()
	now := time.Now()
	req := &SimulationRequest{
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
`,
		PolicyType: "CILIUM_NETWORK",
		StartTime:  now.Add(-1 * time.Hour),
		EndTime:    now,
	}

	resp, err := worker.RunOnce(ctx, req)
	if err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}

	if resp == nil {
		t.Fatal("RunOnce() returned nil response")
	}
}

func TestWorker_RunAndReport_NoSaaSClient(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "worker-test-*")
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

	engine := NewEngine(EngineConfig{
		StorageManager: mgr,
		Logger:         logr.Discard(),
	})

	worker := NewWorker(WorkerConfig{
		Engine:       engine,
		SaaSClient:   nil, // No SaaS client
		PollInterval: 5 * time.Second,
		Logger:       logr.Discard(),
	})

	ctx := context.Background()
	now := time.Now()
	req := &SimulationRequest{
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
		StartTime:  now.Add(-1 * time.Hour),
		EndTime:    now,
	}

	resp, err := worker.RunAndReport(ctx, req)
	if err != nil {
		t.Fatalf("RunAndReport() error = %v", err)
	}

	if resp == nil {
		t.Fatal("RunAndReport() returned nil response")
	}
}

func TestWorker_ProcessPendingSimulations_NoClient(t *testing.T) {
	worker := NewWorker(WorkerConfig{
		Engine:       nil,
		SaaSClient:   nil, // No SaaS client
		PollInterval: 100 * time.Millisecond,
		Logger:       logr.Discard(),
	})

	ctx := context.Background()
	// Should not panic with nil client
	worker.processPendingSimulations(ctx)
}

func TestWorkerStats_Fields(t *testing.T) {
	stats := WorkerStats{
		Running:        true,
		TotalProcessed: 100,
		TotalErrors:    5,
	}

	if !stats.Running {
		t.Error("Running should be true")
	}
	if stats.TotalProcessed != 100 {
		t.Errorf("TotalProcessed = %d, want 100", stats.TotalProcessed)
	}
	if stats.TotalErrors != 5 {
		t.Errorf("TotalErrors = %d, want 5", stats.TotalErrors)
	}
}

func TestWorker_ProcessPendingSimulations_WithSaaSClient(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "worker-test-*")
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

	engine := NewEngine(EngineConfig{
		StorageManager: mgr,
		Logger:         logr.Discard(),
	})

	// Create mock SaaS server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/operator/simulation/pending":
			resp := saas.FetchPendingSimulationsResponse{
				Success: true,
				Simulations: []saas.PendingSimulation{
					{
						SimulationID: "sim-123",
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
						StartTime:  time.Now().Add(-1 * time.Hour),
						EndTime:    time.Now(),
					},
				},
			}
			json.NewEncoder(w).Encode(resp)
		case "/api/operator/simulation/results":
			resp := saas.SubmitSimulationResultResponse{
				Success:      true,
				SimulationID: "sim-123",
			}
			json.NewEncoder(w).Encode(resp)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := saas.NewClient(server.URL, "test-token", "test-cluster", logr.Discard())

	worker := NewWorker(WorkerConfig{
		Engine:       engine,
		SaaSClient:   client,
		PollInterval: 100 * time.Millisecond,
		Logger:       logr.Discard(),
	})

	ctx := context.Background()
	worker.processPendingSimulations(ctx)

	// Check that simulation was processed
	stats := worker.GetStats()
	if stats.TotalProcessed != 1 {
		t.Errorf("TotalProcessed = %d, want 1", stats.TotalProcessed)
	}
}

func TestWorker_ProcessPendingSimulations_EmptyList(t *testing.T) {
	// Create mock SaaS server that returns empty list
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := saas.FetchPendingSimulationsResponse{
			Success:     true,
			Simulations: []saas.PendingSimulation{},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := saas.NewClient(server.URL, "test-token", "test-cluster", logr.Discard())

	worker := NewWorker(WorkerConfig{
		Engine:       nil,
		SaaSClient:   client,
		PollInterval: 100 * time.Millisecond,
		Logger:       logr.Discard(),
	})

	ctx := context.Background()
	worker.processPendingSimulations(ctx)

	// No processing should have occurred
	stats := worker.GetStats()
	if stats.TotalProcessed != 0 {
		t.Errorf("TotalProcessed = %d, want 0", stats.TotalProcessed)
	}
}

func TestWorker_ProcessPendingSimulations_FetchError(t *testing.T) {
	// Create mock SaaS server that returns an error
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := saas.FetchPendingSimulationsResponse{
			Success: false,
			Error:   "internal server error",
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := saas.NewClient(server.URL, "test-token", "test-cluster", logr.Discard())

	worker := NewWorker(WorkerConfig{
		Engine:       nil,
		SaaSClient:   client,
		PollInterval: 100 * time.Millisecond,
		Logger:       logr.Discard(),
	})

	ctx := context.Background()
	worker.processPendingSimulations(ctx)

	// No processing should have occurred
	stats := worker.GetStats()
	if stats.TotalProcessed != 0 {
		t.Errorf("TotalProcessed = %d, want 0", stats.TotalProcessed)
	}
}

func TestWorker_ProcessSimulation_Success(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "worker-test-*")
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

	engine := NewEngine(EngineConfig{
		StorageManager: mgr,
		Logger:         logr.Discard(),
	})

	// Create mock SaaS server
	var resultReceived bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/operator/simulation/results" {
			resultReceived = true
			resp := saas.SubmitSimulationResultResponse{
				Success:      true,
				SimulationID: "sim-456",
			}
			json.NewEncoder(w).Encode(resp)
		}
	}))
	defer server.Close()

	client := saas.NewClient(server.URL, "test-token", "test-cluster", logr.Discard())

	worker := NewWorker(WorkerConfig{
		Engine:       engine,
		SaaSClient:   client,
		PollInterval: 100 * time.Millisecond,
		Logger:       logr.Discard(),
	})

	ctx := context.Background()
	pending := &saas.PendingSimulation{
		SimulationID: "sim-456",
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
		StartTime:  time.Now().Add(-1 * time.Hour),
		EndTime:    time.Now(),
	}

	worker.processSimulation(ctx, pending)

	if !resultReceived {
		t.Error("Expected result to be submitted to SaaS")
	}

	stats := worker.GetStats()
	if stats.TotalProcessed != 1 {
		t.Errorf("TotalProcessed = %d, want 1", stats.TotalProcessed)
	}
}

func TestWorker_ProcessSimulation_InvalidPolicy(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "worker-test-*")
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

	engine := NewEngine(EngineConfig{
		StorageManager: mgr,
		Logger:         logr.Discard(),
	})

	// Create mock SaaS server
	var resultReceived bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/operator/simulation/results" {
			resultReceived = true
			resp := saas.SubmitSimulationResultResponse{
				Success:      true,
				SimulationID: "sim-789",
			}
			json.NewEncoder(w).Encode(resp)
		}
	}))
	defer server.Close()

	client := saas.NewClient(server.URL, "test-token", "test-cluster", logr.Discard())

	worker := NewWorker(WorkerConfig{
		Engine:       engine,
		SaaSClient:   client,
		PollInterval: 100 * time.Millisecond,
		Logger:       logr.Discard(),
	})

	ctx := context.Background()
	pending := &saas.PendingSimulation{
		SimulationID:  "sim-789",
		PolicyContent: "invalid yaml content {{{",
		PolicyType:    "CILIUM_NETWORK",
		StartTime:     time.Now().Add(-1 * time.Hour),
		EndTime:       time.Now(),
	}

	worker.processSimulation(ctx, pending)

	if !resultReceived {
		t.Error("Expected result to be submitted to SaaS")
	}

	// Note: Invalid policies are parsed and return a response with errors field,
	// but don't increment totalErrors since it's not a processing error
	stats := worker.GetStats()
	if stats.TotalProcessed != 1 {
		t.Errorf("TotalProcessed = %d, want 1", stats.TotalProcessed)
	}
}

func TestWorker_ReportResult_WithBreakdowns(t *testing.T) {
	var resultPayload *saas.SimulationResult
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/operator/simulation/results" {
			json.NewDecoder(r.Body).Decode(&resultPayload)
			resp := saas.SubmitSimulationResultResponse{
				Success:      true,
				SimulationID: "sim-breakdown",
			}
			json.NewEncoder(w).Encode(resp)
		}
	}))
	defer server.Close()

	client := saas.NewClient(server.URL, "test-token", "test-cluster", logr.Discard())

	worker := NewWorker(WorkerConfig{
		Engine:       nil,
		SaaSClient:   client,
		PollInterval: 100 * time.Millisecond,
		Logger:       logr.Discard(),
	})

	ctx := context.Background()
	pending := &saas.PendingSimulation{
		SimulationID:  "sim-breakdown",
		PolicyContent: "test",
		PolicyType:    "CILIUM_NETWORK",
		StartTime:     time.Now().Add(-1 * time.Hour),
		EndTime:       time.Now(),
		Namespaces:    []string{"default"},
	}

	resp := &SimulationResponse{
		TotalFlowsAnalyzed: 100,
		AllowedCount:       80,
		DeniedCount:        20,
		NoChangeCount:      90,
		WouldChangeCount:   10,
		BreakdownByNamespace: map[string]*NamespaceImpact{
			"default": {
				Namespace:    "default",
				TotalFlows:   100,
				AllowedCount: 80,
				DeniedCount:  20,
				WouldDeny:    5,
				WouldAllow:   5,
				NoChange:     90,
			},
		},
		BreakdownByVerdict: &VerdictBreakdown{
			AllowedToAllowed: 75,
			AllowedToDenied:  5,
			DeniedToAllowed:  5,
			DeniedToDenied:   15,
		},
		Details: []*FlowSimulationResult{
			{
				Timestamp:        time.Now(),
				SrcNamespace:     "default",
				SrcPodName:       "frontend-abc",
				DstNamespace:     "default",
				DstPodName:       "backend-xyz",
				DstPort:          8080,
				Protocol:         "TCP",
				OriginalVerdict:  "ALLOWED",
				SimulatedVerdict: "DENIED",
				VerdictChanged:   true,
			},
		},
		SimulationTime: time.Now(),
		Duration:       100 * time.Millisecond,
	}

	worker.reportResult(ctx, "sim-breakdown", resp, pending)

	if resultPayload == nil {
		t.Fatal("Expected result payload to be submitted")
	}
	if resultPayload.TotalFlowsAnalyzed != 100 {
		t.Errorf("TotalFlowsAnalyzed = %d, want 100", resultPayload.TotalFlowsAnalyzed)
	}
	if len(resultPayload.BreakdownByNS) != 1 {
		t.Errorf("BreakdownByNS length = %d, want 1", len(resultPayload.BreakdownByNS))
	}
	if resultPayload.BreakdownByVerdict == nil {
		t.Error("BreakdownByVerdict should not be nil")
	}
	if len(resultPayload.SampleFlows) != 1 {
		t.Errorf("SampleFlows length = %d, want 1", len(resultPayload.SampleFlows))
	}
}

func TestWorker_RunAndReport_WithSaaSClient(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "worker-test-*")
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

	engine := NewEngine(EngineConfig{
		StorageManager: mgr,
		Logger:         logr.Discard(),
	})

	// Create mock SaaS server
	var resultReceived bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/operator/simulation/results" {
			resultReceived = true
			resp := saas.SubmitSimulationResultResponse{
				Success:      true,
				SimulationID: "run-and-report",
			}
			json.NewEncoder(w).Encode(resp)
		}
	}))
	defer server.Close()

	client := saas.NewClient(server.URL, "test-token", "test-cluster", logr.Discard())

	worker := NewWorker(WorkerConfig{
		Engine:       engine,
		SaaSClient:   client,
		PollInterval: 100 * time.Millisecond,
		Logger:       logr.Discard(),
	})

	ctx := context.Background()
	now := time.Now()
	req := &SimulationRequest{
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
		StartTime:  now.Add(-1 * time.Hour),
		EndTime:    now,
	}

	resp, err := worker.RunAndReport(ctx, req)
	if err != nil {
		t.Fatalf("RunAndReport() error = %v", err)
	}

	if resp == nil {
		t.Fatal("RunAndReport() returned nil response")
	}

	if !resultReceived {
		t.Error("Expected result to be submitted to SaaS")
	}
}
