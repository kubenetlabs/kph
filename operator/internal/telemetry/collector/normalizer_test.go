package collector

import (
	"testing"

	"github.com/policy-hub/operator/internal/telemetry/models"
)

func TestEventNormalizer_NewEventNormalizer(t *testing.T) {
	n := NewEventNormalizer("test-node")
	if n.nodeName != "test-node" {
		t.Errorf("nodeName = %s, want test-node", n.nodeName)
	}
}

func TestEventNormalizer_NormalizeEvent(t *testing.T) {
	n := NewEventNormalizer("test-node")

	event := &models.TelemetryEvent{
		SrcNamespace: "  Default  ",
		DstNamespace: "PRODUCTION",
		SrcPodName:   "  pod-a  ",
		DstPodName:   "pod-b  ",
		Protocol:     "tcp",
		L7Type:       "http",
		HTTPMethod:   "get",
		FilePath:     "/var/log/",
		SrcBinary:    "/bin/bash/",
	}

	n.NormalizeEvent(event)

	// Check node name is set
	if event.NodeName != "test-node" {
		t.Errorf("NodeName = %s, want test-node", event.NodeName)
	}

	// Check namespace normalization (lowercase, trimmed)
	if event.SrcNamespace != "default" {
		t.Errorf("SrcNamespace = %s, want default", event.SrcNamespace)
	}
	if event.DstNamespace != "production" {
		t.Errorf("DstNamespace = %s, want production", event.DstNamespace)
	}

	// Check pod name trimming
	if event.SrcPodName != "pod-a" {
		t.Errorf("SrcPodName = %s, want pod-a", event.SrcPodName)
	}
	if event.DstPodName != "pod-b" {
		t.Errorf("DstPodName = %s, want pod-b", event.DstPodName)
	}

	// Check protocol uppercase
	if event.Protocol != "TCP" {
		t.Errorf("Protocol = %s, want TCP", event.Protocol)
	}
	if event.L7Type != "HTTP" {
		t.Errorf("L7Type = %s, want HTTP", event.L7Type)
	}
	if event.HTTPMethod != "GET" {
		t.Errorf("HTTPMethod = %s, want GET", event.HTTPMethod)
	}

	// Check path normalization (trailing slash removed)
	if event.FilePath != "/var/log" {
		t.Errorf("FilePath = %s, want /var/log", event.FilePath)
	}
	if event.SrcBinary != "/bin/bash" {
		t.Errorf("SrcBinary = %s, want /bin/bash", event.SrcBinary)
	}

	// Check verdict default
	if event.Verdict != models.VerdictUnknown {
		t.Errorf("Verdict = %s, want %s", event.Verdict, models.VerdictUnknown)
	}
}

func TestEventNormalizer_NormalizeEvent_Nil(t *testing.T) {
	n := NewEventNormalizer("test-node")

	// Should not panic
	n.NormalizeEvent(nil)
}

func TestEventNormalizer_NormalizeEvent_PreservesExistingNodeName(t *testing.T) {
	n := NewEventNormalizer("test-node")

	event := &models.TelemetryEvent{
		NodeName: "existing-node",
	}

	n.NormalizeEvent(event)

	if event.NodeName != "existing-node" {
		t.Errorf("NodeName = %s, want existing-node", event.NodeName)
	}
}

