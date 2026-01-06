# CLAUDE.md - Kubernetes Policy Hub

This document provides an overview of the Kubernetes Policy Hub project for AI assistants and developers.

## Project Overview

Kubernetes Policy Hub is a SaaS platform for managing Cilium network policies across multiple Kubernetes clusters. It provides:

- **Policy Management**: Create, version, and deploy CiliumNetworkPolicy resources
- **Time-Travel Simulation**: Test policies against historical network traffic before deployment
- **Telemetry Collection**: eBPF-based flow and process event collection via Hubble and Tetragon
- **Multi-Cluster Support**: Manage policies across multiple EKS/GKE/AKS clusters from a single dashboard

## Repository Structure

```
policy-hub-starter/
├── src/                          # Next.js SaaS application
│   ├── app/                      # App Router pages and API routes
│   │   ├── api/operator/         # Operator REST API endpoints
│   │   └── (dashboard)/          # Dashboard pages
│   ├── server/                   # tRPC routers and server logic
│   └── components/               # React components
├── operator/                     # Go-based Kubernetes operator
│   ├── cmd/
│   │   ├── manager/              # Operator controller manager
│   │   └── collector/            # Telemetry collector DaemonSet
│   ├── internal/
│   │   ├── controller/           # Kubernetes controllers
│   │   ├── saas/                 # SaaS API client
│   │   └── telemetry/            # Telemetry subsystem
│   │       ├── collector/        # Hubble/Tetragon clients
│   │       ├── storage/          # Parquet + SQLite storage
│   │       ├── simulation/       # Policy simulation engine
│   │       └── models/           # Unified event types
│   └── api/v1alpha1/             # CRD type definitions
├── prisma/                       # Database schema and migrations
└── deploy/                       # Kubernetes manifests
```

## Tech Stack

### SaaS Application (Next.js)
- **Framework**: Next.js 14 with App Router
- **API Layer**: tRPC for type-safe APIs
- **Database**: PostgreSQL with Prisma ORM
- **Auth**: Clerk (`@clerk/nextjs`) with OAuth + Email
- **UI**: React 18, Tailwind CSS, shadcn/ui components
- **State**: TanStack Query (React Query)
- **Validation**: Zod schemas

### Operator (Go)
- **Framework**: Kubebuilder / controller-runtime
- **eBPF Sources**: Cilium Hubble (flows), Tetragon (syscalls/process)
- **Storage**: Parquet files (columnar, compressed) + SQLite (indexing)
- **gRPC**: Hubble Relay and Tetragon connections
- **Dependencies**:
  - `github.com/cilium/cilium v1.16.5` - Hubble API
  - `github.com/cilium/tetragon/api` - Tetragon API
  - `github.com/xitongsys/parquet-go` - Parquet writer/reader
  - `github.com/mattn/go-sqlite3` - SQLite for event indexing
  - `sigs.k8s.io/controller-runtime` - Kubernetes controller

## Database Schema (Prisma)

### Core Models
- **Organization**: Multi-tenant container for clusters and policies
- **User**: GitHub OAuth users linked to organizations
- **Cluster**: Registered Kubernetes clusters with API tokens

### Policy Models
- **Policy**: CiliumNetworkPolicy definitions with YAML content
- **PolicyVersion**: Version history for policies
- **PolicyDeployment**: Tracks policy deployments to clusters

### Telemetry Models
- **FlowRecord**: Individual network flow events from Hubble
- **FlowSummary**: Aggregated flow statistics (hourly buckets)
- **ProcessSummary**: Aggregated Tetragon process events

### Simulation Models
- **Simulation**: Policy simulation requests and results
- **SimulationResult**: Per-flow simulation verdicts

## Key Architectural Decisions

### 1. DaemonSet Collector Architecture
Telemetry collectors run as a DaemonSet (one pod per node) for:
- Node-local access to Hubble agent and Tetragon socket
- Reduced network traffic (no cross-node telemetry shipping)
- Horizontal scaling with cluster size

### 2. Local Parquet + SQLite Storage
- **Parquet**: Columnar format with excellent compression (~10x)
- **SQLite**: Fast indexed queries for time-range lookups
- **7-day retention**: Automatic cleanup of old data
- **No external DB dependency**: Runs entirely on node-local storage

### 3. SaaS Receives Aggregates Only
- Raw flows stay in-cluster (privacy, bandwidth)
- Hourly summaries sent to SaaS for dashboards
- On-demand queries for simulation (SaaS → Operator → Collector)

### 4. Cilium Label Normalization
Cilium returns labels with prefixes (`k8s:app=nginx`), but policy YAML uses bare labels (`app: nginx`). The collector strips these prefixes during ingestion for consistent matching.

### 5. CiliumNetworkPolicy Semantics
- `endpointSelector`: Selects **destination** pods the policy applies to
- `ingress.fromEndpoints`: Filters allowed **source** pods
- `egress.toEndpoints`: Filters allowed **destination** pods
- Default deny when policy exists but no rule matches

## Coding Conventions

### Go (Operator)
- Standard Go project layout (`cmd/`, `internal/`, `api/`)
- Kubebuilder markers for CRD generation
- `logr.Logger` for structured logging
- Context propagation for cancellation
- Mutex protection for shared state (`sync.RWMutex`)
- Error wrapping with `fmt.Errorf("context: %w", err)`

### TypeScript (SaaS)
- Functional components with hooks
- tRPC procedures for API endpoints
- Zod schemas for validation
- Path aliases (`@/` for `src/`)
- Server components by default, `"use client"` when needed

### Testing
- Go: `go test ./...` with table-driven tests
- Sequential test execution recommended: `go test ./... -p 1`

## Current Implementation State

