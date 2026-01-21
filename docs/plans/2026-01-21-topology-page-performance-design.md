# Topology Page Performance Optimization

**Date:** 2026-01-21
**Status:** Approved
**Scope:** Topology graph + Runtime security events panel

## Problem Statement

The topology page has performance issues affecting user experience:

1. **Slow initial load** - Fetches 700 raw FlowSummary records from Neon (remote PostgreSQL), then aggregates in JavaScript
2. **Refresh jank** - Every 30s in live mode, full graph refetch causes loading overlay to block interaction
3. **Inefficient queries** - 21 OR conditions for suspicious binary detection, missing select clauses

With Neon's ~50-100ms network latency per query, reducing round-trips and payload sizes has outsized impact.

## Solution Overview

### 1. Database-Side Aggregation (Topology Graph)

**Before:**
```
2 DB queries → 700 raw records → JS aggregation (Maps, loops) → nodes/edges
```

**After:**
```
1 DB query with GROUP BY → ~50-100 aggregated rows → nodes/edges directly
```

Replace `topology.ts:63-195` with:

```typescript
const aggregatedFlows = await ctx.db.$queryRaw<AggregatedFlow[]>`
  SELECT
    src_namespace, src_pod_name,
    dst_namespace, dst_pod_name, dst_port, protocol,
    SUM(total_flows)::bigint as total_flows,
    SUM(allowed_flows)::bigint as allowed_flows,
    SUM(denied_flows)::bigint as denied_flows,
    COALESCE(SUM(dropped_flows), 0)::bigint as dropped_flows
  FROM "FlowSummary"
  WHERE cluster_id = ${input.clusterId}
    AND (timestamp >= ${since} OR window_start >= ${since})
    ${namespaceFilter}
  GROUP BY src_namespace, src_pod_name, dst_namespace, dst_pod_name, dst_port, protocol
`;
```

Add Zod schema for type safety:

```typescript
const AggregatedFlowSchema = z.object({
  src_namespace: z.string().nullable(),
  src_pod_name: z.string().nullable(),
  dst_namespace: z.string().nullable(),
  dst_pod_name: z.string().nullable(),
  dst_port: z.number(),
  protocol: z.string(),
  total_flows: z.bigint(),
  allowed_flows: z.bigint(),
  denied_flows: z.bigint(),
  dropped_flows: z.bigint(),
});
```

### 2. Smooth Refresh Strategy (Topology Graph)

**Before:**
```typescript
refetchInterval: mode === "live" ? 30000 : undefined
// Shows blocking loading overlay on every refresh
```

**After:**
```typescript
{
  enabled: !!selectedClusterId,
  refetchInterval: mode === "live" ? 30000 : undefined,
  placeholderData: (prev) => prev,  // Keep previous data visible
  staleTime: 10000,  // 10s freshness window
}
```

Update loading UI:
- Full spinner only on initial load (`isLoading && !topologyData`)
- Subtle "Updating..." indicator on refresh (`isFetching && topologyData`)

### 3. Suspicious Binary Filter Optimization (Process Events)

**Before:** 21 separate OR conditions with `contains`

**After:** Single `ILIKE ANY` with pattern array

```typescript
const suspiciousBinaryPatterns = [
  '%/sh', '%/bash', '%/zsh', '%/dash', '%/ash',
  '%/curl', '%/wget', '%/nc', '%/netcat', '%/ncat',
  '%/python%', '%/perl', '%/ruby',
  '%/chmod', '%/chown', '%/base64',
  '%/cat', '%/head', '%/tail', '%/less', '%/more',
];

const processEvents = await ctx.db.$queryRaw<ProcessValidationEvent[]>`
  SELECT id, timestamp, namespace, pod_name, binary, arguments, verdict
  FROM "ProcessValidationEvent"
  WHERE cluster_id = ${input.clusterId}
    AND timestamp >= ${since}
    ${input.namespace ? Prisma.sql`AND namespace = ${input.namespace}` : Prisma.empty}
    AND binary ILIKE ANY(${suspiciousBinaryPatterns})
  ORDER BY timestamp DESC
  LIMIT 200
`;
```

Also remove redundant post-filter at line 565-567.

### 4. Payload Optimization (Process Events)

Add `select` clause to non-suspicious query:

```typescript
select: {
  id: true,
  timestamp: true,
  namespace: true,
  podName: true,
  binary: true,
  arguments: true,
  verdict: true,
}
```

## Files Changed

| File | Changes |
|------|---------|
| `src/server/routers/topology.ts` | Aggregated query, ILIKE ANY filter, select clause, remove post-filter |
| `src/app/topology/page.tsx` | React Query options, loading UI logic |

## Not Changing

- Database schema (no migrations needed)
- Other pages or features
- React Flow component structure
- Existing test mocks

## Expected Impact

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Initial load (data transfer) | ~700 records | ~100 records | ~85% reduction |
| Initial load (JS processing) | O(n) aggregation | Direct mapping | ~70% faster |
| Refresh UX | Blocking overlay | Background update | No jank |
| Process event query | 21 OR clauses | 1 ILIKE ANY | ~50% faster |
| Payload size | All columns | Selected columns | ~30% smaller |

## Testing Plan

1. **Functional:** Topology graph renders same nodes/edges as before
2. **Functional:** Process events panel shows same events
3. **UX:** Live mode refresh doesn't block interaction
4. **Regression:** Existing Vitest tests pass
5. **Manual:** Test with different time ranges and namespace filters

## Rollback

All changes are code-only (no schema changes). Revert commits to restore previous behavior.
