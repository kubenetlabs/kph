# Undeploy Policy Feature - Implementation Plan

## Overview

Add the ability to "undeploy" a policy from a Kubernetes cluster without deleting it from the SaaS platform. This resets the policy to DRAFT status while instructing the operator to remove the policy resources from the cluster.

## Current Architecture Summary

### Flow: Deploy Policy
1. User clicks "Deploy" in UI
2. `policy.deploy` tRPC mutation sets policy status to `PENDING`
3. `deployment.deploy` creates a `PolicyDeployment` record with status `PENDING`
4. Operator polls `/api/operator/policies` (fetches `PENDING` and `DEPLOYED` policies)
5. Operator applies policy to cluster via `policy.Deployer.Deploy()`
6. Operator reports success via `PATCH /api/operator/policies/{id}/status`
7. Policy status updated to `DEPLOYED`

### Key Files
- **SaaS Backend**:
  - `prisma/schema.prisma` - Database schema
  - `src/server/routers/policy.ts` - Policy CRUD + deploy
  - `src/server/routers/deployment.ts` - Deployment tracking
  - `src/app/api/operator/policies/route.ts` - Operator fetch endpoint
  - `src/app/api/operator/policies/[id]/status/route.ts` - Status update endpoint

- **Operator (Go)**:
  - `internal/sync/reconciler.go` - Main sync loop
  - `internal/saas/client.go` - SaaS API client
  - `internal/policy/deployer.go` - K8s resource deployment/deletion
  - `internal/controller/managedpolicy_controller.go` - ManagedPolicy CRD controller

---

## Implementation Plan

### Phase 1: Database Schema Changes

**File**: `prisma/schema.prisma`

1. Add `UNDEPLOYING` to `PolicyStatus` enum:
```prisma
enum PolicyStatus {
  DRAFT       // Not yet deployed
  SIMULATING  // Running in simulation
  PENDING     // Queued for deployment
  DEPLOYED    // Active in cluster
  UNDEPLOYING // Being removed from cluster (NEW)
  FAILED      // Deployment failed
  ARCHIVED    // No longer active
}
```

2. Add `UNDEPLOY` to `DeploymentStatus` enum (for tracking undeploy operations):
```prisma
enum DeploymentStatus {
  PENDING      // Queued for deployment
  IN_PROGRESS  // Being applied to cluster
  SUCCEEDED    // Successfully deployed
  FAILED       // Deployment failed
  ROLLED_BACK  // Was rolled back
  UNDEPLOYING  // Being removed (NEW)
  UNDEPLOYED   // Successfully removed (NEW)
}
```

3. Run migration:
```bash
npx prisma migrate dev --name add-undeploy-status
```

---

### Phase 2: Backend API Changes

#### 2.1 Policy Router (`src/server/routers/policy.ts`)

Add `undeploy` mutation:

```typescript
undeploy: protectedProcedure
  .input(z.object({ id: z.string() }))
  .mutation(async ({ ctx, input }) => {
    // 1. Verify policy exists and belongs to org
    const existing = await ctx.db.policy.findFirst({
      where: {
        id: input.id,
        organizationId: ctx.organizationId,
      },
      include: {
        versions: {
          orderBy: { version: "desc" },
          take: 1,
        },
      },
    });

    if (!existing) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Policy not found",
      });
    }

    // 2. Verify policy is currently deployed
    if (existing.status !== "DEPLOYED") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Policy is not deployed",
      });
    }

    // 3. Create undeploy deployment record
    const latestVersion = existing.versions[0];
    if (!latestVersion) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "No policy version found",
      });
    }

    // 4. Update policy status to UNDEPLOYING
    const [policy, deployment] = await ctx.db.$transaction([
      ctx.db.policy.update({
        where: { id: input.id },
        data: {
          status: "UNDEPLOYING",
        },
      }),
      ctx.db.policyDeployment.create({
        data: {
          policyId: input.id,
          versionId: latestVersion.id,
          clusterId: existing.clusterId,
          status: "UNDEPLOYING",
          deployedById: ctx.userId,
        },
      }),
    ]);

    return { policy, deploymentId: deployment.id };
  }),
```

#### 2.2 Operator Policies Endpoint (`src/app/api/operator/policies/route.ts`)

Modify to include `UNDEPLOYING` policies with an action field:

```typescript
// Fetch policies that are PENDING, DEPLOYED, or UNDEPLOYING for this cluster
const policies = await db.policy.findMany({
  where: {
    clusterId: auth.clusterId,
    status: { in: ["PENDING", "DEPLOYED", "UNDEPLOYING"] },
  },
  // ... existing select
});

// Transform to operator-friendly format with action
const operatorPolicies = policies.map((p) => ({
  id: p.id,
  name: p.name,
  description: p.description,
  type: p.type,
  status: p.status,
  content: p.content,
  targetNamespaces: p.targetNamespaces,
  version: p.deployedVersion ?? 1,
  lastUpdated: p.updatedAt.toISOString(),
  // NEW: action field tells operator what to do
  action: p.status === "UNDEPLOYING" ? "UNDEPLOY" : "DEPLOY",
}));
```

#### 2.3 Status Update Endpoint (`src/app/api/operator/policies/[id]/status/route.ts`)

Handle `UNDEPLOYED` status:

```typescript
// In the PATCH handler, add handling for UNDEPLOYED status
if (status === "UNDEPLOYED") {
  // Reset policy to DRAFT
  await db.policy.update({
    where: { id: policyId },
    data: {
      status: "DRAFT",
      deployedAt: null,
      deployedVersion: null,
    },
  });

  // Update deployment record
  await db.policyDeployment.updateMany({
    where: {
      policyId,
      status: "UNDEPLOYING",
    },
    data: {
      status: "UNDEPLOYED",
      completedAt: new Date(),
    },
  });
}
```

---

### Phase 3: Operator Changes (Go)

#### 3.1 SaaS Client (`internal/saas/client.go`)

Update `Policy` struct to include action:

```go
type Policy struct {
    ID               string   `json:"id"`
    Name             string   `json:"name"`
    Description      string   `json:"description,omitempty"`
    Type             string   `json:"type"`
    Status           string   `json:"status"`
    Content          string   `json:"content"`
    TargetNamespaces []string `json:"targetNamespaces,omitempty"`
    Version          int      `json:"version"`
    LastUpdated      string   `json:"lastUpdated"`
    Action           string   `json:"action"` // NEW: "DEPLOY" or "UNDEPLOY"
}
```

Add `ReportUndeployStatus` method:

```go
// ReportUndeployStatus reports the result of an undeploy operation
func (c *Client) ReportUndeployStatus(ctx context.Context, policyID string, success bool, errorMsg string) error {
    status := "UNDEPLOYED"
    if !success {
        status = "FAILED"
    }

    req := UpdatePolicyStatusRequest{
        Status: status,
        Error:  errorMsg,
    }

    _, err := c.UpdatePolicyStatus(ctx, policyID, req)
    return err
}
```

#### 3.2 Sync Reconciler (`internal/sync/reconciler.go`)

Update `SyncPolicies` to handle undeploy action:

```go
func (r *Reconciler) SyncPolicies(ctx context.Context) error {
    r.log.V(1).Info("Starting policy sync")

    // Fetch policies from SaaS
    resp, err := r.saasClient.FetchPolicies(ctx)
    if err != nil {
        return fmt.Errorf("failed to fetch policies: %w", err)
    }

    r.log.Info("Fetched policies from SaaS", "count", resp.Count)

    // Get existing ManagedPolicies
    existingPolicies := &policyv1alpha1.ManagedPolicyList{}
    if err := r.client.List(ctx, existingPolicies, client.InNamespace(r.config.Namespace)); err != nil {
        return fmt.Errorf("failed to list existing policies: %w", err)
    }

    // Build map of existing policies by policy ID
    existingByID := make(map[string]*policyv1alpha1.ManagedPolicy)
    for i := range existingPolicies.Items {
        p := &existingPolicies.Items[i]
        existingByID[p.Spec.PolicyID] = p
    }

    // Process each policy from SaaS
    saasIDs := make(map[string]bool)
    for _, saasPolicy := range resp.Policies {
        saasIDs[saasPolicy.ID] = true

        // Handle UNDEPLOY action
        if saasPolicy.Action == "UNDEPLOY" {
            r.handleUndeploy(ctx, saasPolicy, existingByID[saasPolicy.ID])
            continue
        }

        // ... existing deploy logic ...
    }

    // ... rest of function
}

// handleUndeploy removes policy from cluster and reports status
func (r *Reconciler) handleUndeploy(ctx context.Context, saasPolicy saas.Policy, existing *policyv1alpha1.ManagedPolicy) {
    log := r.log.WithValues("policy", saasPolicy.Name, "policyId", saasPolicy.ID)
    log.Info("Processing undeploy request")

    if existing == nil {
        // Policy doesn't exist locally, report success
        log.Info("Policy not found locally, reporting as undeployed")
        if err := r.saasClient.ReportUndeployStatus(ctx, saasPolicy.ID, true, ""); err != nil {
            log.Error(err, "Failed to report undeploy status")
        }
        return
    }

    // Delete deployed resources
    if err := r.deployer.Delete(ctx, existing); err != nil {
        log.Error(err, "Failed to delete policy resources")
        if reportErr := r.saasClient.ReportUndeployStatus(ctx, saasPolicy.ID, false, err.Error()); reportErr != nil {
            log.Error(reportErr, "Failed to report undeploy failure")
        }
        return
    }

    // Delete the ManagedPolicy CRD
    if err := r.client.Delete(ctx, existing); err != nil && !errors.IsNotFound(err) {
        log.Error(err, "Failed to delete ManagedPolicy")
        if reportErr := r.saasClient.ReportUndeployStatus(ctx, saasPolicy.ID, false, err.Error()); reportErr != nil {
            log.Error(reportErr, "Failed to report undeploy failure")
        }
        return
    }

    // Report success
    log.Info("Successfully undeployed policy")
    if err := r.saasClient.ReportUndeployStatus(ctx, saasPolicy.ID, true, ""); err != nil {
        log.Error(err, "Failed to report undeploy success")
    }
}
```

