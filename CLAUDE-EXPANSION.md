
## Expansion Features (V1 & V2)

The following features extend the core Policy Hub platform to provide enforcement validation, a policy marketplace, and adaptive recommendations.

### Feature Overview

| Feature | Version | Description |
|---------|---------|-------------|
| Enforcement Validation Agent | V1 | eBPF agent proving policies are enforced, surfacing violations and coverage gaps |
| Policy Pack Marketplace | V1 | Curated policy bundles with free community and paid enterprise tiers |
| Adaptive Recommendations | V2 | Traffic-informed policy suggestions based on accumulated flow data |

---

## Enforcement Validation Agent (V1)

### Purpose
Answers the #1 customer question: "How do I know my policies are actually working?"

The Validation Agent captures every network flow, matches it against applied CiliumNetworkPolicies, and determines a verdict:
- **ALLOWED**: Flow matches an allow rule
- **BLOCKED**: Flow blocked by policy (no matching allow rule)
- **NO_POLICY**: Flow has no governing policy (coverage gap)

### Architecture

The Validation Agent runs as part of the existing collector DaemonSet:

```
operator/
├── cmd/
│   └── collector/
│       └── main.go                    # Add validation flag
└── internal/
    └── telemetry/
        └── validation/                # NEW: Validation subsystem
            ├── agent.go               # Main validation loop
            ├── matcher.go             # Policy-to-flow matching engine
            ├── verdict.go             # Verdict types and logic
            └── reporter.go            # Streams verdicts to SaaS
```

### Validation Logic

```go
// Verdict represents the validation result for a flow
type Verdict string

const (
    VerdictAllowed  Verdict = "ALLOWED"   // Explicitly allowed by policy
    VerdictBlocked  Verdict = "BLOCKED"   // Blocked (policy exists, no match)
    VerdictNoPolicy Verdict = "NO_POLICY" // No policy governs this flow
)

// ValidationResult ties a flow to its policy verdict
type ValidationResult struct {
    FlowID       string
    Timestamp    time.Time
    Source       EndpointInfo
    Destination  EndpointInfo
    Verdict      Verdict
    MatchedPolicy string  // Policy name if ALLOWED/BLOCKED
    Reason       string   // Human-readable explanation
}
```

### Policy Matching Rules

The matcher must correctly implement Cilium's policy semantics:

1. **Find applicable policies**: Policies where `endpointSelector` matches the destination pod's labels
2. **Check ingress rules**: For each policy, check if any `ingress.fromEndpoints` rule matches the source
3. **Determine verdict**:
   - If no policies select the destination → `NO_POLICY`
   - If policies exist but no rule matches the source → `BLOCKED`
   - If a rule matches the source → `ALLOWED`

### Database Schema Additions (Prisma)

```prisma
// Validation verdicts aggregated hourly
model ValidationSummary {
  id          String   @id @default(cuid())
  clusterId   String
  cluster     Cluster  @relation(fields: [clusterId], references: [id])
  
  hour        DateTime // Bucket timestamp
  
  // Verdict counts
  allowedCount   Int
  blockedCount   Int
  noPolicyCount  Int
  
  // Top sources/destinations with NO_POLICY (coverage gaps)
  coverageGaps   Json  // Array of {source, destination, count}
  
  // Top blocked flows (potential misconfigurations)
  topBlocked     Json  // Array of {source, destination, policy, count}
  
  createdAt   DateTime @default(now())
  
  @@unique([clusterId, hour])
  @@index([clusterId, hour])
}

// Individual validation events (kept short-term for debugging)
model ValidationEvent {
  id          String   @id @default(cuid())
  clusterId   String
  cluster     Cluster  @relation(fields: [clusterId], references: [id])
  
  timestamp   DateTime
  verdict     String   // ALLOWED, BLOCKED, NO_POLICY
  
  srcNamespace  String
  srcPodName    String?
  srcLabels     Json
  
  dstNamespace  String
  dstPodName    String?
  dstLabels     Json
  dstPort       Int
  protocol      String
  
  matchedPolicy String?  // Policy name if applicable
  reason        String?
  
  createdAt   DateTime @default(now())
  
  @@index([clusterId, timestamp])
  @@index([clusterId, verdict])
}
```

### API Endpoints

