// Package aggregator provides telemetry aggregation for SaaS sync.
package aggregator

import (
	"sort"
	"sync"
	"time"

	"github.com/go-logr/logr"

	"github.com/policy-hub/operator/internal/telemetry/models"
)

// Summarizer aggregates telemetry events into summaries for efficient SaaS sync.
type Summarizer struct {
	nodeName string
	log      logr.Logger

	// Current aggregation window
	mu            sync.Mutex
	windowStart   time.Time
	windowEnd     time.Time
	flowSummaries map[string]*flowAggregation
	procSummaries map[string]*processAggregation
}

// flowAggregation holds aggregated flow data for a unique flow key.
type flowAggregation struct {
	SrcNamespace string
	DstNamespace string
	SrcPodName   string
	DstPodName   string
	DstPort      uint32
	Protocol     string
	L7Type       string

	TotalFlows   int64
	AllowedFlows int64
	DeniedFlows  int64
	DroppedFlows int64
	TotalBytes   int64
	TotalPackets int64

	HTTPMethodCounts map[string]int64
	HTTPStatusCounts map[int32]int64
	PathCounts       map[string]int64
	DNSQueryCounts   map[string]int64
}

// processAggregation holds aggregated process data for a unique key.
type processAggregation struct {
	Namespace string
	PodName   string

	TotalExecs     int64
	BinaryCounts   map[string]int64
	SyscallCounts  map[string]int64
	FileOpCounts   map[string]int64
	ActionCounts   map[string]int64
}

// SummarizerConfig contains configuration for the summarizer.
type SummarizerConfig struct {
	// NodeName is the current node name
	NodeName string
	// Logger for logging
	Logger logr.Logger
}

// NewSummarizer creates a new summarizer.
func NewSummarizer(cfg SummarizerConfig) *Summarizer {
	now := time.Now().UTC()
	return &Summarizer{
		nodeName:      cfg.NodeName,
		log:           cfg.Logger.WithName("summarizer"),
		windowStart:   now,
		windowEnd:     now,
		flowSummaries: make(map[string]*flowAggregation),
		procSummaries: make(map[string]*processAggregation),
	}
}

