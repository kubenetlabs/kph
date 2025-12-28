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
)

// Reporter sends validation data to the SaaS platform
type Reporter struct {
	endpoint     string
	apiKey       string
	clusterID    string
	httpClient   *http.Client
	log          logr.Logger

	// Aggregation state
	mu            sync.Mutex
	currentHour   time.Time
	allowedCount  int64
	blockedCount  int64
	noPolicyCount int64
	coverageGaps  map[string]*CoverageGap  // key: src/dst/port
	topBlocked    map[string]*BlockedFlow  // key: src/dst/policy
	recentEvents  []ValidationEvent        // Sample of recent events
	maxEvents     int
	eventCounter  int64
	sampleRate    int

	// Stats
	totalSent   int64
	totalFailed int64
}

// ReporterConfig contains configuration for the reporter
type ReporterConfig struct {
	Endpoint    string
	APIKey      string
	ClusterID   string
	MaxEvents   int
	SampleRate  int
	Logger      logr.Logger
}

// NewReporter creates a new validation reporter
func NewReporter(cfg ReporterConfig) *Reporter {
	if cfg.MaxEvents == 0 {
		cfg.MaxEvents = 100
	}
	if cfg.SampleRate == 0 {
		cfg.SampleRate = 1 // Sample all events by default
	}

	return &Reporter{
		endpoint:     cfg.Endpoint + "/api/operator/validation",
		apiKey:       cfg.APIKey,
		clusterID:    cfg.ClusterID,
		httpClient:   &http.Client{Timeout: 30 * time.Second},
		log:          cfg.Logger.WithName("validation-reporter"),
		currentHour:  truncateToHour(time.Now()),
		coverageGaps: make(map[string]*CoverageGap),
		topBlocked:   make(map[string]*BlockedFlow),
		recentEvents: make([]ValidationEvent, 0, cfg.MaxEvents),
		maxEvents:    cfg.MaxEvents,
		sampleRate:   cfg.SampleRate,
	}
}

// Record records a validation result
func (r *Reporter) Record(result *ValidationResult) {
	r.mu.Lock()
	defer r.mu.Unlock()

	// Check if we need to roll to a new hour
	currentHour := truncateToHour(result.Timestamp)
	if !currentHour.Equal(r.currentHour) {
		// New hour - the old data will be flushed by the flush goroutine
		r.currentHour = currentHour
	}

	// Update counts
	switch result.Verdict {
	case VerdictAllowed:
		r.allowedCount++
	case VerdictBlocked:
		r.blockedCount++
		// Track top blocked
		key := fmt.Sprintf("%s/%s/%s/%s", result.SrcNamespace, result.SrcPodName, result.DstNamespace, result.MatchedPolicy)
		if bf, ok := r.topBlocked[key]; ok {
			bf.Count++
		} else {
			r.topBlocked[key] = &BlockedFlow{
				SrcNamespace: result.SrcNamespace,
				SrcPodName:   result.SrcPodName,
				DstNamespace: result.DstNamespace,
				DstPodName:   result.DstPodName,
				DstPort:      int(result.DstPort),
				Policy:       result.MatchedPolicy,
				Count:        1,
			}
		}
	case VerdictNoPolicy:
		r.noPolicyCount++
		// Track coverage gaps
		key := fmt.Sprintf("%s/%s/%s/%s/%d", result.SrcNamespace, result.SrcPodName, result.DstNamespace, result.DstPodName, result.DstPort)
		if cg, ok := r.coverageGaps[key]; ok {
			cg.Count++
		} else {
			r.coverageGaps[key] = &CoverageGap{
				SrcNamespace: result.SrcNamespace,
				SrcPodName:   result.SrcPodName,
				DstNamespace: result.DstNamespace,
				DstPodName:   result.DstPodName,
				DstPort:      int(result.DstPort),
				Count:        1,
			}
		}
	}

	// Sample events
	r.eventCounter++
	if r.sampleRate == 1 || r.eventCounter%int64(r.sampleRate) == 0 {
		if len(r.recentEvents) < r.maxEvents {
			r.recentEvents = append(r.recentEvents, ValidationEvent{
				Timestamp:     result.Timestamp,
				Verdict:       string(result.Verdict),
				SrcNamespace:  result.SrcNamespace,
				SrcPodName:    result.SrcPodName,
				SrcLabels:     result.SrcLabels,
				DstNamespace:  result.DstNamespace,
				DstPodName:    result.DstPodName,
				DstLabels:     result.DstLabels,
				DstPort:       int(result.DstPort),
				Protocol:      result.Protocol,
				MatchedPolicy: result.MatchedPolicy,
				Reason:        result.Reason,
			})
		}
	}
}

// Flush sends accumulated data to SaaS and resets counters
func (r *Reporter) Flush(ctx context.Context) error {
	r.mu.Lock()

	// Nothing to send
	if r.allowedCount == 0 && r.blockedCount == 0 && r.noPolicyCount == 0 {
		r.mu.Unlock()
		return nil
	}

	// Build summary
	summary := ValidationSummary{
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

	// Add top blocked flows (limit to 20)
	for _, bf := range r.topBlocked {
		summary.TopBlocked = append(summary.TopBlocked, *bf)
		if len(summary.TopBlocked) >= 20 {
			break
		}
	}

	// Copy events
	events := make([]ValidationEvent, len(r.recentEvents))
	copy(events, r.recentEvents)

	// Reset state
	r.allowedCount = 0
	r.blockedCount = 0
	r.noPolicyCount = 0
	r.coverageGaps = make(map[string]*CoverageGap)
	r.topBlocked = make(map[string]*BlockedFlow)
	r.recentEvents = r.recentEvents[:0]

	r.mu.Unlock()

	// Send to SaaS
	payload := ValidationIngestion{
		Summaries: []ValidationSummary{summary},
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

	r.log.Info("Flushed validation data",
		"allowed", summary.AllowedCount,
		"blocked", summary.BlockedCount,
		"noPolicy", summary.NoPolicyCount,
		"events", len(events),
	)

	return nil
}

// send sends the payload to the SaaS API
func (r *Reporter) send(ctx context.Context, payload ValidationIngestion) error {
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
func (r *Reporter) GetStats() (sent, failed int64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.totalSent, r.totalFailed
}

// truncateToHour truncates a time to the start of the hour
func truncateToHour(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), 0, 0, 0, t.Location())
}
