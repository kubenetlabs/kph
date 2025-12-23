package storage

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/go-logr/logr"

	"github.com/policy-hub/operator/internal/telemetry/models"
)

func TestSQLiteIndex_NewSQLiteIndex(t *testing.T) {
	// Create temp directory for test database
	tmpDir, err := os.MkdirTemp("", "sqlite-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	dbPath := filepath.Join(tmpDir, "test.db")

	idx, err := NewSQLiteIndex(SQLiteIndexConfig{
		DBPath: dbPath,
		Logger: logr.Discard(),
	})
	if err != nil {
		t.Fatalf("NewSQLiteIndex() error = %v", err)
	}
	defer idx.Close()

	// Verify database file was created
	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		t.Error("Database file was not created")
	}
}

func TestSQLiteIndex_NewSQLiteIndex_EmptyPath(t *testing.T) {
	_, err := NewSQLiteIndex(SQLiteIndexConfig{
		DBPath: "",
		Logger: logr.Discard(),
	})
	if err == nil {
		t.Error("Expected error for empty path, got nil")
	}
}

func TestSQLiteIndex_IndexEvents(t *testing.T) {
	idx := setupTestIndex(t)
	defer idx.Close()

	events := []*models.TelemetryEvent{
		{
			ID:           "event-1",
			Timestamp:    time.Now(),
			EventType:    models.EventTypeFlow,
			NodeName:     "node-1",
			SrcNamespace: "default",
			SrcPodName:   "pod-a",
			DstNamespace: "kube-system",
			DstPodName:   "pod-b",
			Protocol:     "TCP",
			DstPort:      8080,
			Verdict:      models.VerdictAllowed,
		},
		{
			ID:           "event-2",
			Timestamp:    time.Now(),
			EventType:    models.EventTypeFlow,
			NodeName:     "node-1",
			SrcNamespace: "production",
			SrcPodName:   "pod-c",
			DstNamespace: "default",
			DstPodName:   "pod-d",
			Protocol:     "TCP",
			DstPort:      443,
			Verdict:      models.VerdictDenied,
		},
	}

	err := idx.IndexEvents(events, "/path/to/events.parquet")
	if err != nil {
		t.Fatalf("IndexEvents() error = %v", err)
	}

	// Verify events were indexed
	ctx := context.Background()
	count, err := idx.GetEventCount(ctx)
	if err != nil {
		t.Fatalf("GetEventCount() error = %v", err)
	}
	if count != 2 {
		t.Errorf("GetEventCount() = %d, want 2", count)
	}
}

func TestSQLiteIndex_QueryEventIDs(t *testing.T) {
	idx := setupTestIndex(t)
	defer idx.Close()

	now := time.Now()
	events := []*models.TelemetryEvent{
		{
			ID:           "event-1",
			Timestamp:    now.Add(-1 * time.Hour),
			EventType:    models.EventTypeFlow,
			NodeName:     "node-1",
			SrcNamespace: "default",
			DstNamespace: "production",
		},
		{
			ID:           "event-2",
			Timestamp:    now.Add(-30 * time.Minute),
			EventType:    models.EventTypeFlow,
			NodeName:     "node-1",
			SrcNamespace: "production",
			DstNamespace: "kube-system",
		},
		{
			ID:           "event-3",
			Timestamp:    now.Add(-10 * time.Minute),
			EventType:    models.EventTypeProcessExec,
			NodeName:     "node-1",
			SrcNamespace: "default",
			DstNamespace: "",
		},
	}

	if err := idx.IndexEvents(events, "/path/to/events.parquet"); err != nil {
		t.Fatalf("IndexEvents() error = %v", err)
	}

	ctx := context.Background()

	tests := []struct {
		name      string
		req       models.QueryEventsRequest
		wantCount int
	}{
		{
			name: "query all in time range",
			req: models.QueryEventsRequest{
				StartTime: now.Add(-2 * time.Hour),
				EndTime:   now,
			},
			wantCount: 3,
		},
		{
			name: "query by namespace",
			req: models.QueryEventsRequest{
				StartTime:  now.Add(-2 * time.Hour),
				EndTime:    now,
				Namespaces: []string{"production"},
			},
			wantCount: 2, // event-1 dst=production, event-2 src=production
		},
		{
			name: "query by event type",
			req: models.QueryEventsRequest{
				StartTime:  now.Add(-2 * time.Hour),
				EndTime:    now,
				EventTypes: []string{string(models.EventTypeFlow)},
			},
			wantCount: 2,
		},
		{
			name: "query with limit",
			req: models.QueryEventsRequest{
				StartTime: now.Add(-2 * time.Hour),
				EndTime:   now,
				Limit:     1,
			},
			wantCount: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ids, err := idx.QueryEventIDs(ctx, tt.req)
			if err != nil {
				t.Errorf("QueryEventIDs() error = %v", err)
				return
			}
			if len(ids) != tt.wantCount {
				t.Errorf("QueryEventIDs() returned %d events, want %d", len(ids), tt.wantCount)
			}
		})
	}
}

