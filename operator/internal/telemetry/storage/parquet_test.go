package storage

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/go-logr/logr"

	"github.com/policy-hub/operator/internal/telemetry/models"
)

func TestParquetWriter_NewParquetWriter(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "parquet-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	pw, err := NewParquetWriter(ParquetWriterConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("NewParquetWriter() error = %v", err)
	}
	defer pw.Close()

	if pw.basePath != tmpDir {
		t.Errorf("basePath = %s, want %s", pw.basePath, tmpDir)
	}
	if pw.nodeName != "test-node" {
		t.Errorf("nodeName = %s, want test-node", pw.nodeName)
	}
}

func TestParquetWriter_NewParquetWriter_EmptyPath(t *testing.T) {
	_, err := NewParquetWriter(ParquetWriterConfig{
		BasePath: "",
		Logger:   logr.Discard(),
	})
	if err == nil {
		t.Error("Expected error for empty path, got nil")
	}
}

func TestParquetWriter_Write(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "parquet-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	pw, err := NewParquetWriter(ParquetWriterConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("NewParquetWriter() error = %v", err)
	}
	defer pw.Close()

	events := createTestEvents(5)

	if err := pw.Write(events); err != nil {
		t.Fatalf("Write() error = %v", err)
	}

	stats := pw.GetStats()
	if stats.EventCount != 5 {
		t.Errorf("EventCount = %d, want 5", stats.EventCount)
	}
	if stats.CurrentDate == "" {
		t.Error("CurrentDate should not be empty")
	}
}

func TestParquetWriter_Write_Empty(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "parquet-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	pw, err := NewParquetWriter(ParquetWriterConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("NewParquetWriter() error = %v", err)
	}
	defer pw.Close()

	// Writing empty slice should not error
	if err := pw.Write([]*models.TelemetryEvent{}); err != nil {
		t.Errorf("Write(empty) error = %v", err)
	}
}

func TestParquetWriter_GetStats(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "parquet-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	pw, err := NewParquetWriter(ParquetWriterConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("NewParquetWriter() error = %v", err)
	}
	defer pw.Close()

	// Before any writes
	stats := pw.GetStats()
	if stats.EventCount != 0 {
		t.Errorf("Initial EventCount = %d, want 0", stats.EventCount)
	}
	if stats.BasePath != tmpDir {
		t.Errorf("BasePath = %s, want %s", stats.BasePath, tmpDir)
	}
}

func TestParquetReader_ReadEvents(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "parquet-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Write some events first
	pw, err := NewParquetWriter(ParquetWriterConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("NewParquetWriter() error = %v", err)
	}

	events := createTestEvents(10)
	if err := pw.Write(events); err != nil {
		t.Fatalf("Write() error = %v", err)
	}
	pw.Close()

	// Read events back
	pr := NewParquetReader(tmpDir, logr.Discard())

	ctx := context.Background()
	result, err := pr.ReadEvents(ctx, models.QueryEventsRequest{
		StartTime: time.Now().Add(-1 * time.Hour),
		EndTime:   time.Now().Add(1 * time.Hour),
	})
	if err != nil {
		t.Fatalf("ReadEvents() error = %v", err)
	}

	if len(result.Events) != 10 {
		t.Errorf("ReadEvents() returned %d events, want 10", len(result.Events))
	}
}

func TestParquetReader_ReadEvents_WithFilters(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "parquet-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Write events with different namespaces
	pw, err := NewParquetWriter(ParquetWriterConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("NewParquetWriter() error = %v", err)
	}

	now := time.Now()
	events := []*models.TelemetryEvent{
		{ID: "1", Timestamp: now, EventType: models.EventTypeFlow, SrcNamespace: "default"},
		{ID: "2", Timestamp: now, EventType: models.EventTypeFlow, SrcNamespace: "production"},
		{ID: "3", Timestamp: now, EventType: models.EventTypeFlow, SrcNamespace: "default"},
		{ID: "4", Timestamp: now, EventType: models.EventTypeProcessExec, SrcNamespace: "default"},
	}

	if err := pw.Write(events); err != nil {
		t.Fatalf("Write() error = %v", err)
	}
	pw.Close()

	pr := NewParquetReader(tmpDir, logr.Discard())
	ctx := context.Background()

	// Filter by namespace
	result, err := pr.ReadEvents(ctx, models.QueryEventsRequest{
		StartTime:  now.Add(-1 * time.Hour),
		EndTime:    now.Add(1 * time.Hour),
		Namespaces: []string{"default"},
	})
	if err != nil {
		t.Fatalf("ReadEvents() error = %v", err)
	}
	if len(result.Events) != 3 {
		t.Errorf("ReadEvents(namespace=default) returned %d events, want 3", len(result.Events))
	}

	// Filter by event type
	result, err = pr.ReadEvents(ctx, models.QueryEventsRequest{
		StartTime:  now.Add(-1 * time.Hour),
		EndTime:    now.Add(1 * time.Hour),
		EventTypes: []string{string(models.EventTypeFlow)},
	})
	if err != nil {
		t.Fatalf("ReadEvents() error = %v", err)
	}
	if len(result.Events) != 3 {
		t.Errorf("ReadEvents(type=flow) returned %d events, want 3", len(result.Events))
	}
}

