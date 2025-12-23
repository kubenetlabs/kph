package saas

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-logr/logr"
)

func TestNewClient(t *testing.T) {
	client := NewClient("https://api.example.com", "test-token", "cluster-123", logr.Discard())

	if client == nil {
		t.Fatal("NewClient() returned nil")
	}
	if client.endpoint != "https://api.example.com" {
		t.Errorf("endpoint = %s, want https://api.example.com", client.endpoint)
	}
	if client.apiToken != "test-token" {
		t.Errorf("apiToken = %s, want test-token", client.apiToken)
	}
	if client.clusterID != "cluster-123" {
		t.Errorf("clusterID = %s, want cluster-123", client.clusterID)
	}
	if client.httpClient == nil {
		t.Error("httpClient should not be nil")
	}
}

func TestNewBootstrapClient(t *testing.T) {
	client := NewBootstrapClient("https://api.example.com", "reg-token", logr.Discard())

	if client == nil {
		t.Fatal("NewBootstrapClient() returned nil")
	}
	if client.endpoint != "https://api.example.com" {
		t.Errorf("endpoint = %s, want https://api.example.com", client.endpoint)
	}
	if client.apiToken != "reg-token" {
		t.Errorf("apiToken = %s, want reg-token", client.apiToken)
	}
	if client.clusterID != "" {
		t.Errorf("clusterID = %s, want empty", client.clusterID)
	}
}

func TestClient_SetAPIToken(t *testing.T) {
	client := NewClient("https://api.example.com", "old-token", "cluster-123", logr.Discard())
	client.SetAPIToken("new-token")

	if client.apiToken != "new-token" {
		t.Errorf("apiToken = %s, want new-token", client.apiToken)
	}
}

func TestClient_SetClusterID(t *testing.T) {
	client := NewClient("https://api.example.com", "token", "", logr.Discard())
	client.SetClusterID("new-cluster-id")

	if client.clusterID != "new-cluster-id" {
		t.Errorf("clusterID = %s, want new-cluster-id", client.clusterID)
	}
}

func TestClient_GetClusterID(t *testing.T) {
	client := NewClient("https://api.example.com", "token", "my-cluster", logr.Discard())

	if client.GetClusterID() != "my-cluster" {
		t.Errorf("GetClusterID() = %s, want my-cluster", client.GetClusterID())
	}
}

func TestClient_SetHTTPClient(t *testing.T) {
	client := NewClient("https://api.example.com", "token", "cluster", logr.Discard())
	customClient := &http.Client{Timeout: 60 * time.Second}
	client.SetHTTPClient(customClient)

	if client.httpClient != customClient {
		t.Error("httpClient was not updated")
	}
}

func TestClient_Bootstrap_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/operator/bootstrap" {
			t.Errorf("Path = %s, want /api/operator/bootstrap", r.URL.Path)
		}
		if r.Method != "POST" {
			t.Errorf("Method = %s, want POST", r.Method)
		}
		if r.Header.Get("Authorization") != "Bearer reg-token" {
			t.Errorf("Authorization header = %s, want Bearer reg-token", r.Header.Get("Authorization"))
		}

		resp := BootstrapResponse{
			Success: true,
			Cluster: &BootstrapClusterInfo{
				ID:         "cluster-abc",
				Name:       "my-cluster",
				OperatorID: "op-123",
			},
			ClusterToken: "new-cluster-token",
			Config: &BootstrapConfig{
				SyncInterval:      30,
				HeartbeatInterval: 60,
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewBootstrapClient(server.URL, "reg-token", logr.Discard())

	ctx := context.Background()
	resp, err := client.Bootstrap(ctx, BootstrapRequest{
		ClusterName:     "my-cluster",
		OperatorVersion: "1.0.0",
	})

	if err != nil {
		t.Fatalf("Bootstrap() error = %v", err)
	}
	if !resp.Success {
		t.Error("Bootstrap() success = false, want true")
	}
	if resp.Cluster.ID != "cluster-abc" {
		t.Errorf("Cluster.ID = %s, want cluster-abc", resp.Cluster.ID)
	}
	if client.clusterID != "cluster-abc" {
		t.Errorf("clusterID was not updated, got %s", client.clusterID)
	}
	if client.apiToken != "new-cluster-token" {
		t.Errorf("apiToken was not updated, got %s", client.apiToken)
	}
}

func TestClient_Bootstrap_Failure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := BootstrapResponse{
			Success: false,
			Error:   "invalid registration token",
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewBootstrapClient(server.URL, "bad-token", logr.Discard())

	ctx := context.Background()
	_, err := client.Bootstrap(ctx, BootstrapRequest{ClusterName: "test"})

	if err == nil {
		t.Error("Bootstrap() should return error for failed response")
	}
}

func TestClient_Register_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/operator/register" {
			t.Errorf("Path = %s, want /api/operator/register", r.URL.Path)
		}

		resp := RegisterResponse{
			Success:           true,
			OperatorID:        "op-123",
			ClusterID:         "cluster-456",
			ClusterName:       "my-cluster",
			SyncInterval:      30,
			HeartbeatInterval: 60,
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "cluster", logr.Discard())

	ctx := context.Background()
	resp, err := client.Register(ctx, RegisterRequest{
		OperatorVersion: "1.0.0",
		NodeCount:       3,
	})

	if err != nil {
		t.Fatalf("Register() error = %v", err)
	}
	if !resp.Success {
		t.Error("Register() success = false, want true")
	}
	if resp.OperatorID != "op-123" {
		t.Errorf("OperatorID = %s, want op-123", resp.OperatorID)
	}
}

