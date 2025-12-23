// Package storage provides telemetry data persistence using Parquet files and SQLite indexes.
package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/go-logr/logr"
	"github.com/xitongsys/parquet-go-source/local"
	"github.com/xitongsys/parquet-go/parquet"
	"github.com/xitongsys/parquet-go/reader"
	"github.com/xitongsys/parquet-go/writer"

	"github.com/policy-hub/operator/internal/telemetry/models"
)

// ParquetEvent is the Parquet-compatible representation of TelemetryEvent.
// Uses simple types that map directly to Parquet schema.
type ParquetEvent struct {
	// Core identification
	ID        string `parquet:"name=id, type=BYTE_ARRAY, convertedtype=UTF8"`
	Timestamp int64  `parquet:"name=timestamp, type=INT64, convertedtype=TIMESTAMP_MICROS"`
	EventType string `parquet:"name=event_type, type=BYTE_ARRAY, convertedtype=UTF8"`
	NodeName  string `parquet:"name=node_name, type=BYTE_ARRAY, convertedtype=UTF8"`

	// Source identity
	SrcNamespace string `parquet:"name=src_namespace, type=BYTE_ARRAY, convertedtype=UTF8"`
	SrcPodName   string `parquet:"name=src_pod_name, type=BYTE_ARRAY, convertedtype=UTF8"`
	SrcPodLabels string `parquet:"name=src_pod_labels, type=BYTE_ARRAY, convertedtype=UTF8"` // JSON encoded
	SrcIP        string `parquet:"name=src_ip, type=BYTE_ARRAY, convertedtype=UTF8"`
	SrcPort      int32  `parquet:"name=src_port, type=INT32"`
	SrcIdentity  int32  `parquet:"name=src_identity, type=INT32"`

	// Source process info
	SrcProcess   string `parquet:"name=src_process, type=BYTE_ARRAY, convertedtype=UTF8"`
	SrcPID       int32  `parquet:"name=src_pid, type=INT32"`
	SrcUID       int32  `parquet:"name=src_uid, type=INT32"`
	SrcBinary    string `parquet:"name=src_binary, type=BYTE_ARRAY, convertedtype=UTF8"`
	SrcArguments string `parquet:"name=src_arguments, type=BYTE_ARRAY, convertedtype=UTF8"`

	// Destination identity
	DstNamespace string `parquet:"name=dst_namespace, type=BYTE_ARRAY, convertedtype=UTF8"`
	DstPodName   string `parquet:"name=dst_pod_name, type=BYTE_ARRAY, convertedtype=UTF8"`
	DstPodLabels string `parquet:"name=dst_pod_labels, type=BYTE_ARRAY, convertedtype=UTF8"` // JSON encoded
	DstIP        string `parquet:"name=dst_ip, type=BYTE_ARRAY, convertedtype=UTF8"`
	DstPort      int32  `parquet:"name=dst_port, type=INT32"`
	DstIdentity  int32  `parquet:"name=dst_identity, type=INT32"`
	DstDNSName   string `parquet:"name=dst_dns_name, type=BYTE_ARRAY, convertedtype=UTF8"`

	// Protocol information
	Protocol  string `parquet:"name=protocol, type=BYTE_ARRAY, convertedtype=UTF8"`
	L7Type    string `parquet:"name=l7_type, type=BYTE_ARRAY, convertedtype=UTF8"`
	Direction string `parquet:"name=direction, type=BYTE_ARRAY, convertedtype=UTF8"`

	// L7 HTTP details
	HTTPMethod   string `parquet:"name=http_method, type=BYTE_ARRAY, convertedtype=UTF8"`
	HTTPPath     string `parquet:"name=http_path, type=BYTE_ARRAY, convertedtype=UTF8"`
	HTTPHost     string `parquet:"name=http_host, type=BYTE_ARRAY, convertedtype=UTF8"`
	HTTPStatus   int32  `parquet:"name=http_status, type=INT32"`
	HTTPHeaders  string `parquet:"name=http_headers, type=BYTE_ARRAY, convertedtype=UTF8"`
	HTTPProtocol string `parquet:"name=http_protocol, type=BYTE_ARRAY, convertedtype=UTF8"`

	// L7 DNS details
	DNSQuery     string `parquet:"name=dns_query, type=BYTE_ARRAY, convertedtype=UTF8"`
	DNSQueryType string `parquet:"name=dns_query_type, type=BYTE_ARRAY, convertedtype=UTF8"`
	DNSRCode     int32  `parquet:"name=dns_rcode, type=INT32"`
	DNSIPs       string `parquet:"name=dns_ips, type=BYTE_ARRAY, convertedtype=UTF8"` // JSON encoded

	// L7 gRPC details
	GRPCService string `parquet:"name=grpc_service, type=BYTE_ARRAY, convertedtype=UTF8"`
	GRPCMethod  string `parquet:"name=grpc_method, type=BYTE_ARRAY, convertedtype=UTF8"`
	GRPCStatus  int32  `parquet:"name=grpc_status, type=INT32"`

	// L7 Kafka details
	KafkaTopic       string `parquet:"name=kafka_topic, type=BYTE_ARRAY, convertedtype=UTF8"`
	KafkaAPIKey      string `parquet:"name=kafka_api_key, type=BYTE_ARRAY, convertedtype=UTF8"`
	KafkaErrorCode   int32  `parquet:"name=kafka_error_code, type=INT32"`
	KafkaCorrelation int32  `parquet:"name=kafka_correlation, type=INT32"`

	// Syscall info
	Syscall     string `parquet:"name=syscall, type=BYTE_ARRAY, convertedtype=UTF8"`
	SyscallArgs string `parquet:"name=syscall_args, type=BYTE_ARRAY, convertedtype=UTF8"` // JSON encoded

	// File access info
	FilePath      string `parquet:"name=file_path, type=BYTE_ARRAY, convertedtype=UTF8"`
	FileOperation string `parquet:"name=file_operation, type=BYTE_ARRAY, convertedtype=UTF8"`

	// Verdict and action
	Verdict string `parquet:"name=verdict, type=BYTE_ARRAY, convertedtype=UTF8"`
	Action  string `parquet:"name=action, type=BYTE_ARRAY, convertedtype=UTF8"`

	// Flow metrics
	BytesTotal   int64 `parquet:"name=bytes_total, type=INT64"`
	PacketsTotal int64 `parquet:"name=packets_total, type=INT64"`

	// TCP flags
	TCPFlags string `parquet:"name=tcp_flags, type=BYTE_ARRAY, convertedtype=UTF8"`
	IsReply  bool   `parquet:"name=is_reply, type=BOOLEAN"`

	// Policy correlation
	MatchedPolicies string `parquet:"name=matched_policies, type=BYTE_ARRAY, convertedtype=UTF8"` // JSON encoded

	// Trace context
	TraceID      string `parquet:"name=trace_id, type=BYTE_ARRAY, convertedtype=UTF8"`
	SpanID       string `parquet:"name=span_id, type=BYTE_ARRAY, convertedtype=UTF8"`
	ParentSpanID string `parquet:"name=parent_span_id, type=BYTE_ARRAY, convertedtype=UTF8"`

	// Source tracking
	Source string `parquet:"name=source, type=BYTE_ARRAY, convertedtype=UTF8"`
}

