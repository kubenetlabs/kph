package simulation

import (
	"context"
	"testing"
	"time"

	"github.com/go-logr/logr"

	"github.com/policy-hub/operator/internal/telemetry/models"
	"github.com/policy-hub/operator/internal/telemetry/storage"
)

// mockStorageManager implements a minimal storage manager for testing.
type mockStorageManager struct {
	events []models.TelemetryEvent
}

func (m *mockStorageManager) Query(ctx context.Context, req models.QueryEventsRequest) (*models.QueryEventsResponse, error) {
	filtered := make([]models.TelemetryEvent, 0)
	for _, e := range m.events {
		// Apply time filter
		if !req.StartTime.IsZero() && e.Timestamp.Before(req.StartTime) {
			continue
		}
		if !req.EndTime.IsZero() && e.Timestamp.After(req.EndTime) {
			continue
		}
		// Apply namespace filter
		if len(req.Namespaces) > 0 {
			found := false
			for _, ns := range req.Namespaces {
				if e.SrcNamespace == ns || e.DstNamespace == ns {
					found = true
					break
				}
			}
			if !found {
				continue
			}
		}
		filtered = append(filtered, e)
	}
	return &models.QueryEventsResponse{
		Events:     filtered,
		TotalCount: int64(len(filtered)),
		HasMore:    false,
	}, nil
}

func TestEngine_Simulate_BasicPolicy(t *testing.T) {
	// Create mock storage with test events
	mockStorage := &mockStorageManager{
		events: []models.TelemetryEvent{
			{
				ID:           "1",
				Timestamp:    time.Now(),
				EventType:    models.EventTypeFlow,
				SrcNamespace: "default",
				SrcPodName:   "frontend-abc",
				SrcPodLabels: map[string]string{"app": "frontend"},
				DstNamespace: "default",
				DstPodName:   "backend-xyz",
				DstPodLabels: map[string]string{"app": "backend"},
				DstPort:      8080,
				Protocol:     "TCP",
				Verdict:      models.VerdictAllowed,
				Direction:    models.TrafficDirectionEgress,
			},
			{
				ID:           "2",
				Timestamp:    time.Now(),
				EventType:    models.EventTypeFlow,
				SrcNamespace: "default",
				SrcPodName:   "attacker-pod",
				SrcPodLabels: map[string]string{"app": "attacker"},
				DstNamespace: "default",
				DstPodName:   "backend-xyz",
				DstPodLabels: map[string]string{"app": "backend"},
				DstPort:      8080,
				Protocol:     "TCP",
				Verdict:      models.VerdictAllowed,
				Direction:    models.TrafficDirectionEgress,
			},
		},
	}

	// Create engine with mock storage manager wrapper
	engine := &Engine{
		storageMgr: &storage.Manager{}, // Will be overridden
		parser:     NewPolicyParser(),
		log:        logr.Discard(),
	}

	// Override the Query method by using our own simulation
	policy := `
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: allow-frontend-only
  namespace: default
spec:
  endpointSelector:
    matchLabels:
      app: backend
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: frontend
      toPorts:
        - ports:
            - port: "8080"
              protocol: TCP
`

	// Parse the policy manually for this test
	parsedPolicy, err := engine.parser.Parse(policy, "CILIUM_NETWORK")
	if err != nil {
		t.Fatalf("Failed to parse policy: %v", err)
	}

	// Test flow evaluation directly
	for _, event := range mockStorage.events {
		result := engine.evaluateFlow(&event, parsedPolicy)
		t.Logf("Flow from %s: original=%s, simulated=%s, changed=%v, reason=%s",
			event.SrcPodLabels["app"],
			result.OriginalVerdict,
			result.SimulatedVerdict,
			result.VerdictChanged,
			result.MatchReason,
		)
	}
}

