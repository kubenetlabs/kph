package storage

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/go-logr/logr"
)

func TestRetentionWorker_NewRetentionWorker(t *testing.T) {
	rw := NewRetentionWorker(RetentionWorkerConfig{
		BasePath:      "/tmp/test",
		RetentionDays: 7,
		MaxStorageGB:  100,
		Logger:        logr.Discard(),
	})

	if rw.retentionDays != 7 {
		t.Errorf("retentionDays = %d, want 7", rw.retentionDays)
	}
	if rw.maxStorageGB != 100 {
		t.Errorf("maxStorageGB = %d, want 100", rw.maxStorageGB)
	}
}

func TestRetentionWorker_NewRetentionWorker_Defaults(t *testing.T) {
	rw := NewRetentionWorker(RetentionWorkerConfig{
		BasePath: "/tmp/test",
		Logger:   logr.Discard(),
	})

	if rw.retentionDays != 7 {
		t.Errorf("default retentionDays = %d, want 7", rw.retentionDays)
	}
	if rw.maxStorageGB != 100 {
		t.Errorf("default maxStorageGB = %d, want 100", rw.maxStorageGB)
	}
	if rw.cleanupInterval != time.Hour {
		t.Errorf("default cleanupInterval = %v, want 1h", rw.cleanupInterval)
	}
}

func TestRetentionWorker_GetRetentionStats(t *testing.T) {
	tmpDir := setupRetentionTestDir(t)

	rw := NewRetentionWorker(RetentionWorkerConfig{
		BasePath:      tmpDir,
		RetentionDays: 7,
		MaxStorageGB:  100,
		Logger:        logr.Discard(),
	})

	stats, err := rw.GetRetentionStats()
	if err != nil {
		t.Fatalf("GetRetentionStats() error = %v", err)
	}

	if stats.RetentionDays != 7 {
		t.Errorf("RetentionDays = %d, want 7", stats.RetentionDays)
	}
	if stats.MaxStorageGB != 100 {
		t.Errorf("MaxStorageGB = %d, want 100", stats.MaxStorageGB)
	}
	if stats.CutoffDate == "" {
		t.Error("CutoffDate should not be empty")
	}
}

func TestRetentionWorker_GetRetentionStats_WithData(t *testing.T) {
	tmpDir := setupRetentionTestDir(t)

	// Create date directories with files
	dates := []string{
		time.Now().AddDate(0, 0, -1).Format("2006-01-02"),
		time.Now().AddDate(0, 0, -2).Format("2006-01-02"),
		time.Now().AddDate(0, 0, -3).Format("2006-01-02"),
	}

	for _, date := range dates {
		dateDir := filepath.Join(tmpDir, date)
		if err := os.MkdirAll(dateDir, 0755); err != nil {
			t.Fatalf("Failed to create date dir: %v", err)
		}
		// Create a dummy file
		if err := os.WriteFile(filepath.Join(dateDir, "events.parquet"), []byte("test"), 0644); err != nil {
			t.Fatalf("Failed to create test file: %v", err)
		}
	}

	rw := NewRetentionWorker(RetentionWorkerConfig{
		BasePath:      tmpDir,
		RetentionDays: 7,
		MaxStorageGB:  100,
		Logger:        logr.Discard(),
	})

	stats, err := rw.GetRetentionStats()
	if err != nil {
		t.Fatalf("GetRetentionStats() error = %v", err)
	}

	if stats.DaysStored != 3 {
		t.Errorf("DaysStored = %d, want 3", stats.DaysStored)
	}
	if stats.CurrentStorageBytes == 0 {
		t.Error("CurrentStorageBytes should be > 0")
	}
}

func TestRetentionWorker_CleanupOldData(t *testing.T) {
	tmpDir := setupRetentionTestDir(t)

	// Create old and new date directories
	oldDate := time.Now().AddDate(0, 0, -10).Format("2006-01-02")
	newDate := time.Now().AddDate(0, 0, -1).Format("2006-01-02")

	for _, date := range []string{oldDate, newDate} {
		dateDir := filepath.Join(tmpDir, date)
		if err := os.MkdirAll(dateDir, 0755); err != nil {
			t.Fatalf("Failed to create date dir: %v", err)
		}
		if err := os.WriteFile(filepath.Join(dateDir, "events.parquet"), []byte("test"), 0644); err != nil {
			t.Fatalf("Failed to create test file: %v", err)
		}
	}

	rw := NewRetentionWorker(RetentionWorkerConfig{
		BasePath:      tmpDir,
		RetentionDays: 7,
		MaxStorageGB:  100,
		Logger:        logr.Discard(),
	})

	ctx := context.Background()
	if err := rw.RunCleanup(ctx); err != nil {
		t.Fatalf("RunCleanup() error = %v", err)
	}

	// Old directory should be deleted
	if _, err := os.Stat(filepath.Join(tmpDir, oldDate)); !os.IsNotExist(err) {
		t.Error("Old date directory should have been deleted")
	}

	// New directory should still exist
	if _, err := os.Stat(filepath.Join(tmpDir, newDate)); os.IsNotExist(err) {
		t.Error("New date directory should still exist")
	}
}

