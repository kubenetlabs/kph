package aggregator

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/go-logr/logr"

	"github.com/policy-hub/operator/internal/telemetry/models"
)

// SaaSSender sends aggregated telemetry to the SaaS platform.
type SaaSSender struct {
	endpoint    string
	apiKey      string
	clusterID   string
	httpClient  *http.Client
	log         logr.Logger

	// Summarizer for aggregation
	summarizer *Summarizer

	// Send interval
	sendInterval time.Duration

	// Retry configuration
	maxRetries    int
	retryInterval time.Duration

	// Metrics
	mu              sync.RWMutex
	totalSent       int64
	totalFailed     int64
	lastSendTime    time.Time
	lastSendSuccess bool
}

// SaaSSenderConfig contains configuration for the SaaS sender.
type SaaSSenderConfig struct {
	// Endpoint is the SaaS API endpoint for telemetry aggregates
	Endpoint string
	// APIKey is the authentication key
	APIKey string
	// ClusterID is the unique cluster identifier
	ClusterID string
	// SendInterval is how often to send aggregates (default: 1 minute)
	SendInterval time.Duration
	// MaxRetries is the maximum number of retry attempts (default: 3)
	MaxRetries int
	// RetryInterval is the delay between retries (default: 5 seconds)
	RetryInterval time.Duration
	// Timeout for HTTP requests (default: 30 seconds)
	Timeout time.Duration
	// NodeName for the summarizer
	NodeName string
	// Logger for logging
	Logger logr.Logger
}

// NewSaaSSender creates a new SaaS sender.
func NewSaaSSender(cfg SaaSSenderConfig) *SaaSSender {
	sendInterval := cfg.SendInterval
	if sendInterval <= 0 {
		sendInterval = time.Minute
	}

	maxRetries := cfg.MaxRetries
	if maxRetries <= 0 {
		maxRetries = 3
	}

	retryInterval := cfg.RetryInterval
	if retryInterval <= 0 {
		retryInterval = 5 * time.Second
	}

	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 30 * time.Second
	}

	return &SaaSSender{
		endpoint:      cfg.Endpoint,
		apiKey:        cfg.APIKey,
		clusterID:     cfg.ClusterID,
		sendInterval:  sendInterval,
		maxRetries:    maxRetries,
		retryInterval: retryInterval,
		log:           cfg.Logger.WithName("saas-sender"),
		httpClient: &http.Client{
			Timeout: timeout,
		},
		summarizer: NewSummarizer(SummarizerConfig{
			NodeName: cfg.NodeName,
			Logger:   cfg.Logger,
		}),
	}
}

// AddEvent adds an event to the summarizer for aggregation.
func (s *SaaSSender) AddEvent(event *models.TelemetryEvent) {
	s.summarizer.AddEvent(event)
}

// Start begins the periodic sending loop.
func (s *SaaSSender) Start(ctx context.Context) {
	if s.endpoint == "" {
		s.log.Info("SaaS sender disabled (no endpoint configured)")
		return
	}

	s.log.Info("Starting SaaS sender",
		"endpoint", s.endpoint,
		"interval", s.sendInterval,
		"clusterID", s.clusterID,
	)

	ticker := time.NewTicker(s.sendInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			s.log.Info("SaaS sender stopping, sending final aggregates")
			s.sendAggregates(context.Background()) // Use background context for final send
			return
		case <-ticker.C:
			s.sendAggregates(ctx)
		}
	}
}

// sendAggregates flushes the summarizer and sends to SaaS.
func (s *SaaSSender) sendAggregates(ctx context.Context) {
	aggregates := s.summarizer.Flush()
	if aggregates == nil {
		s.log.V(1).Info("No aggregates to send")
		return
	}

	// Set cluster ID
	aggregates.ClusterID = s.clusterID

	// Send with retries
	var lastErr error
	for attempt := 0; attempt <= s.maxRetries; attempt++ {
		if attempt > 0 {
			s.log.V(1).Info("Retrying send", "attempt", attempt)
			select {
			case <-ctx.Done():
				return
			case <-time.After(s.retryInterval):
			}
		}

		err := s.doSend(ctx, aggregates)
		if err == nil {
			s.mu.Lock()
			s.totalSent++
			s.lastSendTime = time.Now()
			s.lastSendSuccess = true
			s.mu.Unlock()

			s.log.V(1).Info("Sent aggregates to SaaS",
				"flowSummaries", len(aggregates.FlowSummaries),
				"processSummaries", len(aggregates.ProcessSummaries),
			)
			return
		}

		lastErr = err
		s.log.Error(err, "Failed to send aggregates", "attempt", attempt+1)
	}

	// All retries failed
	s.mu.Lock()
	s.totalFailed++
	s.lastSendSuccess = false
	s.mu.Unlock()

	s.log.Error(lastErr, "Failed to send aggregates after all retries")
}

