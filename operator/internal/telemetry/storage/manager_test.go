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

func TestManager_NewManager(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "manager-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := NewManager(ManagerConfig{
		BasePath:      tmpDir,
		NodeName:      "test-node",
		RetentionDays: 7,
		MaxStorageGB:  100,
		Logger:        logr.Discard(),
	})
	if err != nil {
		t.Fatalf("NewManager() error = %v", err)
	}
	defer mgr.Close()

	if mgr.basePath != tmpDir {
		t.Errorf("basePath = %s, want %s", mgr.basePath, tmpDir)
	}
	if mgr.nodeName != "test-node" {
		t.Errorf("nodeName = %s, want test-node", mgr.nodeName)
	}
}

func TestManager_NewManager_EmptyPath(t *testing.T) {
	_, err := NewManager(ManagerConfig{
		BasePath: "",
		Logger:   logr.Discard(),
	})
	if err == nil {
		t.Error("Expected error for empty path, got nil")
	}
}

func TestManager_Write(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "manager-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := NewManager(ManagerConfig{
		BasePath:      tmpDir,
		NodeName:      "test-node",
		RetentionDays: 7,
		Logger:        logr.Discard(),
	})
	if err != nil {
		t.Fatalf("NewManager() error = %v", err)
	}
	defer mgr.Close()

	events := []*models.TelemetryEvent{
		{
			ID:           "event-1",
			Timestamp:    time.Now(),
			EventType:    models.EventTypeFlow,
			NodeName:     "test-node",
			SrcNamespace: "default",
			DstNamespace: "production",
			Protocol:     "TCP",
			DstPort:      8080,
			Verdict:      models.VerdictAllowed,
		},
		{
			ID:           "event-2",
			Timestamp:    time.Now(),
			EventType:    models.EventTypeFlow,
			NodeName:     "test-node",
			SrcNamespace: "production",
			DstNamespace: "kube-system",
			Protocol:     "TCP",
			DstPort:      443,
			Verdict:      models.VerdictDenied,
		},
	}

	if err := mgr.Write(events); err != nil {
		t.Fatalf("Write() error = %v", err)
	}
}

func TestManager_Write_Empty(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "manager-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := NewManager(ManagerConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("NewManager() error = %v", err)
	}
	defer mgr.Close()

	// Writing empty slice should not error
	if err := mgr.Write([]*models.TelemetryEvent{}); err != nil {
		t.Errorf("Write(empty) error = %v", err)
	}
}

func TestManager_Query(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "manager-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := NewManager(ManagerConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("NewManager() error = %v", err)
	}

	// Use UTC for consistent date handling
	now := time.Now().UTC()
	events := []*models.TelemetryEvent{
		{
			ID:           "event-1",
			Timestamp:    now,
			EventType:    models.EventTypeFlow,
			NodeName:     "test-node",
			SrcNamespace: "default",
			DstNamespace: "production",
		},
		{
			ID:           "event-2",
			Timestamp:    now,
			EventType:    models.EventTypeFlow,
			NodeName:     "test-node",
			SrcNamespace: "production",
			DstNamespace: "kube-system",
		},
	}

	if err := mgr.Write(events); err != nil {
		t.Fatalf("Write() error = %v", err)
	}

	// Close the manager to ensure all data is flushed
	if err := mgr.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	// Create a new reader to verify events were written
	parquetPath := filepath.Join(tmpDir, "parquet")
	reader := NewParquetReader(parquetPath, logr.Discard())

	ctx := context.Background()
	result, err := reader.ReadEvents(ctx, models.QueryEventsRequest{
		StartTime: now.Add(-1 * time.Hour),
		EndTime:   now.Add(1 * time.Hour),
	})
	if err != nil {
		t.Fatalf("ReadEvents() error = %v", err)
	}

	if len(result.Events) != 2 {
		// List files for debugging
		dates, _ := reader.ListDates()
		t.Errorf("ReadEvents() returned %d events, want 2. Dates found: %v", len(result.Events), dates)
	}
}

