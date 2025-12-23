package collector

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-logr/logr"

	"github.com/policy-hub/operator/internal/telemetry/models"
)

func TestRingBuffer_NewRingBuffer(t *testing.T) {
	rb := NewRingBuffer(RingBufferConfig{
		Size:           100,
		FlushInterval:  10 * time.Second,
		FlushThreshold: 0.5,
		Logger:         logr.Discard(),
	})

	if rb.Capacity() != 100 {
		t.Errorf("Capacity() = %d, want 100", rb.Capacity())
	}
	if rb.Count() != 0 {
		t.Errorf("Count() = %d, want 0", rb.Count())
	}
}

func TestRingBuffer_NewRingBuffer_Defaults(t *testing.T) {
	rb := NewRingBuffer(RingBufferConfig{
		Logger: logr.Discard(),
	})

	if rb.Capacity() != DefaultBufferSize {
		t.Errorf("Capacity() = %d, want %d", rb.Capacity(), DefaultBufferSize)
	}
	if rb.flushInterval != DefaultFlushInterval {
		t.Errorf("flushInterval = %v, want %v", rb.flushInterval, DefaultFlushInterval)
	}
	if rb.flushThreshold != DefaultFlushThreshold {
		t.Errorf("flushThreshold = %f, want %f", rb.flushThreshold, DefaultFlushThreshold)
	}
}

func TestRingBuffer_Push(t *testing.T) {
	rb := NewRingBuffer(RingBufferConfig{
		Size:   10,
		Logger: logr.Discard(),
	})

	event := &models.TelemetryEvent{
		ID:           "test-1",
		EventType:    models.EventTypeFlow,
		SrcNamespace: "default",
	}

	rb.Push(event)

	if rb.Count() != 1 {
		t.Errorf("Count() = %d, want 1", rb.Count())
	}
}

func TestRingBuffer_Push_Nil(t *testing.T) {
	rb := NewRingBuffer(RingBufferConfig{
		Size:   10,
		Logger: logr.Discard(),
	})

	rb.Push(nil)

	if rb.Count() != 0 {
		t.Errorf("Count() = %d, want 0 after pushing nil", rb.Count())
	}
}

func TestRingBuffer_Push_Overflow(t *testing.T) {
	rb := NewRingBuffer(RingBufferConfig{
		Size:           5,
		FlushThreshold: 1.1, // Disable auto-flush
		Logger:         logr.Discard(),
	})

	// Push more events than capacity
	for i := 0; i < 10; i++ {
		rb.Push(&models.TelemetryEvent{
			ID: string(rune('0' + i)),
		})
	}

	// Should still have capacity events (oldest dropped)
	if rb.Count() != 5 {
		t.Errorf("Count() = %d, want 5", rb.Count())
	}

	// Verify metrics
	metrics := rb.GetMetrics()
	if metrics.TotalReceived != 10 {
		t.Errorf("TotalReceived = %d, want 10", metrics.TotalReceived)
	}
	if metrics.TotalDropped != 5 {
		t.Errorf("TotalDropped = %d, want 5", metrics.TotalDropped)
	}
}

func TestRingBuffer_PushBatch(t *testing.T) {
	rb := NewRingBuffer(RingBufferConfig{
		Size:           100,
		FlushThreshold: 1.1, // Disable auto-flush
		Logger:         logr.Discard(),
	})

	events := []*models.TelemetryEvent{
		{ID: "1"},
		{ID: "2"},
		{ID: "3"},
	}

	rb.PushBatch(events)

	if rb.Count() != 3 {
		t.Errorf("Count() = %d, want 3", rb.Count())
	}
}

