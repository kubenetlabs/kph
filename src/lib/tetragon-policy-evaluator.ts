/**
 * Tetragon TracingPolicy Evaluator
 *
 * Parses and evaluates TracingPolicies against ProcessSummary data
 * for simulation and validation purposes.
 */

import yaml from "js-yaml";

// ============================================================================
// Types for TracingPolicy structure
// ============================================================================

export interface TracingPolicySpec {
  apiVersion: string;
  kind: "TracingPolicy" | "TracingPolicyNamespaced";
  metadata: {
    name: string;
    namespace?: string;
  };
  spec: {
    kprobes?: KprobeSpec[];
    tracepoints?: TracepointSpec[];
  };
}

export interface KprobeSpec {
  call: string; // e.g., "sys_execve", "sys_openat"
  syscall?: boolean;
  return?: boolean;
  args?: ArgSpec[];
  returnArg?: ArgSpec;
  selectors?: SelectorSpec[];
}

export interface TracepointSpec {
  subsystem: string;
  event: string;
  args?: ArgSpec[];
  selectors?: SelectorSpec[];
}

export interface ArgSpec {
  index: number;
  type: string;
  sizeArgIndex?: number;
  returnCopy?: boolean;
  maxData?: boolean;
}

export interface SelectorSpec {
  matchBinaries?: MatchBinarySpec[];
  matchArgs?: MatchArgSpec[];
  matchActions?: MatchActionSpec[];
  matchNamespaces?: MatchNamespaceSpec[];
  matchPIDs?: MatchPIDSpec[];
  matchCapabilities?: MatchCapabilitySpec[];
}

export interface MatchBinarySpec {
  operator: "In" | "NotIn" | "Prefix" | "Postfix";
  values: string[];
  followChildren?: boolean;
}

export interface MatchArgSpec {
  index: number;
  operator: "Equal" | "NotEqual" | "Prefix" | "Postfix" | "Mask" | "GT" | "LT";
  values: string[];
}

export interface MatchActionSpec {
  action: "Sigkill" | "Signal" | "Override" | "FollowFD" | "UnfollowFD" | "CopyFD" | "Post" | "NoPost";
  argError?: number;
  argSig?: number;
  rateLimit?: string;
  rateLimitScope?: string;
}

export interface MatchNamespaceSpec {
  namespace: string;
  operator: "In" | "NotIn";
  values: string[];
}

export interface MatchPIDSpec {
  operator: "In" | "NotIn";
  values: number[];
  isNamespacePID?: boolean;
  followForks?: boolean;
}

export interface MatchCapabilitySpec {
  type: string;
  operator: "In" | "NotIn";
  isNamespaceCapability?: boolean;
  values: string[];
}

// ============================================================================
// Types for Process Summary and Simulation Results
// ============================================================================

export interface ProcessSummaryInput {
  id: string;
  namespace: string;
  podName: string;
  processName: string; // Full path like /bin/bash
  execCount: number;
  syscallCounts?: Record<string, number> | null;
}

export interface ProcessSimulationResult {
  processId: string;
  namespace: string;
  podName: string;
  binary: string;
  execCount: number;
  wouldBlock: boolean;
  matchedSelector?: string;
  matchReason?: string;
  action?: string;
}

export interface TetragonSimulationResponse {
  policyName: string;
  policyNamespace?: string;
  totalProcesses: number;
  totalExecs: number;
  wouldBlockCount: number;
  wouldBlockExecs: number;
  wouldAllowCount: number;
  wouldAllowExecs: number;
  breakdownByNamespace: Record<
    string,
    {
      namespace: string;
      totalProcesses: number;
      totalExecs: number;
      blockedProcesses: number;
      blockedExecs: number;
      allowedProcesses: number;
      allowedExecs: number;
    }
  >;
  sampleBlockedProcesses: ProcessSimulationResult[];
  sampleAllowedProcesses: ProcessSimulationResult[];
}

// ============================================================================
// Policy Parsing
// ============================================================================

/**
 * Parse a TracingPolicy YAML string into a structured spec
 */
export function parseTracingPolicy(policyYaml: string): TracingPolicySpec {
  const parsed = yaml.load(policyYaml) as TracingPolicySpec;

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid TracingPolicy: failed to parse YAML");
  }

  if (!parsed.apiVersion?.includes("cilium.io")) {
    throw new Error(
      `Invalid TracingPolicy: expected apiVersion containing 'cilium.io', got '${parsed.apiVersion}'`
    );
  }

  if (
    parsed.kind !== "TracingPolicy" &&
    parsed.kind !== "TracingPolicyNamespaced"
  ) {
    throw new Error(
      `Invalid TracingPolicy: expected kind 'TracingPolicy' or 'TracingPolicyNamespaced', got '${String(parsed.kind)}'`
    );
  }

  if (!parsed.metadata?.name) {
    throw new Error("Invalid TracingPolicy: missing metadata.name");
  }

  return parsed;
}

// ============================================================================
// Process Evaluation Logic
// ============================================================================