### Completed
- [x] SaaS dashboard with policy CRUD
- [x] Cluster registration and token auth
- [x] Operator with CRD reconciliation
- [x] Hubble flow collection and normalization
- [x] Tetragon process event collection
- [x] Parquet storage with daily partitions
- [x] SQLite indexing for fast queries (with sampling to limit growth)
- [x] 7-day retention cleanup + SQLite size limits (2GB max)
- [x] Policy simulation engine
- [x] Label prefix normalization (k8s:, reserved:, container:)
- [x] Skip-file mechanism for concurrent read/write safety
- [x] SaaS aggregate ingestion endpoints (`/api/operator/telemetry/aggregates`)
- [x] Validation agent with policy matching
- [x] Validation summary ingestion (`/api/operator/validation`)
- [x] Time-travel simulation UI
- [x] Policy Topology Map (React Flow with @xyflow/react)
- [x] Authentication (Clerk with OAuth + Email)
- [x] Multi-tenancy (Organization-based data isolation)
- [x] Onboarding flow

### In Progress
- [ ] Policy deployment workflow (deploy from SaaS UI to cluster)

### Planned
- [ ] Gateway API CRUD support (HTTPRoute, GRPCRoute, TCPRoute, TLSRoute)
- [ ] Policy Pack Marketplace
- [ ] Multi-cluster policy sync
- [ ] Policy recommendations from traffic analysis

## Important Files

| File | Purpose |
|------|---------|
| `operator/internal/telemetry/collector/hubble.go` | Hubble gRPC client, flow normalization |
| `operator/internal/telemetry/collector/tetragon.go` | Tetragon gRPC client |
| `operator/internal/telemetry/storage/parquet.go` | Parquet read/write |
| `operator/internal/telemetry/storage/manager.go` | Storage lifecycle management |
| `operator/internal/telemetry/simulation/engine.go` | Policy simulation logic |
| `operator/internal/telemetry/models/event.go` | Unified TelemetryEvent type |
| `src/server/api/routers/` | tRPC API routers |
| `prisma/schema.prisma` | Database schema |

## Running Locally

### SaaS
```bash
pnpm install
pnpm db:push      # Apply schema to database
pnpm dev          # Start Next.js dev server
```

### Operator
```bash
cd operator
make generate     # Generate CRD manifests
make build        # Build operator binary
make docker-build # Build container image
```

### Tests
```bash
# Go tests (run sequentially to avoid memory pressure)
cd operator && go test ./internal/telemetry/... -p 1

# TypeScript
pnpm test
```

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

---

## Strategic Roadmap

### Year 1 (FY26): Foundation + Validation
- Ship V1 with Validation Agent + Marketplace
- Accumulate traffic corpus
- Add "suggested policy" notifications for new workloads

### Year 2 (FY27): Intelligence Layer  
- Ship V2 Adaptive Recommendations
- Add opt-in "auto-bootstrap" mode for new deployments
- Compliance validation agents (continuous posture monitoring)
- Track recommendation acceptance rate

### Year 3+ (FY28+): Platform Evaluation
Decide whether to expand to agent platform based on:
- [ ] >90% policy suggestion acceptance rate
- [ ] Zero liability incidents from auto-policies
- [ ] 1000+ unique workload patterns in corpus
- [ ] Customer pull for automation

Until these gates are met, intelligence remains human-in-the-loop.

---

## Development Guidelines

### Build Priority (V1)

Work in this order:

1. **Core KPH** ✅ DONE
   - SaaS aggregate ingestion endpoints ✅
   - Simulation UI in dashboard ✅
   - Validation agent ✅
   - Topology map ✅
   - Authentication (Clerk) ✅

2. **Policy Deployment Workflow** ← CURRENT
   - Deploy policies from SaaS UI to cluster
   - Operator endpoint to receive and apply policies
   - Deployment status tracking

3. **Gateway API Support**
   - HTTPRoute, GRPCRoute, TCPRoute, TLSRoute CRUD
   - Gateway API in topology visualization

4. **Then Marketplace**
   - Schema + seed data
   - Browser UI
   - Installation flow
   - (Stripe integration can wait)

Do not start feature N+1 until feature N is working end-to-end.

### Out of Scope for V1

Do NOT implement these yet:

- Auto-bootstrap / auto-apply policies (Year 2)
- ML-based policy generation (Year 3+)
- Compliance validation agents (Year 2)
- Cross-customer corpus aggregation (Year 3+)
- Agent platform abstractions (Year 3+)

If a feature feels like "automation" or "AI generates policies automatically," stop and check—it's probably Year 2+.

### Definition of Done

A feature is complete when:

1. Backend API works (test via curl/Postman)
2. UI displays data correctly
3. Operator ↔ SaaS communication tested
4. Basic error handling in place
5. At least one happy-path test exists


## Expanded Policy Scope

KPH extends beyond ingress network policies to cover the full spectrum of eBPF-observable policies enforced by Cilium and Tetragon. All policy types share the same observe → validate → recommend → improve flywheel.

### Supported Policy Types

| Policy Type | CRD | Enforcement | Validation Agent Support | Phase |
|-------------|-----|-------------|-------------------------|-------|
| Ingress | CiliumNetworkPolicy | Cilium | ✅ V1.0 | FY26 Q1-Q2 |
| Egress | CiliumNetworkPolicy | Cilium | ✅ V1.1 | FY26 Q3 |
| DNS (FQDN) | CiliumNetworkPolicy | Cilium DNS Proxy | ✅ V1.2 | FY26 Q4 |
| L7 (HTTP/gRPC) | CiliumNetworkPolicy | Cilium Envoy | ✅ V2.0 | FY27 Q1-Q2 |
| Process/Syscall | TracingPolicy | Tetragon | ✅ V2.1 | FY27 Q3-Q4 |

### Policy Type Details

#### Egress Policies (V1.1)
Controls outbound traffic from pods — what external services and internal endpoints workloads can communicate with.