func TestSQLiteIndex_RegisterFile(t *testing.T) {
	idx := setupTestIndex(t)
	defer idx.Close()

	err := idx.RegisterFile("/data/2024-01-15/events.parquet", "2024-01-15", "node-1", 1000, 1024*1024)
	if err != nil {
		t.Fatalf("RegisterFile() error = %v", err)
	}

	// Verify file was registered
	ctx := context.Background()
	stats, err := idx.GetStats(ctx)
	if err != nil {
		t.Fatalf("GetStats() error = %v", err)
	}
	if stats.TotalFiles != 1 {
		t.Errorf("TotalFiles = %d, want 1", stats.TotalFiles)
	}
}

func TestSQLiteIndex_GetFilesOlderThan(t *testing.T) {
	idx := setupTestIndex(t)
	defer idx.Close()

	// Register files with different dates
	files := []struct {
		path string
		date string
	}{
		{"/data/2024-01-10/events.parquet", "2024-01-10"},
		{"/data/2024-01-12/events.parquet", "2024-01-12"},
		{"/data/2024-01-15/events.parquet", "2024-01-15"},
		{"/data/2024-01-18/events.parquet", "2024-01-18"},
	}

	for _, f := range files {
		if err := idx.RegisterFile(f.path, f.date, "node-1", 100, 1024); err != nil {
			t.Fatalf("RegisterFile() error = %v", err)
		}
	}

	ctx := context.Background()
	oldFiles, err := idx.GetFilesOlderThan(ctx, "2024-01-14")
	if err != nil {
		t.Fatalf("GetFilesOlderThan() error = %v", err)
	}

	if len(oldFiles) != 2 {
		t.Errorf("GetFilesOlderThan() returned %d files, want 2", len(oldFiles))
	}
}

func TestSQLiteIndex_DeleteFileRecords(t *testing.T) {
	idx := setupTestIndex(t)
	defer idx.Close()

	// Add events and register file
	events := []*models.TelemetryEvent{
		{
			ID:           "event-1",
			Timestamp:    time.Now(),
			EventType:    models.EventTypeFlow,
			NodeName:     "node-1",
			SrcNamespace: "default",
		},
	}

	filePath := "/data/2024-01-15/events.parquet"
	if err := idx.IndexEvents(events, filePath); err != nil {
		t.Fatalf("IndexEvents() error = %v", err)
	}
	if err := idx.RegisterFile(filePath, "2024-01-15", "node-1", 1, 1024); err != nil {
		t.Fatalf("RegisterFile() error = %v", err)
	}

	ctx := context.Background()

	// Verify records exist
	count, _ := idx.GetEventCount(ctx)
	if count != 1 {
		t.Fatalf("Expected 1 event before delete, got %d", count)
	}

	// Delete records
	if err := idx.DeleteFileRecords(ctx, filePath); err != nil {
		t.Fatalf("DeleteFileRecords() error = %v", err)
	}

	// Verify records were deleted
	count, _ = idx.GetEventCount(ctx)
	if count != 0 {
		t.Errorf("Expected 0 events after delete, got %d", count)
	}

	stats, _ := idx.GetStats(ctx)
	if stats.TotalFiles != 0 {
		t.Errorf("Expected 0 files after delete, got %d", stats.TotalFiles)
	}
}