// AddEvent adds an event to the current aggregation window.
func (s *Summarizer) AddEvent(event *models.TelemetryEvent) {
	if event == nil {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	// Update window end time
	if event.Timestamp.After(s.windowEnd) {
		s.windowEnd = event.Timestamp
	}
	if event.Timestamp.Before(s.windowStart) {
		s.windowStart = event.Timestamp
	}

	switch event.EventType {
	case models.EventTypeFlow:
		s.addFlowEvent(event)
	case models.EventTypeProcessExec, models.EventTypeSyscall, models.EventTypeFileAccess:
		s.addProcessEvent(event)
	}
}

// addFlowEvent aggregates a flow event.
func (s *Summarizer) addFlowEvent(event *models.TelemetryEvent) {
	key := s.flowKey(event)
	agg, exists := s.flowSummaries[key]
	if !exists {
		agg = &flowAggregation{
			SrcNamespace:     event.SrcNamespace,
			DstNamespace:     event.DstNamespace,
			SrcPodName:       event.SrcPodName,
			DstPodName:       event.DstPodName,
			DstPort:          event.DstPort,
			Protocol:         event.Protocol,
			L7Type:           event.L7Type,
			HTTPMethodCounts: make(map[string]int64),
			HTTPStatusCounts: make(map[int32]int64),
			PathCounts:       make(map[string]int64),
			DNSQueryCounts:   make(map[string]int64),
		}
		s.flowSummaries[key] = agg
	}

	// Update counts
	agg.TotalFlows++
	agg.TotalBytes += event.BytesTotal
	agg.TotalPackets += event.PacketsTotal

	switch event.Verdict {
	case models.VerdictAllowed:
		agg.AllowedFlows++
	case models.VerdictDenied:
		agg.DeniedFlows++
	case models.VerdictDropped:
		agg.DroppedFlows++
	}

	// HTTP details
	if event.HTTPMethod != "" {
		agg.HTTPMethodCounts[event.HTTPMethod]++
	}
	if event.HTTPStatus != 0 {
		agg.HTTPStatusCounts[event.HTTPStatus]++
	}
	if event.HTTPPath != "" {
		// Normalize path for aggregation (limit cardinality)
		path := normalizePath(event.HTTPPath)
		agg.PathCounts[path]++
	}

	// DNS details
	if event.DNSQuery != "" {
		agg.DNSQueryCounts[event.DNSQuery]++
	}
}

// addProcessEvent aggregates a process event.
func (s *Summarizer) addProcessEvent(event *models.TelemetryEvent) {
	key := s.processKey(event)
	agg, exists := s.procSummaries[key]
	if !exists {
		agg = &processAggregation{
			Namespace:     event.SrcNamespace,
			PodName:       event.SrcPodName,
			BinaryCounts:  make(map[string]int64),
			SyscallCounts: make(map[string]int64),
			FileOpCounts:  make(map[string]int64),
			ActionCounts:  make(map[string]int64),
		}
		s.procSummaries[key] = agg
	}

	switch event.EventType {
	case models.EventTypeProcessExec:
		agg.TotalExecs++
		if event.SrcBinary != "" {
			agg.BinaryCounts[event.SrcBinary]++
		}
	case models.EventTypeSyscall:
		if event.Syscall != "" {
			agg.SyscallCounts[event.Syscall]++
		}
	case models.EventTypeFileAccess:
		if event.FileOperation != "" {
			agg.FileOpCounts[event.FileOperation]++
		}
	}

	// Track enforcement actions
	if event.Action != "" && event.Verdict == models.VerdictDenied {
		agg.ActionCounts[event.Action]++
	}
}

// flowKey generates a unique key for flow aggregation.
func (s *Summarizer) flowKey(event *models.TelemetryEvent) string {
	return event.SrcNamespace + "|" + event.DstNamespace + "|" +
		event.Protocol + "|" + string(rune(event.DstPort)) + "|" + event.L7Type
}

// processKey generates a unique key for process aggregation.
func (s *Summarizer) processKey(event *models.TelemetryEvent) string {
	return event.SrcNamespace + "|" + event.SrcPodName
}

// Flush returns the current summaries and resets the aggregation window.
func (s *Summarizer) Flush() *models.AggregatedTelemetry {
	s.mu.Lock()
	defer s.mu.Unlock()

	if len(s.flowSummaries) == 0 && len(s.procSummaries) == 0 {
		return nil
	}

	result := &models.AggregatedTelemetry{
		Timestamp:        time.Now().UTC(),
		FlowSummaries:    s.buildFlowSummaries(),
		ProcessSummaries: s.buildProcessSummaries(),
	}

	// Reset for next window
	now := time.Now().UTC()
	s.windowStart = now
	s.windowEnd = now
	s.flowSummaries = make(map[string]*flowAggregation)
	s.procSummaries = make(map[string]*processAggregation)

	s.log.V(1).Info("Flushed summaries",
		"flowSummaries", len(result.FlowSummaries),
		"processSummaries", len(result.ProcessSummaries),
	)

	return result
}

// buildFlowSummaries converts internal aggregations to API format.
func (s *Summarizer) buildFlowSummaries() []models.FlowSummary {
	summaries := make([]models.FlowSummary, 0, len(s.flowSummaries))

	for _, agg := range s.flowSummaries {
		summary := models.FlowSummary{
			WindowStart:  s.windowStart,
			WindowEnd:    s.windowEnd,
			NodeName:     s.nodeName,
			SrcNamespace: agg.SrcNamespace,
			DstNamespace: agg.DstNamespace,
			SrcPodName:   agg.SrcPodName,
			DstPodName:   agg.DstPodName,
			DstPort:      agg.DstPort,
			Protocol:     agg.Protocol,
			L7Type:       agg.L7Type,
			TotalFlows:   agg.TotalFlows,
			AllowedFlows: agg.AllowedFlows,
			DeniedFlows:  agg.DeniedFlows,
			DroppedFlows: agg.DroppedFlows,
			TotalBytes:   agg.TotalBytes,
			TotalPackets: agg.TotalPackets,
		}

		// Include HTTP breakdown if present
		if len(agg.HTTPMethodCounts) > 0 {
			summary.HTTPMethodCounts = agg.HTTPMethodCounts
		}
		if len(agg.HTTPStatusCounts) > 0 {
			summary.HTTPStatusCounts = agg.HTTPStatusCounts
		}

		// Top paths (limit to 10)
		if len(agg.PathCounts) > 0 {
			summary.TopHTTPPaths = topN(agg.PathCounts, 10)
		}

		// Top DNS queries (limit to 10)
		if len(agg.DNSQueryCounts) > 0 {
			summary.TopDNSQueries = topDNSQueries(agg.DNSQueryCounts, 10)
		}

		summaries = append(summaries, summary)
	}

	return summaries
}

// buildProcessSummaries converts internal aggregations to API format.
func (s *Summarizer) buildProcessSummaries() []models.ProcessEventSummary {
	summaries := make([]models.ProcessEventSummary, 0, len(s.procSummaries))

	for _, agg := range s.procSummaries {
		summary := models.ProcessEventSummary{
			WindowStart:    s.windowStart,
			WindowEnd:      s.windowEnd,
			NodeName:       s.nodeName,
			Namespace:      agg.Namespace,
			PodName:        agg.PodName,
			TotalExecs:     agg.TotalExecs,
			UniqueBinaries: int64(len(agg.BinaryCounts)),
		}

		// Top binaries (limit to 10)
		if len(agg.BinaryCounts) > 0 {
			summary.TopBinaries = topBinaries(agg.BinaryCounts, 10)
		}

		// Syscall counts
		if len(agg.SyscallCounts) > 0 {
			summary.TotalSyscalls = sumCounts(agg.SyscallCounts)
			summary.SyscallCounts = agg.SyscallCounts
		}

		// File operation counts
		if len(agg.FileOpCounts) > 0 {
			summary.TotalFileAccess = sumCounts(agg.FileOpCounts)
			summary.FileOpCounts = agg.FileOpCounts
		}

		// Action counts (enforcement)
		if len(agg.ActionCounts) > 0 {
			summary.ActionCounts = agg.ActionCounts
		}

		summaries = append(summaries, summary)
	}

	return summaries
}

// GetStats returns current aggregation statistics.
func (s *Summarizer) GetStats() SummarizerStats {
	s.mu.Lock()
	defer s.mu.Unlock()

	return SummarizerStats{
		WindowStart:       s.windowStart,
		WindowEnd:         s.windowEnd,
		FlowAggregations:  len(s.flowSummaries),
		ProcessAggregations: len(s.procSummaries),
	}
}

// SummarizerStats contains summarizer statistics.
type SummarizerStats struct {
	WindowStart         time.Time
	WindowEnd           time.Time
	FlowAggregations    int
	ProcessAggregations int
}

// Helper functions

func normalizePath(path string) string {
	// Limit path length
	if len(path) > 100 {
		path = path[:100]
	}
	// Remove query parameters
	for i, c := range path {
		if c == '?' {
			path = path[:i]
			break
		}
	}
	return path
}

type countPair struct {
	key   string
	count int64
}

func topN(counts map[string]int64, n int) []models.PathCount {
	pairs := make([]countPair, 0, len(counts))
	for k, v := range counts {
		pairs = append(pairs, countPair{k, v})
	}
	sort.Slice(pairs, func(i, j int) bool {
		return pairs[i].count > pairs[j].count
	})

	if len(pairs) > n {
		pairs = pairs[:n]
	}

	result := make([]models.PathCount, len(pairs))
	for i, p := range pairs {
		result[i] = models.PathCount{Path: p.key, Count: p.count}
	}
	return result
}

func topDNSQueries(counts map[string]int64, n int) []models.DNSQueryCount {
	pairs := make([]countPair, 0, len(counts))
	for k, v := range counts {
		pairs = append(pairs, countPair{k, v})
	}
	sort.Slice(pairs, func(i, j int) bool {
		return pairs[i].count > pairs[j].count
	})

	if len(pairs) > n {
		pairs = pairs[:n]
	}

	result := make([]models.DNSQueryCount, len(pairs))
	for i, p := range pairs {
		result[i] = models.DNSQueryCount{Query: p.key, Count: p.count}
	}
	return result
}

func topBinaries(counts map[string]int64, n int) []models.BinaryCount {
	pairs := make([]countPair, 0, len(counts))
	for k, v := range counts {
		pairs = append(pairs, countPair{k, v})
	}
	sort.Slice(pairs, func(i, j int) bool {
		return pairs[i].count > pairs[j].count
	})

	if len(pairs) > n {
		pairs = pairs[:n]
	}

	result := make([]models.BinaryCount, len(pairs))
	for i, p := range pairs {
		result[i] = models.BinaryCount{Binary: p.key, Count: p.count}
	}
	return result
}

func sumCounts(counts map[string]int64) int64 {
	var total int64
	for _, v := range counts {
		total += v
	}
	return total
}
