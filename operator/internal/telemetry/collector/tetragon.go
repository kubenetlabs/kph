package collector

import (
	"context"
	"fmt"
	"io"
	"strings"
	"sync"
	"time"

	"github.com/go-logr/logr"
	"github.com/google/uuid"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	"github.com/cilium/tetragon/api/v1/tetragon"

	"github.com/policy-hub/operator/internal/telemetry/models"
)

// TetragonClient connects to Tetragon and streams process/syscall events.
type TetragonClient struct {
	address  string
	log      logr.Logger
	nodeName string

	conn      *grpc.ClientConn
	client    tetragon.FineGuidanceSensorsClient
	mu        sync.RWMutex
	connected bool

	// Callback for received events
	eventHandler func(*models.TelemetryEvent)

	// Filtering
	namespaceFilter []string

	// Collection options
	collectProcessExec bool
	collectProcessExit bool
	collectKprobes     bool
}

// TetragonClientConfig contains configuration for the Tetragon client.
type TetragonClientConfig struct {
	// Address of Tetragon gRPC server (e.g., "unix:///var/run/tetragon/tetragon.sock")
	Address string
	// NodeName is the name of the current node (for event tagging)
	NodeName string
	// NamespaceFilter limits events to specific namespaces (empty = all)
	NamespaceFilter []string
	// CollectProcessExec enables process exec event collection
	CollectProcessExec bool
	// CollectProcessExit enables process exit event collection
	CollectProcessExit bool
	// CollectKprobes enables kprobe event collection
	CollectKprobes bool
	// Logger for logging
	Logger logr.Logger
}

// NewTetragonClient creates a new Tetragon client.
func NewTetragonClient(cfg TetragonClientConfig) *TetragonClient {
	return &TetragonClient{
		address:            cfg.Address,
		log:                cfg.Logger.WithName("tetragon-client"),
		nodeName:           cfg.NodeName,
		namespaceFilter:    cfg.NamespaceFilter,
		collectProcessExec: cfg.CollectProcessExec,
		collectProcessExit: cfg.CollectProcessExit,
		collectKprobes:     cfg.CollectKprobes,
	}
}

// SetEventHandler sets the callback for received events.
func (t *TetragonClient) SetEventHandler(handler func(*models.TelemetryEvent)) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.eventHandler = handler
}

// Connect establishes connection to Tetragon.
func (t *TetragonClient) Connect(ctx context.Context) error {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.connected {
		return nil
	}

	opts := []grpc.DialOption{
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithBlock(),
	}

	t.log.Info("Connecting to Tetragon", "address", t.address)

	conn, err := grpc.DialContext(ctx, t.address, opts...)
	if err != nil {
		return fmt.Errorf("failed to connect to Tetragon at %s: %w", t.address, err)
	}

	t.conn = conn
	t.client = tetragon.NewFineGuidanceSensorsClient(conn)
	t.connected = true

	t.log.Info("Connected to Tetragon successfully")
	return nil
}

// Close closes the connection to Tetragon.
func (t *TetragonClient) Close() error {
	t.mu.Lock()
	defer t.mu.Unlock()

	if !t.connected {
		return nil
	}

	t.connected = false
	if t.conn != nil {
		return t.conn.Close()
	}
	return nil
}

// StreamEvents starts streaming events from Tetragon.
// This is a blocking call that runs until the context is cancelled.
func (t *TetragonClient) StreamEvents(ctx context.Context) error {
	t.mu.RLock()
	if !t.connected {
		t.mu.RUnlock()
		return fmt.Errorf("not connected to Tetragon")
	}
	client := t.client
	t.mu.RUnlock()

	// Build the event request with filters
	req := &tetragon.GetEventsRequest{
		AllowList: t.buildAllowList(),
	}

	t.log.Info("Starting event stream from Tetragon")

	stream, err := client.GetEvents(ctx, req)
	if err != nil {
		return fmt.Errorf("failed to start event stream: %w", err)
	}

	// Process events
	for {
		select {
		case <-ctx.Done():
			t.log.Info("Event stream context cancelled")
			return ctx.Err()
		default:
		}

		resp, err := stream.Recv()
		if err == io.EOF {
			t.log.Info("Event stream ended")
			return nil
		}
		if err != nil {
			return fmt.Errorf("error receiving event: %w", err)
		}

		// Convert to unified event
		event := t.responseToEvent(resp)
		if event == nil {
			continue
		}

		// Apply namespace filter
		if !t.matchesNamespaceFilter(event) {
			continue
		}

		// Call the event handler
		t.mu.RLock()
		handler := t.eventHandler
		t.mu.RUnlock()

		if handler != nil {
			handler(event)
		}
	}
}

