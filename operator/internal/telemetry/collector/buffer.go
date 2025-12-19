package collector

import (
	"context"
	"sync"
	"time"

	"github.com/go-logr/logr"

	"github.com/policy-hub/operator/internal/telemetry/models"
)

const (
	// DefaultBufferSize is the default ring buffer capacity
	DefaultBufferSize = 10000
	// DefaultFlushInterval is the default interval between flushes
	DefaultFlushInterval = 30 * time.Second
	// DefaultFlushThreshold is the percentage of buffer capacity that triggers a flush
	DefaultFlushThreshold = 0.8
)

// RingBuffer is a thread-safe ring buffer for telemetry events.
// It buffers events in memory and periodically flushes them to storage.
type RingBuffer struct {
	buffer    []*models.TelemetryEvent
	size      int
	head      int // next write position
	tail      int // next read position
	count     int // current number of elements
	mu        sync.RWMutex
	log       logr.Logger

	// Flush configuration
	flushInterval  time.Duration
	flushThreshold float64

	// Callback for flushing events
	flushHandler func([]*models.TelemetryEvent) error

	// Metrics
	totalReceived  int64
	totalFlushed   int64
	totalDropped   int64
	lastFlushTime  time.Time
	metricsMu      sync.RWMutex
}

// RingBufferConfig contains configuration for the ring buffer.
type RingBufferConfig struct {
	// Size is the maximum number of events to buffer
	Size int
	// FlushInterval is how often to flush events to storage
	FlushInterval time.Duration
	// FlushThreshold is the percentage of capacity that triggers early flush (0.0-1.0)
	FlushThreshold float64
	// Logger for logging
	Logger logr.Logger
}

// NewRingBuffer creates a new ring buffer with the given configuration.
func NewRingBuffer(cfg RingBufferConfig) *RingBuffer {
	size := cfg.Size
	if size <= 0 {
		size = DefaultBufferSize
	}

	flushInterval := cfg.FlushInterval
	if flushInterval <= 0 {
		flushInterval = DefaultFlushInterval
	}

	flushThreshold := cfg.FlushThreshold
	if flushThreshold <= 0 || flushThreshold > 1.0 {
		flushThreshold = DefaultFlushThreshold
	}

	return &RingBuffer{
		buffer:         make([]*models.TelemetryEvent, size),
		size:           size,
		flushInterval:  flushInterval,
		flushThreshold: flushThreshold,
		log:            cfg.Logger.WithName("ring-buffer"),
		lastFlushTime:  time.Now(),
	}
}

// SetFlushHandler sets the callback for flushing events.
func (rb *RingBuffer) SetFlushHandler(handler func([]*models.TelemetryEvent) error) {
	rb.mu.Lock()
	defer rb.mu.Unlock()
	rb.flushHandler = handler
}

// Push adds an event to the buffer.
// If the buffer is full, the oldest event is overwritten.
func (rb *RingBuffer) Push(event *models.TelemetryEvent) {
	if event == nil {
		return
	}

	rb.mu.Lock()
	defer rb.mu.Unlock()

	rb.metricsMu.Lock()
	rb.totalReceived++
	rb.metricsMu.Unlock()

	// Check if buffer is full
	if rb.count == rb.size {
		// Overwrite oldest event (drop it)
		rb.tail = (rb.tail + 1) % rb.size
		rb.count--

		rb.metricsMu.Lock()
		rb.totalDropped++
		rb.metricsMu.Unlock()
	}

	// Add new event
	rb.buffer[rb.head] = event
	rb.head = (rb.head + 1) % rb.size
	rb.count++

	// Check if we should trigger early flush
	if float64(rb.count)/float64(rb.size) >= rb.flushThreshold {
		// Trigger async flush (non-blocking)
		go rb.flushAsync()
	}
}

// PushBatch adds multiple events to the buffer.
func (rb *RingBuffer) PushBatch(events []*models.TelemetryEvent) {
	for _, event := range events {
		rb.Push(event)
	}
}

// Drain removes and returns all events from the buffer.
func (rb *RingBuffer) Drain() []*models.TelemetryEvent {
	rb.mu.Lock()
	defer rb.mu.Unlock()

	if rb.count == 0 {
		return nil
	}

	events := make([]*models.TelemetryEvent, rb.count)
	for i := 0; i < rb.count; i++ {
		idx := (rb.tail + i) % rb.size
		events[i] = rb.buffer[idx]
		rb.buffer[idx] = nil // Clear reference for GC
	}

	// Reset buffer
	rb.head = 0
	rb.tail = 0
	rb.count = 0

	return events
}

// Peek returns all events without removing them.
func (rb *RingBuffer) Peek() []*models.TelemetryEvent {
	rb.mu.RLock()
	defer rb.mu.RUnlock()

	if rb.count == 0 {
		return nil
	}

	events := make([]*models.TelemetryEvent, rb.count)
	for i := 0; i < rb.count; i++ {
		idx := (rb.tail + i) % rb.size
		events[i] = rb.buffer[idx]
	}

	return events
}

