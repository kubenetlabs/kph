package collector

import (
	"testing"

	flowpb "github.com/cilium/cilium/api/v1/flow"
	"github.com/go-logr/logr"
	"google.golang.org/protobuf/types/known/wrapperspb"

	"github.com/policy-hub/operator/internal/telemetry/models"
)

func TestHubbleClient_NewHubbleClient(t *testing.T) {
	client := NewHubbleClient(HubbleClientConfig{
		Address:         "hubble-relay:4245",
		NodeName:        "test-node",
		NamespaceFilter: []string{"default", "production"},
		Logger:          logr.Discard(),
	})

	if client.address != "hubble-relay:4245" {
		t.Errorf("address = %s, want hubble-relay:4245", client.address)
	}
	if client.nodeName != "test-node" {
		t.Errorf("nodeName = %s, want test-node", client.nodeName)
	}
	if len(client.namespaceFilter) != 2 {
		t.Errorf("namespaceFilter length = %d, want 2", len(client.namespaceFilter))
	}
	if client.tlsEnabled {
		t.Error("tlsEnabled should be false by default")
	}
}

func TestHubbleClient_NewHubbleClient_WithTLS(t *testing.T) {
	client := NewHubbleClient(HubbleClientConfig{
		Address:    "hubble-relay:4245",
		TLSEnabled: true,
		Logger:     logr.Discard(),
	})

	if !client.tlsEnabled {
		t.Error("tlsEnabled should be true")
	}
}

func TestHubbleClient_SetEventHandler(t *testing.T) {
	client := NewHubbleClient(HubbleClientConfig{
		Address: "hubble-relay:4245",
		Logger:  logr.Discard(),
	})

	handlerCalled := false
	client.SetEventHandler(func(event *models.TelemetryEvent) {
		handlerCalled = true
	})

	// Verify handler is set
	if client.eventHandler == nil {
		t.Error("eventHandler should not be nil")
	}

	// Call the handler
	client.eventHandler(&models.TelemetryEvent{})
	if !handlerCalled {
		t.Error("eventHandler was not called")
	}
}

func TestHubbleClient_IsConnected(t *testing.T) {
	client := NewHubbleClient(HubbleClientConfig{
		Address: "hubble-relay:4245",
		Logger:  logr.Discard(),
	})

	// Initially not connected
	if client.IsConnected() {
		t.Error("IsConnected() should be false initially")
	}
}

func TestHubbleClient_Close_NotConnected(t *testing.T) {
	client := NewHubbleClient(HubbleClientConfig{
		Address: "hubble-relay:4245",
		Logger:  logr.Discard(),
	})

	// Close when not connected should not error
	err := client.Close()
	if err != nil {
		t.Errorf("Close() when not connected error = %v", err)
	}
}

func TestHubbleClient_BuildWhitelist_NoFilter(t *testing.T) {
	client := NewHubbleClient(HubbleClientConfig{
		Address: "hubble-relay:4245",
		Logger:  logr.Discard(),
	})

	filters := client.buildWhitelist()
	if filters != nil {
		t.Errorf("buildWhitelist() with no filter should return nil, got %v", filters)
	}
}

func TestHubbleClient_BuildWhitelist_WithNamespaces(t *testing.T) {
	client := NewHubbleClient(HubbleClientConfig{
		Address:         "hubble-relay:4245",
		NamespaceFilter: []string{"default", "production"},
		Logger:          logr.Discard(),
	})

	filters := client.buildWhitelist()

	// Should have 4 filters (2 source + 2 destination per namespace)
	if len(filters) != 4 {
		t.Errorf("buildWhitelist() returned %d filters, want 4", len(filters))
	}
}

