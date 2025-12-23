package aggregator

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-logr/logr"

	"github.com/policy-hub/operator/internal/telemetry/models"
)

func TestNewSaaSSender(t *testing.T) {
	sender := NewSaaSSender(SaaSSenderConfig{
		Endpoint:  "https://api.example.com/telemetry",
		APIKey:    "test-api-key",
		ClusterID: "cluster-123",
		NodeName:  "test-node",
		Logger:    logr.Discard(),
	})

	if sender == nil {
		t.Fatal("NewSaaSSender() returned nil")
	}
	if sender.endpoint != "https://api.example.com/telemetry" {
		t.Errorf("endpoint = %s, want https://api.example.com/telemetry", sender.endpoint)
	}
	if sender.apiKey != "test-api-key" {
		t.Errorf("apiKey = %s, want test-api-key", sender.apiKey)
	}
	if sender.clusterID != "cluster-123" {
		t.Errorf("clusterID = %s, want cluster-123", sender.clusterID)
	}
	if sender.summarizer == nil {
		t.Error("summarizer should not be nil")
	}
}

func TestNewSaaSSender_Defaults(t *testing.T) {
	sender := NewSaaSSender(SaaSSenderConfig{
		Endpoint: "https://api.example.com/telemetry",
		Logger:   logr.Discard(),
	})

	if sender.sendInterval != time.Minute {
		t.Errorf("sendInterval = %v, want 1m", sender.sendInterval)
	}
	if sender.maxRetries != 3 {
		t.Errorf("maxRetries = %d, want 3", sender.maxRetries)
	}
	if sender.retryInterval != 5*time.Second {
		t.Errorf("retryInterval = %v, want 5s", sender.retryInterval)
	}
}

func TestNewSaaSSender_CustomConfig(t *testing.T) {
	sender := NewSaaSSender(SaaSSenderConfig{
		Endpoint:      "https://api.example.com/telemetry",
		SendInterval:  30 * time.Second,
		MaxRetries:    5,
		RetryInterval: 10 * time.Second,
		Timeout:       60 * time.Second,
		Logger:        logr.Discard(),
	})

	if sender.sendInterval != 30*time.Second {
		t.Errorf("sendInterval = %v, want 30s", sender.sendInterval)
	}
	if sender.maxRetries != 5 {
		t.Errorf("maxRetries = %d, want 5", sender.maxRetries)
	}
	if sender.retryInterval != 10*time.Second {
		t.Errorf("retryInterval = %v, want 10s", sender.retryInterval)
	}
}

func TestSaaSSender_IsEnabled(t *testing.T) {
	tests := []struct {
		name     string
		endpoint string
		expected bool
	}{
		{"with endpoint", "https://api.example.com", true},
		{"empty endpoint", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sender := NewSaaSSender(SaaSSenderConfig{
				Endpoint: tt.endpoint,
				Logger:   logr.Discard(),
			})

			if sender.IsEnabled() != tt.expected {
				t.Errorf("IsEnabled() = %v, want %v", sender.IsEnabled(), tt.expected)
			}
		})
	}
}

