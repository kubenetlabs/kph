package storage

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/go-logr/logr"
	_ "github.com/mattn/go-sqlite3"

	"github.com/policy-hub/operator/internal/telemetry/models"
)

// SQLiteIndex manages a SQLite database for indexing telemetry events.
// It provides fast lookups by common query patterns without scanning Parquet files.
type SQLiteIndex struct {
	db       *sql.DB
	dbPath   string
	log      logr.Logger
	mu       sync.RWMutex

	// Prepared statements
	insertEventStmt     *sql.Stmt
	insertFileStmt      *sql.Stmt
	queryByTimeStmt     *sql.Stmt
	queryByNamespaceStmt *sql.Stmt
}

// SQLiteIndexConfig contains configuration for the SQLite index.
type SQLiteIndexConfig struct {
	// DBPath is the path to the SQLite database file
	DBPath string
	// Logger for logging
	Logger logr.Logger
}

// NewSQLiteIndex creates a new SQLite index.
func NewSQLiteIndex(cfg SQLiteIndexConfig) (*SQLiteIndex, error) {
	if cfg.DBPath == "" {
		return nil, fmt.Errorf("database path is required")
	}

	// Create directory if needed
	dir := filepath.Dir(cfg.DBPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create directory: %w", err)
	}

	// Open database with WAL mode for better concurrent access
	db, err := sql.Open("sqlite3", cfg.DBPath+"?_journal_mode=WAL&_synchronous=NORMAL&_cache_size=10000")
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Set connection pool settings
	db.SetMaxOpenConns(1) // SQLite doesn't handle concurrent writes well
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)

	idx := &SQLiteIndex{
		db:     db,
		dbPath: cfg.DBPath,
		log:    cfg.Logger.WithName("sqlite-index"),
	}

	// Initialize schema
	if err := idx.initSchema(); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to initialize schema: %w", err)
	}

	// Prepare statements
	if err := idx.prepareStatements(); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to prepare statements: %w", err)
	}

	idx.log.Info("SQLite index initialized", "path", cfg.DBPath)
	return idx, nil
}

// initSchema creates the database schema.
func (idx *SQLiteIndex) initSchema() error {
	schema := `
	-- Event index for fast lookups
	CREATE TABLE IF NOT EXISTS event_index (
		id TEXT PRIMARY KEY,
		timestamp INTEGER NOT NULL,
		event_type TEXT NOT NULL,
		node_name TEXT NOT NULL,
		src_namespace TEXT,
		src_pod_name TEXT,
		dst_namespace TEXT,
		dst_pod_name TEXT,
		protocol TEXT,
		dst_port INTEGER,
		verdict TEXT,
		parquet_file TEXT NOT NULL,
		created_at INTEGER NOT NULL
	);

	-- Indexes for common query patterns
	CREATE INDEX IF NOT EXISTS idx_timestamp ON event_index(timestamp);
	CREATE INDEX IF NOT EXISTS idx_src_namespace ON event_index(src_namespace);
	CREATE INDEX IF NOT EXISTS idx_dst_namespace ON event_index(dst_namespace);
	CREATE INDEX IF NOT EXISTS idx_event_type ON event_index(event_type);
	CREATE INDEX IF NOT EXISTS idx_verdict ON event_index(verdict);
	CREATE INDEX IF NOT EXISTS idx_parquet_file ON event_index(parquet_file);
	CREATE INDEX IF NOT EXISTS idx_namespace_time ON event_index(src_namespace, timestamp);
	CREATE INDEX IF NOT EXISTS idx_dst_namespace_time ON event_index(dst_namespace, timestamp);

	-- File metadata for retention management
	CREATE TABLE IF NOT EXISTS parquet_files (
		file_path TEXT PRIMARY KEY,
		date TEXT NOT NULL,
		node_name TEXT NOT NULL,
		event_count INTEGER NOT NULL,
		file_size INTEGER NOT NULL,
		created_at INTEGER NOT NULL
	);

	CREATE INDEX IF NOT EXISTS idx_files_date ON parquet_files(date);
	CREATE INDEX IF NOT EXISTS idx_files_created ON parquet_files(created_at);

	-- Statistics table for aggregations
	CREATE TABLE IF NOT EXISTS hourly_stats (
		hour TEXT NOT NULL,
		src_namespace TEXT,
		dst_namespace TEXT,
		protocol TEXT,
		dst_port INTEGER,
		event_type TEXT NOT NULL,
		verdict TEXT,
		event_count INTEGER NOT NULL,
		bytes_total INTEGER NOT NULL,
		packets_total INTEGER NOT NULL,
		PRIMARY KEY (hour, src_namespace, dst_namespace, protocol, dst_port, event_type, verdict)
	);

	CREATE INDEX IF NOT EXISTS idx_stats_hour ON hourly_stats(hour);
	CREATE INDEX IF NOT EXISTS idx_stats_namespace ON hourly_stats(src_namespace, dst_namespace);
	`

	_, err := idx.db.Exec(schema)
	return err
}