// doSend performs the actual HTTP request.
func (s *SaaSSender) doSend(ctx context.Context, aggregates *models.AggregatedTelemetry) error {
	// Marshal to JSON
	body, err := json.Marshal(aggregates)
	if err != nil {
		return fmt.Errorf("failed to marshal aggregates: %w", err)
	}

	// Create request
	req, err := http.NewRequestWithContext(ctx, "POST", s.endpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.apiKey)
	req.Header.Set("X-Cluster-ID", s.clusterID)
	req.Header.Set("User-Agent", "PolicyHub-Collector/1.0")

	// Send request
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	// Check response
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}

	// Read error body
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
	return fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(respBody))
}

// GetStats returns sender statistics.
func (s *SaaSSender) GetStats() SaaSSenderStats {
	s.mu.RLock()
	defer s.mu.RUnlock()

	summarizerStats := s.summarizer.GetStats()

	return SaaSSenderStats{
		TotalSent:           s.totalSent,
		TotalFailed:         s.totalFailed,
		LastSendTime:        s.lastSendTime,
		LastSendSuccess:     s.lastSendSuccess,
		PendingFlows:        summarizerStats.FlowAggregations,
		PendingProcessEvents: summarizerStats.ProcessAggregations,
		WindowStart:         summarizerStats.WindowStart,
		WindowEnd:           summarizerStats.WindowEnd,
	}
}

// SaaSSenderStats contains sender statistics.
type SaaSSenderStats struct {
	TotalSent            int64
	TotalFailed          int64
	LastSendTime         time.Time
	LastSendSuccess      bool
	PendingFlows         int
	PendingProcessEvents int
	WindowStart          time.Time
	WindowEnd            time.Time
}

// ForceFlush immediately sends current aggregates.
func (s *SaaSSender) ForceFlush(ctx context.Context) error {
	aggregates := s.summarizer.Flush()
	if aggregates == nil {
		return nil
	}

	aggregates.ClusterID = s.clusterID
	return s.doSend(ctx, aggregates)
}

// IsEnabled returns whether the sender is configured.
func (s *SaaSSender) IsEnabled() bool {
	return s.endpoint != ""
}

// AggregateSubmitter is an interface for submitting aggregates.
// This allows for different implementations (HTTP, gRPC, etc.)
type AggregateSubmitter interface {
	SubmitAggregates(ctx context.Context, aggregates *models.AggregatedTelemetry) error
}

// HTTPSubmitter implements AggregateSubmitter using HTTP.
type HTTPSubmitter struct {
	endpoint   string
	apiKey     string
	clusterID  string
	httpClient *http.Client
}

// NewHTTPSubmitter creates a new HTTP submitter.
func NewHTTPSubmitter(endpoint, apiKey, clusterID string, timeout time.Duration) *HTTPSubmitter {
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	return &HTTPSubmitter{
		endpoint:  endpoint,
		apiKey:    apiKey,
		clusterID: clusterID,
		httpClient: &http.Client{
			Timeout: timeout,
		},
	}
}

// SubmitAggregates sends aggregates to the SaaS platform.
func (h *HTTPSubmitter) SubmitAggregates(ctx context.Context, aggregates *models.AggregatedTelemetry) error {
	if h.endpoint == "" {
		return nil
	}

	aggregates.ClusterID = h.clusterID

	body, err := json.Marshal(aggregates)
	if err != nil {
		return fmt.Errorf("failed to marshal aggregates: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", h.endpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+h.apiKey)
	req.Header.Set("X-Cluster-ID", h.clusterID)

	resp, err := h.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
	return fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(respBody))
}
