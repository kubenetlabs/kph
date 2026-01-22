# KPH Installation Feature - Design Document

**Date:** 2026-01-21
**Status:** Approved
**Based on:** `docs/plans/kph-installation-plan.md`

---

## Overview

This design implements the installation and admin features for Kubernetes Policy Hub, enabling F5 Sales Engineering teams to deploy KPH in demo and customer environments. It covers:

- 5-role RBAC hierarchy with cluster-scoped assignments
- SuperAdmin console for platform management
- User invitation and registration flow
- Cluster registration wizard with Helm values generation
- Token management for operator authentication
- Audit logging for compliance

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Role hierarchy | 5 roles (SuperAdmin → OrgAdmin → ClusterAdmin → PolicyEditor → Viewer) | Granular control for enterprise demos |
| Role storage | Base role + ClusterAssignment table | Enables "Bob is ClusterAdmin for cluster X only" |
| SuperAdmin | `isSuperAdmin` boolean on User | Simple to check, separate from org-level role |
| Invitations | Stored in our DB, Clerk handles auth | Keep Clerk for auth, we control authorization |
| System config | Database table | SuperAdmins can toggle settings without redeploy |
| Scope | SaaS + Helm chart scaffolding | Generate values.yaml, include chart templates |

---

## 1. Database Schema Changes

### New/Updated Enums

```prisma
enum Role {
  ORG_ADMIN       // Manages their organization
  CLUSTER_ADMIN   // Manages assigned clusters (requires ClusterAssignment)
  POLICY_EDITOR   // Edits policies on assigned clusters (requires ClusterAssignment)
  VIEWER          // Read-only access
}

enum TokenType {
  AGENT  // kph_at_ - for operators
  API    // kph_api_ - for automation
}

enum TokenStatus {
  ACTIVE
  REVOKED
}
```

### Updated User Model

```prisma
model User {
  id              String    @id  // Clerk ID
  email           String    @unique
  name            String?
  image           String?
  isSuperAdmin    Boolean   @default(false)  // Platform-level access
  role            Role      @default(VIEWER) // Org-level role
  organizationId  String?
  organization    Organization? @relation(...)

  clusterAssignments ClusterAssignment[]
  invitationsSent    Invitation[] @relation("InvitedBy")
}
```

### New: ClusterAssignment

```prisma
model ClusterAssignment {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(...)
  clusterId String
  cluster   Cluster  @relation(...)
  role      Role     // CLUSTER_ADMIN, POLICY_EDITOR, or VIEWER
  createdAt DateTime @default(now())

  @@unique([userId, clusterId])
}
```

### New: Invitation

```prisma
model Invitation {
  id             String    @id @default(cuid())
  email          String
  organizationId String
  organization   Organization @relation(...)
  role           Role      @default(VIEWER)
  invitedById    String
  invitedBy      User      @relation("InvitedBy", ...)
  expiresAt      DateTime
  acceptedAt     DateTime?
  createdAt      DateTime  @default(now())

  @@index([email])
}
```

### New: SystemConfig

```prisma
model SystemConfig {
  key       String   @id
  value     Json
  updatedAt DateTime @updatedAt
}
```

### Updated: ApiToken

```prisma
model ApiToken {
  id             String    @id @default(cuid())
  name           String
  type           TokenType
  tokenHash      String    @unique
  prefix         String

  organizationId String
  organization   Organization @relation(...)
  clusterId      String?
  cluster        Cluster?     @relation(...)

  status         TokenStatus  @default(ACTIVE)
  expiresAt      DateTime?
  lastUsedAt     DateTime?
  revokedAt      DateTime?

  createdById    String
  createdBy      User         @relation(...)
  createdAt      DateTime     @default(now())
}
```

### Updated: AuditLog

```prisma
model AuditLog {
  id             String   @id @default(cuid())

  userId         String?
  user           User?    @relation(...)
  userEmail      String?

  organizationId String?
  organization   Organization? @relation(...)
  clusterId      String?

  action         String
  resourceType   String?
  resourceId     String?
  details        Json?

  ipAddress      String?
  userAgent      String?

  createdAt      DateTime @default(now())

  @@index([organizationId, createdAt])
  @@index([userId, createdAt])
  @@index([action, createdAt])
}
```

---

## 2. RBAC Enforcement Architecture

### Role Hierarchy

```
SuperAdmin (platform-wide)
    │
    ├── OrgAdmin (organization-scoped)
    │       │
    │       ├── ClusterAdmin (cluster-scoped)
    │       │       │
    │       │       └── PolicyEditor (cluster-scoped)
    │       │               │
    │       │               └── Viewer
    │       │
    │       └── Viewer
    │
    └── Viewer (read-only across platform)
```

