package collector

import (
	"testing"

	"github.com/cilium/tetragon/api/v1/tetragon"
	"github.com/go-logr/logr"

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