func TestLabelsSliceToMap(t *testing.T) {
	tests := []struct {
		name     string
		input    []string
		expected map[string]string
	}{
		{
			name:     "empty slice",
			input:    []string{},
			expected: nil,
		},
		{
			name:     "nil slice",
			input:    nil,
			expected: nil,
		},
		{
			name:  "single label",
			input: []string{"app=nginx"},
			expected: map[string]string{
				"app": "nginx",
			},
		},
		{
			name:  "multiple labels",
			input: []string{"app=nginx", "version=1.0", "env=production"},
			expected: map[string]string{
				"app":     "nginx",
				"version": "1.0",
				"env":     "production",
			},
		},
		{
			name:  "label without value",
			input: []string{"readonly"},
			expected: map[string]string{
				"readonly": "",
			},
		},
		{
			name:  "label with multiple equals",
			input: []string{"annotation=key=value"},
			expected: map[string]string{
				"annotation": "key=value",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := labelsSliceToMap(tt.input)

			if tt.expected == nil {
				if result != nil {
					t.Errorf("expected nil, got %v", result)
				}
				return
			}

			if len(result) != len(tt.expected) {
				t.Errorf("result length = %d, want %d", len(result), len(tt.expected))
			}

			for k, v := range tt.expected {
				if result[k] != v {
					t.Errorf("result[%s] = %s, want %s", k, result[k], v)
				}
			}
		})
	}
}

func TestFormatTCPFlags(t *testing.T) {
	tests := []struct {
		name     string
		flags    *flowpb.TCPFlags
		expected string
	}{
		{
			name:     "nil flags",
			flags:    nil,
			expected: "",
		},
		{
			name:     "empty flags",
			flags:    &flowpb.TCPFlags{},
			expected: "",
		},
		{
			name: "SYN only",
			flags: &flowpb.TCPFlags{
				SYN: true,
			},
			expected: "SYN",
		},
		{
			name: "SYN-ACK",
			flags: &flowpb.TCPFlags{
				SYN: true,
				ACK: true,
			},
			expected: "SYN,ACK",
		},
		{
			name: "all flags",
			flags: &flowpb.TCPFlags{
				SYN: true,
				ACK: true,
				FIN: true,
				RST: true,
				PSH: true,
				URG: true,
				ECE: true,
				CWR: true,
				NS:  true,
			},
			expected: "SYN,ACK,FIN,RST,PSH,URG,ECE,CWR,NS",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := formatTCPFlags(tt.flags)
			if result != tt.expected {
				t.Errorf("formatTCPFlags() = %s, want %s", result, tt.expected)
			}
		})
	}
}

func TestFormatHeaders(t *testing.T) {
	tests := []struct {
		name     string
		headers  []*flowpb.HTTPHeader
		expected string
	}{
		{
			name:     "nil headers",
			headers:  nil,
			expected: "",
		},
		{
			name:     "empty headers",
			headers:  []*flowpb.HTTPHeader{},
			expected: "",
		},
		{
			name: "single header",
			headers: []*flowpb.HTTPHeader{
				{Key: "Content-Type", Value: "application/json"},
			},
			expected: "Content-Type=application/json",
		},
		{
			name: "multiple headers",
			headers: []*flowpb.HTTPHeader{
				{Key: "Content-Type", Value: "application/json"},
				{Key: "Authorization", Value: "Bearer token"},
			},
			expected: "Content-Type=application/json;Authorization=Bearer token",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := formatHeaders(tt.headers)
			if result != tt.expected {
				t.Errorf("formatHeaders() = %s, want %s", result, tt.expected)
			}
		})
	}
}

func TestConvertVerdict(t *testing.T) {
	tests := []struct {
		input    flowpb.Verdict
		expected models.Verdict
	}{
		{flowpb.Verdict_FORWARDED, models.VerdictAllowed},
		{flowpb.Verdict_DROPPED, models.VerdictDropped},
		{flowpb.Verdict_ERROR, models.VerdictDenied},
		{flowpb.Verdict_AUDIT, models.VerdictAllowed},
		{flowpb.Verdict_REDIRECTED, models.VerdictAllowed},
		{flowpb.Verdict_TRACED, models.VerdictAllowed},
		{flowpb.Verdict_TRANSLATED, models.VerdictAllowed},
		{flowpb.Verdict_VERDICT_UNKNOWN, models.VerdictUnknown},
	}

	for _, tt := range tests {
		result := convertVerdict(tt.input)
		if result != tt.expected {
			t.Errorf("convertVerdict(%v) = %s, want %s", tt.input, result, tt.expected)
		}
	}
}