// Count returns the current number of events in the buffer.
func (rb *RingBuffer) Count() int {
	rb.mu.RLock()
	defer rb.mu.RUnlock()
	return rb.count
}

// Capacity returns the maximum capacity of the buffer.
func (rb *RingBuffer) Capacity() int {
	return rb.size
}

// IsFull returns whether the buffer is at capacity.
func (rb *RingBuffer) IsFull() bool {
	rb.mu.RLock()
	defer rb.mu.RUnlock()
	return rb.count == rb.size
}

// flushAsync performs a non-blocking flush.
func (rb *RingBuffer) flushAsync() {
	rb.mu.RLock()
	handler := rb.flushHandler
	rb.mu.RUnlock()

	if handler == nil {
		return
	}

	events := rb.Drain()
	if len(events) == 0 {
		return
	}

	if err := handler(events); err != nil {
		rb.log.Error(err, "Failed to flush events", "count", len(events))
		// Re-add events on failure (best effort)
		rb.PushBatch(events)
		return
	}

	rb.metricsMu.Lock()
	rb.totalFlushed += int64(len(events))
	rb.lastFlushTime = time.Now()
	rb.metricsMu.Unlock()

	rb.log.V(1).Info("Flushed events", "count", len(events))
}

// Flush forces a flush of all buffered events.
func (rb *RingBuffer) Flush() error {
	rb.mu.RLock()
	handler := rb.flushHandler
	rb.mu.RUnlock()

	if handler == nil {
		return nil
	}

	events := rb.Drain()
	if len(events) == 0 {
		return nil
	}

	if err := handler(events); err != nil {
		rb.log.Error(err, "Failed to flush events", "count", len(events))
		// Re-add events on failure
		rb.PushBatch(events)
		return err
	}

	rb.metricsMu.Lock()
	rb.totalFlushed += int64(len(events))
	rb.lastFlushTime = time.Now()
	rb.metricsMu.Unlock()

	rb.log.Info("Flushed events", "count", len(events))
	return nil
}

// StartFlushWorker starts a background worker that periodically flushes the buffer.
// It returns when the context is cancelled.
func (rb *RingBuffer) StartFlushWorker(ctx context.Context) {
	ticker := time.NewTicker(rb.flushInterval)
	defer ticker.Stop()

	rb.log.Info("Starting flush worker", "interval", rb.flushInterval)

	for {
		select {
		case <-ctx.Done():
			rb.log.Info("Flush worker stopping, performing final flush")
			if err := rb.Flush(); err != nil {
				rb.log.Error(err, "Final flush failed")
			}
			return
		case <-ticker.C:
			if err := rb.Flush(); err != nil {
				rb.log.Error(err, "Periodic flush failed")
			}
		}
	}
}

// Metrics contains buffer statistics.
type Metrics struct {
	CurrentCount   int
	Capacity       int
	TotalReceived  int64
	TotalFlushed   int64
	TotalDropped   int64
	LastFlushTime  time.Time
	FillPercentage float64
}

// GetMetrics returns current buffer statistics.
func (rb *RingBuffer) GetMetrics() Metrics {
	rb.mu.RLock()
	count := rb.count
	rb.mu.RUnlock()

	rb.metricsMu.RLock()
	defer rb.metricsMu.RUnlock()

	return Metrics{
		CurrentCount:   count,
		Capacity:       rb.size,
		TotalReceived:  rb.totalReceived,
		TotalFlushed:   rb.totalFlushed,
		TotalDropped:   rb.totalDropped,
		LastFlushTime:  rb.lastFlushTime,
		FillPercentage: float64(count) / float64(rb.size) * 100,
	}
}

// EventBatcher provides batch processing for events.
type EventBatcher struct {
	buffer    *RingBuffer
	batchSize int
	mu        sync.Mutex
}

// NewEventBatcher creates a batcher that wraps a ring buffer.
func NewEventBatcher(buffer *RingBuffer, batchSize int) *EventBatcher {
	if batchSize <= 0 {
		batchSize = 100
	}
	return &EventBatcher{
		buffer:    buffer,
		batchSize: batchSize,
	}
}

// Add adds an event to the batcher.
func (eb *EventBatcher) Add(event *models.TelemetryEvent) {
	eb.buffer.Push(event)
}

// ProcessBatch retrieves a batch of events for processing.
func (eb *EventBatcher) ProcessBatch(handler func([]*models.TelemetryEvent) error) error {
	eb.mu.Lock()
	defer eb.mu.Unlock()

	events := eb.buffer.Peek()
	if len(events) == 0 {
		return nil
	}

	// Take up to batchSize events
	if len(events) > eb.batchSize {
		events = events[:eb.batchSize]
	}

	if err := handler(events); err != nil {
		return err
	}

	// Only drain what we processed
	eb.buffer.mu.Lock()
	for i := 0; i < len(events); i++ {
		eb.buffer.buffer[eb.buffer.tail] = nil
		eb.buffer.tail = (eb.buffer.tail + 1) % eb.buffer.size
		eb.buffer.count--
	}
	eb.buffer.mu.Unlock()

	return nil
}