```typescript
// src/server/api/routers/validation.ts

export const validationRouter = createTRPCRouter({
  // Get validation summary for a cluster
  getSummary: protectedProcedure
    .input(z.object({
      clusterId: z.string(),
      startTime: z.date(),
      endTime: z.date(),
    }))
    .query(async ({ ctx, input }) => {
      // Returns aggregated verdict counts and top issues
    }),

  // Get coverage gaps (flows with NO_POLICY)
  getCoverageGaps: protectedProcedure
    .input(z.object({
      clusterId: z.string(),
      limit: z.number().default(20),
    }))
    .query(async ({ ctx, input }) => {
      // Returns top source/destination pairs lacking policy coverage
    }),

  // Get recent blocked flows
  getBlockedFlows: protectedProcedure
    .input(z.object({
      clusterId: z.string(),
      limit: z.number().default(50),
    }))
    .query(async ({ ctx, input }) => {
      // Returns recent BLOCKED verdicts for troubleshooting
    }),
});
```

### Operator REST Endpoint for Validation Ingestion

```typescript
// src/app/api/operator/validation/route.ts

// POST /api/operator/validation
// Receives validation summaries from cluster collectors
export async function POST(req: Request) {
  // Authenticate via cluster token
  // Upsert ValidationSummary records
  // Store recent ValidationEvents (with TTL cleanup)
}
```

### UI Components

```
src/components/validation/
├── ValidationDashboard.tsx      # Main validation overview
├── VerdictPieChart.tsx          # ALLOWED/BLOCKED/NO_POLICY breakdown
├── CoverageGapsTable.tsx        # Flows needing policy attention
├── BlockedFlowsTable.tsx        # Recently blocked flows
└── ValidationTimeline.tsx       # Verdict trends over time
```

---

## Policy Pack Marketplace (V1)

### Purpose
Pre-built policy bundles that accelerate adoption:
- **Community Tier** (Free): Open-source patterns for common workloads
- **Enterprise Tier** (Subscription): Auditor-validated compliance packs

### Two-Tier Model

| Aspect | Community | Enterprise |
|--------|-----------|------------|
| Price | Free | Subscription |
| Validation | Community-reviewed | Third-party auditor certified |
| Support | Self-service | SLA + support |
| Compliance Mapping | None | Full control documentation |
| Updates | Best-effort | Guaranteed for framework changes |

### MVP Policy Packs

**Community (4 packs)**:
- Microservices Baseline (default deny + service patterns)
- Database Tier Isolation (PostgreSQL, MySQL, Redis)
- API Gateway Patterns (north-south traffic)
- Observability Stack (Prometheus, Grafana, OTel)

**Enterprise (4 packs)**:
- SOC2 Network Controls (Trust Services Criteria CC6.1)
- DORA ICT Risk Management (EU Digital Operational Resilience)
- PCI-DSS Network Segmentation (Cardholder data isolation)
- CIS Kubernetes Benchmark (Network policy controls v1.8)

### Database Schema Additions (Prisma)

```prisma
// Policy pack definition
model PolicyPack {
  id          String   @id @default(cuid())
  slug        String   @unique  // e.g., "soc2-network-controls"
  name        String
  description String
  
  tier        String   // "community" or "enterprise"
  category    String   // "compliance", "workload", "security"
  
  // For enterprise packs
  complianceFramework String?  // "SOC2", "DORA", "PCI-DSS", "CIS"
  auditorName         String?  // Third-party auditor
  certificationDate   DateTime?
  
  // Content
  version     String
  policies    PolicyPackItem[]
  
  // Metadata
  iconUrl     String?
  docsUrl     String?
  
  isPublished Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  // Usage tracking
  installations PolicyPackInstallation[]
}

// Individual policy within a pack
model PolicyPackItem {
  id          String     @id @default(cuid())
  packId      String
  pack        PolicyPack @relation(fields: [packId], references: [id])
  
  name        String
  description String
  yamlContent String     @db.Text
  
  // For enterprise: control mapping
  controlIds  Json?      // e.g., ["CC6.1.1", "CC6.1.2"] for SOC2
  
  order       Int        @default(0)
  
  @@index([packId])
}

// Track pack installations per organization
model PolicyPackInstallation {
  id          String       @id @default(cuid())
  packId      String
  pack        PolicyPack   @relation(fields: [packId], references: [id])
  orgId       String
  organization Organization @relation(fields: [orgId], references: [id])
  
  installedAt DateTime     @default(now())
  installedBy String       // User ID
  
  // Which clusters have this pack deployed
  deployments PolicyPackDeployment[]
  
  @@unique([packId, orgId])
}

// Track pack deployment to specific clusters
model PolicyPackDeployment {
  id              String   @id @default(cuid())
  installationId  String
  installation    PolicyPackInstallation @relation(fields: [installationId], references: [id])
  clusterId       String
  cluster         Cluster  @relation(fields: [clusterId], references: [id])
  
  status          String   // "pending", "deployed", "failed"
  deployedAt      DateTime?
  
  @@unique([installationId, clusterId])
}

// Organization subscription for enterprise features
model Subscription {
  id          String       @id @default(cuid())
  orgId       String       @unique
  organization Organization @relation(fields: [orgId], references: [id])
  
  tier        String       // "free", "enterprise"
  status      String       // "active", "cancelled", "past_due"
  
  // Stripe integration
  stripeCustomerId     String?
  stripeSubscriptionId String?
  
  currentPeriodStart DateTime?
  currentPeriodEnd   DateTime?
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

### API Endpoints

```typescript
// src/server/api/routers/marketplace.ts