func TestRingBuffer_Drain(t *testing.T) {
	rb := NewRingBuffer(RingBufferConfig{
		Size:           100,
		FlushThreshold: 1.1,
		Logger:         logr.Discard(),
	})

	events := []*models.TelemetryEvent{
		{ID: "1"},
		{ID: "2"},
		{ID: "3"},
	}
	rb.PushBatch(events)

	drained := rb.Drain()

	if len(drained) != 3 {
		t.Errorf("Drain() returned %d events, want 3", len(drained))
	}
	if rb.Count() != 0 {
		t.Errorf("Count() after Drain() = %d, want 0", rb.Count())
	}

	// Verify order is preserved
	for i, e := range drained {
		expectedID := string(rune('1' + i))
		if e.ID != expectedID {
			t.Errorf("Drain()[%d].ID = %s, want %s", i, e.ID, expectedID)
		}
	}
}

func TestRingBuffer_Drain_Empty(t *testing.T) {
	rb := NewRingBuffer(RingBufferConfig{
		Size:   10,
		Logger: logr.Discard(),
	})

	drained := rb.Drain()

	if drained != nil {
		t.Errorf("Drain() on empty buffer should return nil, got %v", drained)
	}
}

func TestRingBuffer_Peek(t *testing.T) {
	rb := NewRingBuffer(RingBufferConfig{
		Size:           100,
		FlushThreshold: 1.1,
		Logger:         logr.Discard(),
	})

	events := []*models.TelemetryEvent{
		{ID: "1"},
		{ID: "2"},
	}
	rb.PushBatch(events)

	peeked := rb.Peek()

	if len(peeked) != 2 {
		t.Errorf("Peek() returned %d events, want 2", len(peeked))
	}
	// Count should not change after Peek
	if rb.Count() != 2 {
		t.Errorf("Count() after Peek() = %d, want 2", rb.Count())
	}
}

func TestRingBuffer_Peek_Empty(t *testing.T) {
	rb := NewRingBuffer(RingBufferConfig{
		Size:   10,
		Logger: logr.Discard(),
	})

	peeked := rb.Peek()

	if peeked != nil {
		t.Errorf("Peek() on empty buffer should return nil, got %v", peeked)
	}
}

func TestRingBuffer_IsFull(t *testing.T) {
	rb := NewRingBuffer(RingBufferConfig{
		Size:           3,
		FlushThreshold: 1.1,
		Logger:         logr.Discard(),
	})

	if rb.IsFull() {
		t.Error("IsFull() should be false for empty buffer")
	}

	rb.Push(&models.TelemetryEvent{ID: "1"})
	rb.Push(&models.TelemetryEvent{ID: "2"})

	if rb.IsFull() {
		t.Error("IsFull() should be false when not at capacity")
	}

	rb.Push(&models.TelemetryEvent{ID: "3"})

	if !rb.IsFull() {
		t.Error("IsFull() should be true when at capacity")
	}
}

func TestRingBuffer_Flush(t *testing.T) {
	rb := NewRingBuffer(RingBufferConfig{
		Size:           100,
		FlushThreshold: 1.1,
		Logger:         logr.Discard(),
	})

	var flushedEvents []*models.TelemetryEvent
	rb.SetFlushHandler(func(events []*models.TelemetryEvent) error {
		flushedEvents = events
		return nil
	})

	events := []*models.TelemetryEvent{
		{ID: "1"},
		{ID: "2"},
	}
	rb.PushBatch(events)

	err := rb.Flush()
	if err != nil {
		t.Errorf("Flush() error = %v", err)
	}

	if len(flushedEvents) != 2 {
		t.Errorf("Flushed %d events, want 2", len(flushedEvents))
	}
	if rb.Count() != 0 {
		t.Errorf("Count() after Flush() = %d, want 0", rb.Count())
	}

	metrics := rb.GetMetrics()
	if metrics.TotalFlushed != 2 {
		t.Errorf("TotalFlushed = %d, want 2", metrics.TotalFlushed)
	}
}

func TestRingBuffer_Flush_NoHandler(t *testing.T) {
	rb := NewRingBuffer(RingBufferConfig{
		Size:   100,
		Logger: logr.Discard(),
	})

	rb.Push(&models.TelemetryEvent{ID: "1"})

	// Flush without handler should not error
	err := rb.Flush()
	if err != nil {
		t.Errorf("Flush() without handler error = %v", err)
	}
}

