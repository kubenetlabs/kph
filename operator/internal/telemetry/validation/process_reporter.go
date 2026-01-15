package validation

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/go-logr/logr"

	"github.com/policy-hub/operator/internal/telemetry/models"
)

// ProcessValidationReporter sends process validation data to the SaaS platform
type ProcessValidationReporter struct {
	endpoint   string
	apiKey     string
	clusterID  string
	httpClient *http.Client
	log        logr.Logger

	// Aggregation state
	mu            sync.Mutex
	currentHour   time.Time
	allowedCount  int64
	blockedCount  int64
	noPolicyCount int64
	coverageGaps  map[string]*ProcessCoverageGap // key: namespace/pod/binary
	topBlocked    map[string]*BlockedProcess     // key: namespace/binary/policy
	recentEvents  []ProcessValidationEvent
	maxEvents     int
	eventCounter  int64
	sampleRate    int

	// Stats
	totalSent   int64
	totalFailed int64
}

// ProcessValidationReporterConfig contains configuration for the process reporter
type ProcessValidationReporterConfig struct {
	Endpoint   string
	APIKey     string
	ClusterID  string
	MaxEvents  int
	SampleRate int
	Logger     logr.Logger
}

// ProcessCoverageGap represents a process with no governing policy
type ProcessCoverageGap struct {
	Namespace string `json:"namespace"`
	PodName   string `json:"podName,omitempty"`
	Binary    string `json:"binary"`
	Count     int    `json:"count"`
}

// BlockedProcess represents a blocked process execution
type BlockedProcess struct {
	Namespace string `json:"namespace"`
	PodName   string `json:"podName,omitempty"`
	Binary    string `json:"binary"`
	Policy    string `json:"policy"`
	Count     int    `json:"count"`
}

// ProcessValidationEvent represents a single process validation event
type ProcessValidationEvent struct {
	Timestamp     time.Time `json:"timestamp"`
	Verdict       string    `json:"verdict"`
	Namespace     string    `json:"namespace"`
	PodName       string    `json:"podName,omitempty"`
	NodeName      string    `json:"nodeName,omitempty"`
	Binary        string    `json:"binary"`
	Arguments     string    `json:"arguments,omitempty"`
	ParentBinary  string    `json:"parentBinary,omitempty"`
	Syscall       string    `json:"syscall,omitempty"`
	FilePath      string    `json:"filePath,omitempty"`
	MatchedPolicy string    `json:"matchedPolicy,omitempty"`
	Action        string    `json:"action,omitempty"`
	Reason        string    `json:"reason,omitempty"`
}

// ProcessValidationSummary is the hourly summary of process validation
type ProcessValidationSummary struct {
	Hour          time.Time            `json:"hour"`
	AllowedCount  int64                `json:"allowedCount"`
	BlockedCount  int64                `json:"blockedCount"`
	NoPolicyCount int64                `json:"noPolicyCount"`
	TopBlocked    []BlockedProcess     `json:"topBlocked,omitempty"`
	CoverageGaps  []ProcessCoverageGap `json:"coverageGaps,omitempty"`
}

// ProcessValidationIngestion is the payload sent to SaaS
type ProcessValidationIngestion struct {
	Summaries []ProcessValidationSummary `json:"summaries,omitempty"`
	Events    []ProcessValidationEvent   `json:"events,omitempty"`
}

// NewProcessValidationReporter creates a new process validation reporter
func NewProcessValidationReporter(cfg ProcessValidationReporterConfig) *ProcessValidationReporter {
	if cfg.MaxEvents == 0 {
		cfg.MaxEvents = 100
	}
	if cfg.SampleRate == 0 {
		cfg.SampleRate = 1 // Sample all events by default
	}

	return &ProcessValidationReporter{
		endpoint:     cfg.Endpoint + "/api/operator/process-validation",
		apiKey:       cfg.APIKey,
		clusterID:    cfg.ClusterID,
		httpClient:   &http.Client{Timeout: 30 * time.Second},
		log:          cfg.Logger.WithName("process-validation-reporter"),
		currentHour:  truncateToHour(time.Now()),
		coverageGaps: make(map[string]*ProcessCoverageGap),
		topBlocked:   make(map[string]*BlockedProcess),
		recentEvents: make([]ProcessValidationEvent, 0, cfg.MaxEvents),
		maxEvents:    cfg.MaxEvents,
		sampleRate:   cfg.SampleRate,
	}
}