/**
 * Check if a binary path matches a MatchBinarySpec
 */
function matchesBinary(
  processName: string,
  spec: MatchBinarySpec
): boolean {
  const matchesAny = spec.values.some((value) => {
    switch (spec.operator) {
      case "In":
        return processName === value;
      case "NotIn":
        return processName !== value;
      case "Prefix":
        return processName.startsWith(value);
      case "Postfix":
        return processName.endsWith(value);
      default:
        return false;
    }
  });

  // For NotIn, ALL values must not match (i.e., none should match)
  if (spec.operator === "NotIn") {
    return !spec.values.some((value) => processName === value);
  }

  return matchesAny;
}

/**
 * Check if a process matches a MatchArgSpec (for sys_execve, arg 0 is the binary)
 */
function matchesArg(
  processName: string,
  spec: MatchArgSpec
): boolean {
  // For sys_execve, index 0 is the binary path being executed
  if (spec.index !== 0) {
    // We only have binary path info from ProcessSummary, skip other args
    return true;
  }

  const matchesAny = spec.values.some((value) => {
    switch (spec.operator) {
      case "Equal":
        return processName === value;
      case "NotEqual":
        return processName !== value;
      case "Prefix":
        return processName.startsWith(value);
      case "Postfix":
        return processName.endsWith(value);
      default:
        return false;
    }
  });

  if (spec.operator === "NotEqual") {
    return !spec.values.some((value) => processName === value);
  }

  return matchesAny;
}

/**
 * Check if a process matches a selector
 */
function matchesSelector(
  process: ProcessSummaryInput,
  selector: SelectorSpec,
  policyNamespace?: string
): { matches: boolean; reason?: string } {
  // Check namespace constraints (for namespaced policies)
  if (policyNamespace && process.namespace !== policyNamespace) {
    return { matches: false, reason: "Namespace mismatch" };
  }

  // Check matchNamespaces if specified
  if (selector.matchNamespaces?.length) {
    const nsMatch = selector.matchNamespaces.some((nsSpec) => {
      if (nsSpec.operator === "In") {
        return nsSpec.values.includes(process.namespace);
      } else {
        return !nsSpec.values.includes(process.namespace);
      }
    });
    if (!nsMatch) {
      return { matches: false, reason: "matchNamespaces constraint" };
    }
  }

  // Check matchBinaries
  if (selector.matchBinaries?.length) {
    const binaryMatches = selector.matchBinaries.some((binSpec) =>
      matchesBinary(process.processName, binSpec)
    );
    if (!binaryMatches) {
      return { matches: false, reason: "matchBinaries constraint" };
    }
  }

  // Check matchArgs (for sys_execve, arg 0 is the binary)
  if (selector.matchArgs?.length) {
    const argsMatch = selector.matchArgs.every((argSpec) =>
      matchesArg(process.processName, argSpec)
    );
    if (!argsMatch) {
      return { matches: false, reason: "matchArgs constraint" };
    }
  }

  // If we get here and there are matchActions, the process matches
  return { matches: true };
}

/**
 * Determine if a selector would block the process (has Sigkill or Override action)
 */
function selectorWouldBlock(selector: SelectorSpec): {
  wouldBlock: boolean;
  action?: string;
} {
  if (!selector.matchActions?.length) {
    // No actions = monitoring only, not blocking
    return { wouldBlock: false };
  }

  const blockingAction = selector.matchActions.find(
    (a) => a.action === "Sigkill" || a.action === "Override" || a.action === "Signal"
  );

  if (blockingAction) {
    return { wouldBlock: true, action: blockingAction.action };
  }

  return { wouldBlock: false };
}

/**
 * Evaluate a single process against a TracingPolicy
 */
