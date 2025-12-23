package simulation

import (
	"testing"
)

func TestPolicyParser_ParseCiliumNetworkPolicy(t *testing.T) {
	parser := NewPolicyParser()

	tests := []struct {
		name           string
		content        string
		policyType     string
		wantName       string
		wantNamespace  string
		wantIngress    int
		wantEgress     int
		wantDefaultDeny bool
		wantErr        bool
	}{
		{
			name: "basic ingress policy",
			content: `
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: allow-frontend
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
`,
			policyType:     "CILIUM_NETWORK",
			wantName:       "allow-frontend",
			wantNamespace:  "default",
			wantIngress:    1,
			wantEgress:     0,
			wantDefaultDeny: true,
			wantErr:        false,
		},
		{
			name: "egress policy with FQDN",
			content: `
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: allow-external
  namespace: production
spec:
  endpointSelector:
    matchLabels:
      app: api
  egress:
    - toFQDNs:
        - matchPattern: "*.googleapis.com"
      toPorts:
        - ports:
            - port: "443"
              protocol: TCP
`,
			policyType:     "CILIUM_NETWORK",
			wantName:       "allow-external",
			wantNamespace:  "production",
			wantIngress:    0,
			wantEgress:     1,
			wantDefaultDeny: true,
			wantErr:        false,
		},
		{
			name: "policy with L7 HTTP rules",
			content: `
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: l7-policy
  namespace: default
spec:
  endpointSelector:
    matchLabels:
      app: api
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: web
      toPorts:
        - ports:
            - port: "8080"
          rules:
            http:
              - method: GET
                path: /api/v1/.*
              - method: POST
                path: /api/v1/users
`,
			policyType:     "CILIUM_NETWORK",
			wantName:       "l7-policy",
			wantNamespace:  "default",
			wantIngress:    1,
			wantEgress:     0,
			wantDefaultDeny: true,
			wantErr:        false,
		},
		{
			name: "ingress and egress policy",
			content: `
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: full-policy
  namespace: default
spec:
  endpointSelector:
    matchLabels:
      app: service
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: client
  egress:
    - toEndpoints:
        - matchLabels:
            app: database
`,
			policyType:     "CILIUM_NETWORK",
			wantName:       "full-policy",
			wantNamespace:  "default",
			wantIngress:    1,
			wantEgress:     1,
			wantDefaultDeny: true,
			wantErr:        false,
		},
		{
			name:       "invalid YAML",
			content:    "not: valid: yaml: content",
			policyType: "CILIUM_NETWORK",
			wantErr:    true,
		},
		{
			name:       "unsupported policy type",
			content:    "apiVersion: v1\nkind: ConfigMap",
			policyType: "UNSUPPORTED",
			wantErr:    true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			policy, err := parser.Parse(tt.content, tt.policyType)

			if tt.wantErr {
				if err == nil {
					t.Errorf("Parse() expected error, got nil")
				}
				return
			}

			if err != nil {
				t.Errorf("Parse() unexpected error: %v", err)
				return
			}

			if policy.Name != tt.wantName {
				t.Errorf("Parse() name = %v, want %v", policy.Name, tt.wantName)
			}
			if policy.Namespace != tt.wantNamespace {
				t.Errorf("Parse() namespace = %v, want %v", policy.Namespace, tt.wantNamespace)
			}
			if len(policy.IngressRules) != tt.wantIngress {
				t.Errorf("Parse() ingress rules = %v, want %v", len(policy.IngressRules), tt.wantIngress)
			}
			if len(policy.EgressRules) != tt.wantEgress {
				t.Errorf("Parse() egress rules = %v, want %v", len(policy.EgressRules), tt.wantEgress)
			}
			if policy.DefaultDeny != tt.wantDefaultDeny {
				t.Errorf("Parse() defaultDeny = %v, want %v", policy.DefaultDeny, tt.wantDefaultDeny)
			}
		})
	}
}