```yaml
# Example: Frontend can only talk to backend and Stripe API
spec:
  endpointSelector:
    matchLabels:
      app: frontend
  egress:
  - toEndpoints:
    - matchLabels:
        app: backend
  - toFQDN:
    - matchName: "api.stripe.com"
  - toCIDR:
    - 10.0.0.0/8
```

**Validation agent**: Same flow capture, evaluate egress rules instead of ingress.

**Verdict types**: ALLOWED, BLOCKED, NO_EGRESS_POLICY

#### DNS Policies (V1.2)
Controls which domains pods can resolve and connect to via Cilium's DNS proxy.

```yaml
# Example: Backend can only resolve AWS and internal DNS
spec:
  endpointSelector:
    matchLabels:
      app: backend
  egress:
  - toFQDN:
    - matchPattern: "*.amazonaws.com"
    - matchPattern: "*.internal.company.com"
  - toEndpoints:
    - matchLabels:
        io.kubernetes.pod.namespace: kube-system
        k8s-app: kube-dns
    toPorts:
    - ports:
      - port: "53"
        protocol: UDP
```

**Validation agent**: Capture DNS query events from Hubble, match against toFQDN rules.

**Verdict types**: DNS_ALLOWED, DNS_BLOCKED, NO_DNS_POLICY

**New telemetry**: DNSQueryRecord model for DNS-specific events.

#### L7 Policies (V2.0)
Controls HTTP methods, paths, headers, and gRPC services at the application layer.

```yaml
# Example: API gateway only allows specific HTTP methods/paths
spec:
  endpointSelector:
    matchLabels:
      app: api-gateway
  ingress:
  - fromEndpoints:
    - matchLabels:
        app: frontend
    toPorts:
    - ports:
      - port: "80"
        protocol: TCP
      rules:
        http:
        - method: "GET"
          path: "/api/v1/users"
        - method: "POST"
          path: "/api/v1/orders"
        - method: "GET"
          path: "/health"
```

**Validation agent**: Capture L7 flow metadata (method, path, headers) from Hubble when L7 visibility is enabled.

**Verdict types**: L7_ALLOWED, L7_BLOCKED, NO_L7_POLICY, L7_METHOD_DENIED, L7_PATH_DENIED

**Prerequisites**: Cilium L7 visibility must be enabled on target endpoints.

**New telemetry**: L7FlowRecord model with HTTP/gRPC metadata.

#### Process/Syscall Policies (V2.1)
Controls what processes can execute, what syscalls are allowed, and runtime behavior via Tetragon.

```yaml
# Example: Block privileged process execution
apiVersion: cilium.io/v1alpha1
kind: TracingPolicy
metadata:
  name: block-privileged-exec
spec:
  kprobes:
  - call: "sys_execve"
    syscall: true
    selectors:
    - matchCapabilities:
      - type: Effective
        operator: In
        values:
        - "CAP_SYS_ADMIN"
      matchActions:
      - action: Sigkill
```

**Validation agent**: Match Tetragon process events against TracingPolicy selectors.

**Verdict types**: PROCESS_ALLOWED, PROCESS_BLOCKED, SYSCALL_DENIED, NO_TRACING_POLICY

**Note**: TracingPolicy is a different CRD from CiliumNetworkPolicy — requires separate matcher implementation.

---

## Expanded Implementation Roadmap

### Phase 1: Core Network Policies (V1.0) — FY26 Q1-Q2
*Existing scope — no changes*

1. Ingress policy management
2. Enforcement Validation Agent
3. Policy Pack Marketplace
4. Validation dashboard

### Phase 1.1: Egress Policies — FY26 Q3
*Additive scope*

1. Extend validation matcher for egress rules
2. Add egress verdict types (ALLOWED, BLOCKED, NO_EGRESS_POLICY)
3. Egress coverage gap detection in recommendations
4. Update dashboard with egress validation view
5. Egress-focused policy packs (e.g., "Egress Lockdown", "External API Allowlist")

**Effort**: Low — same CRD, same flow data, different rule direction.

### Phase 1.2: DNS Policies — FY26 Q4
*Additive scope*

1. Capture DNS query events from Hubble
2. Add DNSQueryRecord telemetry model
3. Implement toFQDN rule matcher
4. Add DNS verdict types (DNS_ALLOWED, DNS_BLOCKED, NO_DNS_POLICY)
5. DNS policy recommendations based on observed queries
6. Dashboard: DNS query log with policy verdicts
7. DNS-focused policy packs (e.g., "Approved External Services", "Block Crypto Mining Domains")

**Effort**: Medium — new telemetry type, FQDN pattern matching.

**Database schema additions**:
```prisma
model DNSQueryRecord {
  id          String   @id @default(cuid())
  clusterId   String
  cluster     Cluster  @relation(fields: [clusterId], references: [id])
  
  timestamp   DateTime
  
  srcNamespace  String
  srcPodName    String?
  srcLabels     Json
  
  queryName     String    // e.g., "api.stripe.com"
  queryType     String    // A, AAAA, CNAME, etc.
  responseIPs   Json      // Resolved IPs
  
  verdict       String    // DNS_ALLOWED, DNS_BLOCKED, NO_DNS_POLICY
  matchedPolicy String?
  matchedRule   String?   // Which toFQDN pattern matched
  
  createdAt   DateTime @default(now())
  
  @@index([clusterId, timestamp])
  @@index([clusterId, queryName])
}
```

### Phase 2.0: L7 Policies — FY27 Q1-Q2
*Additive scope*

1. Capture L7 flow metadata from Hubble (HTTP method, path, headers, gRPC service/method)
2. Add L7FlowRecord telemetry model
3. Implement L7 rule matcher (HTTP path regex, method matching)
4. Add L7 verdict types
5. L7 policy recommendations ("You're allowing all POST but only using GET")
6. Dashboard: API traffic view with method/path breakdown
7. L7-focused policy packs (e.g., "REST API Security", "gRPC Service Mesh")
8. Integration with time-travel simulation for L7 rules

