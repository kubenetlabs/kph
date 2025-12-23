package models

import (
	"encoding/json"
	"testing"
	"time"
)

func TestEventType_Constants(t *testing.T) {
	tests := []struct {
		eventType EventType
		expected  string
	}{
		{EventTypeFlow, "FLOW"},
		{EventTypeProcessExec, "PROCESS_EXEC"},
		{EventTypeSyscall, "SYSCALL"},
		{EventTypeFileAccess, "FILE_ACCESS"},
	}

	for _, tt := range tests {
		if string(tt.eventType) != tt.expected {
			t.Errorf("EventType = %s, want %s", tt.eventType, tt.expected)
		}
	}
}

func TestVerdict_Constants(t *testing.T) {
	tests := []struct {
		verdict  Verdict
		expected string
	}{
		{VerdictAllowed, "ALLOWED"},
		{VerdictDenied, "DENIED"},
		{VerdictDropped, "DROPPED"},
		{VerdictUnknown, "UNKNOWN"},
	}

	for _, tt := range tests {
		if string(tt.verdict) != tt.expected {
			t.Errorf("Verdict = %s, want %s", tt.verdict, tt.expected)
		}
	}
}

func TestTrafficDirection_Constants(t *testing.T) {
	tests := []struct {
		direction TrafficDirection
		expected  string
	}{
		{TrafficDirectionIngress, "INGRESS"},
		{TrafficDirectionEgress, "EGRESS"},
		{TrafficDirectionUnknown, "UNKNOWN"},
	}

	for _, tt := range tests {
		if string(tt.direction) != tt.expected {
			t.Errorf("TrafficDirection = %s, want %s", tt.direction, tt.expected)
		}
	}
}

func TestSource_Constants(t *testing.T) {
	if SourceHubble != "hubble" {
		t.Errorf("SourceHubble = %s, want hubble", SourceHubble)
	}
	if SourceTetragon != "tetragon" {
		t.Errorf("SourceTetragon = %s, want tetragon", SourceTetragon)
	}
}

func TestTelemetryEvent_CoreFields(t *testing.T) {
	now := time.Now()
	event := TelemetryEvent{
		ID:        "test-event-123",
		Timestamp: now,
		EventType: EventTypeFlow,
		NodeName:  "node-1",
	}

	if event.ID != "test-event-123" {
		t.Errorf("ID = %s, want test-event-123", event.ID)
	}
	if !event.Timestamp.Equal(now) {
		t.Errorf("Timestamp mismatch")
	}
	if event.EventType != EventTypeFlow {
		t.Errorf("EventType = %s, want FLOW", event.EventType)
	}
	if event.NodeName != "node-1" {
		t.Errorf("NodeName = %s, want node-1", event.NodeName)
	}
}

func TestTelemetryEvent_SourceIdentity(t *testing.T) {
	event := TelemetryEvent{
		SrcNamespace: "default",
		SrcPodName:   "frontend-abc",
		SrcPodLabels: map[string]string{"app": "frontend", "version": "v1"},
		SrcIP:        "10.0.0.1",
		SrcPort:      32000,
		SrcIdentity:  12345,
	}

	if event.SrcNamespace != "default" {
		t.Errorf("SrcNamespace = %s, want default", event.SrcNamespace)
	}
	if event.SrcPodName != "frontend-abc" {
		t.Errorf("SrcPodName = %s, want frontend-abc", event.SrcPodName)
	}
	if event.SrcPodLabels["app"] != "frontend" {
		t.Errorf("SrcPodLabels[app] = %s, want frontend", event.SrcPodLabels["app"])
	}
	if event.SrcIP != "10.0.0.1" {
		t.Errorf("SrcIP = %s, want 10.0.0.1", event.SrcIP)
	}
	if event.SrcPort != 32000 {
		t.Errorf("SrcPort = %d, want 32000", event.SrcPort)
	}
	if event.SrcIdentity != 12345 {
		t.Errorf("SrcIdentity = %d, want 12345", event.SrcIdentity)
	}
}

