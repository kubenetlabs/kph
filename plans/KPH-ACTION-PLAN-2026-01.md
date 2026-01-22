# KPH Prioritized Action Plan

**Created:** 2026-01-22
**Based on:** Deep dive analysis of Installation, UI/UX, and Performance
**Status:** Active

---

## Executive Summary

Three comprehensive audits identified **5 critical bugs**, **12 high-priority issues**, and **20+ medium/low improvements** across installation security, UI accessibility, and database performance. This plan prioritizes fixes by impact and effort.

---

## Priority Tiers

| Tier | Timeline | Criteria |
|------|----------|----------|
| **P0 - Critical** | This Week | Security vulnerabilities, data integrity bugs |
| **P1 - High** | Sprint 1 (2 weeks) | Major UX issues, performance bottlenecks |
| **P2 - Medium** | Sprint 2-3 | Consistency, missing features |
| **P3 - Low** | Backlog | Nice-to-have improvements |

---

## P0 - Critical (This Week)

### 1. Fix Operator ID Generation Bug
**Impact:** High - Breaks operator identity tracking
**Effort:** Low (5 min)
**File:** `src/app/api/operator/register/route.ts:57`

```typescript
// BEFORE (bug):
const operatorId = crypto.randomUUID();

// AFTER (fix):
const existingCluster = await db.cluster.findUnique({ where: { id: auth.clusterId } });
const operatorId = existingCluster?.operatorId || crypto.randomUUID();
```

**Test:** Restart operator pod, verify `operatorId` unchanged in database.

---

### 2. Fix Token Exposure in Helm Command
**Impact:** High - Security vulnerability
**Effort:** Medium (2 hours)
**Files:** `src/lib/helm-values-generator.ts`, `src/components/clusters/cluster-install-wizard.tsx`

**Current Problem:**
```bash
helm install ... --set agent.token=kph_agent_xxx  # Visible in shell history!
```

**Solution:** Generate two-step installation:
```bash
# Step 1: Create secret
kubectl create secret generic kph-agent-token \
  --namespace kph-system \
  --from-literal=api-token=$KPH_TOKEN

# Step 2: Install with secret reference
helm install kph-agent ... \
  --set agent.existingSecret=kph-agent-token
```

**Changes Required:**
1. Update `generateHelmCommand()` to output two-step process
2. Update Helm chart `secrets.yaml` to support `existingSecret`
3. Update wizard UI to show token separately with copy button

---

### 3. Fix Heartbeat Pending Policy Count
**Impact:** Medium - Incorrect operator behavior
**Effort:** Low (5 min)
**File:** `src/app/api/operator/heartbeat/route.ts:89`

```typescript
// BEFORE (bug):
status: { in: ["PENDING", "DEPLOYED"] }

// AFTER (fix):
status: "PENDING"
```

---

### 4. Add Cluster List Limit
**Impact:** High - Memory spike with large orgs
**Effort:** Low (5 min)
**File:** `src/server/routers/cluster.ts:35`

```typescript
// Add limit to prevent unbounded results
const clusters = await ctx.db.cluster.findMany({
  where: { organizationId },
  orderBy: { createdAt: "desc" },
  take: 1000,  // ADD THIS
  select: { ... }
});
```

---

### 5. Add Missing Database Indexes
**Impact:** High - Slow queries at scale
**Effort:** Medium (1 hour + migration)
**File:** `prisma/schema.prisma`

```prisma
model FlowSummary {
  // Add after existing indexes:
  @@index([clusterId, timestamp, srcNamespace, dstNamespace])
  @@index([clusterId, windowStart, windowEnd])
}

model Policy {
  // Add:
  @@index([organizationId, status])
}

model ProcessValidationEvent {
  // Change from @@index([timestamp]) to:
  @@index([clusterId, timestamp, verdict])
}

model ValidationEvent {
  // Add:
  @@index([clusterId, timestamp, verdict])
}
```

**Deploy:** `npx prisma migrate dev --name add_performance_indexes`

---

## P1 - High Priority (Sprint 1)

### 6. Add Stale Heartbeat Detection
**Impact:** High - False cluster health status
**Effort:** Medium (2 hours)
**New File:** `src/lib/cluster-health-check.ts`

```typescript
export async function detectStaleClusters() {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

  const updated = await db.cluster.updateMany({
    where: {
      status: { in: ["CONNECTED", "DEGRADED"] },
      lastHeartbeat: { lt: twoHoursAgo }
    },
    data: { status: "ERROR" }
  });

  if (updated.count > 0) {
    console.log(`Marked ${updated.count} clusters as ERROR due to stale heartbeat`);
  }
}
```

