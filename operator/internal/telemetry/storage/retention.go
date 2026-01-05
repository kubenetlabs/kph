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
	basePath       string
	retentionDays  int
	maxStorageGB   int64
	maxSQLiteSizeGB int64
	index          *SQLiteIndex
	log            logr.Logger

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
	// MaxSQLiteSizeGB is the maximum SQLite database size in GB (default: 2)
	// When exceeded, oldest events are aggressively pruned regardless of retention policy
	MaxSQLiteSizeGB int64
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

	maxSQLiteSizeGB := cfg.MaxSQLiteSizeGB
	if maxSQLiteSizeGB <= 0 {
		maxSQLiteSizeGB = 2 // Default 2GB max for SQLite
	}

	cleanupInterval := cfg.CleanupInterval
	if cleanupInterval <= 0 {
		cleanupInterval = time.Hour
	}

	return &RetentionWorker{
		basePath:        cfg.BasePath,
		retentionDays:   retentionDays,
		maxStorageGB:    maxStorageGB,
		maxSQLiteSizeGB: maxSQLiteSizeGB,
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
		"maxSQLiteSizeGB", rw.maxSQLiteSizeGB,
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

	// Log current storage status before cleanup
	if rw.index != nil {
		dbSize, _ := rw.index.GetDatabaseSize()
		rw.log.Info("Pre-cleanup storage status",
			"sqliteDBSizeGB", float64(dbSize)/(1024*1024*1024),
			"maxSQLiteSizeGB", rw.maxSQLiteSizeGB,
		)
	}

	// 0. CRITICAL: Enforce SQLite size limit FIRST - this prevents disk pressure
	// This aggressively prunes events if SQLite exceeds max size, regardless of retention policy
	if err := rw.enforceSQLiteSizeLimit(ctx); err != nil {
		rw.log.Error(err, "Failed to enforce SQLite size limit")
	}

	// 1. Delete data older than retention period (includes SQLite event cleanup)
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

	// 4. Vacuum SQLite database only if we have enough free space
	// VACUUM requires temporary disk space approximately equal to the database size
	if rw.index != nil {
		if err := rw.safeVacuum(ctx); err != nil {
			rw.log.Error(err, "Failed to vacuum index")
		}
	}

	return nil
}

// safeVacuum runs VACUUM only when there's sufficient free disk space.
// VACUUM creates a temporary copy of the database, so it needs roughly 2x the DB size.
func (rw *RetentionWorker) safeVacuum(ctx context.Context) error {
	if rw.index == nil {
		return nil
	}

	// Get current database size
	dbSize, err := rw.index.GetDatabaseSize()
	if err != nil {
		return fmt.Errorf("failed to get database size: %w", err)
	}

	// Get current total storage usage
	totalSize, err := rw.getStorageSize()
	if err != nil {
		return fmt.Errorf("failed to get storage size: %w", err)
	}

	maxBytes := rw.maxStorageGB * 1024 * 1024 * 1024
	freeSpace := maxBytes - totalSize

	// Only vacuum if we have at least 2x the database size in free space
	// This ensures we don't run out of disk during the vacuum operation
	requiredSpace := dbSize * 2
	if freeSpace < requiredSpace {
		rw.log.Info("Skipping vacuum - insufficient free space",
			"dbSizeGB", float64(dbSize)/(1024*1024*1024),
			"freeSpaceGB", float64(freeSpace)/(1024*1024*1024),
			"requiredSpaceGB", float64(requiredSpace)/(1024*1024*1024),
		)
		return nil
	}

	// Run vacuum
	rw.log.Info("Running SQLite vacuum",
		"dbSizeGB", float64(dbSize)/(1024*1024*1024),
	)
	if err := rw.index.Vacuum(); err != nil {
		return fmt.Errorf("vacuum failed: %w", err)
	}

	// Log size after vacuum
	newSize, _ := rw.index.GetDatabaseSize()
	rw.log.Info("SQLite vacuum completed",
		"oldSizeGB", float64(dbSize)/(1024*1024*1024),
		"newSizeGB", float64(newSize)/(1024*1024*1024),
		"reclaimedGB", float64(dbSize-newSize)/(1024*1024*1024),
	)

	return nil
}

// enforceSQLiteSizeLimit aggressively prunes oldest events when SQLite exceeds max size.
// This is critical to prevent disk pressure - it runs BEFORE regular retention cleanup.
func (rw *RetentionWorker) enforceSQLiteSizeLimit(ctx context.Context) error {
	if rw.index == nil {
		return nil
	}

	dbSize, err := rw.index.GetDatabaseSize()
	if err != nil {
		return fmt.Errorf("failed to get database size: %w", err)
	}

	maxBytes := rw.maxSQLiteSizeGB * 1024 * 1024 * 1024
	if dbSize <= maxBytes {
		return nil // Under limit, nothing to do
	}

	rw.log.Info("SQLite database exceeds size limit, starting aggressive cleanup",
		"currentSizeGB", float64(dbSize)/(1024*1024*1024),
		"maxSizeGB", rw.maxSQLiteSizeGB,
	)

	// Calculate how much we need to delete (aim for 50% of max to give headroom)
	targetSize := maxBytes / 2

	// Delete events in batches until we're under target
	batchSize := int64(100000) // Delete 100k events at a time
	totalDeleted := int64(0)
	iterations := 0
	maxIterations := 100 // Safety limit

	for iterations < maxIterations {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Get current size
		currentSize, err := rw.index.GetDatabaseSize()
		if err != nil {
			return fmt.Errorf("failed to get database size: %w", err)
		}

		if currentSize <= targetSize {
			break // Target reached
		}

		// Delete oldest batch of events
		deleted, err := rw.index.DeleteOldestEvents(ctx, batchSize)
		if err != nil {
			return fmt.Errorf("failed to delete events: %w", err)
		}

		if deleted == 0 {
			break // No more events to delete
		}

		totalDeleted += deleted
		iterations++

		// Checkpoint periodically to reclaim space
		if iterations%5 == 0 {
			if err := rw.index.Checkpoint(); err != nil {
				rw.log.Error(err, "Failed to checkpoint during aggressive cleanup")
			}
		}
	}

	// Final checkpoint
	if totalDeleted > 0 {
		if err := rw.index.Checkpoint(); err != nil {
			rw.log.Error(err, "Failed to checkpoint after aggressive cleanup")
		}

		newSize, _ := rw.index.GetDatabaseSize()
		rw.log.Info("Aggressive SQLite cleanup completed",
			"deletedEvents", totalDeleted,
			"iterations", iterations,
			"oldSizeGB", float64(dbSize)/(1024*1024*1024),
			"newSizeGB", float64(newSize)/(1024*1024*1024),
		)
	}

	return nil
}

