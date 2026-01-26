// Package collector provides telemetry collection from Hubble and Tetragon.
package collector

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"strings"
	"sync"
	"time"

	"github.com/go-logr/logr"
	"github.com/google/uuid"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"

	observerpb "github.com/cilium/cilium/api/v1/observer"
	flowpb "github.com/cilium/cilium/api/v1/flow"

	"github.com/policy-hub/operator/internal/telemetry/models"
)

// HubbleClient connects to Hubble Relay and streams flow events.
type HubbleClient struct {
	address     string
	tlsEnabled  bool
	tlsConfig   *tls.Config
	log         logr.Logger
	nodeName    string

	conn       *grpc.ClientConn
	client     observerpb.ObserverClient
	mu         sync.RWMutex
	connected  bool

	// Callback for received events
	eventHandler func(*models.TelemetryEvent)

	// Filtering
	namespaceFilter []string
}

// HubbleClientConfig contains configuration for the Hubble client.
type HubbleClientConfig struct {
	// Address of Hubble Relay (e.g., "hubble-relay.kube-system.svc.cluster.local:4245")
	Address string
	// TLSEnabled enables TLS for the gRPC connection
	TLSEnabled bool
	// TLSConfig optional TLS configuration
	TLSConfig *tls.Config
	// NodeName is the name of the current node (for event tagging)
	NodeName string
	// NamespaceFilter limits events to specific namespaces (empty = all)
	NamespaceFilter []string
	// Logger for logging
	Logger logr.Logger
}

// NewHubbleClient creates a new Hubble client.
func NewHubbleClient(cfg HubbleClientConfig) *HubbleClient {
	return &HubbleClient{
		address:         cfg.Address,
		tlsEnabled:      cfg.TLSEnabled,
		tlsConfig:       cfg.TLSConfig,
		log:             cfg.Logger.WithName("hubble-client"),
		nodeName:        cfg.NodeName,
		namespaceFilter: cfg.NamespaceFilter,
	}
}

// SetEventHandler sets the callback for received events.
func (h *HubbleClient) SetEventHandler(handler func(*models.TelemetryEvent)) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.eventHandler = handler
}

// Connect establishes connection to Hubble Relay.
func (h *HubbleClient) Connect(ctx context.Context) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.connected {
		return nil
	}

	var opts []grpc.DialOption

	if h.tlsEnabled && h.tlsConfig != nil {
		opts = append(opts, grpc.WithTransportCredentials(credentials.NewTLS(h.tlsConfig)))
	} else {
		opts = append(opts, grpc.WithTransportCredentials(insecure.NewCredentials()))
	}

	// Add default options
	opts = append(opts,
		grpc.WithDefaultCallOptions(grpc.MaxCallRecvMsgSize(16*1024*1024)),
		grpc.WithBlock(),
	)

	h.log.Info("Connecting to Hubble Relay", "address", h.address)

	conn, err := grpc.DialContext(ctx, h.address, opts...)
	if err != nil {
		return fmt.Errorf("failed to connect to Hubble Relay at %s: %w", h.address, err)
	}

	h.conn = conn
	h.client = observerpb.NewObserverClient(conn)
	h.connected = true

	h.log.Info("Connected to Hubble Relay successfully")
	return nil
}

// Close closes the connection to Hubble Relay.
func (h *HubbleClient) Close() error {
	h.mu.Lock()
	defer h.mu.Unlock()

	if !h.connected {
		return nil
	}

	h.connected = false
	if h.conn != nil {
		return h.conn.Close()
	}
	return nil
}

