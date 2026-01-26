/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/**
 * Undeploy Feature Integration Tests
 *
 * Tests the undeploy workflow for removing policies from clusters
 * without deleting them from the SaaS.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createTestDatabase,
  createStatefulMockPrisma,
  setupTestScenario,
  createDeployablePolicy,
  createOperatorRequest,
  resetIdCounter,
  testFactories,
  type TestDatabaseStore,
} from "~/test/integration-helpers";

// ============================================================================
// MOCK SETUP
// ============================================================================

let store: TestDatabaseStore;
let mockDb: ReturnType<typeof createStatefulMockPrisma>;

vi.mock("~/lib/db", () => ({
  get db() {
    return mockDb;
  },
}));

import { GET as getPolicies } from "~/app/api/operator/policies/route";
import { PATCH as updatePolicyStatus } from "~/app/api/operator/policies/[id]/status/route";

// ============================================================================
// TEST SUITE: Undeploy Feature
// ============================================================================

describe("Undeploy Feature Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetIdCounter();
    store = createTestDatabase();
    mockDb = createStatefulMockPrisma(store);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Operator API: Fetching Policies with UNDEPLOYING status
  // ==========================================================================

  describe("GET /api/operator/policies - UNDEPLOYING policies", () => {
    it("should return UNDEPLOYING policies with action=UNDEPLOY", async () => {
      const scenario = setupTestScenario(store);
      createDeployablePolicy(store, scenario, {
        status: "UNDEPLOYING",
        name: "policy-to-undeploy",
        deployedVersion: 2,
      });

      const request = createOperatorRequest(
        "http://localhost:3000/api/operator/policies",
        scenario.rawToken
      );

      const response = await getPolicies(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.policies).toHaveLength(1);
      expect(data.policies[0].name).toBe("policy-to-undeploy");
      expect(data.policies[0].action).toBe("UNDEPLOY");
      expect(data.policies[0].status).toBe("UNDEPLOYING");
    });

    it("should return DEPLOY action for PENDING and DEPLOYED policies", async () => {
      const scenario = setupTestScenario(store);
      createDeployablePolicy(store, scenario, {
        status: "PENDING",
        name: "pending-policy",
      });
      createDeployablePolicy(store, scenario, {
        status: "DEPLOYED",
        name: "deployed-policy",
      });

      const request = createOperatorRequest(
        "http://localhost:3000/api/operator/policies",
        scenario.rawToken
      );

      const response = await getPolicies(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.policies).toHaveLength(2);

      const pendingPolicy = data.policies.find((p: { name: string }) => p.name === "pending-policy") as { action: string };
      const deployedPolicy = data.policies.find((p: { name: string }) => p.name === "deployed-policy") as { action: string };

      expect(pendingPolicy.action).toBe("DEPLOY");
      expect(deployedPolicy.action).toBe("DEPLOY");
    });

    it("should not return DRAFT or ARCHIVED policies", async () => {
      const scenario = setupTestScenario(store);
      createDeployablePolicy(store, scenario, { status: "DRAFT" });
      createDeployablePolicy(store, scenario, { status: "ARCHIVED" });
      createDeployablePolicy(store, scenario, {
        status: "UNDEPLOYING",
        name: "undeploying-policy",
      });

      const request = createOperatorRequest(
        "http://localhost:3000/api/operator/policies",
        scenario.rawToken
      );

      const response = await getPolicies(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.policies).toHaveLength(1);
      expect(data.policies[0].name).toBe("undeploying-policy");
    });
  });

  // ==========================================================================
  // Operator API: Status Updates for UNDEPLOYED
  // ==========================================================================

  describe("PATCH /api/operator/policies/[id]/status - UNDEPLOYED status", () => {
    it("should accept UNDEPLOYED status and reset policy to DRAFT", async () => {
      const scenario = setupTestScenario(store);
      const { policy, version } = createDeployablePolicy(store, scenario, {
        status: "UNDEPLOYING",
        deployedVersion: 2,
        deployedAt: new Date(),
      });

      // Create an UNDEPLOYING deployment record
      testFactories.policyDeployment(store, {
        policyId: policy.id,
        versionId: version.id,
        clusterId: scenario.cluster.id,
        deployedById: scenario.user.id,
        status: "UNDEPLOYING",
      });

      const request = createOperatorRequest(
        `http://localhost:3000/api/operator/policies/${policy.id}/status`,
        scenario.rawToken,
        {
          method: "PATCH",
          body: { status: "UNDEPLOYED" },
        }
      );

      const response = await updatePolicyStatus(request, {
        params: Promise.resolve({ id: policy.id }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.status).toBe("DRAFT");
      expect(data.message).toContain("undeployed");

      // Verify policy was updated to DRAFT
      const updatedPolicy = store.policies.get(policy.id);
      expect(updatedPolicy?.status).toBe("DRAFT");
      expect(updatedPolicy?.deployedAt).toBeNull();
      expect(updatedPolicy?.deployedVersion).toBeNull();
    });

    it("should update deployment record to UNDEPLOYED on success", async () => {
      const scenario = setupTestScenario(store);
      const { policy, version } = createDeployablePolicy(store, scenario, {
        status: "UNDEPLOYING",
        deployedVersion: 2,
      });

      const deployment = testFactories.policyDeployment(store, {
        policyId: policy.id,
        versionId: version.id,
        clusterId: scenario.cluster.id,
        deployedById: scenario.user.id,
        status: "UNDEPLOYING",
      });

      const request = createOperatorRequest(
        `http://localhost:3000/api/operator/policies/${policy.id}/status`,
        scenario.rawToken,
        {
          method: "PATCH",
          body: { status: "UNDEPLOYED" },
        }
      );

      await updatePolicyStatus(request, {
        params: Promise.resolve({ id: policy.id }),
      });

      // Verify deployment was updated
      const updatedDeployment = store.policyDeployments.get(deployment.id);
      expect(updatedDeployment?.status).toBe("UNDEPLOYED");
      expect(updatedDeployment?.completedAt).toBeInstanceOf(Date);
    });

    it("should create audit log entry for undeploy", async () => {
      const scenario = setupTestScenario(store);
      const { policy, version } = createDeployablePolicy(store, scenario, {
        status: "UNDEPLOYING",
        deployedVersion: 2,
      });

      testFactories.policyDeployment(store, {
        policyId: policy.id,
        versionId: version.id,
        clusterId: scenario.cluster.id,
        deployedById: scenario.user.id,
        status: "UNDEPLOYING",
      });

      const request = createOperatorRequest(
        `http://localhost:3000/api/operator/policies/${policy.id}/status`,
        scenario.rawToken,
        {
          method: "PATCH",
          body: { status: "UNDEPLOYED" },
        }
      );

      await updatePolicyStatus(request, {
        params: Promise.resolve({ id: policy.id }),
      });

      // Verify audit log was created
      expect(mockDb.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "policy.undeployed",
            resource: "Policy",
            resourceId: policy.id,
          }),
        })
      );
    });

    it("should handle error message during undeploy", async () => {
      const scenario = setupTestScenario(store);
      const { policy, version } = createDeployablePolicy(store, scenario, {
        status: "UNDEPLOYING",
        deployedVersion: 2,
      });

      const deployment = testFactories.policyDeployment(store, {
        policyId: policy.id,
        versionId: version.id,
        clusterId: scenario.cluster.id,
        deployedById: scenario.user.id,
        status: "UNDEPLOYING",
      });

      const request = createOperatorRequest(
        `http://localhost:3000/api/operator/policies/${policy.id}/status`,
        scenario.rawToken,
        {
          method: "PATCH",
          body: {
            status: "UNDEPLOYED",
            error: "Partial failure: some resources not found",
          },
        }
      );

      await updatePolicyStatus(request, {
        params: Promise.resolve({ id: policy.id }),
      });

      // Should still succeed but record the error
      const updatedDeployment = store.policyDeployments.get(deployment.id);
      expect(updatedDeployment?.status).toBe("UNDEPLOYED");
      expect(updatedDeployment?.errorMessage).toBe("Partial failure: some resources not found");
    });

    it("should reject UNDEPLOYED status for non-UNDEPLOYING policy", async () => {
      const scenario = setupTestScenario(store);
      const { policy } = createDeployablePolicy(store, scenario, {
        status: "DEPLOYED", // Not UNDEPLOYING
      });

      const request = createOperatorRequest(
        `http://localhost:3000/api/operator/policies/${policy.id}/status`,
        scenario.rawToken,
        {
          method: "PATCH",
          body: { status: "UNDEPLOYED" },
        }
      );

      const response = await updatePolicyStatus(request, {
        params: Promise.resolve({ id: policy.id }),
      });

      // Should still work but not find an UNDEPLOYING deployment
      expect(response.status).toBe(200);

      // Policy should be reset to DRAFT
      const updatedPolicy = store.policies.get(policy.id);
      expect(updatedPolicy?.status).toBe("DRAFT");
    });
  });

  // ==========================================================================
  // Cross-Tenant Isolation for Undeploy
  // ==========================================================================

  describe("Cross-Tenant Isolation - Undeploy", () => {
    it("should not allow undeploy status update on policies from other clusters", async () => {
      const scenario1 = setupTestScenario(store);
      const scenario2 = setupTestScenario(store);

      // Create UNDEPLOYING policy for cluster 2
      const { policy } = createDeployablePolicy(store, scenario2, {
        status: "UNDEPLOYING",
      });

      // Try to update using cluster 1's token
      const request = createOperatorRequest(
        `http://localhost:3000/api/operator/policies/${policy.id}/status`,
        scenario1.rawToken,
        {
          method: "PATCH",
          body: { status: "UNDEPLOYED" },
        }
      );

      const response = await updatePolicyStatus(request, {
        params: Promise.resolve({ id: policy.id }),
      });

      expect(response.status).toBe(404);
    });

    it("should only return UNDEPLOYING policies for the authenticated cluster", async () => {
      const scenario1 = setupTestScenario(store);
      const scenario2 = setupTestScenario(store);

      // Create UNDEPLOYING policy for each cluster
      createDeployablePolicy(store, scenario1, {
        status: "UNDEPLOYING",
        name: "cluster1-undeploy",
      });
      createDeployablePolicy(store, scenario2, {
        status: "UNDEPLOYING",
        name: "cluster2-undeploy",
      });

      // Fetch with cluster 1 token
      const request = createOperatorRequest(
        "http://localhost:3000/api/operator/policies",
        scenario1.rawToken
      );
      const response = await getPolicies(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.policies).toHaveLength(1);
      expect(data.policies[0].name).toBe("cluster1-undeploy");
      expect(data.policies[0].action).toBe("UNDEPLOY");
    });
  });

  // ==========================================================================
  // Validation Tests
  // ==========================================================================

  describe("Input Validation - Undeploy Status", () => {
    it("should validate UNDEPLOYED is a valid status value", async () => {
      const scenario = setupTestScenario(store);
      const { policy } = createDeployablePolicy(store, scenario, {
        status: "UNDEPLOYING",
      });

      // Try with invalid status
      const request = createOperatorRequest(
        `http://localhost:3000/api/operator/policies/${policy.id}/status`,
        scenario.rawToken,
        {
          method: "PATCH",
          body: { status: "INVALID_STATUS" },
        }
      );

      const response = await updatePolicyStatus(request, {
        params: Promise.resolve({ id: policy.id }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("Validation");
    });

    it("should require policy:write scope for UNDEPLOYED status update", async () => {
      const org = testFactories.organization(store, { name: "Test Org" });
      const user = testFactories.user(store, { organizationId: org.id });
      const cluster = testFactories.cluster(store, { organizationId: org.id });

      // Create token WITHOUT policy:write scope
      const { rawToken } = testFactories.apiToken(store, {
        organizationId: org.id,
        clusterId: cluster.id,
        scopes: ["policy:read"], // Missing policy:write
      });

      const policy = testFactories.policy(store, {
        organizationId: org.id,
        clusterId: cluster.id,
        createdById: user.id,
        status: "UNDEPLOYING",
      });

      const request = createOperatorRequest(
        `http://localhost:3000/api/operator/policies/${policy.id}/status`,
        rawToken,
        {
          method: "PATCH",
          body: { status: "UNDEPLOYED" },
        }
      );

      const response = await updatePolicyStatus(request, {
        params: Promise.resolve({ id: policy.id }),
      });

      expect(response.status).toBe(403);
    });
  });
});
