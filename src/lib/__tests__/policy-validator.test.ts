import { describe, it, expect } from "vitest";
import {
  validatePolicy,
  isValidYaml,
  getExpectedKinds,
  getExpectedApiVersions,
  type PolicyType,
} from "../policy-validator";

describe("policy-validator", () => {
  // ==========================================================================
  // YAML Syntax Validation Tests
  // ==========================================================================
  describe("YAML syntax validation", () => {
    it("should detect invalid YAML indentation", () => {
      // This YAML has a syntax error - the second list item is incorrectly indented
      const invalidYaml = `
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: test
spec:
  egress:
  - toFQDNs:
    - matchPattern: "*.example.com"
      - matchPattern: "*.test.com"
`;
      const result = validatePolicy(invalidYaml, "CILIUM_NETWORK");
      expect(result.valid).toBe(false);
      expect(result.errors[0].type).toBe("syntax");
    });

    it("should detect YAML with mapping error", () => {
      const invalidYaml = `
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: test
spec:
  egress:
  - toEndpoints:
    - k8s:io.kubernetes.pod.namespace=default
      matchLabels:
        app: test
`;
      const result = validatePolicy(invalidYaml, "CILIUM_NETWORK");
      expect(result.valid).toBe(false);
      expect(result.errors[0].type).toBe("syntax");
    });

    it("should detect missing colon in YAML", () => {
      const invalidYaml = `
apiVersion cilium.io/v2
kind: CiliumNetworkPolicy
`;
      const result = validatePolicy(invalidYaml, "CILIUM_NETWORK");
      expect(result.valid).toBe(false);
      expect(result.errors[0].type).toBe("syntax");
    });

    it("should reject empty YAML", () => {
      const result = validatePolicy("", "CILIUM_NETWORK");
      expect(result.valid).toBe(false);
    });

    it("should reject null YAML", () => {
      const result = validatePolicy("null", "CILIUM_NETWORK");
      expect(result.valid).toBe(false);
    });
  });

  // ==========================================================================
  // CiliumNetworkPolicy Validation Tests
  // ==========================================================================
  describe("CiliumNetworkPolicy validation", () => {
    const validCiliumPolicy = `
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: test-policy
  namespace: default
spec:
  endpointSelector:
    matchLabels:
      app: test
  egress:
  - toFQDNs:
    - matchPattern: "*.example.com"
    toPorts:
    - ports:
      - port: "443"
        protocol: TCP
`;

    it("should validate a correct CiliumNetworkPolicy", () => {
      const result = validatePolicy(validCiliumPolicy, "CILIUM_NETWORK");
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject wrong apiVersion", () => {
      const wrongApiVersion = validCiliumPolicy.replace(
        "cilium.io/v2",
        "cilium.io/v1"
      );
      const result = validatePolicy(wrongApiVersion, "CILIUM_NETWORK");
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe("apiVersion");
    });

    it("should reject wrong kind", () => {
      const wrongKind = validCiliumPolicy.replace(
        "CiliumNetworkPolicy",
        "NetworkPolicy"
      );
      const result = validatePolicy(wrongKind, "CILIUM_NETWORK");
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe("kind");
    });

    it("should reject missing metadata.name", () => {
      const noName = `
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  namespace: default
spec:
  endpointSelector: {}
`;
      const result = validatePolicy(noName, "CILIUM_NETWORK");
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "metadata.name")).toBe(true);
    });

    it("should reject missing spec", () => {
      const noSpec = `
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: test
`;
      const result = validatePolicy(noSpec, "CILIUM_NETWORK");
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "spec")).toBe(true);
    });

    it("should reject endpointSelector as array", () => {
      const badSelector = `
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: test
spec:
  endpointSelector:
  - matchLabels:
      app: test
`;
      const result = validatePolicy(badSelector, "CILIUM_NETWORK");
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field === "spec.endpointSelector")
      ).toBe(true);
    });

    it("should reject toFQDNs as object instead of array", () => {
      const badToFQDNs = `
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: test
spec:
  egress:
  - toFQDNs:
      matchPattern: "*.example.com"
`;
      const result = validatePolicy(badToFQDNs, "CILIUM_NETWORK");
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("toFQDNs"))
      ).toBe(true);
    });

    it("should reject toEndpoints as object instead of array", () => {
      const badToEndpoints = `
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: test
spec:
  egress:
  - toEndpoints:
      matchLabels:
        app: test
`;
      const result = validatePolicy(badToEndpoints, "CILIUM_NETWORK");
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("toEndpoints"))
      ).toBe(true);
    });
  });

  // ==========================================================================
  // TracingPolicy (Tetragon) Validation Tests
  // ==========================================================================
  describe("TracingPolicy validation", () => {
    const validTracingPolicy = `
apiVersion: cilium.io/v1alpha1
kind: TracingPolicy
metadata:
  name: block-shells
spec:
  kprobes:
  - call: sys_execve
    syscall: true
    args:
    - index: 0
      type: string
    selectors:
    - matchArgs:
      - index: 0
        operator: Postfix
        values:
        - /sh
        - /bash
      matchActions:
      - action: Sigkill
`;

    it("should validate a correct TracingPolicy", () => {
      const result = validatePolicy(validTracingPolicy, "TETRAGON");
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should accept TracingPolicyNamespaced", () => {
      const namespaced = validTracingPolicy.replace(
        "TracingPolicy",
        "TracingPolicyNamespaced"
      );
      const result = validatePolicy(namespaced, "TETRAGON");
      expect(result.valid).toBe(true);
    });

    it("should reject wrong apiVersion for Tetragon", () => {
      const wrongApi = validTracingPolicy.replace(
        "cilium.io/v1alpha1",
        "cilium.io/v2"
      );
      const result = validatePolicy(wrongApi, "TETRAGON");
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe("apiVersion");
    });

    it("should reject kprobes as object instead of array", () => {
      const badKprobes = `
apiVersion: cilium.io/v1alpha1
kind: TracingPolicy
metadata:
  name: test
spec:
  kprobes:
    call: sys_execve
`;
      const result = validatePolicy(badKprobes, "TETRAGON");
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("kprobes"))
      ).toBe(true);
    });
  });

  // ==========================================================================
  // Gateway API Validation Tests
  // ==========================================================================
  describe("Gateway API validation", () => {
    const validHTTPRoute = `
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: my-route
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
      port: 80
`;

    it("should validate a correct HTTPRoute", () => {
      const result = validatePolicy(validHTTPRoute, "GATEWAY_HTTPROUTE");
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject missing parentRefs", () => {
      const noParentRefs = `
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: my-route
spec:
  hostnames:
  - example.com
`;
      const result = validatePolicy(noParentRefs, "GATEWAY_HTTPROUTE");
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field === "spec.parentRefs")
      ).toBe(true);
    });

    it("should reject parentRefs as object instead of array", () => {
      const badParentRefs = `
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: my-route
spec:
  parentRefs:
    name: my-gateway
`;
      const result = validatePolicy(badParentRefs, "GATEWAY_HTTPROUTE");
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.message.includes("parentRefs"))
      ).toBe(true);
    });
  });

  // ==========================================================================
  // Helper Function Tests
  // ==========================================================================
  describe("helper functions", () => {
    it("isValidYaml should return true for valid YAML", () => {
      expect(isValidYaml("key: value")).toBe(true);
    });

    it("isValidYaml should return false for invalid YAML", () => {
      expect(isValidYaml("key value")).toBe(false);
    });

    it("getExpectedKinds should return correct kinds", () => {
      expect(getExpectedKinds("CILIUM_NETWORK")).toEqual([
        "CiliumNetworkPolicy",
      ]);
      expect(getExpectedKinds("TETRAGON")).toEqual([
        "TracingPolicy",
        "TracingPolicyNamespaced",
      ]);
    });

    it("getExpectedApiVersions should return correct versions", () => {
      expect(getExpectedApiVersions("CILIUM_NETWORK")).toEqual(["cilium.io/v2"]);
      expect(getExpectedApiVersions("TETRAGON")).toEqual(["cilium.io/v1alpha1"]);
    });
  });

  // ==========================================================================
  // Real-World Error Cases
  // ==========================================================================
  describe("real-world error cases", () => {
    it("should catch toFQDNs as object instead of array", () => {
      // When toFQDNs is written without array syntax, it becomes an object
      const badPolicy = `
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: restrict-ollama-egress
  namespace: llm-system
spec:
  endpointSelector:
    matchLabels:
      app: ollama
  egress:
  - toFQDNs:
      matchPattern: "*.cluster.local"
    toPorts:
    - ports:
      - port: "53"
        protocol: UDP
`;
      const result = validatePolicy(badPolicy, "CILIUM_NETWORK");
      expect(result.valid).toBe(false);
      // toFQDNs is an object, not an array
      expect(
        result.errors.some(
          (e) => e.message.includes("toFQDNs") && e.message.includes("array")
        )
      ).toBe(true);
    });

    it("should catch YAML syntax error with mapping values", () => {
      // This is the exact error pattern we hit - "mapping values are not allowed in this context"
      const badPolicy = `
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: test
spec:
  egress:
  - toEndpoints:
    - k8s:io.kubernetes.pod.namespace=default
      matchLabels:
        app: test
`;
      const result = validatePolicy(badPolicy, "CILIUM_NETWORK");
      expect(result.valid).toBe(false);
      expect(result.errors[0].type).toBe("syntax");
    });

    it("should accept the correctly formatted toFQDNs", () => {
      const goodPolicy = `
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: restrict-ollama-egress
  namespace: llm-system
spec:
  endpointSelector:
    matchLabels:
      app: ollama
  egress:
  - toFQDNs:
    - matchPattern: "*.cluster.local"
    - matchPattern: "*.svc.cluster.local"
    toPorts:
    - ports:
      - port: "53"
        protocol: UDP
`;
      const result = validatePolicy(goodPolicy, "CILIUM_NETWORK");
      expect(result.valid).toBe(true);
    });
  });
});
