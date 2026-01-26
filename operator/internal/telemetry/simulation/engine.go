package simulation

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/go-logr/logr"

	"github.com/policy-hub/operator/internal/telemetry/models"
	"github.com/policy-hub/operator/internal/telemetry/storage"
)

// Engine evaluates policies against historical telemetry data.
type Engine struct {
	storageMgr *storage.Manager
	parser     *PolicyParser
	log        logr.Logger
}

// EngineConfig contains configuration for the simulation engine.
type EngineConfig struct {
	StorageManager *storage.Manager
	Logger         logr.Logger
}

// NewEngine creates a new simulation engine.
func NewEngine(cfg EngineConfig) *Engine {
	return &Engine{
		storageMgr: cfg.StorageManager,
		parser:     NewPolicyParser(),
		log:        cfg.Logger.WithName("simulation-engine"),
	}
}

// Simulate runs a policy simulation against historical data.
func (e *Engine) Simulate(ctx context.Context, req *SimulationRequest) (*SimulationResponse, error) {
	startTime := time.Now()

	e.log.Info("Starting policy simulation",
		"policyType", req.PolicyType,
		"startTime", req.StartTime,
		"endTime", req.EndTime,
		"namespaces", req.Namespaces,
	)

	// Parse the policy
	policy, err := e.parser.Parse(req.PolicyContent, req.PolicyType)
	if err != nil {
		return &SimulationResponse{
			Errors:         []string{err.Error()},
			SimulationTime: startTime,
			Duration:       time.Since(startTime),
		}, nil
	}

	// Query historical flows
	// NOTE: We don't filter by namespace at the storage level because:
	// 1. Historical data may have empty namespace fields (Hubble GetNamespace() limitation)
	// 2. The simulation engine evaluates each flow against the policy's endpointSelector
	// 3. Policy matching uses labels, which works even when namespace field is empty
	queryReq := models.QueryEventsRequest{
		StartTime:  req.StartTime,
		EndTime:    req.EndTime,
		Namespaces: nil, // Don't filter by namespace - let policy evaluation handle it
		EventTypes: []string{string(models.EventTypeFlow)},
		Limit:      0, // Get all matching events
	}

	e.log.Info("Querying storage for historical flows",
		"startTime", req.StartTime,
		"endTime", req.EndTime,
		"targetNamespaces", req.Namespaces, // Log target namespaces for debugging
	)

	result, err := e.storageMgr.Query(ctx, queryReq)
	if err != nil {
		e.log.Error(err, "Storage query failed")
		return &SimulationResponse{
			Errors:         []string{"Failed to query historical data: " + err.Error()},
			SimulationTime: startTime,
			Duration:       time.Since(startTime),
		}, nil
	}

	e.log.Info("Storage query completed", "eventCount", len(result.Events))

	// Initialize response
	response := &SimulationResponse{
		TotalFlowsAnalyzed:   int64(len(result.Events)),
		BreakdownByNamespace: make(map[string]*NamespaceImpact),
		BreakdownByVerdict:   &VerdictBreakdown{},
		Details:              []*FlowSimulationResult{},
		SimulationTime:       startTime,
	}

	// Evaluate each flow against the policy
	maxDetails := int(req.MaxDetails)
	if maxDetails == 0 {
		maxDetails = 100 // Default limit
	}

	for _, event := range result.Events {
		flowResult := e.evaluateFlow(&event, policy)

		// Update summary counts
		switch flowResult.SimulatedVerdict {
		case "ALLOWED":
			response.AllowedCount++
		case "DENIED":
			response.DeniedCount++
		}

		if flowResult.VerdictChanged {
			response.WouldChangeCount++
		} else {
			response.NoChangeCount++
		}

		// Update verdict breakdown
		e.updateVerdictBreakdown(response.BreakdownByVerdict, flowResult)

		// Update namespace breakdown
		e.updateNamespaceBreakdown(response.BreakdownByNamespace, &event, flowResult)

		// Add to details if requested and under limit
		if req.IncludeDetails && len(response.Details) < maxDetails {
			response.Details = append(response.Details, flowResult)
		}
	}

	response.Duration = time.Since(startTime)

	e.log.Info("Simulation complete",
		"totalFlows", response.TotalFlowsAnalyzed,
		"allowed", response.AllowedCount,
		"denied", response.DeniedCount,
		"wouldChange", response.WouldChangeCount,
		"duration", response.Duration,
	)

	return response, nil
}