**Effort**: High — complex matching, requires L7 visibility enabled.

**Database schema additions**:
```prisma
model L7FlowRecord {
  id          String   @id @default(cuid())
  clusterId   String
  cluster     Cluster  @relation(fields: [clusterId], references: [id])
  
  timestamp   DateTime
  
  // L3/L4 context
  srcNamespace  String
  srcPodName    String?
  srcLabels     Json
  dstNamespace  String
  dstPodName    String?
  dstLabels     Json
  dstPort       Int
  
  // L7 metadata
  protocol      String    // HTTP, gRPC, Kafka
  
  // HTTP specific
  httpMethod    String?
  httpPath      String?
  httpHeaders   Json?
  httpStatusCode Int?
  
  // gRPC specific
  grpcService   String?
  grpcMethod    String?
  grpcStatusCode Int?
  
  verdict       String
  matchedPolicy String?
  matchedRule   String?
  
  createdAt   DateTime @default(now())
  
  @@index([clusterId, timestamp])
  @@index([clusterId, httpPath])
  @@index([clusterId, grpcService])
}
```

### Phase 2.1: Process/Syscall Policies — FY27 Q3-Q4
*Additive scope*

1. Parse and store TracingPolicy CRDs (new CRD type)
2. Extend Tetragon event collection to capture policy match metadata
3. Implement TracingPolicy selector matcher
4. Add process verdict types
5. Process/syscall recommendations based on observed behavior
6. Dashboard: Runtime security view with process tree visualization
7. Runtime-focused policy packs (e.g., "Container Hardening", "Cryptominer Detection", "Reverse Shell Prevention")

**Effort**: High — different CRD, different matching semantics, new security domain.

**Database schema additions**:
```prisma
model TracingPolicyRecord {
  id          String   @id @default(cuid())
  clusterId   String
  cluster     Cluster  @relation(fields: [clusterId], references: [id])
  
  // Policy metadata
  name        String
  namespace   String?   // Cluster-scoped if null
  yamlContent String    @db.Text
  
  // Parsed selectors for quick matching
  kprobes     Json      // Array of kprobe definitions
  tracepoints Json?     // Array of tracepoint definitions
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  @@unique([clusterId, name, namespace])
}

model ProcessEvent {
  id          String   @id @default(cuid())
  clusterId   String
  cluster     Cluster  @relation(fields: [clusterId], references: [id])
  
  timestamp   DateTime
  
  // Process context
  namespace   String
  podName     String
  containerName String
  
  // Process details
  processName String
  processPid  Int
  processUid  Int
  parentName  String?
  parentPid   Int?
  
  // Execution details
  binary      String
  arguments   Json
  cwd         String?
  
  // Syscall details (if applicable)
  syscall     String?
  
  // Capabilities
  capabilities Json?
  
  verdict     String    // PROCESS_ALLOWED, PROCESS_BLOCKED, SYSCALL_DENIED, NO_TRACING_POLICY
  matchedPolicy String?
  action      String?   // What Tetragon did: log, sigkill, etc.
  
  createdAt   DateTime @default(now())
  
  @@index([clusterId, timestamp])
  @@index([clusterId, processName])
  @@index([clusterId, verdict])
}
```

---

## Expanded Validation Agent Architecture

The validation agent extends to support multiple policy types:

```
operator/
└── internal/
    └── telemetry/
        └── validation/
            ├── agent.go              # Main validation loop
            ├── types.go              # Unified verdict types
            │
            ├── network/              # L3/L4 network policies
            │   ├── ingress.go        # V1.0: Ingress matching
            │   └── egress.go         # V1.1: Egress matching
            │
            ├── dns/                  # DNS/FQDN policies
            │   ├── collector.go      # V1.2: DNS event collection
            │   └── matcher.go        # V1.2: toFQDN matching
            │
            ├── l7/                   # L7 HTTP/gRPC policies
            │   ├── collector.go      # V2.0: L7 flow collection
            │   └── matcher.go        # V2.0: HTTP/gRPC rule matching
            │
            └── runtime/              # Process/syscall policies
                ├── collector.go      # V2.1: Tetragon event collection
                └── matcher.go        # V2.1: TracingPolicy matching
```

### Unified Verdict Model

```go
// PolicyDomain represents the type of policy being validated
type PolicyDomain string

const (
    DomainNetworkIngress PolicyDomain = "network:ingress"
    DomainNetworkEgress  PolicyDomain = "network:egress"
    DomainDNS            PolicyDomain = "dns"
    DomainL7HTTP         PolicyDomain = "l7:http"
    DomainL7GRPC         PolicyDomain = "l7:grpc"
    DomainProcess        PolicyDomain = "runtime:process"
    DomainSyscall        PolicyDomain = "runtime:syscall"
)

// UnifiedVerdict represents validation result across all policy types
type UnifiedVerdict struct {
    ID            string
    Timestamp     time.Time
    Domain        PolicyDomain
    
    // Source context (for network/DNS/L7)
    Source        *EndpointInfo
    
    // Destination context (for network/L7)
    Destination   *EndpointInfo
    
    // DNS context (for DNS domain)
    DNSQuery      *DNSQueryInfo
    
    // L7 context (for L7 domain)
    L7Request     *L7RequestInfo
    
    // Process context (for runtime domain)
    Process       *ProcessInfo
    
    // Verdict
    Verdict       string
    MatchedPolicy string
    MatchedRule   string
    Reason        string
}
```

---

## Expanded Policy Packs

### V1.1 Egress Packs
- **Egress Lockdown**: Default deny egress + explicit allowlist pattern
- **External API Allowlist**: Common SaaS APIs (Stripe, Twilio, SendGrid, etc.)
- **Database Egress**: Patterns for RDS, CloudSQL, Azure SQL access