// buildAllowList creates event filters based on configuration.
func (t *TetragonClient) buildAllowList() []*tetragon.Filter {
	var filters []*tetragon.Filter

	// Build event type filter
	var eventTypes []tetragon.EventType
	if t.collectProcessExec {
		eventTypes = append(eventTypes, tetragon.EventType_PROCESS_EXEC)
	}
	if t.collectProcessExit {
		eventTypes = append(eventTypes, tetragon.EventType_PROCESS_EXIT)
	}
	if t.collectKprobes {
		eventTypes = append(eventTypes, tetragon.EventType_PROCESS_KPROBE)
	}

	if len(eventTypes) > 0 {
		filters = append(filters, &tetragon.Filter{
			EventSet: eventTypes,
		})
	}

	// Add namespace filter if specified
	if len(t.namespaceFilter) > 0 {
		filters = append(filters, &tetragon.Filter{
			Namespace: t.namespaceFilter,
		})
	}

	return filters
}

// matchesNamespaceFilter checks if an event matches the namespace filter.
func (t *TetragonClient) matchesNamespaceFilter(event *models.TelemetryEvent) bool {
	if len(t.namespaceFilter) == 0 {
		return true
	}

	for _, ns := range t.namespaceFilter {
		if event.SrcNamespace == ns {
			return true
		}
	}
	return false
}

// responseToEvent converts a Tetragon event response to a unified TelemetryEvent.
func (t *TetragonClient) responseToEvent(resp *tetragon.GetEventsResponse) *models.TelemetryEvent {
	if resp == nil {
		return nil
	}

	switch ev := resp.Event.(type) {
	case *tetragon.GetEventsResponse_ProcessExec:
		return t.processExecToEvent(ev.ProcessExec)
	case *tetragon.GetEventsResponse_ProcessExit:
		return t.processExitToEvent(ev.ProcessExit)
	case *tetragon.GetEventsResponse_ProcessKprobe:
		return t.kprobeToEvent(ev.ProcessKprobe)
	default:
		return nil
	}
}

// processExecToEvent converts a ProcessExec event to TelemetryEvent.
func (t *TetragonClient) processExecToEvent(exec *tetragon.ProcessExec) *models.TelemetryEvent {
	if exec == nil || exec.Process == nil {
		return nil
	}

	proc := exec.Process
	event := &models.TelemetryEvent{
		ID:        uuid.New().String(),
		Timestamp: time.Now(), // Tetragon events have timestamps, use if available
		EventType: models.EventTypeProcessExec,
		NodeName:  t.nodeName,
		Source:    models.SourceTetragon,
		Verdict:   models.VerdictAllowed,
	}

	// Extract process information
	t.extractProcessInfo(event, proc)

	// Extract parent process if available
	if exec.Parent != nil {
		event.Action = fmt.Sprintf("parent=%s", exec.Parent.Binary)
	}

	return event
}

// processExitToEvent converts a ProcessExit event to TelemetryEvent.
func (t *TetragonClient) processExitToEvent(exit *tetragon.ProcessExit) *models.TelemetryEvent {
	if exit == nil || exit.Process == nil {
		return nil
	}

	proc := exit.Process
	event := &models.TelemetryEvent{
		ID:        uuid.New().String(),
		Timestamp: time.Now(),
		EventType: models.EventTypeProcessExec, // Using same type, action differentiates
		NodeName:  t.nodeName,
		Source:    models.SourceTetragon,
		Verdict:   models.VerdictAllowed,
		Action:    "exit",
	}

	// Extract process information
	t.extractProcessInfo(event, proc)

	// Add exit info
	if exit.Signal != "" {
		event.Action = fmt.Sprintf("exit:signal=%s", exit.Signal)
	} else {
		event.Action = fmt.Sprintf("exit:status=%d", exit.Status)
	}

	return event
}

// kprobeToEvent converts a Kprobe event to TelemetryEvent.
func (t *TetragonClient) kprobeToEvent(kprobe *tetragon.ProcessKprobe) *models.TelemetryEvent {
	if kprobe == nil || kprobe.Process == nil {
		return nil
	}

	proc := kprobe.Process
	event := &models.TelemetryEvent{
		ID:        uuid.New().String(),
		Timestamp: time.Now(),
		EventType: models.EventTypeSyscall,
		NodeName:  t.nodeName,
		Source:    models.SourceTetragon,
		Verdict:   models.VerdictAllowed,
	}

	// Extract process information
	t.extractProcessInfo(event, proc)

	// Extract kprobe/syscall information
	event.Syscall = kprobe.FunctionName

	// Extract arguments
	var args []string
	for _, arg := range kprobe.Args {
		args = append(args, formatKprobeArg(arg))
	}
	event.SyscallArgs = args

	// Check for file operations
	if isFileOperation(kprobe.FunctionName) {
		event.EventType = models.EventTypeFileAccess
		event.FileOperation = kprobe.FunctionName
		// Try to extract file path from arguments
		for _, arg := range kprobe.Args {
			if path := extractFilePath(arg); path != "" {
				event.FilePath = path
				break
			}
		}
	}

	// Extract action (for enforcement policies)
	event.Action = kprobe.Action.String()

	// Extract policy name if present
	if kprobe.PolicyName != "" {
		event.MatchedPolicies = []string{kprobe.PolicyName}
	}

	// Set verdict based on action
	switch kprobe.Action {
	case tetragon.KprobeAction_KPROBE_ACTION_POST:
		event.Verdict = models.VerdictAllowed
	case tetragon.KprobeAction_KPROBE_ACTION_SIGKILL:
		event.Verdict = models.VerdictDenied
		event.Action = "SIGKILL"
	case tetragon.KprobeAction_KPROBE_ACTION_OVERRIDE:
		event.Verdict = models.VerdictDenied
		event.Action = "OVERRIDE"
	}

	return event
}