// evaluateFlow evaluates a single flow against the policy.
func (e *Engine) evaluateFlow(event *models.TelemetryEvent, policy *ParsedPolicy) *FlowSimulationResult {
	result := &FlowSimulationResult{
		Timestamp:       event.Timestamp,
		SrcNamespace:    event.SrcNamespace,
		SrcPodName:      event.SrcPodName,
		DstNamespace:    event.DstNamespace,
		DstPodName:      event.DstPodName,
		DstPort:         event.DstPort,
		Protocol:        event.Protocol,
		L7Type:          event.L7Type,
		HTTPMethod:      event.HTTPMethod,
		HTTPPath:        event.HTTPPath,
		OriginalVerdict: string(event.Verdict),
	}

	// CiliumNetworkPolicy semantics:
	// - endpointSelector selects which pods the policy applies TO
	// - For ingress rules: the selected pods are the DESTINATION, rules filter SOURCE
	// - For egress rules: the selected pods are the SOURCE, rules filter DESTINATION
	//
	// We need to evaluate the flow against both ingress and egress rules:
	// - Ingress: if DST matches endpointSelector, check if SRC is allowed by ingress rules
	// - Egress: if SRC matches endpointSelector, check if DST is allowed by egress rules

	// Check ingress rules (policy applies to destination pod)
	if len(policy.IngressRules) > 0 || policy.DefaultDenyType == "ingress" || policy.DefaultDenyType == "both" {
		if e.matchesPodSelectorForDirection(event, policy, "ingress") {
			// Destination matches policy selector, evaluate ingress rules
			ingressResult := e.evaluateIngressRules(event, policy, result)
			if ingressResult != nil {
				return ingressResult
			}
		}
	}

	// Check egress rules (policy applies to source pod)
	if len(policy.EgressRules) > 0 || policy.DefaultDenyType == "egress" || policy.DefaultDenyType == "both" {
		if e.matchesPodSelectorForDirection(event, policy, "egress") {
			// Source matches policy selector, evaluate egress rules
			egressResult := e.evaluateEgressRules(event, policy, result)
			if egressResult != nil {
				return egressResult
			}
		}
	}

	// Policy doesn't apply to this flow
	result.SimulatedVerdict = result.OriginalVerdict
	result.MatchReason = "Policy does not apply to this flow"
	result.VerdictChanged = false
	return result
}

// evaluateIngressRules evaluates ingress rules where destination matches the policy selector.
func (e *Engine) evaluateIngressRules(event *models.TelemetryEvent, policy *ParsedPolicy, result *FlowSimulationResult) *FlowSimulationResult {
	rules := policy.IngressRules

	// If no ingress rules but default deny is enabled for ingress
	if len(rules) == 0 {
		if policy.DefaultDeny && (policy.DefaultDenyType == "ingress" || policy.DefaultDenyType == "both") {
			result.SimulatedVerdict = "DENIED"
			result.MatchReason = "Default deny ingress, no rules defined"
			result.VerdictChanged = result.SimulatedVerdict != result.OriginalVerdict
			return result
		}
		return nil // No ingress rules and no default deny
	}

	// Check if any ingress rule allows this flow
	for i, rule := range rules {
		if e.flowMatchesIngressRule(event, &rule) {
			if rule.Action == "allow" {
				result.SimulatedVerdict = "ALLOWED"
				result.MatchedRule = ruleDescription(i, &rule)
				result.MatchReason = "Matched ingress allow rule"
			} else {
				result.SimulatedVerdict = "DENIED"
				result.MatchedRule = ruleDescription(i, &rule)
				result.MatchReason = "Matched ingress deny rule"
			}
			result.VerdictChanged = result.SimulatedVerdict != result.OriginalVerdict
			return result
		}
	}

	// No ingress rule matched - apply default deny
	if policy.DefaultDeny {
		result.SimulatedVerdict = "DENIED"
		result.MatchReason = "No matching ingress rule, default deny"
		result.VerdictChanged = result.SimulatedVerdict != result.OriginalVerdict
		return result
	}

	return nil
}