func TestClient_Register_Failure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := RegisterResponse{
			Success: false,
			Error:   "cluster not found",
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "cluster", logr.Discard())

	ctx := context.Background()
	_, err := client.Register(ctx, RegisterRequest{})

	if err == nil {
		t.Error("Register() should return error for failed response")
	}
}

func TestClient_Heartbeat_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/operator/heartbeat" {
			t.Errorf("Path = %s, want /api/operator/heartbeat", r.URL.Path)
		}

		resp := HeartbeatResponse{
			Success:              true,
			ClusterID:           "cluster-123",
			ClusterStatus:       "healthy",
			PendingPoliciesCount: 2,
			NextHeartbeat:        60,
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "cluster", logr.Discard())

	ctx := context.Background()
	resp, err := client.Heartbeat(ctx, HeartbeatRequest{
		Status:    "healthy",
		NodeCount: 3,
	})

	if err != nil {
		t.Fatalf("Heartbeat() error = %v", err)
	}
	if !resp.Success {
		t.Error("Heartbeat() success = false, want true")
	}
	if resp.PendingPoliciesCount != 2 {
		t.Errorf("PendingPoliciesCount = %d, want 2", resp.PendingPoliciesCount)
	}
}

func TestClient_Heartbeat_Failure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := HeartbeatResponse{
			Success: false,
			Error:   "unauthorized",
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "cluster", logr.Discard())

	ctx := context.Background()
	_, err := client.Heartbeat(ctx, HeartbeatRequest{})

	if err == nil {
		t.Error("Heartbeat() should return error for failed response")
	}
}

func TestClient_FetchPolicies_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/operator/policies" {
			t.Errorf("Path = %s, want /api/operator/policies", r.URL.Path)
		}
		if r.Method != "GET" {
			t.Errorf("Method = %s, want GET", r.Method)
		}

		resp := FetchPoliciesResponse{
			Success: true,
			Count:   2,
			Policies: []Policy{
				{
					ID:      "policy-1",
					Name:    "deny-all",
					Type:    "CILIUM_NETWORK",
					Status:  "PENDING",
					Content: "apiVersion: cilium.io/v2...",
					Version: 1,
				},
				{
					ID:      "policy-2",
					Name:    "allow-frontend",
					Type:    "CILIUM_NETWORK",
					Status:  "DEPLOYED",
					Content: "apiVersion: cilium.io/v2...",
					Version: 2,
				},
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "cluster", logr.Discard())

	ctx := context.Background()
	resp, err := client.FetchPolicies(ctx)

	if err != nil {
		t.Fatalf("FetchPolicies() error = %v", err)
	}
	if !resp.Success {
		t.Error("FetchPolicies() success = false, want true")
	}
	if resp.Count != 2 {
		t.Errorf("Count = %d, want 2", resp.Count)
	}
	if len(resp.Policies) != 2 {
		t.Errorf("len(Policies) = %d, want 2", len(resp.Policies))
	}
}

func TestClient_FetchPolicies_Failure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := FetchPoliciesResponse{
			Success: false,
			Error:   "not authorized",
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "cluster", logr.Discard())

	ctx := context.Background()
	_, err := client.FetchPolicies(ctx)

	if err == nil {
		t.Error("FetchPolicies() should return error for failed response")
	}
}

