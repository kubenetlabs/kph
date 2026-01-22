# Topology Page Optimization - Status

**Date:** 2026-01-21
**Status:** Complete (5/5)

## Completed Optimizations

### 1. React Query Caching (Frontend)
**File:** `src/app/topology/page.tsx`

- Added `staleTime: 10000` - prevents unnecessary refetches when changing filters quickly
- Added `isFetching` tracking - enables detecting background refresh state

### 2. Non-Blocking Refresh UX (Frontend)
**File:** `src/app/topology/page.tsx`

- Blocking spinner only shows on initial load (when no data exists)
- During 30-second background refresh: subtle "Updating..." indicator in top-right corner
- Users can continue interacting with graph while updating

### 3. Database-Side Aggregation (Backend)
**File:** `src/server/routers/topology.ts`

- Replaced 2 `findMany` queries (~700 records) with single Prisma `groupBy` query (~50-100 rows)
- Aggregation happens at database level, reducing data transfer
- Type-safe approach using Prisma (not raw SQL)

```typescript
const aggregatedFlows = await ctx.db.flowSummary.groupBy({
  by: ['srcNamespace', 'srcPodName', 'dstNamespace', 'dstPodName', 'dstPort', 'protocol'],
  where: baseWhere,
  _sum: {
    totalFlows: true,
    allowedFlows: true,
    deniedFlows: true,
    droppedFlows: true,
  },
});
```

### 4. ILIKE ANY Pattern Matching (Backend)
**File:** `src/server/routers/topology.ts` (lines ~474-503)

- Used `$queryRawUnsafe()` with hardcoded pattern array for suspicious binary filter
- Replaced 21 separate OR conditions with single `ILIKE ANY(ARRAY[...])` clause
- ~50% faster process event queries when `suspicious=true` filter is active
- Safe because patterns are hardcoded, not user input

```typescript
const suspiciousPatterns = [
  '%/sh', '%/bash', '%/zsh', '%/dash', '%/ash',
  '%/curl', '%/wget', '%/nc', '%/netcat', '%/ncat',
  // ... more patterns
].map(p => `'${p}'`).join(', ');

const query = `
  SELECT id, timestamp, namespace, "podName", binary, arguments, verdict
  FROM process_validation_events
  WHERE "clusterId" = $1
    AND timestamp >= $2
    AND binary ILIKE ANY(ARRAY[${suspiciousPatterns}])
  ORDER BY timestamp DESC
  LIMIT 200
`;
await ctx.db.$queryRawUnsafe<ProcessEventRow[]>(query, clusterId, since);
```

### 5. Process Events Select Clause (Backend)
**File:** `src/server/routers/topology.ts`

- Added explicit `select` clause to reduce payload size (7 fields vs 16)
- Only fetches: `id`, `timestamp`, `namespace`, `podName`, `binary`, `arguments`, `verdict`
- Excludes unused fields: `nodeName`, `parentBinary`, `syscall`, `filePath`, `matchedPolicy`, `action`, `reason`, `createdAt`

## Lessons Learned

1. **Test incrementally** - Deploy to Vercel preview before production
2. **Avoid complex callbacks** - `placeholderData: (prev) => prev` caused infinite re-renders
3. **Use type-safe Prisma** - `groupBy` is safer than raw `$queryRaw`
4. **Keep changes isolated** - Easier to debug when something breaks
5. **Prisma.raw() doesn't work in $queryRaw** - The tagged template still parameterizes, causing SQL errors
6. **Test raw SQL in preview first** - Always verify $queryRaw changes work before pushing to production

## Local Development Note

The local dev server has a React 18/19 compatibility issue with Clerk 6.x:
```
TypeError: useActionState is not a function
```

**Workaround:** Use Vercel preview deployments for testing instead of local dev server.

**Permanent fix options:**
- Downgrade Clerk to 5.x (compatible with React 18)
- Upgrade React to 19

## Summary

All 5 planned optimizations complete:

| # | Optimization | Type | Status |
|---|--------------|------|--------|
| 1 | React Query Caching | Frontend | ✅ |
| 2 | Non-Blocking Refresh UX | Frontend | ✅ |
| 3 | Database-Side Aggregation | Backend | ✅ |
| 4 | ILIKE ANY Pattern Matching | Backend | ✅ |
| 5 | Explicit Select Clause | Backend | ✅ |