func TestTelemetryEvent_SourceProcessInfo(t *testing.T) {
	event := TelemetryEvent{
		SrcProcess:   "nginx",
		SrcPID:       1234,
		SrcUID:       1000,
		SrcBinary:    "/usr/sbin/nginx",
		SrcArguments: "-g daemon off;",
	}

	if event.SrcProcess != "nginx" {
		t.Errorf("SrcProcess = %s, want nginx", event.SrcProcess)
	}
	if event.SrcPID != 1234 {
		t.Errorf("SrcPID = %d, want 1234", event.SrcPID)
	}
	if event.SrcUID != 1000 {
		t.Errorf("SrcUID = %d, want 1000", event.SrcUID)
	}
	if event.SrcBinary != "/usr/sbin/nginx" {
		t.Errorf("SrcBinary = %s, want /usr/sbin/nginx", event.SrcBinary)
	}
	if event.SrcArguments != "-g daemon off;" {
		t.Errorf("SrcArguments = %s, want '-g daemon off;'", event.SrcArguments)
	}
}

func TestTelemetryEvent_DestinationIdentity(t *testing.T) {
	event := TelemetryEvent{
		DstNamespace: "production",
		DstPodName:   "backend-xyz",
		DstPodLabels: map[string]string{"app": "backend"},
		DstIP:        "10.0.0.2",
		DstPort:      8080,
		DstIdentity:  67890,
		DstDNSName:   "backend.production.svc.cluster.local",
	}

	if event.DstNamespace != "production" {
		t.Errorf("DstNamespace = %s, want production", event.DstNamespace)
	}
	if event.DstPodName != "backend-xyz" {
		t.Errorf("DstPodName = %s, want backend-xyz", event.DstPodName)
	}
	if event.DstPodLabels["app"] != "backend" {
		t.Errorf("DstPodLabels[app] = %s, want backend", event.DstPodLabels["app"])
	}
	if event.DstIP != "10.0.0.2" {
		t.Errorf("DstIP = %s, want 10.0.0.2", event.DstIP)
	}
	if event.DstPort != 8080 {
		t.Errorf("DstPort = %d, want 8080", event.DstPort)
	}
	if event.DstIdentity != 67890 {
		t.Errorf("DstIdentity = %d, want 67890", event.DstIdentity)
	}
	if event.DstDNSName != "backend.production.svc.cluster.local" {
		t.Errorf("DstDNSName = %s, want backend.production.svc.cluster.local", event.DstDNSName)
	}
}

func TestTelemetryEvent_ProtocolInfo(t *testing.T) {
	event := TelemetryEvent{
		Protocol:  "TCP",
		L7Type:    "HTTP",
		Direction: TrafficDirectionIngress,
	}

	if event.Protocol != "TCP" {
		t.Errorf("Protocol = %s, want TCP", event.Protocol)
	}
	if event.L7Type != "HTTP" {
		t.Errorf("L7Type = %s, want HTTP", event.L7Type)
	}
	if event.Direction != TrafficDirectionIngress {
		t.Errorf("Direction = %s, want INGRESS", event.Direction)
	}
}

func TestTelemetryEvent_HTTPDetails(t *testing.T) {
	event := TelemetryEvent{
		HTTPMethod:   "POST",
		HTTPPath:     "/api/users",
		HTTPHost:     "api.example.com",
		HTTPStatus:   201,
		HTTPHeaders:  "Content-Type=application/json",
		HTTPProtocol: "HTTP/1.1",
	}

	if event.HTTPMethod != "POST" {
		t.Errorf("HTTPMethod = %s, want POST", event.HTTPMethod)
	}
	if event.HTTPPath != "/api/users" {
		t.Errorf("HTTPPath = %s, want /api/users", event.HTTPPath)
	}
	if event.HTTPHost != "api.example.com" {
		t.Errorf("HTTPHost = %s, want api.example.com", event.HTTPHost)
	}
	if event.HTTPStatus != 201 {
		t.Errorf("HTTPStatus = %d, want 201", event.HTTPStatus)
	}
	if event.HTTPHeaders != "Content-Type=application/json" {
		t.Errorf("HTTPHeaders = %s, want Content-Type=application/json", event.HTTPHeaders)
	}
	if event.HTTPProtocol != "HTTP/1.1" {
		t.Errorf("HTTPProtocol = %s, want HTTP/1.1", event.HTTPProtocol)
	}
}