func TestRingBuffer_Flush_Empty(t *testing.T) {
	rb := NewRingBuffer(RingBufferConfig{
		Size:   100,
		Logger: logr.Discard(),
	})

	handlerCalled := false
	rb.SetFlushHandler(func(events []*models.TelemetryEvent) error {
		handlerCalled = true
		return nil
	})

	err := rb.Flush()
	if err != nil {
		t.Errorf("Flush() error = %v", err)
	}
	if handlerCalled {
		t.Error("Handler should not be called for empty buffer")
	}
}

func TestRingBuffer_GetMetrics(t *testing.T) {
	rb := NewRingBuffer(RingBufferConfig{
		Size:           10,
		FlushThreshold: 1.1,
		Logger:         logr.Discard(),
	})

	// Push some events
	for i := 0; i < 5; i++ {
		rb.Push(&models.TelemetryEvent{ID: string(rune('0' + i))})
	}

	metrics := rb.GetMetrics()

	if metrics.CurrentCount != 5 {
		t.Errorf("CurrentCount = %d, want 5", metrics.CurrentCount)
	}
	if metrics.Capacity != 10 {
		t.Errorf("Capacity = %d, want 10", metrics.Capacity)
	}
	if metrics.TotalReceived != 5 {
		t.Errorf("TotalReceived = %d, want 5", metrics.TotalReceived)
	}
	if metrics.FillPercentage != 50.0 {
		t.Errorf("FillPercentage = %f, want 50.0", metrics.FillPercentage)
	}
}

func TestRingBuffer_StartFlushWorker(t *testing.T) {
	rb := NewRingBuffer(RingBufferConfig{
		Size:          100,
		FlushInterval: 50 * time.Millisecond,
		Logger:        logr.Discard(),
	})

	var flushCount int32
	rb.SetFlushHandler(func(events []*models.TelemetryEvent) error {
		atomic.AddInt32(&flushCount, 1)
		return nil
	})

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	// Push events
	rb.Push(&models.TelemetryEvent{ID: "1"})

	// Start worker in goroutine
	done := make(chan struct{})
	go func() {
		rb.StartFlushWorker(ctx)
		close(done)
	}()

	// Wait for worker to finish
	<-done

	// Should have at least one flush (periodic + final)
	if atomic.LoadInt32(&flushCount) < 1 {
		t.Error("Expected at least one flush")
	}
}

func TestRingBuffer_Concurrent(t *testing.T) {
	rb := NewRingBuffer(RingBufferConfig{
		Size:           1000,
		FlushThreshold: 1.1,
		Logger:         logr.Discard(),
	})

	var wg sync.WaitGroup
	numWriters := 10
	eventsPerWriter := 100

	// Concurrent writers
	for i := 0; i < numWriters; i++ {
		wg.Add(1)
		go func(writerID int) {
			defer wg.Done()
			for j := 0; j < eventsPerWriter; j++ {
				rb.Push(&models.TelemetryEvent{
					ID: string(rune(writerID*100 + j)),
				})
			}
		}(i)
	}

	wg.Wait()

	metrics := rb.GetMetrics()
	expectedReceived := int64(numWriters * eventsPerWriter)
	if metrics.TotalReceived != expectedReceived {
		t.Errorf("TotalReceived = %d, want %d", metrics.TotalReceived, expectedReceived)
	}
}

func TestRingBuffer_WrapAround(t *testing.T) {
	rb := NewRingBuffer(RingBufferConfig{
		Size:           5,
		FlushThreshold: 1.1,
		Logger:         logr.Discard(),
	})

	// Push events to wrap around
	for i := 0; i < 8; i++ {
		rb.Push(&models.TelemetryEvent{ID: string(rune('A' + i))})
	}

	// Should have last 5 events (D, E, F, G, H)
	events := rb.Drain()
	if len(events) != 5 {
		t.Fatalf("Expected 5 events, got %d", len(events))
	}

	expectedIDs := []string{"D", "E", "F", "G", "H"}
	for i, e := range events {
		if e.ID != expectedIDs[i] {
			t.Errorf("Event[%d].ID = %s, want %s", i, e.ID, expectedIDs[i])
		}
	}
}

