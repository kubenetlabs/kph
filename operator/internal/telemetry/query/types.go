package query

import (
	"context"
	"time"

	"google.golang.org/grpc"
)

// TelemetryQueryServer is the server API for TelemetryQuery service.
type TelemetryQueryServer interface {
	// QueryEvents queries historical telemetry events with pagination.
	QueryEvents(context.Context, *QueryEventsRequest) (*QueryEventsResponse, error)
	// StreamEvents streams historical telemetry events.
	StreamEvents(*QueryEventsRequest, TelemetryQuery_StreamEventsServer) error
	// GetEventCount returns event count statistics.
	GetEventCount(context.Context, *GetEventCountRequest) (*EventCountResponse, error)
	mustEmbedUnimplementedTelemetryQueryServer()
}

// TelemetryQueryClient is the client API for TelemetryQuery service.
type TelemetryQueryClient interface {
	// QueryEvents queries historical telemetry events with pagination.
	QueryEvents(ctx context.Context, in *QueryEventsRequest, opts ...grpc.CallOption) (*QueryEventsResponse, error)
	// StreamEvents streams historical telemetry events.
	StreamEvents(ctx context.Context, in *QueryEventsRequest, opts ...grpc.CallOption) (TelemetryQuery_StreamEventsClient, error)
	// GetEventCount returns event count statistics.
	GetEventCount(ctx context.Context, in *GetEventCountRequest, opts ...grpc.CallOption) (*EventCountResponse, error)
}

// UnimplementedTelemetryQueryServer must be embedded to have forward compatible implementations.
type UnimplementedTelemetryQueryServer struct{}

func (UnimplementedTelemetryQueryServer) QueryEvents(context.Context, *QueryEventsRequest) (*QueryEventsResponse, error) {
	return nil, nil
}

func (UnimplementedTelemetryQueryServer) StreamEvents(*QueryEventsRequest, TelemetryQuery_StreamEventsServer) error {
	return nil
}

func (UnimplementedTelemetryQueryServer) GetEventCount(context.Context, *GetEventCountRequest) (*EventCountResponse, error) {
	return nil, nil
}

func (UnimplementedTelemetryQueryServer) mustEmbedUnimplementedTelemetryQueryServer() {}

// TelemetryQuery_StreamEventsServer is the server stream for StreamEvents.
type TelemetryQuery_StreamEventsServer interface {
	Send(*TelemetryEvent) error
	grpc.ServerStream
}

// TelemetryQuery_StreamEventsClient is the client stream for StreamEvents.
type TelemetryQuery_StreamEventsClient interface {
	Recv() (*TelemetryEvent, error)
	grpc.ClientStream
}

// QueryEventsRequest is the request for querying events.
type QueryEventsRequest struct {
	StartTime  time.Time `json:"startTime"`
	EndTime    time.Time `json:"endTime"`
	Namespaces []string  `json:"namespaces,omitempty"`
	EventTypes []string  `json:"eventTypes,omitempty"`
	Limit      int32     `json:"limit,omitempty"`
	Offset     int32     `json:"offset,omitempty"`
}

// QueryEventsResponse is the response from querying events.
type QueryEventsResponse struct {
	Events     []*TelemetryEvent `json:"events"`
	TotalCount int64             `json:"totalCount"`
	HasMore    bool              `json:"hasMore"`
}

// GetEventCountRequest is the request for getting event counts.
type GetEventCountRequest struct {
	StartTime  time.Time `json:"startTime"`
	EndTime    time.Time `json:"endTime"`
	Namespaces []string  `json:"namespaces,omitempty"`
}

// EventCountResponse is the response with event counts.
type EventCountResponse struct {
	TotalEvents  int64            `json:"totalEvents"`
	EventsByType map[string]int64 `json:"eventsByType"`
	EventsByNode map[string]int64 `json:"eventsByNode"`
	OldestEvent  time.Time        `json:"oldestEvent"`
	NewestEvent  time.Time        `json:"newestEvent"`
}

// TelemetryEvent is the gRPC representation of a telemetry event.
type TelemetryEvent struct {
	ID           string            `json:"id"`
	Timestamp    time.Time         `json:"timestamp"`
	EventType    string            `json:"eventType"`
	NodeName     string            `json:"nodeName"`
	SrcNamespace string            `json:"srcNamespace,omitempty"`
	SrcPodName   string            `json:"srcPodName,omitempty"`
	SrcPodLabels map[string]string `json:"srcPodLabels,omitempty"`
	SrcIP        string            `json:"srcIP,omitempty"`
	SrcPort      uint32            `json:"srcPort,omitempty"`
	SrcProcess   string            `json:"srcProcess,omitempty"`
	SrcPID       uint32            `json:"srcPID,omitempty"`
	SrcBinary    string            `json:"srcBinary,omitempty"`
	DstNamespace string            `json:"dstNamespace,omitempty"`
	DstPodName   string            `json:"dstPodName,omitempty"`
	DstPodLabels map[string]string `json:"dstPodLabels,omitempty"`
	DstIP        string            `json:"dstIP,omitempty"`
	DstPort      uint32            `json:"dstPort,omitempty"`
	Protocol     string            `json:"protocol,omitempty"`
	L7Type       string            `json:"l7Type,omitempty"`
	HTTPMethod   string            `json:"httpMethod,omitempty"`
	HTTPPath     string            `json:"httpPath,omitempty"`
	HTTPStatus   int32             `json:"httpStatus,omitempty"`
	DNSQuery     string            `json:"dnsQuery,omitempty"`
	Syscall      string            `json:"syscall,omitempty"`
	FilePath     string            `json:"filePath,omitempty"`
	Verdict      string            `json:"verdict"`
	Action       string            `json:"action,omitempty"`
	BytesTotal   int64             `json:"bytesTotal,omitempty"`
	PacketsTotal int64             `json:"packetsTotal,omitempty"`
	Source       string            `json:"source"`
}