**Integration:** Add to Vercel cron or external scheduler (every 10 min).

---

### 7. Add Heartbeat Query Caching
**Impact:** High - 1,440 queries/day/cluster reduced by 90%
**Effort:** Medium (3 hours)
**File:** `src/app/api/operator/heartbeat/route.ts`

```typescript
import { cache } from '~/lib/cache';  // Add Redis or in-memory cache

const getCachedPendingCount = async (clusterId: string) => {
  const cacheKey = `pending_policies:${clusterId}`;
  const cached = await cache.get(cacheKey);
  if (cached !== null) return cached;

  const count = await db.policy.count({
    where: { clusterId, status: "PENDING" }
  });

  await cache.set(cacheKey, count, { ttl: 300 }); // 5 min TTL
  return count;
};

// Invalidate on policy status change in policy router
```

---

### 8. Refactor Policy Stats to Single Query
**Impact:** Medium - 5 queries → 1
**Effort:** Low (30 min)
**File:** `src/server/routers/policy.ts:430`

```typescript
// BEFORE: 5 separate count queries

// AFTER: Single groupBy
const [statusCounts, typeCounts] = await Promise.all([
  ctx.db.policy.groupBy({
    by: ["status"],
    where: { organizationId: ctx.organizationId },
    _count: { _all: true }
  }),
  ctx.db.policy.groupBy({
    by: ["type"],
    where: { organizationId: ctx.organizationId },
    _count: { _all: true }
  })
]);

const total = statusCounts.reduce((sum, s) => sum + s._count._all, 0);
const deployed = statusCounts.find(s => s.status === "DEPLOYED")?._count._all ?? 0;
const simulating = statusCounts.find(s => s.status === "SIMULATING")?._count._all ?? 0;
const drafts = statusCounts.find(s => s.status === "DRAFT")?._count._all ?? 0;
```

---

### 9. Add ARIA Labels to Icon Buttons
**Impact:** High - Accessibility compliance
**Effort:** Medium (2 hours)
**Files:** All components with icon-only buttons

```tsx
// BEFORE:
<button onClick={onClose}><XIcon /></button>

// AFTER:
<button onClick={onClose} aria-label="Close dialog">
  <XIcon aria-hidden="true" />
</button>
```

**Locations to fix:**
- `src/components/ui/modal.tsx` - close button
- `src/components/layout/sidebar.tsx` - collapse button
- `src/app/clusters/page.tsx` - action buttons
- `src/app/policies/page.tsx` - card actions
- All table row action buttons

---

### 10. Add Focus Trap to Modals
**Impact:** High - Accessibility compliance
**Effort:** Medium (2 hours)
**File:** `src/components/ui/modal.tsx`

```tsx
import { useEffect, useRef } from 'react';

function useFocusTrap(isOpen: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || !containerRef.current) return;

    const focusableElements = containerRef.current.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0] as HTMLElement;
    const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement?.focus();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement?.focus();
      }
    };

    document.addEventListener('keydown', handleTab);
    firstElement?.focus();

    return () => document.removeEventListener('keydown', handleTab);
  }, [isOpen]);

  return containerRef;
}
```

---

### 11. Increase Focus Ring Size (WCAG AA)
**Impact:** Medium - Accessibility compliance
**Effort:** Low (30 min)
**File:** `src/styles/globals.css`

```css
/* Add focus utility classes */
.focus-ring {
  @apply focus:outline-none focus:ring-[3px] focus:ring-primary/50 focus:ring-offset-2;
}

/* Update existing components to use 3px instead of 1px */
```

**Components to update:**
- `src/components/ui/button.tsx`
- `src/components/ui/input.tsx`
- `src/components/ui/select.tsx`

---

### 12. Add Skip Navigation Link
**Impact:** Medium - Accessibility compliance
**Effort:** Low (15 min)
**File:** `src/components/layout/app-shell.tsx`

```tsx
export default function AppShell({ children }) {
  return (
    <div className="flex h-screen">
      {/* Add skip link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:bg-primary focus:text-primary-foreground focus:px-4 focus:py-2 focus:rounded"
      >
        Skip to main content
      </a>

      <Sidebar />
      <main id="main-content" className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
```

---

## P2 - Medium Priority (Sprint 2-3)

### 13. Implement Table Pagination
**Files:** All admin pages, clusters, policies
**Effort:** 4 hours

Add pagination component and wire up cursor-based pagination already in tRPC routers.

---

### 14. Implement Search Functionality
**Files:** Clusters page, policies page, users page
**Effort:** 3 hours