// cleanupOldData removes data older than the retention period.
func (rw *RetentionWorker) cleanupOldData(ctx context.Context) error {
	cutoffDate := time.Now().UTC().AddDate(0, 0, -rw.retentionDays).Format("2006-01-02")
	rw.log.V(1).Info("Cleaning up data before cutoff", "cutoffDate", cutoffDate)

	// Clean up SQLite events first (this is critical - the DB can grow very large!)
	if err := rw.cleanupSQLiteEvents(ctx); err != nil {
		rw.log.Error(err, "Failed to cleanup SQLite events")
	}

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

// cleanupSQLiteEvents deletes old events and hourly stats from the SQLite index.
func (rw *RetentionWorker) cleanupSQLiteEvents(ctx context.Context) error {
	if rw.index == nil {
		return nil
	}

	cutoffTime := time.Now().UTC().AddDate(0, 0, -rw.retentionDays)
	cutoffTimestamp := cutoffTime.Unix()
	cutoffHour := cutoffTime.Format("2006-01-02T15")

	// Delete old events from event_index table
	eventsDeleted, err := rw.index.DeleteEventsOlderThan(ctx, cutoffTimestamp)
	if err != nil {
		return fmt.Errorf("failed to delete old events: %w", err)
	}
	if eventsDeleted > 0 {
		rw.log.Info("Deleted old events from SQLite index",
			"deletedCount", eventsDeleted,
			"cutoffTime", cutoffTime.Format(time.RFC3339),
		)
	}

	// Delete old hourly stats
	statsDeleted, err := rw.index.DeleteHourlyStatsOlderThan(ctx, cutoffHour)
	if err != nil {
		return fmt.Errorf("failed to delete old hourly stats: %w", err)
	}
	if statsDeleted > 0 {
		rw.log.Info("Deleted old hourly stats from SQLite index",
			"deletedCount", statsDeleted,
			"cutoffHour", cutoffHour,
		)
	}

	// Checkpoint to reduce WAL file size after deletions
	if eventsDeleted > 0 || statsDeleted > 0 {
		if err := rw.index.Checkpoint(); err != nil {
			rw.log.Error(err, "Failed to checkpoint SQLite database")
		} else {
			rw.log.V(1).Info("Checkpointed SQLite database after cleanup")
		}
	}

	return nil
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

// getStorageSize returns the total size of stored data including SQLite database.
func (rw *RetentionWorker) getStorageSize() (int64, error) {
	var totalSize int64

	// Walk parquet files directory
	err := filepath.Walk(rw.basePath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip errors
		}
		if !info.IsDir() {
			totalSize += info.Size()
		}
		return nil
	})
	if err != nil {
		return totalSize, err
	}

	// Add SQLite database size (this was the missing piece causing disk pressure!)
	if rw.index != nil {
		dbSize, err := rw.index.GetDatabaseSize()
		if err == nil {
			totalSize += dbSize
		}
	}

	return totalSize, nil
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
	ctx := context.Background()
	stats := &RetentionStats{
		RetentionDays: rw.retentionDays,
		MaxStorageGB:  rw.maxStorageGB,
	}

	// Get total storage size (includes SQLite)
	size, err := rw.getStorageSize()
	if err != nil {
		return nil, err
	}
	stats.CurrentStorageBytes = size
	stats.StorageUsagePercent = float64(size) / float64(rw.maxStorageGB*1024*1024*1024) * 100

	// Get SQLite-specific stats
	if rw.index != nil {
		sqliteSize, err := rw.index.GetDatabaseSize()
		if err == nil {
			stats.SQLiteStorageBytes = sqliteSize
		}

		eventCount, err := rw.index.GetEventCount(ctx)
		if err == nil {
			stats.SQLiteEventCount = eventCount
		}
	}

	// Calculate parquet size (total - sqlite)
	stats.ParquetStorageBytes = stats.CurrentStorageBytes - stats.SQLiteStorageBytes

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
	RetentionDays        int
	MaxStorageGB         int64
	CurrentStorageBytes  int64
	ParquetStorageBytes  int64
	SQLiteStorageBytes   int64
	StorageUsagePercent  float64
	OldestDate           string
	NewestDate           string
	CutoffDate           string
	DaysStored           int
	SQLiteEventCount     int64
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