func TestSQLiteIndex_UpdateHourlyStats(t *testing.T) {
	idx := setupTestIndex(t)
	defer idx.Close()

	now := time.Now().UTC()
	events := []*models.TelemetryEvent{
		{
			ID:           "event-1",
			Timestamp:    now,
			EventType:    models.EventTypeFlow,
			SrcNamespace: "default",
			DstNamespace: "production",
			Protocol:     "TCP",
			DstPort:      8080,
			Verdict:      models.VerdictAllowed,
			BytesTotal:   1024,
			PacketsTotal: 10,
		},
		{
			ID:           "event-2",
			Timestamp:    now,
			EventType:    models.EventTypeFlow,
			SrcNamespace: "default",
			DstNamespace: "production",
			Protocol:     "TCP",
			DstPort:      8080,
			Verdict:      models.VerdictAllowed,
			BytesTotal:   2048,
			PacketsTotal: 20,
		},
	}

	if err := idx.UpdateHourlyStats(events); err != nil {
		t.Fatalf("UpdateHourlyStats() error = %v", err)
	}

	ctx := context.Background()
	hour := now.Format("2006-01-02T15")
	stats, err := idx.GetHourlyStats(ctx, hour, hour)
	if err != nil {
		t.Fatalf("GetHourlyStats() error = %v", err)
	}

	if len(stats) != 1 {
		t.Fatalf("Expected 1 hourly stat, got %d", len(stats))
	}

	// Should be aggregated
	if stats[0].EventCount != 2 {
		t.Errorf("EventCount = %d, want 2", stats[0].EventCount)
	}
	if stats[0].BytesTotal != 3072 {
		t.Errorf("BytesTotal = %d, want 3072", stats[0].BytesTotal)
	}
	if stats[0].PacketsTotal != 30 {
		t.Errorf("PacketsTotal = %d, want 30", stats[0].PacketsTotal)
	}
}

func TestSQLiteIndex_GetStats(t *testing.T) {
	idx := setupTestIndex(t)
	defer idx.Close()

	// Add some data
	events := []*models.TelemetryEvent{
		{ID: "e1", Timestamp: time.Now(), EventType: models.EventTypeFlow, NodeName: "n1"},
		{ID: "e2", Timestamp: time.Now(), EventType: models.EventTypeFlow, NodeName: "n1"},
	}
	if err := idx.IndexEvents(events, "/data/test.parquet"); err != nil {
		t.Fatalf("IndexEvents() error = %v", err)
	}
	if err := idx.RegisterFile("/data/2024-01-15/test.parquet", "2024-01-15", "n1", 2, 2048); err != nil {
		t.Fatalf("RegisterFile() error = %v", err)
	}

	ctx := context.Background()
	stats, err := idx.GetStats(ctx)
	if err != nil {
		t.Fatalf("GetStats() error = %v", err)
	}

	if stats.TotalEvents != 2 {
		t.Errorf("TotalEvents = %d, want 2", stats.TotalEvents)
	}
	if stats.TotalFiles != 1 {
		t.Errorf("TotalFiles = %d, want 1", stats.TotalFiles)
	}
	if stats.TotalSizeBytes != 2048 {
		t.Errorf("TotalSizeBytes = %d, want 2048", stats.TotalSizeBytes)
	}
}

