package query

import (
	"testing"
	"time"
)

func TestQueryEventsRequest_Fields(t *testing.T) {
	now := time.Now()
	req := QueryEventsRequest{
		StartTime:  now.Add(-24 * time.Hour),
		EndTime:    now,
		Namespaces: []string{"default", "production"},
		EventTypes: []string{"flow", "process_exec"},
		Limit:      100,
		Offset:     50,
	}

	if req.StartTime.After(req.EndTime) {
		t.Error("StartTime should be before EndTime")
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

func TestQueryEventsResponse_Fields(t *testing.T) {
	now := time.Now()
	resp := QueryEventsResponse{
		Events: []*TelemetryEvent{
			{
				ID:           "event-1",
				Timestamp:    now,
				EventType:    "flow",
				SrcNamespace: "default",
			},
			{
				ID:           "event-2",
				Timestamp:    now,
				EventType:    "process_exec",
				SrcNamespace: "production",
			},
		},
		TotalCount: 100,
		HasMore:    true,
	}

	if len(resp.Events) != 2 {
		t.Errorf("Events count = %d, want 2", len(resp.Events))
	}
	if resp.TotalCount != 100 {
		t.Errorf("TotalCount = %d, want 100", resp.TotalCount)
	}
	if !resp.HasMore {
		t.Error("HasMore should be true")
	}
}

func TestGetEventCountRequest_Fields(t *testing.T) {
	now := time.Now()
	req := GetEventCountRequest{
		StartTime:  now.Add(-24 * time.Hour),
		EndTime:    now,
		Namespaces: []string{"default"},
	}

	if req.StartTime.After(req.EndTime) {
		t.Error("StartTime should be before EndTime")
	}
	if len(req.Namespaces) != 1 {
		t.Errorf("Namespaces length = %d, want 1", len(req.Namespaces))
	}
}

func TestEventCountResponse_Fields(t *testing.T) {
	now := time.Now()
	resp := EventCountResponse{
		TotalEvents:  5000,
		EventsByType: map[string]int64{"flow": 4000, "process_exec": 1000},
		EventsByNode: map[string]int64{"node-1": 2500, "node-2": 2500},
		OldestEvent:  now.Add(-24 * time.Hour),
		NewestEvent:  now,
	}

	if resp.TotalEvents != 5000 {
		t.Errorf("TotalEvents = %d, want 5000", resp.TotalEvents)
	}
	if len(resp.EventsByType) != 2 {
		t.Errorf("EventsByType length = %d, want 2", len(resp.EventsByType))
	}
	if resp.EventsByType["flow"] != 4000 {
		t.Errorf("EventsByType[flow] = %d, want 4000", resp.EventsByType["flow"])
	}
	if len(resp.EventsByNode) != 2 {
		t.Errorf("EventsByNode length = %d, want 2", len(resp.EventsByNode))
	}
	if resp.OldestEvent.After(resp.NewestEvent) {
		t.Error("OldestEvent should be before NewestEvent")
	}
}

func TestSimulatePolicyRequest_Fields(t *testing.T) {
	now := time.Now()
	req := SimulatePolicyRequest{
		PolicyContent: `
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: test-policy
  namespace: default
spec:
  endpointSelector:
    matchLabels:
      app: web
`,
		PolicyType:     "CILIUM_NETWORK",
		StartTime:      now.Add(-24 * time.Hour),
		EndTime:        now,
		Namespaces:     []string{"default", "production"},
		IncludeDetails: true,
		MaxDetails:     100,
	}

	if req.PolicyContent == "" {
		t.Error("PolicyContent should not be empty")
	}
	if req.PolicyType != "CILIUM_NETWORK" {
		t.Errorf("PolicyType = %s, want CILIUM_NETWORK", req.PolicyType)
	}
	if len(req.Namespaces) != 2 {
		t.Errorf("Namespaces length = %d, want 2", len(req.Namespaces))
	}
	if !req.IncludeDetails {
		t.Error("IncludeDetails should be true")
	}
	if req.MaxDetails != 100 {
		t.Errorf("MaxDetails = %d, want 100", req.MaxDetails)
	}
}

func TestSimulatePolicyResponse_Fields(t *testing.T) {
	now := time.Now()
	resp := SimulatePolicyResponse{
		TotalFlowsAnalyzed: 1000,
		AllowedCount:       800,
		DeniedCount:        200,
		NoChangeCount:      850,
		WouldChangeCount:   150,
		BreakdownByNamespace: map[string]*NamespaceImpact{
			"default": {
				Namespace:    "default",
				TotalFlows:   500,
				AllowedCount: 400,
				DeniedCount:  100,
				WouldDeny:    50,
				WouldAllow:   25,
				NoChange:     425,
			},
		},
		BreakdownByVerdict: &VerdictBreakdown{
			AllowedToAllowed: 700,
			AllowedToDenied:  100,
			DeniedToAllowed:  50,
			DeniedToDenied:   150,
		},
		Details: []*FlowSimulationResult{
			{
				Timestamp:        now,
				SrcNamespace:     "default",
				SrcPodName:       "frontend",
				DstNamespace:     "production",
				DstPodName:       "backend",
				DstPort:          8080,
				Protocol:         "TCP",
				OriginalVerdict:  "allowed",
				SimulatedVerdict: "denied",
				VerdictChanged:   true,
				MatchedRule:      "deny-all",
			},
		},
		Errors:         []string{},
		SimulationTime: now,
		Duration:       100 * time.Millisecond,
	}

	if resp.TotalFlowsAnalyzed != 1000 {
		t.Errorf("TotalFlowsAnalyzed = %d, want 1000", resp.TotalFlowsAnalyzed)
	}
	if resp.AllowedCount != 800 {
		t.Errorf("AllowedCount = %d, want 800", resp.AllowedCount)
	}
	if resp.DeniedCount != 200 {
		t.Errorf("DeniedCount = %d, want 200", resp.DeniedCount)
	}
	if resp.WouldChangeCount != 150 {
		t.Errorf("WouldChangeCount = %d, want 150", resp.WouldChangeCount)
	}
	if len(resp.BreakdownByNamespace) != 1 {
		t.Errorf("BreakdownByNamespace count = %d, want 1", len(resp.BreakdownByNamespace))
	}
	if resp.BreakdownByVerdict.AllowedToDenied != 100 {
		t.Errorf("AllowedToDenied = %d, want 100", resp.BreakdownByVerdict.AllowedToDenied)
	}
	if len(resp.Details) != 1 {
		t.Errorf("Details count = %d, want 1", len(resp.Details))
	}
	if resp.Duration != 100*time.Millisecond {
		t.Errorf("Duration = %v, want 100ms", resp.Duration)
	}
}

func TestTelemetryEvent_Fields(t *testing.T) {
	now := time.Now()
	event := TelemetryEvent{
		ID:           "test-event-123",
		Timestamp:    now,
		EventType:    "flow",
		NodeName:     "node-1",
		SrcNamespace: "default",
		SrcPodName:   "frontend-abc",
		SrcPodLabels: map[string]string{"app": "frontend", "version": "v1"},
		SrcIP:        "10.0.0.1",
		SrcPort:      32000,
		SrcProcess:   "nginx",
		SrcPID:       1234,
		SrcBinary:    "/usr/sbin/nginx",
		DstNamespace: "production",
		DstPodName:   "backend-xyz",
		DstPodLabels: map[string]string{"app": "backend"},
		DstIP:        "10.0.0.2",
		DstPort:      8080,
		Protocol:     "TCP",
		L7Type:       "HTTP",
		HTTPMethod:   "GET",
		HTTPPath:     "/api/users",
		HTTPStatus:   200,
		DNSQuery:     "",
		Syscall:      "",
		FilePath:     "",
		Verdict:      "allowed",
		Action:       "",
		BytesTotal:   1024,
		PacketsTotal: 10,
		Source:       "hubble",
	}

	if event.ID != "test-event-123" {
		t.Errorf("ID = %s, want test-event-123", event.ID)
	}
	if event.EventType != "flow" {
		t.Errorf("EventType = %s, want flow", event.EventType)
	}
	if event.SrcPort != 32000 {
		t.Errorf("SrcPort = %d, want 32000", event.SrcPort)
	}
	if event.DstPort != 8080 {
		t.Errorf("DstPort = %d, want 8080", event.DstPort)
	}
	if event.HTTPStatus != 200 {
		t.Errorf("HTTPStatus = %d, want 200", event.HTTPStatus)
	}
	if event.BytesTotal != 1024 {
		t.Errorf("BytesTotal = %d, want 1024", event.BytesTotal)
	}
	if event.Source != "hubble" {
		t.Errorf("Source = %s, want hubble", event.Source)
	}
}

func TestNamespaceImpact_Fields(t *testing.T) {
	impact := NamespaceImpact{
		Namespace:    "production",
		TotalFlows:   10000,
		AllowedCount: 9500,
		DeniedCount:  500,
		WouldDeny:    200,
		WouldAllow:   50,
		NoChange:     9750,
	}

	if impact.Namespace != "production" {
		t.Errorf("Namespace = %s, want production", impact.Namespace)
	}
	if impact.TotalFlows != 10000 {
		t.Errorf("TotalFlows = %d, want 10000", impact.TotalFlows)
	}
	if impact.AllowedCount != 9500 {
		t.Errorf("AllowedCount = %d, want 9500", impact.AllowedCount)
	}
	if impact.DeniedCount != 500 {
		t.Errorf("DeniedCount = %d, want 500", impact.DeniedCount)
	}
	if impact.WouldDeny != 200 {
		t.Errorf("WouldDeny = %d, want 200", impact.WouldDeny)
	}
	if impact.WouldAllow != 50 {
		t.Errorf("WouldAllow = %d, want 50", impact.WouldAllow)
	}
	if impact.NoChange != 9750 {
		t.Errorf("NoChange = %d, want 9750", impact.NoChange)
	}
}

func TestVerdictBreakdown_Fields(t *testing.T) {
	breakdown := VerdictBreakdown{
		AllowedToAllowed: 8000,
		AllowedToDenied:  500,
		DeniedToAllowed:  200,
		DeniedToDenied:   1000,
		DroppedToAllowed: 50,
		DroppedToDenied:  250,
	}

	if breakdown.AllowedToAllowed != 8000 {
		t.Errorf("AllowedToAllowed = %d, want 8000", breakdown.AllowedToAllowed)
	}
	if breakdown.AllowedToDenied != 500 {
		t.Errorf("AllowedToDenied = %d, want 500", breakdown.AllowedToDenied)
	}
	if breakdown.DeniedToAllowed != 200 {
		t.Errorf("DeniedToAllowed = %d, want 200", breakdown.DeniedToAllowed)
	}
	if breakdown.DeniedToDenied != 1000 {
		t.Errorf("DeniedToDenied = %d, want 1000", breakdown.DeniedToDenied)
	}
	if breakdown.DroppedToAllowed != 50 {
		t.Errorf("DroppedToAllowed = %d, want 50", breakdown.DroppedToAllowed)
	}
	if breakdown.DroppedToDenied != 250 {
		t.Errorf("DroppedToDenied = %d, want 250", breakdown.DroppedToDenied)
	}
}

func TestFlowSimulationResult_Fields(t *testing.T) {
	now := time.Now()
	result := FlowSimulationResult{
		Timestamp:        now,
		SrcNamespace:     "default",
		SrcPodName:       "frontend",
		DstNamespace:     "production",
		DstPodName:       "backend",
		DstPort:          8080,
		Protocol:         "TCP",
		L7Type:           "HTTP",
		HTTPMethod:       "GET",
		HTTPPath:         "/api/users",
		OriginalVerdict:  "allowed",
		SimulatedVerdict: "denied",
		VerdictChanged:   true,
		MatchedRule:      "deny-external-traffic",
		MatchReason:      "No matching ingress rule",
	}

	if result.SrcNamespace != "default" {
		t.Errorf("SrcNamespace = %s, want default", result.SrcNamespace)
	}
	if result.DstNamespace != "production" {
		t.Errorf("DstNamespace = %s, want production", result.DstNamespace)
	}
	if result.DstPort != 8080 {
		t.Errorf("DstPort = %d, want 8080", result.DstPort)
	}
	if result.OriginalVerdict != "allowed" {
		t.Errorf("OriginalVerdict = %s, want allowed", result.OriginalVerdict)
	}
	if result.SimulatedVerdict != "denied" {
		t.Errorf("SimulatedVerdict = %s, want denied", result.SimulatedVerdict)
	}
	if !result.VerdictChanged {
		t.Error("VerdictChanged should be true")
	}
	if result.MatchedRule != "deny-external-traffic" {
		t.Errorf("MatchedRule = %s, want deny-external-traffic", result.MatchedRule)
	}
	if result.MatchReason != "No matching ingress rule" {
		t.Errorf("MatchReason = %s, want 'No matching ingress rule'", result.MatchReason)
	}
}

func TestUnimplementedTelemetryQueryServer(t *testing.T) {
	var server UnimplementedTelemetryQueryServer

	// These methods should return nil, nil
	resp, err := server.QueryEvents(nil, nil)
	if resp != nil || err != nil {
		t.Errorf("QueryEvents should return nil, nil, got %v, %v", resp, err)
	}

	err = server.StreamEvents(nil, nil)
	if err != nil {
		t.Errorf("StreamEvents should return nil, got %v", err)
	}

	countResp, err := server.GetEventCount(nil, nil)
	if countResp != nil || err != nil {
		t.Errorf("GetEventCount should return nil, nil, got %v, %v", countResp, err)
	}

	simResp, err := server.SimulatePolicy(nil, nil)
	if simResp != nil || err != nil {
		t.Errorf("SimulatePolicy should return nil, nil, got %v, %v", simResp, err)
	}

	// mustEmbedUnimplementedTelemetryQueryServer should not panic
	server.mustEmbedUnimplementedTelemetryQueryServer()
}