// ParquetWriter writes telemetry events to daily-partitioned Parquet files.
type ParquetWriter struct {
	basePath    string
	nodeName    string
	log         logr.Logger
	mu          sync.Mutex

	// Current file state
	currentDate   string
	currentWriter *writer.ParquetWriter
	currentFile   *os.File
	eventCount    int64

	// Configuration
	rowGroupSize  int64
	compression   parquet.CompressionCodec
}

// ParquetWriterConfig contains configuration for the Parquet writer.
type ParquetWriterConfig struct {
	// BasePath is the directory for storing Parquet files
	BasePath string
	// NodeName is used for file naming
	NodeName string
	// RowGroupSize is the number of rows per row group (default: 10000)
	RowGroupSize int64
	// Compression codec (default: SNAPPY)
	Compression parquet.CompressionCodec
	// Logger for logging
	Logger logr.Logger
}

// NewParquetWriter creates a new Parquet writer.
func NewParquetWriter(cfg ParquetWriterConfig) (*ParquetWriter, error) {
	if cfg.BasePath == "" {
		return nil, fmt.Errorf("base path is required")
	}

	// Create base directory
	if err := os.MkdirAll(cfg.BasePath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create base path: %w", err)
	}

	rowGroupSize := cfg.RowGroupSize
	if rowGroupSize <= 0 {
		rowGroupSize = 10000
	}

	compression := cfg.Compression
	if compression == parquet.CompressionCodec_UNCOMPRESSED {
		compression = parquet.CompressionCodec_SNAPPY
	}

	return &ParquetWriter{
		basePath:     cfg.BasePath,
		nodeName:     cfg.NodeName,
		log:          cfg.Logger.WithName("parquet-writer"),
		rowGroupSize: rowGroupSize,
		compression:  compression,
	}, nil
}

