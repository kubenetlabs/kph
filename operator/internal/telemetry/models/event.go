// Package models defines the unified telemetry event types for the Policy Hub collector.
package models

import (
	"time"
)

// EventType represents the category of telemetry event
type EventType string

const (
	// EventTypeFlow represents L3/L4/L7 network flow events (from Hubble)
	EventTypeFlow EventType = "FLOW"
	// EventTypeProcessExec represents process execution events (from Tetragon)
	EventTypeProcessExec EventType = "PROCESS_EXEC"
	// EventTypeSyscall represents syscall events (from Tetragon)
	EventTypeSyscall EventType = "SYSCALL"
	// EventTypeFileAccess represents file access events (from Tetragon)
	EventTypeFileAccess EventType = "FILE_ACCESS"
)

// Verdict represents the policy decision for an event
type Verdict string

const (
	// VerdictAllowed indicates the flow/action was allowed
	VerdictAllowed Verdict = "ALLOWED"
	// VerdictDenied indicates the flow/action was denied by policy
	VerdictDenied Verdict = "DENIED"
	// VerdictDropped indicates the flow/action was dropped
	VerdictDropped Verdict = "DROPPED"
	// VerdictUnknown indicates the verdict could not be determined
	VerdictUnknown Verdict = "UNKNOWN"
)

// TrafficDirection indicates the direction of network flow
type TrafficDirection string

const (
	// TrafficDirectionIngress represents incoming traffic
	TrafficDirectionIngress TrafficDirection = "INGRESS"
	// TrafficDirectionEgress represents outgoing traffic
	TrafficDirectionEgress TrafficDirection = "EGRESS"
	// TrafficDirectionUnknown represents unknown direction
	TrafficDirectionUnknown TrafficDirection = "UNKNOWN"
)

