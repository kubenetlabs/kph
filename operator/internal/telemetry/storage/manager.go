package storage

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/go-logr/logr"

	"github.com/policy-hub/operator/internal/telemetry/models"
)

// Manager coordinates telemetry storage components (Parquet writer, SQLite index, retention).
type Manager struct {
	basePath string
	nodeName string
	log      logr.Logger

	// Components
	writer    *ParquetWriter
	index     *SQLiteIndex
	retention *RetentionWorker
	reader    *ParquetReader

	// State
	mu      sync.RWMutex
	started bool
}

// ManagerConfig contains configuration for the storage manager.
type ManagerConfig struct {
	// BasePath is the root directory for telemetry storage
	BasePath string
	// NodeName is the current node name
	NodeName string
	// RetentionDays is the number of days to retain data
	RetentionDays int
	// MaxStorageGB is the maximum storage in GB
	MaxStorageGB int64
	// Logger for logging
	Logger logr.Logger
}

// NewManager creates a new storage manager.
func NewManager(cfg ManagerConfig) (*Manager, error) {
	if cfg.BasePath == "" {
		return nil, fmt.Errorf("base path is required")
	}

	// Create base directory structure
	parquetPath := filepath.Join(cfg.BasePath, "parquet")
	indexPath := filepath.Join(cfg.BasePath, "index", "telemetry.db")

	if err := os.MkdirAll(parquetPath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create parquet directory: %w", err)
	}

	log := cfg.Logger.WithName("storage-manager")

	// Initialize SQLite index
	index, err := NewSQLiteIndex(SQLiteIndexConfig{
		DBPath: indexPath,
		Logger: cfg.Logger,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create SQLite index: %w", err)
	}

	// Initialize Parquet writer
	writer, err := NewParquetWriter(ParquetWriterConfig{
		BasePath: parquetPath,
		NodeName: cfg.NodeName,
		Logger:   cfg.Logger,
	})
	if err != nil {
		index.Close()
		return nil, fmt.Errorf("failed to create Parquet writer: %w", err)
	}

	// Initialize Parquet reader
	reader := NewParquetReader(parquetPath, cfg.Logger)

	// Initialize retention worker
	retention := NewRetentionWorker(RetentionWorkerConfig{
		BasePath:      parquetPath,
		RetentionDays: cfg.RetentionDays,
		MaxStorageGB:  cfg.MaxStorageGB,
		Index:         index,
		Logger:        cfg.Logger,
	})

	return &Manager{
		basePath:  cfg.BasePath,
		nodeName:  cfg.NodeName,
		log:       log,
		writer:    writer,
		index:     index,
		retention: retention,
		reader:    reader,
	}, nil
}

// Start starts background workers (retention cleanup).
func (m *Manager) Start(ctx context.Context) error {
	m.mu.Lock()
	if m.started {
		m.mu.Unlock()
		return nil
	}
	m.started = true
	m.mu.Unlock()

	m.log.Info("Starting storage manager", "basePath", m.basePath)

	// Start retention worker in background
	go m.retention.Start(ctx)

	return nil
}

// Write stores telemetry events.
func (m *Manager) Write(events []*models.TelemetryEvent) error {
	if len(events) == 0 {
		return nil
	}

	// Get current file info before write
	stats := m.writer.GetStats()

	// Write to Parquet
	if err := m.writer.Write(events); err != nil {
		return fmt.Errorf("failed to write to Parquet: %w", err)
	}

	// Index the events
	newStats := m.writer.GetStats()
	parquetFile := filepath.Join(m.basePath, "parquet", newStats.CurrentDate,
		fmt.Sprintf("events_%s_*.parquet", m.nodeName))

	if err := m.index.IndexEvents(events, parquetFile); err != nil {
		m.log.Error(err, "Failed to index events")
		// Continue even if indexing fails - data is still in Parquet
	}

	// Update hourly stats
	if err := m.index.UpdateHourlyStats(events); err != nil {
		m.log.Error(err, "Failed to update hourly stats")
	}

	m.log.V(1).Info("Stored events",
		"count", len(events),
		"date", newStats.CurrentDate,
		"totalEvents", newStats.EventCount,
	)

	// Check if we rotated to a new file
	if stats.CurrentDate != "" && stats.CurrentDate != newStats.CurrentDate {
		// Register the completed file
		m.registerCompletedFile(stats)
	}

	return nil
}

// registerCompletedFile registers a completed Parquet file in the index.
func (m *Manager) registerCompletedFile(stats ParquetWriterStats) {
	// Find the actual file
	pattern := filepath.Join(m.basePath, "parquet", stats.CurrentDate, "events_*.parquet")
	files, err := filepath.Glob(pattern)
	if err != nil || len(files) == 0 {
		return
	}

	for _, file := range files {
		info, err := os.Stat(file)
		if err != nil {
			continue
		}

		if err := m.index.RegisterFile(file, stats.CurrentDate, m.nodeName, stats.EventCount, info.Size()); err != nil {
			m.log.Error(err, "Failed to register file", "path", file)
		}
	}
}

// Query retrieves events matching the query.
func (m *Manager) Query(ctx context.Context, req models.QueryEventsRequest) (*models.QueryEventsResponse, error) {
	m.log.Info("Query: starting index lookup",
		"startTime", req.StartTime,
		"endTime", req.EndTime,
	)

	// First try to use index to find relevant files
	files, err := m.index.GetParquetFilesForQuery(ctx, req)
	if err != nil {
		m.log.Error(err, "Failed to query index, falling back to full scan")
		// Fall back to reading all files in date range
		return m.reader.ReadEvents(ctx, req)
	}

	m.log.Info("Query: index lookup complete", "fileCount", len(files))

	if len(files) == 0 {
		m.log.Info("Query: no matching files found")
		return &models.QueryEventsResponse{
			Events:     nil,
			TotalCount: 0,
			HasMore:    false,
		}, nil
	}

	m.log.Info("Query: reading events from parquet files", "files", files)

	// Read from specific files
	resp, err := m.reader.ReadEvents(ctx, req)
	if err != nil {
		m.log.Error(err, "Query: ReadEvents failed")
		return nil, err
	}

	m.log.Info("Query: complete", "eventCount", len(resp.Events))
	return resp, nil
}

// GetStats returns storage statistics.
func (m *Manager) GetStats(ctx context.Context) (*StorageStats, error) {
	stats := &StorageStats{}

	// Index stats
	indexStats, err := m.index.GetStats(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get index stats: %w", err)
	}
	stats.IndexStats = indexStats

	// Retention stats
	retentionStats, err := m.retention.GetRetentionStats()
	if err != nil {
		return nil, fmt.Errorf("failed to get retention stats: %w", err)
	}
	stats.RetentionStats = retentionStats

	// Writer stats
	stats.WriterStats = m.writer.GetStats()

	return stats, nil
}

// StorageStats contains comprehensive storage statistics.
type StorageStats struct {
	IndexStats     *IndexStats
	RetentionStats *RetentionStats
	WriterStats    ParquetWriterStats
}

// Flush forces a flush of buffered data.
func (m *Manager) Flush() error {
	return m.writer.Flush()
}

// Close closes all storage components.
func (m *Manager) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	var errs []error

	if err := m.writer.Close(); err != nil {
		errs = append(errs, fmt.Errorf("writer close: %w", err))
	}

	if err := m.index.Close(); err != nil {
		errs = append(errs, fmt.Errorf("index close: %w", err))
	}

	if len(errs) > 0 {
		return fmt.Errorf("close errors: %v", errs)
	}

	m.log.Info("Storage manager closed")
	return nil
}

// GetIndex returns the SQLite index for advanced queries.
func (m *Manager) GetIndex() *SQLiteIndex {
	return m.index
}

// GetReader returns the Parquet reader for direct file access.
func (m *Manager) GetReader() *ParquetReader {
	return m.reader
}