// Write writes a batch of events to the Parquet file.
func (pw *ParquetWriter) Write(events []*models.TelemetryEvent) error {
	if len(events) == 0 {
		return nil
	}

	pw.mu.Lock()
	defer pw.mu.Unlock()

	// Get current date for partitioning
	today := time.Now().UTC().Format("2006-01-02")

	// Check if we need to rotate to a new file
	if pw.currentDate != today {
		if err := pw.rotateFile(today); err != nil {
			return fmt.Errorf("failed to rotate file: %w", err)
		}
	}

	// Write events
	for _, event := range events {
		pqEvent := convertToParquetEvent(event)
		if err := pw.currentWriter.Write(pqEvent); err != nil {
			return fmt.Errorf("failed to write event: %w", err)
		}
		pw.eventCount++
	}

	pw.log.V(1).Info("Wrote events to Parquet", "count", len(events), "date", today)
	return nil
}

// rotateFile closes the current file and opens a new one for the given date.
func (pw *ParquetWriter) rotateFile(date string) error {
	// Close existing writer
	if err := pw.closeCurrentWriter(); err != nil {
		pw.log.Error(err, "Error closing previous writer")
	}

	// Create date directory
	dateDir := filepath.Join(pw.basePath, date)
	if err := os.MkdirAll(dateDir, 0755); err != nil {
		return fmt.Errorf("failed to create date directory: %w", err)
	}

	// Generate unique filename
	timestamp := time.Now().UTC().Format("150405")
	filename := fmt.Sprintf("events_%s_%s.parquet", pw.nodeName, timestamp)
	filePath := filepath.Join(dateDir, filename)

	// Open file
	fw, err := local.NewLocalFileWriter(filePath)
	if err != nil {
		return fmt.Errorf("failed to create file writer: %w", err)
	}

	// Create Parquet writer
	pqWriter, err := writer.NewParquetWriter(fw, new(ParquetEvent), int64(4))
	if err != nil {
		fw.Close()
		return fmt.Errorf("failed to create parquet writer: %w", err)
	}

	pqWriter.RowGroupSize = pw.rowGroupSize
	pqWriter.CompressionType = pw.compression

	pw.currentDate = date
	pw.currentWriter = pqWriter
	pw.eventCount = 0

	pw.log.Info("Opened new Parquet file", "path", filePath)
	return nil
}