### V1.2 DNS Packs
- **Approved Domains**: Allowlist pattern for known-good domains
- **Block Malicious**: Known cryptomining, C2, malware domains
- **Cloud Provider DNS**: AWS, GCP, Azure service domains

### V2.0 L7 Packs
- **REST API Security**: Method/path restrictions for REST services
- **gRPC Service Mesh**: Service-to-service gRPC policies
- **GraphQL Gateway**: Query/mutation restrictions

### V2.1 Runtime Packs
- **Container Hardening**: Block shell spawning, restrict capabilities
- **Cryptominer Detection**: Detect mining process signatures
- **Reverse Shell Prevention**: Block outbound shell connections

---

## Expanded Marketplace Categories

Update marketplace to organize by policy domain:

```typescript
type PolicyPackCategory = 
  | "network:ingress"      // V1.0
  | "network:egress"       // V1.1
  | "dns"                  // V1.2
  | "l7:http"              // V2.0
  | "l7:grpc"              // V2.0
  | "runtime:process"      // V2.1
  | "runtime:syscall"      // V2.1
  | "compliance"           // Cross-cutting (SOC2, PCI-DSS, etc.)
  | "workload";            // Application-specific (databases, queues, etc.)
```

---

## F5 Persona Mapping

| Policy Domain | Traditional F5 Equivalent | Target Buyer |
|---------------|---------------------------|--------------|
| Ingress | Firewall inbound rules, VIP ACLs | Network Security |
| Egress | Firewall outbound rules | Network Security |
| DNS | DNS security, FQDN filtering | Network Security |
| L7 HTTP/gRPC | WAF rules, ADC policies | AppSec, API Security |
| Process/Syscall | Runtime security, EDR | Security Operations |

All domains serve the same core persona: **Network and security professionals who've been sidelined by Kubernetes complexity.**


---

## V1 Core Features: Authentication, Policy Topology Map, Gateway API

These features are required for V1 launch alongside the existing policy CRUD, simulation, and validation agent capabilities.

---

### Authentication ✅ IMPLEMENTED

KPH uses Clerk for authentication. Authentication is required for all routes except the marketing landing page and operator API endpoints.

#### Auth Provider: Clerk

Clerk (`@clerk/nextjs`) provides a complete authentication solution with built-in UI components.

```
Dependencies:
- @clerk/nextjs
```

#### Supported Auth Methods

| Method | Status | Implementation |
|--------|--------|----------------|
| Email + Password | ✅ | Standard email/password login |
| Google OAuth | ✅ | Google Workspace SSO |
| GitHub OAuth | ✅ | Developer-friendly option |
| SAML SSO | Planned | Enterprise SSO (Okta, Azure AD) — V1.1 |

#### Auth Data Model

```prisma
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String?
  image         String?
  emailVerified DateTime?
  
  // Organization membership
  organizationId String?
  organization   Organization? @relation(fields: [organizationId], references: [id])
  role           UserRole      @default(MEMBER)
  
  // Auth
  accounts      Account[]
  sessions      Session[]
  
  // Activity
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  lastLoginAt   DateTime?
}

model Organization {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  
  // Subscription
  plan      Plan     @default(FREE)
  
  // Members
  users     User[]
  
  // Resources
  clusters  Cluster[]
  policies  Policy[]
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

enum UserRole {
  OWNER
  ADMIN
  MEMBER
  VIEWER
}

enum Plan {
  FREE        // 1 cluster, community packs only
  TEAM        // 5 clusters, all packs
  ENTERPRISE  // Unlimited, SSO, audit logs
}
```

#### Protected Routes

```typescript
// middleware.ts
export const config = {
  matcher: [
    '/dashboard/:path*',
    '/clusters/:path*',
    '/policies/:path*',
    '/topology/:path*',
    '/settings/:path*',
    '/api/:path*',
  ],
};
```

#### Auth UI Components

| Component | Route | Purpose |
|-----------|-------|---------|
| Sign In | `/auth/signin` | Email + OAuth provider buttons |
| Verify | `/auth/verify` | Magic link sent confirmation |
| Error | `/auth/error` | Auth error handling |
| New User | `/onboarding` | Post-signup cluster connection flow |

---

### Policy Topology Map

The Policy Topology Map is a visual, interactive graph that shows how policies affect traffic flows between workloads. It is the primary differentiation feature of KPH — transforming YAML into an intuitive visual representation.

#### Core Concept

The topology map answers three questions:
1. **What's happening?** — Live view of actual flows with policy verdicts
2. **What would happen?** — Simulation of proposed policy changes
3. **What's unprotected?** — Gap detection showing flows with no policy coverage

#### Technology Stack

```
Frontend:
- React Flow (@xyflow/react) — Interactive node-based graph
- @xyflow/background — Grid background
- @xyflow/controls — Zoom/pan controls
- @xyflow/minimap — Overview navigation

State Management:
- Zustand — Lightweight store for topology state
- React Query — Server state for flow data

Styling:
- Tailwind CSS — Consistent with existing UI
- Framer Motion — Smooth transitions between states
```

#### Visualization Modes

| Mode | Data Source | Use Case |
|------|-------------|----------|
| **Live** | Hubble flow logs via validation agent | Real-time traffic visualization |
| **Simulation** | Proposed policies + historical flows | "What-if" analysis before deployment |
| **Diff** | Current vs. proposed policy comparison | Change impact assessment |
| **Snapshot** | Point-in-time flow capture | Compliance audits, troubleshooting |

#### Graph Elements

##### Nodes