func TestSaaSSender_AddEvent(t *testing.T) {
	sender := NewSaaSSender(SaaSSenderConfig{
		Endpoint: "https://api.example.com/telemetry",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	event := &models.TelemetryEvent{
		Timestamp:    time.Now(),
		EventType:    models.EventTypeFlow,
		SrcNamespace: "default",
		DstNamespace: "production",
		Protocol:     "TCP",
		Verdict:      models.VerdictAllowed,
	}

	sender.AddEvent(event)

	stats := sender.GetStats()
	if stats.PendingFlows != 1 {
		t.Errorf("PendingFlows = %d, want 1", stats.PendingFlows)
	}
}

func TestSaaSSender_GetStats_Initial(t *testing.T) {
	sender := NewSaaSSender(SaaSSenderConfig{
		Endpoint: "https://api.example.com/telemetry",
		Logger:   logr.Discard(),
	})

	stats := sender.GetStats()

	if stats.TotalSent != 0 {
		t.Errorf("TotalSent = %d, want 0", stats.TotalSent)
	}
	if stats.TotalFailed != 0 {
		t.Errorf("TotalFailed = %d, want 0", stats.TotalFailed)
	}
	if stats.LastSendSuccess {
		t.Error("LastSendSuccess should be false initially")
	}
}

func TestSaaSSender_DoSend_Success(t *testing.T) {
	var receivedClusterID string
	var receivedBody []byte

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedClusterID = r.Header.Get("X-Cluster-ID")
		receivedBody, _ = io.ReadAll(r.Body)

		if r.Header.Get("Content-Type") != "application/json" {
			t.Error("Content-Type should be application/json")
		}
		if r.Header.Get("Authorization") != "Bearer test-api-key" {
			t.Error("Authorization header incorrect")
		}

		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	sender := NewSaaSSender(SaaSSenderConfig{
		Endpoint:  server.URL,
		APIKey:    "test-api-key",
		ClusterID: "cluster-123",
		NodeName:  "test-node",
		Logger:    logr.Discard(),
	})

	aggregates := &models.AggregatedTelemetry{
		Timestamp: time.Now(),
		FlowSummaries: []models.FlowSummary{
			{
				NodeName:     "test-node",
				SrcNamespace: "default",
				DstNamespace: "production",
				TotalFlows:   100,
			},
		},
	}

	err := sender.doSend(context.Background(), aggregates)
	if err != nil {
		t.Errorf("doSend() error = %v", err)
	}

	if receivedClusterID != "cluster-123" {
		t.Errorf("Received X-Cluster-ID = %s, want cluster-123", receivedClusterID)
	}

	// Verify body is valid JSON
	var received models.AggregatedTelemetry
	if err := json.Unmarshal(receivedBody, &received); err != nil {
		t.Errorf("Failed to unmarshal request body: %v", err)
	}
}

func TestSaaSSender_DoSend_Error(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("Internal Server Error"))
	}))
	defer server.Close()

	sender := NewSaaSSender(SaaSSenderConfig{
		Endpoint: server.URL,
		Logger:   logr.Discard(),
	})

	aggregates := &models.AggregatedTelemetry{
		Timestamp: time.Now(),
	}

	err := sender.doSend(context.Background(), aggregates)
	if err == nil {
		t.Error("doSend() should return error for 500 response")
	}
}

func TestSaaSSender_DoSend_BadRequest(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte("Bad Request: invalid payload"))
	}))
	defer server.Close()

	sender := NewSaaSSender(SaaSSenderConfig{
		Endpoint: server.URL,
		Logger:   logr.Discard(),
	})

	aggregates := &models.AggregatedTelemetry{
		Timestamp: time.Now(),
	}

	err := sender.doSend(context.Background(), aggregates)
	if err == nil {
		t.Error("doSend() should return error for 400 response")
	}
}

func TestSaaSSender_ForceFlush_Empty(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("Server should not be called for empty flush")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	sender := NewSaaSSender(SaaSSenderConfig{
		Endpoint: server.URL,
		Logger:   logr.Discard(),
	})

	// ForceFlush with no events should not call server
	err := sender.ForceFlush(context.Background())
	if err != nil {
		t.Errorf("ForceFlush() error = %v", err)
	}
}

func TestSaaSSender_ForceFlush_WithEvents(t *testing.T) {
	requestReceived := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestReceived = true
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	sender := NewSaaSSender(SaaSSenderConfig{
		Endpoint:  server.URL,
		ClusterID: "cluster-123",
		NodeName:  "test-node",
		Logger:    logr.Discard(),
	})

	// Add an event
	sender.AddEvent(&models.TelemetryEvent{
		Timestamp:    time.Now(),
		EventType:    models.EventTypeFlow,
		SrcNamespace: "default",
		DstNamespace: "production",
		Protocol:     "TCP",
		Verdict:      models.VerdictAllowed,
	})

	err := sender.ForceFlush(context.Background())
	if err != nil {
		t.Errorf("ForceFlush() error = %v", err)
	}

	if !requestReceived {
		t.Error("Server should have received request")
	}
}