func TestRetentionWorker_CleanupEmptyDirs(t *testing.T) {
	tmpDir := setupRetentionTestDir(t)

	// Create an empty directory
	emptyDir := filepath.Join(tmpDir, "2024-01-01")
	if err := os.MkdirAll(emptyDir, 0755); err != nil {
		t.Fatalf("Failed to create empty dir: %v", err)
	}

	// Create a non-empty directory
	nonEmptyDir := filepath.Join(tmpDir, "2024-01-02")
	if err := os.MkdirAll(nonEmptyDir, 0755); err != nil {
		t.Fatalf("Failed to create non-empty dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(nonEmptyDir, "test.txt"), []byte("test"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	rw := NewRetentionWorker(RetentionWorkerConfig{
		BasePath:      tmpDir,
		RetentionDays: 365, // Don't delete by age
		MaxStorageGB:  1000,
		Logger:        logr.Discard(),
	})

	ctx := context.Background()
	if err := rw.cleanupEmptyDirs(ctx); err != nil {
		t.Fatalf("cleanupEmptyDirs() error = %v", err)
	}

	// Empty directory should be deleted
	if _, err := os.Stat(emptyDir); !os.IsNotExist(err) {
		t.Error("Empty directory should have been deleted")
	}

	// Non-empty directory should still exist
	if _, err := os.Stat(nonEmptyDir); os.IsNotExist(err) {
		t.Error("Non-empty directory should still exist")
	}
}

func TestRetentionWorker_GetSortedDates(t *testing.T) {
	tmpDir := setupRetentionTestDir(t)

	// Create directories in random order
	dates := []string{"2024-01-15", "2024-01-10", "2024-01-20", "2024-01-05"}
	for _, date := range dates {
		if err := os.MkdirAll(filepath.Join(tmpDir, date), 0755); err != nil {
			t.Fatalf("Failed to create dir: %v", err)
		}
	}

	// Create a non-date directory (should be ignored)
	if err := os.MkdirAll(filepath.Join(tmpDir, "not-a-date"), 0755); err != nil {
		t.Fatalf("Failed to create dir: %v", err)
	}

	rw := NewRetentionWorker(RetentionWorkerConfig{
		BasePath: tmpDir,
		Logger:   logr.Discard(),
	})

	sortedDates, err := rw.getSortedDates()
	if err != nil {
		t.Fatalf("getSortedDates() error = %v", err)
	}

	if len(sortedDates) != 4 {
		t.Fatalf("Expected 4 dates, got %d", len(sortedDates))
	}

	expected := []string{"2024-01-05", "2024-01-10", "2024-01-15", "2024-01-20"}
	for i, date := range sortedDates {
		if date != expected[i] {
			t.Errorf("Date at index %d = %s, want %s", i, date, expected[i])
		}
	}
}

func TestRetentionWorker_GetStorageSize(t *testing.T) {
	tmpDir := setupRetentionTestDir(t)

	// Create files with known sizes
	dateDir := filepath.Join(tmpDir, "2024-01-15")
	if err := os.MkdirAll(dateDir, 0755); err != nil {
		t.Fatalf("Failed to create dir: %v", err)
	}

	// Create a file with 1000 bytes
	data := make([]byte, 1000)
	if err := os.WriteFile(filepath.Join(dateDir, "test.parquet"), data, 0644); err != nil {
		t.Fatalf("Failed to create file: %v", err)
	}

	rw := NewRetentionWorker(RetentionWorkerConfig{
		BasePath: tmpDir,
		Logger:   logr.Discard(),
	})

	size, err := rw.getStorageSize()
	if err != nil {
		t.Fatalf("getStorageSize() error = %v", err)
	}

	if size != 1000 {
		t.Errorf("getStorageSize() = %d, want 1000", size)
	}
}

func TestRetentionWorker_ContextCancellation(t *testing.T) {
	tmpDir := setupRetentionTestDir(t)

	rw := NewRetentionWorker(RetentionWorkerConfig{
		BasePath:      tmpDir,
		RetentionDays: 7,
		Logger:        logr.Discard(),
	})

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	// Should return without error due to cancelled context
	err := rw.RunCleanup(ctx)
	if err != nil && err != context.Canceled {
		t.Errorf("RunCleanup() with cancelled context error = %v", err)
	}
}

func TestIsDirEmpty(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "isdirempty-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Empty directory
	emptyDir := filepath.Join(tmpDir, "empty")
	if err := os.MkdirAll(emptyDir, 0755); err != nil {
		t.Fatalf("Failed to create empty dir: %v", err)
	}

	empty, err := isDirEmpty(emptyDir)
	if err != nil {
		t.Fatalf("isDirEmpty() error = %v", err)
	}
	if !empty {
		t.Error("Expected empty directory to return true")
	}

	// Non-empty directory
	nonEmptyDir := filepath.Join(tmpDir, "nonempty")
	if err := os.MkdirAll(nonEmptyDir, 0755); err != nil {
		t.Fatalf("Failed to create non-empty dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(nonEmptyDir, "file.txt"), []byte("test"), 0644); err != nil {
		t.Fatalf("Failed to create file: %v", err)
	}

	empty, err = isDirEmpty(nonEmptyDir)
	if err != nil {
		t.Fatalf("isDirEmpty() error = %v", err)
	}
	if empty {
		t.Error("Expected non-empty directory to return false")
	}
}

func TestGetDirSize(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "getdirsize-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Create files with known sizes
	if err := os.WriteFile(filepath.Join(tmpDir, "file1.txt"), make([]byte, 100), 0644); err != nil {
		t.Fatalf("Failed to create file: %v", err)
	}
	if err := os.WriteFile(filepath.Join(tmpDir, "file2.txt"), make([]byte, 200), 0644); err != nil {
		t.Fatalf("Failed to create file: %v", err)
	}

	size, err := getDirSize(tmpDir)
	if err != nil {
		t.Fatalf("getDirSize() error = %v", err)
	}

	if size != 300 {
		t.Errorf("getDirSize() = %d, want 300", size)
	}
}

// Helper function to set up a test directory
func setupRetentionTestDir(t *testing.T) string {
	t.Helper()

	tmpDir, err := os.MkdirTemp("", "retention-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	t.Cleanup(func() { os.RemoveAll(tmpDir) })

	return tmpDir
}