func TestHubbleClient_FlowToEvent_Nil(t *testing.T) {
	client := NewHubbleClient(HubbleClientConfig{
		Address:  "hubble-relay:4245",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	event := client.flowToEvent(nil)
	if event != nil {
		t.Error("flowToEvent(nil) should return nil")
	}
}

func TestHubbleClient_FlowToEvent_BasicFlow(t *testing.T) {
	client := NewHubbleClient(HubbleClientConfig{
		Address:  "hubble-relay:4245",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	flow := &flowpb.Flow{
		Source: &flowpb.Endpoint{
			Namespace: "default",
			PodName:   "frontend-abc",
			Labels:    []string{"app=frontend", "version=v1"},
			Identity:  12345,
		},
		Destination: &flowpb.Endpoint{
			Namespace: "default",
			PodName:   "backend-xyz",
			Labels:    []string{"app=backend"},
			Identity:  67890,
		},
		Verdict:          flowpb.Verdict_FORWARDED,
		TrafficDirection: flowpb.TrafficDirection_INGRESS,
	}

	event := client.flowToEvent(flow)

	if event == nil {
		t.Fatal("flowToEvent() returned nil")
	}
	if event.EventType != models.EventTypeFlow {
		t.Errorf("EventType = %s, want flow", event.EventType)
	}
	if event.NodeName != "test-node" {
		t.Errorf("NodeName = %s, want test-node", event.NodeName)
	}
	if event.Source != models.SourceHubble {
		t.Errorf("Source = %s, want hubble", event.Source)
	}
	if event.SrcNamespace != "default" {
		t.Errorf("SrcNamespace = %s, want default", event.SrcNamespace)
	}
	if event.SrcPodName != "frontend-abc" {
		t.Errorf("SrcPodName = %s, want frontend-abc", event.SrcPodName)
	}
	if event.SrcIdentity != 12345 {
		t.Errorf("SrcIdentity = %d, want 12345", event.SrcIdentity)
	}
	if event.DstNamespace != "default" {
		t.Errorf("DstNamespace = %s, want default", event.DstNamespace)
	}
	if event.DstPodName != "backend-xyz" {
		t.Errorf("DstPodName = %s, want backend-xyz", event.DstPodName)
	}
	if event.Verdict != models.VerdictAllowed {
		t.Errorf("Verdict = %s, want allowed", event.Verdict)
	}
	if event.Direction != models.TrafficDirectionIngress {
		t.Errorf("Direction = %s, want ingress", event.Direction)
	}
	if event.SrcPodLabels["app"] != "frontend" {
		t.Errorf("SrcPodLabels[app] = %s, want frontend", event.SrcPodLabels["app"])
	}
}

func TestHubbleClient_FlowToEvent_WithIP(t *testing.T) {
	client := NewHubbleClient(HubbleClientConfig{
		Address:  "hubble-relay:4245",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	flow := &flowpb.Flow{
		IP: &flowpb.IP{
			Source:      "10.0.0.1",
			Destination: "10.0.0.2",
		},
		Verdict: flowpb.Verdict_FORWARDED,
	}

	event := client.flowToEvent(flow)

	if event == nil {
		t.Fatal("flowToEvent() returned nil")
	}
	if event.SrcIP != "10.0.0.1" {
		t.Errorf("SrcIP = %s, want 10.0.0.1", event.SrcIP)
	}
	if event.DstIP != "10.0.0.2" {
		t.Errorf("DstIP = %s, want 10.0.0.2", event.DstIP)
	}
}

func TestHubbleClient_FlowToEvent_WithTCP(t *testing.T) {
	client := NewHubbleClient(HubbleClientConfig{
		Address:  "hubble-relay:4245",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	flow := &flowpb.Flow{
		L4: &flowpb.Layer4{
			Protocol: &flowpb.Layer4_TCP{
				TCP: &flowpb.TCP{
					SourcePort:      12345,
					DestinationPort: 8080,
					Flags: &flowpb.TCPFlags{
						SYN: true,
						ACK: true,
					},
				},
			},
		},
		Verdict: flowpb.Verdict_FORWARDED,
	}

	event := client.flowToEvent(flow)

	if event == nil {
		t.Fatal("flowToEvent() returned nil")
	}
	if event.Protocol != "TCP" {
		t.Errorf("Protocol = %s, want TCP", event.Protocol)
	}
	if event.SrcPort != 12345 {
		t.Errorf("SrcPort = %d, want 12345", event.SrcPort)
	}
	if event.DstPort != 8080 {
		t.Errorf("DstPort = %d, want 8080", event.DstPort)
	}
	if event.TCPFlags != "SYN,ACK" {
		t.Errorf("TCPFlags = %s, want SYN,ACK", event.TCPFlags)
	}
}

func TestHubbleClient_FlowToEvent_WithUDP(t *testing.T) {
	client := NewHubbleClient(HubbleClientConfig{
		Address:  "hubble-relay:4245",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	flow := &flowpb.Flow{
		L4: &flowpb.Layer4{
			Protocol: &flowpb.Layer4_UDP{
				UDP: &flowpb.UDP{
					SourcePort:      53,
					DestinationPort: 53,
				},
			},
		},
		Verdict: flowpb.Verdict_FORWARDED,
	}

	event := client.flowToEvent(flow)

	if event == nil {
		t.Fatal("flowToEvent() returned nil")
	}
	if event.Protocol != "UDP" {
		t.Errorf("Protocol = %s, want UDP", event.Protocol)
	}
	if event.SrcPort != 53 {
		t.Errorf("SrcPort = %d, want 53", event.SrcPort)
	}
	if event.DstPort != 53 {
		t.Errorf("DstPort = %d, want 53", event.DstPort)
	}
}

func TestHubbleClient_FlowToEvent_WithICMPv4(t *testing.T) {
	client := NewHubbleClient(HubbleClientConfig{
		Address:  "hubble-relay:4245",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	flow := &flowpb.Flow{
		L4: &flowpb.Layer4{
			Protocol: &flowpb.Layer4_ICMPv4{
				ICMPv4: &flowpb.ICMPv4{
					Type: 8,
					Code: 0,
				},
			},
		},
		Verdict: flowpb.Verdict_FORWARDED,
	}

	event := client.flowToEvent(flow)

	if event == nil {
		t.Fatal("flowToEvent() returned nil")
	}
	if event.Protocol != "ICMPv4" {
		t.Errorf("Protocol = %s, want ICMPv4", event.Protocol)
	}
}

func TestHubbleClient_FlowToEvent_WithICMPv6(t *testing.T) {
	client := NewHubbleClient(HubbleClientConfig{
		Address:  "hubble-relay:4245",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	flow := &flowpb.Flow{
		L4: &flowpb.Layer4{
			Protocol: &flowpb.Layer4_ICMPv6{
				ICMPv6: &flowpb.ICMPv6{
					Type: 128,
					Code: 0,
				},
			},
		},
		Verdict: flowpb.Verdict_FORWARDED,
	}

	event := client.flowToEvent(flow)

	if event == nil {
		t.Fatal("flowToEvent() returned nil")
	}
	if event.Protocol != "ICMPv6" {
		t.Errorf("Protocol = %s, want ICMPv6", event.Protocol)
	}
}

func TestHubbleClient_FlowToEvent_WithSCTP(t *testing.T) {
	client := NewHubbleClient(HubbleClientConfig{
		Address:  "hubble-relay:4245",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	flow := &flowpb.Flow{
		L4: &flowpb.Layer4{
			Protocol: &flowpb.Layer4_SCTP{
				SCTP: &flowpb.SCTP{
					SourcePort:      9000,
					DestinationPort: 9001,
				},
			},
		},
		Verdict: flowpb.Verdict_FORWARDED,
	}

	event := client.flowToEvent(flow)

	if event == nil {
		t.Fatal("flowToEvent() returned nil")
	}
	if event.Protocol != "SCTP" {
		t.Errorf("Protocol = %s, want SCTP", event.Protocol)
	}
	if event.SrcPort != 9000 {
		t.Errorf("SrcPort = %d, want 9000", event.SrcPort)
	}
	if event.DstPort != 9001 {
		t.Errorf("DstPort = %d, want 9001", event.DstPort)
	}
}

func TestHubbleClient_FlowToEvent_WithHTTP(t *testing.T) {
	client := NewHubbleClient(HubbleClientConfig{
		Address:  "hubble-relay:4245",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	flow := &flowpb.Flow{
		L7: &flowpb.Layer7{
			Type: flowpb.L7FlowType_REQUEST,
			Record: &flowpb.Layer7_Http{
				Http: &flowpb.HTTP{
					Method:   "GET",
					Url:      "/api/v1/users",
					Code:     200,
					Protocol: "HTTP/1.1",
					Headers: []*flowpb.HTTPHeader{
						{Key: "Content-Type", Value: "application/json"},
					},
				},
			},
		},
		Verdict: flowpb.Verdict_FORWARDED,
	}

	event := client.flowToEvent(flow)

	if event == nil {
		t.Fatal("flowToEvent() returned nil")
	}
	if event.HTTPMethod != "GET" {
		t.Errorf("HTTPMethod = %s, want GET", event.HTTPMethod)
	}
	if event.HTTPPath != "/api/v1/users" {
		t.Errorf("HTTPPath = %s, want /api/v1/users", event.HTTPPath)
	}
	if event.HTTPStatus != 200 {
		t.Errorf("HTTPStatus = %d, want 200", event.HTTPStatus)
	}
	if event.HTTPProtocol != "HTTP/1.1" {
		t.Errorf("HTTPProtocol = %s, want HTTP/1.1", event.HTTPProtocol)
	}
	if event.HTTPHeaders != "Content-Type=application/json" {
		t.Errorf("HTTPHeaders = %s, want Content-Type=application/json", event.HTTPHeaders)
	}
}

func TestHubbleClient_FlowToEvent_WithDNS(t *testing.T) {
	client := NewHubbleClient(HubbleClientConfig{
		Address:  "hubble-relay:4245",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	flow := &flowpb.Flow{
		L7: &flowpb.Layer7{
			Type: flowpb.L7FlowType_REQUEST,
			Record: &flowpb.Layer7_Dns{
				Dns: &flowpb.DNS{
					Query:  "example.com",
					Qtypes: []string{"A"},
					Rcode:  0,
					Ips:    []string{"93.184.216.34"},
				},
			},
		},
		Verdict: flowpb.Verdict_FORWARDED,
	}

	event := client.flowToEvent(flow)

	if event == nil {
		t.Fatal("flowToEvent() returned nil")
	}
	if event.DNSQuery != "example.com" {
		t.Errorf("DNSQuery = %s, want example.com", event.DNSQuery)
	}
	if event.DNSQueryType != "A" {
		t.Errorf("DNSQueryType = %s, want A", event.DNSQueryType)
	}
	if event.DNSRCode != 0 {
		t.Errorf("DNSRCode = %d, want 0", event.DNSRCode)
	}
	if len(event.DNSIPs) != 1 || event.DNSIPs[0] != "93.184.216.34" {
		t.Errorf("DNSIPs = %v, want [93.184.216.34]", event.DNSIPs)
	}
}

func TestHubbleClient_FlowToEvent_WithKafka(t *testing.T) {
	client := NewHubbleClient(HubbleClientConfig{
		Address:  "hubble-relay:4245",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	flow := &flowpb.Flow{
		L7: &flowpb.Layer7{
			Type: flowpb.L7FlowType_REQUEST,
			Record: &flowpb.Layer7_Kafka{
				Kafka: &flowpb.Kafka{
					Topic:         "orders",
					ApiKey:        "Produce",
					ErrorCode:     0,
					CorrelationId: 12345,
				},
			},
		},
		Verdict: flowpb.Verdict_FORWARDED,
	}

	event := client.flowToEvent(flow)

	if event == nil {
		t.Fatal("flowToEvent() returned nil")
	}
	if event.KafkaTopic != "orders" {
		t.Errorf("KafkaTopic = %s, want orders", event.KafkaTopic)
	}
	if event.KafkaAPIKey != "Produce" {
		t.Errorf("KafkaAPIKey = %s, want Produce", event.KafkaAPIKey)
	}
	if event.KafkaCorrelation != 12345 {
		t.Errorf("KafkaCorrelation = %d, want 12345", event.KafkaCorrelation)
	}
}

func TestHubbleClient_FlowToEvent_WithDestinationNames(t *testing.T) {
	client := NewHubbleClient(HubbleClientConfig{
		Address:  "hubble-relay:4245",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	flow := &flowpb.Flow{
		DestinationNames: []string{"api.example.com", "cdn.example.com"},
		Verdict:          flowpb.Verdict_FORWARDED,
	}

	event := client.flowToEvent(flow)

	if event == nil {
		t.Fatal("flowToEvent() returned nil")
	}
	if event.DstDNSName != "api.example.com,cdn.example.com" {
		t.Errorf("DstDNSName = %s, want api.example.com,cdn.example.com", event.DstDNSName)
	}
}

func TestHubbleClient_FlowToEvent_WithDropReason(t *testing.T) {
	client := NewHubbleClient(HubbleClientConfig{
		Address:  "hubble-relay:4245",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	flow := &flowpb.Flow{
		Verdict:        flowpb.Verdict_DROPPED,
		DropReasonDesc: flowpb.DropReason_POLICY_DENIED,
	}

	event := client.flowToEvent(flow)

	if event == nil {
		t.Fatal("flowToEvent() returned nil")
	}
	if event.Verdict != models.VerdictDropped {
		t.Errorf("Verdict = %s, want dropped", event.Verdict)
	}
	if event.Action != "POLICY_DENIED" {
		t.Errorf("Action = %s, want POLICY_DENIED", event.Action)
	}
}

func TestHubbleClient_FlowToEvent_TrafficDirections(t *testing.T) {
	client := NewHubbleClient(HubbleClientConfig{
		Address:  "hubble-relay:4245",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	tests := []struct {
		direction flowpb.TrafficDirection
		expected  models.TrafficDirection
	}{
		{flowpb.TrafficDirection_INGRESS, models.TrafficDirectionIngress},
		{flowpb.TrafficDirection_EGRESS, models.TrafficDirectionEgress},
		{flowpb.TrafficDirection_TRAFFIC_DIRECTION_UNKNOWN, models.TrafficDirectionUnknown},
	}

	for _, tt := range tests {
		flow := &flowpb.Flow{
			TrafficDirection: tt.direction,
			Verdict:          flowpb.Verdict_FORWARDED,
		}

		event := client.flowToEvent(flow)
		if event.Direction != tt.expected {
			t.Errorf("Direction for %v = %s, want %s", tt.direction, event.Direction, tt.expected)
		}
	}
}

func TestHubbleClient_FlowToEvent_IsReply(t *testing.T) {
	client := NewHubbleClient(HubbleClientConfig{
		Address:  "hubble-relay:4245",
		NodeName: "test-node",
		Logger:   logr.Discard(),
	})

	flow := &flowpb.Flow{
		IsReply: &wrapperspb.BoolValue{Value: true},
		Verdict: flowpb.Verdict_FORWARDED,
	}

	event := client.flowToEvent(flow)

	if event == nil {
		t.Fatal("flowToEvent() returned nil")
	}
	if !event.IsReply {
		t.Error("IsReply should be true")
	}
}