func TestEventNormalizer_EnrichFlowEvent(t *testing.T) {
	n := NewEventNormalizer("test-node")

	tests := []struct {
		name         string
		event        *models.TelemetryEvent
		wantL7Type   string
		wantHTTPPath string
	}{
		{
			name: "infer HTTP from port 80",
			event: &models.TelemetryEvent{
				EventType: models.EventTypeFlow,
				Protocol:  "TCP",
				DstPort:   80,
			},
			wantL7Type: "HTTP",
		},
		{
			name: "infer HTTPS from port 443",
			event: &models.TelemetryEvent{
				EventType: models.EventTypeFlow,
				Protocol:  "TCP",
				DstPort:   443,
			},
			wantL7Type: "HTTPS",
		},
		{
			name: "infer DNS from port 53",
			event: &models.TelemetryEvent{
				EventType: models.EventTypeFlow,
				Protocol:  "TCP",
				DstPort:   53,
			},
			wantL7Type: "DNS",
		},
		{
			name: "infer Kafka from port 9092",
			event: &models.TelemetryEvent{
				EventType: models.EventTypeFlow,
				Protocol:  "TCP",
				DstPort:   9092,
			},
			wantL7Type: "KAFKA",
		},
		{
			name: "normalize HTTP path - remove query string",
			event: &models.TelemetryEvent{
				EventType: models.EventTypeFlow,
				HTTPPath:  "/api/users?id=123&name=test",
			},
			wantHTTPPath: "/api/users",
		},
		{
			name: "normalize HTTP path - remove trailing slash",
			event: &models.TelemetryEvent{
				EventType: models.EventTypeFlow,
				HTTPPath:  "/api/users/",
			},
			wantHTTPPath: "/api/users",
		},
		{
			name: "don't override existing L7Type",
			event: &models.TelemetryEvent{
				EventType: models.EventTypeFlow,
				Protocol:  "TCP",
				DstPort:   80,
				L7Type:    "GRPC",
			},
			wantL7Type: "GRPC",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			n.EnrichFlowEvent(tt.event)

			if tt.wantL7Type != "" && tt.event.L7Type != tt.wantL7Type {
				t.Errorf("L7Type = %s, want %s", tt.event.L7Type, tt.wantL7Type)
			}
			if tt.wantHTTPPath != "" && tt.event.HTTPPath != tt.wantHTTPPath {
				t.Errorf("HTTPPath = %s, want %s", tt.event.HTTPPath, tt.wantHTTPPath)
			}
		})
	}
}

func TestEventNormalizer_EnrichFlowEvent_Nil(t *testing.T) {
	n := NewEventNormalizer("test-node")

	// Should not panic
	n.EnrichFlowEvent(nil)
}

func TestEventNormalizer_EnrichFlowEvent_WrongType(t *testing.T) {
	n := NewEventNormalizer("test-node")

	event := &models.TelemetryEvent{
		EventType: models.EventTypeProcessExec,
		Protocol:  "TCP",
		DstPort:   80,
	}

	n.EnrichFlowEvent(event)

	// Should not modify non-flow events
	if event.L7Type != "" {
		t.Errorf("L7Type should not be set for non-flow event")
	}
}

func TestEventNormalizer_EnrichProcessEvent(t *testing.T) {
	n := NewEventNormalizer("test-node")

	tests := []struct {
		name       string
		event      *models.TelemetryEvent
		wantAction string
	}{
		{
			name: "categorize shell binary",
			event: &models.TelemetryEvent{
				EventType: models.EventTypeProcessExec,
				SrcBinary: "/bin/bash",
			},
			wantAction: "shell",
		},
		{
			name: "categorize network tool",
			event: &models.TelemetryEvent{
				EventType: models.EventTypeProcessExec,
				SrcBinary: "/usr/bin/curl",
			},
			wantAction: "network_tool",
		},
		{
			name: "categorize package manager",
			event: &models.TelemetryEvent{
				EventType: models.EventTypeProcessExec,
				SrcBinary: "/usr/bin/apt-get",
			},
			wantAction: "package_manager",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			n.EnrichProcessEvent(tt.event)

			if tt.event.Action != tt.wantAction {
				t.Errorf("Action = %s, want %s", tt.event.Action, tt.wantAction)
			}
		})
	}
}

func TestEventNormalizer_EnrichProcessEvent_FileAccess(t *testing.T) {
	n := NewEventNormalizer("test-node")

	event := &models.TelemetryEvent{
		EventType: models.EventTypeFileAccess,
		FilePath:  "/etc/passwd",
	}

	n.EnrichProcessEvent(event)

	if event.Action != "sensitive_access" {
		t.Errorf("Action = %s, want sensitive_access", event.Action)
	}
}

