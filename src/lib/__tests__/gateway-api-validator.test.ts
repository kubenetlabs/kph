import { describe, it, expect } from "vitest";
import {
  parseGatewayAPIYaml,
  validateGatewayAPIPolicy,
  isGatewayAPIType,
  getExpectedKind,
  GATEWAY_API_KINDS,
  POLICY_TYPE_TO_KIND,
  KIND_TO_POLICY_TYPE,
} from "../gateway-api-validator";

describe("Gateway API Validator", () => {
  describe("isGatewayAPIType", () => {
    it("returns true for GATEWAY_* types", () => {
      expect(isGatewayAPIType("GATEWAY_HTTPROUTE")).toBe(true);
      expect(isGatewayAPIType("GATEWAY_GRPCROUTE")).toBe(true);
      expect(isGatewayAPIType("GATEWAY_TCPROUTE")).toBe(true);
      expect(isGatewayAPIType("GATEWAY_TLSROUTE")).toBe(true);
    });

    it("returns false for non-Gateway types", () => {
      expect(isGatewayAPIType("CILIUM_NETWORK")).toBe(false);
      expect(isGatewayAPIType("TETRAGON")).toBe(false);
      expect(isGatewayAPIType("RANDOM_TYPE")).toBe(false);
    });
  });

  describe("getExpectedKind", () => {
    it("maps policy types to Gateway API kinds", () => {
      expect(getExpectedKind("GATEWAY_HTTPROUTE")).toBe("HTTPRoute");
      expect(getExpectedKind("GATEWAY_GRPCROUTE")).toBe("GRPCRoute");
      expect(getExpectedKind("GATEWAY_TCPROUTE")).toBe("TCPRoute");
      expect(getExpectedKind("GATEWAY_TLSROUTE")).toBe("TLSRoute");
    });

    it("returns null for unknown types", () => {
      expect(getExpectedKind("CILIUM_NETWORK")).toBe(null);
      expect(getExpectedKind("UNKNOWN")).toBe(null);
    });
  });

  describe("parseGatewayAPIYaml - HTTPRoute", () => {
    const validHTTPRoute = `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: test-route
  namespace: default
spec:
  parentRefs:
    - name: my-gateway
  hostnames:
    - example.com
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /api
      backendRefs:
        - name: api-service
          port: 80`;

    it("parses valid HTTPRoute YAML", () => {
      const result = parseGatewayAPIYaml(validHTTPRoute, "HTTPRoute");

      expect(result.name).toBe("test-route");
      expect(result.namespace).toBe("default");
      expect(result.kind).toBe("HTTPRoute");
      expect(result.parentRefs).toHaveLength(1);
      expect(result.hostnames).toEqual(["example.com"]);
      expect(result.rules).toHaveLength(1);
    });

    it("defaults namespace to 'default' if not specified", () => {
      const yamlWithoutNamespace = `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: test-route
spec:
  parentRefs:
    - name: my-gateway
  rules: []`;

      const result = parseGatewayAPIYaml(yamlWithoutNamespace, "HTTPRoute");
      expect(result.namespace).toBe("default");
    });

    it("throws on kind mismatch", () => {
      expect(() => parseGatewayAPIYaml(validHTTPRoute, "GRPCRoute")).toThrow(
        "Kind mismatch: expected GRPCRoute, got HTTPRoute"
      );
    });
  });

  describe("parseGatewayAPIYaml - GRPCRoute", () => {
    const validGRPCRoute = `apiVersion: gateway.networking.k8s.io/v1alpha2
kind: GRPCRoute
metadata:
  name: grpc-route
  namespace: production
spec:
  parentRefs:
    - name: grpc-gateway
  hostnames:
    - grpc.example.com
  rules:
    - matches:
        - method:
            service: myservice
      backendRefs:
        - name: grpc-service
          port: 9090`;

    it("parses valid GRPCRoute YAML", () => {
      const result = parseGatewayAPIYaml(validGRPCRoute, "GRPCRoute");

      expect(result.name).toBe("grpc-route");
      expect(result.namespace).toBe("production");
      expect(result.kind).toBe("GRPCRoute");
      expect(result.parentRefs).toHaveLength(1);
      expect(result.hostnames).toEqual(["grpc.example.com"]);
    });
  });

  describe("parseGatewayAPIYaml - TCPRoute", () => {
    const validTCPRoute = `apiVersion: gateway.networking.k8s.io/v1alpha2
kind: TCPRoute
metadata:
  name: tcp-route
  namespace: database
spec:
  parentRefs:
    - name: tcp-gateway
  rules:
    - backendRefs:
        - name: postgres
          port: 5432`;

    it("parses valid TCPRoute YAML", () => {
      const result = parseGatewayAPIYaml(validTCPRoute, "TCPRoute");

      expect(result.name).toBe("tcp-route");
      expect(result.namespace).toBe("database");
      expect(result.kind).toBe("TCPRoute");
      expect(result.hostnames).toBe(null); // TCPRoute doesn't have hostnames
    });
  });

  describe("parseGatewayAPIYaml - TLSRoute", () => {
    const validTLSRoute = `apiVersion: gateway.networking.k8s.io/v1alpha2
kind: TLSRoute
metadata:
  name: tls-route
  namespace: secure
spec:
  parentRefs:
    - name: tls-gateway
  hostnames:
    - secure.example.com
  rules:
    - backendRefs:
        - name: tls-service
          port: 443`;

    it("parses valid TLSRoute YAML", () => {
      const result = parseGatewayAPIYaml(validTLSRoute, "TLSRoute");

      expect(result.name).toBe("tls-route");
      expect(result.namespace).toBe("secure");
      expect(result.kind).toBe("TLSRoute");
      expect(result.hostnames).toEqual(["secure.example.com"]);
    });
  });

  describe("parseGatewayAPIYaml - Error cases", () => {
    it("throws on invalid YAML syntax", () => {
      const invalidYaml = `
        not: valid: yaml:
        this is broken
      `;
      expect(() => parseGatewayAPIYaml(invalidYaml, "HTTPRoute")).toThrow(
        "Invalid YAML syntax"
      );
    });

    it("throws on missing kind field", () => {
      const noKind = `apiVersion: gateway.networking.k8s.io/v1
metadata:
  name: test
spec:
  parentRefs: []
  rules: []`;
      expect(() => parseGatewayAPIYaml(noKind, "HTTPRoute")).toThrow(
        "missing 'kind' field"
      );
    });

    it("throws on missing metadata field", () => {
      const noMetadata = `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
spec:
  parentRefs: []
  rules: []`;
      expect(() => parseGatewayAPIYaml(noMetadata, "HTTPRoute")).toThrow(
        "missing 'metadata' field"
      );
    });

    it("throws on missing metadata.name field", () => {
      const noName = `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  namespace: default
spec:
  parentRefs: []
  rules: []`;
      expect(() => parseGatewayAPIYaml(noName, "HTTPRoute")).toThrow(
        "missing 'metadata.name' field"
      );
    });

    it("throws on missing apiVersion field", () => {
      const noApiVersion = `kind: HTTPRoute
metadata:
  name: test
spec:
  parentRefs: []
  rules: []`;
      expect(() => parseGatewayAPIYaml(noApiVersion, "HTTPRoute")).toThrow(
        "missing 'apiVersion' field"
      );
    });

    it("throws on invalid apiVersion for Gateway API", () => {
      const wrongApiVersion = `apiVersion: cilium.io/v2
kind: HTTPRoute
metadata:
  name: test
spec:
  parentRefs: []
  rules: []`;
      expect(() => parseGatewayAPIYaml(wrongApiVersion, "HTTPRoute")).toThrow(
        "Invalid apiVersion for HTTPRoute: expected gateway.networking.k8s.io/*, got cilium.io/v2"
      );
    });

    it("throws on missing spec field", () => {
      const noSpec = `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: test`;
      expect(() => parseGatewayAPIYaml(noSpec, "HTTPRoute")).toThrow(
        "missing 'spec' field"
      );
    });

    it("throws on missing parentRefs for routes", () => {
      const noParentRefs = `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: test
spec:
  rules: []`;
      expect(() => parseGatewayAPIYaml(noParentRefs, "HTTPRoute")).toThrow(
        "missing 'spec.parentRefs' field"
      );
    });

    it("throws on invalid parentRef (missing name)", () => {
      const invalidParentRef = `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: test
spec:
  parentRefs:
    - namespace: default
  rules: []`;
      expect(() => parseGatewayAPIYaml(invalidParentRef, "HTTPRoute")).toThrow(
        "Invalid parentRef: missing 'name' field"
      );
    });
  });

  describe("validateGatewayAPIPolicy", () => {
    const validHTTPRoute = `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: test-route
  namespace: default
spec:
  parentRefs:
    - name: my-gateway
  rules: []`;

    it("validates GATEWAY_HTTPROUTE policy type", () => {
      const result = validateGatewayAPIPolicy(
        validHTTPRoute,
        "GATEWAY_HTTPROUTE"
      );
      expect(result.name).toBe("test-route");
      expect(result.kind).toBe("HTTPRoute");
    });

    it("throws on unknown policy type", () => {
      expect(() =>
        validateGatewayAPIPolicy(validHTTPRoute, "UNKNOWN_TYPE")
      ).toThrow("Unknown Gateway API policy type: UNKNOWN_TYPE");
    });

    it("throws on policy type mismatch with YAML", () => {
      expect(() =>
        validateGatewayAPIPolicy(validHTTPRoute, "GATEWAY_GRPCROUTE")
      ).toThrow("Kind mismatch: expected GRPCRoute, got HTTPRoute");
    });
  });

  describe("Type mappings", () => {
    it("GATEWAY_API_KINDS contains all route types", () => {
      expect(GATEWAY_API_KINDS).toContain("HTTPRoute");
      expect(GATEWAY_API_KINDS).toContain("GRPCRoute");
      expect(GATEWAY_API_KINDS).toContain("TCPRoute");
      expect(GATEWAY_API_KINDS).toContain("TLSRoute");
    });

    it("POLICY_TYPE_TO_KIND maps all types", () => {
      expect(POLICY_TYPE_TO_KIND.GATEWAY_HTTPROUTE).toBe("HTTPRoute");
      expect(POLICY_TYPE_TO_KIND.GATEWAY_GRPCROUTE).toBe("GRPCRoute");
      expect(POLICY_TYPE_TO_KIND.GATEWAY_TCPROUTE).toBe("TCPRoute");
      expect(POLICY_TYPE_TO_KIND.GATEWAY_TLSROUTE).toBe("TLSRoute");
    });

    it("KIND_TO_POLICY_TYPE maps all kinds", () => {
      expect(KIND_TO_POLICY_TYPE.HTTPRoute).toBe("GATEWAY_HTTPROUTE");
      expect(KIND_TO_POLICY_TYPE.GRPCRoute).toBe("GATEWAY_GRPCROUTE");
      expect(KIND_TO_POLICY_TYPE.TCPRoute).toBe("GATEWAY_TCPROUTE");
      expect(KIND_TO_POLICY_TYPE.TLSRoute).toBe("GATEWAY_TLSROUTE");
    });
  });

  describe("Labels and annotations extraction", () => {
    const yamlWithMeta = `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: labeled-route
  namespace: default
  labels:
    app: frontend
    version: v1
  annotations:
    description: Test route
spec:
  parentRefs:
    - name: my-gateway
  rules: []`;

    it("extracts labels from metadata", () => {
      const result = parseGatewayAPIYaml(yamlWithMeta, "HTTPRoute");
      expect(result.labels).toEqual({
        app: "frontend",
        version: "v1",
      });
    });

    it("extracts annotations from metadata", () => {
      const result = parseGatewayAPIYaml(yamlWithMeta, "HTTPRoute");
      expect(result.annotations).toEqual({
        description: "Test route",
      });
    });

    it("returns null for missing labels/annotations", () => {
      const simpleYaml = `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: simple-route
spec:
  parentRefs:
    - name: my-gateway
  rules: []`;

      const result = parseGatewayAPIYaml(simpleYaml, "HTTPRoute");
      expect(result.labels).toBe(null);
      expect(result.annotations).toBe(null);
    });
  });
});