// StreamFlows starts streaming flows from Hubble Relay.
// This is a blocking call that runs until the context is cancelled.
func (h *HubbleClient) StreamFlows(ctx context.Context) error {
	h.mu.RLock()
	if !h.connected {
		h.mu.RUnlock()
		return fmt.Errorf("not connected to Hubble Relay")
	}
	client := h.client
	h.mu.RUnlock()

	// Build the flow request
	req := &observerpb.GetFlowsRequest{
		Follow: true,
		Whitelist: h.buildWhitelist(),
	}

	h.log.Info("Starting flow stream from Hubble")

	stream, err := client.GetFlows(ctx, req)
	if err != nil {
		return fmt.Errorf("failed to start flow stream: %w", err)
	}

	// Process flows
	for {
		select {
		case <-ctx.Done():
			h.log.Info("Flow stream context cancelled")
			return ctx.Err()
		default:
		}

		resp, err := stream.Recv()
		if err == io.EOF {
			h.log.Info("Flow stream ended")
			return nil
		}
		if err != nil {
			return fmt.Errorf("error receiving flow: %w", err)
		}

		flow := resp.GetFlow()
		if flow == nil {
			continue
		}

		// Convert to unified event
		event := h.flowToEvent(flow)
		if event == nil {
			continue
		}

		// Call the event handler
		h.mu.RLock()
		handler := h.eventHandler
		h.mu.RUnlock()

		if handler != nil {
			handler(event)
		}
	}
}

// buildWhitelist creates flow filters based on namespace configuration.
func (h *HubbleClient) buildWhitelist() []*flowpb.FlowFilter {
	if len(h.namespaceFilter) == 0 {
		// No filter - get all flows
		return nil
	}

	var filters []*flowpb.FlowFilter

	// Filter by source namespace
	for _, ns := range h.namespaceFilter {
		filters = append(filters, &flowpb.FlowFilter{
			SourcePod: []string{ns + "/"},
		})
		filters = append(filters, &flowpb.FlowFilter{
			DestinationPod: []string{ns + "/"},
		})
	}

	return filters
}

