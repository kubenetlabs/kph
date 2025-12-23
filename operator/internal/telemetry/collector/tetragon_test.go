package collector

import (
	"testing"

	"github.com/cilium/tetragon/api/v1/tetragon"
	"github.com/go-logr/logr"
	"google.golang.org/protobuf/types/known/wrapperspb"

	"github.com/policy-hub/operator/internal/telemetry/models"
)

func TestTetragonClient_NewTetragonClient(t *testing.T) {
	client := NewTetragonClient(TetragonClientConfig{
		Address:            "unix:///var/run/tetragon/tetragon.sock",
		NodeName:           "test-node",
		NamespaceFilter:    []string{"default", "production"},
		CollectProcessExec: true,
		CollectProcessExit: true,
		CollectKprobes:     false,
		Logger:             logr.Discard(),
	})

	if client.address != "unix:///var/run/tetragon/tetragon.sock" {
		t.Errorf("address = %s, want unix:///var/run/tetragon/tetragon.sock", client.address)
	}
	if client.nodeName != "test-node" {
		t.Errorf("nodeName = %s, want test-node", client.nodeName)
	}
	if len(client.namespaceFilter) != 2 {
		t.Errorf("namespaceFilter length = %d, want 2", len(client.namespaceFilter))
	}
	if !client.collectProcessExec {
		t.Error("collectProcessExec should be true")
	}
	if !client.collectProcessExit {
		t.Error("collectProcessExit should be true")
	}
	if client.collectKprobes {
		t.Error("collectKprobes should be false")
	}
}

func TestTetragonClient_SetEventHandler(t *testing.T) {
	client := NewTetragonClient(TetragonClientConfig{
		Address: "unix:///var/run/tetragon/tetragon.sock",
		Logger:  logr.Discard(),
	})

	handlerCalled := false
	client.SetEventHandler(func(event *models.TelemetryEvent) {
		handlerCalled = true
	})

	if client.eventHandler == nil {
		t.Error("eventHandler should not be nil")
	}

	client.eventHandler(&models.TelemetryEvent{})
	if !handlerCalled {
		t.Error("eventHandler was not called")
	}
}

func TestTetragonClient_IsConnected(t *testing.T) {
	client := NewTetragonClient(TetragonClientConfig{
		Address: "unix:///var/run/tetragon/tetragon.sock",
		Logger:  logr.Discard(),
	})

	if client.IsConnected() {
		t.Error("IsConnected() should be false initially")
	}
}

func TestTetragonClient_Close_NotConnected(t *testing.T) {
	client := NewTetragonClient(TetragonClientConfig{
		Address: "unix:///var/run/tetragon/tetragon.sock",
		Logger:  logr.Discard(),
	})

	err := client.Close()
	if err != nil {
		t.Errorf("Close() when not connected error = %v", err)
	}
}

func TestTetragonClient_BuildAllowList_NoFilters(t *testing.T) {
	client := NewTetragonClient(TetragonClientConfig{
		Address: "unix:///var/run/tetragon/tetragon.sock",
		Logger:  logr.Discard(),
	})

	filters := client.buildAllowList()
	if len(filters) != 0 {
		t.Errorf("buildAllowList() with no filters should return empty, got %d", len(filters))
	}
}

func TestTetragonClient_BuildAllowList_WithEventTypes(t *testing.T) {
	client := NewTetragonClient(TetragonClientConfig{
		Address:            "unix:///var/run/tetragon/tetragon.sock",
		CollectProcessExec: true,
		CollectProcessExit: true,
		CollectKprobes:     true,
		Logger:             logr.Discard(),
	})

	filters := client.buildAllowList()

	// Should have event type filter
	if len(filters) < 1 {
		t.Error("buildAllowList() should have at least 1 filter for event types")
	}

	// Check that the filter contains expected event types
	found := false
	for _, f := range filters {
		if len(f.EventSet) > 0 {
			found = true
			if len(f.EventSet) != 3 {
				t.Errorf("Expected 3 event types, got %d", len(f.EventSet))
			}
		}
	}
	if !found {
		t.Error("No event type filter found")
	}
}