#### 3.3 Policy Deployer (`internal/policy/deployer.go`)

The existing `Delete` method already handles resource deletion. No changes needed.

---

### Phase 4: UI Changes

#### 4.1 Policies List Page (`src/app/policies/page.tsx`)

Add "Undeploy" button for deployed policies:

```tsx
// In the policy row actions
{policy.status === "DEPLOYED" && (
  <Button
    variant="ghost"
    size="sm"
    onClick={() => handleUndeploy(policy.id)}
    className="text-warning hover:text-warning/80"
  >
    <ArrowDownTrayIcon className="h-4 w-4 mr-1" />
    Undeploy
  </Button>
)}

{policy.status === "UNDEPLOYING" && (
  <Badge variant="warning">
    <Spinner size="sm" className="mr-1" />
    Undeploying...
  </Badge>
)}
```

Add undeploy handler:

```tsx
const undeployMutation = trpc.policy.undeploy.useMutation({
  onSuccess: () => {
    utils.policy.list.invalidate();
    toast.success("Policy undeploy initiated");
  },
  onError: (error) => {
    toast.error(error.message);
  },
});

const handleUndeploy = (policyId: string) => {
  if (confirm("Are you sure you want to undeploy this policy? It will be removed from the cluster but kept in the SaaS.")) {
    undeployMutation.mutate({ id: policyId });
  }
};
```

#### 4.2 Policy Detail Page (`src/app/policies/[id]/page.tsx`)

Add undeploy button in the actions section:

```tsx
{policy.status === "DEPLOYED" && (
  <Button
    variant="secondary"
    onClick={() => handleUndeploy()}
    disabled={undeployMutation.isPending}
  >
    {undeployMutation.isPending ? (
      <Spinner size="sm" className="mr-2" />
    ) : (
      <ArrowDownTrayIcon className="h-4 w-4 mr-2" />
    )}
    Undeploy from Cluster
  </Button>
)}
```

---

### Phase 5: Operator Build & Release

#### 5.1 Update Operator Version

In `internal/sync/reconciler.go`:
```go
const OperatorVersion = "1.1.0" // Bump version
```

#### 5.2 Build for All Architectures

```bash
cd operator

# Build and push multi-arch images (amd64 + arm64)
make docker-buildx-all
```

This uses the existing `docker-buildx` target which builds for `linux/amd64,linux/arm64`.

#### 5.3 Update Helm Chart

In `operator/charts/kph-agent/Chart.yaml`:
```yaml
version: 0.1.4  # Bump chart version
appVersion: "1.1.0"
```

Package new chart:
```bash
cd operator/charts
helm package kph-agent
```

---

## Test Cases

### Unit Tests

#### Backend Tests (`src/server/routers/__tests__/policy.test.ts`)

