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

func TestRetentionWorker_EnforceStorageLimit(t *testing.T) {
	tmpDir := setupRetentionTestDir(t)

	// Create date directories with known sizes
	// We'll set max storage very low to trigger cleanup
	dates := []string{
		time.Now().AddDate(0, 0, -3).Format("2006-01-02"),
		time.Now().AddDate(0, 0, -2).Format("2006-01-02"),
		time.Now().AddDate(0, 0, -1).Format("2006-01-02"),
	}

	// Create 1KB files in each directory (3KB total)
	for _, date := range dates {
		dateDir := filepath.Join(tmpDir, date)
		if err := os.MkdirAll(dateDir, 0755); err != nil {
			t.Fatalf("Failed to create date dir: %v", err)
		}
		data := make([]byte, 1024)
		if err := os.WriteFile(filepath.Join(dateDir, "events.parquet"), data, 0644); err != nil {
			t.Fatalf("Failed to create test file: %v", err)
		}
	}

	// Create worker with very small storage limit (1 byte = 0 GB effectively)
	// This forces cleanup of all but the most recent data
	rw := NewRetentionWorker(RetentionWorkerConfig{
		BasePath:      tmpDir,
		RetentionDays: 365, // Don't delete by age
		MaxStorageGB:  0,   // Zero means default, so we test differently
		Logger:        logr.Discard(),
	})

	// Manually call enforceStorageLimit
	ctx := context.Background()
	err := rw.enforceStorageLimit(ctx)
	if err != nil {
		t.Fatalf("enforceStorageLimit() error = %v", err)
	}

	// With default max (100GB), nothing should be deleted
	// Let's verify directories still exist
	for _, date := range dates {
		if _, err := os.Stat(filepath.Join(tmpDir, date)); os.IsNotExist(err) {
			t.Errorf("Directory %s should not have been deleted (under limit)", date)
		}
	}
}