func TestTelemetryEvent_DNSDetails(t *testing.T) {
	event := TelemetryEvent{
		DNSQuery:     "api.example.com",
		DNSQueryType: "A",
		DNSRCode:     0,
		DNSIPs:       []string{"10.0.0.1", "10.0.0.2"},
	}

	if event.DNSQuery != "api.example.com" {
		t.Errorf("DNSQuery = %s, want api.example.com", event.DNSQuery)
	}
	if event.DNSQueryType != "A" {
		t.Errorf("DNSQueryType = %s, want A", event.DNSQueryType)
	}
	if event.DNSRCode != 0 {
		t.Errorf("DNSRCode = %d, want 0", event.DNSRCode)
	}
	if len(event.DNSIPs) != 2 {
		t.Errorf("DNSIPs length = %d, want 2", len(event.DNSIPs))
	}
}

func TestTelemetryEvent_GRPCDetails(t *testing.T) {
	event := TelemetryEvent{
		GRPCService: "api.UserService",
		GRPCMethod:  "GetUser",
		GRPCStatus:  0,
	}

	if event.GRPCService != "api.UserService" {
		t.Errorf("GRPCService = %s, want api.UserService", event.GRPCService)
	}
	if event.GRPCMethod != "GetUser" {
		t.Errorf("GRPCMethod = %s, want GetUser", event.GRPCMethod)
	}
	if event.GRPCStatus != 0 {
		t.Errorf("GRPCStatus = %d, want 0", event.GRPCStatus)
	}
}

func TestTelemetryEvent_KafkaDetails(t *testing.T) {
	event := TelemetryEvent{
		KafkaTopic:       "user-events",
		KafkaAPIKey:      "Produce",
		KafkaErrorCode:   0,
		KafkaCorrelation: 12345,
	}

	if event.KafkaTopic != "user-events" {
		t.Errorf("KafkaTopic = %s, want user-events", event.KafkaTopic)
	}
	if event.KafkaAPIKey != "Produce" {
		t.Errorf("KafkaAPIKey = %s, want Produce", event.KafkaAPIKey)
	}
	if event.KafkaErrorCode != 0 {
		t.Errorf("KafkaErrorCode = %d, want 0", event.KafkaErrorCode)
	}
	if event.KafkaCorrelation != 12345 {
		t.Errorf("KafkaCorrelation = %d, want 12345", event.KafkaCorrelation)
	}
}

func TestTelemetryEvent_SyscallInfo(t *testing.T) {
	event := TelemetryEvent{
		Syscall:     "openat",
		SyscallArgs: []string{"/etc/passwd", "O_RDONLY"},
	}

	if event.Syscall != "openat" {
		t.Errorf("Syscall = %s, want openat", event.Syscall)
	}
	if len(event.SyscallArgs) != 2 {
		t.Errorf("SyscallArgs length = %d, want 2", len(event.SyscallArgs))
	}
	if event.SyscallArgs[0] != "/etc/passwd" {
		t.Errorf("SyscallArgs[0] = %s, want /etc/passwd", event.SyscallArgs[0])
	}
}

func TestTelemetryEvent_FileAccessInfo(t *testing.T) {
	event := TelemetryEvent{
		FilePath:      "/etc/passwd",
		FileOperation: "read",
	}

	if event.FilePath != "/etc/passwd" {
		t.Errorf("FilePath = %s, want /etc/passwd", event.FilePath)
	}
	if event.FileOperation != "read" {
		t.Errorf("FileOperation = %s, want read", event.FileOperation)
	}
}

func TestTelemetryEvent_VerdictAndAction(t *testing.T) {
	event := TelemetryEvent{
		Verdict: VerdictDenied,
		Action:  "SIGKILL",
	}

	if event.Verdict != VerdictDenied {
		t.Errorf("Verdict = %s, want DENIED", event.Verdict)
	}
	if event.Action != "SIGKILL" {
		t.Errorf("Action = %s, want SIGKILL", event.Action)
	}
}

func TestTelemetryEvent_FlowMetrics(t *testing.T) {
	event := TelemetryEvent{
		BytesTotal:   2048,
		PacketsTotal: 20,
		TCPFlags:     "SYN,ACK",
		IsReply:      true,
	}

	if event.BytesTotal != 2048 {
		t.Errorf("BytesTotal = %d, want 2048", event.BytesTotal)
	}
	if event.PacketsTotal != 20 {
		t.Errorf("PacketsTotal = %d, want 20", event.PacketsTotal)
	}
	if event.TCPFlags != "SYN,ACK" {
		t.Errorf("TCPFlags = %s, want SYN,ACK", event.TCPFlags)
	}
	if !event.IsReply {
		t.Error("IsReply should be true")
	}
}