func TestParquetReader_ReadEvents_WithLimit(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "parquet-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	pw, err := NewParquetWriter(ParquetWriterConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("NewParquetWriter() error = %v", err)
	}

	if err := pw.Write(createTestEvents(20)); err != nil {
		t.Fatalf("Write() error = %v", err)
	}
	pw.Close()

	pr := NewParquetReader(tmpDir, logr.Discard())
	ctx := context.Background()

	result, err := pr.ReadEvents(ctx, models.QueryEventsRequest{
		StartTime: time.Now().Add(-1 * time.Hour),
		EndTime:   time.Now().Add(1 * time.Hour),
		Limit:     5,
	})
	if err != nil {
		t.Fatalf("ReadEvents() error = %v", err)
	}

	if len(result.Events) != 5 {
		t.Errorf("ReadEvents(limit=5) returned %d events, want 5", len(result.Events))
	}
	if !result.HasMore {
		t.Error("HasMore should be true when limit applied")
	}
	if result.TotalCount != 20 {
		t.Errorf("TotalCount = %d, want 20", result.TotalCount)
	}
}

func TestParquetReader_ListDates(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "parquet-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create date directories
	dates := []string{"2024-01-10", "2024-01-15", "2024-01-20"}
	for _, date := range dates {
		if err := os.MkdirAll(filepath.Join(tmpDir, date), 0755); err != nil {
			t.Fatalf("Failed to create dir: %v", err)
		}
	}

	// Create non-date directory (should be ignored)
	if err := os.MkdirAll(filepath.Join(tmpDir, "not-a-date"), 0755); err != nil {
		t.Fatalf("Failed to create dir: %v", err)
	}

	pr := NewParquetReader(tmpDir, logr.Discard())
	listedDates, err := pr.ListDates()
	if err != nil {
		t.Fatalf("ListDates() error = %v", err)
	}

	if len(listedDates) != 3 {
		t.Errorf("ListDates() returned %d dates, want 3", len(listedDates))
	}
}

func TestParquetReader_GetStorageSize(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "parquet-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create a parquet file with known size
	dateDir := filepath.Join(tmpDir, "2024-01-15")
	if err := os.MkdirAll(dateDir, 0755); err != nil {
		t.Fatalf("Failed to create dir: %v", err)
	}
	data := make([]byte, 5000)
	if err := os.WriteFile(filepath.Join(dateDir, "events.parquet"), data, 0644); err != nil {
		t.Fatalf("Failed to create file: %v", err)
	}

	pr := NewParquetReader(tmpDir, logr.Discard())
	size, err := pr.GetStorageSize()
	if err != nil {
		t.Fatalf("GetStorageSize() error = %v", err)
	}

	if size != 5000 {
		t.Errorf("GetStorageSize() = %d, want 5000", size)
	}
}

func TestConvertToParquetEvent(t *testing.T) {
	event := &models.TelemetryEvent{
		ID:           "test-id",
		Timestamp:    time.Now(),
		EventType:    models.EventTypeFlow,
		NodeName:     "node-1",
		SrcNamespace: "default",
		SrcPodName:   "pod-a",
		SrcPodLabels: map[string]string{"app": "test"},
		SrcIP:        "10.0.0.1",
		SrcPort:      12345,
		DstNamespace: "production",
		DstPodName:   "pod-b",
		DstIP:        "10.0.0.2",
		DstPort:      8080,
		Protocol:     "TCP",
		Verdict:      models.VerdictAllowed,
		BytesTotal:   1024,
		PacketsTotal: 10,
	}

	pqEvent := convertToParquetEvent(event)

	if pqEvent.ID != event.ID {
		t.Errorf("ID = %s, want %s", pqEvent.ID, event.ID)
	}
	if pqEvent.EventType != string(event.EventType) {
		t.Errorf("EventType = %s, want %s", pqEvent.EventType, event.EventType)
	}
	if pqEvent.SrcNamespace != event.SrcNamespace {
		t.Errorf("SrcNamespace = %s, want %s", pqEvent.SrcNamespace, event.SrcNamespace)
	}
	if pqEvent.DstPort != int32(event.DstPort) {
		t.Errorf("DstPort = %d, want %d", pqEvent.DstPort, event.DstPort)
	}
	if pqEvent.BytesTotal != event.BytesTotal {
		t.Errorf("BytesTotal = %d, want %d", pqEvent.BytesTotal, event.BytesTotal)
	}
}