// prepareStatements prepares commonly used SQL statements.
func (idx *SQLiteIndex) prepareStatements() error {
	var err error

	idx.insertEventStmt, err = idx.db.Prepare(`
		INSERT OR REPLACE INTO event_index
		(id, timestamp, event_type, node_name, src_namespace, src_pod_name,
		 dst_namespace, dst_pod_name, protocol, dst_port, verdict, parquet_file, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("failed to prepare insert event: %w", err)
	}

	idx.insertFileStmt, err = idx.db.Prepare(`
		INSERT OR REPLACE INTO parquet_files
		(file_path, date, node_name, event_count, file_size, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("failed to prepare insert file: %w", err)
	}

	return nil
}

// IndexEvents adds events to the index.
func (idx *SQLiteIndex) IndexEvents(events []*models.TelemetryEvent, parquetFile string) error {
	idx.mu.Lock()
	defer idx.mu.Unlock()

	tx, err := idx.db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	stmt := tx.Stmt(idx.insertEventStmt)
	now := time.Now().Unix()

	for _, e := range events {
		_, err := stmt.Exec(
			e.ID,
			e.Timestamp.UnixMicro(),
			string(e.EventType),
			e.NodeName,
			e.SrcNamespace,
			e.SrcPodName,
			e.DstNamespace,
			e.DstPodName,
			e.Protocol,
			e.DstPort,
			string(e.Verdict),
			parquetFile,
			now,
		)
		if err != nil {
			return fmt.Errorf("failed to insert event: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit: %w", err)
	}

	idx.log.V(1).Info("Indexed events", "count", len(events), "file", parquetFile)
	return nil
}

// RegisterFile registers a Parquet file in the index.
func (idx *SQLiteIndex) RegisterFile(filePath, date, nodeName string, eventCount int64, fileSize int64) error {
	idx.mu.Lock()
	defer idx.mu.Unlock()

	_, err := idx.insertFileStmt.Exec(filePath, date, nodeName, eventCount, fileSize, time.Now().Unix())
	if err != nil {
		return fmt.Errorf("failed to register file: %w", err)
	}

	idx.log.V(1).Info("Registered Parquet file", "path", filePath, "events", eventCount)
	return nil
}

// QueryEventIDs returns event IDs matching the query.
func (idx *SQLiteIndex) QueryEventIDs(ctx context.Context, req models.QueryEventsRequest) ([]string, error) {
	idx.mu.RLock()
	defer idx.mu.RUnlock()

	query := `SELECT id FROM event_index WHERE timestamp >= ? AND timestamp <= ?`
	args := []interface{}{req.StartTime.UnixMicro(), req.EndTime.UnixMicro()}

	// Add namespace filter
	if len(req.Namespaces) > 0 {
		placeholders := ""
		for i, ns := range req.Namespaces {
			if i > 0 {
				placeholders += " OR "
			}
			placeholders += "(src_namespace = ? OR dst_namespace = ?)"
			args = append(args, ns, ns)
		}
		query += " AND (" + placeholders + ")"
	}

	// Add event type filter
	if len(req.EventTypes) > 0 {
		placeholders := ""
		for i, et := range req.EventTypes {
			if i > 0 {
				placeholders += ", "
			}
			placeholders += "?"
			args = append(args, et)
		}
		query += " AND event_type IN (" + placeholders + ")"
	}

	query += " ORDER BY timestamp DESC"

	if req.Limit > 0 {
		query += fmt.Sprintf(" LIMIT %d", req.Limit)
	}
	if req.Offset > 0 {
		query += fmt.Sprintf(" OFFSET %d", req.Offset)
	}

	rows, err := idx.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("failed to scan row: %w", err)
		}
		ids = append(ids, id)
	}

	return ids, rows.Err()
}