func TestTelemetryEvent_PolicyCorrelation(t *testing.T) {
	event := TelemetryEvent{
		MatchedPolicies: []string{"allow-frontend", "deny-external"},
	}

	if len(event.MatchedPolicies) != 2 {
		t.Errorf("MatchedPolicies length = %d, want 2", len(event.MatchedPolicies))
	}
	if event.MatchedPolicies[0] != "allow-frontend" {
		t.Errorf("MatchedPolicies[0] = %s, want allow-frontend", event.MatchedPolicies[0])
	}
}

func TestTelemetryEvent_TraceContext(t *testing.T) {
	event := TelemetryEvent{
		TraceID:      "abc123",
		SpanID:       "def456",
		ParentSpanID: "ghi789",
	}

	if event.TraceID != "abc123" {
		t.Errorf("TraceID = %s, want abc123", event.TraceID)
	}
	if event.SpanID != "def456" {
		t.Errorf("SpanID = %s, want def456", event.SpanID)
	}
	if event.ParentSpanID != "ghi789" {
		t.Errorf("ParentSpanID = %s, want ghi789", event.ParentSpanID)
	}
}

func TestTelemetryEvent_Source(t *testing.T) {
	event := TelemetryEvent{
		Source: SourceHubble,
	}

	if event.Source != "hubble" {
		t.Errorf("Source = %s, want hubble", event.Source)
	}
}

func TestTelemetryEvent_JSONMarshal(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Millisecond)
	event := TelemetryEvent{
		ID:           "test-123",
		Timestamp:    now,
		EventType:    EventTypeFlow,
		NodeName:     "node-1",
		SrcNamespace: "default",
		DstNamespace: "production",
		Protocol:     "TCP",
		DstPort:      8080,
		Verdict:      VerdictAllowed,
		Source:       SourceHubble,
	}

	data, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("json.Marshal error: %v", err)
	}

	var decoded TelemetryEvent
	err = json.Unmarshal(data, &decoded)
	if err != nil {
		t.Fatalf("json.Unmarshal error: %v", err)
	}

	if decoded.ID != event.ID {
		t.Errorf("decoded.ID = %s, want %s", decoded.ID, event.ID)
	}
	if decoded.EventType != event.EventType {
		t.Errorf("decoded.EventType = %s, want %s", decoded.EventType, event.EventType)
	}
	if decoded.SrcNamespace != event.SrcNamespace {
		t.Errorf("decoded.SrcNamespace = %s, want %s", decoded.SrcNamespace, event.SrcNamespace)
	}
	if decoded.DstPort != event.DstPort {
		t.Errorf("decoded.DstPort = %d, want %d", decoded.DstPort, event.DstPort)
	}
	if decoded.Verdict != event.Verdict {
		t.Errorf("decoded.Verdict = %s, want %s", decoded.Verdict, event.Verdict)
	}
}

func TestFlowSummary_Fields(t *testing.T) {
	now := time.Now()
	summary := FlowSummary{
		WindowStart:  now.Add(-1 * time.Minute),
		WindowEnd:    now,
		NodeName:     "node-1",
		SrcNamespace: "default",
		DstNamespace: "production",
		SrcPodName:   "frontend",
		DstPodName:   "backend",
		DstPort:      8080,
		Protocol:     "TCP",
		L7Type:       "HTTP",
		TotalFlows:   1000,
		AllowedFlows: 900,
		DeniedFlows:  100,
		DroppedFlows: 0,
		TotalBytes:   1024000,
		TotalPackets: 10000,
		HTTPMethodCounts: map[string]int64{
			"GET":  800,
			"POST": 200,
		},
		HTTPStatusCounts: map[int32]int64{
			200: 850,
			404: 50,
			500: 100,
		},
		TopHTTPPaths: []PathCount{
			{Path: "/api/users", Count: 500},
			{Path: "/api/products", Count: 300},
		},
		TopDNSQueries: []DNSQueryCount{
			{Query: "api.example.com", Type: "A", Count: 100},
		},
	}

	if summary.TotalFlows != 1000 {
		t.Errorf("TotalFlows = %d, want 1000", summary.TotalFlows)
	}
	if summary.AllowedFlows != 900 {
		t.Errorf("AllowedFlows = %d, want 900", summary.AllowedFlows)
	}
	if summary.HTTPMethodCounts["GET"] != 800 {
		t.Errorf("HTTPMethodCounts[GET] = %d, want 800", summary.HTTPMethodCounts["GET"])
	}
	if len(summary.TopHTTPPaths) != 2 {
		t.Errorf("TopHTTPPaths length = %d, want 2", len(summary.TopHTTPPaths))
	}
}