| Node Type | Icon | Represents | Metadata |
|-----------|------|------------|----------|
| `namespace` | Rounded rectangle container | Kubernetes namespace | Name, label count, policy count |
| `workload` | Pod/deployment icon | Deployment, StatefulSet, DaemonSet, Pod | Name, labels, replica count |
| `service` | Service icon | Kubernetes Service | Name, type (ClusterIP/LB), ports |
| `gateway` | Gateway icon | Gateway API Gateway resource | Name, listeners, attached routes |
| `external-cidr` | Cloud icon | External IP range (CIDR) | CIDR block, description |
| `external-fqdn` | Globe icon | External domain (FQDN) | Domain pattern, resolved IPs |
| `world` | Internet icon | Catch-all external (0.0.0.0/0) | — |

##### Edges

| Edge Type | Visual | Meaning |
|-----------|--------|---------|
| `allowed` | Solid green line | Traffic permitted by explicit policy |
| `denied` | Dashed red line | Traffic blocked by explicit policy |
| `no-policy` | Dotted amber line | Traffic allowed by default (no policy) |
| `gateway-route` | Blue line with arrow | Gateway API route path |

##### Edge Decorations

| Decoration | Meaning |
|------------|---------|
| Thickness | Flow volume (thicker = more traffic) |
| Animation | Active flow (animated = recent traffic) |
| Shield icon | Policy attached to this flow |
| Warning icon | Gap detected (no policy coverage) |
| L7 badge | L7 policy active (shows HTTP/gRPC) |

#### Policy Layer Toggles

Users can show/hide policy layers to focus on specific policy types:

```typescript
interface TopologyFilters {
  layers: {
    ciliumNetworkPolicy: boolean;  // L3/L4 ingress/egress
    ciliumDNSPolicy: boolean;       // FQDN-based egress
    ciliumL7Policy: boolean;        // HTTP/gRPC rules
    gatewayAPI: boolean;            // HTTPRoute, GRPCRoute, TCPRoute
    tetragonPolicy: boolean;        // Process/syscall (V2.1)
  };
  
  namespaces: string[];             // Filter to specific namespaces
  verdict: 'all' | 'allowed' | 'denied' | 'no-policy';
  timeRange: '5m' | '15m' | '1h' | '24h' | 'custom';
  
  search: string;                   // Filter nodes by name/label
}
```

#### Data Model

```typescript
// Topology node types
interface TopologyNode {
  id: string;
  type: 'namespace' | 'workload' | 'service' | 'gateway' | 'external-cidr' | 'external-fqdn' | 'world';
  
  // Display
  label: string;
  icon?: string;
  
  // Kubernetes metadata
  namespace?: string;
  labels?: Record<string, string>;
  
  // Grouping (for namespace containers)
  parentId?: string;
  
  // Metrics
  metrics?: {
    flowCount: number;
    policyCount: number;
    gapCount: number;        // Flows with no policy
    lastSeen: Date;
  };
  
  // Position (managed by React Flow)
  position: { x: number; y: number };
}

// Topology edge types
interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  
  // Flow metadata
  direction: 'ingress' | 'egress';
  port?: number;
  protocol?: 'TCP' | 'UDP' | 'SCTP';
  
  // Policy verdict
  verdict: 'ALLOWED' | 'DENIED' | 'NO_POLICY';
  
  // Policies affecting this edge
  policies: PolicyReference[];
  
  // L7 details (if applicable)
  l7?: {
    protocol: 'HTTP' | 'gRPC' | 'Kafka';
    methods?: string[];       // GET, POST, etc.
    paths?: string[];         // /api/v1/*, etc.
    headers?: Record<string, string>;
  };
  
  // Gateway API details (if applicable)
  gateway?: {
    gatewayName: string;
    routeName: string;
    routeType: 'HTTPRoute' | 'GRPCRoute' | 'TCPRoute' | 'TLSRoute';
    hostnames?: string[];
    matches?: RouteMatch[];
  };
  
  // Metrics
  metrics: {
    flowCount: number;
    bytesTotal: number;
    lastSeen: Date;
    latencyP50?: number;
    latencyP99?: number;
  };
}

interface PolicyReference {
  type: 'CiliumNetworkPolicy' | 'CiliumClusterwideNetworkPolicy' | 'KubernetesNetworkPolicy' | 'HTTPRoute' | 'GRPCRoute' | 'TCPRoute' | 'TracingPolicy';
  name: string;
  namespace?: string;         // Null for cluster-scoped
  rule?: string;              // Specific rule within policy that matched
  action: 'ALLOW' | 'DENY';
}

interface RouteMatch {
  path?: { type: 'Exact' | 'PathPrefix' | 'RegularExpression'; value: string };
  headers?: { name: string; value: string }[];
  method?: string;
}
```

#### API Endpoints

```typescript
// GET /api/topology/graph
// Returns the full topology graph for a cluster
interface TopologyGraphRequest {
  clusterId: string;
  mode: 'live' | 'simulation';
  filters: TopologyFilters;
  
  // For simulation mode
  proposedPolicies?: Policy[];
}

interface TopologyGraphResponse {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  
  summary: {
    totalNodes: number;
    totalEdges: number;
    allowedFlows: number;
    deniedFlows: number;
    unprotectedFlows: number;   // Gaps
    policyCount: number;
  };
  
  timestamp: Date;
  dataAge: number;              // Seconds since last flow update
}

// GET /api/topology/flows
// Returns raw flow data for an edge (drill-down)
interface TopologyFlowsRequest {
  clusterId: string;
  edgeId: string;
  limit?: number;
  offset?: number;
}

interface TopologyFlowsResponse {
  flows: FlowRecord[];
  total: number;
}

// POST /api/topology/simulate
// Simulates policy changes against historical flows
interface TopologySimulateRequest {
  clusterId: string;
  policies: Policy[];           // Proposed policy set
  timeRange: string;            // Historical flow window
}

interface TopologySimulateResponse {
  graph: TopologyGraphResponse;
  
  changes: {
    newlyAllowed: TopologyEdge[];
    newlyDenied: TopologyEdge[];
    newlyProtected: TopologyEdge[];  // Was NO_POLICY, now has policy
    unchanged: number;
  };
  
  warnings: SimulationWarning[];
}

interface SimulationWarning {
  severity: 'error' | 'warning' | 'info';
  message: string;
  affectedEdges: string[];
}
```