// flowToEvent converts a Hubble flow to a unified TelemetryEvent.
func (h *HubbleClient) flowToEvent(flow *flowpb.Flow) *models.TelemetryEvent {
	if flow == nil {
		return nil
	}

	event := &models.TelemetryEvent{
		ID:        uuid.New().String(),
		Timestamp: flow.GetTime().AsTime(),
		EventType: models.EventTypeFlow,
		NodeName:  h.nodeName,
		Source:    models.SourceHubble,
	}

	// Extract source endpoint info
	if src := flow.GetSource(); src != nil {
		event.SrcNamespace = src.GetNamespace()
		event.SrcPodName = src.GetPodName()
		event.SrcPodLabels = labelsSliceToMap(src.GetLabels())
		event.SrcIdentity = src.GetIdentity()
		// Fallback: extract namespace from labels if endpoint namespace is empty
		if event.SrcNamespace == "" {
			event.SrcNamespace = extractNamespaceFromLabels(src.GetLabels())
		}
	}

	// Extract destination endpoint info
	if dst := flow.GetDestination(); dst != nil {
		event.DstNamespace = dst.GetNamespace()
		event.DstPodName = dst.GetPodName()
		event.DstPodLabels = labelsSliceToMap(dst.GetLabels())
		event.DstIdentity = dst.GetIdentity()
		// Fallback: extract namespace from labels if endpoint namespace is empty
		if event.DstNamespace == "" {
			event.DstNamespace = extractNamespaceFromLabels(dst.GetLabels())
		}
	}

	// Extract IP information
	if ip := flow.GetIP(); ip != nil {
		event.SrcIP = ip.GetSource()
		event.DstIP = ip.GetDestination()
	}

	// Extract L4 information
	if l4 := flow.GetL4(); l4 != nil {
		if tcp := l4.GetTCP(); tcp != nil {
			event.Protocol = "TCP"
			event.SrcPort = tcp.GetSourcePort()
			event.DstPort = tcp.GetDestinationPort()
			event.TCPFlags = formatTCPFlags(tcp.GetFlags())
		} else if udp := l4.GetUDP(); udp != nil {
			event.Protocol = "UDP"
			event.SrcPort = udp.GetSourcePort()
			event.DstPort = udp.GetDestinationPort()
		} else if icmpv4 := l4.GetICMPv4(); icmpv4 != nil {
			event.Protocol = "ICMPv4"
		} else if icmpv6 := l4.GetICMPv6(); icmpv6 != nil {
			event.Protocol = "ICMPv6"
		} else if sctp := l4.GetSCTP(); sctp != nil {
			event.Protocol = "SCTP"
			event.SrcPort = sctp.GetSourcePort()
			event.DstPort = sctp.GetDestinationPort()
		}
	}

	// Extract L7 information
	if l7 := flow.GetL7(); l7 != nil {
		event.L7Type = l7.GetType().String()

		// HTTP
		if http := l7.GetHttp(); http != nil {
			event.HTTPMethod = http.GetMethod()
			event.HTTPPath = http.GetUrl()
			event.HTTPStatus = int32(http.GetCode())
			event.HTTPProtocol = http.GetProtocol()
			event.HTTPHeaders = formatHeaders(http.GetHeaders())
		}

		// DNS
		if dns := l7.GetDns(); dns != nil {
			event.DNSQuery = dns.GetQuery()
			if qtypes := dns.GetQtypes(); len(qtypes) > 0 {
				event.DNSQueryType = qtypes[0]
			}
			event.DNSRCode = int32(dns.GetRcode())
			event.DNSIPs = dns.GetIps()
		}

		// Kafka
		if kafka := l7.GetKafka(); kafka != nil {
			event.KafkaTopic = kafka.GetTopic()
			event.KafkaAPIKey = kafka.GetApiKey()
			event.KafkaErrorCode = kafka.GetErrorCode()
			event.KafkaCorrelation = kafka.GetCorrelationId()
		}
	}

	// Extract verdict
	event.Verdict = convertVerdict(flow.GetVerdict())
	event.IsReply = flow.GetIsReply().GetValue()

	// Traffic direction
	switch flow.GetTrafficDirection() {
	case flowpb.TrafficDirection_INGRESS:
		event.Direction = models.TrafficDirectionIngress
	case flowpb.TrafficDirection_EGRESS:
		event.Direction = models.TrafficDirectionEgress
	default:
		event.Direction = models.TrafficDirectionUnknown
	}

	// Extract destination DNS names if available
	if names := flow.GetDestinationNames(); len(names) > 0 {
		event.DstDNSName = strings.Join(names, ",")
	}

	// Extract policy info
	if dropped := flow.GetDropReasonDesc(); dropped != flowpb.DropReason_DROP_REASON_UNKNOWN {
		event.Action = dropped.String()
	}

	// Summary for tracing
	event.TraceID = flow.GetTraceContext().GetParent().GetTraceId()

	return event
}

// convertVerdict converts Hubble verdict to our verdict type.
func convertVerdict(v flowpb.Verdict) models.Verdict {
	switch v {
	case flowpb.Verdict_FORWARDED:
		return models.VerdictAllowed
	case flowpb.Verdict_DROPPED:
		return models.VerdictDropped
	case flowpb.Verdict_ERROR:
		return models.VerdictDenied
	case flowpb.Verdict_AUDIT:
		return models.VerdictAllowed
	case flowpb.Verdict_REDIRECTED:
		return models.VerdictAllowed
	case flowpb.Verdict_TRACED:
		return models.VerdictAllowed
	case flowpb.Verdict_TRANSLATED:
		return models.VerdictAllowed
	default:
		return models.VerdictUnknown
	}
}

