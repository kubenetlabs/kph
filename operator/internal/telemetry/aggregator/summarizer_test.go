package aggregator

import (
	"testing"
	"time"

	"github.com/go-logr/logr"

	"github.com/policy-hub/operator/internal/telemetry/models"
)

func TestNewSummarizer(t *testing.T) {
	summarizer := NewSummarizer(SummarizerConfig{
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	if summarizer == nil {
		t.Fatal("NewSummarizer() returned nil")
	}
	if summarizer.nodeName != "test-node" {
		t.Errorf("nodeName = %s, want test-node", summarizer.nodeName)
	}
	if summarizer.flowSummaries == nil {
		t.Error("flowSummaries should not be nil")
	}
	if summarizer.procSummaries == nil {
		t.Error("procSummaries should not be nil")
	}
}

func TestSummarizer_AddEvent_Nil(t *testing.T) {
	summarizer := NewSummarizer(SummarizerConfig{
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	// Should not panic
	summarizer.AddEvent(nil)

	stats := summarizer.GetStats()
	if stats.FlowAggregations != 0 {
		t.Errorf("FlowAggregations = %d, want 0", stats.FlowAggregations)
	}
}

func TestSummarizer_AddEvent_Flow(t *testing.T) {
	summarizer := NewSummarizer(SummarizerConfig{
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	event := &models.TelemetryEvent{
		Timestamp:    time.Now(),
		EventType:    models.EventTypeFlow,
		SrcNamespace: "default",
		DstNamespace: "production",
		DstPort:      8080,
		Protocol:     "TCP",
		Verdict:      models.VerdictAllowed,
		BytesTotal:   1024,
		PacketsTotal: 10,
	}

	summarizer.AddEvent(event)

	stats := summarizer.GetStats()
	if stats.FlowAggregations != 1 {
		t.Errorf("FlowAggregations = %d, want 1", stats.FlowAggregations)
	}
}

func TestSummarizer_AddEvent_FlowWithHTTP(t *testing.T) {
	summarizer := NewSummarizer(SummarizerConfig{
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	event := &models.TelemetryEvent{
		Timestamp:    time.Now(),
		EventType:    models.EventTypeFlow,
		SrcNamespace: "default",
		DstNamespace: "production",
		DstPort:      8080,
		Protocol:     "TCP",
		L7Type:       "HTTP",
		HTTPMethod:   "GET",
		HTTPPath:     "/api/users",
		HTTPStatus:   200,
		Verdict:      models.VerdictAllowed,
	}

	summarizer.AddEvent(event)

	stats := summarizer.GetStats()
	if stats.FlowAggregations != 1 {
		t.Errorf("FlowAggregations = %d, want 1", stats.FlowAggregations)
	}
}

func TestSummarizer_AddEvent_FlowWithDNS(t *testing.T) {
	summarizer := NewSummarizer(SummarizerConfig{
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	event := &models.TelemetryEvent{
		Timestamp:    time.Now(),
		EventType:    models.EventTypeFlow,
		SrcNamespace: "default",
		DstNamespace: "kube-system",
		DstPort:      53,
		Protocol:     "UDP",
		L7Type:       "DNS",
		DNSQuery:     "api.example.com",
		Verdict:      models.VerdictAllowed,
	}

	summarizer.AddEvent(event)

	stats := summarizer.GetStats()
	if stats.FlowAggregations != 1 {
		t.Errorf("FlowAggregations = %d, want 1", stats.FlowAggregations)
	}
}

func TestSummarizer_AddEvent_ProcessExec(t *testing.T) {
	summarizer := NewSummarizer(SummarizerConfig{
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	event := &models.TelemetryEvent{
		Timestamp:    time.Now(),
		EventType:    models.EventTypeProcessExec,
		SrcNamespace: "default",
		SrcPodName:   "app-pod",
		SrcBinary:    "/usr/bin/curl",
	}

	summarizer.AddEvent(event)

	stats := summarizer.GetStats()
	if stats.ProcessAggregations != 1 {
		t.Errorf("ProcessAggregations = %d, want 1", stats.ProcessAggregations)
	}
}

func TestSummarizer_AddEvent_Syscall(t *testing.T) {
	summarizer := NewSummarizer(SummarizerConfig{
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	event := &models.TelemetryEvent{
		Timestamp:    time.Now(),
		EventType:    models.EventTypeSyscall,
		SrcNamespace: "default",
		SrcPodName:   "app-pod",
		Syscall:      "openat",
	}

	summarizer.AddEvent(event)

	stats := summarizer.GetStats()
	if stats.ProcessAggregations != 1 {
		t.Errorf("ProcessAggregations = %d, want 1", stats.ProcessAggregations)
	}
}

func TestSummarizer_AddEvent_FileAccess(t *testing.T) {
	summarizer := NewSummarizer(SummarizerConfig{
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	event := &models.TelemetryEvent{
		Timestamp:     time.Now(),
		EventType:     models.EventTypeFileAccess,
		SrcNamespace:  "default",
		SrcPodName:    "app-pod",
		FileOperation: "read",
		FilePath:      "/etc/passwd",
	}

	summarizer.AddEvent(event)

	stats := summarizer.GetStats()
	if stats.ProcessAggregations != 1 {
		t.Errorf("ProcessAggregations = %d, want 1", stats.ProcessAggregations)
	}
}

func TestSummarizer_AddEvent_VerdictCounts(t *testing.T) {
	summarizer := NewSummarizer(SummarizerConfig{
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	// Add events with different verdicts
	verdicts := []models.Verdict{
		models.VerdictAllowed,
		models.VerdictAllowed,
		models.VerdictDenied,
		models.VerdictDropped,
	}

	for _, v := range verdicts {
		summarizer.AddEvent(&models.TelemetryEvent{
			Timestamp:    time.Now(),
			EventType:    models.EventTypeFlow,
			SrcNamespace: "default",
			DstNamespace: "production",
			Protocol:     "TCP",
			DstPort:      8080,
			Verdict:      v,
		})
	}

	result := summarizer.Flush()
	if result == nil {
		t.Fatal("Flush() returned nil")
	}
	if len(result.FlowSummaries) != 1 {
		t.Fatalf("Expected 1 flow summary, got %d", len(result.FlowSummaries))
	}

	summary := result.FlowSummaries[0]
	if summary.TotalFlows != 4 {
		t.Errorf("TotalFlows = %d, want 4", summary.TotalFlows)
	}
	if summary.AllowedFlows != 2 {
		t.Errorf("AllowedFlows = %d, want 2", summary.AllowedFlows)
	}
	if summary.DeniedFlows != 1 {
		t.Errorf("DeniedFlows = %d, want 1", summary.DeniedFlows)
	}
	if summary.DroppedFlows != 1 {
		t.Errorf("DroppedFlows = %d, want 1", summary.DroppedFlows)
	}
}

func TestSummarizer_AddEvent_MultipleFlows(t *testing.T) {
	summarizer := NewSummarizer(SummarizerConfig{
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	// Add flows from different sources to different destinations
	flows := []struct {
		srcNs    string
		dstNs    string
		protocol string
		port     uint32
	}{
		{"default", "production", "TCP", 8080},
		{"default", "production", "TCP", 8080}, // Same as above - should aggregate
		{"default", "monitoring", "TCP", 9090}, // Different destination
		{"staging", "production", "TCP", 8080}, // Different source
	}

	for _, f := range flows {
		summarizer.AddEvent(&models.TelemetryEvent{
			Timestamp:    time.Now(),
			EventType:    models.EventTypeFlow,
			SrcNamespace: f.srcNs,
			DstNamespace: f.dstNs,
			Protocol:     f.protocol,
			DstPort:      f.port,
			Verdict:      models.VerdictAllowed,
		})
	}

	stats := summarizer.GetStats()
	if stats.FlowAggregations != 3 {
		t.Errorf("FlowAggregations = %d, want 3 (unique flow keys)", stats.FlowAggregations)
	}
}

func TestSummarizer_Flush_Empty(t *testing.T) {
	summarizer := NewSummarizer(SummarizerConfig{
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	result := summarizer.Flush()
	if result != nil {
		t.Error("Flush() on empty summarizer should return nil")
	}
}

func TestSummarizer_Flush_ResetsSummaries(t *testing.T) {
	summarizer := NewSummarizer(SummarizerConfig{
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	// Add an event
	summarizer.AddEvent(&models.TelemetryEvent{
		Timestamp:    time.Now(),
		EventType:    models.EventTypeFlow,
		SrcNamespace: "default",
		DstNamespace: "production",
		Protocol:     "TCP",
		Verdict:      models.VerdictAllowed,
	})

	// First flush should return data
	result1 := summarizer.Flush()
	if result1 == nil {
		t.Fatal("First Flush() should return data")
	}

	// Second flush should return nil (no new data)
	result2 := summarizer.Flush()
	if result2 != nil {
		t.Error("Second Flush() should return nil after reset")
	}

	// Stats should show empty
	stats := summarizer.GetStats()
	if stats.FlowAggregations != 0 {
		t.Errorf("FlowAggregations after Flush = %d, want 0", stats.FlowAggregations)
	}
}

func TestSummarizer_Flush_FlowSummaryFields(t *testing.T) {
	summarizer := NewSummarizer(SummarizerConfig{
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	now := time.Now()
	event := &models.TelemetryEvent{
		Timestamp:    now,
		EventType:    models.EventTypeFlow,
		SrcNamespace: "default",
		SrcPodName:   "frontend",
		DstNamespace: "production",
		DstPodName:   "backend",
		DstPort:      8080,
		Protocol:     "TCP",
		L7Type:       "HTTP",
		Verdict:      models.VerdictAllowed,
		BytesTotal:   2048,
		PacketsTotal: 20,
	}

	summarizer.AddEvent(event)
	result := summarizer.Flush()

	if result == nil || len(result.FlowSummaries) != 1 {
		t.Fatal("Expected 1 flow summary")
	}

	summary := result.FlowSummaries[0]
	if summary.NodeName != "test-node" {
		t.Errorf("NodeName = %s, want test-node", summary.NodeName)
	}
	if summary.SrcNamespace != "default" {
		t.Errorf("SrcNamespace = %s, want default", summary.SrcNamespace)
	}
	if summary.DstNamespace != "production" {
		t.Errorf("DstNamespace = %s, want production", summary.DstNamespace)
	}
	if summary.DstPort != 8080 {
		t.Errorf("DstPort = %d, want 8080", summary.DstPort)
	}
	if summary.Protocol != "TCP" {
		t.Errorf("Protocol = %s, want TCP", summary.Protocol)
	}
	if summary.L7Type != "HTTP" {
		t.Errorf("L7Type = %s, want HTTP", summary.L7Type)
	}
	if summary.TotalBytes != 2048 {
		t.Errorf("TotalBytes = %d, want 2048", summary.TotalBytes)
	}
	if summary.TotalPackets != 20 {
		t.Errorf("TotalPackets = %d, want 20", summary.TotalPackets)
	}
}

func TestSummarizer_Flush_ProcessSummaryFields(t *testing.T) {
	summarizer := NewSummarizer(SummarizerConfig{
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	// Add multiple process exec events
	binaries := []string{"/usr/bin/curl", "/usr/bin/curl", "/bin/sh", "/usr/bin/wget"}
	for _, binary := range binaries {
		summarizer.AddEvent(&models.TelemetryEvent{
			Timestamp:    time.Now(),
			EventType:    models.EventTypeProcessExec,
			SrcNamespace: "default",
			SrcPodName:   "app-pod",
			SrcBinary:    binary,
		})
	}

	result := summarizer.Flush()
	if result == nil || len(result.ProcessSummaries) != 1 {
		t.Fatal("Expected 1 process summary")
	}

	summary := result.ProcessSummaries[0]
	if summary.NodeName != "test-node" {
		t.Errorf("NodeName = %s, want test-node", summary.NodeName)
	}
	if summary.Namespace != "default" {
		t.Errorf("Namespace = %s, want default", summary.Namespace)
	}
	if summary.PodName != "app-pod" {
		t.Errorf("PodName = %s, want app-pod", summary.PodName)
	}
	if summary.TotalExecs != 4 {
		t.Errorf("TotalExecs = %d, want 4", summary.TotalExecs)
	}
	if summary.UniqueBinaries != 3 {
		t.Errorf("UniqueBinaries = %d, want 3", summary.UniqueBinaries)
	}
}

func TestSummarizer_Flush_HTTPMethodCounts(t *testing.T) {
	summarizer := NewSummarizer(SummarizerConfig{
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	methods := []string{"GET", "GET", "POST", "DELETE"}
	for _, method := range methods {
		summarizer.AddEvent(&models.TelemetryEvent{
			Timestamp:    time.Now(),
			EventType:    models.EventTypeFlow,
			SrcNamespace: "default",
			DstNamespace: "production",
			Protocol:     "TCP",
			DstPort:      8080,
			L7Type:       "HTTP",
			HTTPMethod:   method,
			Verdict:      models.VerdictAllowed,
		})
	}

	result := summarizer.Flush()
	if result == nil || len(result.FlowSummaries) != 1 {
		t.Fatal("Expected 1 flow summary")
	}

	summary := result.FlowSummaries[0]
	if summary.HTTPMethodCounts["GET"] != 2 {
		t.Errorf("HTTPMethodCounts[GET] = %d, want 2", summary.HTTPMethodCounts["GET"])
	}
	if summary.HTTPMethodCounts["POST"] != 1 {
		t.Errorf("HTTPMethodCounts[POST] = %d, want 1", summary.HTTPMethodCounts["POST"])
	}
	if summary.HTTPMethodCounts["DELETE"] != 1 {
		t.Errorf("HTTPMethodCounts[DELETE] = %d, want 1", summary.HTTPMethodCounts["DELETE"])
	}
}

func TestSummarizer_GetStats(t *testing.T) {
	summarizer := NewSummarizer(SummarizerConfig{
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	// Initial stats
	stats := summarizer.GetStats()
	if stats.FlowAggregations != 0 {
		t.Errorf("Initial FlowAggregations = %d, want 0", stats.FlowAggregations)
	}
	if stats.ProcessAggregations != 0 {
		t.Errorf("Initial ProcessAggregations = %d, want 0", stats.ProcessAggregations)
	}

	// Add events
	summarizer.AddEvent(&models.TelemetryEvent{
		Timestamp:    time.Now(),
		EventType:    models.EventTypeFlow,
		SrcNamespace: "default",
		DstNamespace: "production",
		Protocol:     "TCP",
		Verdict:      models.VerdictAllowed,
	})
	summarizer.AddEvent(&models.TelemetryEvent{
		Timestamp:    time.Now(),
		EventType:    models.EventTypeProcessExec,
		SrcNamespace: "default",
		SrcPodName:   "app-pod",
		SrcBinary:    "/bin/sh",
	})

	stats = summarizer.GetStats()
	if stats.FlowAggregations != 1 {
		t.Errorf("FlowAggregations = %d, want 1", stats.FlowAggregations)
	}
	if stats.ProcessAggregations != 1 {
		t.Errorf("ProcessAggregations = %d, want 1", stats.ProcessAggregations)
	}
}

func TestSummarizer_WindowTracking(t *testing.T) {
	summarizer := NewSummarizer(SummarizerConfig{
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	// Add events with different timestamps
	t1 := time.Now().Add(-1 * time.Hour)
	t2 := time.Now()
	t3 := time.Now().Add(-30 * time.Minute)

	summarizer.AddEvent(&models.TelemetryEvent{
		Timestamp:    t1,
		EventType:    models.EventTypeFlow,
		SrcNamespace: "default",
		DstNamespace: "production",
		Protocol:     "TCP",
		Verdict:      models.VerdictAllowed,
	})
	summarizer.AddEvent(&models.TelemetryEvent{
		Timestamp:    t2,
		EventType:    models.EventTypeFlow,
		SrcNamespace: "default",
		DstNamespace: "production",
		Protocol:     "TCP",
		Verdict:      models.VerdictAllowed,
	})
	summarizer.AddEvent(&models.TelemetryEvent{
		Timestamp:    t3,
		EventType:    models.EventTypeFlow,
		SrcNamespace: "default",
		DstNamespace: "production",
		Protocol:     "TCP",
		Verdict:      models.VerdictAllowed,
	})

	stats := summarizer.GetStats()

	// Window should span from t1 to t2
	if !stats.WindowStart.Equal(t1) && !stats.WindowStart.Before(t1) {
		t.Errorf("WindowStart should be at or before earliest event")
	}
	if !stats.WindowEnd.Equal(t2) && !stats.WindowEnd.After(t2) {
		t.Errorf("WindowEnd should be at or after latest event")
	}
}

func TestNormalizePath(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"/api/users", "/api/users"},
		{"/api/users?id=123", "/api/users"},
		{"/api/users?id=123&name=test", "/api/users"},
		{"/?query=value", "/"},
		{"/", "/"},
		{"", ""},
	}

	for _, tt := range tests {
		result := normalizePath(tt.input)
		if result != tt.expected {
			t.Errorf("normalizePath(%s) = %s, want %s", tt.input, result, tt.expected)
		}
	}
}

func TestNormalizePath_LongPath(t *testing.T) {
	// Create a path longer than 100 characters
	longPath := "/api"
	for i := 0; i < 50; i++ {
		longPath += "/segment"
	}

	result := normalizePath(longPath)
	if len(result) > 100 {
		t.Errorf("normalizePath should truncate long paths to 100 chars, got %d", len(result))
	}
}

func TestTopN(t *testing.T) {
	counts := map[string]int64{
		"/api/users":    100,
		"/api/products": 50,
		"/api/orders":   75,
		"/health":       200,
		"/metrics":      10,
	}

	result := topN(counts, 3)

	if len(result) != 3 {
		t.Fatalf("topN(3) returned %d items, want 3", len(result))
	}

	// Should be sorted by count descending
	if result[0].Path != "/health" || result[0].Count != 200 {
		t.Errorf("result[0] = {%s, %d}, want {/health, 200}", result[0].Path, result[0].Count)
	}
	if result[1].Path != "/api/users" || result[1].Count != 100 {
		t.Errorf("result[1] = {%s, %d}, want {/api/users, 100}", result[1].Path, result[1].Count)
	}
	if result[2].Path != "/api/orders" || result[2].Count != 75 {
		t.Errorf("result[2] = {%s, %d}, want {/api/orders, 75}", result[2].Path, result[2].Count)
	}
}

func TestTopN_LessThanN(t *testing.T) {
	counts := map[string]int64{
		"/api": 10,
	}

	result := topN(counts, 5)

	if len(result) != 1 {
		t.Errorf("topN with fewer items should return all items, got %d", len(result))
	}
}

func TestTopDNSQueries(t *testing.T) {
	counts := map[string]int64{
		"api.example.com":      100,
		"db.internal":          50,
		"cache.internal":       75,
		"kubernetes.default":   200,
	}

	result := topDNSQueries(counts, 2)

	if len(result) != 2 {
		t.Fatalf("topDNSQueries(2) returned %d items, want 2", len(result))
	}

	if result[0].Query != "kubernetes.default" || result[0].Count != 200 {
		t.Errorf("result[0] = {%s, %d}, want {kubernetes.default, 200}", result[0].Query, result[0].Count)
	}
	if result[1].Query != "api.example.com" || result[1].Count != 100 {
		t.Errorf("result[1] = {%s, %d}, want {api.example.com, 100}", result[1].Query, result[1].Count)
	}
}

func TestTopBinaries(t *testing.T) {
	counts := map[string]int64{
		"/usr/bin/curl":  100,
		"/bin/sh":        200,
		"/usr/bin/wget":  50,
	}

	result := topBinaries(counts, 2)

	if len(result) != 2 {
		t.Fatalf("topBinaries(2) returned %d items, want 2", len(result))
	}

	if result[0].Binary != "/bin/sh" || result[0].Count != 200 {
		t.Errorf("result[0] = {%s, %d}, want {/bin/sh, 200}", result[0].Binary, result[0].Count)
	}
	if result[1].Binary != "/usr/bin/curl" || result[1].Count != 100 {
		t.Errorf("result[1] = {%s, %d}, want {/usr/bin/curl, 100}", result[1].Binary, result[1].Count)
	}
}

func TestSumCounts(t *testing.T) {
	tests := []struct {
		name     string
		counts   map[string]int64
		expected int64
	}{
		{
			name:     "empty map",
			counts:   map[string]int64{},
			expected: 0,
		},
		{
			name:     "single entry",
			counts:   map[string]int64{"key": 100},
			expected: 100,
		},
		{
			name: "multiple entries",
			counts: map[string]int64{
				"a": 10,
				"b": 20,
				"c": 30,
			},
			expected: 60,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := sumCounts(tt.counts)
			if result != tt.expected {
				t.Errorf("sumCounts() = %d, want %d", result, tt.expected)
			}
		})
	}
}

func TestSummarizerStats_Fields(t *testing.T) {
	now := time.Now()
	stats := SummarizerStats{
		WindowStart:         now.Add(-1 * time.Hour),
		WindowEnd:           now,
		FlowAggregations:    10,
		ProcessAggregations: 5,
	}

	if stats.FlowAggregations != 10 {
		t.Errorf("FlowAggregations = %d, want 10", stats.FlowAggregations)
	}
	if stats.ProcessAggregations != 5 {
		t.Errorf("ProcessAggregations = %d, want 5", stats.ProcessAggregations)
	}
	if stats.WindowStart.After(stats.WindowEnd) {
		t.Error("WindowStart should be before WindowEnd")
	}
}

func TestSummarizer_EnforcementActions(t *testing.T) {
	summarizer := NewSummarizer(SummarizerConfig{
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	// Add denied events with enforcement actions
	summarizer.AddEvent(&models.TelemetryEvent{
		Timestamp:    time.Now(),
		EventType:    models.EventTypeProcessExec,
		SrcNamespace: "default",
		SrcPodName:   "app-pod",
		SrcBinary:    "/bin/sh",
		Verdict:      models.VerdictDenied,
		Action:       "SIGKILL",
	})
	summarizer.AddEvent(&models.TelemetryEvent{
		Timestamp:    time.Now(),
		EventType:    models.EventTypeProcessExec,
		SrcNamespace: "default",
		SrcPodName:   "app-pod",
		SrcBinary:    "/bin/bash",
		Verdict:      models.VerdictDenied,
		Action:       "SIGKILL",
	})
	summarizer.AddEvent(&models.TelemetryEvent{
		Timestamp:    time.Now(),
		EventType:    models.EventTypeProcessExec,
		SrcNamespace: "default",
		SrcPodName:   "app-pod",
		SrcBinary:    "/usr/bin/curl",
		Verdict:      models.VerdictDenied,
		Action:       "SIGSEGV",
	})

	result := summarizer.Flush()
	if result == nil || len(result.ProcessSummaries) != 1 {
		t.Fatal("Expected 1 process summary")
	}

	summary := result.ProcessSummaries[0]
	if summary.ActionCounts["SIGKILL"] != 2 {
		t.Errorf("ActionCounts[SIGKILL] = %d, want 2", summary.ActionCounts["SIGKILL"])
	}
	if summary.ActionCounts["SIGSEGV"] != 1 {
		t.Errorf("ActionCounts[SIGSEGV] = %d, want 1", summary.ActionCounts["SIGSEGV"])
	}
}