#### UI Components

```
components/
└── topology/
    ├── TopologyMap.tsx           # Main React Flow canvas
    ├── TopologyControls.tsx      # Zoom, pan, fit, layout buttons
    ├── TopologyFilters.tsx       # Layer toggles, namespace filter, search
    ├── TopologyMinimap.tsx       # Overview navigation
    ├── TopologyLegend.tsx        # Edge/node type legend
    │
    ├── nodes/
    │   ├── NamespaceNode.tsx     # Namespace container node
    │   ├── WorkloadNode.tsx      # Pod/deployment node
    │   ├── ServiceNode.tsx       # Service node
    │   ├── GatewayNode.tsx       # Gateway API gateway node
    │   ├── ExternalNode.tsx      # CIDR/FQDN/world node
    │   └── NodeTooltip.tsx       # Hover details
    │
    ├── edges/
    │   ├── FlowEdge.tsx          # Standard flow edge
    │   ├── GatewayEdge.tsx       # Gateway route edge
    │   ├── EdgeLabel.tsx         # Policy/verdict badge
    │   └── EdgeTooltip.tsx       # Hover details with flow list
    │
    ├── panels/
    │   ├── NodeDetailPanel.tsx   # Selected node details sidebar
    │   ├── EdgeDetailPanel.tsx   # Selected edge details + flow list
    │   ├── PolicyPanel.tsx       # Policies affecting selection
    │   └── SimulationPanel.tsx   # Simulation controls + diff view
    │
    └── hooks/
        ├── useTopologyData.ts    # React Query hook for graph data
        ├── useTopologyLayout.ts  # Auto-layout algorithms
        ├── useTopologyFilters.ts # Filter state management
        └── useSimulation.ts      # Simulation mode state
```

#### Layout Algorithms

React Flow supports custom layout algorithms. KPH uses:

| Layout | Use Case | Algorithm |
|--------|----------|-----------|
| **Hierarchical** | Default view, shows traffic flow direction | Dagre (top-to-bottom or left-to-right) |
| **Grouped** | Namespace-centric view | Force-directed within namespace bounds |
| **Radial** | Single workload focus | Selected node at center, connections radiate out |

```typescript
// Layout options
interface LayoutOptions {
  algorithm: 'hierarchical' | 'grouped' | 'radial';
  direction: 'TB' | 'LR' | 'BT' | 'RL';  // Top-bottom, left-right, etc.
  spacing: { x: number; y: number };
  groupByNamespace: boolean;
}
```

#### Integration with Existing UI

The topology map appears in multiple contexts:

| Location | Mode | Purpose |
|----------|------|---------|
| `/dashboard` | Live (summary) | Small overview widget showing cluster health |
| `/clusters/[id]/topology` | Live (full) | Full-page topology explorer |
| `/policies/simulate` | Simulation | Policy change impact visualization |
| `/policies/[id]` | Filtered | Show only flows affected by this policy |

---

### Gateway API Support

Gateway API is the Kubernetes-native successor to Ingress, providing north-south traffic routing with rich policy capabilities. Cilium implements Gateway API natively, making it a natural fit for KPH.

#### Why Gateway API in V1

1. **F5 Strategic Alignment**: Gateway API is the future of Kubernetes ingress; F5 ELT is concerned about Ingress NGINX deprecation
2. **Cilium Native**: Cilium's Gateway API implementation uses the same eBPF datapath as CNP
3. **Already in UI**: Gateway API is listed in the policy creation dropdown — needs backend support
4. **Familiar Concepts**: F5 customers understand L7 routing rules (similar to BIG-IP LTM)

#### Gateway API Resources

| Resource | Purpose | KPH Support |
|----------|---------|-------------|
| `Gateway` | Defines listeners (ports, protocols, TLS) | Read, visualize |
| `HTTPRoute` | HTTP path/header routing + filtering | Full CRUD, simulation, validation |
| `GRPCRoute` | gRPC service routing | Full CRUD, simulation, validation |
| `TCPRoute` | L4 TCP routing | Full CRUD, simulation, validation |
| `TLSRoute` | TLS passthrough routing | Full CRUD, simulation, validation |
| `ReferenceGrant` | Cross-namespace reference permissions | Read, validate |

#### HTTPRoute Example

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: api-routes
  namespace: production
spec:
  parentRefs:
  - name: main-gateway
    namespace: gateway-system
  hostnames:
  - "api.example.com"
  rules:
  - matches:
    - path:
        type: PathPrefix
        value: /api/v1/users
      method: GET
    backendRefs:
    - name: users-service
      port: 8080
  - matches:
    - path:
        type: PathPrefix
        value: /api/v1/orders
      headers:
      - name: X-API-Version
        value: "2"
    backendRefs:
    - name: orders-v2-service
      port: 8080
    filters:
    - type: RequestHeaderModifier
      requestHeaderModifier:
        add:
        - name: X-Request-ID
          value: "generated"
```

#### Data Model

```prisma
model GatewayAPIPolicy {
  id          String   @id @default(cuid())
  clusterId   String
  cluster     Cluster  @relation(fields: [clusterId], references: [id])
  
  // Resource identity
  kind        GatewayAPIKind
  name        String
  namespace   String
  
  // Raw YAML
  yamlContent String   @db.Text
  
  // Parsed for querying
  parentRefs  Json     // Gateway references
  hostnames   Json?    // Hostname list
  rules       Json     // Parsed rules for matching
  
  // Status
  status      PolicyStatus @default(ACTIVE)
  syncedAt    DateTime?
  
  // Metadata
  labels      Json?
  annotations Json?
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  @@unique([clusterId, kind, namespace, name])
  @@index([clusterId, kind])
}