func TestTetragonClient_BuildAllowList_WithNamespaces(t *testing.T) {
	client := NewTetragonClient(TetragonClientConfig{
		Address:         "unix:///var/run/tetragon/tetragon.sock",
		NamespaceFilter: []string{"default", "production"},
		Logger:          logr.Discard(),
	})

	filters := client.buildAllowList()

	// Should have namespace filter
	found := false
	for _, f := range filters {
		if len(f.Namespace) > 0 {
			found = true
			if len(f.Namespace) != 2 {
				t.Errorf("Expected 2 namespaces, got %d", len(f.Namespace))
			}
		}
	}
	if !found {
		t.Error("No namespace filter found")
	}
}

func TestTetragonClient_MatchesNamespaceFilter_NoFilter(t *testing.T) {
	client := NewTetragonClient(TetragonClientConfig{
		Address: "unix:///var/run/tetragon/tetragon.sock",
		Logger:  logr.Discard(),
	})

	event := &models.TelemetryEvent{
		SrcNamespace: "any-namespace",
	}

	if !client.matchesNamespaceFilter(event) {
		t.Error("Should match when no filter is set")
	}
}

func TestTetragonClient_MatchesNamespaceFilter_WithFilter(t *testing.T) {
	client := NewTetragonClient(TetragonClientConfig{
		Address:         "unix:///var/run/tetragon/tetragon.sock",
		NamespaceFilter: []string{"default", "production"},
		Logger:          logr.Discard(),
	})

	tests := []struct {
		namespace string
		expected  bool
	}{
		{"default", true},
		{"production", true},
		{"kube-system", false},
		{"other", false},
	}

	for _, tt := range tests {
		event := &models.TelemetryEvent{
			SrcNamespace: tt.namespace,
		}
		result := client.matchesNamespaceFilter(event)
		if result != tt.expected {
			t.Errorf("matchesNamespaceFilter(%s) = %v, want %v", tt.namespace, result, tt.expected)
		}
	}
}