func TestEngine_EvaluateFlow_PodSelectorMatch(t *testing.T) {
	engine := &Engine{
		parser: NewPolicyParser(),
		log:    logr.Discard(),
	}

	// Policy applies to pods with app=api (the source for egress flows)
	// and allows egress to pods with app=database on port 5432
	policy := &ParsedPolicy{
		Name:      "test-policy",
		Namespace: "default",
		PodSelector: map[string]string{
			"app": "api",
		},
		EgressRules: []PolicyRule{
			{
				Direction: "egress",
				Action:    "allow",
				PodSelector: map[string]string{
					"app": "database",
				},
				ToPorts: []PortRule{
					{Port: 5432, Protocol: "TCP"},
				},
			},
		},
		DefaultDeny:     true,
		DefaultDenyType: "egress",
	}

	tests := []struct {
		name            string
		event           models.TelemetryEvent
		wantVerdict     string
		wantChanged     bool
	}{
		{
			name: "api to database on correct port - should allow",
			event: models.TelemetryEvent{
				SrcNamespace: "default",
				SrcPodName:   "api-pod",
				SrcPodLabels: map[string]string{"app": "api"},
				DstNamespace: "default",
				DstPodName:   "database-pod",
				DstPodLabels: map[string]string{"app": "database"},
				DstPort:      5432,
				Protocol:     "TCP",
				Verdict:      models.VerdictAllowed,
				Direction:    models.TrafficDirectionEgress,
			},
			wantVerdict: "ALLOWED",
			wantChanged: false,
		},
		{
			name: "api to unauthorized destination - should deny",
			event: models.TelemetryEvent{
				SrcNamespace: "default",
				SrcPodName:   "api-pod",
				SrcPodLabels: map[string]string{"app": "api"},
				DstNamespace: "default",
				DstPodName:   "external-pod",
				DstPodLabels: map[string]string{"app": "external"},
				DstPort:      5432,
				Protocol:     "TCP",
				Verdict:      models.VerdictAllowed,
				Direction:    models.TrafficDirectionEgress,
			},
			wantVerdict: "DENIED",
			wantChanged: true,
		},
		{
			name: "api to database on wrong port - should deny",
			event: models.TelemetryEvent{
				SrcNamespace: "default",
				SrcPodName:   "api-pod",
				SrcPodLabels: map[string]string{"app": "api"},
				DstNamespace: "default",
				DstPodName:   "database-pod",
				DstPodLabels: map[string]string{"app": "database"},
				DstPort:      3306,
				Protocol:     "TCP",
				Verdict:      models.VerdictAllowed,
				Direction:    models.TrafficDirectionEgress,
			},
			wantVerdict: "DENIED",
			wantChanged: true,
		},
		{
			name: "non-matching source pod - policy doesn't apply",
			event: models.TelemetryEvent{
				SrcNamespace: "default",
				SrcPodName:   "frontend-pod",
				SrcPodLabels: map[string]string{"app": "frontend"},
				DstNamespace: "default",
				DstPodName:   "database-pod",
				DstPodLabels: map[string]string{"app": "database"},
				DstPort:      5432,
				Protocol:     "TCP",
				Verdict:      models.VerdictAllowed,
				Direction:    models.TrafficDirectionEgress,
			},
			wantVerdict: "ALLOWED", // Policy doesn't apply, use original verdict
			wantChanged: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := engine.evaluateFlow(&tt.event, policy)

			if result.SimulatedVerdict != tt.wantVerdict {
				t.Errorf("evaluateFlow() verdict = %v, want %v (reason: %s)",
					result.SimulatedVerdict, tt.wantVerdict, result.MatchReason)
			}
			if result.VerdictChanged != tt.wantChanged {
				t.Errorf("evaluateFlow() changed = %v, want %v",
					result.VerdictChanged, tt.wantChanged)
			}
		})
	}
}

func TestEngine_EvaluateFlow_L7Rules(t *testing.T) {
	engine := &Engine{
		parser: NewPolicyParser(),
		log:    logr.Discard(),
	}

	policy := &ParsedPolicy{
		Name:        "l7-policy",
		PodSelector: map[string]string{},
		IngressRules: []PolicyRule{
			{
				Direction: "ingress",
				Action:    "allow",
				ToPorts: []PortRule{
					{Port: 8080, Protocol: "TCP"},
				},
				L7Rules: []L7Rule{
					{Type: "http", Method: "GET", Path: "/api/"},
					{Type: "http", Method: "POST", Path: "/api/users"},
				},
			},
		},
		DefaultDeny:     true,
		DefaultDenyType: "ingress",
	}

	tests := []struct {
		name        string
		event       models.TelemetryEvent
		wantVerdict string
	}{
		{
			name: "matching GET /api/health",
			event: models.TelemetryEvent{
				DstPort:    8080,
				Protocol:   "TCP",
				L7Type:     "HTTP",
				HTTPMethod: "GET",
				HTTPPath:   "/api/health",
				Verdict:    models.VerdictAllowed,
				Direction:  models.TrafficDirectionIngress,
			},
			wantVerdict: "ALLOWED",
		},
		{
			name: "matching POST /api/users",
			event: models.TelemetryEvent{
				DstPort:    8080,
				Protocol:   "TCP",
				L7Type:     "HTTP",
				HTTPMethod: "POST",
				HTTPPath:   "/api/users",
				Verdict:    models.VerdictAllowed,
				Direction:  models.TrafficDirectionIngress,
			},
			wantVerdict: "ALLOWED",
		},
		{
			name: "non-matching DELETE method",
			event: models.TelemetryEvent{
				DstPort:    8080,
				Protocol:   "TCP",
				L7Type:     "HTTP",
				HTTPMethod: "DELETE",
				HTTPPath:   "/api/users",
				Verdict:    models.VerdictAllowed,
				Direction:  models.TrafficDirectionIngress,
			},
			wantVerdict: "DENIED",
		},
		{
			name: "non-matching path",
			event: models.TelemetryEvent{
				DstPort:    8080,
				Protocol:   "TCP",
				L7Type:     "HTTP",
				HTTPMethod: "GET",
				HTTPPath:   "/admin/",
				Verdict:    models.VerdictAllowed,
				Direction:  models.TrafficDirectionIngress,
			},
			wantVerdict: "DENIED",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := engine.evaluateFlow(&tt.event, policy)

			if result.SimulatedVerdict != tt.wantVerdict {
				t.Errorf("evaluateFlow() verdict = %v, want %v (reason: %s)",
					result.SimulatedVerdict, tt.wantVerdict, result.MatchReason)
			}
		})
	}
}