func TestSaaSSender_Start_NoEndpoint(t *testing.T) {
	sender := NewSaaSSender(SaaSSenderConfig{
		Endpoint: "",
		Logger:   logr.Discard(),
	})

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	// Start should return immediately when no endpoint configured
	done := make(chan struct{})
	go func() {
		sender.Start(ctx)
		close(done)
	}()

	select {
	case <-done:
		// Success - Start returned without blocking
	case <-time.After(200 * time.Millisecond):
		t.Error("Start() should return immediately when no endpoint configured")
	}
}

func TestSaaSSender_Start_ContextCancellation(t *testing.T) {
	var requestCount int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requestCount, 1)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	sender := NewSaaSSender(SaaSSenderConfig{
		Endpoint:     server.URL,
		SendInterval: 50 * time.Millisecond,
		NodeName:     "test-node",
		Logger:       logr.Discard(),
	})

	// Add an event
	sender.AddEvent(&models.TelemetryEvent{
		Timestamp:    time.Now(),
		EventType:    models.EventTypeFlow,
		SrcNamespace: "default",
		DstNamespace: "production",
		Protocol:     "TCP",
		Verdict:      models.VerdictAllowed,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()

	done := make(chan struct{})
	go func() {
		sender.Start(ctx)
		close(done)
	}()

	// Wait for Start to complete
	<-done

	// Should have sent at least once (could be more depending on timing)
	count := atomic.LoadInt32(&requestCount)
	if count < 1 {
		t.Errorf("Expected at least 1 request, got %d", count)
	}
}

func TestSaaSSender_SendAggregates_Retries(t *testing.T) {
	var requestCount int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count := atomic.AddInt32(&requestCount, 1)
		if count < 3 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	sender := NewSaaSSender(SaaSSenderConfig{
		Endpoint:      server.URL,
		MaxRetries:    5,
		RetryInterval: 10 * time.Millisecond,
		NodeName:      "test-node",
		Logger:        logr.Discard(),
	})

	// Add an event
	sender.AddEvent(&models.TelemetryEvent{
		Timestamp:    time.Now(),
		EventType:    models.EventTypeFlow,
		SrcNamespace: "default",
		DstNamespace: "production",
		Protocol:     "TCP",
		Verdict:      models.VerdictAllowed,
	})

	// Use sendAggregates which has retry logic (called from Start loop)
	sender.sendAggregates(context.Background())

	count := atomic.LoadInt32(&requestCount)
	if count != 3 {
		t.Errorf("Expected 3 requests (2 failures + 1 success), got %d", count)
	}

	stats := sender.GetStats()
	if stats.TotalSent != 1 {
		t.Errorf("TotalSent = %d, want 1", stats.TotalSent)
	}
}

func TestSaaSSender_SendAggregates_AllRetriesFail(t *testing.T) {
	var requestCount int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requestCount, 1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	sender := NewSaaSSender(SaaSSenderConfig{
		Endpoint:      server.URL,
		MaxRetries:    2,
		RetryInterval: 10 * time.Millisecond,
		NodeName:      "test-node",
		Logger:        logr.Discard(),
	})

	// Add an event
	sender.AddEvent(&models.TelemetryEvent{
		Timestamp:    time.Now(),
		EventType:    models.EventTypeFlow,
		SrcNamespace: "default",
		DstNamespace: "production",
		Protocol:     "TCP",
		Verdict:      models.VerdictAllowed,
	})

	// Use sendAggregates which has retry logic
	sender.sendAggregates(context.Background())

	count := atomic.LoadInt32(&requestCount)
	// 1 initial + 2 retries = 3 requests
	if count != 3 {
		t.Errorf("Expected 3 requests (1 initial + 2 retries), got %d", count)
	}

	stats := sender.GetStats()
	if stats.TotalFailed != 1 {
		t.Errorf("TotalFailed = %d, want 1", stats.TotalFailed)
	}
	if stats.TotalSent != 0 {
		t.Errorf("TotalSent = %d, want 0", stats.TotalSent)
	}
}

func TestSaaSSenderStats_Fields(t *testing.T) {
	now := time.Now()
	stats := SaaSSenderStats{
		TotalSent:            100,
		TotalFailed:          5,
		LastSendTime:         now,
		LastSendSuccess:      true,
		PendingFlows:         10,
		PendingProcessEvents: 5,
		WindowStart:          now.Add(-1 * time.Minute),
		WindowEnd:            now,
	}

	if stats.TotalSent != 100 {
		t.Errorf("TotalSent = %d, want 100", stats.TotalSent)
	}
	if stats.TotalFailed != 5 {
		t.Errorf("TotalFailed = %d, want 5", stats.TotalFailed)
	}
	if !stats.LastSendSuccess {
		t.Error("LastSendSuccess should be true")
	}
	if stats.PendingFlows != 10 {
		t.Errorf("PendingFlows = %d, want 10", stats.PendingFlows)
	}
	if stats.PendingProcessEvents != 5 {
		t.Errorf("PendingProcessEvents = %d, want 5", stats.PendingProcessEvents)
	}
}

func TestNewHTTPSubmitter(t *testing.T) {
	submitter := NewHTTPSubmitter(
		"https://api.example.com/telemetry",
		"test-api-key",
		"cluster-123",
		30*time.Second,
	)

	if submitter == nil {
		t.Fatal("NewHTTPSubmitter() returned nil")
	}
	if submitter.endpoint != "https://api.example.com/telemetry" {
		t.Errorf("endpoint = %s, want https://api.example.com/telemetry", submitter.endpoint)
	}
	if submitter.apiKey != "test-api-key" {
		t.Errorf("apiKey = %s, want test-api-key", submitter.apiKey)
	}
	if submitter.clusterID != "cluster-123" {
		t.Errorf("clusterID = %s, want cluster-123", submitter.clusterID)
	}
}

func TestNewHTTPSubmitter_DefaultTimeout(t *testing.T) {
	submitter := NewHTTPSubmitter(
		"https://api.example.com/telemetry",
		"test-api-key",
		"cluster-123",
		0, // Zero timeout should use default
	)

	if submitter.httpClient.Timeout != 30*time.Second {
		t.Errorf("Timeout = %v, want 30s", submitter.httpClient.Timeout)
	}
}

func TestHTTPSubmitter_SubmitAggregates_NoEndpoint(t *testing.T) {
	submitter := NewHTTPSubmitter("", "api-key", "cluster-123", 0)

	err := submitter.SubmitAggregates(context.Background(), &models.AggregatedTelemetry{})
	if err != nil {
		t.Errorf("SubmitAggregates() with no endpoint should return nil, got %v", err)
	}
}

func TestHTTPSubmitter_SubmitAggregates_Success(t *testing.T) {
	var receivedHeaders http.Header
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedHeaders = r.Header
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	submitter := NewHTTPSubmitter(server.URL, "test-api-key", "cluster-123", 0)

	aggregates := &models.AggregatedTelemetry{
		Timestamp: time.Now(),
		FlowSummaries: []models.FlowSummary{
			{NodeName: "test-node", TotalFlows: 100},
		},
	}

	err := submitter.SubmitAggregates(context.Background(), aggregates)
	if err != nil {
		t.Errorf("SubmitAggregates() error = %v", err)
	}

	if receivedHeaders.Get("Content-Type") != "application/json" {
		t.Error("Content-Type should be application/json")
	}
	if receivedHeaders.Get("Authorization") != "Bearer test-api-key" {
		t.Error("Authorization header incorrect")
	}
	if receivedHeaders.Get("X-Cluster-ID") != "cluster-123" {
		t.Error("X-Cluster-ID header incorrect")
	}
}

func TestHTTPSubmitter_SubmitAggregates_Error(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte("Forbidden"))
	}))
	defer server.Close()

	submitter := NewHTTPSubmitter(server.URL, "test-api-key", "cluster-123", 0)

	aggregates := &models.AggregatedTelemetry{Timestamp: time.Now()}

	err := submitter.SubmitAggregates(context.Background(), aggregates)
	if err == nil {
		t.Error("SubmitAggregates() should return error for 403 response")
	}
}

func TestAggregateSubmitter_Interface(t *testing.T) {
	// Verify HTTPSubmitter implements AggregateSubmitter
	var _ AggregateSubmitter = (*HTTPSubmitter)(nil)
}