// closeCurrentWriter closes the current Parquet writer.
func (pw *ParquetWriter) closeCurrentWriter() error {
	if pw.currentWriter == nil {
		return nil
	}

	if err := pw.currentWriter.WriteStop(); err != nil {
		return fmt.Errorf("failed to stop writer: %w", err)
	}

	pw.log.Info("Closed Parquet file", "date", pw.currentDate, "eventCount", pw.eventCount)
	pw.currentWriter = nil
	pw.currentFile = nil
	return nil
}

// Close closes the Parquet writer.
func (pw *ParquetWriter) Close() error {
	pw.mu.Lock()
	defer pw.mu.Unlock()
	return pw.closeCurrentWriter()
}

// Flush ensures all buffered data is written to disk.
func (pw *ParquetWriter) Flush() error {
	pw.mu.Lock()
	defer pw.mu.Unlock()

	if pw.currentWriter == nil {
		return nil
	}

	// Close and reopen the file to flush
	date := pw.currentDate
	if err := pw.closeCurrentWriter(); err != nil {
		return err
	}

	return pw.rotateFile(date)
}

// GetStats returns current writer statistics.
func (pw *ParquetWriter) GetStats() ParquetWriterStats {
	pw.mu.Lock()
	defer pw.mu.Unlock()

	return ParquetWriterStats{
		CurrentDate:  pw.currentDate,
		EventCount:   pw.eventCount,
		BasePath:     pw.basePath,
	}
}

// ParquetWriterStats contains writer statistics.
type ParquetWriterStats struct {
	CurrentDate  string
	EventCount   int64
	BasePath     string
}

// convertToParquetEvent converts a TelemetryEvent to a ParquetEvent.
func convertToParquetEvent(e *models.TelemetryEvent) *ParquetEvent {
	return &ParquetEvent{
		ID:            e.ID,
		Timestamp:     e.Timestamp.UnixMicro(),
		EventType:     string(e.EventType),
		NodeName:      e.NodeName,
		SrcNamespace:  e.SrcNamespace,
		SrcPodName:    e.SrcPodName,
		SrcPodLabels:  jsonEncode(e.SrcPodLabels),
		SrcIP:         e.SrcIP,
		SrcPort:       int32(e.SrcPort),
		SrcIdentity:   int32(e.SrcIdentity),
		SrcProcess:    e.SrcProcess,
		SrcPID:        int32(e.SrcPID),
		SrcUID:        int32(e.SrcUID),
		SrcBinary:     e.SrcBinary,
		SrcArguments:  e.SrcArguments,
		DstNamespace:  e.DstNamespace,
		DstPodName:    e.DstPodName,
		DstPodLabels:  jsonEncode(e.DstPodLabels),
		DstIP:         e.DstIP,
		DstPort:       int32(e.DstPort),
		DstIdentity:   int32(e.DstIdentity),
		DstDNSName:    e.DstDNSName,
		Protocol:      e.Protocol,
		L7Type:        e.L7Type,
		Direction:     string(e.Direction),
		HTTPMethod:    e.HTTPMethod,
		HTTPPath:      e.HTTPPath,
		HTTPHost:      e.HTTPHost,
		HTTPStatus:    e.HTTPStatus,
		HTTPHeaders:   e.HTTPHeaders,
		HTTPProtocol:  e.HTTPProtocol,
		DNSQuery:      e.DNSQuery,
		DNSQueryType:  e.DNSQueryType,
		DNSRCode:      e.DNSRCode,
		DNSIPs:        jsonEncode(e.DNSIPs),
		GRPCService:   e.GRPCService,
		GRPCMethod:    e.GRPCMethod,
		GRPCStatus:    e.GRPCStatus,
		KafkaTopic:    e.KafkaTopic,
		KafkaAPIKey:   e.KafkaAPIKey,
		KafkaErrorCode:   e.KafkaErrorCode,
		KafkaCorrelation: e.KafkaCorrelation,
		Syscall:       e.Syscall,
		SyscallArgs:   jsonEncode(e.SyscallArgs),
		FilePath:      e.FilePath,
		FileOperation: e.FileOperation,
		Verdict:       string(e.Verdict),
		Action:        e.Action,
		BytesTotal:    e.BytesTotal,
		PacketsTotal:  e.PacketsTotal,
		TCPFlags:      e.TCPFlags,
		IsReply:       e.IsReply,
		MatchedPolicies: jsonEncode(e.MatchedPolicies),
		TraceID:       e.TraceID,
		SpanID:        e.SpanID,
		ParentSpanID:  e.ParentSpanID,
		Source:        e.Source,
	}
}

