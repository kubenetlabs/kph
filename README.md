# Kubernetes Policy Hub

A SaaS platform for unified Kubernetes policy management with AI-powered policy generation. Built with Next.js, tRPC, Prisma, and Claude AI.

## Features

- **Policy Management**: Full CRUD for Kubernetes policies with version tracking
- **AI Policy Generation**: Generate policies from natural language using Claude AI
- **Multi-Cluster Support**: Manage policies across multiple Kubernetes clusters
- **Time-Travel Simulation**: Replay historical traffic against policies before deployment
- **Policy Types Supported**:
  - Cilium Network Policies
  - Cilium Clusterwide Network Policies
  - Tetragon Tracing Policies
  - Gateway API HTTPRoute, GRPCRoute, TCPRoute

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **API**: tRPC 11 with React Query
- **Database**: PostgreSQL with Prisma ORM
- **AI**: Anthropic Claude API (claude-3-haiku)
- **Styling**: Tailwind CSS
- **Validation**: Zod

## Prerequisites

- Node.js 18+
- PostgreSQL database
- Anthropic API key (for AI policy generation)

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/henleda/kubernetes-poilicy-hub.git
cd kubernetes-poilicy-hub
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the root directory:

```env
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/policy_hub"

# Anthropic API (for AI policy generation)
ANTHROPIC_API_KEY="your-anthropic-api-key"
```

### 4. Set up the database

```bash
# Run migrations
npx prisma migrate dev

# Seed with sample data (optional)
npx prisma db seed
```

### 5. Start the development server

```bash
npm run dev
```

The app will be available at http://localhost:3000

## Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── api/               # API routes
│   │   ├── policies/      # AI generation endpoints
│   │   └── trpc/          # tRPC handler
│   ├── clusters/          # Cluster management
│   ├── dashboard/         # Dashboard
│   ├── policies/          # Policy management
│   │   ├── [id]/          # Policy detail page
│   │   └── generate/      # AI policy generation
│   └── simulation/        # Time-travel simulation
├── components/            # React components
│   ├── clusters/          # Cluster-specific components
│   ├── dashboard/         # Dashboard components
│   ├── layout/            # Layout components
│   ├── policies/          # Policy components
│   └── ui/                # Reusable UI components
├── lib/                   # Utility functions
├── providers/             # React context providers
└── server/                # Server-side code
    ├── routers/           # tRPC routers
    │   ├── _app.ts        # Root router
    │   ├── cluster.ts     # Cluster operations
    │   └── policy.ts      # Policy CRUD
    └── trpc.ts            # tRPC configuration
```

## API Reference

### tRPC Routes

| Route | Description |
|-------|-------------|
| `policy.list` | List all policies with filtering |
| `policy.getById` | Get policy by ID with relations |
| `policy.create` | Create a new policy |
| `policy.update` | Update a policy |
| `policy.delete` | Delete a policy |
| `policy.deploy` | Deploy a policy to cluster |
| `policy.archive` | Archive a policy |
| `policy.getStats` | Get policy statistics |
| `cluster.list` | List all clusters |

### REST Endpoints

#### Generate Policy with AI

```bash
POST /api/policies/generate-ai
Content-Type: application/json

{
  "prompt": "Allow frontend pods to connect to API on port 8080",
  "policyType": "CILIUM_NETWORK",
  "targetNamespace": "default"
}
```

**Policy Types**: `CILIUM_NETWORK`, `CILIUM_CLUSTERWIDE`, `TETRAGON`, `GATEWAY_HTTPROUTE`, `GATEWAY_GRPCROUTE`, `GATEWAY_TCPROUTE`

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npx prisma studio` | Open Prisma database GUI |
| `npx prisma db seed` | Seed the database |

## Database Schema

The Prisma schema includes:

- **Organization** - Multi-tenant support
- **User** - Users with roles (ADMIN, OPERATOR, VIEWER)
- **Cluster** - Kubernetes clusters with connection info
- **Policy** - Policies with type, status, and version tracking
- **PolicyVersion** - Version history for policies
- **FlowRecord** - Traffic data for simulation
- **Simulation** - Time-travel simulation runs

See `prisma/schema.prisma` for full details.

## Design System

| Color | Hex | Usage |
|-------|-----|-------|
| Background | #0A0E14 | Page background |
| Card | #151B24 | Card backgrounds |
| Primary | #00D4AA | Primary actions, success |
| Accent | #6366F1 | Secondary accent (purple) |
| Warning | #F59E0B | Warnings |
| Danger | #EF4444 | Errors, destructive actions |
| Muted | #8B949E | Secondary text |
| Foreground | #F0F6FC | Primary text |

## License

MIT
