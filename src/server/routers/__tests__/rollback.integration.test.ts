/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/**
 * Rollback Integration Tests
 *
 * Tests the rollback workflow from the operator's perspective:
 * - Detecting rollback deployments
 * - Applying rollback versions
 * - Handling rollback failures
 * - Multiple rollbacks
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
// HELPER: Create successful deployment history
// ============================================================================

function createDeploymentHistory(
  store: TestDatabaseStore,
  scenario: ReturnType<typeof setupTestScenario>,
  policy: ReturnType<typeof createDeployablePolicy>["policy"],
  versions: number[]
) {
  const deployments = [];

  for (let i = 0; i < versions.length; i++) {
    const version = testFactories.policyVersion(store, {
      policyId: policy.id,
      version: versions[i],
      content: `# Version ${versions[i]} content`,
    });

    const deployment = testFactories.policyDeployment(store, {
      policyId: policy.id,
      versionId: version.id,
      clusterId: scenario.cluster.id,
      deployedById: scenario.user.id,
      status: "SUCCEEDED",
      completedAt: new Date(Date.now() - (versions.length - i) * 3600000), // Older versions deployed earlier
      resourceName: `${policy.name}-v${versions[i]}`,
    });

    deployments.push({ version, deployment });
  }

  // Update policy to reflect latest deployed version
  policy.status = "DEPLOYED";
  policy.deployedVersion = versions[versions.length - 1];
  policy.deployedAt = new Date();
  store.policies.set(policy.id, policy);

  return deployments;
}

// ============================================================================
// TEST SUITE: Rollback
// ============================================================================

describe("Rollback Integration Tests", () => {
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
  // Rollback Detection Tests
  // ==========================================================================

  describe("Rollback Detection", () => {
    it("should detect rollback deployment via isRollback flag", async () => {
      const scenario = setupTestScenario(store);
      const { policy } = createDeployablePolicy(store, scenario, {
        status: "DEPLOYED",
      });

      // Create deployment history
      createDeploymentHistory(store, scenario, policy, [1, 2, 3]);

      // Create rollback deployment to version 2
      const version2 = Array.from(store.policyVersions.values()).find(
        v => v.policyId === policy.id && v.version === 2
      );

      const rollbackDeployment = testFactories.policyDeployment(store, {
        policyId: policy.id,
        versionId: version2!.id,
        clusterId: scenario.cluster.id,
        deployedById: scenario.user.id,
        status: "PENDING",
        isRollback: true,
        rollbackNote: "Rolling back to stable version 2",
      });

      // Update policy status for rollback
      policy.status = "PENDING";
      store.policies.set(policy.id, policy);

      // Operator fetches policies
      const fetchResponse = await getPolicies(
        createOperatorRequest(
          "http://localhost:3000/api/operator/policies",
          scenario.rawToken
        )
      );
      const fetchData = await fetchResponse.json();

      expect(fetchData.policies).toHaveLength(1);
      expect(fetchData.policies[0].status).toBe("PENDING");

      // The deployment should be marked as rollback
      const deployment = store.policyDeployments.get(rollbackDeployment.id);
      expect(deployment?.isRollback).toBe(true);
      expect(deployment?.rollbackNote).toBe("Rolling back to stable version 2");
    });

    it("should include rollback note in deployment", async () => {
      const scenario = setupTestScenario(store);
      const { policy } = createDeployablePolicy(store, scenario);
      createDeploymentHistory(store, scenario, policy, [1, 2]);

      const version1 = Array.from(store.policyVersions.values()).find(
        v => v.policyId === policy.id && v.version === 1
      );

      const customNote = "Emergency rollback: v2 causing production issues";
      testFactories.policyDeployment(store, {
        policyId: policy.id,
        versionId: version1!.id,
        clusterId: scenario.cluster.id,
        deployedById: scenario.user.id,
        status: "PENDING",
        isRollback: true,
        rollbackNote: customNote,
      });

      policy.status = "PENDING";
      store.policies.set(policy.id, policy);

      // Verify rollback note is stored
      const deployments = Array.from(store.policyDeployments.values())
        .filter(d => d.policyId === policy.id && d.isRollback);

      expect(deployments).toHaveLength(1);
      expect(deployments[0].rollbackNote).toBe(customNote);
    });
  });

  // ==========================================================================
  // Rollback Execution Tests
  // ==========================================================================

  describe("Rollback Execution", () => {
    it("should complete rollback deployment successfully", async () => {
      const scenario = setupTestScenario(store);
      const { policy } = createDeployablePolicy(store, scenario, {
        status: "DEPLOYED",
      });

      // Create deployment history (v1, v2, v3 all deployed)
      createDeploymentHistory(store, scenario, policy, [1, 2, 3]);

      // Create rollback to version 1
      const version1 = Array.from(store.policyVersions.values()).find(
        v => v.policyId === policy.id && v.version === 1
      );

      const rollbackDeployment = testFactories.policyDeployment(store, {
        policyId: policy.id,
        versionId: version1!.id,
        clusterId: scenario.cluster.id,
        deployedById: scenario.user.id,
        status: "PENDING",
        isRollback: true,
        rollbackNote: "Rollback to version 1",
      });

      policy.status = "PENDING";
      store.policies.set(policy.id, policy);

      // Operator executes rollback: IN_PROGRESS
      await updatePolicyStatus(
        createOperatorRequest(
          `http://localhost:3000/api/operator/policies/${policy.id}/status`,
          scenario.rawToken,
          { method: "PATCH", body: { status: "IN_PROGRESS" } }
        ),
        { params: Promise.resolve({ id: policy.id }) }
      );

      // Verify IN_PROGRESS state
      let currentDeployment = store.policyDeployments.get(rollbackDeployment.id);
      expect(currentDeployment?.status).toBe("IN_PROGRESS");

      // Complete rollback
      await updatePolicyStatus(
        createOperatorRequest(
          `http://localhost:3000/api/operator/policies/${policy.id}/status`,
          scenario.rawToken,
          {
            method: "PATCH",
            body: {
              status: "DEPLOYED",
              version: 1, // Rolling back to version 1
              deployedResources: [
                {
                  apiVersion: "cilium.io/v2",
                  kind: "CiliumNetworkPolicy",
                  name: policy.name,
                  namespace: "default",
                },
              ],
            },
          }
        ),
        { params: Promise.resolve({ id: policy.id }) }
      );

      // Verify final state
      const finalPolicy = store.policies.get(policy.id);
      expect(finalPolicy?.status).toBe("DEPLOYED");
      expect(finalPolicy?.deployedVersion).toBe(1);

      currentDeployment = store.policyDeployments.get(rollbackDeployment.id);
      expect(currentDeployment?.status).toBe("SUCCEEDED");
      expect(currentDeployment?.isRollback).toBe(true);
    });

    it("should handle rollback failure gracefully", async () => {
      const scenario = setupTestScenario(store);
      const { policy } = createDeployablePolicy(store, scenario, {
        status: "DEPLOYED",
      });

      createDeploymentHistory(store, scenario, policy, [1, 2]);

      const version1 = Array.from(store.policyVersions.values()).find(
        v => v.policyId === policy.id && v.version === 1
      );

      const rollbackDeployment = testFactories.policyDeployment(store, {
        policyId: policy.id,
        versionId: version1!.id,
        clusterId: scenario.cluster.id,
        deployedById: scenario.user.id,
        status: "PENDING",
        isRollback: true,
        rollbackNote: "Attempting rollback",
      });

      policy.status = "PENDING";
      store.policies.set(policy.id, policy);

      // Rollback fails
      await updatePolicyStatus(
        createOperatorRequest(
          `http://localhost:3000/api/operator/policies/${policy.id}/status`,
          scenario.rawToken,
          { method: "PATCH", body: { status: "IN_PROGRESS" } }
        ),
        { params: Promise.resolve({ id: policy.id }) }
      );

      await updatePolicyStatus(
        createOperatorRequest(
          `http://localhost:3000/api/operator/policies/${policy.id}/status`,
          scenario.rawToken,
          {
            method: "PATCH",
            body: {
              status: "FAILED",
              error: "Rollback failed: resource conflict",
              errorDetails: {
                type: "K8sAPIError",
                reason: "Conflict",
                retryable: true,
              },
            },
          }
        ),
        { params: Promise.resolve({ id: policy.id }) }
      );

      // Verify failure state
      const finalPolicy = store.policies.get(policy.id);
      expect(finalPolicy?.status).toBe("FAILED");

      const failedRollback = store.policyDeployments.get(rollbackDeployment.id);
      expect(failedRollback?.status).toBe("FAILED");
      expect(failedRollback?.isRollback).toBe(true);
      expect(failedRollback?.errorMessage).toBe("Rollback failed: resource conflict");
    });
  });

  // ==========================================================================
  // Multiple Rollback Tests
  // ==========================================================================

  describe("Multiple Rollbacks", () => {
    it("should support rolling back multiple versions", async () => {
      const scenario = setupTestScenario(store);
      const { policy } = createDeployablePolicy(store, scenario, {
        status: "DEPLOYED",
      });

      // Create history: v1 -> v2 -> v3 -> v4
      createDeploymentHistory(store, scenario, policy, [1, 2, 3, 4]);

      // Rollback from v4 to v2
      const version2 = Array.from(store.policyVersions.values()).find(
        v => v.policyId === policy.id && v.version === 2
      );

      const rollbackDeployment = testFactories.policyDeployment(store, {
        policyId: policy.id,
        versionId: version2!.id,
        clusterId: scenario.cluster.id,
        deployedById: scenario.user.id,
        status: "PENDING",
        isRollback: true,
        rollbackNote: "Skipping v3, going back to v2",
      });

      policy.status = "PENDING";
      store.policies.set(policy.id, policy);

      // Execute rollback
      await updatePolicyStatus(
        createOperatorRequest(
          `http://localhost:3000/api/operator/policies/${policy.id}/status`,
          scenario.rawToken,
          { method: "PATCH", body: { status: "IN_PROGRESS" } }
        ),
        { params: Promise.resolve({ id: policy.id }) }
      );

      await updatePolicyStatus(
        createOperatorRequest(
          `http://localhost:3000/api/operator/policies/${policy.id}/status`,
          scenario.rawToken,
          {
            method: "PATCH",
            body: { status: "DEPLOYED", version: 2 },
          }
        ),
        { params: Promise.resolve({ id: policy.id }) }
      );

      expect(store.policies.get(policy.id)?.deployedVersion).toBe(2);
      expect(store.policyDeployments.get(rollbackDeployment.id)?.status).toBe("SUCCEEDED");
    });

    it("should support consecutive rollbacks", async () => {
      const scenario = setupTestScenario(store);
      const { policy } = createDeployablePolicy(store, scenario, {
        status: "DEPLOYED",
      });

      createDeploymentHistory(store, scenario, policy, [1, 2, 3]);

      // First rollback: v3 -> v2
      const version2 = Array.from(store.policyVersions.values()).find(
        v => v.policyId === policy.id && v.version === 2
      );

      const rollback1 = testFactories.policyDeployment(store, {
        policyId: policy.id,
        versionId: version2!.id,
        clusterId: scenario.cluster.id,
        deployedById: scenario.user.id,
        status: "PENDING",
        isRollback: true,
        rollbackNote: "First rollback to v2",
      });

      policy.status = "PENDING";
      store.policies.set(policy.id, policy);

      // Complete first rollback
      await updatePolicyStatus(
        createOperatorRequest(
          `http://localhost:3000/api/operator/policies/${policy.id}/status`,
          scenario.rawToken,
          { method: "PATCH", body: { status: "IN_PROGRESS" } }
        ),
        { params: Promise.resolve({ id: policy.id }) }
      );

      await updatePolicyStatus(
        createOperatorRequest(
          `http://localhost:3000/api/operator/policies/${policy.id}/status`,
          scenario.rawToken,
          { method: "PATCH", body: { status: "DEPLOYED", version: 2 } }
        ),
        { params: Promise.resolve({ id: policy.id }) }
      );

      expect(store.policies.get(policy.id)?.deployedVersion).toBe(2);
      expect(store.policyDeployments.get(rollback1.id)?.status).toBe("SUCCEEDED");

      // Second rollback: v2 -> v1
      const version1 = Array.from(store.policyVersions.values()).find(
        v => v.policyId === policy.id && v.version === 1
      );

      const rollback2 = testFactories.policyDeployment(store, {
        policyId: policy.id,
        versionId: version1!.id,
        clusterId: scenario.cluster.id,
        deployedById: scenario.user.id,
        status: "PENDING",
        isRollback: true,
        rollbackNote: "Second rollback to v1",
      });

      policy.status = "PENDING";
      store.policies.set(policy.id, policy);

      // Complete second rollback
      await updatePolicyStatus(
        createOperatorRequest(
          `http://localhost:3000/api/operator/policies/${policy.id}/status`,
          scenario.rawToken,
          { method: "PATCH", body: { status: "IN_PROGRESS" } }
        ),
        { params: Promise.resolve({ id: policy.id }) }
      );

      await updatePolicyStatus(
        createOperatorRequest(
          `http://localhost:3000/api/operator/policies/${policy.id}/status`,
          scenario.rawToken,
          { method: "PATCH", body: { status: "DEPLOYED", version: 1 } }
        ),
        { params: Promise.resolve({ id: policy.id }) }
      );

      expect(store.policies.get(policy.id)?.deployedVersion).toBe(1);
      expect(store.policyDeployments.get(rollback2.id)?.status).toBe("SUCCEEDED");

      // Verify both rollbacks are tracked
      const rollbackDeployments = Array.from(store.policyDeployments.values())
        .filter(d => d.policyId === policy.id && d.isRollback && d.status === "SUCCEEDED");
      expect(rollbackDeployments).toHaveLength(2);
    });

    it("should handle rollback followed by new deployment", async () => {
      const scenario = setupTestScenario(store);
      const { policy } = createDeployablePolicy(store, scenario, {
        status: "DEPLOYED",
      });

      createDeploymentHistory(store, scenario, policy, [1, 2]);

      // Rollback to v1
      const version1 = Array.from(store.policyVersions.values()).find(
        v => v.policyId === policy.id && v.version === 1
      );

      testFactories.policyDeployment(store, {
        policyId: policy.id,
        versionId: version1!.id,
        clusterId: scenario.cluster.id,
        deployedById: scenario.user.id,
        status: "PENDING",
        isRollback: true,
      });

      policy.status = "PENDING";
      store.policies.set(policy.id, policy);

      // Complete rollback
      await updatePolicyStatus(
        createOperatorRequest(
          `http://localhost:3000/api/operator/policies/${policy.id}/status`,
          scenario.rawToken,
          { method: "PATCH", body: { status: "IN_PROGRESS" } }
        ),
        { params: Promise.resolve({ id: policy.id }) }
      );

      await updatePolicyStatus(
        createOperatorRequest(
          `http://localhost:3000/api/operator/policies/${policy.id}/status`,
          scenario.rawToken,
          { method: "PATCH", body: { status: "DEPLOYED", version: 1 } }
        ),
        { params: Promise.resolve({ id: policy.id }) }
      );

      expect(store.policies.get(policy.id)?.deployedVersion).toBe(1);

      // Now deploy new version v3
      const version3 = testFactories.policyVersion(store, {
        policyId: policy.id,
        version: 3,
        content: "# New version 3",
      });

      const newDeployment = testFactories.policyDeployment(store, {
        policyId: policy.id,
        versionId: version3.id,
        clusterId: scenario.cluster.id,
        deployedById: scenario.user.id,
        status: "PENDING",
        isRollback: false, // Not a rollback
      });

      policy.status = "PENDING";
      store.policies.set(policy.id, policy);

      // Complete new deployment
      await updatePolicyStatus(
        createOperatorRequest(
          `http://localhost:3000/api/operator/policies/${policy.id}/status`,
          scenario.rawToken,
          { method: "PATCH", body: { status: "IN_PROGRESS" } }
        ),
        { params: Promise.resolve({ id: policy.id }) }
      );

      await updatePolicyStatus(
        createOperatorRequest(
          `http://localhost:3000/api/operator/policies/${policy.id}/status`,
          scenario.rawToken,
          { method: "PATCH", body: { status: "DEPLOYED", version: 3 } }
        ),
        { params: Promise.resolve({ id: policy.id }) }
      );

      // Verify final state
      expect(store.policies.get(policy.id)?.deployedVersion).toBe(3);
      expect(store.policyDeployments.get(newDeployment.id)?.status).toBe("SUCCEEDED");
      expect(store.policyDeployments.get(newDeployment.id)?.isRollback).toBe(false);
    });
  });

  // ==========================================================================
  // Rollback with Previous Deployment Link Tests
  // ==========================================================================

  describe("Rollback Chain Tracking", () => {
    it("should track previousDeploymentId for rollbacks", async () => {
      const scenario = setupTestScenario(store);
      const { policy } = createDeployablePolicy(store, scenario, {
        status: "DEPLOYED",
      });

      const history = createDeploymentHistory(store, scenario, policy, [1, 2]);
      const currentDeployment = history[1].deployment; // v2 is current

      // Create rollback with reference to current deployment
      const version1 = history[0].version;

      const rollbackDeployment = testFactories.policyDeployment(store, {
        policyId: policy.id,
        versionId: version1.id,
        clusterId: scenario.cluster.id,
        deployedById: scenario.user.id,
        status: "PENDING",
        isRollback: true,
        previousDeploymentId: currentDeployment.id,
        rollbackNote: "Rollback from v2 to v1",
      });

      // Verify chain is tracked
      expect(rollbackDeployment.previousDeploymentId).toBe(currentDeployment.id);
    });
  });
});
