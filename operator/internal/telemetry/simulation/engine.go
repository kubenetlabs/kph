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
	queryReq := models.QueryEventsRequest{
		StartTime:  req.StartTime,
		EndTime:    req.EndTime,
		Namespaces: req.Namespaces,
		EventTypes: []string{string(models.EventTypeFlow)},
		Limit:      0, // Get all matching events
	}

	result, err := e.storageMgr.Query(ctx, queryReq)
	if err != nil {
		return &SimulationResponse{
			Errors:         []string{"Failed to query historical data: " + err.Error()},
			SimulationTime: startTime,
			Duration:       time.Since(startTime),
		}, nil
	}

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

	// Check if the flow's source matches the policy's pod selector
	if !e.matchesPodSelector(event, policy) {
		// Flow source doesn't match this policy, use original verdict
		result.SimulatedVerdict = result.OriginalVerdict
		result.MatchReason = "Source pod does not match policy selector"
		result.VerdictChanged = false
		return result
	}

	// Determine if this is ingress or egress from policy's perspective
	// For flows where source matches policy selector, outbound = egress, inbound = ingress
	direction := "egress"
	if event.Direction == models.TrafficDirectionIngress {
		direction = "ingress"
	}

	// Get the relevant rules
	var rules []PolicyRule
	if direction == "ingress" {
		rules = policy.IngressRules
	} else {
		rules = policy.EgressRules
	}

	// If no rules for this direction and policy has default deny, deny the flow
	if len(rules) == 0 {
		if policy.DefaultDeny && (policy.DefaultDenyType == direction || policy.DefaultDenyType == "both") {
			result.SimulatedVerdict = "DENIED"
			result.MatchReason = "Default deny, no matching rules"
		} else {
			result.SimulatedVerdict = "ALLOWED"
			result.MatchReason = "No policy rules apply"
		}
		result.VerdictChanged = result.SimulatedVerdict != result.OriginalVerdict
		return result
	}

	// Check if any rule allows this flow
	for i, rule := range rules {
		if e.flowMatchesRule(event, &rule) {
			if rule.Action == "allow" {
				result.SimulatedVerdict = "ALLOWED"
				result.MatchedRule = ruleDescription(i, &rule)
				result.MatchReason = "Matched allow rule"
			} else {
				result.SimulatedVerdict = "DENIED"
				result.MatchedRule = ruleDescription(i, &rule)
				result.MatchReason = "Matched deny rule"
			}
			result.VerdictChanged = result.SimulatedVerdict != result.OriginalVerdict
			return result
		}
	}

	// No rule matched - apply default deny if enabled
	if policy.DefaultDeny {
		result.SimulatedVerdict = "DENIED"
		result.MatchReason = "No matching rule, default deny"
	} else {
		result.SimulatedVerdict = "ALLOWED"
		result.MatchReason = "No matching rule, default allow"
	}

	result.VerdictChanged = result.SimulatedVerdict != result.OriginalVerdict
	return result
}

// matchesPodSelector checks if an event's source matches the policy's pod selector.
func (e *Engine) matchesPodSelector(event *models.TelemetryEvent, policy *ParsedPolicy) bool {
	// Empty selector matches all pods
	if len(policy.PodSelector) == 0 {
		return true
	}

	// Check if namespace matches (if policy is namespaced)
	if policy.Namespace != "" && event.SrcNamespace != policy.Namespace {
		return false
	}

	// Check pod labels
	if event.SrcPodLabels == nil {
		return false
	}

	for key, value := range policy.PodSelector {
		if event.SrcPodLabels[key] != value {
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