// extractProcessInfo extracts common process information into the event.
func (t *TetragonClient) extractProcessInfo(event *models.TelemetryEvent, proc *tetragon.Process) {
	if proc == nil {
		return
	}

	// Pod information
	if proc.Pod != nil {
		event.SrcNamespace = proc.Pod.Namespace
		event.SrcPodName = proc.Pod.Name

		// Extract labels
		if proc.Pod.PodLabels != nil {
			event.SrcPodLabels = proc.Pod.PodLabels
		}

		// Container info
		if proc.Pod.Container != nil {
			event.SrcProcess = proc.Pod.Container.Name
		}
	}

	// Process details
	event.SrcBinary = proc.Binary
	if proc.Pid != nil {
		event.SrcPID = proc.Pid.Value
	}
	if proc.Uid != nil {
		event.SrcUID = proc.Uid.Value
	}

	// Arguments
	event.SrcArguments = proc.Arguments
}

// formatKprobeArg formats a kprobe argument for storage.
func formatKprobeArg(arg *tetragon.KprobeArgument) string {
	if arg == nil {
		return ""
	}

	switch v := arg.Arg.(type) {
	case *tetragon.KprobeArgument_IntArg:
		return fmt.Sprintf("int:%d", v.IntArg)
	case *tetragon.KprobeArgument_UintArg:
		return fmt.Sprintf("uint:%d", v.UintArg)
	case *tetragon.KprobeArgument_StringArg:
		return fmt.Sprintf("str:%s", v.StringArg)
	case *tetragon.KprobeArgument_BytesArg:
		return fmt.Sprintf("bytes:%x", v.BytesArg)
	case *tetragon.KprobeArgument_FileArg:
		if v.FileArg != nil {
			return fmt.Sprintf("file:%s", v.FileArg.Path)
		}
	case *tetragon.KprobeArgument_SockArg:
		if v.SockArg != nil {
			return fmt.Sprintf("sock:%s:%d->%s:%d",
				v.SockArg.Saddr, v.SockArg.Sport,
				v.SockArg.Daddr, v.SockArg.Dport)
		}
	case *tetragon.KprobeArgument_SkbArg:
		if v.SkbArg != nil {
			return fmt.Sprintf("skb:%s:%d->%s:%d",
				v.SkbArg.Saddr, v.SkbArg.Sport,
				v.SkbArg.Daddr, v.SkbArg.Dport)
		}
	}
	return ""
}

// isFileOperation checks if a function name is a file operation.
func isFileOperation(funcName string) bool {
	fileOps := []string{
		"sys_open", "sys_openat", "sys_read", "sys_write",
		"sys_close", "sys_unlink", "sys_rename", "sys_mkdir",
		"sys_rmdir", "sys_chmod", "sys_chown", "sys_truncate",
		"security_file_open", "security_file_permission",
		"__x64_sys_openat", "__x64_sys_read", "__x64_sys_write",
	}

	for _, op := range fileOps {
		if strings.Contains(funcName, op) {
			return true
		}
	}
	return false
}

// extractFilePath tries to extract a file path from a kprobe argument.
func extractFilePath(arg *tetragon.KprobeArgument) string {
	if arg == nil {
		return ""
	}

	switch v := arg.Arg.(type) {
	case *tetragon.KprobeArgument_FileArg:
		if v.FileArg != nil {
			return v.FileArg.Path
		}
	case *tetragon.KprobeArgument_StringArg:
		// Check if it looks like a path
		if strings.HasPrefix(v.StringArg, "/") {
			return v.StringArg
		}
	}
	return ""
}

// GetServerStatus returns health information about the Tetragon server.
func (t *TetragonClient) GetServerStatus(ctx context.Context) error {
	t.mu.RLock()
	if !t.connected {
		t.mu.RUnlock()
		return fmt.Errorf("not connected to Tetragon")
	}
	client := t.client
	t.mu.RUnlock()

	// Use GetHealth to check server status
	_, err := client.GetHealth(ctx, &tetragon.GetHealthStatusRequest{})
	return err
}

// IsConnected returns whether the client is connected.
func (t *TetragonClient) IsConnected() bool {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.connected
}

// Reconnect attempts to reconnect to Tetragon.
func (t *TetragonClient) Reconnect(ctx context.Context) error {
	if err := t.Close(); err != nil {
		t.log.Error(err, "Error closing existing connection")
	}

	// Exponential backoff
	backoff := time.Second
	maxBackoff := 30 * time.Second

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		err := t.Connect(ctx)
		if err == nil {
			return nil
		}

		t.log.Error(err, "Failed to reconnect, retrying", "backoff", backoff)

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}

		backoff *= 2
		if backoff > maxBackoff {
			backoff = maxBackoff
		}
	}
}