func TestFlowSummary_JSONMarshal(t *testing.T) {
	summary := FlowSummary{
		WindowStart:  time.Now().Add(-1 * time.Minute),
		WindowEnd:    time.Now(),
		NodeName:     "node-1",
		SrcNamespace: "default",
		DstNamespace: "production",
		TotalFlows:   100,
	}

	data, err := json.Marshal(summary)
	if err != nil {
		t.Fatalf("json.Marshal error: %v", err)
	}

	var decoded FlowSummary
	err = json.Unmarshal(data, &decoded)
	if err != nil {
		t.Fatalf("json.Unmarshal error: %v", err)
	}

	if decoded.TotalFlows != summary.TotalFlows {
		t.Errorf("decoded.TotalFlows = %d, want %d", decoded.TotalFlows, summary.TotalFlows)
	}
}

func TestPathCount_Fields(t *testing.T) {
	pc := PathCount{
		Path:  "/api/users",
		Count: 100,
	}

	if pc.Path != "/api/users" {
		t.Errorf("Path = %s, want /api/users", pc.Path)
	}
	if pc.Count != 100 {
		t.Errorf("Count = %d, want 100", pc.Count)
	}
}

func TestDNSQueryCount_Fields(t *testing.T) {
	dqc := DNSQueryCount{
		Query: "api.example.com",
		Type:  "A",
		Count: 50,
	}

	if dqc.Query != "api.example.com" {
		t.Errorf("Query = %s, want api.example.com", dqc.Query)
	}
	if dqc.Type != "A" {
		t.Errorf("Type = %s, want A", dqc.Type)
	}
	if dqc.Count != 50 {
		t.Errorf("Count = %d, want 50", dqc.Count)
	}
}

func TestProcessEventSummary_Fields(t *testing.T) {
	now := time.Now()
	summary := ProcessEventSummary{
		WindowStart:    now.Add(-1 * time.Minute),
		WindowEnd:      now,
		NodeName:       "node-1",
		Namespace:      "default",
		PodName:        "app-pod",
		TotalExecs:     100,
		UniqueBinaries: 10,
		TopBinaries: []BinaryCount{
			{Binary: "/bin/sh", Count: 50},
			{Binary: "/usr/bin/curl", Count: 30},
		},
		TotalSyscalls: 1000,
		SyscallCounts: map[string]int64{
			"openat": 500,
			"read":   300,
			"write":  200,
		},
		TotalFileAccess: 500,
		FileOpCounts: map[string]int64{
			"read":  400,
			"write": 100,
		},
		ActionCounts: map[string]int64{
			"SIGKILL": 5,
		},
	}

	if summary.TotalExecs != 100 {
		t.Errorf("TotalExecs = %d, want 100", summary.TotalExecs)
	}
	if summary.UniqueBinaries != 10 {
		t.Errorf("UniqueBinaries = %d, want 10", summary.UniqueBinaries)
	}
	if len(summary.TopBinaries) != 2 {
		t.Errorf("TopBinaries length = %d, want 2", len(summary.TopBinaries))
	}
	if summary.SyscallCounts["openat"] != 500 {
		t.Errorf("SyscallCounts[openat] = %d, want 500", summary.SyscallCounts["openat"])
	}
	if summary.ActionCounts["SIGKILL"] != 5 {
		t.Errorf("ActionCounts[SIGKILL] = %d, want 5", summary.ActionCounts["SIGKILL"])
	}
}

func TestBinaryCount_Fields(t *testing.T) {
	bc := BinaryCount{
		Binary: "/usr/bin/curl",
		Count:  25,
	}

	if bc.Binary != "/usr/bin/curl" {
		t.Errorf("Binary = %s, want /usr/bin/curl", bc.Binary)
	}
	if bc.Count != 25 {
		t.Errorf("Count = %d, want 25", bc.Count)
	}
}

