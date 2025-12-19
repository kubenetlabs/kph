package storage

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/go-logr/logr"
)

// RetentionWorker handles cleanup of old telemetry data.
type RetentionWorker struct {
	basePath      string
	retentionDays int
	maxStorageGB  int64
	index         *SQLiteIndex
	log           logr.Logger

	// Cleanup interval
	cleanupInterval time.Duration
}

// RetentionWorkerConfig contains configuration for the retention worker.
type RetentionWorkerConfig struct {
	// BasePath is the directory containing telemetry data
	BasePath string
	// RetentionDays is the number of days to retain data (default: 7)
	RetentionDays int
	// MaxStorageGB is the maximum storage in GB (default: 100)
	MaxStorageGB int64
	// Index is the SQLite index for metadata management
	Index *SQLiteIndex
	// CleanupInterval is how often to run cleanup (default: 1 hour)
	CleanupInterval time.Duration
	// Logger for logging
	Logger logr.Logger
}

// NewRetentionWorker creates a new retention worker.
func NewRetentionWorker(cfg RetentionWorkerConfig) *RetentionWorker {
	retentionDays := cfg.RetentionDays
	if retentionDays <= 0 {
		retentionDays = 7
	}

	maxStorageGB := cfg.MaxStorageGB
	if maxStorageGB <= 0 {
		maxStorageGB = 100
	}

	cleanupInterval := cfg.CleanupInterval
	if cleanupInterval <= 0 {
		cleanupInterval = time.Hour
	}

	return &RetentionWorker{
		basePath:        cfg.BasePath,
		retentionDays:   retentionDays,
		maxStorageGB:    maxStorageGB,
		index:           cfg.Index,
		log:             cfg.Logger.WithName("retention-worker"),
		cleanupInterval: cleanupInterval,
	}
}

// Start begins the retention worker loop.
func (rw *RetentionWorker) Start(ctx context.Context) {
	rw.log.Info("Starting retention worker",
		"retentionDays", rw.retentionDays,
		"maxStorageGB", rw.maxStorageGB,
		"interval", rw.cleanupInterval,
	)

	// Run initial cleanup
	if err := rw.RunCleanup(ctx); err != nil {
		rw.log.Error(err, "Initial cleanup failed")
	}

	ticker := time.NewTicker(rw.cleanupInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			rw.log.Info("Retention worker stopping")
			return
		case <-ticker.C:
			if err := rw.RunCleanup(ctx); err != nil {
				rw.log.Error(err, "Cleanup failed")
			}
		}
	}
}

// RunCleanup performs a cleanup cycle.
func (rw *RetentionWorker) RunCleanup(ctx context.Context) error {
	rw.log.V(1).Info("Running cleanup cycle")

	// 1. Delete data older than retention period
	if err := rw.cleanupOldData(ctx); err != nil {
		rw.log.Error(err, "Failed to cleanup old data")
	}

	// 2. Enforce storage limit
	if err := rw.enforceStorageLimit(ctx); err != nil {
		rw.log.Error(err, "Failed to enforce storage limit")
	}

	// 3. Cleanup empty directories
	if err := rw.cleanupEmptyDirs(ctx); err != nil {
		rw.log.Error(err, "Failed to cleanup empty directories")
	}

	// 4. Vacuum SQLite database periodically
	if rw.index != nil {
		if err := rw.index.Vacuum(); err != nil {
			rw.log.Error(err, "Failed to vacuum index")
		}
	}

	return nil
}

// cleanupOldData removes data older than the retention period.
func (rw *RetentionWorker) cleanupOldData(ctx context.Context) error {
	cutoffDate := time.Now().UTC().AddDate(0, 0, -rw.retentionDays).Format("2006-01-02")
	rw.log.V(1).Info("Cleaning up data before cutoff", "cutoffDate", cutoffDate)

	// Get old files from index
	if rw.index != nil {
		files, err := rw.index.GetFilesOlderThan(ctx, cutoffDate)
		if err != nil {
			return fmt.Errorf("failed to get old files: %w", err)
		}

		for _, file := range files {
			select {
			case <-ctx.Done():
				return ctx.Err()
			default:
			}

			if err := rw.deleteFile(ctx, file); err != nil {
				rw.log.Error(err, "Failed to delete file", "path", file)
			}
		}
	}

	// Also scan filesystem for any orphaned files
	return rw.scanAndDeleteOldDirs(ctx, cutoffDate)
}

// scanAndDeleteOldDirs scans the filesystem for old date directories.
func (rw *RetentionWorker) scanAndDeleteOldDirs(ctx context.Context, cutoffDate string) error {
	entries, err := os.ReadDir(rw.basePath)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("failed to read base path: %w", err)
	}

	for _, entry := range entries {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		if !entry.IsDir() {
			continue
		}

		// Check if it's a date directory
		dirDate := entry.Name()
		if _, err := time.Parse("2006-01-02", dirDate); err != nil {
			continue // Not a date directory
		}

		if dirDate < cutoffDate {
			dirPath := filepath.Join(rw.basePath, dirDate)
			rw.log.Info("Removing old date directory", "path", dirPath)

			// Delete all files in directory
			files, _ := filepath.Glob(filepath.Join(dirPath, "*.parquet"))
			for _, file := range files {
				if err := rw.deleteFile(ctx, file); err != nil {
					rw.log.Error(err, "Failed to delete file", "path", file)
				}
			}

			// Remove directory
			if err := os.Remove(dirPath); err != nil && !os.IsNotExist(err) {
				rw.log.Error(err, "Failed to remove directory", "path", dirPath)
			}
		}
	}

	return nil
}