### Permission Levels

```typescript
const ROLE_HIERARCHY: Record<Role, number> = {
  ORG_ADMIN: 40,
  CLUSTER_ADMIN: 30,
  POLICY_EDITOR: 20,
  VIEWER: 10,
};
```

### New Protected Procedures (`src/server/trpc.ts`)

```typescript
// SuperAdmin only
export const superAdminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!ctx.user.isSuperAdmin) {
    throw new TRPCError({ code: "FORBIDDEN", message: "SuperAdmin access required" });
  }
  return next({ ctx });
});

// Requires minimum org-level role
export const roleProtectedProcedure = (minRole: Role) =>
  orgProtectedProcedure.use(async ({ ctx, next }) => {
    if (!hasMinRole(ctx.user.role, minRole)) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    return next({ ctx });
  });

// Requires cluster-level permission
export const clusterProtectedProcedure = (minRole: Role) =>
  orgProtectedProcedure.use(async ({ ctx, input, next }) => {
    const clusterId = input.clusterId;
    const allowed = await checkClusterAccess(ctx.user, clusterId, minRole);
    if (!allowed) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }
    return next({ ctx: { ...ctx, clusterId } });
  });
```

### Permission Check Helper (`src/lib/permissions.ts`)

```typescript
export function hasMinRole(userRole: Role, requiredRole: Role): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

export async function checkClusterAccess(
  user: User,
  clusterId: string,
  minRole: Role
): Promise<boolean> {
  // SuperAdmins and OrgAdmins can access all clusters in their org
  if (user.isSuperAdmin || user.role === "ORG_ADMIN") return true;

  // Check cluster assignment
  const assignment = await db.clusterAssignment.findUnique({
    where: { userId_clusterId: { userId: user.id, clusterId } }
  });

  if (!assignment) return false;
  return hasMinRole(assignment.role, minRole);
}
```

### Usage Examples

```typescript
// Only OrgAdmins can register new clusters
registerCluster: roleProtectedProcedure("ORG_ADMIN")

// PolicyEditors+ can create policies on assigned clusters
createPolicy: clusterProtectedProcedure("POLICY_EDITOR")

// Only ClusterAdmins+ can deploy
deployPolicy: clusterProtectedProcedure("CLUSTER_ADMIN")
```

---

## 3. Admin Console (SuperAdmin)

### Route Structure

```
src/app/(admin)/
├── layout.tsx           # SuperAdmin check, admin nav sidebar
├── admin/
│   ├── page.tsx         # Dashboard: stats, recent activity
│   ├── users/
│   │   ├── page.tsx     # User list across all orgs
│   │   └── [id]/page.tsx # User detail/edit
│   ├── organizations/
│   │   ├── page.tsx     # Org list with user/cluster counts
│   │   ├── new/page.tsx # Create new org
│   │   └── [id]/page.tsx # Org detail, members, clusters
│   ├── clusters/
│   │   └── page.tsx     # All clusters across platform
│   ├── audit/
│   │   └── page.tsx     # Platform-wide audit logs
│   └── settings/
│       └── page.tsx     # System config
```

### Layout with Guard

```typescript
export default async function AdminLayout({ children }) {
  const user = await getCurrentUser();

  if (!user?.isSuperAdmin) {
    redirect("/dashboard");
  }

  return (
    <div className="flex">
      <AdminSidebar />
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
```

### Dashboard Metrics

- Total users (active in last 7 days / total)
- Total organizations
- Total connected clusters
- Recent activity feed
- System health indicators

---

## 4. Invitation Flow

### Creation (Admin/OrgAdmin)

```typescript
inviteUser: roleProtectedProcedure("ORG_ADMIN")
  .input(z.object({
    email: z.string().email(),
    organizationId: z.string(),
    role: z.enum(["ORG_ADMIN", "CLUSTER_ADMIN", "POLICY_EDITOR", "VIEWER"]),
    clusterIds: z.array(z.string()).optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    // 1. Validate email domain against allowed_domains
    // 2. Check for existing user/invitation
    // 3. Create Invitation record (expires in 7 days)
    // 4. Send invitation email
    // 5. Log to audit
  });
```

### Acceptance Flow

```
User clicks invite link
        │
        ▼
┌─────────────────────────────┐
│ /invite/[id] page           │
│ Shows: org name, role,      │
│ who invited them            │
└─────────────────────────────┘
        │
        ▼ (clicks Accept)
┌─────────────────────────────┐
│ Clerk sign-up/sign-in       │
└─────────────────────────────┘
        │
        ▼ (authenticated)
┌─────────────────────────────┐
│ POST /api/invitations/accept│
│ - Verify invitation valid   │
│ - Assign user to org + role │
│ - Create ClusterAssignments │
│ - Mark invitation accepted  │
└─────────────────────────────┘
```