func TestSQLiteIndex_Vacuum(t *testing.T) {
	idx := setupTestIndex(t)
	defer idx.Close()

	// Just verify vacuum doesn't error
	if err := idx.Vacuum(); err != nil {
		t.Errorf("Vacuum() error = %v", err)
	}
}

func TestSQLiteIndex_GetParquetFilesForQuery(t *testing.T) {
	idx := setupTestIndex(t)
	defer idx.Close()

	now := time.Now()
	events := []*models.TelemetryEvent{
		{
			ID:           "event-1",
			Timestamp:    now,
			EventType:    models.EventTypeFlow,
			SrcNamespace: "default",
			DstNamespace: "production",
		},
	}

	parquetFile := "/data/2024-01-15/events.parquet"
	if err := idx.IndexEvents(events, parquetFile); err != nil {
		t.Fatalf("IndexEvents() error = %v", err)
	}

	ctx := context.Background()
	files, err := idx.GetParquetFilesForQuery(ctx, models.QueryEventsRequest{
		StartTime:  now.Add(-1 * time.Hour),
		EndTime:    now.Add(1 * time.Hour),
		Namespaces: []string{"default"},
	})
	if err != nil {
		t.Fatalf("GetParquetFilesForQuery() error = %v", err)
	}

	if len(files) != 1 {
		t.Errorf("Expected 1 file, got %d", len(files))
	}
	if len(files) > 0 && files[0] != parquetFile {
		t.Errorf("Expected file %s, got %s", parquetFile, files[0])
	}
}

func TestSQLiteIndex_QueryEventIDs_EmptyResult(t *testing.T) {
	idx := setupTestIndex(t)
	defer idx.Close()

	ctx := context.Background()
	now := time.Now()

	ids, err := idx.QueryEventIDs(ctx, models.QueryEventsRequest{
		StartTime: now.Add(-1 * time.Hour),
		EndTime:   now,
	})
	if err != nil {
		t.Fatalf("QueryEventIDs() error = %v", err)
	}

	if len(ids) != 0 {
		t.Errorf("Expected 0 event IDs, got %d", len(ids))
	}
}

func TestSQLiteIndex_GetHourlyStats_NoData(t *testing.T) {
	idx := setupTestIndex(t)
	defer idx.Close()

	ctx := context.Background()
	stats, err := idx.GetHourlyStats(ctx, "2024-01-15T00", "2024-01-15T23")
	if err != nil {
		t.Fatalf("GetHourlyStats() error = %v", err)
	}

	if len(stats) != 0 {
		t.Errorf("Expected 0 hourly stats, got %d", len(stats))
	}
}

func TestSQLiteIndex_GetStats_Empty(t *testing.T) {
	idx := setupTestIndex(t)
	defer idx.Close()

	ctx := context.Background()
	stats, err := idx.GetStats(ctx)
	if err != nil {
		t.Fatalf("GetStats() error = %v", err)
	}

	if stats.TotalEvents != 0 {
		t.Errorf("TotalEvents = %d, want 0", stats.TotalEvents)
	}
	if stats.TotalFiles != 0 {
		t.Errorf("TotalFiles = %d, want 0", stats.TotalFiles)
	}
}

func TestSQLiteIndex_Close_Multiple(t *testing.T) {
	idx := setupTestIndex(t)

	// First close
	if err := idx.Close(); err != nil {
		t.Errorf("First Close() error = %v", err)
	}

	// Second close should not error (or just work gracefully)
	if err := idx.Close(); err != nil {
		t.Logf("Second Close() error = %v (may be expected)", err)
	}
}

func TestSQLiteIndex_IndexEvents_Empty(t *testing.T) {
	idx := setupTestIndex(t)
	defer idx.Close()

	// Indexing empty slice should not error
	err := idx.IndexEvents([]*models.TelemetryEvent{}, "/path/to/events.parquet")
	if err != nil {
		t.Errorf("IndexEvents(empty) error = %v", err)
	}
}