export const marketplaceRouter = createTRPCRouter({
  // List available packs (filtered by tier access)
  listPacks: protectedProcedure
    .input(z.object({
      category: z.string().optional(),
      tier: z.enum(["community", "enterprise"]).optional(),
    }))
    .query(async ({ ctx, input }) => {
      // Returns packs user has access to based on subscription
    }),

  // Get pack details with policies
  getPackDetails: protectedProcedure
    .input(z.object({ packId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Returns full pack with policy YAML (if authorized)
    }),

  // Install pack to organization
  installPack: protectedProcedure
    .input(z.object({ packId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Creates PolicyPackInstallation
      // Checks subscription for enterprise packs
    }),

  // Deploy installed pack to cluster
  deployToCluster: protectedProcedure
    .input(z.object({
      installationId: z.string(),
      clusterId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Creates policies in cluster via operator
    }),

  // Get installation status
  getInstallations: protectedProcedure
    .query(async ({ ctx }) => {
      // Returns all packs installed by user's organization
    }),
});
```

### UI Components

```
src/components/marketplace/
├── MarketplaceBrowser.tsx       # Main pack listing with filters
├── PackCard.tsx                 # Pack preview card
├── PackDetails.tsx              # Full pack view with policies
├── PackInstallModal.tsx         # Install flow
├── TierBadge.tsx                # Community/Enterprise badge
├── ComplianceBadge.tsx          # SOC2/DORA/PCI-DSS badges
└── InstallationManager.tsx      # Manage installed packs
```

### Pages

```
src/app/(dashboard)/marketplace/
├── page.tsx                     # Browse all packs
├── [packId]/page.tsx            # Pack details
└── installed/page.tsx           # Manage installations
```

---

## Adaptive Recommendations (V2)

### Purpose
Uses accumulated traffic data to proactively suggest policy improvements:
- Identify coverage gaps (frequently seen NO_POLICY flows)
- Flag overly permissive policies (allowed but never used)
- Generate policy suggestions from observed traffic patterns

### Architecture

```
operator/
└── internal/
    └── telemetry/
        └── recommendations/       # NEW: Recommendation engine
            ├── analyzer.go        # Traffic pattern analysis
            ├── generator.go       # Policy YAML generation
            └── scorer.go          # Confidence scoring

src/server/
└── api/
    └── routers/
        └── recommendations.ts     # Recommendation API
```

### Recommendation Types

```typescript
type RecommendationType = 
  | "COVERAGE_GAP"      // Flows with no policy - suggest new policy
  | "UNUSED_RULE"       // Allow rule never matched - suggest removal
  | "OVERLY_BROAD"      // Rule allows more than observed - suggest tightening
  | "CONSOLIDATION"     // Multiple policies could be merged
  | "COMPLIANCE_GAP";   // Missing policy for compliance requirement
```

### Database Schema Additions (Prisma)

```prisma
// Generated policy recommendations
model Recommendation {
  id          String   @id @default(cuid())
  clusterId   String
  cluster     Cluster  @relation(fields: [clusterId], references: [id])
  
  type        String   // COVERAGE_GAP, UNUSED_RULE, etc.
  severity    String   // "high", "medium", "low"
  confidence  Float    // 0.0 - 1.0 based on traffic volume
  
  title       String
  description String   @db.Text
  
  // The suggested action
  suggestedYaml String? @db.Text  // For new/modified policies
  targetPolicy  String?           // Existing policy to modify/remove
  
  // Evidence
  evidence    Json     // Traffic samples supporting this recommendation
  
  // User action
  status      String   @default("pending") // pending, accepted, dismissed
  actionedBy  String?
  actionedAt  DateTime?
  
  createdAt   DateTime @default(now())
  expiresAt   DateTime // Recommendations expire as traffic patterns change
  
  @@index([clusterId, status])
  @@index([clusterId, type])
}
```

### API Endpoints

```typescript
// src/server/api/routers/recommendations.ts

export const recommendationsRouter = createTRPCRouter({
  // Get pending recommendations for cluster
  getRecommendations: protectedProcedure
    .input(z.object({
      clusterId: z.string(),
      type: z.string().optional(),
      minConfidence: z.number().default(0.7),
    }))
    .query(async ({ ctx, input }) => {
      // Returns ranked recommendations
    }),

  // Accept recommendation (apply suggested policy)
  acceptRecommendation: protectedProcedure
    .input(z.object({
      recommendationId: z.string(),
      clusterId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Creates/modifies policy based on suggestion
      // Marks recommendation as accepted
    }),

  // Dismiss recommendation
  dismissRecommendation: protectedProcedure
    .input(z.object({
      recommendationId: z.string(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Marks as dismissed, factors into future scoring
    }),

  // Trigger recommendation generation (usually scheduled)
  generateRecommendations: protectedProcedure
    .input(z.object({ clusterId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Analyzes recent traffic and generates new recommendations
    }),
});
```

### UI Components

```
src/components/recommendations/
├── RecommendationsList.tsx      # List of pending recommendations
├── RecommendationCard.tsx       # Individual recommendation
├── RecommendationDetail.tsx     # Full detail with evidence
├── PolicyDiffView.tsx           # Show suggested changes
├── AcceptModal.tsx              # Confirm and apply
└── EvidenceTable.tsx            # Traffic samples supporting rec
```

---

## Implementation Roadmap

### Phase 1: Enforcement Validation Agent (V1.0)
1. Add `validation/` package to operator
2. Implement policy matcher with correct Cilium semantics
3. Add ValidationSummary/ValidationEvent to Prisma schema
4. Create `/api/operator/validation` ingestion endpoint
5. Build validation dashboard UI components
6. Integration testing with real cluster

### Phase 2: Policy Pack Marketplace (V1.0)
1. Add marketplace schema to Prisma
2. Create seed data for MVP packs (4 community + 4 enterprise)
3. Build marketplace browser UI
4. Implement pack installation flow
5. Add Stripe integration for subscriptions
6. Deploy-to-cluster workflow

### Phase 3: Adaptive Recommendations (V2.0)
1. Build traffic pattern analyzer in operator
2. Implement recommendation generator
3. Add recommendation schema to Prisma
4. Create recommendations API
5. Build recommendation UI with accept/dismiss flow
6. Scheduled recommendation generation job

---

## The Intelligence Loop

These features create a flywheel effect:

```
OBSERVE (Validation Agent)
    ↓ Flow data + verdicts
VALIDATE (Enforcement Analytics)
    ↓ Coverage gaps + violations
RECOMMEND (Adaptive Intelligence)
    ↓ Policy suggestions
IMPROVE (Marketplace + Intent AI)
    ↓ New policies deployed
    ↓
(back to OBSERVE)
```

More traffic observed → Better validation data → Smarter recommendations → Improved policies → More coverage → Repeat

---

## Key Files to Create

| File | Purpose |
|------|---------|
| `operator/internal/telemetry/validation/agent.go` | Main validation loop |
| `operator/internal/telemetry/validation/matcher.go` | Policy-to-flow matching |
| `src/server/api/routers/validation.ts` | Validation tRPC router |
| `src/server/api/routers/marketplace.ts` | Marketplace tRPC router |
| `src/server/api/routers/recommendations.ts` | Recommendations tRPC router |
| `src/app/(dashboard)/validation/page.tsx` | Validation dashboard |
| `src/app/(dashboard)/marketplace/page.tsx` | Marketplace browser |
| `src/app/(dashboard)/recommendations/page.tsx` | Recommendations list |
| `prisma/schema.prisma` | Add new models (see above) |