enum GatewayAPIKind {
  HTTPRoute
  GRPCRoute
  TCPRoute
  TLSRoute
  Gateway
  ReferenceGrant
}
```

#### Gateway API in Topology Map

Gateway API routes appear as a distinct layer in the topology:

```
                    ┌─────────────────────────┐
   Internet ───────▶│  Gateway (main-gw)      │
                    │  :443 (HTTPS)           │
                    └───────────┬─────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
              ▼                 ▼                 ▼
    ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
    │ HTTPRoute:      │ │ HTTPRoute:      │ │ HTTPRoute:      │
    │ /api/v1/users   │ │ /api/v1/orders  │ │ /api/v1/auth    │
    └────────┬────────┘ └────────┬────────┘ └────────┬────────┘
             │                   │                   │
             ▼                   ▼                   ▼
    ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
    │ users-service   │ │ orders-service  │ │ auth-service    │
    │ :8080           │ │ :8080           │ │ :8080           │
    └─────────────────┘ └─────────────────┘ └─────────────────┘
```

Visual representation:
- **Gateway node**: Shows listeners, TLS config
- **Route edges**: Blue lines from Gateway to backend services
- **Route labels**: Path prefix, hostname, method filters
- **Backend refs**: Target services with weights (for traffic splitting)

#### Gateway API Validation

The validation agent extends to verify Gateway API routes:

| Validation | Check |
|------------|-------|
| **Route attachment** | Is the HTTPRoute attached to a valid Gateway? |
| **Backend exists** | Do all backendRefs point to existing Services? |
| **ReferenceGrant** | Are cross-namespace references permitted? |
| **Hostname conflict** | Do multiple routes claim the same hostname + path? |
| **TLS config** | Is TLS configured for HTTPS listeners? |

#### Gateway API in Policy Packs

Marketplace packs can include Gateway API resources:

```yaml
# pack-manifest.yaml
name: secure-api-gateway
version: 1.0.0
description: Production-ready API gateway with rate limiting and auth
policies:
  - kind: Gateway
    name: api-gateway
  - kind: HTTPRoute
    name: api-routes
  - kind: HTTPRoute  
    name: health-routes
  - kind: CiliumNetworkPolicy
    name: gateway-network-policy  # Pairs with Gateway API
```

#### API Endpoints

```typescript
// Gateway API CRUD follows same pattern as CiliumNetworkPolicy

// GET /api/clusters/[clusterId]/gateway-api
// List all Gateway API resources
interface ListGatewayAPIRequest {
  clusterId: string;
  kind?: GatewayAPIKind;
  namespace?: string;
}

// POST /api/clusters/[clusterId]/gateway-api
// Create Gateway API resource
interface CreateGatewayAPIRequest {
  clusterId: string;
  kind: GatewayAPIKind;
  yaml: string;
}

// GET /api/clusters/[clusterId]/gateway-api/[kind]/[namespace]/[name]
// Get specific Gateway API resource

// PUT /api/clusters/[clusterId]/gateway-api/[kind]/[namespace]/[name]
// Update Gateway API resource

// DELETE /api/clusters/[clusterId]/gateway-api/[kind]/[namespace]/[name]
// Delete Gateway API resource

// POST /api/clusters/[clusterId]/gateway-api/simulate
// Simulate Gateway API changes
interface SimulateGatewayAPIRequest {
  clusterId: string;
  resources: GatewayAPIResource[];
}
```

---

### V1 Feature Summary

| Feature | Status | Notes |
|---------|--------|-------|
| **Authentication** | ✅ Done | Clerk with OAuth + Email |
| **Organization Model** | ✅ Done | Multi-tenant data isolation |
| **Policy Topology Map** | ✅ Done | React Flow (@xyflow/react) |
| **Validation Agent** | ✅ Done | Policy matching + verdict reporting |
| **Time-Travel Simulation** | ✅ Done | Historical flow analysis |
| **Policy Deployment Workflow** | 🔄 In Progress | Deploy from UI to cluster |
| **Gateway API CRUD** | ❌ Planned | HTTPRoute, GRPCRoute, TCPRoute, TLSRoute |
| **Gateway API in Topology** | ❌ Planned | Visualize routes as graph layer |

---

### Updated V1 Deliverables

With these additions, V1 now includes:

1. **Authentication & Multi-tenancy**
   - Email magic link + Google/GitHub OAuth
   - Organization-based data isolation
   - Role-based access (Owner, Admin, Member, Viewer)

2. **Policy Management**
   - CiliumNetworkPolicy CRUD (ingress)
   - CiliumClusterwideNetworkPolicy CRUD
   - KubernetesNetworkPolicy CRUD
   - **Gateway API CRUD (HTTPRoute, GRPCRoute, TCPRoute, TLSRoute)** ← NEW

3. **Policy Topology Map** ← NEW
   - Interactive graph visualization (React Flow)
   - Live mode (real-time flows)
   - Simulation mode (what-if analysis)
   - Policy layer toggles (CNP, Gateway API, DNS, L7)
   - Namespace filtering and search
   - Node/edge detail panels

4. **Policy Simulation**
   - Time-travel simulation against historical flows
   - **Visual diff in topology map** ← Enhanced
   - Verdict prediction

5. **Enforcement Validation Agent**
   - eBPF flow capture via Hubble
   - Real-time policy verdict validation
   - Gap detection (flows with no policy)
   - **Topology map data feed** ← Integration

6. **Validation Dashboard**
   - Policy coverage metrics
   - Validation event log
   - **Topology map widget** ← Integration