func TestClient_UpdatePolicyStatus_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/operator/policies/policy-123/status" {
			t.Errorf("Path = %s, want /api/operator/policies/policy-123/status", r.URL.Path)
		}
		if r.Method != "PATCH" {
			t.Errorf("Method = %s, want PATCH", r.Method)
		}

		resp := UpdatePolicyStatusResponse{
			Success:         true,
			PolicyID:        "policy-123",
			Status:          "DEPLOYED",
			DeployedVersion: 2,
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "cluster", logr.Discard())

	ctx := context.Background()
	resp, err := client.UpdatePolicyStatus(ctx, "policy-123", UpdatePolicyStatusRequest{
		Status:  "DEPLOYED",
		Version: 2,
		DeployedResources: []DeployedResource{
			{
				APIVersion: "cilium.io/v2",
				Kind:       "CiliumNetworkPolicy",
				Name:       "deny-all",
				Namespace:  "default",
			},
		},
	})

	if err != nil {
		t.Fatalf("UpdatePolicyStatus() error = %v", err)
	}
	if !resp.Success {
		t.Error("UpdatePolicyStatus() success = false, want true")
	}
	if resp.DeployedVersion != 2 {
		t.Errorf("DeployedVersion = %d, want 2", resp.DeployedVersion)
	}
}

func TestClient_UpdatePolicyStatus_Failure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := UpdatePolicyStatusResponse{
			Success: false,
			Error:   "policy not found",
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "cluster", logr.Discard())

	ctx := context.Background()
	_, err := client.UpdatePolicyStatus(ctx, "nonexistent", UpdatePolicyStatusRequest{Status: "DEPLOYED"})

	if err == nil {
		t.Error("UpdatePolicyStatus() should return error for failed response")
	}
}

func TestClient_SubmitFlows_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/operator/flows" {
			t.Errorf("Path = %s, want /api/operator/flows", r.URL.Path)
		}

		resp := SubmitFlowsResponse{
			Success:  true,
			Received: 3,
			Inserted: 3,
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "cluster", logr.Discard())

	ctx := context.Background()
	flows := []FlowRecord{
		{
			Timestamp:    time.Now().Format(time.RFC3339),
			SrcNamespace: "default",
			DstNamespace: "production",
			DstPort:      8080,
			Protocol:     "TCP",
			Verdict:      "ALLOWED",
		},
		{
			Timestamp:    time.Now().Format(time.RFC3339),
			SrcNamespace: "default",
			DstNamespace: "production",
			DstPort:      443,
			Protocol:     "TCP",
			Verdict:      "ALLOWED",
		},
		{
			Timestamp:    time.Now().Format(time.RFC3339),
			SrcNamespace: "kube-system",
			DstNamespace: "default",
			DstPort:      53,
			Protocol:     "UDP",
			Verdict:      "ALLOWED",
		},
	}

	resp, err := client.SubmitFlows(ctx, flows)

	if err != nil {
		t.Fatalf("SubmitFlows() error = %v", err)
	}
	if !resp.Success {
		t.Error("SubmitFlows() success = false, want true")
	}
	if resp.Received != 3 {
		t.Errorf("Received = %d, want 3", resp.Received)
	}
}

func TestClient_SubmitFlows_Empty(t *testing.T) {
	client := NewClient("https://api.example.com", "token", "cluster", logr.Discard())

	ctx := context.Background()
	resp, err := client.SubmitFlows(ctx, []FlowRecord{})

	if err != nil {
		t.Fatalf("SubmitFlows() error = %v", err)
	}
	if !resp.Success {
		t.Error("SubmitFlows() success = false, want true")
	}
	if resp.Received != 0 {
		t.Errorf("Received = %d, want 0", resp.Received)
	}
}

func TestClient_SubmitFlows_Failure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := SubmitFlowsResponse{
			Success: false,
			Error:   "rate limit exceeded",
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "cluster", logr.Discard())

	ctx := context.Background()
	_, err := client.SubmitFlows(ctx, []FlowRecord{{Timestamp: time.Now().Format(time.RFC3339)}})

	if err == nil {
		t.Error("SubmitFlows() should return error for failed response")
	}
}