export function evaluateProcessAgainstPolicy(
  process: ProcessSummaryInput,
  policy: TracingPolicySpec,
  debugLog = false
): ProcessSimulationResult {
  const result: ProcessSimulationResult = {
    processId: process.id,
    namespace: process.namespace,
    podName: process.podName,
    binary: process.processName,
    execCount: process.execCount,
    wouldBlock: false,
  };

  // Get policy namespace for namespaced policies
  const policyNamespace =
    policy.kind === "TracingPolicyNamespaced"
      ? policy.metadata.namespace
      : undefined;

  if (debugLog) {
    console.log(`[Evaluator] Process: ${process.processName} in ns=${process.namespace}, policy ns=${policyNamespace ?? "cluster-wide"}`);
  }

  // Check each kprobe
  for (const kprobe of policy.spec.kprobes ?? []) {
    // We only evaluate sys_execve kprobes against ProcessSummary
    // (ProcessSummary contains process execution data)
    if (kprobe.call !== "sys_execve" && kprobe.syscall !== true) {
      if (debugLog) {
        console.log(`[Evaluator] Skipping kprobe ${kprobe.call} (not sys_execve or syscall!=true)`);
      }
      continue;
    }

    if (debugLog) {
      console.log(`[Evaluator] Checking kprobe ${kprobe.call}, selectors: ${kprobe.selectors?.length ?? 0}`);
    }

    // Check each selector in the kprobe
    for (const selector of kprobe.selectors ?? []) {
      const { matches, reason } = matchesSelector(
        process,
        selector,
        policyNamespace
      );

      if (debugLog) {
        console.log(`[Evaluator] Selector match result: ${matches}, reason: ${reason ?? "matched"}`);
        if (selector.matchArgs?.length) {
          console.log(`[Evaluator] matchArgs: ${JSON.stringify(selector.matchArgs)}`);
        }
      }

      if (matches) {
        const { wouldBlock, action } = selectorWouldBlock(selector);
        if (debugLog) {
          console.log(`[Evaluator] Would block: ${wouldBlock}, action: ${action}`);
        }
        if (wouldBlock) {
          result.wouldBlock = true;
          result.action = action;
          result.matchedSelector = `kprobe:${kprobe.call}`;
          result.matchReason = `Process ${process.processName} matches selector with ${action} action`;
          return result;
        }
      }
    }
  }

  // Check tracepoints (less common for process blocking)
  for (const tracepoint of policy.spec.tracepoints ?? []) {
    for (const selector of tracepoint.selectors ?? []) {
      const { matches } = matchesSelector(process, selector, policyNamespace);

      if (matches) {
        const { wouldBlock, action } = selectorWouldBlock(selector);
        if (wouldBlock) {
          result.wouldBlock = true;
          result.action = action;
          result.matchedSelector = `tracepoint:${tracepoint.subsystem}/${tracepoint.event}`;
          result.matchReason = `Process ${process.processName} matches tracepoint selector with ${action} action`;
          return result;
        }
      }
    }
  }

  return result;
}

/**
 * Simulate a TracingPolicy against a list of ProcessSummary records
 */
export function simulateTracingPolicy(
  policyYaml: string,
  processes: ProcessSummaryInput[]
): TetragonSimulationResponse {
  const policy = parseTracingPolicy(policyYaml);

  const response: TetragonSimulationResponse = {
    policyName: policy.metadata.name,
    policyNamespace: policy.metadata.namespace,
    totalProcesses: processes.length,
    totalExecs: 0,
    wouldBlockCount: 0,
    wouldBlockExecs: 0,
    wouldAllowCount: 0,
    wouldAllowExecs: 0,
    breakdownByNamespace: {},
    sampleBlockedProcesses: [],
    sampleAllowedProcesses: [],
  };

  // Log parsed policy structure for debugging
  console.log("[Evaluator] Parsed policy:", {
    name: policy.metadata.name,
    namespace: policy.metadata.namespace,
    kind: policy.kind,
    kprobesCount: policy.spec.kprobes?.length ?? 0,
  });
  if (policy.spec.kprobes?.[0]) {
    const kp = policy.spec.kprobes[0];
    console.log("[Evaluator] First kprobe:", {
      call: kp.call,
      syscall: kp.syscall,
      selectorsCount: kp.selectors?.length ?? 0,
    });
    if (kp.selectors?.[0]) {
      console.log("[Evaluator] First selector:", {
        matchArgs: kp.selectors[0].matchArgs,
        matchBinaries: kp.selectors[0].matchBinaries,
        matchActions: kp.selectors[0].matchActions,
      });
    }
  }

  // Evaluate each process
  for (const process of processes) {
    response.totalExecs += process.execCount;

    // Initialize namespace breakdown
    if (!response.breakdownByNamespace[process.namespace]) {
      response.breakdownByNamespace[process.namespace] = {
        namespace: process.namespace,
        totalProcesses: 0,
        totalExecs: 0,
        blockedProcesses: 0,
        blockedExecs: 0,
        allowedProcesses: 0,
        allowedExecs: 0,
      };
    }
    const nsBrk = response.breakdownByNamespace[process.namespace]!;
    nsBrk.totalProcesses++;
    nsBrk.totalExecs += process.execCount;

    // Enable debug logging for shell processes
    const isShellProcess = process.processName.endsWith('/sh') ||
                           process.processName.endsWith('/bash') ||
                           process.processName.endsWith('/zsh');

    // Evaluate against policy
    const result = evaluateProcessAgainstPolicy(process, policy, isShellProcess);

    if (result.wouldBlock) {
      response.wouldBlockCount++;
      response.wouldBlockExecs += process.execCount;
      nsBrk.blockedProcesses++;
      nsBrk.blockedExecs += process.execCount;

      // Keep sample of blocked processes (max 50)
      if (response.sampleBlockedProcesses.length < 50) {
        response.sampleBlockedProcesses.push(result);
      }
    } else {
      response.wouldAllowCount++;
      response.wouldAllowExecs += process.execCount;
      nsBrk.allowedProcesses++;
      nsBrk.allowedExecs += process.execCount;

      // Keep sample of allowed processes (max 20)
      if (response.sampleAllowedProcesses.length < 20) {
        response.sampleAllowedProcesses.push(result);
      }
    }
  }

  return response;
}
