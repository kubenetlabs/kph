package validation

import (
	"context"
	"strings"
	"sync"

	"github.com/go-logr/logr"
	ciliumv2 "github.com/cilium/cilium/pkg/k8s/apis/cilium.io/v2"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/yaml"

	"github.com/policy-hub/operator/internal/telemetry/models"
	"github.com/policy-hub/operator/internal/telemetry/simulation"
)

// PolicyMatcher matches flows against CiliumNetworkPolicies
type PolicyMatcher struct {
	client       client.Client
	parser       *simulation.PolicyParser
	log          logr.Logger
	policies     []*ParsedPolicyCache
	policiesMu   sync.RWMutex
	lastRefresh  int64
	refreshInterval int64 // seconds
}

// ParsedPolicyCache holds a parsed policy with metadata
type ParsedPolicyCache struct {
	Name      string
	Namespace string
	Parsed    *simulation.ParsedPolicy
}

// NewPolicyMatcher creates a new policy matcher
func NewPolicyMatcher(c client.Client, log logr.Logger) *PolicyMatcher {
	return &PolicyMatcher{
		client:          c,
		parser:          simulation.NewPolicyParser(),
		log:             log.WithName("policy-matcher"),
		policies:        make([]*ParsedPolicyCache, 0),
		refreshInterval: 30, // Refresh policies every 30 seconds
	}
}

// RefreshPolicies fetches and parses all CiliumNetworkPolicies from the cluster
func (m *PolicyMatcher) RefreshPolicies(ctx context.Context) error {
	m.log.V(1).Info("Refreshing policies from cluster")

	// Fetch CiliumNetworkPolicies
	var cnpList ciliumv2.CiliumNetworkPolicyList
	if err := m.client.List(ctx, &cnpList); err != nil {
		m.log.Error(err, "Failed to list CiliumNetworkPolicies")
		return err
	}

	// Fetch CiliumClusterwideNetworkPolicies
	var ccnpList ciliumv2.CiliumClusterwideNetworkPolicyList
	if err := m.client.List(ctx, &ccnpList); err != nil {
		m.log.V(1).Info("Failed to list CiliumClusterwideNetworkPolicies (may not exist)", "error", err)
		// Continue without clusterwide policies
	}

	var parsedPolicies []*ParsedPolicyCache

	// Parse CNPs by converting to YAML and using the simulation parser
	for i := range cnpList.Items {
		cnp := &cnpList.Items[i]
		parsed, err := m.parseCNP(cnp)
		if err != nil {
			m.log.V(1).Info("Failed to parse CNP", "name", cnp.Name, "namespace", cnp.Namespace, "error", err)
			continue
		}
		parsedPolicies = append(parsedPolicies, &ParsedPolicyCache{
			Name:      cnp.Name,
			Namespace: cnp.Namespace,
			Parsed:    parsed,
		})
	}

	// Parse CCNPs
	for i := range ccnpList.Items {
		ccnp := &ccnpList.Items[i]
		parsed, err := m.parseCCNP(ccnp)
		if err != nil {
			m.log.V(1).Info("Failed to parse CCNP", "name", ccnp.Name, "error", err)
			continue
		}
		parsedPolicies = append(parsedPolicies, &ParsedPolicyCache{
			Name:      ccnp.Name,
			Namespace: "", // Clusterwide
			Parsed:    parsed,
		})
	}

	m.policiesMu.Lock()
	m.policies = parsedPolicies
	m.policiesMu.Unlock()

	m.log.Info("Policies refreshed", "count", len(parsedPolicies))

	// Debug: log parsed policies
	for _, pc := range parsedPolicies {
		m.log.Info("DEBUG: Parsed policy",
			"name", pc.Name,
			"namespace", pc.Namespace,
			"policyNamespace", pc.Parsed.Namespace,
			"podSelector", pc.Parsed.PodSelector,
			"ingressRules", len(pc.Parsed.IngressRules),
			"egressRules", len(pc.Parsed.EgressRules),
			"defaultDenyType", pc.Parsed.DefaultDenyType,
		)
	}

	return nil
}

// parseCNP parses a CiliumNetworkPolicy by converting it to YAML
func (m *PolicyMatcher) parseCNP(cnp *ciliumv2.CiliumNetworkPolicy) (*simulation.ParsedPolicy, error) {
	// Convert to YAML
	yamlBytes, err := yaml.Marshal(cnp)
	if err != nil {
		return nil, err
	}

	// Use the simulation parser which handles all the complexity
	return m.parser.Parse(string(yamlBytes), "CILIUM_NETWORK")
}