// TelemetryEvent is the unified event structure that captures both
// network flows (from Hubble) and process/syscall events (from Tetragon).
// This structure enables "time travel" policy simulation by recording
// all relevant context about each observed event.
type TelemetryEvent struct {
	// Core identification
	ID        string    `json:"id" parquet:"name=id, type=BYTE_ARRAY, convertedtype=UTF8"`
	Timestamp time.Time `json:"timestamp" parquet:"name=timestamp, type=INT64, convertedtype=TIMESTAMP_MICROS"`
	EventType EventType `json:"eventType" parquet:"name=event_type, type=BYTE_ARRAY, convertedtype=UTF8"`
	NodeName  string    `json:"nodeName" parquet:"name=node_name, type=BYTE_ARRAY, convertedtype=UTF8"`

	// Source identity
	SrcNamespace string            `json:"srcNamespace,omitempty" parquet:"name=src_namespace, type=BYTE_ARRAY, convertedtype=UTF8"`
	SrcPodName   string            `json:"srcPodName,omitempty" parquet:"name=src_pod_name, type=BYTE_ARRAY, convertedtype=UTF8"`
	SrcPodLabels map[string]string `json:"srcPodLabels,omitempty" parquet:"name=src_pod_labels, type=MAP, convertedtype=MAP, keytype=BYTE_ARRAY, keyconvertedtype=UTF8, valuetype=BYTE_ARRAY, valueconvertedtype=UTF8"`
	SrcIP        string            `json:"srcIP,omitempty" parquet:"name=src_ip, type=BYTE_ARRAY, convertedtype=UTF8"`
	SrcPort      uint32            `json:"srcPort,omitempty" parquet:"name=src_port, type=INT32"`
	SrcIdentity  uint32            `json:"srcIdentity,omitempty" parquet:"name=src_identity, type=INT32"`

	// Source process info (for Tetragon events)
	SrcProcess   string `json:"srcProcess,omitempty" parquet:"name=src_process, type=BYTE_ARRAY, convertedtype=UTF8"`
	SrcPID       uint32 `json:"srcPID,omitempty" parquet:"name=src_pid, type=INT32"`
	SrcUID       uint32 `json:"srcUID,omitempty" parquet:"name=src_uid, type=INT32"`
	SrcBinary    string `json:"srcBinary,omitempty" parquet:"name=src_binary, type=BYTE_ARRAY, convertedtype=UTF8"`
	SrcArguments string `json:"srcArguments,omitempty" parquet:"name=src_arguments, type=BYTE_ARRAY, convertedtype=UTF8"`

	// Destination identity
	DstNamespace string            `json:"dstNamespace,omitempty" parquet:"name=dst_namespace, type=BYTE_ARRAY, convertedtype=UTF8"`
	DstPodName   string            `json:"dstPodName,omitempty" parquet:"name=dst_pod_name, type=BYTE_ARRAY, convertedtype=UTF8"`
	DstPodLabels map[string]string `json:"dstPodLabels,omitempty" parquet:"name=dst_pod_labels, type=MAP, convertedtype=MAP, keytype=BYTE_ARRAY, keyconvertedtype=UTF8, valuetype=BYTE_ARRAY, valueconvertedtype=UTF8"`
	DstIP        string            `json:"dstIP,omitempty" parquet:"name=dst_ip, type=BYTE_ARRAY, convertedtype=UTF8"`
	DstPort      uint32            `json:"dstPort,omitempty" parquet:"name=dst_port, type=INT32"`
	DstIdentity  uint32            `json:"dstIdentity,omitempty" parquet:"name=dst_identity, type=INT32"`
	DstDNSName   string            `json:"dstDNSName,omitempty" parquet:"name=dst_dns_name, type=BYTE_ARRAY, convertedtype=UTF8"`

	// Protocol information
	Protocol  string           `json:"protocol,omitempty" parquet:"name=protocol, type=BYTE_ARRAY, convertedtype=UTF8"`
	L7Type    string           `json:"l7Type,omitempty" parquet:"name=l7_type, type=BYTE_ARRAY, convertedtype=UTF8"`
	Direction TrafficDirection `json:"direction,omitempty" parquet:"name=direction, type=BYTE_ARRAY, convertedtype=UTF8"`

	// L7 HTTP details (from Hubble)
	HTTPMethod   string `json:"httpMethod,omitempty" parquet:"name=http_method, type=BYTE_ARRAY, convertedtype=UTF8"`
	HTTPPath     string `json:"httpPath,omitempty" parquet:"name=http_path, type=BYTE_ARRAY, convertedtype=UTF8"`
	HTTPHost     string `json:"httpHost,omitempty" parquet:"name=http_host, type=BYTE_ARRAY, convertedtype=UTF8"`
	HTTPStatus   int32  `json:"httpStatus,omitempty" parquet:"name=http_status, type=INT32"`
	HTTPHeaders  string `json:"httpHeaders,omitempty" parquet:"name=http_headers, type=BYTE_ARRAY, convertedtype=UTF8"`
	HTTPProtocol string `json:"httpProtocol,omitempty" parquet:"name=http_protocol, type=BYTE_ARRAY, convertedtype=UTF8"`

	// L7 DNS details (from Hubble)
	DNSQuery     string   `json:"dnsQuery,omitempty" parquet:"name=dns_query, type=BYTE_ARRAY, convertedtype=UTF8"`
	DNSQueryType string   `json:"dnsQueryType,omitempty" parquet:"name=dns_query_type, type=BYTE_ARRAY, convertedtype=UTF8"`
	DNSRCode     int32    `json:"dnsRCode,omitempty" parquet:"name=dns_rcode, type=INT32"`
	DNSIPs       []string `json:"dnsIPs,omitempty" parquet:"name=dns_ips, type=LIST, valuetype=BYTE_ARRAY, valueconvertedtype=UTF8"`

	// L7 gRPC details (from Hubble)
	GRPCService string `json:"grpcService,omitempty" parquet:"name=grpc_service, type=BYTE_ARRAY, convertedtype=UTF8"`
	GRPCMethod  string `json:"grpcMethod,omitempty" parquet:"name=grpc_method, type=BYTE_ARRAY, convertedtype=UTF8"`
	GRPCStatus  int32  `json:"grpcStatus,omitempty" parquet:"name=grpc_status, type=INT32"`

	// L7 Kafka details (from Hubble)
	KafkaTopic        string `json:"kafkaTopic,omitempty" parquet:"name=kafka_topic, type=BYTE_ARRAY, convertedtype=UTF8"`
	KafkaAPIKey       string `json:"kafkaAPIKey,omitempty" parquet:"name=kafka_api_key, type=BYTE_ARRAY, convertedtype=UTF8"`
	KafkaErrorCode    int32  `json:"kafkaErrorCode,omitempty" parquet:"name=kafka_error_code, type=INT32"`
	KafkaCorrelation  int32  `json:"kafkaCorrelation,omitempty" parquet:"name=kafka_correlation, type=INT32"`

	// Syscall info (from Tetragon)
	Syscall     string   `json:"syscall,omitempty" parquet:"name=syscall, type=BYTE_ARRAY, convertedtype=UTF8"`
	SyscallArgs []string `json:"syscallArgs,omitempty" parquet:"name=syscall_args, type=LIST, valuetype=BYTE_ARRAY, valueconvertedtype=UTF8"`

	// File access info (from Tetragon)
	FilePath      string `json:"filePath,omitempty" parquet:"name=file_path, type=BYTE_ARRAY, convertedtype=UTF8"`
	FileOperation string `json:"fileOperation,omitempty" parquet:"name=file_operation, type=BYTE_ARRAY, convertedtype=UTF8"`

	// Verdict and action
	Verdict Verdict `json:"verdict" parquet:"name=verdict, type=BYTE_ARRAY, convertedtype=UTF8"`
	Action  string  `json:"action,omitempty" parquet:"name=action, type=BYTE_ARRAY, convertedtype=UTF8"`

	// Flow metrics
	BytesTotal   int64 `json:"bytesTotal,omitempty" parquet:"name=bytes_total, type=INT64"`
	PacketsTotal int64 `json:"packetsTotal,omitempty" parquet:"name=packets_total, type=INT64"`

	// TCP flags (for detailed flow analysis)
	TCPFlags string `json:"tcpFlags,omitempty" parquet:"name=tcp_flags, type=BYTE_ARRAY, convertedtype=UTF8"`
	IsReply  bool   `json:"isReply,omitempty" parquet:"name=is_reply, type=BOOLEAN"`

	// Policy correlation
	MatchedPolicies []string `json:"matchedPolicies,omitempty" parquet:"name=matched_policies, type=LIST, valuetype=BYTE_ARRAY, valueconvertedtype=UTF8"`

	// Trace context (for distributed tracing correlation)
	TraceID      string `json:"traceID,omitempty" parquet:"name=trace_id, type=BYTE_ARRAY, convertedtype=UTF8"`
	SpanID       string `json:"spanID,omitempty" parquet:"name=span_id, type=BYTE_ARRAY, convertedtype=UTF8"`
	ParentSpanID string `json:"parentSpanID,omitempty" parquet:"name=parent_span_id, type=BYTE_ARRAY, convertedtype=UTF8"`

	// Source tracking
	Source string `json:"source" parquet:"name=source, type=BYTE_ARRAY, convertedtype=UTF8"`
}