// evaluateEgressRules evaluates egress rules where source matches the policy selector.
func (e *Engine) evaluateEgressRules(event *models.TelemetryEvent, policy *ParsedPolicy, result *FlowSimulationResult) *FlowSimulationResult {
	rules := policy.EgressRules

	// If no egress rules but default deny is enabled for egress
	if len(rules) == 0 {
		if policy.DefaultDeny && (policy.DefaultDenyType == "egress" || policy.DefaultDenyType == "both") {
			result.SimulatedVerdict = "DENIED"
			result.MatchReason = "Default deny egress, no rules defined"
			result.VerdictChanged = result.SimulatedVerdict != result.OriginalVerdict
			return result
		}
		return nil // No egress rules and no default deny
	}

	// Check if any egress rule allows this flow
	for i, rule := range rules {
		if e.flowMatchesEgressRule(event, &rule) {
			if rule.Action == "allow" {
				result.SimulatedVerdict = "ALLOWED"
				result.MatchedRule = ruleDescription(i, &rule)
				result.MatchReason = "Matched egress allow rule"
			} else {
				result.SimulatedVerdict = "DENIED"
				result.MatchedRule = ruleDescription(i, &rule)
				result.MatchReason = "Matched egress deny rule"
			}
			result.VerdictChanged = result.SimulatedVerdict != result.OriginalVerdict
			return result
		}
	}

	// No egress rule matched - apply default deny
	if policy.DefaultDeny {
		result.SimulatedVerdict = "DENIED"
		result.MatchReason = "No matching egress rule, default deny"
		result.VerdictChanged = result.SimulatedVerdict != result.OriginalVerdict
		return result
	}

	return nil
}

// matchesPodSelector checks if an event's source matches the policy's pod selector.
// This is a legacy method that checks source labels only.
// For proper direction-aware matching, use matchesPodSelectorForDirection.
func (e *Engine) matchesPodSelector(event *models.TelemetryEvent, policy *ParsedPolicy) bool {
	return e.matchesPodSelectorForDirection(event, policy, "egress")
}

// matchesPodSelectorForDirection checks if the appropriate pod matches the policy selector.
// For ingress: checks destination pod (policy applies to destination)
// For egress: checks source pod (policy applies to source)
func (e *Engine) matchesPodSelectorForDirection(event *models.TelemetryEvent, policy *ParsedPolicy, direction string) bool {
	var namespace string
	var labels map[string]string

	if direction == "ingress" {
		// For ingress rules, policy applies to destination pod
		namespace = event.DstNamespace
		labels = event.DstPodLabels
	} else {
		// For egress rules, policy applies to source pod
		namespace = event.SrcNamespace
		labels = event.SrcPodLabels
	}

	// Empty selector matches all pods
	if len(policy.PodSelector) == 0 {
		// But still need to match namespace if specified
		if policy.Namespace != "" && namespace != policy.Namespace {
			return false
		}
		return true
	}

	// Check if namespace matches (if policy is namespaced)
	if policy.Namespace != "" && namespace != policy.Namespace {
		return false
	}

	// Check pod labels using the labelsMatch helper that handles k8s: prefix
	return labelsMatch(labels, policy.PodSelector)
}

// flowMatchesIngressRule checks if a flow matches an ingress rule.
// For ingress rules, we check if the SOURCE pod/namespace matches the rule's fromEndpoints selector.
func (e *Engine) flowMatchesIngressRule(event *models.TelemetryEvent, rule *PolicyRule) bool {
	// Check fromEndpoints selector (matches source pod for ingress)
	// Use labelsMatch to handle both normalized and k8s:-prefixed labels
	if len(rule.PodSelector) > 0 {
		if !labelsMatch(event.SrcPodLabels, rule.PodSelector) {
			return false
		}
	}

	// Check namespace selector for source
	if len(rule.NamespaceSelector) > 0 {
		if nsName, ok := rule.NamespaceSelector["name"]; ok {
			if event.SrcNamespace != nsName {
				return false
			}
		}
	}

	// Check ports (destination ports for ingress)
	if len(rule.ToPorts) > 0 {
		portMatched := false
		for _, portRule := range rule.ToPorts {
			if e.portMatches(event, &portRule) {
				portMatched = true
				break
			}
		}
		if !portMatched {
			return false
		}
	}

	// Check L7 rules if present
	if len(rule.L7Rules) > 0 {
		l7Matched := false
		for _, l7Rule := range rule.L7Rules {
			if e.l7Matches(event, &l7Rule) {
				l7Matched = true
				break
			}
		}
		if !l7Matched {
			return false
		}
	}

	// Check fromCIDR rules
	if len(rule.FromCIDRs) > 0 {
		// For CIDR matching, we'd need to check if source IP is in the CIDR range
		// Simplified: skip for now
	}

	return true
}