// convertFromParquetEvent converts a ParquetEvent back to a TelemetryEvent.
func convertFromParquetEvent(p *ParquetEvent) *models.TelemetryEvent {
	var srcLabels map[string]string
	var dstLabels map[string]string
	var dnsIPs []string
	var syscallArgs []string
	var matchedPolicies []string

	json.Unmarshal([]byte(p.SrcPodLabels), &srcLabels)
	json.Unmarshal([]byte(p.DstPodLabels), &dstLabels)
	json.Unmarshal([]byte(p.DNSIPs), &dnsIPs)
	json.Unmarshal([]byte(p.SyscallArgs), &syscallArgs)
	json.Unmarshal([]byte(p.MatchedPolicies), &matchedPolicies)

	return &models.TelemetryEvent{
		ID:            p.ID,
		Timestamp:     time.UnixMicro(p.Timestamp),
		EventType:     models.EventType(p.EventType),
		NodeName:      p.NodeName,
		SrcNamespace:  p.SrcNamespace,
		SrcPodName:    p.SrcPodName,
		SrcPodLabels:  srcLabels,
		SrcIP:         p.SrcIP,
		SrcPort:       uint32(p.SrcPort),
		SrcIdentity:   uint32(p.SrcIdentity),
		SrcProcess:    p.SrcProcess,
		SrcPID:        uint32(p.SrcPID),
		SrcUID:        uint32(p.SrcUID),
		SrcBinary:     p.SrcBinary,
		SrcArguments:  p.SrcArguments,
		DstNamespace:  p.DstNamespace,
		DstPodName:    p.DstPodName,
		DstPodLabels:  dstLabels,
		DstIP:         p.DstIP,
		DstPort:       uint32(p.DstPort),
		DstIdentity:   uint32(p.DstIdentity),
		DstDNSName:    p.DstDNSName,
		Protocol:      p.Protocol,
		L7Type:        p.L7Type,
		Direction:     models.TrafficDirection(p.Direction),
		HTTPMethod:    p.HTTPMethod,
		HTTPPath:      p.HTTPPath,
		HTTPHost:      p.HTTPHost,
		HTTPStatus:    p.HTTPStatus,
		HTTPHeaders:   p.HTTPHeaders,
		HTTPProtocol:  p.HTTPProtocol,
		DNSQuery:      p.DNSQuery,
		DNSQueryType:  p.DNSQueryType,
		DNSRCode:      p.DNSRCode,
		DNSIPs:        dnsIPs,
		GRPCService:   p.GRPCService,
		GRPCMethod:    p.GRPCMethod,
		GRPCStatus:    p.GRPCStatus,
		KafkaTopic:    p.KafkaTopic,
		KafkaAPIKey:   p.KafkaAPIKey,
		KafkaErrorCode:   p.KafkaErrorCode,
		KafkaCorrelation: p.KafkaCorrelation,
		Syscall:       p.Syscall,
		SyscallArgs:   syscallArgs,
		FilePath:      p.FilePath,
		FileOperation: p.FileOperation,
		Verdict:       models.Verdict(p.Verdict),
		Action:        p.Action,
		BytesTotal:    p.BytesTotal,
		PacketsTotal:  p.PacketsTotal,
		TCPFlags:      p.TCPFlags,
		IsReply:       p.IsReply,
		MatchedPolicies: matchedPolicies,
		TraceID:       p.TraceID,
		SpanID:        p.SpanID,
		ParentSpanID:  p.ParentSpanID,
		Source:        p.Source,
	}
}

