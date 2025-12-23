package query

import (
	"testing"

	"google.golang.org/grpc"
)

func TestTelemetryQueryServiceName(t *testing.T) {
	expected := "policyhub.telemetry.v1.TelemetryQuery"
	if TelemetryQueryServiceName != expected {
		t.Errorf("TelemetryQueryServiceName = %s, want %s", TelemetryQueryServiceName, expected)
	}
}

func TestTelemetryQuery_ServiceDesc(t *testing.T) {
	desc := TelemetryQuery_ServiceDesc

	// Check service name
	if desc.ServiceName != TelemetryQueryServiceName {
		t.Errorf("ServiceName = %s, want %s", desc.ServiceName, TelemetryQueryServiceName)
	}

	// Check handler type
	if desc.HandlerType == nil {
		t.Error("HandlerType should not be nil")
	}

	// Check metadata
	if desc.Metadata != "telemetry/v1/query.proto" {
		t.Errorf("Metadata = %s, want telemetry/v1/query.proto", desc.Metadata)
	}
}

func TestTelemetryQuery_ServiceDesc_Methods(t *testing.T) {
	desc := TelemetryQuery_ServiceDesc

	// Should have 3 methods
	if len(desc.Methods) != 3 {
		t.Errorf("Methods count = %d, want 3", len(desc.Methods))
	}

	// Check expected methods exist
	expectedMethods := map[string]bool{
		"QueryEvents":    false,
		"GetEventCount":  false,
		"SimulatePolicy": false,
	}

	for _, method := range desc.Methods {
		if _, exists := expectedMethods[method.MethodName]; exists {
			expectedMethods[method.MethodName] = true
		}
		if method.Handler == nil {
			t.Errorf("Method %s has nil handler", method.MethodName)
		}
	}

	for name, found := range expectedMethods {
		if !found {
			t.Errorf("Method %s not found", name)
		}
	}
}

func TestTelemetryQuery_ServiceDesc_Streams(t *testing.T) {
	desc := TelemetryQuery_ServiceDesc

	// Should have 1 stream
	if len(desc.Streams) != 1 {
		t.Errorf("Streams count = %d, want 1", len(desc.Streams))
	}

	// Check StreamEvents stream
	if len(desc.Streams) > 0 {
		stream := desc.Streams[0]
		if stream.StreamName != "StreamEvents" {
			t.Errorf("StreamName = %s, want StreamEvents", stream.StreamName)
		}
		if !stream.ServerStreams {
			t.Error("ServerStreams should be true")
		}
		if stream.ClientStreams {
			t.Error("ClientStreams should be false")
		}
		if stream.Handler == nil {
			t.Error("Stream handler should not be nil")
		}
	}
}

func TestRegisterTelemetryQueryServer(t *testing.T) {
	// Create a gRPC server
	grpcServer := grpc.NewServer()
	defer grpcServer.Stop()

	// Create a mock implementation using UnimplementedTelemetryQueryServer
	var srv UnimplementedTelemetryQueryServer

	// Register should not panic
	RegisterTelemetryQueryServer(grpcServer, &srv)

	// Get service info to verify registration
	info := grpcServer.GetServiceInfo()
	if _, ok := info[TelemetryQueryServiceName]; !ok {
		t.Errorf("Service %s not registered", TelemetryQueryServiceName)
	}
}

func TestRegisterTelemetryQueryServer_ServiceInfo(t *testing.T) {
	grpcServer := grpc.NewServer()
	defer grpcServer.Stop()

	var srv UnimplementedTelemetryQueryServer
	RegisterTelemetryQueryServer(grpcServer, &srv)

	info := grpcServer.GetServiceInfo()
	serviceInfo, ok := info[TelemetryQueryServiceName]
	if !ok {
		t.Fatalf("Service %s not found", TelemetryQueryServiceName)
	}

	// Verify methods are registered
	methodNames := make(map[string]bool)
	for _, method := range serviceInfo.Methods {
		methodNames[method.Name] = true
	}

	expectedMethods := []string{"QueryEvents", "GetEventCount", "SimulatePolicy", "StreamEvents"}
	for _, expected := range expectedMethods {
		if !methodNames[expected] {
			t.Errorf("Method %s not found in service info", expected)
		}
	}
}

func TestNewTelemetryQueryClient(t *testing.T) {
	// Create a mock client connection
	// We can't actually connect, but we can verify the function exists and returns non-nil
	// This is a compile-time check that the interface is properly implemented

	// Type check - ensure telemetryQueryClient implements TelemetryQueryClient
	var _ TelemetryQueryClient = (*telemetryQueryClient)(nil)
}

func TestTelemetryQueryStreamEventsServer(t *testing.T) {
	// Verify that TelemetryQuery_StreamEventsServer interface exists
	// and has the expected methods
	var _ TelemetryQuery_StreamEventsServer = (*telemetryQueryStreamEventsServer)(nil)
}

func TestTelemetryQueryStreamEventsClient(t *testing.T) {
	// Verify that TelemetryQuery_StreamEventsClient interface exists
	var _ TelemetryQuery_StreamEventsClient = (*telemetryQueryStreamEventsClient)(nil)
}

func TestQueryEventsHandler_FullMethod(t *testing.T) {
	expected := "/" + TelemetryQueryServiceName + "/QueryEvents"

	// The full method is constructed in the handler
	// We verify the service name is correct
	if TelemetryQueryServiceName != "policyhub.telemetry.v1.TelemetryQuery" {
		t.Errorf("Service name incorrect, full method would be wrong")
	}

	// Verify expected format
	if expected != "/policyhub.telemetry.v1.TelemetryQuery/QueryEvents" {
		t.Errorf("Expected full method = %s", expected)
	}
}

func TestGetEventCountHandler_FullMethod(t *testing.T) {
	expected := "/" + TelemetryQueryServiceName + "/GetEventCount"

	if expected != "/policyhub.telemetry.v1.TelemetryQuery/GetEventCount" {
		t.Errorf("Expected full method = %s", expected)
	}
}

func TestSimulatePolicyHandler_FullMethod(t *testing.T) {
	expected := "/" + TelemetryQueryServiceName + "/SimulatePolicy"

	if expected != "/policyhub.telemetry.v1.TelemetryQuery/SimulatePolicy" {
		t.Errorf("Expected full method = %s", expected)
	}
}

func TestStreamEventsHandler_FullMethod(t *testing.T) {
	expected := "/" + TelemetryQueryServiceName + "/StreamEvents"

	if expected != "/policyhub.telemetry.v1.TelemetryQuery/StreamEvents" {
		t.Errorf("Expected full method = %s", expected)
	}
}

// Test that the service descriptor is properly structured
func TestServiceDescriptor_Structure(t *testing.T) {
	desc := TelemetryQuery_ServiceDesc

	// Verify it's a valid ServiceDesc
	if desc.ServiceName == "" {
		t.Error("ServiceName should not be empty")
	}

	// Each method should have a handler
	for i, method := range desc.Methods {
		if method.MethodName == "" {
			t.Errorf("Method[%d].MethodName is empty", i)
		}
		if method.Handler == nil {
			t.Errorf("Method[%d].Handler is nil", i)
		}
	}

	// Each stream should have a handler
	for i, stream := range desc.Streams {
		if stream.StreamName == "" {
			t.Errorf("Stream[%d].StreamName is empty", i)
		}
		if stream.Handler == nil {
			t.Errorf("Stream[%d].Handler is nil", i)
		}
	}
}