func TestClient_SubmitAggregates_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/operator/telemetry/aggregates" {
			t.Errorf("Path = %s, want /api/operator/telemetry/aggregates", r.URL.Path)
		}

		resp := SubmitAggregatesResponse{
			Success:          true,
			FlowSummaries:    2,
			ProcessSummaries: 1,
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "cluster-123", logr.Discard())

	ctx := context.Background()
	now := time.Now()
	aggregates := &AggregatedTelemetry{
		Timestamp: now,
		FlowSummaries: []FlowSummary{
			{
				WindowStart:  now.Add(-1 * time.Minute),
				WindowEnd:    now,
				SrcNamespace: "default",
				DstNamespace: "production",
				TotalFlows:   100,
				AllowedFlows: 95,
				DeniedFlows:  5,
			},
			{
				WindowStart:  now.Add(-1 * time.Minute),
				WindowEnd:    now,
				SrcNamespace: "production",
				DstNamespace: "default",
				TotalFlows:   50,
				AllowedFlows: 50,
			},
		},
		ProcessSummaries: []ProcessSummary{
			{
				WindowStart:    now.Add(-1 * time.Minute),
				WindowEnd:      now,
				Namespace:      "default",
				TotalExecs:     10,
				UniqueBinaries: 5,
			},
		},
	}

	resp, err := client.SubmitAggregates(ctx, aggregates)

	if err != nil {
		t.Fatalf("SubmitAggregates() error = %v", err)
	}
	if !resp.Success {
		t.Error("SubmitAggregates() success = false, want true")
	}
	if resp.FlowSummaries != 2 {
		t.Errorf("FlowSummaries = %d, want 2", resp.FlowSummaries)
	}
}

func TestClient_SubmitAggregates_Nil(t *testing.T) {
	client := NewClient("https://api.example.com", "token", "cluster", logr.Discard())

	ctx := context.Background()
	resp, err := client.SubmitAggregates(ctx, nil)

	if err != nil {
		t.Fatalf("SubmitAggregates(nil) error = %v", err)
	}
	if !resp.Success {
		t.Error("SubmitAggregates(nil) success = false, want true")
	}
}

func TestClient_SubmitAggregates_SetsClusterID(t *testing.T) {
	var receivedClusterID string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req AggregatedTelemetry
		json.NewDecoder(r.Body).Decode(&req)
		receivedClusterID = req.ClusterID

		resp := SubmitAggregatesResponse{Success: true}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "my-cluster-id", logr.Discard())

	ctx := context.Background()
	aggregates := &AggregatedTelemetry{
		ClusterID: "", // Empty - should be set by client
		Timestamp: time.Now(),
	}

	_, err := client.SubmitAggregates(ctx, aggregates)
	if err != nil {
		t.Fatalf("SubmitAggregates() error = %v", err)
	}

	if receivedClusterID != "my-cluster-id" {
		t.Errorf("ClusterID = %s, want my-cluster-id", receivedClusterID)
	}
}

func TestClient_SubmitSimulationResult_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/operator/simulation/results" {
			t.Errorf("Path = %s, want /api/operator/simulation/results", r.URL.Path)
		}

		resp := SubmitSimulationResultResponse{
			Success:      true,
			SimulationID: "sim-123",
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "cluster", logr.Discard())

	ctx := context.Background()
	result := &SimulationResult{
		SimulationID:       "sim-123",
		PolicyContent:      "apiVersion: cilium.io/v2...",
		PolicyType:         "CILIUM_NETWORK",
		TotalFlowsAnalyzed: 100,
		AllowedCount:       80,
		DeniedCount:        20,
		WouldChangeCount:   10,
	}

	resp, err := client.SubmitSimulationResult(ctx, result)

	if err != nil {
		t.Fatalf("SubmitSimulationResult() error = %v", err)
	}
	if !resp.Success {
		t.Error("SubmitSimulationResult() success = false, want true")
	}
	if resp.SimulationID != "sim-123" {
		t.Errorf("SimulationID = %s, want sim-123", resp.SimulationID)
	}
}

func TestClient_SubmitSimulationResult_Nil(t *testing.T) {
	client := NewClient("https://api.example.com", "token", "cluster", logr.Discard())

	ctx := context.Background()
	resp, err := client.SubmitSimulationResult(ctx, nil)

	if err != nil {
		t.Fatalf("SubmitSimulationResult(nil) error = %v", err)
	}
	if !resp.Success {
		t.Error("SubmitSimulationResult(nil) success = false, want true")
	}
}