// jsonEncode encodes a value to JSON string.
func jsonEncode(v interface{}) string {
	if v == nil {
		return ""
	}
	data, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return string(data)
}

// ParquetReader reads telemetry events from Parquet files.
type ParquetReader struct {
	basePath string
	log      logr.Logger
}

// NewParquetReader creates a new Parquet reader.
func NewParquetReader(basePath string, log logr.Logger) *ParquetReader {
	return &ParquetReader{
		basePath: basePath,
		log:      log.WithName("parquet-reader"),
	}
}

// ReadEvents reads events from Parquet files within the given time range.
func (pr *ParquetReader) ReadEvents(ctx context.Context, req models.QueryEventsRequest) (*models.QueryEventsResponse, error) {
	var allEvents []*models.TelemetryEvent

	// Calculate date range
	startDate := req.StartTime.UTC().Format("2006-01-02")
	endDate := req.EndTime.UTC().Format("2006-01-02")

	pr.log.Info("ReadEvents: starting",
		"startDate", startDate,
		"endDate", endDate,
		"basePath", pr.basePath,
	)

	// Iterate through date directories
	current := req.StartTime.UTC()
	iterations := 0
	for !current.After(req.EndTime.UTC()) {
		iterations++
		if iterations > 100 {
			pr.log.Error(nil, "ReadEvents: too many iterations, breaking loop")
			break
		}

		dateStr := current.Format("2006-01-02")
		if dateStr >= startDate && dateStr <= endDate {
			dateDir := filepath.Join(pr.basePath, dateStr)
			pr.log.Info("ReadEvents: processing date directory", "date", dateStr, "dir", dateDir)

			events, err := pr.readDateDirectory(ctx, dateDir, req)
			if err != nil {
				pr.log.Error(err, "Error reading date directory", "date", dateStr)
			} else {
				pr.log.Info("ReadEvents: got events from directory", "date", dateStr, "count", len(events))
				allEvents = append(allEvents, events...)
			}
		}
		current = current.Add(24 * time.Hour)
	}

	pr.log.Info("ReadEvents: finished iterating directories", "iterations", iterations, "totalEvents", len(allEvents))

	// Apply limit and offset
	totalCount := int64(len(allEvents))

	if req.Offset > 0 && int(req.Offset) < len(allEvents) {
		allEvents = allEvents[req.Offset:]
	}

	hasMore := false
	if req.Limit > 0 && len(allEvents) > int(req.Limit) {
		allEvents = allEvents[:req.Limit]
		hasMore = true
	}

	// Convert []*TelemetryEvent to []TelemetryEvent
	events := make([]models.TelemetryEvent, len(allEvents))
	for i, e := range allEvents {
		events[i] = *e
	}

	return &models.QueryEventsResponse{
		Events:     events,
		TotalCount: totalCount,
		HasMore:    hasMore,
	}, nil
}

// readDateDirectory reads all Parquet files in a date directory.
func (pr *ParquetReader) readDateDirectory(ctx context.Context, dateDir string, req models.QueryEventsRequest) ([]*models.TelemetryEvent, error) {
	pr.log.Info("readDateDirectory: starting", "dir", dateDir)

	entries, err := os.ReadDir(dateDir)
	if os.IsNotExist(err) {
		pr.log.Info("readDateDirectory: directory does not exist", "dir", dateDir)
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to read directory: %w", err)
	}

	pr.log.Info("readDateDirectory: found entries", "count", len(entries))

	var events []*models.TelemetryEvent
	for i, entry := range entries {
		pr.log.Info("readDateDirectory: processing entry", "index", i, "name", entry.Name())

		select {
		case <-ctx.Done():
			return events, ctx.Err()
		default:
		}

		if entry.IsDir() || filepath.Ext(entry.Name()) != ".parquet" {
			continue
		}

		filePath := filepath.Join(dateDir, entry.Name())
		fileEvents, err := pr.readParquetFile(ctx, filePath, req)
		if err != nil {
			pr.log.Error(err, "Error reading Parquet file", "path", filePath)
			continue
		}
		events = append(events, fileEvents...)
	}

	return events, nil
}