// EventSource identifies where the event originated
const (
	SourceHubble   = "hubble"
	SourceTetragon = "tetragon"
)

// FlowSummary represents an aggregated summary of flows for SaaS sync
type FlowSummary struct {
	// Time window
	WindowStart time.Time `json:"windowStart"`
	WindowEnd   time.Time `json:"windowEnd"`
	NodeName    string    `json:"nodeName"`

	// Aggregation key
	SrcNamespace string `json:"srcNamespace"`
	DstNamespace string `json:"dstNamespace"`
	SrcPodName   string `json:"srcPodName,omitempty"`
	DstPodName   string `json:"dstPodName,omitempty"`
	DstPort      uint32 `json:"dstPort"`
	Protocol     string `json:"protocol"`
	L7Type       string `json:"l7Type,omitempty"`

	// Aggregated counts
	TotalFlows    int64 `json:"totalFlows"`
	AllowedFlows  int64 `json:"allowedFlows"`
	DeniedFlows   int64 `json:"deniedFlows"`
	DroppedFlows  int64 `json:"droppedFlows"`
	TotalBytes    int64 `json:"totalBytes"`
	TotalPackets  int64 `json:"totalPackets"`

	// L7 breakdown (for HTTP)
	HTTPMethodCounts map[string]int64 `json:"httpMethodCounts,omitempty"`
	HTTPStatusCounts map[int32]int64  `json:"httpStatusCounts,omitempty"`

	// Top paths (for HTTP, limited to top 10)
	TopHTTPPaths []PathCount `json:"topHttpPaths,omitempty"`

	// Top DNS queries
	TopDNSQueries []DNSQueryCount `json:"topDnsQueries,omitempty"`
}