// GetParquetFilesForQuery returns Parquet files that may contain matching events.
func (idx *SQLiteIndex) GetParquetFilesForQuery(ctx context.Context, req models.QueryEventsRequest) ([]string, error) {
	idx.mu.RLock()
	defer idx.mu.RUnlock()

	query := `SELECT DISTINCT parquet_file FROM event_index WHERE timestamp >= ? AND timestamp <= ?`
	args := []interface{}{req.StartTime.UnixMicro(), req.EndTime.UnixMicro()}

	// Add namespace filter
	if len(req.Namespaces) > 0 {
		placeholders := ""
		for i, ns := range req.Namespaces {
			if i > 0 {
				placeholders += " OR "
			}
			placeholders += "(src_namespace = ? OR dst_namespace = ?)"
			args = append(args, ns, ns)
		}
		query += " AND (" + placeholders + ")"
	}

	rows, err := idx.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query: %w", err)
	}
	defer rows.Close()

	var files []string
	for rows.Next() {
		var file string
		if err := rows.Scan(&file); err != nil {
			return nil, fmt.Errorf("failed to scan row: %w", err)
		}
		files = append(files, file)
	}

	return files, rows.Err()
}

// GetFilesOlderThan returns Parquet files older than the given date.
func (idx *SQLiteIndex) GetFilesOlderThan(ctx context.Context, cutoffDate string) ([]string, error) {
	idx.mu.RLock()
	defer idx.mu.RUnlock()

	rows, err := idx.db.QueryContext(ctx,
		`SELECT file_path FROM parquet_files WHERE date < ?`,
		cutoffDate,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to query: %w", err)
	}
	defer rows.Close()

	var files []string
	for rows.Next() {
		var file string
		if err := rows.Scan(&file); err != nil {
			return nil, fmt.Errorf("failed to scan row: %w", err)
		}
		files = append(files, file)
	}

	return files, rows.Err()
}

// DeleteFileRecords removes all records associated with a Parquet file.
func (idx *SQLiteIndex) DeleteFileRecords(ctx context.Context, filePath string) error {
	idx.mu.Lock()
	defer idx.mu.Unlock()

	tx, err := idx.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	// Delete events
	if _, err := tx.ExecContext(ctx, `DELETE FROM event_index WHERE parquet_file = ?`, filePath); err != nil {
		return fmt.Errorf("failed to delete events: %w", err)
	}

	// Delete file record
	if _, err := tx.ExecContext(ctx, `DELETE FROM parquet_files WHERE file_path = ?`, filePath); err != nil {
		return fmt.Errorf("failed to delete file record: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit: %w", err)
	}

	idx.log.Info("Deleted file records", "path", filePath)
	return nil
}

// UpdateHourlyStats updates the hourly statistics aggregation.
func (idx *SQLiteIndex) UpdateHourlyStats(events []*models.TelemetryEvent) error {
	idx.mu.Lock()
	defer idx.mu.Unlock()

	tx, err := idx.db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`
		INSERT INTO hourly_stats
		(hour, src_namespace, dst_namespace, protocol, dst_port, event_type, verdict, event_count, bytes_total, packets_total)
		VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
		ON CONFLICT (hour, src_namespace, dst_namespace, protocol, dst_port, event_type, verdict) DO UPDATE SET
			event_count = event_count + 1,
			bytes_total = bytes_total + excluded.bytes_total,
			packets_total = packets_total + excluded.packets_total
	`)
	if err != nil {
		return fmt.Errorf("failed to prepare statement: %w", err)
	}
	defer stmt.Close()

	for _, e := range events {
		hour := e.Timestamp.UTC().Format("2006-01-02T15")
		_, err := stmt.Exec(
			hour,
			e.SrcNamespace,
			e.DstNamespace,
			e.Protocol,
			e.DstPort,
			string(e.EventType),
			string(e.Verdict),
			e.BytesTotal,
			e.PacketsTotal,
		)
		if err != nil {
			return fmt.Errorf("failed to update stats: %w", err)
		}
	}

	return tx.Commit()
}