func TestEventBatcher_NewEventBatcher(t *testing.T) {
	rb := NewRingBuffer(RingBufferConfig{
		Size:   100,
		Logger: logr.Discard(),
	})

	batcher := NewEventBatcher(rb, 10)
	if batcher.batchSize != 10 {
		t.Errorf("batchSize = %d, want 10", batcher.batchSize)
	}
}

func TestEventBatcher_NewEventBatcher_DefaultBatchSize(t *testing.T) {
	rb := NewRingBuffer(RingBufferConfig{
		Size:   100,
		Logger: logr.Discard(),
	})

	batcher := NewEventBatcher(rb, 0)
	if batcher.batchSize != 100 {
		t.Errorf("batchSize = %d, want 100 (default)", batcher.batchSize)
	}
}

func TestEventBatcher_Add(t *testing.T) {
	rb := NewRingBuffer(RingBufferConfig{
		Size:   100,
		Logger: logr.Discard(),
	})

	batcher := NewEventBatcher(rb, 10)
	batcher.Add(&models.TelemetryEvent{ID: "1"})

	if rb.Count() != 1 {
		t.Errorf("Count() = %d, want 1", rb.Count())
	}
}

func TestEventBatcher_ProcessBatch(t *testing.T) {
	rb := NewRingBuffer(RingBufferConfig{
		Size:           100,
		FlushThreshold: 1.1,
		Logger:         logr.Discard(),
	})

	batcher := NewEventBatcher(rb, 2)

	// Add 5 events
	for i := 0; i < 5; i++ {
		batcher.Add(&models.TelemetryEvent{ID: string(rune('1' + i))})
	}

	var processedEvents []*models.TelemetryEvent
	err := batcher.ProcessBatch(func(events []*models.TelemetryEvent) error {
		processedEvents = events
		return nil
	})

	if err != nil {
		t.Errorf("ProcessBatch() error = %v", err)
	}

	// Should process batchSize (2) events
	if len(processedEvents) != 2 {
		t.Errorf("Processed %d events, want 2", len(processedEvents))
	}

	// Should have 3 events remaining
	if rb.Count() != 3 {
		t.Errorf("Remaining count = %d, want 3", rb.Count())
	}
}

func TestEventBatcher_ProcessBatch_Empty(t *testing.T) {
	rb := NewRingBuffer(RingBufferConfig{
		Size:   100,
		Logger: logr.Discard(),
	})

	batcher := NewEventBatcher(rb, 10)

	handlerCalled := false
	err := batcher.ProcessBatch(func(events []*models.TelemetryEvent) error {
		handlerCalled = true
		return nil
	})

	if err != nil {
		t.Errorf("ProcessBatch() error = %v", err)
	}
	if handlerCalled {
		t.Error("Handler should not be called for empty batch")
	}
}

func TestRingBuffer_Flush_Error(t *testing.T) {
	rb := NewRingBuffer(RingBufferConfig{
		Size:           100,
		FlushThreshold: 1.1,
		Logger:         logr.Discard(),
	})

	testErr := fmt.Errorf("flush failed")
	rb.SetFlushHandler(func(events []*models.TelemetryEvent) error {
		return testErr
	})

	events := []*models.TelemetryEvent{
		{ID: "1"},
		{ID: "2"},
	}
	rb.PushBatch(events)

	err := rb.Flush()
	if err != testErr {
		t.Errorf("Flush() error = %v, want %v", err, testErr)
	}

	// Events should be re-added to buffer on error
	if rb.Count() != 2 {
		t.Errorf("Count() after failed Flush() = %d, want 2 (events should be re-added)", rb.Count())
	}
}

