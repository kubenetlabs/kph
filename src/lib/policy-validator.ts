/**
 * Unified Policy YAML Validator
 *
 * Provides two-layer validation for all policy types:
 * 1. YAML syntax validation
 * 2. Schema validation (structure, required fields, types)
 */

import yaml from "js-yaml";

// ============================================================================
// Types
// ============================================================================

export type PolicyType =
  | "CILIUM_NETWORK"
  | "CILIUM_CLUSTERWIDE"
  | "TETRAGON"
  | "GATEWAY_HTTPROUTE"
  | "GATEWAY_GRPCROUTE"
  | "GATEWAY_TCPROUTE"
  | "GATEWAY_TLSROUTE";

export interface ValidationError {
  type: "syntax" | "schema" | "field";
  message: string;
  line?: number;
  field?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  parsed?: Record<string, unknown>;
}

// ============================================================================
// Policy Type Configurations
// ============================================================================

interface PolicyConfig {
  expectedKinds: string[];
  expectedApiVersions: string[];
  requiredFields: string[];
  arrayFields: string[];
}

const POLICY_CONFIGS: Record<PolicyType, PolicyConfig> = {
  CILIUM_NETWORK: {
    expectedKinds: ["CiliumNetworkPolicy"],
    expectedApiVersions: ["cilium.io/v2"],
    requiredFields: ["metadata.name", "spec"],
    arrayFields: [
      "spec.ingress",
      "spec.egress",
      "spec.ingress[].fromEndpoints",
      "spec.ingress[].toPorts",
      "spec.ingress[].fromCIDR",
      "spec.ingress[].fromCIDRSet",
      "spec.egress[].toEndpoints",
      "spec.egress[].toPorts",
      "spec.egress[].toFQDNs",
      "spec.egress[].toCIDR",
      "spec.egress[].toCIDRSet",
    ],
  },
  CILIUM_CLUSTERWIDE: {
    expectedKinds: ["CiliumClusterwideNetworkPolicy"],
    expectedApiVersions: ["cilium.io/v2"],
    requiredFields: ["metadata.name", "spec"],
    arrayFields: [
      "spec.ingress",
      "spec.egress",
      "spec.ingress[].fromEndpoints",
      "spec.ingress[].toPorts",
      "spec.egress[].toEndpoints",
      "spec.egress[].toPorts",
      "spec.egress[].toFQDNs",
    ],
  },
  TETRAGON: {
    expectedKinds: ["TracingPolicy", "TracingPolicyNamespaced"],
    expectedApiVersions: ["cilium.io/v1alpha1"],
    requiredFields: ["metadata.name", "spec"],
    arrayFields: [
      "spec.kprobes",
      "spec.tracepoints",
      "spec.kprobes[].args",
      "spec.kprobes[].selectors",
      "spec.kprobes[].selectors[].matchArgs",
      "spec.kprobes[].selectors[].matchActions",
      "spec.kprobes[].selectors[].matchBinaries",
      "spec.kprobes[].selectors[].matchNamespaces",
    ],
  },
  GATEWAY_HTTPROUTE: {
    expectedKinds: ["HTTPRoute"],
    expectedApiVersions: ["gateway.networking.k8s.io/v1", "gateway.networking.k8s.io/v1beta1"],
    requiredFields: ["metadata.name", "spec", "spec.parentRefs"],
    arrayFields: ["spec.parentRefs", "spec.hostnames", "spec.rules"],
  },
  GATEWAY_GRPCROUTE: {
    expectedKinds: ["GRPCRoute"],
    expectedApiVersions: ["gateway.networking.k8s.io/v1alpha2", "gateway.networking.k8s.io/v1"],
    requiredFields: ["metadata.name", "spec", "spec.parentRefs"],
    arrayFields: ["spec.parentRefs", "spec.hostnames", "spec.rules"],
  },
  GATEWAY_TCPROUTE: {
    expectedKinds: ["TCPRoute"],
    expectedApiVersions: ["gateway.networking.k8s.io/v1alpha2"],
    requiredFields: ["metadata.name", "spec", "spec.parentRefs"],
    arrayFields: ["spec.parentRefs", "spec.rules"],
  },
  GATEWAY_TLSROUTE: {
    expectedKinds: ["TLSRoute"],
    expectedApiVersions: ["gateway.networking.k8s.io/v1alpha2"],
    requiredFields: ["metadata.name", "spec", "spec.parentRefs"],
    arrayFields: ["spec.parentRefs", "spec.hostnames", "spec.rules"],
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Safely get a nested field value from an object using dot notation
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Check if a value is a plain object (not null, not array)
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Extract line number from YAML error if available
 */
function extractLineNumber(error: unknown): number | undefined {
  if (error instanceof yaml.YAMLException && error.mark) {
    return error.mark.line + 1; // js-yaml uses 0-indexed lines
  }
  return undefined;
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Layer 1: Parse YAML and catch syntax errors
 */
function parseYamlSafely(yamlContent: string): {
  success: boolean;
  data?: Record<string, unknown>;
  error?: ValidationError;
} {
  try {
    const parsed = yaml.load(yamlContent);

    if (parsed === null || parsed === undefined) {
      return {
        success: false,
        error: {
          type: "syntax",
          message: "YAML content is empty or null",
        },
      };
    }

    if (!isPlainObject(parsed)) {
      return {
        success: false,
        error: {
          type: "syntax",
          message: "YAML must be an object at the root level",
        },
      };
    }

    return { success: true, data: parsed };
  } catch (e) {
    const line = extractLineNumber(e);
    const message = e instanceof Error ? e.message : "Unknown parse error";

    // Clean up the error message for better readability
    const cleanMessage = message
      .replace(/^YAMLException:\s*/, "")
      .replace(/\s+at line \d+.*$/, "");

    return {
      success: false,
      error: {
        type: "syntax",
        message: `Invalid YAML syntax${line ? ` at line ${line}` : ""}: ${cleanMessage}`,
        line,
      },
    };
  }
}

/**
 * Validate apiVersion matches expected values for policy type
 */
function validateApiVersion(
  doc: Record<string, unknown>,
  config: PolicyConfig
): ValidationError | null {
  const apiVersion = doc.apiVersion as string | undefined;

  if (!apiVersion) {
    return {
      type: "field",
      message: "Missing required field: apiVersion",
      field: "apiVersion",
    };
  }

  if (!config.expectedApiVersions.includes(apiVersion)) {
    return {
      type: "schema",
      message: `Invalid apiVersion '${apiVersion}'. Expected one of: ${config.expectedApiVersions.join(", ")}`,
      field: "apiVersion",
    };
  }

  return null;
}

/**
 * Validate kind matches expected values for policy type
 */
function validateKind(
  doc: Record<string, unknown>,
  config: PolicyConfig
): ValidationError | null {
  const kind = doc.kind as string | undefined;

  if (!kind) {
    return {
      type: "field",
      message: "Missing required field: kind",
      field: "kind",
    };
  }

  if (!config.expectedKinds.includes(kind)) {
    return {
      type: "schema",
      message: `Invalid kind '${kind}'. Expected one of: ${config.expectedKinds.join(", ")}`,
      field: "kind",
    };
  }

  return null;
}

/**
 * Validate required fields exist
 */
function validateRequiredFields(
  doc: Record<string, unknown>,
  config: PolicyConfig
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const field of config.requiredFields) {
    const value = getNestedValue(doc, field);
    if (value === undefined || value === null) {
      errors.push({
        type: "field",
        message: `Missing required field: ${field}`,
        field,
      });
    }
  }

  return errors;
}

/**
 * Validate that fields expected to be arrays are actually arrays
 * This catches the common "toFQDNs as object instead of array" error
 */
function validateArrayFields(
  doc: Record<string, unknown>,
  config: PolicyConfig
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const fieldPath of config.arrayFields) {
    // Handle array notation like "spec.egress[].toFQDNs"
    if (fieldPath.includes("[]")) {
      const [parentPath, childField] = fieldPath.split("[].");
      if (!parentPath || !childField) continue;

      const parentValue = getNestedValue(doc, parentPath);
      if (!Array.isArray(parentValue)) continue;

      // Check each item in the parent array
      for (let i = 0; i < parentValue.length; i++) {
        const item: unknown = parentValue[i];
        if (!isPlainObject(item)) continue;

        const childValue = item[childField];
        if (childValue !== undefined && !Array.isArray(childValue)) {
          errors.push({
            type: "schema",
            message: `Field '${parentPath}[${i}].${childField}' must be an array, got ${typeof childValue}`,
            field: `${parentPath}[${i}].${childField}`,
          });
        }
      }
    } else {
      // Simple field path
      const value = getNestedValue(doc, fieldPath);
      if (value !== undefined && !Array.isArray(value)) {
        errors.push({
          type: "schema",
          message: `Field '${fieldPath}' must be an array, got ${typeof value}`,
          field: fieldPath,
        });
      }
    }
  }

  return errors;
}

/**
 * Cilium-specific validation for endpointSelector
 */
function validateCiliumEndpointSelector(
  doc: Record<string, unknown>
): ValidationError[] {
  const errors: ValidationError[] = [];
  const spec = doc.spec as Record<string, unknown> | undefined;

  if (!spec) return errors;

  const endpointSelector = spec.endpointSelector;
  if (endpointSelector !== undefined) {
    if (Array.isArray(endpointSelector)) {
      errors.push({
        type: "schema",
        message: "Field 'spec.endpointSelector' must be an object, got array",
        field: "spec.endpointSelector",
      });
    } else if (!isPlainObject(endpointSelector)) {
      errors.push({
        type: "schema",
        message: `Field 'spec.endpointSelector' must be an object, got ${typeof endpointSelector}`,
        field: "spec.endpointSelector",
      });
    }
  }

  return errors;
}

/**
 * Layer 2: Validate policy schema based on policy type
 */
function validatePolicySchema(
  doc: Record<string, unknown>,
  policyType: PolicyType
): ValidationError[] {
  const config = POLICY_CONFIGS[policyType];
  if (!config) {
    return [
      {
        type: "schema",
        message: `Unknown policy type: ${policyType}`,
      },
    ];
  }

  const errors: ValidationError[] = [];

  // Validate apiVersion
  const apiVersionError = validateApiVersion(doc, config);
  if (apiVersionError) {
    errors.push(apiVersionError);
  }

  // Validate kind
  const kindError = validateKind(doc, config);
  if (kindError) {
    errors.push(kindError);
  }

  // Validate required fields
  errors.push(...validateRequiredFields(doc, config));

  // Validate array fields
  errors.push(...validateArrayFields(doc, config));

  // Cilium-specific validation
  if (policyType === "CILIUM_NETWORK" || policyType === "CILIUM_CLUSTERWIDE") {
    errors.push(...validateCiliumEndpointSelector(doc));
  }

  return errors;
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Validate a policy YAML string against the expected policy type
 *
 * @param yamlContent - The YAML content to validate
 * @param policyType - The expected policy type
 * @returns ValidationResult with valid flag, errors array, and parsed content if valid
 */
export function validatePolicy(
  yamlContent: string,
  policyType: PolicyType
): ValidationResult {
  // Layer 1: YAML syntax validation
  const parseResult = parseYamlSafely(yamlContent);
  if (!parseResult.success || !parseResult.data) {
    return {
      valid: false,
      errors: parseResult.error ? [parseResult.error] : [],
    };
  }

  // Layer 2: Schema validation
  const schemaErrors = validatePolicySchema(parseResult.data, policyType);
  if (schemaErrors.length > 0) {
    return {
      valid: false,
      errors: schemaErrors,
      parsed: parseResult.data,
    };
  }

  return {
    valid: true,
    errors: [],
    parsed: parseResult.data,
  };
}

/**
 * Quick check if YAML is syntactically valid (without schema validation)
 */
export function isValidYaml(yamlContent: string): boolean {
  const result = parseYamlSafely(yamlContent);
  return result.success;
}

/**
 * Get the expected kind(s) for a policy type
 */
export function getExpectedKinds(policyType: PolicyType): string[] {
  return POLICY_CONFIGS[policyType]?.expectedKinds ?? [];
}

/**
 * Get the expected apiVersion(s) for a policy type
 */
export function getExpectedApiVersions(policyType: PolicyType): string[] {
  return POLICY_CONFIGS[policyType]?.expectedApiVersions ?? [];
}
