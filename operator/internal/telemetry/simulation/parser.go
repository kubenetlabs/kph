package simulation

import (
	"fmt"
	"strconv"
	"strings"

	"sigs.k8s.io/yaml"
)

// PolicyParser parses policy YAML into structured rules.
type PolicyParser struct{}

// NewPolicyParser creates a new policy parser.
func NewPolicyParser() *PolicyParser {
	return &PolicyParser{}
}

// Parse parses a policy YAML string into a ParsedPolicy.
func (p *PolicyParser) Parse(content string, policyType string) (*ParsedPolicy, error) {
	switch policyType {
	case "CILIUM_NETWORK", "CILIUM_CLUSTERWIDE":
		return p.parseCiliumPolicy(content)
	case "TETRAGON":
		return p.parseTetragonPolicy(content)
	default:
		return nil, fmt.Errorf("unsupported policy type: %s", policyType)
	}
}

// parseCiliumPolicy parses a Cilium NetworkPolicy or CiliumNetworkPolicy.
func (p *PolicyParser) parseCiliumPolicy(content string) (*ParsedPolicy, error) {
	// Parse YAML into generic map
	var raw map[string]interface{}
	if err := yaml.Unmarshal([]byte(content), &raw); err != nil {
		return nil, fmt.Errorf("failed to parse YAML: %w", err)
	}

	policy := &ParsedPolicy{
		PodSelector:  make(map[string]string),
		IngressRules: []PolicyRule{},
		EgressRules:  []PolicyRule{},
	}

	// Extract metadata
	if metadata, ok := raw["metadata"].(map[string]interface{}); ok {
		if name, ok := metadata["name"].(string); ok {
			policy.Name = name
		}
		if ns, ok := metadata["namespace"].(string); ok {
			policy.Namespace = ns
		}
	}

	// Determine policy type from kind
	if kind, ok := raw["kind"].(string); ok {
		policy.Type = kind
	}

	// Extract spec
	spec, ok := raw["spec"].(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("missing spec in policy")
	}

	// Parse endpoint selector (pod selector)
	if endpointSelector, ok := spec["endpointSelector"].(map[string]interface{}); ok {
		if matchLabels, ok := endpointSelector["matchLabels"].(map[string]interface{}); ok {
			for k, v := range matchLabels {
				if vs, ok := v.(string); ok {
					policy.PodSelector[k] = vs
				}
			}
		}
	}

	// Parse ingress rules
	if ingress, ok := spec["ingress"].([]interface{}); ok {
		for _, rule := range ingress {
			if ruleMap, ok := rule.(map[string]interface{}); ok {
				parsed := p.parseCiliumRule(ruleMap, "ingress")
				policy.IngressRules = append(policy.IngressRules, parsed...)
			}
		}
	}

	// Parse egress rules
	if egress, ok := spec["egress"].([]interface{}); ok {
		for _, rule := range egress {
			if ruleMap, ok := rule.(map[string]interface{}); ok {
				parsed := p.parseCiliumRule(ruleMap, "egress")
				policy.EgressRules = append(policy.EgressRules, parsed...)
			}
		}
	}

	// Check for default deny
	// In Cilium, having ingress/egress sections implies default deny for that direction
	if len(policy.IngressRules) > 0 || spec["ingress"] != nil {
		policy.DefaultDeny = true
		policy.DefaultDenyType = "ingress"
	}
	if len(policy.EgressRules) > 0 || spec["egress"] != nil {
		policy.DefaultDeny = true
		if policy.DefaultDenyType == "ingress" {
			policy.DefaultDenyType = "both"
		} else {
			policy.DefaultDenyType = "egress"
		}
	}

	return policy, nil
}