// parseCCNP parses a CiliumClusterwideNetworkPolicy
func (m *PolicyMatcher) parseCCNP(ccnp *ciliumv2.CiliumClusterwideNetworkPolicy) (*simulation.ParsedPolicy, error) {
	// Convert to YAML
	yamlBytes, err := yaml.Marshal(ccnp)
	if err != nil {
		return nil, err
	}

	// Use the simulation parser
	return m.parser.Parse(string(yamlBytes), "CILIUM_CLUSTERWIDE")
}

// Match evaluates a flow against all policies and returns a validation result
func (m *PolicyMatcher) Match(event *models.TelemetryEvent) *ValidationResult {
	result := &ValidationResult{
		Timestamp:    event.Timestamp,
		SrcNamespace: event.SrcNamespace,
		SrcPodName:   event.SrcPodName,
		SrcLabels:    event.SrcPodLabels,
		DstNamespace: event.DstNamespace,
		DstPodName:   event.DstPodName,
		DstLabels:    event.DstPodLabels,
		DstPort:      event.DstPort,
		Protocol:     event.Protocol,
	}

	m.policiesMu.RLock()
	policies := m.policies
	m.policiesMu.RUnlock()

	// Debug: log flows to deathstar
	if event.DstNamespace == "default" && (containsLabel(event.DstPodLabels, "class", "deathstar") || containsLabel(event.DstPodLabels, "org", "empire")) {
		m.log.Info("DEBUG: Flow to deathstar detected",
			"srcNs", event.SrcNamespace,
			"srcPod", event.SrcPodName,
			"srcLabels", event.SrcPodLabels,
			"dstNs", event.DstNamespace,
			"dstPod", event.DstPodName,
			"dstLabels", event.DstPodLabels,
			"dstPort", event.DstPort,
			"policyCount", len(policies),
		)
	}

	// Find policies that apply to this flow
	var applicablePolicy *ParsedPolicyCache
	var matchedRule bool

	for _, pc := range policies {
		policy := pc.Parsed

		// Check if policy applies to destination (for ingress rules)
		if len(policy.IngressRules) > 0 || policy.DefaultDenyType == "ingress" || policy.DefaultDenyType == "both" {
			matches := m.matchesEndpointSelector(event.DstNamespace, event.DstPodLabels, policy)
			// Debug: log for deathstar flows
			if containsLabel(event.DstPodLabels, "class", "deathstar") {
				m.log.Info("DEBUG: Endpoint selector check for deathstar",
					"policyName", pc.Name,
					"dstNs", event.DstNamespace,
					"dstLabels", event.DstPodLabels,
					"policyNs", policy.Namespace,
					"policySelector", policy.PodSelector,
					"matches", matches,
				)
			}
			if matches {
				applicablePolicy = pc
				// Check if any ingress rule allows the source
				for _, rule := range policy.IngressRules {
					if m.flowMatchesIngressRule(event, &rule) {
						result.Verdict = VerdictAllowed
						result.MatchedPolicy = pc.Name
						result.Reason = "Matched ingress allow rule"
						matchedRule = true
						break
					}
				}
				if !matchedRule && applicablePolicy != nil {
					// Policy applies but no rule matched = blocked
					result.Verdict = VerdictBlocked
					result.MatchedPolicy = pc.Name
					result.Reason = "No matching ingress rule, default deny"
					return result
				}
				if matchedRule {
					return result
				}
			}
		}

		// Check if policy applies to source (for egress rules)
		if len(policy.EgressRules) > 0 || policy.DefaultDenyType == "egress" || policy.DefaultDenyType == "both" {
			if m.matchesEndpointSelector(event.SrcNamespace, event.SrcPodLabels, policy) {
				applicablePolicy = pc
				// Check if any egress rule allows the destination
				for _, rule := range policy.EgressRules {
					if m.flowMatchesEgressRule(event, &rule) {
						result.Verdict = VerdictAllowed
						result.MatchedPolicy = pc.Name
						result.Reason = "Matched egress allow rule"
						matchedRule = true
						break
					}
				}
				if !matchedRule && applicablePolicy != nil {
					result.Verdict = VerdictBlocked
					result.MatchedPolicy = pc.Name
					result.Reason = "No matching egress rule, default deny"
					return result
				}
				if matchedRule {
					return result
				}
			}
		}
	}

	// No policy governs this flow
	result.Verdict = VerdictNoPolicy
	result.Reason = "No policy governs this flow"
	return result
}