```typescript
describe("policy.undeploy", () => {
  it("should undeploy a deployed policy", async () => {
    // Setup: Create deployed policy
    const policy = await createDeployedPolicy();

    // Execute
    const result = await caller.policy.undeploy({ id: policy.id });

    // Assert
    expect(result.policy.status).toBe("UNDEPLOYING");
    expect(result.deploymentId).toBeDefined();
  });

  it("should reject undeploy for non-deployed policy", async () => {
    // Setup: Create draft policy
    const policy = await createDraftPolicy();

    // Execute & Assert
    await expect(caller.policy.undeploy({ id: policy.id }))
      .rejects.toThrow("Policy is not deployed");
  });

  it("should reject undeploy for non-existent policy", async () => {
    await expect(caller.policy.undeploy({ id: "non-existent" }))
      .rejects.toThrow("Policy not found");
  });

  it("should reject undeploy for policy in different org", async () => {
    const policy = await createDeployedPolicyInDifferentOrg();

    await expect(caller.policy.undeploy({ id: policy.id }))
      .rejects.toThrow("Policy not found");
  });
});
```

#### Operator API Tests (`src/app/api/operator/__tests__/policies.test.ts`)

```typescript
describe("GET /api/operator/policies", () => {
  it("should include UNDEPLOYING policies with UNDEPLOY action", async () => {
    // Setup
    await createPolicy({ status: "DEPLOYED" });
    await createPolicy({ status: "UNDEPLOYING" });

    // Execute
    const response = await fetch("/api/operator/policies", {
      headers: { Authorization: `Bearer ${operatorToken}` },
    });
    const data = await response.json();

    // Assert
    expect(data.policies).toHaveLength(2);
    const undeploying = data.policies.find(p => p.status === "UNDEPLOYING");
    expect(undeploying.action).toBe("UNDEPLOY");
  });
});

describe("PATCH /api/operator/policies/{id}/status", () => {
  it("should handle UNDEPLOYED status", async () => {
    // Setup
    const policy = await createUndeployingPolicy();

    // Execute
    const response = await fetch(`/api/operator/policies/${policy.id}/status`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${operatorToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "UNDEPLOYED" }),
    });

    // Assert
    expect(response.ok).toBe(true);

    const updated = await db.policy.findUnique({ where: { id: policy.id } });
    expect(updated.status).toBe("DRAFT");
    expect(updated.deployedAt).toBeNull();
  });
});
```

### Operator Tests (Go)

#### Reconciler Tests (`internal/sync/reconciler_test.go`)

```go
func TestSyncPolicies_HandleUndeploy(t *testing.T) {
    // Setup mock SaaS client returning policy with UNDEPLOY action
    mockClient := &MockSaaSClient{
        FetchPoliciesResponse: &saas.FetchPoliciesResponse{
            Success: true,
            Policies: []saas.Policy{
                {
                    ID:     "policy-1",
                    Name:   "test-policy",
                    Action: "UNDEPLOY",
                },
            },
            Count: 1,
        },
    }

    // Setup mock k8s client with existing ManagedPolicy
    fakeClient := fake.NewClientBuilder().
        WithObjects(&policyv1alpha1.ManagedPolicy{
            ObjectMeta: metav1.ObjectMeta{
                Name:      "test-policy",
                Namespace: "policy-hub-system",
            },
            Spec: policyv1alpha1.ManagedPolicySpec{
                PolicyID: "policy-1",
            },
        }).
        Build()

    reconciler := NewReconciler(fakeClient, logr.Discard())
    reconciler.saasClient = mockClient
    reconciler.deployer = policy.NewDeployer(fakeClient, logr.Discard())

    // Execute
    err := reconciler.SyncPolicies(context.Background())

    // Assert
    require.NoError(t, err)

    // Verify ManagedPolicy was deleted
    mp := &policyv1alpha1.ManagedPolicy{}
    err = fakeClient.Get(context.Background(), types.NamespacedName{
        Name:      "test-policy",
        Namespace: "policy-hub-system",
    }, mp)
    require.True(t, errors.IsNotFound(err))

    // Verify status was reported
    require.True(t, mockClient.UndeployStatusReported)
    require.True(t, mockClient.UndeploySuccess)
}

func TestSyncPolicies_UndeployNonExistentPolicy(t *testing.T) {
    // Setup: Policy in SaaS but not in cluster
    mockClient := &MockSaaSClient{
        FetchPoliciesResponse: &saas.FetchPoliciesResponse{
            Success: true,
            Policies: []saas.Policy{
                {
                    ID:     "policy-1",
                    Name:   "test-policy",
                    Action: "UNDEPLOY",
                },
            },
            Count: 1,
        },
    }

    fakeClient := fake.NewClientBuilder().Build() // No existing policies

    reconciler := NewReconciler(fakeClient, logr.Discard())
    reconciler.saasClient = mockClient

    // Execute
    err := reconciler.SyncPolicies(context.Background())

    // Assert - should still succeed and report as undeployed
    require.NoError(t, err)
    require.True(t, mockClient.UndeployStatusReported)
    require.True(t, mockClient.UndeploySuccess)
}

func TestSyncPolicies_UndeployFailure(t *testing.T) {
    // Setup: Deployer returns error
    mockClient := &MockSaaSClient{
        FetchPoliciesResponse: &saas.FetchPoliciesResponse{
            Success: true,
            Policies: []saas.Policy{
                {
                    ID:     "policy-1",
                    Name:   "test-policy",
                    Action: "UNDEPLOY",
                },
            },
            Count: 1,
        },
    }

    // Use a client that will fail on delete
    fakeClient := &FailingDeleteClient{}

    reconciler := NewReconciler(fakeClient, logr.Discard())
    reconciler.saasClient = mockClient

    // Execute
    err := reconciler.SyncPolicies(context.Background())

    // Assert - error should be reported to SaaS
    require.NoError(t, err) // Sync doesn't fail, just reports error
    require.True(t, mockClient.UndeployStatusReported)
    require.False(t, mockClient.UndeploySuccess)
    require.NotEmpty(t, mockClient.UndeployError)
}
```

