package query

import (
	"context"

	"google.golang.org/grpc"
)

// Service name for the TelemetryQuery service.
const TelemetryQueryServiceName = "policyhub.telemetry.v1.TelemetryQuery"

// RegisterTelemetryQueryServer registers the TelemetryQuery server with a gRPC server.
func RegisterTelemetryQueryServer(s *grpc.Server, srv TelemetryQueryServer) {
	s.RegisterService(&TelemetryQuery_ServiceDesc, srv)
}

// TelemetryQuery_ServiceDesc is the service descriptor for the TelemetryQuery service.
var TelemetryQuery_ServiceDesc = grpc.ServiceDesc{
	ServiceName: TelemetryQueryServiceName,
	HandlerType: (*TelemetryQueryServer)(nil),
	Methods: []grpc.MethodDesc{
		{
			MethodName: "QueryEvents",
			Handler:    _TelemetryQuery_QueryEvents_Handler,
		},
		{
			MethodName: "GetEventCount",
			Handler:    _TelemetryQuery_GetEventCount_Handler,
		},
		{
			MethodName: "SimulatePolicy",
			Handler:    _TelemetryQuery_SimulatePolicy_Handler,
		},
	},
	Streams: []grpc.StreamDesc{
		{
			StreamName:    "StreamEvents",
			Handler:       _TelemetryQuery_StreamEvents_Handler,
			ServerStreams: true,
		},
	},
	Metadata: "telemetry/v1/query.proto",
}

func _TelemetryQuery_QueryEvents_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(QueryEventsRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(TelemetryQueryServer).QueryEvents(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: "/" + TelemetryQueryServiceName + "/QueryEvents",
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(TelemetryQueryServer).QueryEvents(ctx, req.(*QueryEventsRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _TelemetryQuery_GetEventCount_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(GetEventCountRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(TelemetryQueryServer).GetEventCount(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: "/" + TelemetryQueryServiceName + "/GetEventCount",
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(TelemetryQueryServer).GetEventCount(ctx, req.(*GetEventCountRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _TelemetryQuery_SimulatePolicy_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(SimulatePolicyRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(TelemetryQueryServer).SimulatePolicy(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: "/" + TelemetryQueryServiceName + "/SimulatePolicy",
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(TelemetryQueryServer).SimulatePolicy(ctx, req.(*SimulatePolicyRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _TelemetryQuery_StreamEvents_Handler(srv interface{}, stream grpc.ServerStream) error {
	m := new(QueryEventsRequest)
	if err := stream.RecvMsg(m); err != nil {
		return err
	}
	return srv.(TelemetryQueryServer).StreamEvents(m, &telemetryQueryStreamEventsServer{stream})
}

type telemetryQueryStreamEventsServer struct {
	grpc.ServerStream
}

func (x *telemetryQueryStreamEventsServer) Send(m *TelemetryEvent) error {
	return x.ServerStream.SendMsg(m)
}

// Client implementation

type telemetryQueryClient struct {
	cc grpc.ClientConnInterface
}

// NewTelemetryQueryClient creates a new TelemetryQuery client.
func NewTelemetryQueryClient(cc grpc.ClientConnInterface) TelemetryQueryClient {
	return &telemetryQueryClient{cc}
}

func (c *telemetryQueryClient) QueryEvents(ctx context.Context, in *QueryEventsRequest, opts ...grpc.CallOption) (*QueryEventsResponse, error) {
	out := new(QueryEventsResponse)
	err := c.cc.Invoke(ctx, "/"+TelemetryQueryServiceName+"/QueryEvents", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *telemetryQueryClient) StreamEvents(ctx context.Context, in *QueryEventsRequest, opts ...grpc.CallOption) (TelemetryQuery_StreamEventsClient, error) {
	stream, err := c.cc.NewStream(ctx, &TelemetryQuery_ServiceDesc.Streams[0], "/"+TelemetryQueryServiceName+"/StreamEvents", opts...)
	if err != nil {
		return nil, err
	}
	x := &telemetryQueryStreamEventsClient{stream}
	if err := x.ClientStream.SendMsg(in); err != nil {
		return nil, err
	}
	if err := x.ClientStream.CloseSend(); err != nil {
		return nil, err
	}
	return x, nil
}

type telemetryQueryStreamEventsClient struct {
	grpc.ClientStream
}

func (x *telemetryQueryStreamEventsClient) Recv() (*TelemetryEvent, error) {
	m := new(TelemetryEvent)
	if err := x.ClientStream.RecvMsg(m); err != nil {
		return nil, err
	}
	return m, nil
}

func (c *telemetryQueryClient) GetEventCount(ctx context.Context, in *GetEventCountRequest, opts ...grpc.CallOption) (*EventCountResponse, error) {
	out := new(EventCountResponse)
	err := c.cc.Invoke(ctx, "/"+TelemetryQueryServiceName+"/GetEventCount", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *telemetryQueryClient) SimulatePolicy(ctx context.Context, in *SimulatePolicyRequest, opts ...grpc.CallOption) (*SimulatePolicyResponse, error) {
	out := new(SimulatePolicyResponse)
	err := c.cc.Invoke(ctx, "/"+TelemetryQueryServiceName+"/SimulatePolicy", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}