// RecordTetragonEvent records a Tetragon event for process validation
func (r *ProcessValidationReporter) RecordTetragonEvent(event *models.TelemetryEvent) {
	if event == nil || event.Source != models.SourceTetragon {
		return
	}

	// Only process events that are process executions or kprobes
	if event.EventType != models.EventTypeProcessExec &&
		event.EventType != models.EventTypeSyscall {
		return
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	// Check if we need to roll to a new hour
	currentHour := truncateToHour(event.Timestamp)
	if !currentHour.Equal(r.currentHour) {
		r.currentHour = currentHour
	}

	// Determine verdict based on action
	var verdict string
	switch event.Action {
	case "SIGKILL", "KPROBE_ACTION_SIGKILL":
		verdict = "BLOCKED"
		r.blockedCount++

		// Track top blocked
		policy := "unknown"
		if len(event.MatchedPolicies) > 0 {
			policy = event.MatchedPolicies[0]
		}
		key := fmt.Sprintf("%s/%s/%s", event.SrcNamespace, event.SrcBinary, policy)
		if bp, ok := r.topBlocked[key]; ok {
			bp.Count++
		} else {
			r.topBlocked[key] = &BlockedProcess{
				Namespace: event.SrcNamespace,
				PodName:   event.SrcPodName,
				Binary:    event.SrcBinary,
				Policy:    policy,
				Count:     1,
			}
		}

	case "OVERRIDE", "KPROBE_ACTION_OVERRIDE":
		verdict = "BLOCKED"
		r.blockedCount++

	case "":
		// No policy matched - this is a gap
		verdict = "NO_POLICY"
		r.noPolicyCount++

		// Track coverage gaps
		key := fmt.Sprintf("%s/%s/%s", event.SrcNamespace, event.SrcPodName, event.SrcBinary)
		if cg, ok := r.coverageGaps[key]; ok {
			cg.Count++
		} else {
			r.coverageGaps[key] = &ProcessCoverageGap{
				Namespace: event.SrcNamespace,
				PodName:   event.SrcPodName,
				Binary:    event.SrcBinary,
				Count:     1,
			}
		}

	default:
		// Allowed
		verdict = "ALLOWED"
		r.allowedCount++
	}

	// Build the event record
	matchedPolicy := ""
	if len(event.MatchedPolicies) > 0 {
		matchedPolicy = event.MatchedPolicies[0]
	}
	eventRecord := ProcessValidationEvent{
		Timestamp:     event.Timestamp,
		Verdict:       verdict,
		Namespace:     event.SrcNamespace,
		PodName:       event.SrcPodName,
		NodeName:      event.NodeName,
		Binary:        event.SrcBinary,
		Arguments:     event.SrcArguments,
		Syscall:       event.Syscall,
		FilePath:      event.FilePath,
		MatchedPolicy: matchedPolicy,
		Action:        event.Action,
	}

	// Always record blocked events (security-critical), sample others
	if verdict == "BLOCKED" {
		// Always record blocked events
		if len(r.recentEvents) < r.maxEvents {
			r.recentEvents = append(r.recentEvents, eventRecord)
		}
	} else {
		// Sample non-blocked events
		r.eventCounter++
		if r.sampleRate == 1 || r.eventCounter%int64(r.sampleRate) == 0 {
			if len(r.recentEvents) < r.maxEvents {
				r.recentEvents = append(r.recentEvents, eventRecord)
			}
		}
	}
}

// Flush sends accumulated data to SaaS and resets counters
func (r *ProcessValidationReporter) Flush(ctx context.Context) error {
	r.mu.Lock()

	// Nothing to send
	if r.allowedCount == 0 && r.blockedCount == 0 && r.noPolicyCount == 0 {
		r.mu.Unlock()
		return nil
	}

	// Build summary
	summary := ProcessValidationSummary{
		Hour:          r.currentHour,
		AllowedCount:  r.allowedCount,
		BlockedCount:  r.blockedCount,
		NoPolicyCount: r.noPolicyCount,
	}

	// Add top coverage gaps (limit to 20)
	for _, cg := range r.coverageGaps {
		summary.CoverageGaps = append(summary.CoverageGaps, *cg)
		if len(summary.CoverageGaps) >= 20 {
			break
		}
	}

	// Add top blocked processes (limit to 20)
	for _, bp := range r.topBlocked {
		summary.TopBlocked = append(summary.TopBlocked, *bp)
		if len(summary.TopBlocked) >= 20 {
			break
		}
	}

	// Copy events
	events := make([]ProcessValidationEvent, len(r.recentEvents))
	copy(events, r.recentEvents)

	// Reset state
	r.allowedCount = 0
	r.blockedCount = 0
	r.noPolicyCount = 0
	r.coverageGaps = make(map[string]*ProcessCoverageGap)
	r.topBlocked = make(map[string]*BlockedProcess)
	r.recentEvents = r.recentEvents[:0]

	r.mu.Unlock()

	// Send to SaaS
	payload := ProcessValidationIngestion{
		Summaries: []ProcessValidationSummary{summary},
		Events:    events,
	}

	if err := r.send(ctx, payload); err != nil {
		r.mu.Lock()
		r.totalFailed++
		r.mu.Unlock()
		return err
	}

	r.mu.Lock()
	r.totalSent++
	r.mu.Unlock()

	r.log.Info("Flushed process validation data",
		"allowed", summary.AllowedCount,
		"blocked", summary.BlockedCount,
		"noPolicy", summary.NoPolicyCount,
		"events", len(events),
		"coverageGaps", len(summary.CoverageGaps),
		"topBlocked", len(summary.TopBlocked),
	)

	return nil
}

// send sends the payload to the SaaS API
func (r *ProcessValidationReporter) send(ctx context.Context, payload ProcessValidationIngestion) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", r.endpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+r.apiKey)

	resp, err := r.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("API returned status %d", resp.StatusCode)
	}

	return nil
}

// GetStats returns reporter statistics
func (r *ProcessValidationReporter) GetStats() (sent, failed int64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.totalSent, r.totalFailed
}

// Start begins the periodic flush loop
func (r *ProcessValidationReporter) Start(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = time.Minute
	}

	r.log.Info("Starting process validation reporter", "endpoint", r.endpoint, "interval", interval)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			r.log.Info("Process validation reporter stopping, sending final data")
			_ = r.Flush(context.Background())
			return
		case <-ticker.C:
			if err := r.Flush(ctx); err != nil {
				r.log.Error(err, "Failed to flush process validation data")
			}
		}
	}
}