func TestEngine_PortMatches(t *testing.T) {
	engine := &Engine{}

	tests := []struct {
		name  string
		event models.TelemetryEvent
		rule  PortRule
		want  bool
	}{
		{
			name:  "exact port match",
			event: models.TelemetryEvent{DstPort: 8080, Protocol: "TCP"},
			rule:  PortRule{Port: 8080, Protocol: "TCP"},
			want:  true,
		},
		{
			name:  "port mismatch",
			event: models.TelemetryEvent{DstPort: 9090, Protocol: "TCP"},
			rule:  PortRule{Port: 8080, Protocol: "TCP"},
			want:  false,
		},
		{
			name:  "protocol mismatch",
			event: models.TelemetryEvent{DstPort: 8080, Protocol: "UDP"},
			rule:  PortRule{Port: 8080, Protocol: "TCP"},
			want:  false,
		},
		{
			name:  "port range match",
			event: models.TelemetryEvent{DstPort: 8085, Protocol: "TCP"},
			rule:  PortRule{Port: 8080, EndPort: 8090, Protocol: "TCP"},
			want:  true,
		},
		{
			name:  "port range miss - too low",
			event: models.TelemetryEvent{DstPort: 8079, Protocol: "TCP"},
			rule:  PortRule{Port: 8080, EndPort: 8090, Protocol: "TCP"},
			want:  false,
		},
		{
			name:  "port range miss - too high",
			event: models.TelemetryEvent{DstPort: 8091, Protocol: "TCP"},
			rule:  PortRule{Port: 8080, EndPort: 8090, Protocol: "TCP"},
			want:  false,
		},
		{
			name:  "any port (rule.Port = 0)",
			event: models.TelemetryEvent{DstPort: 12345, Protocol: "TCP"},
			rule:  PortRule{Port: 0, Protocol: "TCP"},
			want:  true,
		},
		{
			name:  "case insensitive protocol",
			event: models.TelemetryEvent{DstPort: 8080, Protocol: "tcp"},
			rule:  PortRule{Port: 8080, Protocol: "TCP"},
			want:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := engine.portMatches(&tt.event, &tt.rule)
			if got != tt.want {
				t.Errorf("portMatches() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestEngine_L7Matches(t *testing.T) {
	engine := &Engine{}

	tests := []struct {
		name  string
		event models.TelemetryEvent
		rule  L7Rule
		want  bool
	}{
		{
			name: "HTTP method and path match",
			event: models.TelemetryEvent{
				L7Type:     "HTTP",
				HTTPMethod: "GET",
				HTTPPath:   "/api/users",
			},
			rule: L7Rule{Type: "http", Method: "GET", Path: "/api/"},
			want: true,
		},
		{
			name: "HTTP method mismatch",
			event: models.TelemetryEvent{
				L7Type:     "HTTP",
				HTTPMethod: "POST",
				HTTPPath:   "/api/users",
			},
			rule: L7Rule{Type: "http", Method: "GET", Path: "/api/"},
			want: false,
		},
		{
			name: "HTTP path mismatch",
			event: models.TelemetryEvent{
				L7Type:     "HTTP",
				HTTPMethod: "GET",
				HTTPPath:   "/admin/",
			},
			rule: L7Rule{Type: "http", Method: "GET", Path: "/api/"},
			want: false,
		},
		{
			name: "HTTP regex path match",
			event: models.TelemetryEvent{
				L7Type:     "HTTP",
				HTTPMethod: "GET",
				HTTPPath:   "/api/v1/users",
			},
			rule: L7Rule{Type: "http", Method: "GET", Path: "^/api/v[0-9]+/"},
			want: true,
		},
		{
			name: "DNS match",
			event: models.TelemetryEvent{
				L7Type:   "DNS",
				DNSQuery: "api.example.com",
			},
			rule: L7Rule{Type: "dns", Host: "*.example.com"},
			want: true,
		},
		{
			name: "DNS mismatch",
			event: models.TelemetryEvent{
				L7Type:   "DNS",
				DNSQuery: "api.other.com",
			},
			rule: L7Rule{Type: "dns", Host: "*.example.com"},
			want: false,
		},
		{
			name: "wrong L7 type",
			event: models.TelemetryEvent{
				L7Type:     "DNS",
				HTTPMethod: "GET",
			},
			rule: L7Rule{Type: "http", Method: "GET"},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := engine.l7Matches(&tt.event, &tt.rule)
			if got != tt.want {
				t.Errorf("l7Matches() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestEngine_UpdateVerdictBreakdown(t *testing.T) {
	engine := &Engine{}

	breakdown := &VerdictBreakdown{}

	testCases := []struct {
		original  string
		simulated string
	}{
		{"ALLOWED", "ALLOWED"},
		{"ALLOWED", "DENIED"},
		{"DENIED", "ALLOWED"},
		{"DENIED", "DENIED"},
		{"DROPPED", "ALLOWED"},
		{"DROPPED", "DENIED"},
	}

	for _, tc := range testCases {
		result := &FlowSimulationResult{
			OriginalVerdict:  tc.original,
			SimulatedVerdict: tc.simulated,
		}
		engine.updateVerdictBreakdown(breakdown, result)
	}

	if breakdown.AllowedToAllowed != 1 {
		t.Errorf("AllowedToAllowed = %d, want 1", breakdown.AllowedToAllowed)
	}
	if breakdown.AllowedToDenied != 1 {
		t.Errorf("AllowedToDenied = %d, want 1", breakdown.AllowedToDenied)
	}
	if breakdown.DeniedToAllowed != 1 {
		t.Errorf("DeniedToAllowed = %d, want 1", breakdown.DeniedToAllowed)
	}
	if breakdown.DeniedToDenied != 1 {
		t.Errorf("DeniedToDenied = %d, want 1", breakdown.DeniedToDenied)
	}
	if breakdown.DroppedToAllowed != 1 {
		t.Errorf("DroppedToAllowed = %d, want 1", breakdown.DroppedToAllowed)
	}
	if breakdown.DroppedToDenied != 1 {
		t.Errorf("DroppedToDenied = %d, want 1", breakdown.DroppedToDenied)
	}
}

func TestEngine_MatchesPodSelector(t *testing.T) {
	engine := &Engine{}

	tests := []struct {
		name   string
		event  models.TelemetryEvent
		policy ParsedPolicy
		want   bool
	}{
		{
			name: "empty selector matches all",
			event: models.TelemetryEvent{
				SrcNamespace: "default",
				SrcPodLabels: map[string]string{"app": "anything"},
			},
			policy: ParsedPolicy{
				PodSelector: map[string]string{},
			},
			want: true,
		},
		{
			name: "matching labels",
			event: models.TelemetryEvent{
				SrcNamespace: "default",
				SrcPodLabels: map[string]string{"app": "backend", "version": "v1"},
			},
			policy: ParsedPolicy{
				PodSelector: map[string]string{"app": "backend"},
			},
			want: true,
		},
		{
			name: "non-matching labels",
			event: models.TelemetryEvent{
				SrcNamespace: "default",
				SrcPodLabels: map[string]string{"app": "frontend"},
			},
			policy: ParsedPolicy{
				PodSelector: map[string]string{"app": "backend"},
			},
			want: false,
		},
		{
			name: "namespace mismatch",
			event: models.TelemetryEvent{
				SrcNamespace: "production",
				SrcPodLabels: map[string]string{"app": "backend"},
			},
			policy: ParsedPolicy{
				Namespace:   "default",
				PodSelector: map[string]string{"app": "backend"},
			},
			want: false,
		},
		{
			name: "nil labels",
			event: models.TelemetryEvent{
				SrcNamespace: "default",
				SrcPodLabels: nil,
			},
			policy: ParsedPolicy{
				PodSelector: map[string]string{"app": "backend"},
			},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := engine.matchesPodSelector(&tt.event, &tt.policy)
			if got != tt.want {
				t.Errorf("matchesPodSelector() = %v, want %v", got, tt.want)
			}
		})
	}
}