func TestEventNormalizer_EnrichProcessEvent_Syscall(t *testing.T) {
	n := NewEventNormalizer("test-node")

	event := &models.TelemetryEvent{
		EventType: models.EventTypeSyscall,
		Syscall:   "__x64_sys_openat",
	}

	n.EnrichProcessEvent(event)

	if event.Syscall != "openat" {
		t.Errorf("Syscall = %s, want openat", event.Syscall)
	}
}

func TestInferL7Protocol(t *testing.T) {
	tests := []struct {
		port     uint32
		expected string
	}{
		{80, "HTTP"},
		{8080, "HTTP"},
		{443, "HTTPS"},
		{8443, "HTTPS"},
		{53, "DNS"},
		{3306, "MYSQL"},
		{5432, "POSTGRESQL"},
		{6379, "REDIS"},
		{27017, "MONGODB"},
		{9092, "KAFKA"},
		{2379, "ETCD"},
		{6443, "KUBERNETES_API"},
		{12345, ""},
	}

	for _, tt := range tests {
		result := inferL7Protocol(tt.port)
		if result != tt.expected {
			t.Errorf("inferL7Protocol(%d) = %s, want %s", tt.port, result, tt.expected)
		}
	}
}

func TestCategorizeBinary(t *testing.T) {
	tests := []struct {
		binary   string
		expected string
	}{
		{"/bin/sh", "shell"},
		{"/bin/bash", "shell"},
		{"/bin/zsh", "shell"},
		{"/usr/bin/apt-get", "package_manager"},
		{"/usr/bin/yum", "package_manager"},
		{"/usr/bin/npm", "package_manager"},
		{"/usr/bin/curl", "network_tool"},
		{"/usr/bin/wget", "network_tool"},
		{"/usr/bin/ssh", "network_tool"},
		{"/usr/bin/gcc", "compiler"},
		{"/usr/bin/go", "compiler"},
		{"/usr/bin/ls", "other"},
	}

	for _, tt := range tests {
		result := categorizeBinary(tt.binary)
		if result != tt.expected {
			t.Errorf("categorizeBinary(%s) = %s, want %s", tt.binary, result, tt.expected)
		}
	}
}

func TestIsSensitivePath(t *testing.T) {
	tests := []struct {
		path     string
		expected bool
	}{
		{"/etc/passwd", true},
		{"/etc/shadow", true},
		{"/etc/sudoers", true},
		{"/root/.bashrc", true},
		{"/home/user/.ssh/id_rsa", true},
		{"/var/run/secrets/kubernetes.io/serviceaccount/token", true},
		{"/proc/1/cmdline", true},
		{"/sys/kernel/mm/transparent_hugepage/enabled", true},
		{"/var/log/syslog", false},
		{"/tmp/test.txt", false},
		{"/home/user/document.txt", false},
	}

	for _, tt := range tests {
		result := isSensitivePath(tt.path)
		if result != tt.expected {
			t.Errorf("isSensitivePath(%s) = %v, want %v", tt.path, result, tt.expected)
		}
	}
}

func TestNormalizeNamespace(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"default", "default"},
		{"DEFAULT", "default"},
		{"  Default  ", "default"},
		{"KUBE-SYSTEM", "kube-system"},
		{"", ""},
	}

	for _, tt := range tests {
		result := normalizeNamespace(tt.input)
		if result != tt.expected {
			t.Errorf("normalizeNamespace(%q) = %q, want %q", tt.input, result, tt.expected)
		}
	}
}

func TestNormalizePath(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"/var/log/", "/var/log"},
		{"/var/log", "/var/log"},
		{"/", "/"},
		{"  /var/log  ", "/var/log"},
		{"", ""},
	}

	for _, tt := range tests {
		result := normalizePath(tt.input)
		if result != tt.expected {
			t.Errorf("normalizePath(%q) = %q, want %q", tt.input, result, tt.expected)
		}
	}
}