func TestAggregatedTelemetry_Fields(t *testing.T) {
	now := time.Now()
	agg := AggregatedTelemetry{
		ClusterID: "cluster-123",
		Timestamp: now,
		FlowSummaries: []FlowSummary{
			{NodeName: "node-1", TotalFlows: 100},
			{NodeName: "node-2", TotalFlows: 200},
		},
		ProcessSummaries: []ProcessEventSummary{
			{NodeName: "node-1", TotalExecs: 50},
		},
	}

	if agg.ClusterID != "cluster-123" {
		t.Errorf("ClusterID = %s, want cluster-123", agg.ClusterID)
	}
	if len(agg.FlowSummaries) != 2 {
		t.Errorf("FlowSummaries length = %d, want 2", len(agg.FlowSummaries))
	}
	if len(agg.ProcessSummaries) != 1 {
		t.Errorf("ProcessSummaries length = %d, want 1", len(agg.ProcessSummaries))
	}
}

func TestAggregatedTelemetry_JSONMarshal(t *testing.T) {
	agg := AggregatedTelemetry{
		ClusterID: "cluster-123",
		Timestamp: time.Now().UTC().Truncate(time.Millisecond),
		FlowSummaries: []FlowSummary{
			{NodeName: "node-1", TotalFlows: 100},
		},
	}

	data, err := json.Marshal(agg)
	if err != nil {
		t.Fatalf("json.Marshal error: %v", err)
	}

	var decoded AggregatedTelemetry
	err = json.Unmarshal(data, &decoded)
	if err != nil {
		t.Fatalf("json.Unmarshal error: %v", err)
	}

	if decoded.ClusterID != agg.ClusterID {
		t.Errorf("decoded.ClusterID = %s, want %s", decoded.ClusterID, agg.ClusterID)
	}
	if len(decoded.FlowSummaries) != 1 {
		t.Errorf("decoded.FlowSummaries length = %d, want 1", len(decoded.FlowSummaries))
	}
}

func TestQueryEventsRequest_Fields(t *testing.T) {
	now := time.Now()
	req := QueryEventsRequest{
		StartTime:  now.Add(-24 * time.Hour),
		EndTime:    now,
		Namespaces: []string{"default", "production"},
		EventTypes: []string{"FLOW", "PROCESS_EXEC"},
		Limit:      100,
		Offset:     50,
	}

	if len(req.Namespaces) != 2 {
		t.Errorf("Namespaces length = %d, want 2", len(req.Namespaces))
	}
	if len(req.EventTypes) != 2 {
		t.Errorf("EventTypes length = %d, want 2", len(req.EventTypes))
	}
	if req.Limit != 100 {
		t.Errorf("Limit = %d, want 100", req.Limit)
	}
	if req.Offset != 50 {
		t.Errorf("Offset = %d, want 50", req.Offset)
	}
}

func TestQueryEventsRequest_JSONMarshal(t *testing.T) {
	req := QueryEventsRequest{
		StartTime:  time.Now().Add(-1 * time.Hour).UTC().Truncate(time.Millisecond),
		EndTime:    time.Now().UTC().Truncate(time.Millisecond),
		Namespaces: []string{"default"},
		Limit:      50,
	}

	data, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("json.Marshal error: %v", err)
	}

	var decoded QueryEventsRequest
	err = json.Unmarshal(data, &decoded)
	if err != nil {
		t.Fatalf("json.Unmarshal error: %v", err)
	}

	if decoded.Limit != req.Limit {
		t.Errorf("decoded.Limit = %d, want %d", decoded.Limit, req.Limit)
	}
	if len(decoded.Namespaces) != 1 {
		t.Errorf("decoded.Namespaces length = %d, want 1", len(decoded.Namespaces))
	}
}

func TestQueryEventsResponse_Fields(t *testing.T) {
	resp := QueryEventsResponse{
		Events: []TelemetryEvent{
			{ID: "event-1", EventType: EventTypeFlow},
			{ID: "event-2", EventType: EventTypeProcessExec},
		},
		TotalCount: 100,
		HasMore:    true,
	}

	if len(resp.Events) != 2 {
		t.Errorf("Events length = %d, want 2", len(resp.Events))
	}
	if resp.TotalCount != 100 {
		t.Errorf("TotalCount = %d, want 100", resp.TotalCount)
	}
	if !resp.HasMore {
		t.Error("HasMore should be true")
	}
}

