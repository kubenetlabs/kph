package collector

import (
	"testing"

	flowpb "github.com/cilium/cilium/api/v1/flow"
	"github.com/go-logr/logr"

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