func TestTetragonClient_ResponseToEvent_Nil(t *testing.T) {
	client := NewTetragonClient(TetragonClientConfig{
		Address:  "unix:///var/run/tetragon/tetragon.sock",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	event := client.responseToEvent(nil)
	if event != nil {
		t.Error("responseToEvent(nil) should return nil")
	}
}

func TestFormatKprobeArg(t *testing.T) {
	tests := []struct {
		name     string
		arg      *tetragon.KprobeArgument
		expected string
	}{
		{
			name:     "nil arg",
			arg:      nil,
			expected: "",
		},
		{
			name: "int arg",
			arg: &tetragon.KprobeArgument{
				Arg: &tetragon.KprobeArgument_IntArg{IntArg: 42},
			},
			expected: "int:42",
		},
		{
			name: "uint arg",
			arg: &tetragon.KprobeArgument{
				Arg: &tetragon.KprobeArgument_UintArg{UintArg: 100},
			},
			expected: "uint:100",
		},
		{
			name: "string arg",
			arg: &tetragon.KprobeArgument{
				Arg: &tetragon.KprobeArgument_StringArg{StringArg: "/etc/passwd"},
			},
			expected: "str:/etc/passwd",
		},
		{
			name: "bytes arg",
			arg: &tetragon.KprobeArgument{
				Arg: &tetragon.KprobeArgument_BytesArg{BytesArg: []byte{0xde, 0xad, 0xbe, 0xef}},
			},
			expected: "bytes:deadbeef",
		},
		{
			name: "file arg",
			arg: &tetragon.KprobeArgument{
				Arg: &tetragon.KprobeArgument_FileArg{
					FileArg: &tetragon.KprobeFile{Path: "/var/log/syslog"},
				},
			},
			expected: "file:/var/log/syslog",
		},
		{
			name: "sock arg",
			arg: &tetragon.KprobeArgument{
				Arg: &tetragon.KprobeArgument_SockArg{
					SockArg: &tetragon.KprobeSock{
						Saddr: "10.0.0.1",
						Sport: 12345,
						Daddr: "10.0.0.2",
						Dport: 80,
					},
				},
			},
			expected: "sock:10.0.0.1:12345->10.0.0.2:80",
		},
		{
			name: "skb arg",
			arg: &tetragon.KprobeArgument{
				Arg: &tetragon.KprobeArgument_SkbArg{
					SkbArg: &tetragon.KprobeSkb{
						Saddr: "192.168.1.1",
						Sport: 443,
						Daddr: "192.168.1.2",
						Dport: 8080,
					},
				},
			},
			expected: "skb:192.168.1.1:443->192.168.1.2:8080",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := formatKprobeArg(tt.arg)
			if result != tt.expected {
				t.Errorf("formatKprobeArg() = %s, want %s", result, tt.expected)
			}
		})
	}
}

func TestIsFileOperation(t *testing.T) {
	tests := []struct {
		funcName string
		expected bool
	}{
		{"sys_open", true},
		{"sys_openat", true},
		{"sys_read", true},
		{"sys_write", true},
		{"sys_close", true},
		{"sys_unlink", true},
		{"sys_rename", true},
		{"sys_mkdir", true},
		{"sys_rmdir", true},
		{"sys_chmod", true},
		{"sys_chown", true},
		{"sys_truncate", true},
		{"security_file_open", true},
		{"security_file_permission", true},
		{"__x64_sys_openat", true},
		{"__x64_sys_read", true},
		{"__x64_sys_write", true},
		{"sys_socket", false},
		{"sys_connect", false},
		{"sys_execve", false},
		{"custom_function", false},
	}

	for _, tt := range tests {
		result := isFileOperation(tt.funcName)
		if result != tt.expected {
			t.Errorf("isFileOperation(%s) = %v, want %v", tt.funcName, result, tt.expected)
		}
	}
}

func TestExtractFilePath(t *testing.T) {
	tests := []struct {
		name     string
		arg      *tetragon.KprobeArgument
		expected string
	}{
		{
			name:     "nil arg",
			arg:      nil,
			expected: "",
		},
		{
			name: "file arg",
			arg: &tetragon.KprobeArgument{
				Arg: &tetragon.KprobeArgument_FileArg{
					FileArg: &tetragon.KprobeFile{Path: "/etc/passwd"},
				},
			},
			expected: "/etc/passwd",
		},
		{
			name: "string arg with path",
			arg: &tetragon.KprobeArgument{
				Arg: &tetragon.KprobeArgument_StringArg{StringArg: "/var/log/syslog"},
			},
			expected: "/var/log/syslog",
		},
		{
			name: "string arg without path",
			arg: &tetragon.KprobeArgument{
				Arg: &tetragon.KprobeArgument_StringArg{StringArg: "not-a-path"},
			},
			expected: "",
		},
		{
			name: "int arg",
			arg: &tetragon.KprobeArgument{
				Arg: &tetragon.KprobeArgument_IntArg{IntArg: 42},
			},
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := extractFilePath(tt.arg)
			if result != tt.expected {
				t.Errorf("extractFilePath() = %s, want %s", result, tt.expected)
			}
		})
	}
}