func TestManager_Query_WithNamespaceFilter(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "manager-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := NewManager(ManagerConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("NewManager() error = %v", err)
	}

	// Use UTC for consistent date handling
	now := time.Now().UTC()
	events := []*models.TelemetryEvent{
		{ID: "1", Timestamp: now, EventType: models.EventTypeFlow, SrcNamespace: "default"},
		{ID: "2", Timestamp: now, EventType: models.EventTypeFlow, SrcNamespace: "production"},
		{ID: "3", Timestamp: now, EventType: models.EventTypeFlow, SrcNamespace: "default"},
	}

	if err := mgr.Write(events); err != nil {
		t.Fatalf("Write() error = %v", err)
	}

	// Close the manager to ensure all data is flushed
	if err := mgr.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	// Create a new reader to verify namespace filtering works
	parquetPath := filepath.Join(tmpDir, "parquet")
	reader := NewParquetReader(parquetPath, logr.Discard())

	ctx := context.Background()
	result, err := reader.ReadEvents(ctx, models.QueryEventsRequest{
		StartTime:  now.Add(-1 * time.Hour),
		EndTime:    now.Add(1 * time.Hour),
		Namespaces: []string{"default"},
	})
	if err != nil {
		t.Fatalf("ReadEvents() error = %v", err)
	}

	if len(result.Events) != 2 {
		t.Errorf("ReadEvents(namespace=default) returned %d events, want 2", len(result.Events))
	}
}

func TestManager_Start(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "manager-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := NewManager(ManagerConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("NewManager() error = %v", err)
	}
	defer mgr.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := mgr.Start(ctx); err != nil {
		t.Fatalf("Start() error = %v", err)
	}

	// Starting again should be a no-op
	if err := mgr.Start(ctx); err != nil {
		t.Fatalf("Start() second call error = %v", err)
	}
}

func TestManager_GetStats(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "manager-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := NewManager(ManagerConfig{
		BasePath:      tmpDir,
		NodeName:      "test-node",
		RetentionDays: 7,
		MaxStorageGB:  100,
		Logger:        logr.Discard(),
	})
	if err != nil {
		t.Fatalf("NewManager() error = %v", err)
	}
	defer mgr.Close()

	// Write some events
	events := []*models.TelemetryEvent{
		{ID: "1", Timestamp: time.Now(), EventType: models.EventTypeFlow, NodeName: "test-node"},
	}
	if err := mgr.Write(events); err != nil {
		t.Fatalf("Write() error = %v", err)
	}

	ctx := context.Background()
	stats, err := mgr.GetStats(ctx)
	if err != nil {
		t.Fatalf("GetStats() error = %v", err)
	}

	if stats.IndexStats == nil {
		t.Error("IndexStats should not be nil")
	}
	if stats.RetentionStats == nil {
		t.Error("RetentionStats should not be nil")
	}
	if stats.WriterStats.EventCount != 1 {
		t.Errorf("WriterStats.EventCount = %d, want 1", stats.WriterStats.EventCount)
	}
}

func TestManager_Flush(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "manager-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := NewManager(ManagerConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("NewManager() error = %v", err)
	}
	defer mgr.Close()

	// Write some events
	events := []*models.TelemetryEvent{
		{ID: "1", Timestamp: time.Now(), EventType: models.EventTypeFlow, NodeName: "test-node"},
	}
	if err := mgr.Write(events); err != nil {
		t.Fatalf("Write() error = %v", err)
	}

	// Flush should not error
	if err := mgr.Flush(); err != nil {
		t.Errorf("Flush() error = %v", err)
	}
}

func TestManager_Close(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "manager-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := NewManager(ManagerConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("NewManager() error = %v", err)
	}

	// Close should not error
	if err := mgr.Close(); err != nil {
		t.Errorf("Close() error = %v", err)
	}
}

func TestManager_GetIndex(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "manager-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := NewManager(ManagerConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("NewManager() error = %v", err)
	}
	defer mgr.Close()

	idx := mgr.GetIndex()
	if idx == nil {
		t.Error("GetIndex() returned nil")
	}
}

func TestManager_GetReader(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "manager-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	mgr, err := NewManager(ManagerConfig{
		BasePath: tmpDir,
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})
	if err != nil {
		t.Fatalf("NewManager() error = %v", err)
	}
	defer mgr.Close()

	reader := mgr.GetReader()
	if reader == nil {
		t.Error("GetReader() returned nil")
	}
}