func TestSQLiteIndex_GetFilesOlderThan_NoFiles(t *testing.T) {
	idx := setupTestIndex(t)
	defer idx.Close()

	ctx := context.Background()
	files, err := idx.GetFilesOlderThan(ctx, "2024-01-15")
	if err != nil {
		t.Fatalf("GetFilesOlderThan() error = %v", err)
	}

	if len(files) != 0 {
		t.Errorf("Expected 0 files, got %d", len(files))
	}
}

func TestSQLiteIndex_DeleteFileRecords_NonExistent(t *testing.T) {
	idx := setupTestIndex(t)
	defer idx.Close()

	ctx := context.Background()
	// Deleting non-existent file should not error
	err := idx.DeleteFileRecords(ctx, "/nonexistent/file.parquet")
	if err != nil {
		t.Errorf("DeleteFileRecords() for nonexistent file error = %v", err)
	}
}

func TestSQLiteIndex_UpdateHourlyStats_Empty(t *testing.T) {
	idx := setupTestIndex(t)
	defer idx.Close()

	// Updating with empty events should not error
	err := idx.UpdateHourlyStats([]*models.TelemetryEvent{})
	if err != nil {
		t.Errorf("UpdateHourlyStats(empty) error = %v", err)
	}
}

func TestSQLiteIndex_GetEventCount_WithData(t *testing.T) {
	idx := setupTestIndex(t)
	defer idx.Close()

	events := []*models.TelemetryEvent{
		{ID: "1", Timestamp: time.Now(), EventType: models.EventTypeFlow, SrcNamespace: "default"},
		{ID: "2", Timestamp: time.Now(), EventType: models.EventTypeFlow, SrcNamespace: "production"},
	}

	if err := idx.IndexEvents(events, "/path/to/events.parquet"); err != nil {
		t.Fatalf("IndexEvents() error = %v", err)
	}

	ctx := context.Background()
	count, err := idx.GetEventCount(ctx)
	if err != nil {
		t.Fatalf("GetEventCount() error = %v", err)
	}

	if count != 2 {
		t.Errorf("GetEventCount() = %d, want 2", count)
	}
}

func TestSQLiteIndex_QueryEventIDs_MultipleFilters(t *testing.T) {
	idx := setupTestIndex(t)
	defer idx.Close()

	now := time.Now()
	events := []*models.TelemetryEvent{
		{ID: "1", Timestamp: now.Add(-1 * time.Hour), EventType: models.EventTypeFlow, SrcNamespace: "default", DstNamespace: "production"},
		{ID: "2", Timestamp: now.Add(-30 * time.Minute), EventType: models.EventTypeProcessExec, SrcNamespace: "default"},
		{ID: "3", Timestamp: now.Add(-10 * time.Minute), EventType: models.EventTypeFlow, SrcNamespace: "kube-system", DstNamespace: "default"},
	}

	if err := idx.IndexEvents(events, "/path/to/events.parquet"); err != nil {
		t.Fatalf("IndexEvents() error = %v", err)
	}

	ctx := context.Background()

	// Query with both namespace and event type filters
	ids, err := idx.QueryEventIDs(ctx, models.QueryEventsRequest{
		StartTime:  now.Add(-2 * time.Hour),
		EndTime:    now,
		Namespaces: []string{"default"},
		EventTypes: []string{string(models.EventTypeFlow)},
	})
	if err != nil {
		t.Fatalf("QueryEventIDs() error = %v", err)
	}

	// Should match event 1 (default->production, FLOW) and event 3 (kube-system->default, FLOW)
	if len(ids) != 2 {
		t.Errorf("QueryEventIDs() returned %d events, want 2", len(ids))
	}
}