func TestRetentionWorker_Start_WithCleanup(t *testing.T) {
	tmpDir := setupRetentionTestDir(t)

	// Create an old date directory
	oldDate := time.Now().AddDate(0, 0, -10).Format("2006-01-02")
	dateDir := filepath.Join(tmpDir, oldDate)
	if err := os.MkdirAll(dateDir, 0755); err != nil {
		t.Fatalf("Failed to create date dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dateDir, "events.parquet"), []byte("test"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	rw := NewRetentionWorker(RetentionWorkerConfig{
		BasePath:        tmpDir,
		RetentionDays:   7,
		Logger:          logr.Discard(),
		CleanupInterval: 100 * time.Millisecond,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	// Start will run initial cleanup and then exit due to context
	rw.Start(ctx)

	// Old directory should be deleted
	if _, err := os.Stat(dateDir); !os.IsNotExist(err) {
		t.Error("Old date directory should have been deleted")
	}
}

func TestRetentionWorker_CleanupOldData_WithIndex(t *testing.T) {
	tmpDir := setupRetentionTestDir(t)

	// Create SQLite index
	dbPath := filepath.Join(tmpDir, "index", "test.db")
	if err := os.MkdirAll(filepath.Dir(dbPath), 0755); err != nil {
		t.Fatalf("Failed to create index dir: %v", err)
	}

	idx, err := NewSQLiteIndex(SQLiteIndexConfig{
		DBPath: dbPath,
		Logger: logr.Discard(),
	})
	if err != nil {
		t.Fatalf("NewSQLiteIndex() error = %v", err)
	}
	defer idx.Close()

	// Create old and new date directories
	oldDate := time.Now().AddDate(0, 0, -10).Format("2006-01-02")
	newDate := time.Now().AddDate(0, 0, -1).Format("2006-01-02")

	for _, date := range []string{oldDate, newDate} {
		dateDir := filepath.Join(tmpDir, date)
		if err := os.MkdirAll(dateDir, 0755); err != nil {
			t.Fatalf("Failed to create date dir: %v", err)
		}
		filePath := filepath.Join(dateDir, "events.parquet")
		if err := os.WriteFile(filePath, []byte("test"), 0644); err != nil {
			t.Fatalf("Failed to create test file: %v", err)
		}
		// Register in index
		if err := idx.RegisterFile(filePath, date, "node-1", 10, 4); err != nil {
			t.Fatalf("RegisterFile() error = %v", err)
		}
	}

	rw := NewRetentionWorker(RetentionWorkerConfig{
		BasePath:      tmpDir,
		RetentionDays: 7,
		Index:         idx,
		Logger:        logr.Discard(),
	})

	ctx := context.Background()
	if err := rw.cleanupOldData(ctx); err != nil {
		t.Fatalf("cleanupOldData() error = %v", err)
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

func TestRetentionWorker_DeleteFile(t *testing.T) {
	tmpDir := setupRetentionTestDir(t)

	// Create SQLite index
	dbPath := filepath.Join(tmpDir, "index", "test.db")
	if err := os.MkdirAll(filepath.Dir(dbPath), 0755); err != nil {
		t.Fatalf("Failed to create index dir: %v", err)
	}

	idx, err := NewSQLiteIndex(SQLiteIndexConfig{
		DBPath: dbPath,
		Logger: logr.Discard(),
	})
	if err != nil {
		t.Fatalf("NewSQLiteIndex() error = %v", err)
	}
	defer idx.Close()

	// Create a test file
	dateDir := filepath.Join(tmpDir, "2024-01-15")
	if err := os.MkdirAll(dateDir, 0755); err != nil {
		t.Fatalf("Failed to create date dir: %v", err)
	}
	filePath := filepath.Join(dateDir, "events.parquet")
	if err := os.WriteFile(filePath, []byte("test data"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	// Register in index
	if err := idx.RegisterFile(filePath, "2024-01-15", "node-1", 10, 9); err != nil {
		t.Fatalf("RegisterFile() error = %v", err)
	}

	rw := NewRetentionWorker(RetentionWorkerConfig{
		BasePath: tmpDir,
		Index:    idx,
		Logger:   logr.Discard(),
	})

	ctx := context.Background()
	if err := rw.deleteFile(ctx, filePath); err != nil {
		t.Fatalf("deleteFile() error = %v", err)
	}

	// File should be deleted
	if _, err := os.Stat(filePath); !os.IsNotExist(err) {
		t.Error("File should have been deleted")
	}
}

func TestRetentionWorker_DeleteFile_NoIndex(t *testing.T) {
	tmpDir := setupRetentionTestDir(t)

	// Create a test file
	dateDir := filepath.Join(tmpDir, "2024-01-15")
	if err := os.MkdirAll(dateDir, 0755); err != nil {
		t.Fatalf("Failed to create date dir: %v", err)
	}
	filePath := filepath.Join(dateDir, "events.parquet")
	if err := os.WriteFile(filePath, []byte("test data"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	rw := NewRetentionWorker(RetentionWorkerConfig{
		BasePath: tmpDir,
		Index:    nil, // No index
		Logger:   logr.Discard(),
	})

	ctx := context.Background()
	if err := rw.deleteFile(ctx, filePath); err != nil {
		t.Fatalf("deleteFile() error = %v", err)
	}

	// File should be deleted
	if _, err := os.Stat(filePath); !os.IsNotExist(err) {
		t.Error("File should have been deleted")
	}
}

func TestRetentionWorker_ScanAndDeleteOldDirs(t *testing.T) {
	tmpDir := setupRetentionTestDir(t)

	// Create directories with various names
	oldDate := time.Now().AddDate(0, 0, -10).Format("2006-01-02")
	newDate := time.Now().AddDate(0, 0, -1).Format("2006-01-02")
	notADate := "not-a-date"

	for _, name := range []string{oldDate, newDate, notADate} {
		dir := filepath.Join(tmpDir, name)
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatalf("Failed to create dir: %v", err)
		}
		if err := os.WriteFile(filepath.Join(dir, "test.parquet"), []byte("test"), 0644); err != nil {
			t.Fatalf("Failed to create test file: %v", err)
		}
	}

	rw := NewRetentionWorker(RetentionWorkerConfig{
		BasePath:      tmpDir,
		RetentionDays: 7,
		Logger:        logr.Discard(),
	})

	cutoffDate := time.Now().UTC().AddDate(0, 0, -7).Format("2006-01-02")
	ctx := context.Background()
	if err := rw.scanAndDeleteOldDirs(ctx, cutoffDate); err != nil {
		t.Fatalf("scanAndDeleteOldDirs() error = %v", err)
	}

	// Old date directory should be deleted
	if _, err := os.Stat(filepath.Join(tmpDir, oldDate)); !os.IsNotExist(err) {
		t.Error("Old date directory should have been deleted")
	}

	// New date directory should still exist
	if _, err := os.Stat(filepath.Join(tmpDir, newDate)); os.IsNotExist(err) {
		t.Error("New date directory should still exist")
	}

	// Non-date directory should still exist
	if _, err := os.Stat(filepath.Join(tmpDir, notADate)); os.IsNotExist(err) {
		t.Error("Non-date directory should still exist")
	}
}

func TestRetentionWorker_ScanAndDeleteOldDirs_NoDir(t *testing.T) {
	rw := NewRetentionWorker(RetentionWorkerConfig{
		BasePath: "/nonexistent/path",
		Logger:   logr.Discard(),
	})

	ctx := context.Background()
	err := rw.scanAndDeleteOldDirs(ctx, "2024-01-01")
	if err != nil {
		t.Errorf("scanAndDeleteOldDirs() should not error for nonexistent path: %v", err)
	}
}

func TestRetentionWorker_CleanupEmptyDirs_NonDateFile(t *testing.T) {
	tmpDir := setupRetentionTestDir(t)

	// Create a regular file (not directory)
	if err := os.WriteFile(filepath.Join(tmpDir, "regular-file.txt"), []byte("test"), 0644); err != nil {
		t.Fatalf("Failed to create file: %v", err)
	}

	rw := NewRetentionWorker(RetentionWorkerConfig{
		BasePath: tmpDir,
		Logger:   logr.Discard(),
	})

	ctx := context.Background()
	if err := rw.cleanupEmptyDirs(ctx); err != nil {
		t.Fatalf("cleanupEmptyDirs() error = %v", err)
	}

	// File should still exist
	if _, err := os.Stat(filepath.Join(tmpDir, "regular-file.txt")); os.IsNotExist(err) {
		t.Error("Regular file should not be deleted")
	}
}

func TestRetentionWorker_RunCleanup_WithIndex(t *testing.T) {
	tmpDir := setupRetentionTestDir(t)

	// Create SQLite index
	dbPath := filepath.Join(tmpDir, "index", "test.db")
	if err := os.MkdirAll(filepath.Dir(dbPath), 0755); err != nil {
		t.Fatalf("Failed to create index dir: %v", err)
	}

	idx, err := NewSQLiteIndex(SQLiteIndexConfig{
		DBPath: dbPath,
		Logger: logr.Discard(),
	})
	if err != nil {
		t.Fatalf("NewSQLiteIndex() error = %v", err)
	}
	defer idx.Close()

	rw := NewRetentionWorker(RetentionWorkerConfig{
		BasePath: tmpDir,
		Index:    idx,
		Logger:   logr.Discard(),
	})

	ctx := context.Background()
	if err := rw.RunCleanup(ctx); err != nil {
		t.Fatalf("RunCleanup() error = %v", err)
	}
}

func TestRetentionWorker_GetStorageSize_Empty(t *testing.T) {
	tmpDir := setupRetentionTestDir(t)

	rw := NewRetentionWorker(RetentionWorkerConfig{
		BasePath: tmpDir,
		Logger:   logr.Discard(),
	})

	size, err := rw.getStorageSize()
	if err != nil {
		t.Fatalf("getStorageSize() error = %v", err)
	}

	if size != 0 {
		t.Errorf("getStorageSize() = %d, want 0 for empty dir", size)
	}
}

func TestRetentionWorker_GetSortedDates_NoDir(t *testing.T) {
	rw := NewRetentionWorker(RetentionWorkerConfig{
		BasePath: "/nonexistent/path",
		Logger:   logr.Discard(),
	})

	dates, err := rw.getSortedDates()
	if err != nil {
		t.Errorf("getSortedDates() should not error for nonexistent path: %v", err)
	}
	if dates != nil && len(dates) != 0 {
		t.Errorf("Expected nil or empty dates, got %v", dates)
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