func TestClient_FetchPendingSimulations_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/operator/simulation/pending" {
			t.Errorf("Path = %s, want /api/operator/simulation/pending", r.URL.Path)
		}
		if r.Method != "GET" {
			t.Errorf("Method = %s, want GET", r.Method)
		}

		now := time.Now()
		resp := FetchPendingSimulationsResponse{
			Success: true,
			Simulations: []PendingSimulation{
				{
					SimulationID:  "sim-1",
					PolicyContent: "apiVersion: cilium.io/v2...",
					PolicyType:    "CILIUM_NETWORK",
					StartTime:     now.Add(-1 * time.Hour),
					EndTime:       now,
					Namespaces:    []string{"default"},
					RequestedAt:   now.Add(-1 * time.Minute),
				},
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "cluster", logr.Discard())

	ctx := context.Background()
	resp, err := client.FetchPendingSimulations(ctx)

	if err != nil {
		t.Fatalf("FetchPendingSimulations() error = %v", err)
	}
	if !resp.Success {
		t.Error("FetchPendingSimulations() success = false, want true")
	}
	if len(resp.Simulations) != 1 {
		t.Errorf("len(Simulations) = %d, want 1", len(resp.Simulations))
	}
}

func TestClient_FetchPendingSimulations_Empty(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := FetchPendingSimulationsResponse{
			Success:     true,
			Simulations: []PendingSimulation{},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "cluster", logr.Discard())

	ctx := context.Background()
	resp, err := client.FetchPendingSimulations(ctx)

	if err != nil {
		t.Fatalf("FetchPendingSimulations() error = %v", err)
	}
	if len(resp.Simulations) != 0 {
		t.Errorf("len(Simulations) = %d, want 0", len(resp.Simulations))
	}
}

func TestClient_doRequest_HTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("internal server error"))
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "cluster", logr.Discard())

	ctx := context.Background()
	_, err := client.FetchPolicies(ctx)

	if err == nil {
		t.Error("doRequest() should return error for non-2xx status")
	}
}

func TestClient_doRequest_NetworkError(t *testing.T) {
	// Use an invalid URL to trigger a network error
	client := NewClient("http://localhost:99999", "token", "cluster", logr.Discard())

	ctx := context.Background()
	_, err := client.FetchPolicies(ctx)

	if err == nil {
		t.Error("doRequest() should return error for network failure")
	}
}

func TestClient_doRequest_InvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("not valid json"))
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "cluster", logr.Discard())

	ctx := context.Background()
	_, err := client.FetchPolicies(ctx)

	if err == nil {
		t.Error("should return error for invalid JSON response")
	}
}

func TestClient_doRequest_ContextCancelled(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(100 * time.Millisecond)
		resp := FetchPoliciesResponse{Success: true}
		json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "cluster", logr.Discard())

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	_, err := client.FetchPolicies(ctx)

	if err == nil {
		t.Error("should return error for cancelled context")
	}
}

func TestFlowRecord_Fields(t *testing.T) {
	flow := FlowRecord{
		Timestamp:    "2024-01-15T10:00:00Z",
		SrcNamespace: "default",
		SrcPodName:   "frontend",
		SrcPodLabels: map[string]string{"app": "frontend"},
		SrcIP:        "10.0.0.1",
		SrcPort:      32000,
		DstNamespace: "production",
		DstPodName:   "backend",
		DstPodLabels: map[string]string{"app": "backend"},
		DstIP:        "10.0.0.2",
		DstPort:      8080,
		Protocol:     "TCP",
		L7Protocol:   "HTTP",
		HTTPMethod:   "GET",
		HTTPPath:     "/api/users",
		HTTPStatus:   200,
		Verdict:      "ALLOWED",
		BytesTotal:   1024,
		PacketsTotal: 10,
	}

	if flow.SrcNamespace != "default" {
		t.Errorf("SrcNamespace = %s, want default", flow.SrcNamespace)
	}
	if flow.DstPort != 8080 {
		t.Errorf("DstPort = %d, want 8080", flow.DstPort)
	}
	if flow.HTTPMethod != "GET" {
		t.Errorf("HTTPMethod = %s, want GET", flow.HTTPMethod)
	}
}

func TestPolicy_Fields(t *testing.T) {
	policy := Policy{
		ID:               "policy-123",
		Name:             "deny-all",
		Description:      "Deny all traffic",
		Type:             "CILIUM_NETWORK",
		Status:           "DEPLOYED",
		Content:          "apiVersion: cilium.io/v2...",
		TargetNamespaces: []string{"default", "production"},
		Version:          3,
		LastUpdated:      "2024-01-15T10:00:00Z",
	}

	if policy.ID != "policy-123" {
		t.Errorf("ID = %s, want policy-123", policy.ID)
	}
	if policy.Name != "deny-all" {
		t.Errorf("Name = %s, want deny-all", policy.Name)
	}
	if len(policy.TargetNamespaces) != 2 {
		t.Errorf("len(TargetNamespaces) = %d, want 2", len(policy.TargetNamespaces))
	}
}