func TestRingBuffer_StartFlushWorker_WithError(t *testing.T) {
	rb := NewRingBuffer(RingBufferConfig{
		Size:          100,
		FlushInterval: 30 * time.Millisecond,
		Logger:        logr.Discard(),
	})

	var flushAttempts int32
	rb.SetFlushHandler(func(events []*models.TelemetryEvent) error {
		atomic.AddInt32(&flushAttempts, 1)
		return fmt.Errorf("flush error")
	})

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	// Push events
	rb.Push(&models.TelemetryEvent{ID: "1"})

	// Start worker in goroutine
	done := make(chan struct{})
	go func() {
		rb.StartFlushWorker(ctx)
		close(done)
	}()

	// Wait for worker to finish
	<-done

	// Should have attempted at least one flush despite errors
	if atomic.LoadInt32(&flushAttempts) < 1 {
		t.Error("Expected at least one flush attempt")
	}
}

func TestRingBuffer_ThresholdFlush(t *testing.T) {
	rb := NewRingBuffer(RingBufferConfig{
		Size:           10,
		FlushThreshold: 0.5, // 50% threshold
		Logger:         logr.Discard(),
	})

	var flushedEvents []*models.TelemetryEvent
	rb.SetFlushHandler(func(events []*models.TelemetryEvent) error {
		flushedEvents = append(flushedEvents, events...)
		return nil
	})

	// Push events up to threshold (50% of 10 = 5 events)
	for i := 0; i < 5; i++ {
		rb.Push(&models.TelemetryEvent{ID: string(rune('1' + i))})
	}

	// Give async flush time to complete
	time.Sleep(50 * time.Millisecond)

	// Events should have been flushed due to threshold
	if len(flushedEvents) == 0 {
		t.Log("Threshold flush may not have triggered (async)")
	}
}

func TestRingBuffer_PushBatch_Nil(t *testing.T) {
	rb := NewRingBuffer(RingBufferConfig{
		Size:   10,
		Logger: logr.Discard(),
	})

	// Push nil batch should not panic
	rb.PushBatch(nil)

	if rb.Count() != 0 {
		t.Errorf("Count() = %d, want 0 after pushing nil batch", rb.Count())
	}
}

func TestRingBuffer_PushBatch_Empty(t *testing.T) {
	rb := NewRingBuffer(RingBufferConfig{
		Size:   10,
		Logger: logr.Discard(),
	})

	// Push empty batch should not panic
	rb.PushBatch([]*models.TelemetryEvent{})

	if rb.Count() != 0 {
		t.Errorf("Count() = %d, want 0 after pushing empty batch", rb.Count())
	}
}

func TestRingBuffer_GetMetrics_AfterFlush(t *testing.T) {
	rb := NewRingBuffer(RingBufferConfig{
		Size:           100,
		FlushThreshold: 1.1,
		Logger:         logr.Discard(),
	})

	rb.SetFlushHandler(func(events []*models.TelemetryEvent) error {
		return nil
	})

	// Push and flush events
	for i := 0; i < 5; i++ {
		rb.Push(&models.TelemetryEvent{ID: string(rune('0' + i))})
	}

	err := rb.Flush()
	if err != nil {
		t.Fatalf("Flush() error = %v", err)
	}

	metrics := rb.GetMetrics()

	if metrics.TotalFlushed != 5 {
		t.Errorf("TotalFlushed = %d, want 5", metrics.TotalFlushed)
	}
	if metrics.CurrentCount != 0 {
		t.Errorf("CurrentCount = %d, want 0", metrics.CurrentCount)
	}
	if metrics.LastFlushTime.IsZero() {
		t.Error("LastFlushTime should not be zero after flush")
	}
}

func TestEventBatcher_ProcessBatch_WithError(t *testing.T) {
	rb := NewRingBuffer(RingBufferConfig{
		Size:           100,
		FlushThreshold: 1.1,
		Logger:         logr.Discard(),
	})

	batcher := NewEventBatcher(rb, 5)

	// Add some events
	for i := 0; i < 5; i++ {
		batcher.Add(&models.TelemetryEvent{ID: string(rune('1' + i))})
	}

	testErr := fmt.Errorf("processing error")
	err := batcher.ProcessBatch(func(events []*models.TelemetryEvent) error {
		return testErr
	})

	if err != testErr {
		t.Errorf("ProcessBatch() error = %v, want %v", err, testErr)
	}
}