// matchesEndpointSelector checks if a pod matches the policy's endpoint selector
func (m *PolicyMatcher) matchesEndpointSelector(namespace string, labels map[string]string, policy *simulation.ParsedPolicy) bool {
	// Check namespace match for namespaced policies
	if policy.Namespace != "" && namespace != policy.Namespace {
		return false
	}

	// Empty selector matches all pods
	if len(policy.PodSelector) == 0 {
		return true
	}

	// Check labels match
	return labelsMatch(labels, policy.PodSelector)
}

// flowMatchesIngressRule checks if a flow matches an ingress rule (source matches rule)
func (m *PolicyMatcher) flowMatchesIngressRule(event *models.TelemetryEvent, rule *simulation.PolicyRule) bool {
	// Check source labels
	if len(rule.PodSelector) > 0 {
		if !labelsMatch(event.SrcPodLabels, rule.PodSelector) {
			return false
		}
	}

	// Check source namespace
	if len(rule.NamespaceSelector) > 0 {
		if nsName, ok := rule.NamespaceSelector["name"]; ok {
			if event.SrcNamespace != nsName {
				return false
			}
		}
	}

	// Check ports
	if len(rule.ToPorts) > 0 {
		portMatched := false
		for _, pr := range rule.ToPorts {
			if m.portMatches(event, &pr) {
				portMatched = true
				break
			}
		}
		if !portMatched {
			return false
		}
	}

	return true
}

// flowMatchesEgressRule checks if a flow matches an egress rule (destination matches rule)
func (m *PolicyMatcher) flowMatchesEgressRule(event *models.TelemetryEvent, rule *simulation.PolicyRule) bool {
	// Check destination labels
	if len(rule.PodSelector) > 0 {
		if !labelsMatch(event.DstPodLabels, rule.PodSelector) {
			return false
		}
	}

	// Check destination namespace
	if len(rule.NamespaceSelector) > 0 {
		if nsName, ok := rule.NamespaceSelector["name"]; ok {
			if event.DstNamespace != nsName {
				return false
			}
		}
	}

	// Check ports
	if len(rule.ToPorts) > 0 {
		portMatched := false
		for _, pr := range rule.ToPorts {
			if m.portMatches(event, &pr) {
				portMatched = true
				break
			}
		}
		if !portMatched {
			return false
		}
	}

	return true
}

// portMatches checks if a flow matches a port rule
func (m *PolicyMatcher) portMatches(event *models.TelemetryEvent, rule *simulation.PortRule) bool {
	// Check protocol
	if rule.Protocol != "" && event.Protocol != rule.Protocol {
		return false
	}

	// Check port
	if rule.Port > 0 {
		if rule.EndPort > 0 {
			// Port range
			if event.DstPort < rule.Port || event.DstPort > rule.EndPort {
				return false
			}
		} else {
			// Single port
			if event.DstPort != rule.Port {
				return false
			}
		}
	}

	return true
}

// labelsMatch checks if a label map contains all required key-value pairs
func labelsMatch(labels map[string]string, required map[string]string) bool {
	if labels == nil && len(required) > 0 {
		return false
	}
	for key, reqValue := range required {
		// Strip Cilium label prefixes from required keys (any:, k8s:, etc.)
		cleanKey := stripLabelPrefix(key)
		value, ok := getLabelValue(labels, cleanKey)
		if !ok || value != reqValue {
			return false
		}
	}
	return true
}

// stripLabelPrefix removes Cilium label prefixes like any:, k8s:, reserved:
func stripLabelPrefix(key string) string {
	prefixes := []string{"any:", "k8s:", "reserved:", "container:"}
	for _, prefix := range prefixes {
		if strings.HasPrefix(key, prefix) {
			return strings.TrimPrefix(key, prefix)
		}
	}
	return key
}

// getLabelValue retrieves a label value, handling k8s: prefix
func getLabelValue(labels map[string]string, key string) (string, bool) {
	if value, ok := labels[key]; ok {
		return value, true
	}
	if value, ok := labels["k8s:"+key]; ok {
		return value, true
	}
	return "", false
}

// containsLabel checks if labels contain a specific key-value pair
func containsLabel(labels map[string]string, key, value string) bool {
	if labels == nil {
		return false
	}
	if v, ok := labels[key]; ok && v == value {
		return true
	}
	if v, ok := labels["k8s:"+key]; ok && v == value {
		return true
	}
	return false
}
