// Package validation provides real-time policy validation against network flows.
// It watches Hubble flows, matches them against CiliumNetworkPolicies, and reports
// validation verdicts to the SaaS platform.
package validation

import (
	"time"
)

// Verdict represents the validation result for a flow
type Verdict string

const (
	// VerdictAllowed indicates the flow was explicitly allowed by a policy
	VerdictAllowed Verdict = "ALLOWED"
	// VerdictBlocked indicates the flow was blocked (policy exists but no matching rule)
	VerdictBlocked Verdict = "BLOCKED"
	// VerdictNoPolicy indicates no policy governs this flow (coverage gap)
	VerdictNoPolicy Verdict = "NO_POLICY"
)

// ValidationResult ties a flow to its policy verdict
type ValidationResult struct {
	Timestamp     time.Time         `json:"timestamp"`
	SrcNamespace  string            `json:"srcNamespace"`
	SrcPodName    string            `json:"srcPodName,omitempty"`
	SrcLabels     map[string]string `json:"srcLabels,omitempty"`
	DstNamespace  string            `json:"dstNamespace"`
	DstPodName    string            `json:"dstPodName,omitempty"`
	DstLabels     map[string]string `json:"dstLabels,omitempty"`
	DstPort       uint32            `json:"dstPort"`
	Protocol      string            `json:"protocol"`
	Verdict       Verdict           `json:"verdict"`
	MatchedPolicy string            `json:"matchedPolicy,omitempty"`
	Reason        string            `json:"reason,omitempty"`
}

// ValidationSummary contains aggregated validation stats for a time window
type ValidationSummary struct {
	Hour          time.Time      `json:"hour"`
	AllowedCount  int64          `json:"allowedCount"`
	BlockedCount  int64          `json:"blockedCount"`
	NoPolicyCount int64          `json:"noPolicyCount"`
	CoverageGaps  []CoverageGap  `json:"coverageGaps,omitempty"`
	TopBlocked    []BlockedFlow  `json:"topBlocked,omitempty"`
}

// CoverageGap represents a source/destination pair without policy coverage
type CoverageGap struct {
	SrcNamespace string `json:"srcNamespace"`
	SrcPodName   string `json:"srcPodName,omitempty"`
	DstNamespace string `json:"dstNamespace"`
	DstPodName   string `json:"dstPodName,omitempty"`
	DstPort      int    `json:"dstPort"`
	Count        int    `json:"count"`
}

// BlockedFlow represents a blocked flow for reporting
type BlockedFlow struct {
	SrcNamespace string `json:"srcNamespace"`
	SrcPodName   string `json:"srcPodName,omitempty"`
	DstNamespace string `json:"dstNamespace"`
	DstPodName   string `json:"dstPodName,omitempty"`
	DstPort      int    `json:"dstPort,omitempty"`
	Policy       string `json:"policy"`
	Count        int    `json:"count"`
}

// ValidationEvent is a single validation event to report to SaaS
type ValidationEvent struct {
	Timestamp     time.Time         `json:"timestamp"`
	Verdict       string            `json:"verdict"`
	SrcNamespace  string            `json:"srcNamespace"`
	SrcPodName    string            `json:"srcPodName,omitempty"`
	SrcLabels     map[string]string `json:"srcLabels,omitempty"`
	DstNamespace  string            `json:"dstNamespace"`
	DstPodName    string            `json:"dstPodName,omitempty"`
	DstLabels     map[string]string `json:"dstLabels,omitempty"`
	DstPort       int               `json:"dstPort"`
	Protocol      string            `json:"protocol"`
	MatchedPolicy string            `json:"matchedPolicy,omitempty"`
	Reason        string            `json:"reason,omitempty"`
}

// ValidationIngestion is the payload sent to SaaS
type ValidationIngestion struct {
	Summaries []ValidationSummary `json:"summaries,omitempty"`
	Events    []ValidationEvent   `json:"events,omitempty"`
}

// AgentConfig contains configuration for the validation agent
type AgentConfig struct {
	// SaaSEndpoint is the base URL for the SaaS API
	SaaSEndpoint string
	// APIKey for authentication
	APIKey string
	// ClusterID for this cluster
	ClusterID string
	// FlushInterval is how often to send summaries to SaaS
	FlushInterval time.Duration
	// MaxEventsPerFlush limits events sent per flush
	MaxEventsPerFlush int
	// SampleRate for individual events (1 = all, 10 = 1 in 10)
	EventSampleRate int
}
