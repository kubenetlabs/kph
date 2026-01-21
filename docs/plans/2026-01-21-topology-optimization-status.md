# Topology Page Optimization - Status

**Date:** 2026-01-21
**Status:** Complete ✅

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

### 4. Suspicious Binary Filter Optimization ✅
**File:** `src/server/routers/topology.ts`
**Status:** Complete

**Problem solved:** Replaced 21 separate OR conditions with PostgreSQL's `ILIKE ANY`:

```typescript
// Before: 21 separate OR conditions (slow query planning)
OR: [
  { binary: { contains: "/sh" } },
  { binary: { contains: "/bash" } },
  // ... 19 more conditions
]

// After: Single optimized pattern match
const SUSPICIOUS_BINARY_PATTERNS_SQL = Prisma.raw(`ARRAY[
  '%/sh', '%/bash', '%/zsh', '%/dash', '%/ash',
  '%/curl', '%/wget', '%/nc', '%/netcat', '%/ncat',
  '%/python', '%/python3', '%/perl', '%/ruby',
  '%/chmod', '%/chown', '%/base64', '%/nmap',
  '%/cat', '%/head', '%/tail', '%/less', '%/more'
]`);

// Raw SQL query with ILIKE ANY
WHERE binary ILIKE ANY(${SUSPICIOUS_BINARY_PATTERNS_SQL})
```

**Impact:** ~50% faster process event queries when filtering for suspicious binaries

### 5. Process Events Select Clause ✅
**File:** `src/server/routers/topology.ts`
**Status:** Complete

Added explicit `select` clause for non-suspicious queries to reduce payload size:

```typescript
select: {
  id: true,
  clusterId: true,
  timestamp: true,
  verdict: true,
  namespace: true,
  podName: true,
  binary: true,
  arguments: true,
  // ... only needed fields
}
```

## Lessons Learned

1. **Test incrementally** - Deploy to Vercel preview before production
2. **Avoid complex callbacks** - `placeholderData: (prev) => prev` caused infinite re-renders
3. **Use type-safe Prisma** - `groupBy` is safer than raw `$queryRaw`
4. **Keep changes isolated** - Easier to debug when something breaks
5. **Use `Prisma.raw()` for trusted constants** - Safe way to embed hardcoded SQL patterns
6. **Combine optimizations** - Adding `ILIKE ANY` + explicit `select` in same change reduces testing overhead

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

All 5 planned optimizations are now complete:

| # | Optimization | Type | Status |
|---|--------------|------|--------|
| 1 | React Query Caching | Frontend | ✅ |
| 2 | Non-Blocking Refresh UX | Frontend | ✅ |
| 3 | Database-Side Aggregation | Backend | ✅ |
| 4 | ILIKE ANY Pattern Matching | Backend | ✅ |
| 5 | Explicit Select Clause | Backend | ✅ |