// readParquetFile reads events from a single Parquet file.
func (pr *ParquetReader) readParquetFile(ctx context.Context, filePath string, req models.QueryEventsRequest) ([]*models.TelemetryEvent, error) {
	pr.log.Info("readParquetFile: opening file", "path", filePath)

	fr, err := local.NewLocalFileReader(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}
	defer fr.Close()

	pr.log.Info("readParquetFile: creating parquet reader")

	pqReader, err := reader.NewParquetReader(fr, new(ParquetEvent), int64(4))
	if err != nil {
		return nil, fmt.Errorf("failed to create reader: %w", err)
	}
	defer pqReader.ReadStop()

	numRows := int(pqReader.GetNumRows())
	pr.log.Info("readParquetFile: file info", "numRows", numRows)

	// Limit max rows to prevent memory issues with large files
	maxRows := 100000
	if numRows > maxRows {
		pr.log.Info("readParquetFile: limiting rows", "original", numRows, "limited", maxRows)
		numRows = maxRows
	}

	var events []*models.TelemetryEvent

	// Read in batches
	batchSize := 1000
	for i := 0; i < numRows; i += batchSize {
		select {
		case <-ctx.Done():
			return events, ctx.Err()
		default:
		}

		toRead := batchSize
		if i+toRead > numRows {
			toRead = numRows - i
		}

		pqEvents := make([]ParquetEvent, toRead)
		if err := pqReader.Read(&pqEvents); err != nil {
			return nil, fmt.Errorf("failed to read events: %w", err)
		}

		for _, pqEvent := range pqEvents {
			event := convertFromParquetEvent(&pqEvent)

			// Apply filters
			if !pr.matchesFilters(event, req) {
				continue
			}

			events = append(events, event)
		}
	}

	pr.log.Info("readParquetFile: complete", "matchedEvents", len(events))
	return events, nil
}

// matchesFilters checks if an event matches the query filters.
func (pr *ParquetReader) matchesFilters(event *models.TelemetryEvent, req models.QueryEventsRequest) bool {
	// Time range filter
	if event.Timestamp.Before(req.StartTime) || event.Timestamp.After(req.EndTime) {
		return false
	}

	// Namespace filter
	if len(req.Namespaces) > 0 {
		found := false
		for _, ns := range req.Namespaces {
			if event.SrcNamespace == ns || event.DstNamespace == ns {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}

	// Event type filter
	if len(req.EventTypes) > 0 {
		found := false
		for _, et := range req.EventTypes {
			if string(event.EventType) == et {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}

	return true
}

// ListDates returns all dates that have stored data.
func (pr *ParquetReader) ListDates() ([]string, error) {
	entries, err := os.ReadDir(pr.basePath)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to read base path: %w", err)
	}

	var dates []string
	for _, entry := range entries {
		if entry.IsDir() {
			// Validate date format
			if _, err := time.Parse("2006-01-02", entry.Name()); err == nil {
				dates = append(dates, entry.Name())
			}
		}
	}

	return dates, nil
}

// GetStorageSize returns the total size of stored data in bytes.
func (pr *ParquetReader) GetStorageSize() (int64, error) {
	var totalSize int64

	err := filepath.Walk(pr.basePath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip errors
		}
		if !info.IsDir() && filepath.Ext(path) == ".parquet" {
			totalSize += info.Size()
		}
		return nil
	})

	return totalSize, err
}