// PathCount tracks HTTP path frequency
type PathCount struct {
	Path  string `json:"path"`
	Count int64  `json:"count"`
}

// DNSQueryCount tracks DNS query frequency
type DNSQueryCount struct {
	Query string `json:"query"`
	Type  string `json:"type"`
	Count int64  `json:"count"`
}

// ProcessEventSummary represents aggregated process events for SaaS sync
type ProcessEventSummary struct {
	// Time window
	WindowStart time.Time `json:"windowStart"`
	WindowEnd   time.Time `json:"windowEnd"`
	NodeName    string    `json:"nodeName"`

	// Aggregation key
	Namespace string `json:"namespace"`
	PodName   string `json:"podName,omitempty"`

	// Process execution counts
	TotalExecs    int64 `json:"totalExecs"`
	UniqueBinaries int64 `json:"uniqueBinaries"`

	// Top executed binaries
	TopBinaries []BinaryCount `json:"topBinaries,omitempty"`

	// Syscall counts
	TotalSyscalls int64            `json:"totalSyscalls"`
	SyscallCounts map[string]int64 `json:"syscallCounts,omitempty"`

	// File access counts
	TotalFileAccess int64            `json:"totalFileAccess"`
	FileOpCounts    map[string]int64 `json:"fileOpCounts,omitempty"`

	// Action counts (for Tetragon enforcement)
	ActionCounts map[string]int64 `json:"actionCounts,omitempty"`
}

// BinaryCount tracks binary execution frequency
type BinaryCount struct {
	Binary string `json:"binary"`
	Count  int64  `json:"count"`
}

// AggregatedTelemetry is the top-level structure sent to SaaS
type AggregatedTelemetry struct {
	ClusterID        string                 `json:"clusterId"`
	Timestamp        time.Time              `json:"timestamp"`
	FlowSummaries    []FlowSummary          `json:"flowSummaries,omitempty"`
	ProcessSummaries []ProcessEventSummary  `json:"processSummaries,omitempty"`
}

// QueryEventsRequest is used to query historical events for simulation
type QueryEventsRequest struct {
	StartTime  time.Time `json:"startTime"`
	EndTime    time.Time `json:"endTime"`
	Namespaces []string  `json:"namespaces,omitempty"`
	EventTypes []string  `json:"eventTypes,omitempty"`
	Limit      int32     `json:"limit,omitempty"`
	Offset     int32     `json:"offset,omitempty"`
}

// QueryEventsResponse contains the result of a historical query
type QueryEventsResponse struct {
	Events     []TelemetryEvent `json:"events"`
	TotalCount int64            `json:"totalCount"`
	HasMore    bool             `json:"hasMore"`
}

// EventCountResponse contains count statistics for events
type EventCountResponse struct {
	TotalEvents   int64            `json:"totalEvents"`
	EventsByType  map[string]int64 `json:"eventsByType"`
	EventsByNode  map[string]int64 `json:"eventsByNode"`
	OldestEvent   time.Time        `json:"oldestEvent"`
	NewestEvent   time.Time        `json:"newestEvent"`
}