// labelsSliceToMap converts Cilium's label slice format (key=value) to a map.
// Cilium labels have prefixes like "k8s:", "reserved:", etc. which are stripped
// to match the label format used in policy YAML (e.g., "k8s:org=empire" -> "org": "empire").
func labelsSliceToMap(labels []string) map[string]string {
	if len(labels) == 0 {
		return nil
	}

	result := make(map[string]string, len(labels))
	for _, label := range labels {
		parts := strings.SplitN(label, "=", 2)
		if len(parts) >= 1 {
			key := parts[0]
			value := ""
			if len(parts) == 2 {
				value = parts[1]
			}

			// Strip Cilium label prefixes (k8s:, reserved:, etc.)
			// These prefixes aren't used in policy YAML matchLabels
			key = stripCiliumLabelPrefix(key)

			// Skip internal Cilium labels that aren't useful for policy matching
			if strings.HasPrefix(key, "io.cilium.") || strings.HasPrefix(key, "io.kubernetes.pod.") {
				continue
			}

			result[key] = value
		}
	}
	return result
}

// stripCiliumLabelPrefix removes Cilium-specific prefixes from label keys.
// Common prefixes: k8s:, reserved:, container:
func stripCiliumLabelPrefix(key string) string {
	prefixes := []string{"k8s:", "reserved:", "container:"}
	for _, prefix := range prefixes {
		if strings.HasPrefix(key, prefix) {
			return key[len(prefix):]
		}
	}
	return key
}

// extractNamespaceFromLabels extracts namespace from Cilium labels.
// Hubble labels include "k8s:io.kubernetes.pod.namespace=<namespace>"
// which we use as a fallback when GetNamespace() returns empty.
func extractNamespaceFromLabels(labels []string) string {
	const nsLabelPrefix = "k8s:io.kubernetes.pod.namespace="
	for _, label := range labels {
		if strings.HasPrefix(label, nsLabelPrefix) {
			return label[len(nsLabelPrefix):]
		}
	}
	return ""
}

// formatTCPFlags formats TCP flags as a readable string.
func formatTCPFlags(flags *flowpb.TCPFlags) string {
	if flags == nil {
		return ""
	}

	var parts []string
	if flags.GetSYN() {
		parts = append(parts, "SYN")
	}
	if flags.GetACK() {
		parts = append(parts, "ACK")
	}
	if flags.GetFIN() {
		parts = append(parts, "FIN")
	}
	if flags.GetRST() {
		parts = append(parts, "RST")
	}
	if flags.GetPSH() {
		parts = append(parts, "PSH")
	}
	if flags.GetURG() {
		parts = append(parts, "URG")
	}
	if flags.GetECE() {
		parts = append(parts, "ECE")
	}
	if flags.GetCWR() {
		parts = append(parts, "CWR")
	}
	if flags.GetNS() {
		parts = append(parts, "NS")
	}

	return strings.Join(parts, ",")
}

// formatHeaders formats HTTP headers as a JSON-like string.
func formatHeaders(headers []*flowpb.HTTPHeader) string {
	if len(headers) == 0 {
		return ""
	}

	var parts []string
	for _, h := range headers {
		parts = append(parts, fmt.Sprintf("%s=%s", h.GetKey(), h.GetValue()))
	}
	return strings.Join(parts, ";")
}

// GetServerStatus returns the status of the Hubble server.
func (h *HubbleClient) GetServerStatus(ctx context.Context) (*observerpb.ServerStatusResponse, error) {
	h.mu.RLock()
	if !h.connected {
		h.mu.RUnlock()
		return nil, fmt.Errorf("not connected to Hubble Relay")
	}
	client := h.client
	h.mu.RUnlock()

	return client.ServerStatus(ctx, &observerpb.ServerStatusRequest{})
}

// IsConnected returns whether the client is connected.
func (h *HubbleClient) IsConnected() bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.connected
}

// Reconnect attempts to reconnect to Hubble Relay.
func (h *HubbleClient) Reconnect(ctx context.Context) error {
	if err := h.Close(); err != nil {
		h.log.Error(err, "Error closing existing connection")
	}

	// Exponential backoff
	backoff := time.Second
	maxBackoff := 30 * time.Second

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		err := h.Connect(ctx)
		if err == nil {
			return nil
		}

		h.log.Error(err, "Failed to reconnect, retrying", "backoff", backoff)

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}

		backoff *= 2
		if backoff > maxBackoff {
			backoff = maxBackoff
		}
	}
}