// GetHourlyStats retrieves hourly statistics for a time range.
func (idx *SQLiteIndex) GetHourlyStats(ctx context.Context, startHour, endHour string) ([]HourlyStats, error) {
	idx.mu.RLock()
	defer idx.mu.RUnlock()

	rows, err := idx.db.QueryContext(ctx, `
		SELECT hour, src_namespace, dst_namespace, protocol, dst_port, event_type, verdict,
		       event_count, bytes_total, packets_total
		FROM hourly_stats
		WHERE hour >= ? AND hour <= ?
		ORDER BY hour DESC
	`, startHour, endHour)
	if err != nil {
		return nil, fmt.Errorf("failed to query: %w", err)
	}
	defer rows.Close()

	var stats []HourlyStats
	for rows.Next() {
		var s HourlyStats
		if err := rows.Scan(
			&s.Hour, &s.SrcNamespace, &s.DstNamespace, &s.Protocol, &s.DstPort,
			&s.EventType, &s.Verdict, &s.EventCount, &s.BytesTotal, &s.PacketsTotal,
		); err != nil {
			return nil, fmt.Errorf("failed to scan row: %w", err)
		}
		stats = append(stats, s)
	}

	return stats, rows.Err()
}

// HourlyStats represents aggregated statistics for an hour.
type HourlyStats struct {
	Hour         string
	SrcNamespace string
	DstNamespace string
	Protocol     string
	DstPort      int32
	EventType    string
	Verdict      string
	EventCount   int64
	BytesTotal   int64
	PacketsTotal int64
}

// GetEventCount returns the total count of indexed events.
func (idx *SQLiteIndex) GetEventCount(ctx context.Context) (int64, error) {
	idx.mu.RLock()
	defer idx.mu.RUnlock()

	var count int64
	err := idx.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM event_index`).Scan(&count)
	return count, err
}

// GetStats returns index statistics.
func (idx *SQLiteIndex) GetStats(ctx context.Context) (*IndexStats, error) {
	idx.mu.RLock()
	defer idx.mu.RUnlock()

	stats := &IndexStats{}

	// Event count
	if err := idx.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM event_index`).Scan(&stats.TotalEvents); err != nil {
		return nil, err
	}

	// File count
	if err := idx.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM parquet_files`).Scan(&stats.TotalFiles); err != nil {
		return nil, err
	}

	// Total size
	if err := idx.db.QueryRowContext(ctx, `SELECT COALESCE(SUM(file_size), 0) FROM parquet_files`).Scan(&stats.TotalSizeBytes); err != nil {
		return nil, err
	}

	// Date range
	idx.db.QueryRowContext(ctx, `SELECT MIN(date), MAX(date) FROM parquet_files`).Scan(&stats.OldestDate, &stats.NewestDate)

	return stats, nil
}

// IndexStats contains index statistics.
type IndexStats struct {
	TotalEvents    int64
	TotalFiles     int64
	TotalSizeBytes int64
	OldestDate     string
	NewestDate     string
}

// Vacuum runs VACUUM to reclaim space.
func (idx *SQLiteIndex) Vacuum() error {
	idx.mu.Lock()
	defer idx.mu.Unlock()

	_, err := idx.db.Exec("VACUUM")
	return err
}

// Close closes the SQLite database.
func (idx *SQLiteIndex) Close() error {
	idx.mu.Lock()
	defer idx.mu.Unlock()

	if idx.insertEventStmt != nil {
		idx.insertEventStmt.Close()
	}
	if idx.insertFileStmt != nil {
		idx.insertFileStmt.Close()
	}

	return idx.db.Close()
}
