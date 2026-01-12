# CLAUDE.md - Kubernetes Policy Hub

## Project Overview

Kubernetes Policy Hub is a SaaS platform for managing Cilium network policies, Tetragon Policies, and Gateway API Routes across multiple Kubernetes clusters. It provides:

- **Policy Management**: Create, version, and deploy network and routing policies
- **Time-Travel Simulation**: Test policies against historical network traffic before deployment
- **Telemetry Collection**: eBPF-based flow and process event collection via Hubble and Tetragon
- **Policy Marketplace**: Curated policy packs for common architectures and compliance frameworks
- **Multi-Cluster Support**: Manage policies across EKS/GKE/AKS and bare metal clusters

## Repository Structure

```
policy-hub-starter/
├── src/                          # Next.js SaaS application
│   ├── app/                      # App Router pages and API routes
│   │   ├── api/operator/         # Operator REST API endpoints
│   │   └── (dashboard)/          # Dashboard pages
│   ├── server/                   # tRPC routers and server logic
│   ├── components/               # React components
│   ├── lib/                      # Shared utilities
│   └── test/                     # Test utilities and mocks
├── operator/                     # Go-based Kubernetes operator
│   ├── cmd/manager/              # Operator controller manager
│   ├── cmd/collector/            # Telemetry collector DaemonSet
│   └── internal/                 # Controllers, SaaS client, telemetry
├── prisma/                       # Database schema (source of truth)
└── deploy/                       # Kubernetes manifests
```

## Tech Stack

### SaaS Application (Next.js)
- **Framework**: Next.js 14 with App Router
- **API**: tRPC for type-safe APIs
- **Database**: PostgreSQL with Prisma ORM
- **Auth**: Clerk (`@clerk/nextjs`) with OAuth + Email
- **UI**: React 18, Tailwind CSS, React Flow (@xyflow/react)
- **State**: TanStack Query (React Query), Zustand
- **Validation**: Zod schemas

### Operator (Go)
- **Framework**: Kubebuilder / controller-runtime
- **eBPF Sources**: Cilium Hubble (flows), Tetragon (syscalls/process)
- **Storage**: Parquet files + SQLite (node-local, 7-day retention)
- **Key deps**: `github.com/cilium/cilium`, `github.com/cilium/tetragon/api`

## Key Architectural Decisions

1. **DaemonSet Collector**: One collector pod per node for local Hubble/Tetragon access
2. **Local Storage**: Parquet + SQLite on-node; raw flows stay in-cluster for privacy
3. **SaaS Receives Aggregates**: Hourly summaries sent to SaaS; on-demand queries for simulation
4. **Cilium Label Normalization**: Strip `k8s:`, `reserved:`, `container:` prefixes for matching
5. **Gateway API via Policy Model**: Gateway routes (HTTPRoute, GRPCRoute, TCPRoute, TLSRoute) are stored as Policy records with `GATEWAY_*` types, enabling version history and deployment tracking

## Coding Conventions

### TypeScript (SaaS)
- Functional components with hooks
- tRPC procedures for API endpoints
- Zod schemas for validation
- Path aliases (`~/` for `src/`)
- Server components by default, `"use client"` when needed

### Go (Operator)
- Standard Go layout (`cmd/`, `internal/`, `api/`)
- Kubebuilder markers for CRD generation
- `logr.Logger` for structured logging
- Error wrapping: `fmt.Errorf("context: %w", err)`

## Testing

### TypeScript - Vitest
```bash
npm run test           # Watch mode
npm run test:run       # Run once
npm run test:coverage  # With coverage
```

Test utilities in `src/test/`:
- `createMockPrismaClient()` - Mocked Prisma client
- `factories.*` - Test data factories (organization, user, cluster, policy, etc.)

Example:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockPrismaClient, factories } from "~/test/db-mock";

const mockDb = createMockPrismaClient();
vi.mock("~/lib/db", () => ({ db: mockDb }));

describe("Feature", () => {
  beforeEach(() => vi.clearAllMocks());
  it("should work", () => {
    mockDb.policy.findFirst.mockResolvedValue(factories.policy({ status: "DEPLOYED" }));
    // ... test
  });
});
```

### Go - Standard testing
```bash
cd operator && go test ./... -p 1  # Sequential to avoid memory pressure
```

## Running Locally

```bash
# SaaS
npm install
npx prisma db push    # Apply schema
npm run dev           # Start dev server

# Operator
cd operator
make generate && make build
```

## Important Files

| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | Database schema (source of truth) |
| `src/server/routers/policy.ts` | Policy CRUD + Gateway API validation |
| `src/server/routers/deployment.ts` | Deployment workflow (deploy, retry, rollback) |
| `src/server/routers/marketplace.ts` | Policy pack marketplace (browse, install, deploy) |
| `src/server/routers/template.ts` | Policy templates (multi-cluster sync) |
| `src/lib/gateway-api-validator.ts` | Gateway API YAML parsing/validation |
| `src/app/api/operator/policies/` | Operator policy fetch/status endpoints |
| `src/components/topology/` | React Flow topology map |
| `src/test/db-mock.ts` | Prisma mock utilities and factories |
| `vitest.config.ts` | Test configuration |

## Current Implementation State

### Completed
- [x] Policy CRUD (Cilium Network, Clusterwide, Tetragon, Gateway API routes)
- [x] Gateway API consolidated into Policy model with YAML validation
- [x] Cluster registration and operator authentication
- [x] Policy deployment workflow (operator polling, status updates, retries)
- [x] Hubble/Tetragon telemetry collection with Parquet storage
- [x] Policy simulation engine (time-travel against historical flows)
- [x] Validation agent with policy matching and verdict reporting
- [x] Policy Topology Map (React Flow visualization)
- [x] Authentication (Clerk) and multi-tenancy
- [x] Onboarding flow
- [x] Vitest test framework (87 tests passing)
- [x] Policy Pack Marketplace (browse, install, deploy, admin UI)
- [x] Multi-cluster policy sync (Policy Templates with manual sync to clusters)
- [x] Adaptive Recommendations (coverage gaps, unused policies, consolidation suggestions)

### In Progress
- [ ] Integration tests for deployment workflow

### Expanded Policy Types (V2+)
| Phase | Policy Type | Description |
|-------|-------------|-------------|
| V1.1 | Egress | Outbound traffic control |
| V1.2 | DNS/FQDN | Domain-based egress filtering |
| V2.0 | L7 HTTP/gRPC | Method/path/header rules |
| V2.1 | Process/Syscall | Tetragon TracingPolicy support |

## Development Guidelines

### Build Priority
1. Complete V1 features end-to-end before starting new features
2. Backend API → UI → Operator integration → Tests

### Definition of Done
1. Backend API works (test via curl/Postman)
2. UI displays data correctly
3. Operator ↔ SaaS communication tested
4. Basic error handling in place
5. At least one happy-path test exists

### Out of Scope for V1
- Auto-apply policies without human approval
- ML-based policy generation
- Cross-customer data aggregation
