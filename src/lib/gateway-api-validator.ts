import { TRPCError } from "@trpc/server";
import yaml from "js-yaml";

/**
 * Gateway API YAML Validator
 *
 * This module provides validation utilities for Gateway API resources
 * (HTTPRoute, GRPCRoute, TCPRoute, TLSRoute). It validates YAML structure
 * and extracts metadata for storage.
 *
 * Ported from src/server/routers/gateway-api.ts for use in the consolidated
 * Policy model approach.
 */

// Supported Gateway API route kinds
export const GATEWAY_API_KINDS = [
  "HTTPRoute",
  "GRPCRoute",
  "TCPRoute",
  "TLSRoute",
] as const;

export type GatewayAPIKind = (typeof GATEWAY_API_KINDS)[number];

// Maps PolicyType enum values to Gateway API kinds
export const POLICY_TYPE_TO_KIND: Record<string, GatewayAPIKind> = {
  GATEWAY_HTTPROUTE: "HTTPRoute",
  GATEWAY_GRPCROUTE: "GRPCRoute",
  GATEWAY_TCPROUTE: "TCPRoute",
  GATEWAY_TLSROUTE: "TLSRoute",
};

// Maps Gateway API kinds back to PolicyType enum values
export const KIND_TO_POLICY_TYPE: Record<GatewayAPIKind, string> = {
  HTTPRoute: "GATEWAY_HTTPROUTE",
  GRPCRoute: "GATEWAY_GRPCROUTE",
  TCPRoute: "GATEWAY_TCPROUTE",
  TLSRoute: "GATEWAY_TLSROUTE",
};

/**
 * Parsed Gateway API resource metadata
 */
export interface ParsedGatewayAPIResource {
  name: string;
  namespace: string;
  kind: string;
  parentRefs: unknown[];
  hostnames: string[] | null;
  rules: unknown[];
  labels: Record<string, string> | null;
  annotations: Record<string, string> | null;
}

/**
 * Validates a policy type is a Gateway API type
 */
export function isGatewayAPIType(policyType: string): boolean {
  return policyType.startsWith("GATEWAY_");
}

/**
 * Gets the expected Gateway API kind from a policy type
 */
export function getExpectedKind(policyType: string): GatewayAPIKind | null {
  return POLICY_TYPE_TO_KIND[policyType] ?? null;
}

/**
 * Detects the policy type from YAML content by parsing the kind field.
 * This enables bidirectional validation - given YAML, determine what policy type it should be.
 *
 * @param yamlContent - The raw YAML string to parse
 * @returns The detected policy type (GATEWAY_HTTPROUTE, etc.) or null if not a Gateway API resource
 * @throws TRPCError if YAML is invalid
 */