### New User Without Invitation

```typescript
// After Clerk auth, check registration mode
if (!user && !invitation) {
  const regMode = await getSystemConfig("registration.mode");

  if (regMode === "invite_only") {
    redirect("/access-denied");
  }

  redirect("/onboarding");
}
```

---

## 5. Cluster Registration & Values.yaml Generation

### Wizard Flow

```
Step 1: Cluster Details    →    Step 2: Generate Token    →    Step 3: Install
- Name                          - Show token once              - Prerequisites check
- Environment                   - Copy button                  - Download values.yaml
- Description                   - Save warning                 - Helm commands
                                                               - Connection polling
```

### Values.yaml Generator (`src/lib/helm-values-generator.ts`)

```typescript
interface InstallOptions {
  tetragon: boolean;
  gatewayAPI: boolean;
  gatewayProvider?: "nginx" | "cilium" | "envoy" | "istio";
  profile: "demo" | "production" | "observability";
}

export function generateHelmValues(
  cluster: { name: string; environment: string },
  token: string,
  options: InstallOptions
): string {
  const values = {
    global: {
      clusterName: cluster.name,
      token: token,
      endpoint: process.env.NEXT_PUBLIC_KPH_WS_ENDPOINT,
    },
    operator: {
      replicas: options.profile === "production" ? 2 : 1,
      logLevel: options.profile === "demo" ? "debug" : "info",
      crds: {
        manageCiliumPolicies: true,
        manageTetragonPolicies: options.tetragon,
        manageGatewayAPI: options.gatewayAPI,
      },
    },
    collector: {
      tetragon: { enabled: options.tetragon },
    },
    tetragon: { enabled: options.tetragon },
    gatewayAPI: { enabled: options.gatewayAPI },
  };

  return yaml.stringify(values);
}
```

---

## 6. Helm Chart Structure

### Directory Layout

```
operator/charts/kph/
├── Chart.yaml
├── values.yaml
├── templates/
│   ├── _helpers.tpl
│   ├── namespace.yaml
│   ├── serviceaccount.yaml
│   ├── secret.yaml
│   ├── configmap.yaml
│   ├── operator/
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   ├── clusterrole.yaml
│   │   └── clusterrolebinding.yaml
│   ├── collector/
│   │   ├── daemonset.yaml
│   │   ├── clusterrole.yaml
│   │   └── clusterrolebinding.yaml
│   └── tests/
│       └── test-connection.yaml
```

### Operator Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "kph.fullname" . }}-operator
spec:
  replicas: {{ .Values.operator.replicas }}
  template:
    spec:
      serviceAccountName: {{ include "kph.serviceAccountName" . }}
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
      containers:
        - name: operator
          image: "{{ .Values.global.imageRegistry }}/kph-operator:{{ .Values.operator.image.tag }}"
          env:
            - name: KPH_CLUSTER_NAME
              value: {{ .Values.global.clusterName | quote }}
            - name: KPH_TOKEN
              valueFrom:
                secretKeyRef:
                  name: {{ include "kph.tokenSecretName" . }}
                  key: token
          ports:
            - name: grpc
              containerPort: 8081
            - name: health
              containerPort: 8080
```

### Collector DaemonSet

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: {{ include "kph.fullname" . }}-collector
spec:
  template:
    spec:
      hostPID: true
      securityContext:
        runAsUser: 0
      containers:
        - name: collector
          securityContext:
            privileged: true
            capabilities:
              add: [SYS_ADMIN, SYS_RESOURCE, NET_ADMIN, BPF]
          volumeMounts:
            - name: bpf
              mountPath: /sys/fs/bpf
            - name: cilium-socket
              mountPath: /var/run/cilium
      volumes:
        - name: bpf
          hostPath:
            path: /sys/fs/bpf
        - name: cilium-socket
          hostPath:
            path: /var/run/cilium
      tolerations:
        - operator: Exists
```