func TestNormalizeHTTPPath(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"/api/users?id=123", "/api/users"},
		{"/api/users?id=123&name=test", "/api/users"},
		{"/api/users/", "/api/users"},
		{"/api/users", "/api/users"},
		{"/", "/"},
		{"/?query=test", "/"},
	}

	for _, tt := range tests {
		result := normalizeHTTPPath(tt.input)
		if result != tt.expected {
			t.Errorf("normalizeHTTPPath(%q) = %q, want %q", tt.input, result, tt.expected)
		}
	}
}

func TestNormalizeSyscallName(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"__x64_sys_openat", "openat"},
		{"__ia32_sys_read", "read"},
		{"sys_write", "write"},
		{"__sys_close", "close"},
		{"openat", "openat"},
		{"custom_function", "custom_function"},
	}

	for _, tt := range tests {
		result := normalizeSyscallName(tt.input)
		if result != tt.expected {
			t.Errorf("normalizeSyscallName(%q) = %q, want %q", tt.input, result, tt.expected)
		}
	}
}

func TestProcessEventClassifier_ClassifyEvent(t *testing.T) {
	c := NewProcessEventClassifier()

	tests := []struct {
		name         string
		event        *models.TelemetryEvent
		wantContains []string
	}{
		{
			name: "process exec with shell",
			event: &models.TelemetryEvent{
				EventType: models.EventTypeProcessExec,
				SrcBinary: "/bin/bash",
			},
			wantContains: []string{"process_exec", "shell"},
		},
		{
			name: "syscall event",
			event: &models.TelemetryEvent{
				EventType: models.EventTypeSyscall,
				Syscall:   "openat",
			},
			wantContains: []string{"syscall", "syscall_openat"},
		},
		{
			name: "file access to sensitive path",
			event: &models.TelemetryEvent{
				EventType:     models.EventTypeFileAccess,
				FilePath:      "/etc/passwd",
				FileOperation: "READ",
			},
			wantContains: []string{"file_access", "file_read", "sensitive_file"},
		},
		{
			name: "denied verdict",
			event: &models.TelemetryEvent{
				EventType: models.EventTypeProcessExec,
				Verdict:   models.VerdictDenied,
			},
			wantContains: []string{"process_exec", "denied"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tags := c.ClassifyEvent(tt.event)

			for _, want := range tt.wantContains {
				found := false
				for _, tag := range tags {
					if tag == want {
						found = true
						break
					}
				}
				if !found {
					t.Errorf("Expected tag %q not found in %v", want, tags)
				}
			}
		})
	}
}

func TestProcessEventClassifier_ClassifyEvent_Nil(t *testing.T) {
	c := NewProcessEventClassifier()

	tags := c.ClassifyEvent(nil)
	if len(tags) != 0 {
		t.Errorf("Expected empty tags for nil event, got %v", tags)
	}
}

func TestCategorizeSyscall(t *testing.T) {
	tests := []struct {
		syscall  string
		expected SyscallCategory
	}{
		{"open", SyscallCategoryFile},
		{"openat", SyscallCategoryFile},
		{"read", SyscallCategoryFile},
		{"write", SyscallCategoryFile},
		{"socket", SyscallCategoryNetwork},
		{"connect", SyscallCategoryNetwork},
		{"accept", SyscallCategoryNetwork},
		{"fork", SyscallCategoryProcess},
		{"execve", SyscallCategoryProcess},
		{"clone", SyscallCategoryProcess},
		{"mmap", SyscallCategoryMemory},
		{"mprotect", SyscallCategoryMemory},
		{"ioctl", SyscallCategoryOther},
		{"__x64_sys_openat", SyscallCategoryFile},
	}

	for _, tt := range tests {
		result := CategorizeSyscall(tt.syscall)
		if result != tt.expected {
			t.Errorf("CategorizeSyscall(%s) = %s, want %s", tt.syscall, result, tt.expected)
		}
	}
}