// flowMatchesEgressRule checks if a flow matches an egress rule.
// For egress rules, we check if the DESTINATION pod/namespace matches the rule's toEndpoints selector.
func (e *Engine) flowMatchesEgressRule(event *models.TelemetryEvent, rule *PolicyRule) bool {
	// Check toEndpoints selector (matches destination pod for egress)
	// Use labelsMatch to handle both normalized and k8s:-prefixed labels
	if len(rule.PodSelector) > 0 {
		if !labelsMatch(event.DstPodLabels, rule.PodSelector) {
			return false
		}
	}

	// Check namespace selector for destination
	if len(rule.NamespaceSelector) > 0 {
		if nsName, ok := rule.NamespaceSelector["name"]; ok {
			if event.DstNamespace != nsName {
				return false
			}
		}
	}

	// Check ports (destination ports for egress)
	if len(rule.ToPorts) > 0 {
		portMatched := false
		for _, portRule := range rule.ToPorts {
			if e.portMatches(event, &portRule) {
				portMatched = true
				break
			}
		}
		if !portMatched {
			return false
		}
	}

	// Check L7 rules if present
	if len(rule.L7Rules) > 0 {
		l7Matched := false
		for _, l7Rule := range rule.L7Rules {
			if e.l7Matches(event, &l7Rule) {
				l7Matched = true
				break
			}
		}
		if !l7Matched {
			return false
		}
	}

	// Check toCIDR rules
	if len(rule.ToCIDRs) > 0 {
		// For CIDR matching, we'd need to check if dest IP is in the CIDR range
		// Simplified: skip for now
	}

	// Check FQDN rules
	if len(rule.ToFQDNs) > 0 {
		if event.DstDNSName == "" {
			return false
		}
		fqdnMatched := false
		for _, pattern := range rule.ToFQDNs {
			if matchFQDN(event.DstDNSName, pattern) {
				fqdnMatched = true
				break
			}
		}
		if !fqdnMatched {
			return false
		}
	}

	return true
}

// flowMatchesRule checks if a flow matches a specific rule.
func (e *Engine) flowMatchesRule(event *models.TelemetryEvent, rule *PolicyRule) bool {
	// Check endpoint selectors
	if len(rule.PodSelector) > 0 {
		targetLabels := event.DstPodLabels
		if rule.Direction == "ingress" {
			targetLabels = event.SrcPodLabels
		}
		if targetLabels == nil {
			return false
		}
		for key, value := range rule.PodSelector {
			if targetLabels[key] != value {
				return false
			}
		}
	}

	// Check namespace selector
	if len(rule.NamespaceSelector) > 0 {
		targetNS := event.DstNamespace
		if rule.Direction == "ingress" {
			targetNS = event.SrcNamespace
		}
		if nsName, ok := rule.NamespaceSelector["name"]; ok {
			if targetNS != nsName {
				return false
			}
		}
	}

	// Check ports
	if len(rule.ToPorts) > 0 {
		portMatched := false
		for _, portRule := range rule.ToPorts {
			if e.portMatches(event, &portRule) {
				portMatched = true
				break
			}
		}
		if !portMatched {
			return false
		}
	}

	// Check L7 rules if present
	if len(rule.L7Rules) > 0 {
		l7Matched := false
		for _, l7Rule := range rule.L7Rules {
			if e.l7Matches(event, &l7Rule) {
				l7Matched = true
				break
			}
		}
		if !l7Matched {
			return false
		}
	}

	// Check CIDR rules
	if len(rule.ToCIDRs) > 0 || len(rule.FromCIDRs) > 0 {
		// For CIDR matching, we'd need to check if the IP is in the CIDR range
		// For now, we'll skip detailed CIDR matching
	}

	// Check FQDN rules
	if len(rule.ToFQDNs) > 0 {
		if event.DstDNSName == "" {
			return false
		}
		fqdnMatched := false
		for _, pattern := range rule.ToFQDNs {
			if matchFQDN(event.DstDNSName, pattern) {
				fqdnMatched = true
				break
			}
		}
		if !fqdnMatched {
			return false
		}
	}

	return true
}