func TestTetragonClient_ExtractProcessInfo(t *testing.T) {
	client := NewTetragonClient(TetragonClientConfig{
		Address:  "unix:///var/run/tetragon/tetragon.sock",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	event := &models.TelemetryEvent{}
	proc := &tetragon.Process{
		Binary:    "/usr/bin/curl",
		Arguments: "--version",
		Pod: &tetragon.Pod{
			Namespace: "default",
			Name:      "test-pod",
			PodLabels: map[string]string{
				"app": "test",
			},
			Container: &tetragon.Container{
				Name: "main",
			},
		},
	}

	client.extractProcessInfo(event, proc)

	if event.SrcBinary != "/usr/bin/curl" {
		t.Errorf("SrcBinary = %s, want /usr/bin/curl", event.SrcBinary)
	}
	if event.SrcArguments != "--version" {
		t.Errorf("SrcArguments = %s, want --version", event.SrcArguments)
	}
	if event.SrcNamespace != "default" {
		t.Errorf("SrcNamespace = %s, want default", event.SrcNamespace)
	}
	if event.SrcPodName != "test-pod" {
		t.Errorf("SrcPodName = %s, want test-pod", event.SrcPodName)
	}
	if event.SrcProcess != "main" {
		t.Errorf("SrcProcess = %s, want main", event.SrcProcess)
	}
	if event.SrcPodLabels["app"] != "test" {
		t.Errorf("SrcPodLabels[app] = %s, want test", event.SrcPodLabels["app"])
	}
}

func TestTetragonClient_ExtractProcessInfo_Nil(t *testing.T) {
	client := NewTetragonClient(TetragonClientConfig{
		Address: "unix:///var/run/tetragon/tetragon.sock",
		Logger:  logr.Discard(),
	})

	event := &models.TelemetryEvent{}

	// Should not panic with nil process
	client.extractProcessInfo(event, nil)

	// Event should remain unchanged
	if event.SrcBinary != "" {
		t.Error("SrcBinary should be empty")
	}
}

func TestTetragonClient_ProcessExecToEvent_Nil(t *testing.T) {
	client := NewTetragonClient(TetragonClientConfig{
		Address:  "unix:///var/run/tetragon/tetragon.sock",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	event := client.processExecToEvent(nil)
	if event != nil {
		t.Error("processExecToEvent(nil) should return nil")
	}
}

func TestTetragonClient_ProcessExitToEvent_Nil(t *testing.T) {
	client := NewTetragonClient(TetragonClientConfig{
		Address:  "unix:///var/run/tetragon/tetragon.sock",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	event := client.processExitToEvent(nil)
	if event != nil {
		t.Error("processExitToEvent(nil) should return nil")
	}
}

func TestTetragonClient_KprobeToEvent_Nil(t *testing.T) {
	client := NewTetragonClient(TetragonClientConfig{
		Address:  "unix:///var/run/tetragon/tetragon.sock",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	event := client.kprobeToEvent(nil)
	if event != nil {
		t.Error("kprobeToEvent(nil) should return nil")
	}
}

func TestTetragonClient_ProcessExecToEvent_WithProcess(t *testing.T) {
	client := NewTetragonClient(TetragonClientConfig{
		Address:  "unix:///var/run/tetragon/tetragon.sock",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	exec := &tetragon.ProcessExec{
		Process: &tetragon.Process{
			Binary:    "/usr/bin/curl",
			Arguments: "https://example.com",
			Pid:       &wrapperspb.UInt32Value{Value: 1234},
			Uid:       &wrapperspb.UInt32Value{Value: 1000},
			Pod: &tetragon.Pod{
				Namespace: "default",
				Name:      "test-pod",
				PodLabels: map[string]string{"app": "test"},
				Container: &tetragon.Container{Name: "main"},
			},
		},
		Parent: &tetragon.Process{
			Binary: "/bin/bash",
		},
	}

	event := client.processExecToEvent(exec)

	if event == nil {
		t.Fatal("processExecToEvent() returned nil")
	}
	if event.EventType != models.EventTypeProcessExec {
		t.Errorf("EventType = %s, want process_exec", event.EventType)
	}
	if event.NodeName != "test-node" {
		t.Errorf("NodeName = %s, want test-node", event.NodeName)
	}
	if event.Source != models.SourceTetragon {
		t.Errorf("Source = %s, want tetragon", event.Source)
	}
	if event.SrcBinary != "/usr/bin/curl" {
		t.Errorf("SrcBinary = %s, want /usr/bin/curl", event.SrcBinary)
	}
	if event.SrcPID != 1234 {
		t.Errorf("SrcPID = %d, want 1234", event.SrcPID)
	}
	if event.SrcUID != 1000 {
		t.Errorf("SrcUID = %d, want 1000", event.SrcUID)
	}
	if event.SrcNamespace != "default" {
		t.Errorf("SrcNamespace = %s, want default", event.SrcNamespace)
	}
	if event.SrcPodName != "test-pod" {
		t.Errorf("SrcPodName = %s, want test-pod", event.SrcPodName)
	}
	if event.Action != "parent=/bin/bash" {
		t.Errorf("Action = %s, want parent=/bin/bash", event.Action)
	}
}

func TestTetragonClient_ProcessExecToEvent_NilProcess(t *testing.T) {
	client := NewTetragonClient(TetragonClientConfig{
		Address:  "unix:///var/run/tetragon/tetragon.sock",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	exec := &tetragon.ProcessExec{
		Process: nil,
	}

	event := client.processExecToEvent(exec)
	if event != nil {
		t.Error("processExecToEvent with nil process should return nil")
	}
}

func TestTetragonClient_ProcessExitToEvent_WithSignal(t *testing.T) {
	client := NewTetragonClient(TetragonClientConfig{
		Address:  "unix:///var/run/tetragon/tetragon.sock",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	exit := &tetragon.ProcessExit{
		Process: &tetragon.Process{
			Binary:    "/usr/bin/curl",
			Arguments: "https://example.com",
			Pid:       &wrapperspb.UInt32Value{Value: 1234},
			Pod: &tetragon.Pod{
				Namespace: "default",
				Name:      "test-pod",
			},
		},
		Signal: "SIGTERM",
	}

	event := client.processExitToEvent(exit)

	if event == nil {
		t.Fatal("processExitToEvent() returned nil")
	}
	if event.EventType != models.EventTypeProcessExec {
		t.Errorf("EventType = %s, want process_exec", event.EventType)
	}
	if event.Action != "exit:signal=SIGTERM" {
		t.Errorf("Action = %s, want exit:signal=SIGTERM", event.Action)
	}
	if event.SrcBinary != "/usr/bin/curl" {
		t.Errorf("SrcBinary = %s, want /usr/bin/curl", event.SrcBinary)
	}
}

func TestTetragonClient_ProcessExitToEvent_WithStatus(t *testing.T) {
	client := NewTetragonClient(TetragonClientConfig{
		Address:  "unix:///var/run/tetragon/tetragon.sock",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	exit := &tetragon.ProcessExit{
		Process: &tetragon.Process{
			Binary: "/usr/bin/curl",
			Pod: &tetragon.Pod{
				Namespace: "default",
				Name:      "test-pod",
			},
		},
		Status: 0,
	}

	event := client.processExitToEvent(exit)

	if event == nil {
		t.Fatal("processExitToEvent() returned nil")
	}
	if event.Action != "exit:status=0" {
		t.Errorf("Action = %s, want exit:status=0", event.Action)
	}
}

func TestTetragonClient_ProcessExitToEvent_NilProcess(t *testing.T) {
	client := NewTetragonClient(TetragonClientConfig{
		Address:  "unix:///var/run/tetragon/tetragon.sock",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	exit := &tetragon.ProcessExit{
		Process: nil,
	}

	event := client.processExitToEvent(exit)
	if event != nil {
		t.Error("processExitToEvent with nil process should return nil")
	}
}

func TestTetragonClient_KprobeToEvent_WithProcess(t *testing.T) {
	client := NewTetragonClient(TetragonClientConfig{
		Address:  "unix:///var/run/tetragon/tetragon.sock",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	kprobe := &tetragon.ProcessKprobe{
		Process: &tetragon.Process{
			Binary: "/usr/bin/cat",
			Pod: &tetragon.Pod{
				Namespace: "default",
				Name:      "test-pod",
			},
		},
		FunctionName: "sys_connect",
		Args: []*tetragon.KprobeArgument{
			{Arg: &tetragon.KprobeArgument_IntArg{IntArg: 3}},
		},
		Action: tetragon.KprobeAction_KPROBE_ACTION_POST,
	}

	event := client.kprobeToEvent(kprobe)

	if event == nil {
		t.Fatal("kprobeToEvent() returned nil")
	}
	if event.EventType != models.EventTypeSyscall {
		t.Errorf("EventType = %s, want syscall", event.EventType)
	}
	if event.Syscall != "sys_connect" {
		t.Errorf("Syscall = %s, want sys_connect", event.Syscall)
	}
	if event.Verdict != models.VerdictAllowed {
		t.Errorf("Verdict = %s, want allowed", event.Verdict)
	}
	if len(event.SyscallArgs) != 1 {
		t.Errorf("SyscallArgs length = %d, want 1", len(event.SyscallArgs))
	}
}

func TestTetragonClient_KprobeToEvent_FileOperation(t *testing.T) {
	client := NewTetragonClient(TetragonClientConfig{
		Address:  "unix:///var/run/tetragon/tetragon.sock",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	kprobe := &tetragon.ProcessKprobe{
		Process: &tetragon.Process{
			Binary: "/usr/bin/cat",
			Pod: &tetragon.Pod{
				Namespace: "default",
				Name:      "test-pod",
			},
		},
		FunctionName: "sys_openat",
		Args: []*tetragon.KprobeArgument{
			{Arg: &tetragon.KprobeArgument_FileArg{
				FileArg: &tetragon.KprobeFile{Path: "/etc/passwd"},
			}},
		},
		Action: tetragon.KprobeAction_KPROBE_ACTION_POST,
	}

	event := client.kprobeToEvent(kprobe)

	if event == nil {
		t.Fatal("kprobeToEvent() returned nil")
	}
	if event.EventType != models.EventTypeFileAccess {
		t.Errorf("EventType = %s, want file_access", event.EventType)
	}
	if event.FileOperation != "sys_openat" {
		t.Errorf("FileOperation = %s, want sys_openat", event.FileOperation)
	}
	if event.FilePath != "/etc/passwd" {
		t.Errorf("FilePath = %s, want /etc/passwd", event.FilePath)
	}
}

func TestTetragonClient_KprobeToEvent_Sigkill(t *testing.T) {
	client := NewTetragonClient(TetragonClientConfig{
		Address:  "unix:///var/run/tetragon/tetragon.sock",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	kprobe := &tetragon.ProcessKprobe{
		Process: &tetragon.Process{
			Binary: "/usr/bin/malware",
			Pod: &tetragon.Pod{
				Namespace: "default",
				Name:      "test-pod",
			},
		},
		FunctionName: "sys_execve",
		Action:       tetragon.KprobeAction_KPROBE_ACTION_SIGKILL,
	}

	event := client.kprobeToEvent(kprobe)

	if event == nil {
		t.Fatal("kprobeToEvent() returned nil")
	}
	if event.Verdict != models.VerdictDenied {
		t.Errorf("Verdict = %s, want denied", event.Verdict)
	}
	if event.Action != "SIGKILL" {
		t.Errorf("Action = %s, want SIGKILL", event.Action)
	}
}

func TestTetragonClient_KprobeToEvent_Override(t *testing.T) {
	client := NewTetragonClient(TetragonClientConfig{
		Address:  "unix:///var/run/tetragon/tetragon.sock",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	kprobe := &tetragon.ProcessKprobe{
		Process: &tetragon.Process{
			Binary: "/usr/bin/app",
			Pod: &tetragon.Pod{
				Namespace: "default",
				Name:      "test-pod",
			},
		},
		FunctionName: "sys_open",
		Action:       tetragon.KprobeAction_KPROBE_ACTION_OVERRIDE,
	}

	event := client.kprobeToEvent(kprobe)

	if event == nil {
		t.Fatal("kprobeToEvent() returned nil")
	}
	if event.Verdict != models.VerdictDenied {
		t.Errorf("Verdict = %s, want denied", event.Verdict)
	}
	if event.Action != "OVERRIDE" {
		t.Errorf("Action = %s, want OVERRIDE", event.Action)
	}
}

func TestTetragonClient_KprobeToEvent_NilProcess(t *testing.T) {
	client := NewTetragonClient(TetragonClientConfig{
		Address:  "unix:///var/run/tetragon/tetragon.sock",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	kprobe := &tetragon.ProcessKprobe{
		Process: nil,
	}

	event := client.kprobeToEvent(kprobe)
	if event != nil {
		t.Error("kprobeToEvent with nil process should return nil")
	}
}

func TestTetragonClient_ResponseToEvent_ProcessExec(t *testing.T) {
	client := NewTetragonClient(TetragonClientConfig{
		Address:  "unix:///var/run/tetragon/tetragon.sock",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	resp := &tetragon.GetEventsResponse{
		Event: &tetragon.GetEventsResponse_ProcessExec{
			ProcessExec: &tetragon.ProcessExec{
				Process: &tetragon.Process{
					Binary: "/usr/bin/test",
					Pod: &tetragon.Pod{
						Namespace: "default",
						Name:      "test-pod",
					},
				},
			},
		},
	}

	event := client.responseToEvent(resp)

	if event == nil {
		t.Fatal("responseToEvent() returned nil")
	}
	if event.EventType != models.EventTypeProcessExec {
		t.Errorf("EventType = %s, want process_exec", event.EventType)
	}
}

func TestTetragonClient_ResponseToEvent_ProcessExit(t *testing.T) {
	client := NewTetragonClient(TetragonClientConfig{
		Address:  "unix:///var/run/tetragon/tetragon.sock",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	resp := &tetragon.GetEventsResponse{
		Event: &tetragon.GetEventsResponse_ProcessExit{
			ProcessExit: &tetragon.ProcessExit{
				Process: &tetragon.Process{
					Binary: "/usr/bin/test",
					Pod: &tetragon.Pod{
						Namespace: "default",
						Name:      "test-pod",
					},
				},
				Status: 0,
			},
		},
	}

	event := client.responseToEvent(resp)

	if event == nil {
		t.Fatal("responseToEvent() returned nil")
	}
	if event.Action != "exit:status=0" {
		t.Errorf("Action = %s, want exit:status=0", event.Action)
	}
}

func TestTetragonClient_ResponseToEvent_ProcessKprobe(t *testing.T) {
	client := NewTetragonClient(TetragonClientConfig{
		Address:  "unix:///var/run/tetragon/tetragon.sock",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	resp := &tetragon.GetEventsResponse{
		Event: &tetragon.GetEventsResponse_ProcessKprobe{
			ProcessKprobe: &tetragon.ProcessKprobe{
				Process: &tetragon.Process{
					Binary: "/usr/bin/test",
					Pod: &tetragon.Pod{
						Namespace: "default",
						Name:      "test-pod",
					},
				},
				FunctionName: "sys_read",
				Action:       tetragon.KprobeAction_KPROBE_ACTION_POST,
			},
		},
	}

	event := client.responseToEvent(resp)

	if event == nil {
		t.Fatal("responseToEvent() returned nil")
	}
	if event.Syscall != "sys_read" {
		t.Errorf("Syscall = %s, want sys_read", event.Syscall)
	}
}

func TestTetragonClient_ResponseToEvent_UnknownType(t *testing.T) {
	client := NewTetragonClient(TetragonClientConfig{
		Address:  "unix:///var/run/tetragon/tetragon.sock",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	// Empty response with no event set
	resp := &tetragon.GetEventsResponse{}

	event := client.responseToEvent(resp)

	if event != nil {
		t.Error("responseToEvent with unknown type should return nil")
	}
}