// parseCiliumRule parses a single Cilium ingress/egress rule.
func (p *PolicyParser) parseCiliumRule(rule map[string]interface{}, direction string) []PolicyRule {
	var rules []PolicyRule

	baseRule := PolicyRule{
		Direction: direction,
		Action:    "allow", // Cilium policies are allow rules
	}

	// Parse fromEndpoints/toEndpoints
	endpointKey := "fromEndpoints"
	if direction == "egress" {
		endpointKey = "toEndpoints"
	}

	if endpoints, ok := rule[endpointKey].([]interface{}); ok {
		for _, ep := range endpoints {
			if epMap, ok := ep.(map[string]interface{}); ok {
				r := baseRule
				r.PodSelector = make(map[string]string)
				r.NamespaceSelector = make(map[string]string)

				if matchLabels, ok := epMap["matchLabels"].(map[string]interface{}); ok {
					for k, v := range matchLabels {
						if vs, ok := v.(string); ok {
							// Cilium uses k8s: prefix for namespace labels
							if strings.HasPrefix(k, "k8s:io.kubernetes.pod.namespace") {
								r.NamespaceSelector["name"] = vs
							} else {
								r.PodSelector[k] = vs
							}
						}
					}
				}
				rules = append(rules, r)
			}
		}
	}

	// Parse toPorts
	if toPorts, ok := rule["toPorts"].([]interface{}); ok {
		for _, tp := range toPorts {
			if tpMap, ok := tp.(map[string]interface{}); ok {
				if ports, ok := tpMap["ports"].([]interface{}); ok {
					for _, port := range ports {
						if portMap, ok := port.(map[string]interface{}); ok {
							pr := PortRule{
								Protocol: "TCP", // default
							}
							if portVal, ok := portMap["port"].(string); ok {
								if p, err := strconv.ParseUint(portVal, 10, 32); err == nil {
									pr.Port = uint32(p)
								}
							}
							if proto, ok := portMap["protocol"].(string); ok {
								pr.Protocol = strings.ToUpper(proto)
							}

							// Add port rule to all existing rules or create new one
							if len(rules) == 0 {
								r := baseRule
								r.ToPorts = []PortRule{pr}
								rules = append(rules, r)
							} else {
								for i := range rules {
									rules[i].ToPorts = append(rules[i].ToPorts, pr)
								}
							}
						}
					}
				}

				// Parse L7 rules
				if l7Rules, ok := tpMap["rules"].(map[string]interface{}); ok {
					l7Parsed := p.parseL7Rules(l7Rules)
					if len(rules) == 0 {
						r := baseRule
						r.L7Rules = l7Parsed
						rules = append(rules, r)
					} else {
						for i := range rules {
							rules[i].L7Rules = append(rules[i].L7Rules, l7Parsed...)
						}
					}
				}
			}
		}
	}

	// Parse toCIDR/fromCIDR
	cidrKey := "fromCIDR"
	if direction == "egress" {
		cidrKey = "toCIDR"
	}
	if cidrs, ok := rule[cidrKey].([]interface{}); ok {
		var cidrList []string
		for _, cidr := range cidrs {
			if cidrStr, ok := cidr.(string); ok {
				cidrList = append(cidrList, cidrStr)
			}
		}
		if len(cidrList) > 0 {
			if len(rules) == 0 {
				r := baseRule
				if direction == "egress" {
					r.ToCIDRs = cidrList
				} else {
					r.FromCIDRs = cidrList
				}
				rules = append(rules, r)
			} else {
				for i := range rules {
					if direction == "egress" {
						rules[i].ToCIDRs = append(rules[i].ToCIDRs, cidrList...)
					} else {
						rules[i].FromCIDRs = append(rules[i].FromCIDRs, cidrList...)
					}
				}
			}
		}
	}

	// Parse toFQDNs
	if fqdns, ok := rule["toFQDNs"].([]interface{}); ok {
		var fqdnList []string
		for _, fqdn := range fqdns {
			if fqdnMap, ok := fqdn.(map[string]interface{}); ok {
				if pattern, ok := fqdnMap["matchPattern"].(string); ok {
					fqdnList = append(fqdnList, pattern)
				}
				if name, ok := fqdnMap["matchName"].(string); ok {
					fqdnList = append(fqdnList, name)
				}
			}
		}
		if len(fqdnList) > 0 {
			if len(rules) == 0 {
				r := baseRule
				r.ToFQDNs = fqdnList
				rules = append(rules, r)
			} else {
				for i := range rules {
					rules[i].ToFQDNs = append(rules[i].ToFQDNs, fqdnList...)
				}
			}
		}
	}

	// If no specific rules were parsed, add the base rule (allows all matching traffic)
	if len(rules) == 0 {
		rules = append(rules, baseRule)
	}

	return rules
}

// parseL7Rules parses L7-specific rules.
func (p *PolicyParser) parseL7Rules(rules map[string]interface{}) []L7Rule {
	var l7Rules []L7Rule

	// HTTP rules
	if httpRules, ok := rules["http"].([]interface{}); ok {
		for _, hr := range httpRules {
			if hrMap, ok := hr.(map[string]interface{}); ok {
				l7 := L7Rule{Type: "http"}
				if method, ok := hrMap["method"].(string); ok {
					l7.Method = method
				}
				if path, ok := hrMap["path"].(string); ok {
					l7.Path = path
				}
				if host, ok := hrMap["host"].(string); ok {
					l7.Host = host
				}
				l7Rules = append(l7Rules, l7)
			}
		}
	}

	// DNS rules
	if dnsRules, ok := rules["dns"].([]interface{}); ok {
		for _, dr := range dnsRules {
			if drMap, ok := dr.(map[string]interface{}); ok {
				l7 := L7Rule{Type: "dns"}
				if pattern, ok := drMap["matchPattern"].(string); ok {
					l7.Host = pattern
				}
				if name, ok := drMap["matchName"].(string); ok {
					l7.Host = name
				}
				l7Rules = append(l7Rules, l7)
			}
		}
	}

	return l7Rules
}

// parseTetragonPolicy parses a Tetragon TracingPolicy.
func (p *PolicyParser) parseTetragonPolicy(content string) (*ParsedPolicy, error) {
	// For now, return a basic parsed policy for Tetragon
	// Tetragon policies are about process/syscall tracing, not network
	var raw map[string]interface{}
	if err := yaml.Unmarshal([]byte(content), &raw); err != nil {
		return nil, fmt.Errorf("failed to parse YAML: %w", err)
	}

	policy := &ParsedPolicy{
		PodSelector: make(map[string]string),
	}

	if metadata, ok := raw["metadata"].(map[string]interface{}); ok {
		if name, ok := metadata["name"].(string); ok {
			policy.Name = name
		}
	}

	if kind, ok := raw["kind"].(string); ok {
		policy.Type = kind
	}

	return policy, nil
}