func TestConvertFromParquetEvent(t *testing.T) {
	now := time.Now()
	pqEvent := &ParquetEvent{
		ID:           "test-id",
		Timestamp:    now.UnixMicro(),
		EventType:    "FLOW",
		NodeName:     "node-1",
		SrcNamespace: "default",
		SrcPodName:   "pod-a",
		SrcPodLabels: `{"app":"test"}`,
		SrcIP:        "10.0.0.1",
		SrcPort:      12345,
		DstNamespace: "production",
		DstPodName:   "pod-b",
		DstIP:        "10.0.0.2",
		DstPort:      8080,
		Protocol:     "TCP",
		Verdict:      "ALLOWED",
		BytesTotal:   1024,
		PacketsTotal: 10,
	}

	event := convertFromParquetEvent(pqEvent)

	if event.ID != pqEvent.ID {
		t.Errorf("ID = %s, want %s", event.ID, pqEvent.ID)
	}
	if string(event.EventType) != pqEvent.EventType {
		t.Errorf("EventType = %s, want %s", event.EventType, pqEvent.EventType)
	}
	if event.SrcPodLabels["app"] != "test" {
		t.Errorf("SrcPodLabels[app] = %s, want test", event.SrcPodLabels["app"])
	}
	if event.DstPort != uint32(pqEvent.DstPort) {
		t.Errorf("DstPort = %d, want %d", event.DstPort, pqEvent.DstPort)
	}
}

func TestJsonEncode(t *testing.T) {
	tests := []struct {
		name  string
		input interface{}
		want  string
	}{
		{
			name:  "nil",
			input: nil,
			want:  "",
		},
		{
			name:  "string map",
			input: map[string]string{"key": "value"},
			want:  `{"key":"value"}`,
		},
		{
			name:  "string slice",
			input: []string{"a", "b", "c"},
			want:  `["a","b","c"]`,
		},
		{
			name:  "empty map",
			input: map[string]string{},
			want:  `{}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := jsonEncode(tt.input)
			if got != tt.want {
				t.Errorf("jsonEncode() = %s, want %s", got, tt.want)
			}
		})
	}
}

func TestParquetRoundTrip(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "parquet-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create original event with all fields
	now := time.Now().Truncate(time.Microsecond) // Parquet stores microseconds
	original := &models.TelemetryEvent{
		ID:           "round-trip-test",
		Timestamp:    now,
		EventType:    models.EventTypeFlow,
		NodeName:     "node-1",
		SrcNamespace: "default",
		SrcPodName:   "pod-a",
		SrcPodLabels: map[string]string{"app": "test", "env": "prod"},
		SrcIP:        "10.0.0.1",
		SrcPort:      54321,
		DstNamespace: "production",
		DstPodName:   "pod-b",
		DstIP:        "10.0.0.2",
		DstPort:      8080,
		Protocol:     "TCP",
		L7Type:       "HTTP",
		HTTPMethod:   "GET",
		HTTPPath:     "/api/v1/users",
		HTTPStatus:   200,
		Verdict:      models.VerdictAllowed,
		BytesTotal:   2048,
		PacketsTotal: 20,
		Source:       "hubble",
	}

	// Write
	pw, err := NewParquetWriter(ParquetWriterConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("NewParquetWriter() error = %v", err)
	}

	if err := pw.Write([]*models.TelemetryEvent{original}); err != nil {
		t.Fatalf("Write() error = %v", err)
	}
	pw.Close()

	// Read
	pr := NewParquetReader(tmpDir, logr.Discard())
	ctx := context.Background()
	result, err := pr.ReadEvents(ctx, models.QueryEventsRequest{
		StartTime: now.Add(-1 * time.Hour),
		EndTime:   now.Add(1 * time.Hour),
	})
	if err != nil {
		t.Fatalf("ReadEvents() error = %v", err)
	}

	if len(result.Events) != 1 {
		t.Fatalf("Expected 1 event, got %d", len(result.Events))
	}

	restored := result.Events[0]

	// Verify fields
	if restored.ID != original.ID {
		t.Errorf("ID = %s, want %s", restored.ID, original.ID)
	}
	if !restored.Timestamp.Equal(original.Timestamp) {
		t.Errorf("Timestamp = %v, want %v", restored.Timestamp, original.Timestamp)
	}
	if restored.EventType != original.EventType {
		t.Errorf("EventType = %s, want %s", restored.EventType, original.EventType)
	}
	if restored.SrcPodLabels["app"] != original.SrcPodLabels["app"] {
		t.Errorf("SrcPodLabels[app] = %s, want %s", restored.SrcPodLabels["app"], original.SrcPodLabels["app"])
	}
	if restored.HTTPMethod != original.HTTPMethod {
		t.Errorf("HTTPMethod = %s, want %s", restored.HTTPMethod, original.HTTPMethod)
	}
	if restored.BytesTotal != original.BytesTotal {
		t.Errorf("BytesTotal = %d, want %d", restored.BytesTotal, original.BytesTotal)
	}
}

// Helper to create test events
func createTestEvents(count int) []*models.TelemetryEvent {
	events := make([]*models.TelemetryEvent, count)
	now := time.Now()
	for i := 0; i < count; i++ {
		events[i] = &models.TelemetryEvent{
			ID:           fmt.Sprintf("event-%d", i),
			Timestamp:    now.Add(time.Duration(i) * time.Second),
			EventType:    models.EventTypeFlow,
			NodeName:     "test-node",
			SrcNamespace: "default",
			SrcPodName:   fmt.Sprintf("pod-%d", i),
			DstNamespace: "production",
			DstPort:      8080,
			Protocol:     "TCP",
			Verdict:      models.VerdictAllowed,
		}
	}
	return events
}