func TestEventCountResponse_Fields(t *testing.T) {
	now := time.Now()
	resp := EventCountResponse{
		TotalEvents: 10000,
		EventsByType: map[string]int64{
			"FLOW":         8000,
			"PROCESS_EXEC": 2000,
		},
		EventsByNode: map[string]int64{
			"node-1": 5000,
			"node-2": 5000,
		},
		OldestEvent: now.Add(-24 * time.Hour),
		NewestEvent: now,
	}

	if resp.TotalEvents != 10000 {
		t.Errorf("TotalEvents = %d, want 10000", resp.TotalEvents)
	}
	if resp.EventsByType["FLOW"] != 8000 {
		t.Errorf("EventsByType[FLOW] = %d, want 8000", resp.EventsByType["FLOW"])
	}
	if resp.EventsByNode["node-1"] != 5000 {
		t.Errorf("EventsByNode[node-1] = %d, want 5000", resp.EventsByNode["node-1"])
	}
	if resp.OldestEvent.After(resp.NewestEvent) {
		t.Error("OldestEvent should be before NewestEvent")
	}
}

func TestTelemetryEvent_FullFlowEvent(t *testing.T) {
	// Test a complete flow event with all common fields
	now := time.Now()
	event := TelemetryEvent{
		ID:           "flow-123",
		Timestamp:    now,
		EventType:    EventTypeFlow,
		NodeName:     "node-1",
		SrcNamespace: "default",
		SrcPodName:   "frontend-abc",
		SrcPodLabels: map[string]string{"app": "frontend"},
		SrcIP:        "10.0.0.1",
		SrcPort:      32000,
		DstNamespace: "production",
		DstPodName:   "backend-xyz",
		DstPodLabels: map[string]string{"app": "backend"},
		DstIP:        "10.0.0.2",
		DstPort:      8080,
		Protocol:     "TCP",
		L7Type:       "HTTP",
		Direction:    TrafficDirectionEgress,
		HTTPMethod:   "GET",
		HTTPPath:     "/api/users",
		HTTPStatus:   200,
		Verdict:      VerdictAllowed,
		BytesTotal:   1024,
		PacketsTotal: 10,
		Source:       SourceHubble,
	}

	// Verify JSON round-trip
	data, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("json.Marshal error: %v", err)
	}

	var decoded TelemetryEvent
	err = json.Unmarshal(data, &decoded)
	if err != nil {
		t.Fatalf("json.Unmarshal error: %v", err)
	}

	if decoded.ID != event.ID {
		t.Errorf("ID mismatch")
	}
	if decoded.HTTPMethod != event.HTTPMethod {
		t.Errorf("HTTPMethod mismatch")
	}
	if decoded.BytesTotal != event.BytesTotal {
		t.Errorf("BytesTotal mismatch")
	}
}

func TestTelemetryEvent_FullProcessEvent(t *testing.T) {
	// Test a complete process event with all common fields
	now := time.Now()
	event := TelemetryEvent{
		ID:           "proc-456",
		Timestamp:    now,
		EventType:    EventTypeProcessExec,
		NodeName:     "node-1",
		SrcNamespace: "default",
		SrcPodName:   "app-pod",
		SrcProcess:   "curl",
		SrcPID:       1234,
		SrcUID:       1000,
		SrcBinary:    "/usr/bin/curl",
		SrcArguments: "-X GET https://api.example.com",
		Verdict:      VerdictAllowed,
		Action:       "LOG",
		Source:       SourceTetragon,
	}

	// Verify JSON round-trip
	data, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("json.Marshal error: %v", err)
	}

	var decoded TelemetryEvent
	err = json.Unmarshal(data, &decoded)
	if err != nil {
		t.Fatalf("json.Unmarshal error: %v", err)
	}

	if decoded.ID != event.ID {
		t.Errorf("ID mismatch")
	}
	if decoded.SrcBinary != event.SrcBinary {
		t.Errorf("SrcBinary mismatch")
	}
	if decoded.Action != event.Action {
		t.Errorf("Action mismatch")
	}
}
