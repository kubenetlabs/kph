package collector

import (
	"strings"

	"github.com/policy-hub/operator/internal/telemetry/models"
)

// EventNormalizer provides utilities for normalizing and enriching telemetry events.
type EventNormalizer struct {
	nodeName string
}

// NewEventNormalizer creates a new event normalizer.
func NewEventNormalizer(nodeName string) *EventNormalizer {
	return &EventNormalizer{
		nodeName: nodeName,
	}
}

// NormalizeEvent applies common normalization to any telemetry event.
func (n *EventNormalizer) NormalizeEvent(event *models.TelemetryEvent) {
	if event == nil {
		return
	}

	// Ensure node name is set
	if event.NodeName == "" {
		event.NodeName = n.nodeName
	}

	// Normalize namespace names (trim whitespace, lowercase)
	event.SrcNamespace = normalizeNamespace(event.SrcNamespace)
	event.DstNamespace = normalizeNamespace(event.DstNamespace)

	// Normalize pod names
	event.SrcPodName = strings.TrimSpace(event.SrcPodName)
	event.DstPodName = strings.TrimSpace(event.DstPodName)

	// Normalize protocol to uppercase
	event.Protocol = strings.ToUpper(event.Protocol)

	// Normalize L7 type
	event.L7Type = strings.ToUpper(event.L7Type)

	// Ensure verdict is set
	if event.Verdict == "" {
		event.Verdict = models.VerdictUnknown
	}

	// Normalize HTTP method to uppercase
	event.HTTPMethod = strings.ToUpper(event.HTTPMethod)

	// Normalize file paths
	event.FilePath = normalizePath(event.FilePath)
	event.SrcBinary = normalizePath(event.SrcBinary)
}

// EnrichFlowEvent enriches a network flow event with derived information.
func (n *EventNormalizer) EnrichFlowEvent(event *models.TelemetryEvent) {
	if event == nil || event.EventType != models.EventTypeFlow {
		return
	}

	// Infer L7 protocol from port if not set
	if event.L7Type == "" && event.Protocol == "TCP" {
		event.L7Type = inferL7Protocol(event.DstPort)
	}

	// Set direction based on endpoints if not set
	if event.Direction == "" {
		event.Direction = models.TrafficDirectionUnknown
	}

	// Normalize HTTP path (remove query strings for aggregation)
	if event.HTTPPath != "" {
		event.HTTPPath = normalizeHTTPPath(event.HTTPPath)
	}
}

// EnrichProcessEvent enriches a process event with derived information.
func (n *EventNormalizer) EnrichProcessEvent(event *models.TelemetryEvent) {
	if event == nil {
		return
	}

	switch event.EventType {
	case models.EventTypeProcessExec:
		n.enrichProcessExec(event)
	case models.EventTypeSyscall:
		n.enrichSyscall(event)
	case models.EventTypeFileAccess:
		n.enrichFileAccess(event)
	}
}

// enrichProcessExec adds derived information to process exec events.
func (n *EventNormalizer) enrichProcessExec(event *models.TelemetryEvent) {
	// Categorize binary type
	if event.SrcBinary != "" {
		event.Action = categorizeBinary(event.SrcBinary)
	}
}

// enrichSyscall adds derived information to syscall events.
func (n *EventNormalizer) enrichSyscall(event *models.TelemetryEvent) {
	// Categorize syscall
	if event.Syscall != "" {
		// Clean syscall name (remove sys_ prefix variations)
		event.Syscall = normalizeSyscallName(event.Syscall)
	}
}

// enrichFileAccess adds derived information to file access events.
func (n *EventNormalizer) enrichFileAccess(event *models.TelemetryEvent) {
	// Categorize file access type
	if event.FilePath != "" {
		// Check for sensitive paths
		if isSensitivePath(event.FilePath) {
			if event.Action == "" {
				event.Action = "sensitive_access"
			}
		}
	}
}

// Helper functions

func normalizeNamespace(ns string) string {
	ns = strings.TrimSpace(ns)
	return strings.ToLower(ns)
}

func normalizePath(path string) string {
	path = strings.TrimSpace(path)
	// Remove trailing slashes except for root
	if len(path) > 1 {
		path = strings.TrimSuffix(path, "/")
	}
	return path
}

func normalizeHTTPPath(path string) string {
	// Remove query string for aggregation purposes
	if idx := strings.Index(path, "?"); idx != -1 {
		path = path[:idx]
	}
	// Remove trailing slash
	if len(path) > 1 {
		path = strings.TrimSuffix(path, "/")
	}
	return path
}

func normalizeSyscallName(name string) string {
	// Remove common prefixes
	prefixes := []string{"__x64_sys_", "__ia32_sys_", "sys_", "__sys_"}
	for _, prefix := range prefixes {
		if strings.HasPrefix(name, prefix) {
			return strings.TrimPrefix(name, prefix)
		}
	}
	return name
}

func inferL7Protocol(port uint32) string {
	switch port {
	case 80, 8080, 8000, 3000:
		return "HTTP"
	case 443, 8443:
		return "HTTPS"
	case 53:
		return "DNS"
	case 3306:
		return "MYSQL"
	case 5432:
		return "POSTGRESQL"
	case 6379:
		return "REDIS"
	case 27017:
		return "MONGODB"
	case 9092:
		return "KAFKA"
	case 2379, 2380:
		return "ETCD"
	case 6443:
		return "KUBERNETES_API"
	default:
		return ""
	}
}

