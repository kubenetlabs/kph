# Tetragon Validation and Simulation Support

This document describes the implementation plan for adding Tetragon (process-based) validation and simulation support to Kubernetes Policy Hub.

## Overview

Tetragon TracingPolicies provide runtime security enforcement at the kernel level, blocking suspicious process executions, file access, and syscalls. This feature adds:

1. **Process Validation Tracking** - Track which process executions are blocked/allowed by TracingPolicies
2. **Tetragon Policy Simulation** - Simulate TracingPolicies against historical ProcessSummary data before deploying
3. **Enforcement Statistics** - View enforcement stats on the validation page

## Architecture

### Key Design Decisions

1. **SaaS-side Tetragon simulation** - ProcessSummary data is already synced to the SaaS database, so we evaluate TracingPolicies directly without operator involvement (unlike network flow simulation which requires operator-side evaluation)

2. **Separate database models** - New `ProcessValidationSummary` and `ProcessValidationEvent` models keep process validation cleanly separated from network flow validation

3. **Tabbed UI** - Add "Network Flows" and "Process Execution" tabs to existing validation page, preserving backward compatibility

### Data Flow

```
Tetragon (cluster) → Collector → ProcessSummary (DB)
                                        ↓
TracingPolicy + ProcessSummary → Tetragon Evaluator (SaaS)
                                        ↓
                              Simulation Results (UI)
```

## Database Schema

### ProcessValidationSummary

Hourly aggregates of process validation verdicts:

| Field | Type | Description |
|-------|------|-------------|
| id | String | Primary key |
| clusterId | String | Cluster reference |
| hour | DateTime | Hour bucket timestamp |
| allowedCount | Int | Processes allowed to execute |
| blockedCount | Int | Processes blocked by TracingPolicy |
| noPolicyCount | Int | Processes with no governing policy |
| topBlocked | Json | Top blocked processes with policy info |
| coverageGaps | Json | Processes not covered by any policy |

### ProcessValidationEvent

Individual process validation events for debugging:

| Field | Type | Description |
|-------|------|-------------|
| id | String | Primary key |
| clusterId | String | Cluster reference |
| timestamp | DateTime | Event timestamp |
| verdict | Enum | ALLOWED, BLOCKED, NO_POLICY |
| namespace | String | Kubernetes namespace |
| podName | String | Pod name |
| binary | String | Full binary path (e.g., /bin/bash) |
| syscall | String | Syscall name if kprobe event |
| matchedPolicy | String | TracingPolicy name if matched |
| action | String | Tetragon action (SIGKILL, etc.) |

## API Endpoints

### POST /api/operator/process-validation

Operator endpoint to submit process validation data.

**Request Body:**
```json
{
  "summaries": [
    {
      "hour": "2026-01-15T14:00:00Z",
      "allowedCount": 1250,
      "blockedCount": 15,
      "noPolicyCount": 340,
      "topBlocked": [
        {"namespace": "default", "binary": "/bin/bash", "policy": "block-shells", "count": 8}
      ]
    }
  ],
  "events": [
    {
      "timestamp": "2026-01-15T14:32:15Z",
      "verdict": "BLOCKED",
      "namespace": "default",
      "podName": "nginx-abc123",
      "binary": "/bin/bash",
      "matchedPolicy": "block-shell-execution",
      "action": "SIGKILL"
    }
  ]
}
```

**Authentication:** Bearer token with `telemetry:write` scope

## tRPC Procedures

### processValidation Router

| Procedure | Description |
|-----------|-------------|
| `getSummary` | Get process validation stats for a cluster and time range |
| `getCoverageGaps` | Get processes with no governing TracingPolicy |
| `getBlockedProcesses` | Get processes blocked by TracingPolicies |
| `getRecentEvents` | Get recent process validation events |
| `getOrgStats` | Get organization-wide process validation stats |

### simulation Router (Extended)

| Procedure | Description |
|-----------|-------------|
| `simulateTetragonPolicy` | Simulate a TracingPolicy against historical ProcessSummary data (SaaS-side) |

## Tetragon Policy Evaluator

The `tetragon-policy-evaluator.ts` module parses and evaluates TracingPolicies:

### Supported TracingPolicy Features

- **kprobes** with `sys_execve`, `sys_openat`, etc.
- **matchBinaries** with operators: `In`, `NotIn`, `Prefix`, `Postfix`
- **matchArgs** for syscall argument matching
- **matchActions** with `Sigkill`, `Override`, etc.
- **matchNamespaces** for namespace filtering

### Example Evaluation

Given a TracingPolicy:
```yaml
apiVersion: cilium.io/v1alpha1
kind: TracingPolicyNamespaced
metadata:
  name: block-shell-execution
  namespace: default
spec:
  kprobes:
  - call: "sys_execve"
    syscall: true
    args:
    - index: 0
      type: "string"
    selectors:
    - matchArgs:
      - index: 0
        operator: "Postfix"
        values:
        - "/sh"
        - "/bash"
      matchActions:
      - action: Sigkill
```

And ProcessSummary records:
```
namespace: default, podName: nginx-abc, processName: /bin/bash, execCount: 5
namespace: default, podName: nginx-abc, processName: /usr/bin/curl, execCount: 3
```

The evaluator returns:
```json
{
  "totalProcesses": 2,
  "wouldBlock": 1,
  "wouldAllow": 1,
  "breakdown": {
    "default": {
      "blocked": ["/bin/bash"],
      "allowed": ["/usr/bin/curl"]
    }
  }
}
```

## UI Components

### Validation Page

The validation page adds a tab navigation:

- **Network Flows** (default) - Existing network flow validation
- **Process Execution** - New process validation view

Process Execution tab shows:
- Verdict breakdown pie chart (Allowed/Blocked/No Policy)
- Top blocked processes table
- Coverage gaps table (processes needing policies)
- Recent events timeline

### Simulation Page

The simulation page detects policy type:
- **Cilium policies** → Existing operator-side simulation flow
- **Tetragon policies** → New SaaS-side simulation with process-specific results

Tetragon simulation results show:
- Processes that would be blocked
- Breakdown by namespace
- Sample processes with match reasons

## Usage Examples

### Viewing Process Validation

1. Navigate to **Validation** page
2. Click **Process Execution** tab
3. Select cluster and time range
4. View enforcement statistics and blocked processes

### Simulating a TracingPolicy

1. Navigate to **Simulation** page
2. Click **New Simulation**
3. Select a TracingPolicy (type: TETRAGON)
4. Choose cluster and time range
5. Click **Run Simulation**
6. View which processes would be blocked

### Creating Blocking Policies from Events

1. Navigate to **Topology** page
2. View **Runtime Security Events** panel
3. Click **Generate Policy** on a suspicious process
4. Review and deploy the generated TracingPolicy
5. Run a simulation to verify coverage

## Implementation Files

| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | Database models |
| `src/lib/tetragon-policy-evaluator.ts` | Policy parsing and evaluation |
| `src/server/routers/process-validation.ts` | tRPC router |
| `src/app/api/operator/process-validation/route.ts` | Operator API |
| `src/components/validation/process-validation-content.tsx` | UI component |
| `src/components/simulation/tetragon-simulation-results.tsx` | Simulation results UI |

## Migration Notes

- Database migration creates new tables only (no changes to existing tables)
- Existing network flow validation and simulation are unchanged
- Feature is additive and backward compatible