// portMatches checks if a flow matches a port rule.
func (e *Engine) portMatches(event *models.TelemetryEvent, rule *PortRule) bool {
	// Check protocol
	if rule.Protocol != "" && !strings.EqualFold(event.Protocol, rule.Protocol) {
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

// l7Matches checks if a flow matches an L7 rule.
func (e *Engine) l7Matches(event *models.TelemetryEvent, rule *L7Rule) bool {
	switch rule.Type {
	case "http":
		if event.L7Type != "HTTP" {
			return false
		}
		if rule.Method != "" && !strings.EqualFold(event.HTTPMethod, rule.Method) {
			return false
		}
		if rule.Path != "" {
			// Support regex matching for paths
			if strings.HasPrefix(rule.Path, "^") || strings.HasSuffix(rule.Path, "$") {
				matched, _ := regexp.MatchString(rule.Path, event.HTTPPath)
				if !matched {
					return false
				}
			} else if !strings.HasPrefix(event.HTTPPath, rule.Path) {
				return false
			}
		}
		if rule.Host != "" && event.HTTPHost != rule.Host {
			return false
		}
		return true

	case "dns":
		if event.L7Type != "DNS" {
			return false
		}
		if rule.Host != "" {
			return matchFQDN(event.DNSQuery, rule.Host)
		}
		return true

	default:
		return true
	}
}

// matchFQDN matches a hostname against an FQDN pattern.
func matchFQDN(hostname, pattern string) bool {
	// Handle wildcard patterns like *.example.com
	if strings.HasPrefix(pattern, "*") {
		suffix := pattern[1:]
		return strings.HasSuffix(hostname, suffix)
	}
	return hostname == pattern
}

// getLabelValue retrieves a label value from a map, handling Cilium's k8s: prefix.
// It tries both the bare key (e.g., "org") and the prefixed key (e.g., "k8s:org")
// to support both normalized labels and legacy data.
func getLabelValue(labels map[string]string, key string) (string, bool) {
	// Try the bare key first (normalized format)
	if value, ok := labels[key]; ok {
		return value, true
	}
	// Try with k8s: prefix (legacy format)
	if value, ok := labels["k8s:"+key]; ok {
		return value, true
	}
	return "", false
}

// labelsMatch checks if a label map contains all required key-value pairs.
// Handles both normalized labels and legacy Cilium-prefixed labels.
func labelsMatch(labels map[string]string, required map[string]string) bool {
	if labels == nil && len(required) > 0 {
		return false
	}
	for key, reqValue := range required {
		if value, ok := getLabelValue(labels, key); !ok || value != reqValue {
			return false
		}
	}
	return true
}

// ruleDescription creates a human-readable description of a rule.
func ruleDescription(index int, rule *PolicyRule) string {
	var parts []string
	parts = append(parts, rule.Direction)

	if len(rule.ToPorts) > 0 {
		for _, p := range rule.ToPorts {
			parts = append(parts, fmt.Sprintf("%s:%s/%d", strings.ToLower(rule.Direction), p.Protocol, p.Port))
		}
	}

	return strings.Join(parts, " ")
}

// updateVerdictBreakdown updates the verdict breakdown counters.
func (e *Engine) updateVerdictBreakdown(breakdown *VerdictBreakdown, result *FlowSimulationResult) {
	original := result.OriginalVerdict
	simulated := result.SimulatedVerdict

	switch {
	case original == "ALLOWED" && simulated == "ALLOWED":
		breakdown.AllowedToAllowed++
	case original == "ALLOWED" && simulated == "DENIED":
		breakdown.AllowedToDenied++
	case original == "DENIED" && simulated == "ALLOWED":
		breakdown.DeniedToAllowed++
	case original == "DENIED" && simulated == "DENIED":
		breakdown.DeniedToDenied++
	case original == "DROPPED" && simulated == "ALLOWED":
		breakdown.DroppedToAllowed++
	case original == "DROPPED" && simulated == "DENIED":
		breakdown.DroppedToDenied++
	}
}

// updateNamespaceBreakdown updates the per-namespace breakdown.
func (e *Engine) updateNamespaceBreakdown(breakdown map[string]*NamespaceImpact, event *models.TelemetryEvent, result *FlowSimulationResult) {
	ns := event.SrcNamespace
	if ns == "" {
		ns = "unknown"
	}

	impact, ok := breakdown[ns]
	if !ok {
		impact = &NamespaceImpact{Namespace: ns}
		breakdown[ns] = impact
	}

	impact.TotalFlows++

	if result.SimulatedVerdict == "ALLOWED" {
		impact.AllowedCount++
	} else {
		impact.DeniedCount++
	}

	if result.VerdictChanged {
		if result.OriginalVerdict == "ALLOWED" && result.SimulatedVerdict == "DENIED" {
			impact.WouldDeny++
		} else if result.OriginalVerdict != "ALLOWED" && result.SimulatedVerdict == "ALLOWED" {
			impact.WouldAllow++
		}
	} else {
		impact.NoChange++
	}
}
