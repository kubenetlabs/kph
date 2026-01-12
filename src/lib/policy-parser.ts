import yaml from "js-yaml";

/**
 * Policy Parser for Cilium Network Policies
 *
 * This module provides utilities for parsing Cilium policy YAML and comparing
 * policy selectors for consolidation recommendations.
 */

// Supported Cilium policy kinds
export const CILIUM_POLICY_KINDS = [
  "CiliumNetworkPolicy",
  "CiliumClusterwideNetworkPolicy",
] as const;

export type CiliumPolicyKind = (typeof CILIUM_POLICY_KINDS)[number];

/**
 * Label selector for matching endpoints
 */
export interface LabelSelector {
  matchLabels?: Record<string, string>;
  matchExpressions?: Array<{
    key: string;
    operator: string;
    values?: string[];
  }>;
}

/**
 * Parsed Cilium policy structure
 */
export interface ParsedCiliumPolicy {
  name: string;
  namespace?: string;
  kind: string;
  endpointSelector: LabelSelector;
  ingressRuleCount: number;
  egressRuleCount: number;
  hasL7Rules: boolean;
}

/**
 * Result of policy comparison
 */
export interface PolicyComparisonResult {
  similarityPercent: number;
  sharedLabels: string[];
  uniqueToA: string[];
  uniqueToB: string[];
  sameType: boolean;
}

/**
 * Parses Cilium policy YAML content
 *
 * @param yamlContent - The raw YAML string to parse
 * @returns Parsed policy metadata or null if parsing fails
 */
export function parseCiliumPolicy(
  yamlContent: string
): ParsedCiliumPolicy | null {
  try {
    const doc = yaml.load(yamlContent) as Record<string, unknown>;

    if (!doc || typeof doc !== "object") {
      return null;
    }

    const kind = doc.kind as string;
    if (!kind || !CILIUM_POLICY_KINDS.includes(kind as CiliumPolicyKind)) {
      return null;
    }

    const metadata = doc.metadata as Record<string, unknown> | undefined;
    if (!metadata || typeof metadata !== "object") {
      return null;
    }

    const name = metadata.name as string;
    const namespace = metadata.namespace as string | undefined;

    if (!name) {
      return null;
    }

    const spec = doc.spec as Record<string, unknown> | undefined;
    if (!spec) {
      return null;
    }

    // Extract endpoint selector
    const endpointSelector = parseSelector(spec.endpointSelector);

    // Count rules
    const ingress = spec.ingress as unknown[] | undefined;
    const egress = spec.egress as unknown[] | undefined;

    const ingressRuleCount = Array.isArray(ingress) ? ingress.length : 0;
    const egressRuleCount = Array.isArray(egress) ? egress.length : 0;

    // Check for L7 rules
    const hasL7Rules = checkForL7Rules(ingress, egress);

    return {
      name,
      namespace,
      kind,
      endpointSelector,
      ingressRuleCount,
      egressRuleCount,
      hasL7Rules,
    };
  } catch {
    return null;
  }
}

/**
 * Parses a label selector from policy spec
 */
function parseSelector(selector: unknown): LabelSelector {
  if (!selector || typeof selector !== "object") {
    return {};
  }

  const sel = selector as Record<string, unknown>;
  const result: LabelSelector = {};

  if (sel.matchLabels && typeof sel.matchLabels === "object") {
    result.matchLabels = sel.matchLabels as Record<string, string>;
  }

  if (Array.isArray(sel.matchExpressions)) {
    result.matchExpressions = sel.matchExpressions.map((expr) => {
      const e = expr as Record<string, unknown>;
      return {
        key: String(e.key || ""),
        operator: String(e.operator || ""),
        values: Array.isArray(e.values)
          ? e.values.map((v) => String(v))
          : undefined,
      };
    });
  }

  return result;
}

/**
 * Checks if rules contain L7 (application layer) policies
 */