Add search input with debounce, wire to existing `search` parameter in routers.

---

### 15. Fix Filter Buttons (Not Implemented)
**File:** `src/app/clusters/page.tsx`
**Effort:** 2 hours

The "All Providers", "All Environments", "All Statuses" buttons are non-functional. Implement as dropdown filters.

---

### 16. Standardize Spinner Styling
**Files:** Multiple pages
**Effort:** 1 hour

Create `<Spinner />` component with consistent styling:
```tsx
// src/components/ui/spinner.tsx
export function Spinner({ size = 'md' }) {
  const sizes = { sm: 'h-4 w-4', md: 'h-8 w-8', lg: 'h-12 w-12' };
  return (
    <div className={`${sizes[size]} animate-spin rounded-full border-4 border-primary border-t-transparent`} />
  );
}
```

---

### 17. Add Breadcrumbs to Interior Pages
**Effort:** 3 hours

Create breadcrumb component and add to:
- `/clusters/[id]`
- `/policies/[id]`
- `/admin/*` pages

---

### 18. Fix Select Component Inline Styles
**File:** `src/components/ui/select.tsx`
**Effort:** 30 min

Remove hardcoded `backgroundColor: "#151B24"`, use Tailwind classes instead.

---

### 19. Add Token Rotation Policy
**Files:** `token.ts` router, new refresh endpoint
**Effort:** 4 hours

- Enforce max 90-day expiry for agent tokens
- Add `/api/operator/refresh-token` endpoint
- Add expiry warning in heartbeat response

---

### 20. Add Rate Limiting to Bootstrap
**File:** `src/app/api/operator/bootstrap/route.ts`
**Effort:** 2 hours

Prevent brute-force cluster name attacks:
```typescript
import { rateLimit } from '~/lib/rate-limit';

const limiter = rateLimit({
  interval: 60 * 1000, // 1 minute
  uniqueTokenPerInterval: 500,
});

// In handler:
const { success } = await limiter.check(auth.organizationId, 5); // 5 per minute
if (!success) {
  return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
}
```

---

## P3 - Low Priority (Backlog)

### 21. Multi-Architecture Helm Chart Support
Support `linux/amd64` and `linux/arm64` image variants.

### 22. Registry Flexibility
Remove AWS ECR hardcoding, support Docker Hub, GCR, ACR.

### 23. Add Dark/Light Mode Toggle
User preference for theme.

### 24. Add Keyboard Shortcuts (Cmd+K)
Global command palette for power users.

### 25. Add Retry Buttons to Error States
Allow users to retry failed operations without refresh.

### 26. Add Table Sorting
Click column headers to sort.

### 27. Add Data Export (CSV)
Export policies, clusters, audit logs.

### 28. Add Onboarding Tutorial
First-time user guided tour.

### 29. Add Storybook Documentation
Component library documentation.

### 30. Implement Bulk Actions
Select multiple policies for batch deploy/archive.

---

## Implementation Checklist

### Week 1 (P0 Critical)
- [ ] Fix operator ID generation bug
- [ ] Fix token exposure in Helm command
- [ ] Fix heartbeat pending count
- [ ] Add cluster list limit
- [ ] Add database indexes + migrate

### Sprint 1 (P1 High)
- [ ] Add stale heartbeat detection
- [ ] Add heartbeat query caching
- [ ] Refactor policy stats query
- [ ] Add ARIA labels
- [ ] Add modal focus trap
- [ ] Increase focus ring size
- [ ] Add skip navigation link

### Sprint 2-3 (P2 Medium)
- [ ] Implement table pagination
- [ ] Implement search functionality
- [ ] Fix filter buttons
- [ ] Standardize spinners
- [ ] Add breadcrumbs
- [ ] Fix Select component
- [ ] Add token rotation
- [ ] Add rate limiting

---

## Success Metrics

| Metric | Current | Target | How to Measure |
|--------|---------|--------|----------------|
| Heartbeat queries/day | 1,440/cluster | 144/cluster | Database query logs |
| Cluster list response time | Unbounded | <500ms | API monitoring |
| Accessibility score | ~60% | 95%+ | axe-core audit |
| Token exposure risk | High | Low | Security review |
| P0 bugs | 5 | 0 | This checklist |

---

## Notes

- All database migrations should be tested on staging before production
- Accessibility changes should be validated with screen reader (NVDA/VoiceOver)
- Performance improvements should be load tested with 100+ clusters
- Security fixes require code review before merge

---

**Document Owner:** Engineering Team
**Last Updated:** 2026-01-22
**Next Review:** 2026-02-05