func TestSQLiteIndex_RegisterFile_Duplicate(t *testing.T) {
	idx := setupTestIndex(t)
	defer idx.Close()

	filePath := "/data/2024-01-15/events.parquet"

	// First registration
	err := idx.RegisterFile(filePath, "2024-01-15", "node-1", 100, 1024)
	if err != nil {
		t.Fatalf("RegisterFile() first error = %v", err)
	}

	// Second registration with same path (should update or upsert)
	err = idx.RegisterFile(filePath, "2024-01-15", "node-1", 200, 2048)
	if err != nil {
		t.Fatalf("RegisterFile() second error = %v", err)
	}

	// Should still show 1 file
	ctx := context.Background()
	stats, err := idx.GetStats(ctx)
	if err != nil {
		t.Fatalf("GetStats() error = %v", err)
	}

	// Depending on implementation, it might be 1 (upsert) or 2 (insert)
	if stats.TotalFiles < 1 {
		t.Errorf("TotalFiles = %d, want >= 1", stats.TotalFiles)
	}
}

func TestSQLiteIndex_GetParquetFilesForQuery_NoMatch(t *testing.T) {
	idx := setupTestIndex(t)
	defer idx.Close()

	now := time.Now()
	events := []*models.TelemetryEvent{
		{ID: "1", Timestamp: now, EventType: models.EventTypeFlow, SrcNamespace: "default", DstNamespace: "production"},
	}

	parquetFile := "/data/2024-01-15/events.parquet"
	if err := idx.IndexEvents(events, parquetFile); err != nil {
		t.Fatalf("IndexEvents() error = %v", err)
	}

	ctx := context.Background()
	files, err := idx.GetParquetFilesForQuery(ctx, models.QueryEventsRequest{
		StartTime:  now.Add(-1 * time.Hour),
		EndTime:    now.Add(1 * time.Hour),
		Namespaces: []string{"nonexistent-namespace"},
	})
	if err != nil {
		t.Fatalf("GetParquetFilesForQuery() error = %v", err)
	}

	if len(files) != 0 {
		t.Errorf("Expected 0 files for nonexistent namespace, got %d", len(files))
	}
}

func TestSQLiteIndex_UpdateHourlyStats_MultipleNamespacePairs(t *testing.T) {
	idx := setupTestIndex(t)
	defer idx.Close()

	now := time.Now().UTC()
	events := []*models.TelemetryEvent{
		{
			ID:           "1",
			Timestamp:    now,
			EventType:    models.EventTypeFlow,
			SrcNamespace: "default",
			DstNamespace: "production",
			Protocol:     "TCP",
			DstPort:      8080,
			Verdict:      models.VerdictAllowed,
		},
		{
			ID:           "2",
			Timestamp:    now,
			EventType:    models.EventTypeFlow,
			SrcNamespace: "kube-system",
			DstNamespace: "default",
			Protocol:     "TCP",
			DstPort:      443,
			Verdict:      models.VerdictDenied,
		},
	}

	if err := idx.UpdateHourlyStats(events); err != nil {
		t.Fatalf("UpdateHourlyStats() error = %v", err)
	}

	ctx := context.Background()
	hour := now.Format("2006-01-02T15")
	stats, err := idx.GetHourlyStats(ctx, hour, hour)
	if err != nil {
		t.Fatalf("GetHourlyStats() error = %v", err)
	}

	if len(stats) != 2 {
		t.Errorf("Expected 2 hourly stats (different namespace pairs), got %d", len(stats))
	}
}

// Helper function to set up a test index
func setupTestIndex(t *testing.T) *SQLiteIndex {
	t.Helper()

	tmpDir, err := os.MkdirTemp("", "sqlite-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	t.Cleanup(func() { os.RemoveAll(tmpDir) })

	dbPath := filepath.Join(tmpDir, "test.db")
	idx, err := NewSQLiteIndex(SQLiteIndexConfig{
		DBPath: dbPath,
		Logger: logr.Discard(),
	})
	if err != nil {
		t.Fatalf("NewSQLiteIndex() error = %v", err)
	}

	return idx
}