function checkForL7Rules(
  ingress: unknown[] | undefined,
  egress: unknown[] | undefined
): boolean {
  const rules = [...(ingress ?? []), ...(egress ?? [])];

  for (const rule of rules) {
    if (typeof rule !== "object" || rule === null) continue;

    const r = rule as Record<string, unknown>;

    // Check toPorts for L7 rules
    if (Array.isArray(r.toPorts)) {
      for (const port of r.toPorts) {
        if (typeof port !== "object" || port === null) continue;
        const p = port as Record<string, unknown>;

        // L7 rules have rules field inside toPorts
        if (p.rules && typeof p.rules === "object") {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Calculates similarity between two label selectors
 *
 * @param a - First selector
 * @param b - Second selector
 * @returns Comparison result with similarity percentage
 */
export function comparePolicySelectors(
  a: LabelSelector,
  b: LabelSelector
): PolicyComparisonResult {
  // Get all labels from matchLabels
  const labelsA = new Set(
    Object.entries(a.matchLabels ?? {}).map(([k, v]) => `${k}=${v}`)
  );
  const labelsB = new Set(
    Object.entries(b.matchLabels ?? {}).map(([k, v]) => `${k}=${v}`)
  );

  // Find shared and unique labels
  const sharedLabels: string[] = [];
  const uniqueToA: string[] = [];
  const uniqueToB: string[] = [];

  for (const label of labelsA) {
    if (labelsB.has(label)) {
      sharedLabels.push(label);
    } else {
      uniqueToA.push(label);
    }
  }

  for (const label of labelsB) {
    if (!labelsA.has(label)) {
      uniqueToB.push(label);
    }
  }

  // Calculate similarity (Jaccard index)
  const totalLabels = new Set([...labelsA, ...labelsB]).size;
  const similarityPercent =
    totalLabels > 0 ? Math.round((sharedLabels.length / totalLabels) * 100) : 0;

  return {
    similarityPercent,
    sharedLabels,
    uniqueToA,
    uniqueToB,
    sameType: true, // Will be set by caller based on policy types
  };
}

/**
 * Compares two parsed policies for consolidation potential
 *
 * @param policyA - First parsed policy
 * @param policyB - Second parsed policy
 * @returns Comparison result or null if policies cannot be compared
 */
export function comparePolicies(
  policyA: ParsedCiliumPolicy,
  policyB: ParsedCiliumPolicy
): PolicyComparisonResult | null {
  // Only compare same-type policies
  const sameType = policyA.kind === policyB.kind;

  const comparison = comparePolicySelectors(
    policyA.endpointSelector,
    policyB.endpointSelector
  );

  return {
    ...comparison,
    sameType,
  };
}

/**
 * Finds policies with similar selectors in a list
 *
 * @param policies - Array of policies with id, content, and type
 * @param similarityThreshold - Minimum similarity percentage (default: 80)
 * @returns Array of policy pairs that exceed the similarity threshold
 */
export function findSimilarPolicies(
  policies: Array<{ id: string; name: string; content: string; type: string }>,
  similarityThreshold = 80
): Array<{
  policyA: { id: string; name: string };
  policyB: { id: string; name: string };
  similarity: PolicyComparisonResult;
}> {
  const results: Array<{
    policyA: { id: string; name: string };
    policyB: { id: string; name: string };
    similarity: PolicyComparisonResult;
  }> = [];

  // Only compare Cilium policies
  const ciliumPolicies = policies.filter(
    (p) => p.type === "CILIUM_NETWORK" || p.type === "CILIUM_CLUSTERWIDE"
  );

  // Parse all policies
  const parsed = ciliumPolicies
    .map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      parsed: parseCiliumPolicy(p.content),
    }))
    .filter((p) => p.parsed !== null);

  // Compare all pairs
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      const a = parsed[i]!;
      const b = parsed[j]!;

      if (!a.parsed || !b.parsed) continue;

      // Only compare same-type policies
      if (a.type !== b.type) continue;

      const comparison = comparePolicies(a.parsed, b.parsed);

      if (comparison && comparison.similarityPercent >= similarityThreshold) {
        results.push({
          policyA: { id: a.id, name: a.name },
          policyB: { id: b.id, name: b.name },
          similarity: comparison,
        });
      }
    }
  }

  // Sort by similarity (highest first)
  results.sort((a, b) => b.similarity.similarityPercent - a.similarity.similarityPercent);

  return results;
}

/**
 * Generates a basic Cilium network policy YAML for a coverage gap
 *
 * @param srcNamespace - Source namespace
 * @param dstNamespace - Destination namespace
 * @param dstPort - Destination port
 * @returns Generated YAML string
 */
export function generatePolicyForCoverageGap(
  srcNamespace: string,
  dstNamespace: string,
  dstPort: number
): string {
  const policyName = `allow-${srcNamespace}-to-${dstNamespace}-${dstPort}`;

  return `apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: "${policyName}"
  namespace: "${dstNamespace}"
spec:
  endpointSelector:
    matchLabels:
      # TODO: Add labels to match destination pods
      app: your-app
  ingress:
    - fromEndpoints:
        - matchLabels:
            # TODO: Add labels to match source pods
            k8s:io.kubernetes.pod.namespace: "${srcNamespace}"
      toPorts:
        - ports:
            - port: "${dstPort}"
              protocol: TCP`;
}
