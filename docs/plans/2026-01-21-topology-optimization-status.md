# Topology Page Optimization - Status

**Date:** 2026-01-21
**Status:** Partial Complete

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

## Remaining Optimizations (Future Work)

### 4. Suspicious Binary Filter Optimization
**File:** `src/server/routers/topology.ts` (lines ~460-490)
**Status:** Not started

**Problem:** 21 separate OR conditions with `contains` for suspicious binary detection:
```typescript
OR: [
  { binary: { contains: "/sh" } },
  { binary: { contains: "/bash" } },
  // ... 19 more conditions
]
```

**Proposed Solution:** Use PostgreSQL's `ILIKE ANY` with pattern array:
```typescript
const suspiciousBinaryPatterns = [
  '%/sh', '%/bash', '%/zsh', '%/dash', '%/ash',
  '%/curl', '%/wget', '%/nc', '%/netcat', '%/ncat',
  // ...
];

// Raw SQL with ILIKE ANY
WHERE binary ILIKE ANY(${suspiciousBinaryPatterns})
```

**Impact:** ~50% faster process event queries

### 5. Process Events Select Clause
**File:** `src/server/routers/topology.ts`
**Status:** Not started

Add explicit `select` clause to reduce payload size for process events query.

## Lessons Learned

1. **Test incrementally** - Deploy to Vercel preview before production
2. **Avoid complex callbacks** - `placeholderData: (prev) => prev` caused infinite re-renders
3. **Use type-safe Prisma** - `groupBy` is safer than raw `$queryRaw`
4. **Keep changes isolated** - Easier to debug when something breaks

## Local Development Note

The local dev server has a React 18/19 compatibility issue with Clerk 6.x:
```
TypeError: useActionState is not a function
```

**Workaround:** Use Vercel preview deployments for testing instead of local dev server.

**Permanent fix options:**
- Downgrade Clerk to 5.x (compatible with React 18)
- Upgrade React to 19