// enforceStorageLimit deletes oldest data if storage exceeds limit.
func (rw *RetentionWorker) enforceStorageLimit(ctx context.Context) error {
	maxBytes := rw.maxStorageGB * 1024 * 1024 * 1024

	currentSize, err := rw.getStorageSize()
	if err != nil {
		return fmt.Errorf("failed to get storage size: %w", err)
	}

	if currentSize <= maxBytes {
		return nil
	}

	rw.log.Info("Storage limit exceeded, cleaning up",
		"currentGB", float64(currentSize)/(1024*1024*1024),
		"maxGB", rw.maxStorageGB,
	)

	// Get all date directories sorted oldest first
	dates, err := rw.getSortedDates()
	if err != nil {
		return err
	}

	// Delete oldest data until under limit
	for _, date := range dates {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		dirPath := filepath.Join(rw.basePath, date)
		dirSize, _ := getDirSize(dirPath)

		rw.log.Info("Deleting date directory to free space", "date", date, "sizeGB", float64(dirSize)/(1024*1024*1024))

		// Delete files
		files, _ := filepath.Glob(filepath.Join(dirPath, "*.parquet"))
		for _, file := range files {
			if err := rw.deleteFile(ctx, file); err != nil {
				rw.log.Error(err, "Failed to delete file", "path", file)
			}
		}

		// Remove directory
		os.Remove(dirPath)

		currentSize -= dirSize
		if currentSize <= maxBytes {
			break
		}
	}

	return nil
}

// deleteFile deletes a Parquet file and its index entries.
func (rw *RetentionWorker) deleteFile(ctx context.Context, filePath string) error {
	// Delete from index first
	if rw.index != nil {
		if err := rw.index.DeleteFileRecords(ctx, filePath); err != nil {
			rw.log.Error(err, "Failed to delete index records", "path", filePath)
		}
	}

	// Delete file
	if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete file: %w", err)
	}

	rw.log.V(1).Info("Deleted file", "path", filePath)
	return nil
}

// cleanupEmptyDirs removes empty date directories.
func (rw *RetentionWorker) cleanupEmptyDirs(ctx context.Context) error {
	entries, err := os.ReadDir(rw.basePath)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}

	for _, entry := range entries {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		if !entry.IsDir() {
			continue
		}

		dirPath := filepath.Join(rw.basePath, entry.Name())
		isEmpty, err := isDirEmpty(dirPath)
		if err != nil {
			continue
		}

		if isEmpty {
			rw.log.V(1).Info("Removing empty directory", "path", dirPath)
			os.Remove(dirPath)
		}
	}

	return nil
}

// getStorageSize returns the total size of stored data.
func (rw *RetentionWorker) getStorageSize() (int64, error) {
	var totalSize int64

	err := filepath.Walk(rw.basePath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip errors
		}
		if !info.IsDir() {
			totalSize += info.Size()
		}
		return nil
	})

	return totalSize, err
}

// getSortedDates returns date directories sorted oldest first.
func (rw *RetentionWorker) getSortedDates() ([]string, error) {
	entries, err := os.ReadDir(rw.basePath)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	var dates []string
	for _, entry := range entries {
		if entry.IsDir() {
			if _, err := time.Parse("2006-01-02", entry.Name()); err == nil {
				dates = append(dates, entry.Name())
			}
		}
	}

	sort.Strings(dates) // Oldest first
	return dates, nil
}

// GetRetentionStats returns statistics about data retention.
func (rw *RetentionWorker) GetRetentionStats() (*RetentionStats, error) {
	stats := &RetentionStats{
		RetentionDays: rw.retentionDays,
		MaxStorageGB:  rw.maxStorageGB,
	}

	// Get storage size
	size, err := rw.getStorageSize()
	if err != nil {
		return nil, err
	}
	stats.CurrentStorageBytes = size
	stats.StorageUsagePercent = float64(size) / float64(rw.maxStorageGB*1024*1024*1024) * 100

	// Get date range
	dates, err := rw.getSortedDates()
	if err != nil {
		return nil, err
	}

	if len(dates) > 0 {
		stats.OldestDate = dates[0]
		stats.NewestDate = dates[len(dates)-1]
		stats.DaysStored = len(dates)
	}

	// Calculate cutoff
	stats.CutoffDate = time.Now().UTC().AddDate(0, 0, -rw.retentionDays).Format("2006-01-02")

	return stats, nil
}

// RetentionStats contains retention statistics.
type RetentionStats struct {
	RetentionDays       int
	MaxStorageGB        int64
	CurrentStorageBytes int64
	StorageUsagePercent float64
	OldestDate          string
	NewestDate          string
	CutoffDate          string
	DaysStored          int
}

// Helper functions

func isDirEmpty(path string) (bool, error) {
	entries, err := os.ReadDir(path)
	if err != nil {
		return false, err
	}
	return len(entries) == 0, nil
}

func getDirSize(path string) (int64, error) {
	var size int64
	err := filepath.Walk(path, func(_ string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if !info.IsDir() {
			size += info.Size()
		}
		return nil
	})
	return size, err
}