export function detectPolicyTypeFromYaml(yamlContent: string): string | null {
  let doc: Record<string, unknown>;
  try {
    doc = yaml.load(yamlContent) as Record<string, unknown>;
  } catch (e) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Invalid YAML syntax: ${e instanceof Error ? e.message : "parse error"}`,
    });
  }

  if (!doc || typeof doc !== "object") {
    return null;
  }

  const kind = doc.kind as string;
  const apiVersion = doc.apiVersion as string;

  // Must be a Gateway API resource
  if (!apiVersion?.startsWith("gateway.networking.k8s.io/")) {
    return null;
  }

  // Check if kind is a supported Gateway API route kind
  if (!GATEWAY_API_KINDS.includes(kind as GatewayAPIKind)) {
    return null;
  }

  return KIND_TO_POLICY_TYPE[kind as GatewayAPIKind] ?? null;
}

/**
 * Validates that the provided policy type matches the YAML content's kind.
 * Throws if there's a mismatch between what the user selected and what the YAML contains.
 *
 * @param yamlContent - The raw YAML string
 * @param declaredPolicyType - The policy type the user selected
 * @throws TRPCError if types don't match
 */
export function validatePolicyTypeMatchesYaml(
  yamlContent: string,
  declaredPolicyType: string
): void {
  const detectedType = detectPolicyTypeFromYaml(yamlContent);

  // If it's not a Gateway API resource, skip bidirectional check
  if (!detectedType && !isGatewayAPIType(declaredPolicyType)) {
    return;
  }

  // If user declared Gateway type but YAML is not Gateway API
  if (isGatewayAPIType(declaredPolicyType) && !detectedType) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Policy type ${declaredPolicyType} expects a Gateway API resource, but YAML does not contain a valid Gateway API kind`,
    });
  }

  // If YAML is Gateway API but user declared non-Gateway type
  if (detectedType && !isGatewayAPIType(declaredPolicyType)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `YAML contains Gateway API ${detectedType} resource, but policy type was set to ${declaredPolicyType}`,
    });
  }

  // Both are Gateway API - verify they match
  if (detectedType && detectedType !== declaredPolicyType) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Type mismatch: YAML contains ${detectedType} but policy type was set to ${declaredPolicyType}`,
    });
  }
}

/**
 * Parses and validates Gateway API YAML content
 *
 * @param yamlContent - The raw YAML string to parse
 * @param expectedKind - The expected Gateway API kind (HTTPRoute, GRPCRoute, etc.)
 * @returns Parsed metadata extracted from the YAML
 * @throws TRPCError with BAD_REQUEST code if validation fails
 */
export function parseGatewayAPIYaml(
  yamlContent: string,
  expectedKind: string
): ParsedGatewayAPIResource {
  // Parse YAML
  let doc: Record<string, unknown>;
  try {
    doc = yaml.load(yamlContent) as Record<string, unknown>;
  } catch (e) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Invalid YAML syntax: ${e instanceof Error ? e.message : "parse error"}`,
    });
  }

  if (!doc || typeof doc !== "object") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid YAML: expected an object",
    });
  }

  // Validate kind field
  const kind = doc.kind as string;
  if (!kind) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid YAML: missing 'kind' field",
    });
  }

  if (kind !== expectedKind) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Kind mismatch: expected ${expectedKind}, got ${kind}`,
    });
  }

  // Validate metadata
  const metadata = doc.metadata as Record<string, unknown> | undefined;
  if (!metadata || typeof metadata !== "object") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid YAML: missing 'metadata' field",
    });
  }

  const name = metadata.name as string;
  const namespace = (metadata.namespace as string) || "default";

  if (!name) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid YAML: missing 'metadata.name' field",
    });
  }

  // Validate apiVersion for Gateway API resources
  const apiVersion = doc.apiVersion as string;
  if (!apiVersion) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid YAML: missing 'apiVersion' field",
    });
  }

  // Gateway API resources should have gateway.networking.k8s.io apiVersion
  if (!apiVersion.startsWith("gateway.networking.k8s.io/")) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Invalid apiVersion for ${kind}: expected gateway.networking.k8s.io/*, got ${apiVersion}`,
    });
  }

  const spec = doc.spec as Record<string, unknown> | undefined;

  // Extract Gateway API specific fields
  let parentRefs: unknown[] = [];
  let hostnames: string[] | null = null;
  let rules: unknown[] = [];

  if (spec) {
    // Routes have parentRefs (references to Gateway resources)
    if (Array.isArray(spec.parentRefs)) {
      parentRefs = spec.parentRefs;

      // Validate parentRefs structure
      for (const ref of parentRefs) {
        if (typeof ref !== "object" || ref === null) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid parentRef: each parentRef must be an object",
          });
        }
        const parentRef = ref as Record<string, unknown>;
        if (!parentRef.name) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Invalid parentRef: missing 'name' field (Gateway reference)",
          });
        }
      }
    } else if (kind !== "Gateway" && kind !== "ReferenceGrant") {
      // Routes require parentRefs
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Invalid ${kind}: missing 'spec.parentRefs' field (Gateway reference required)`,
      });
    }

    // HTTPRoute, GRPCRoute, TLSRoute have hostnames
    if (Array.isArray(spec.hostnames)) {
      hostnames = spec.hostnames as string[];
    }

    // Routes have rules
    if (Array.isArray(spec.rules)) {
      rules = spec.rules;
    }
  } else {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid YAML: missing 'spec' field",
    });
  }

  return {
    name,
    namespace,
    kind,
    parentRefs,
    hostnames,
    rules,
    labels: metadata.labels
      ? (metadata.labels as Record<string, string>)
      : null,
    annotations: metadata.annotations
      ? (metadata.annotations as Record<string, string>)
      : null,
  };
}

/**
 * Validates Gateway API YAML for a given policy type
 *
 * This is a convenience wrapper that determines the expected kind
 * from the policy type.
 *
 * @param yamlContent - The raw YAML string to parse
 * @param policyType - The policy type (GATEWAY_HTTPROUTE, etc.)
 * @returns Parsed metadata extracted from the YAML
 * @throws TRPCError with BAD_REQUEST code if validation fails
 */
export function validateGatewayAPIPolicy(
  yamlContent: string,
  policyType: string
): ParsedGatewayAPIResource {
  const expectedKind = getExpectedKind(policyType);

  if (!expectedKind) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Unknown Gateway API policy type: ${policyType}`,
    });
  }

  return parseGatewayAPIYaml(yamlContent, expectedKind);
}