### Integration Tests

#### End-to-End Test (`src/server/routers/__tests__/undeploy.integration.test.ts`)

```typescript
describe("Undeploy Flow Integration", () => {
  it("should complete full undeploy lifecycle", async () => {
    // 1. Create and deploy a policy
    const policy = await createPolicy({ status: "DRAFT" });
    await caller.deployment.deploy({ policyId: policy.id });

    // Simulate operator confirming deployment
    await simulateOperatorDeploySuccess(policy.id);

    let updated = await db.policy.findUnique({ where: { id: policy.id } });
    expect(updated.status).toBe("DEPLOYED");

    // 2. Initiate undeploy
    await caller.policy.undeploy({ id: policy.id });

    updated = await db.policy.findUnique({ where: { id: policy.id } });
    expect(updated.status).toBe("UNDEPLOYING");

    // 3. Verify operator endpoint returns policy with UNDEPLOY action
    const operatorResponse = await fetchOperatorPolicies();
    const undeploying = operatorResponse.policies.find(p => p.id === policy.id);
    expect(undeploying.action).toBe("UNDEPLOY");

    // 4. Simulate operator confirming undeploy
    await simulateOperatorUndeploySuccess(policy.id);

    // 5. Verify policy is back to DRAFT
    updated = await db.policy.findUnique({ where: { id: policy.id } });
    expect(updated.status).toBe("DRAFT");
    expect(updated.deployedAt).toBeNull();
    expect(updated.deployedVersion).toBeNull();
  });
});
```

---

## Rollout Plan

### Step 1: Database Migration
```bash
npx prisma migrate dev --name add-undeploy-status
npx prisma generate
```

### Step 2: Deploy Backend Changes
1. Commit and push SaaS changes
2. Deploy to Vercel

### Step 3: Build & Push Operator
```bash
cd operator
make docker-buildx-all
```

### Step 4: Update Helm Chart
```bash
cd operator/charts
helm package kph-agent
# Upload to chart repository or commit
```

### Step 5: User Communication
- Document new feature in changelog
- Update user documentation

---

## Backwards Compatibility

- Operators running older versions will ignore the `action` field (treats all policies as deploy)
- SaaS will continue to work with older operators (they just won't process undeploy requests)
- Recommend users upgrade operators after SaaS update

---

## Security Considerations

1. **Authorization**: Only users with policy edit permissions can undeploy
2. **Audit Trail**: All undeploy actions logged in AuditLog
3. **Operator Token Scope**: Uses existing `policy:read` and `policy:write` scopes

---

## Monitoring

Add metrics for:
- `policy_undeploy_initiated_total` - Counter of undeploy requests
- `policy_undeploy_completed_total` - Counter of successful undeploys
- `policy_undeploy_failed_total` - Counter of failed undeploys
- `policy_undeploy_duration_seconds` - Histogram of undeploy duration

---

## Estimated Implementation Order

1. Database schema changes (Phase 1)
2. Backend API changes (Phase 2)
3. Operator Go changes (Phase 3)
4. Backend tests
5. Operator tests
6. UI changes (Phase 4)
7. Build multi-arch operators (Phase 5)
8. Integration testing
9. Documentation