func categorizeBinary(binary string) string {
	// Shell detection
	shells := []string{"/bin/sh", "/bin/bash", "/bin/zsh", "/bin/dash", "/bin/ash"}
	for _, shell := range shells {
		if strings.HasSuffix(binary, shell) || binary == shell {
			return "shell"
		}
	}

	// Package manager detection
	pkgManagers := []string{"apt", "apt-get", "yum", "dnf", "apk", "pip", "npm", "gem"}
	for _, pm := range pkgManagers {
		if strings.Contains(binary, pm) {
			return "package_manager"
		}
	}

	// Network tools
	netTools := []string{"curl", "wget", "nc", "netcat", "nmap", "ssh", "scp", "rsync"}
	for _, tool := range netTools {
		if strings.HasSuffix(binary, "/"+tool) || strings.HasSuffix(binary, tool) {
			return "network_tool"
		}
	}

	// Compilers
	compilers := []string{"gcc", "g++", "clang", "javac", "go", "rustc"}
	for _, comp := range compilers {
		if strings.Contains(binary, comp) {
			return "compiler"
		}
	}

	return "other"
}

func isSensitivePath(path string) bool {
	sensitivePaths := []string{
		"/etc/passwd",
		"/etc/shadow",
		"/etc/sudoers",
		"/root/",
		"/.ssh/",
		"/var/run/secrets/kubernetes.io/",
		"/proc/",
		"/sys/",
	}

	for _, sp := range sensitivePaths {
		if strings.HasPrefix(path, sp) || strings.Contains(path, sp) {
			return true
		}
	}
	return false
}

// ProcessEventClassifier provides classification of process events for policy matching.
type ProcessEventClassifier struct{}

// NewProcessEventClassifier creates a new process event classifier.
func NewProcessEventClassifier() *ProcessEventClassifier {
	return &ProcessEventClassifier{}
}

// ClassifyEvent returns classification tags for a process event.
func (c *ProcessEventClassifier) ClassifyEvent(event *models.TelemetryEvent) []string {
	var tags []string

	if event == nil {
		return tags
	}

	switch event.EventType {
	case models.EventTypeProcessExec:
		tags = append(tags, "process_exec")
		if category := categorizeBinary(event.SrcBinary); category != "other" {
			tags = append(tags, category)
		}

	case models.EventTypeSyscall:
		tags = append(tags, "syscall")
		tags = append(tags, "syscall_"+event.Syscall)

	case models.EventTypeFileAccess:
		tags = append(tags, "file_access")
		if event.FileOperation != "" {
			tags = append(tags, "file_"+strings.ToLower(event.FileOperation))
		}
		if isSensitivePath(event.FilePath) {
			tags = append(tags, "sensitive_file")
		}
	}

	// Add verdict tag
	switch event.Verdict {
	case models.VerdictDenied:
		tags = append(tags, "denied")
	case models.VerdictDropped:
		tags = append(tags, "dropped")
	}

	return tags
}

// SyscallCategory represents a category of related syscalls.
type SyscallCategory string

const (
	SyscallCategoryFile    SyscallCategory = "file"
	SyscallCategoryNetwork SyscallCategory = "network"
	SyscallCategoryProcess SyscallCategory = "process"
	SyscallCategoryMemory  SyscallCategory = "memory"
	SyscallCategoryOther   SyscallCategory = "other"
)

// CategorizeSyscall returns the category for a syscall.
func CategorizeSyscall(syscall string) SyscallCategory {
	syscall = normalizeSyscallName(syscall)

	fileSyscalls := map[string]bool{
		"open": true, "openat": true, "close": true, "read": true, "write": true,
		"lseek": true, "stat": true, "fstat": true, "lstat": true, "access": true,
		"chmod": true, "chown": true, "unlink": true, "rename": true, "mkdir": true,
		"rmdir": true, "readdir": true, "truncate": true, "ftruncate": true,
	}

	networkSyscalls := map[string]bool{
		"socket": true, "connect": true, "accept": true, "bind": true, "listen": true,
		"send": true, "recv": true, "sendto": true, "recvfrom": true, "sendmsg": true,
		"recvmsg": true, "shutdown": true, "setsockopt": true, "getsockopt": true,
	}

	processSyscalls := map[string]bool{
		"fork": true, "vfork": true, "clone": true, "execve": true, "exit": true,
		"wait4": true, "kill": true, "getpid": true, "getppid": true, "setuid": true,
		"setgid": true, "setsid": true, "ptrace": true,
	}

	memorySyscalls := map[string]bool{
		"mmap": true, "munmap": true, "mprotect": true, "brk": true, "mremap": true,
	}

	if fileSyscalls[syscall] {
		return SyscallCategoryFile
	}
	if networkSyscalls[syscall] {
		return SyscallCategoryNetwork
	}
	if processSyscalls[syscall] {
		return SyscallCategoryProcess
	}
	if memorySyscalls[syscall] {
		return SyscallCategoryMemory
	}
	return SyscallCategoryOther
}