### Operator ClusterRole

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: {{ include "kph.fullname" . }}-operator
rules:
  - apiGroups: ["cilium.io"]
    resources: ["ciliumnetworkpolicies", "ciliumclusterwidenetworkpolicies"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: ["networking.k8s.io"]
    resources: ["networkpolicies"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  {{- if .Values.tetragon.enabled }}
  - apiGroups: ["cilium.io"]
    resources: ["tracingpolicies", "tracingpoliciesnamespaced"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  {{- end }}
  {{- if .Values.gatewayAPI.enabled }}
  - apiGroups: ["gateway.networking.k8s.io"]
    resources: ["gateways", "httproutes", "grpcroutes", "tcproutes", "tlsroutes", "referencegrants"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  {{- end }}
```

---

## 7. Token Management

### Token Generation (`src/lib/tokens.ts`)

```typescript
export function generateAgentToken(): { token: string; hash: string; prefix: string } {
  const randomPart = randomBytes(32).toString("base64url");
  const token = `kph_at_${randomPart}`;
  const hash = createHash("sha256").update(token).digest("hex");
  const prefix = `kph_at_${randomPart.substring(0, 8)}...`;

  return { token, hash, prefix };
}
```

### Token Router (`src/server/routers/token.ts`)

```typescript
export const tokenRouter = router({
  create: clusterProtectedProcedure("CLUSTER_ADMIN")
    .input(z.object({ clusterId: z.string(), name: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { token, hash, prefix } = generateAgentToken();
      // Store hash, return token once
    }),

  list: clusterProtectedProcedure("VIEWER")
    .input(z.object({ clusterId: z.string() }))
    .query(async ({ input }) => {
      // Return tokens with prefix only, never hash
    }),

  revoke: clusterProtectedProcedure("CLUSTER_ADMIN")
    .input(z.object({ clusterId: z.string(), tokenId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Set status to REVOKED
    }),
});
```

---

## 8. Organization Management (OrgAdmin)

### Route Structure

```
src/app/(dashboard)/settings/
├── page.tsx              # Redirect to /settings/members
├── members/
│   ├── page.tsx          # Org member list, invite users
│   └── [id]/page.tsx     # Edit member role, cluster assignments
├── clusters/
│   └── page.tsx          # Cluster overview
├── tokens/
│   └── page.tsx          # Org-level API tokens
└── profile/
    └── page.tsx          # Org name, slug
```

### Key Operations

- List members with cluster assignments
- Update member role and cluster access
- Remove member (with safeguards)
- Manage pending invitations

---

## 9. Audit Logging

### Audit Actions

```typescript
type AuditAction =
  | "user.login" | "user.logout"
  | "member.invited" | "member.joined" | "member.updated" | "member.removed"
  | "cluster.created" | "cluster.connected" | "cluster.disconnected"
  | "token.created" | "token.revoked"
  | "policy.created" | "policy.deployed" | "policy.rollback"
  | "org.created" | "system.config.updated";
```

### Audit Helper

```typescript
export async function logAudit(
  ctx: AuditContext,
  action: AuditAction,
  details?: Record<string, unknown>
) {
  await db.auditLog.create({
    data: {
      userId: ctx.user.id,
      userEmail: ctx.user.email,
      organizationId: ctx.organization?.id,
      action,
      details,
      ipAddress: ctx.request?.ip,
    },
  });
}
```

---

## 10. Migration from Existing Roles

### Mapping

| Old Role | New Role | Notes |
|----------|----------|-------|
| `ADMIN` | `ORG_ADMIN` | Full org access |
| `OPERATOR` | `POLICY_EDITOR` | Cannot deploy (breaking change) |
| `VIEWER` | `VIEWER` | No change |

### Migration Script

```sql
-- Migrate roles
UPDATE "User" SET "role_new" =
  CASE
    WHEN "role" = 'ADMIN' THEN 'ORG_ADMIN'
    WHEN "role" = 'OPERATOR' THEN 'POLICY_EDITOR'
    ELSE 'VIEWER'
  END;

-- Set SuperAdmin(s)
UPDATE "User" SET "isSuperAdmin" = true
  WHERE "email" IN ('d.henley@f5.com');
```

---

## 11. Implementation Phases

### Phase 1: Database & RBAC Foundation
- Prisma schema updates
- Migration script
- Permission helpers
- Protected procedures

### Phase 2: Admin Console (SuperAdmin)
- `/admin` layout and guard
- Dashboard, users, organizations
- System settings
- Platform audit logs

### Phase 3: Organization Management (OrgAdmin)
- Members page with CRUD
- Invite flow with email
- Pending invitations
- Org audit logs

### Phase 4: Invitation & Registration Flow
- Invitation creation/acceptance
- Registration mode enforcement
- Access denied page

### Phase 5: Cluster Registration Wizard
- Multi-step wizard UI
- Token generation
- Values.yaml generator
- Connection polling

### Phase 6: Token Management
- Token utilities
- Token list UI
- Revoke/delete operations

### Phase 7: Helm Chart
- Chart structure
- Operator/Collector templates
- RBAC templates
- Conditional features

---

## Estimated Scope

| Area | New Files | Modified Files |
|------|-----------|----------------|
| Database | 1 migration | `schema.prisma` |
| Lib | 4 | 2 |
| tRPC Routers | 3 | 4 |
| Pages/Components | ~15 | ~5 |
| Helm Chart | ~12 | - |
| **Total** | **~35** | **~11** |
