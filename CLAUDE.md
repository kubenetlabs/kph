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
- **Auth**: NextAuth.js with GitHub OAuth
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
- [x] SQLite indexing for fast queries
- [x] 7-day retention cleanup
- [x] Policy simulation engine
- [x] Label prefix normalization (k8s:, reserved:, container:)
- [x] Skip-file mechanism for concurrent read/write safety

### In Progress
- [ ] SaaS aggregate ingestion endpoints
- [ ] Simulation UI in dashboard
- [ ] Policy deployment workflow

### Planned
- [ ] gRPC query API for on-demand simulation
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