func TestPolicyParser_ParsePortRules(t *testing.T) {
	parser := NewPolicyParser()

	content := `
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: port-test
spec:
  endpointSelector:
    matchLabels:
      app: test
  ingress:
    - toPorts:
        - ports:
            - port: "80"
              protocol: TCP
            - port: "443"
              protocol: TCP
`

	policy, err := parser.Parse(content, "CILIUM_NETWORK")
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}

	if len(policy.IngressRules) != 1 {
		t.Fatalf("Expected 1 ingress rule, got %d", len(policy.IngressRules))
	}

	rule := policy.IngressRules[0]
	if len(rule.ToPorts) != 2 {
		t.Errorf("Expected 2 port rules, got %d", len(rule.ToPorts))
	}

	// Check first port
	if rule.ToPorts[0].Port != 80 {
		t.Errorf("Expected port 80, got %d", rule.ToPorts[0].Port)
	}
	if rule.ToPorts[0].Protocol != "TCP" {
		t.Errorf("Expected protocol TCP, got %s", rule.ToPorts[0].Protocol)
	}

	// Check second port
	if rule.ToPorts[1].Port != 443 {
		t.Errorf("Expected port 443, got %d", rule.ToPorts[1].Port)
	}
}

func TestPolicyParser_ParseL7Rules(t *testing.T) {
	parser := NewPolicyParser()

	content := `
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: l7-test
spec:
  endpointSelector:
    matchLabels:
      app: api
  ingress:
    - toPorts:
        - ports:
            - port: "8080"
          rules:
            http:
              - method: GET
                path: /health
              - method: POST
                path: /api/.*
            dns:
              - matchPattern: "*.example.com"
`

	policy, err := parser.Parse(content, "CILIUM_NETWORK")
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}

	if len(policy.IngressRules) != 1 {
		t.Fatalf("Expected 1 ingress rule, got %d", len(policy.IngressRules))
	}

	rule := policy.IngressRules[0]
	if len(rule.L7Rules) != 3 {
		t.Errorf("Expected 3 L7 rules (2 HTTP + 1 DNS), got %d", len(rule.L7Rules))
	}

	// Check HTTP rules
	httpCount := 0
	dnsCount := 0
	for _, l7 := range rule.L7Rules {
		if l7.Type == "http" {
			httpCount++
		}
		if l7.Type == "dns" {
			dnsCount++
		}
	}

	if httpCount != 2 {
		t.Errorf("Expected 2 HTTP rules, got %d", httpCount)
	}
	if dnsCount != 1 {
		t.Errorf("Expected 1 DNS rule, got %d", dnsCount)
	}
}

func TestPolicyParser_ParseTetragonPolicy(t *testing.T) {
	parser := NewPolicyParser()

	content := `
apiVersion: cilium.io/v1alpha1
kind: TracingPolicy
metadata:
  name: monitor-exec
spec:
  kprobes:
    - call: sys_execve
`

	policy, err := parser.Parse(content, "TETRAGON")
	if err != nil {
		t.Fatalf("Parse() error: %v", err)
	}

	if policy.Name != "monitor-exec" {
		t.Errorf("Expected name 'monitor-exec', got %s", policy.Name)
	}
	if policy.Type != "TracingPolicy" {
		t.Errorf("Expected type 'TracingPolicy', got %s", policy.Type)
	}
}

func TestMatchFQDN(t *testing.T) {
	tests := []struct {
		hostname string
		pattern  string
		want     bool
	}{
		{"api.example.com", "api.example.com", true},
		{"api.example.com", "*.example.com", true},
		{"sub.api.example.com", "*.example.com", true},
		{"example.com", "*.example.com", false},
		{"api.other.com", "*.example.com", false},
		{"test.googleapis.com", "*.googleapis.com", true},
	}

	for _, tt := range tests {
		t.Run(tt.hostname+"_"+tt.pattern, func(t *testing.T) {
			got := matchFQDN(tt.hostname, tt.pattern)
			if got != tt.want {
				t.Errorf("matchFQDN(%s, %s) = %v, want %v", tt.hostname, tt.pattern, got, tt.want)
			}
		})
	}
}
