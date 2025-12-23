// Package simulation provides policy simulation against historical telemetry data.
// This enables "time travel" policy testing - evaluating draft policies against
// past network flows and process events to predict their impact before deployment.
package simulation

import (
	"time"
)

// SimulationRequest contains the parameters for a policy simulation.
type SimulationRequest struct {
	// PolicyContent is the raw YAML content of the policy to simulate
	PolicyContent string `json:"policyContent"`

	// PolicyType indicates the type of policy (CILIUM_NETWORK, CILIUM_CLUSTERWIDE, TETRAGON)
	PolicyType string `json:"policyType"`

	// TimeRange specifies the historical data window
	StartTime time.Time `json:"startTime"`
	EndTime   time.Time `json:"endTime"`

	// Namespaces limits simulation to specific namespaces (empty = all)
	Namespaces []string `json:"namespaces,omitempty"`

	// IncludeDetails controls whether to return detailed flow-level results
	IncludeDetails bool `json:"includeDetails,omitempty"`

	// MaxDetails limits the number of detailed results returned
	MaxDetails int32 `json:"maxDetails,omitempty"`
}

// SimulationResponse contains the results of a policy simulation.
type SimulationResponse struct {
	// Summary statistics
	TotalFlowsAnalyzed int64 `json:"totalFlowsAnalyzed"`
	AllowedCount       int64 `json:"allowedCount"`
	DeniedCount        int64 `json:"deniedCount"`
	NoChangeCount      int64 `json:"noChangeCount"`

	// WouldChangeCount is the number of flows that would have a different verdict
	WouldChangeCount int64 `json:"wouldChangeCount"`

	// BreakdownByNamespace shows impact per namespace
	BreakdownByNamespace map[string]*NamespaceImpact `json:"breakdownByNamespace,omitempty"`

	// BreakdownByVerdict shows counts by verdict change
	BreakdownByVerdict *VerdictBreakdown `json:"breakdownByVerdict,omitempty"`

	// Details contains sample flows with their simulation results
	Details []*FlowSimulationResult `json:"details,omitempty"`

	// Errors encountered during simulation
	Errors []string `json:"errors,omitempty"`

	// Metadata
	SimulationTime time.Time     `json:"simulationTime"`
	Duration       time.Duration `json:"duration"`
}

// NamespaceImpact shows the simulation impact for a specific namespace.
type NamespaceImpact struct {
	Namespace      string `json:"namespace"`
	TotalFlows     int64  `json:"totalFlows"`
	AllowedCount   int64  `json:"allowedCount"`
	DeniedCount    int64  `json:"deniedCount"`
	WouldDeny      int64  `json:"wouldDeny"`      // Currently allowed, would be denied
	WouldAllow     int64  `json:"wouldAllow"`     // Currently denied, would be allowed
	NoChange       int64  `json:"noChange"`
}

// VerdictBreakdown shows the breakdown of verdict changes.
type VerdictBreakdown struct {
	AllowedToAllowed int64 `json:"allowedToAllowed"`
	AllowedToDenied  int64 `json:"allowedToDenied"`
	DeniedToAllowed  int64 `json:"deniedToAllowed"`
	DeniedToDenied   int64 `json:"deniedToDenied"`
	DroppedToAllowed int64 `json:"droppedToAllowed"`
	DroppedToDenied  int64 `json:"droppedToDenied"`
}

// FlowSimulationResult contains the simulation result for a single flow.
type FlowSimulationResult struct {
	// Flow identification
	Timestamp    time.Time `json:"timestamp"`
	SrcNamespace string    `json:"srcNamespace"`
	SrcPodName   string    `json:"srcPodName,omitempty"`
	DstNamespace string    `json:"dstNamespace"`
	DstPodName   string    `json:"dstPodName,omitempty"`
	DstPort      uint32    `json:"dstPort"`
	Protocol     string    `json:"protocol"`

	// L7 details if available
	L7Type     string `json:"l7Type,omitempty"`
	HTTPMethod string `json:"httpMethod,omitempty"`
	HTTPPath   string `json:"httpPath,omitempty"`

	// Verdicts
	OriginalVerdict  string `json:"originalVerdict"`
	SimulatedVerdict string `json:"simulatedVerdict"`
	VerdictChanged   bool   `json:"verdictChanged"`

	// Matching rule info
	MatchedRule string `json:"matchedRule,omitempty"`
	MatchReason string `json:"matchReason,omitempty"`
}

// PolicyRule represents a parsed rule from a network policy.
type PolicyRule struct {
	// Direction: ingress or egress
	Direction string `json:"direction"`

	// Selectors
	PodSelector       map[string]string `json:"podSelector,omitempty"`
	NamespaceSelector map[string]string `json:"namespaceSelector,omitempty"`

	// Endpoint matching
	ToPorts   []PortRule   `json:"toPorts,omitempty"`
	FromCIDRs []string     `json:"fromCIDRs,omitempty"`
	ToCIDRs   []string     `json:"toCIDRs,omitempty"`
	ToFQDNs   []string     `json:"toFQDNs,omitempty"`

	// L7 rules
	L7Rules []L7Rule `json:"l7Rules,omitempty"`

	// Action: allow or deny (for Cilium, default is allow if in policy)
	Action string `json:"action"`
}

// PortRule represents a port/protocol rule.
type PortRule struct {
	Port     uint32 `json:"port"`
	EndPort  uint32 `json:"endPort,omitempty"`
	Protocol string `json:"protocol"`
}

// L7Rule represents an L7 (application layer) rule.
type L7Rule struct {
	Type   string `json:"type"` // http, dns, kafka, etc.
	Method string `json:"method,omitempty"`
	Path   string `json:"path,omitempty"`
	Host   string `json:"host,omitempty"`
}

// ParsedPolicy represents a fully parsed network policy.
type ParsedPolicy struct {
	Name            string            `json:"name"`
	Namespace       string            `json:"namespace"`
	Type            string            `json:"type"`
	PodSelector     map[string]string `json:"podSelector"`
	IngressRules    []PolicyRule      `json:"ingressRules,omitempty"`
	EgressRules     []PolicyRule      `json:"egressRules,omitempty"`
	DefaultDeny     bool              `json:"defaultDeny"`
	DefaultDenyType string            `json:"defaultDenyType,omitempty"` // ingress, egress, or both
}
