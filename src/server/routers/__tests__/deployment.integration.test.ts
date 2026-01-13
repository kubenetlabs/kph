/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/**
 * Deployment Workflow Integration Tests
 *
 * Tests the end-to-end deployment flow from policy creation through
 * operator status updates to completion. These tests simulate the
 * actual communication between the SaaS platform and the operator.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createTestDatabase,
  createStatefulMockPrisma,
  setupTestScenario,
  createDeployablePolicy,
  createTestDeployment,
  createOperatorRequest,
  resetIdCounter,
  type TestDatabaseStore,
  type TestPolicy,
  type TestPolicyVersion,
  type TestPolicyDeployment,
} from "~/test/integration-helpers";

// ============================================================================
// MOCK SETUP
// ============================================================================

let store: TestDatabaseStore;
let mockDb: ReturnType<typeof createStatefulMockPrisma>;

// Mock the database module
vi.mock("~/lib/db", () => ({
  get db() {
    return mockDb;
  },
}));

// Import API handlers after mocking
import { GET as getPolicies } from "~/app/api/operator/policies/route";
import { PATCH as updatePolicyStatus } from "~/app/api/operator/policies/[id]/status/route";

// ============================================================================
// TEST SUITE: Deployment Flow
// ============================================================================

describe("Deployment Workflow Integration Tests", () => {
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
  // Operator Policy Fetch Tests
  // ==========================================================================

  describe("GET /api/operator/policies - Operator fetches policies", () => {
    it("should return PENDING policies for authenticated operator", async () => {
      // Setup test scenario
      const scenario = setupTestScenario(store);
      const { policy } = createDeployablePolicy(store, scenario, { status: "PENDING" });

      // Create the request
      const request = createOperatorRequest(
        "http://localhost:3000/api/operator/policies",
        scenario.rawToken
      );

      // Call the handler
      const response = await getPolicies(request);
      const data = await response.json();

      // Verify response
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.policies).toHaveLength(1);
      expect(data.policies[0].id).toBe(policy.id);
      expect(data.policies[0].status).toBe("PENDING");
    });

    it("should return both PENDING and DEPLOYED policies", async () => {
      const scenario = setupTestScenario(store);

      // Create a pending policy
      createDeployablePolicy(store, scenario, {
        name: "pending-policy",
        status: "PENDING",
      });

      // Create a deployed policy
      createDeployablePolicy(store, scenario, {
        name: "deployed-policy",
        status: "DEPLOYED",
      });

      const request = createOperatorRequest(
        "http://localhost:3000/api/operator/policies",
        scenario.rawToken
      );

      const response = await getPolicies(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.policies).toHaveLength(2);

      const statuses = data.policies.map((p: { status: string }) => p.status);
      expect(statuses).toContain("PENDING");
      expect(statuses).toContain("DEPLOYED");
    });

    it("should NOT return DRAFT or FAILED policies", async () => {
      const scenario = setupTestScenario(store);

      createDeployablePolicy(store, scenario, { status: "DRAFT" });
      createDeployablePolicy(store, scenario, { status: "FAILED" });

      const request = createOperatorRequest(
        "http://localhost:3000/api/operator/policies",
        scenario.rawToken
      );

      const response = await getPolicies(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.policies).toHaveLength(0);
    });

    it("should only return policies for the authenticated cluster", async () => {
      const scenario1 = setupTestScenario(store);
      const scenario2 = setupTestScenario(store);

      // Policy for cluster 1
      createDeployablePolicy(store, scenario1, { status: "PENDING" });

      // Policy for cluster 2
      createDeployablePolicy(store, scenario2, { status: "PENDING" });

      // Fetch as cluster 1
      const request = createOperatorRequest(
        "http://localhost:3000/api/operator/policies",
        scenario1.rawToken
      );

      const response = await getPolicies(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.policies).toHaveLength(1);
      // Policy should belong to cluster 1
      const returnedPolicy = store.policies.get(data.policies[0].id);
      expect(returnedPolicy?.clusterId).toBe(scenario1.cluster.id);
    });

    it("should return 401 for invalid token", async () => {
      const request = createOperatorRequest(
        "http://localhost:3000/api/operator/policies",
        "invalid-token"
      );

      const response = await getPolicies(request);

      expect(response.status).toBe(401);
    });

    it("should return 401 for missing Authorization header", async () => {
      const request = new Request("http://localhost:3000/api/operator/policies", {
        method: "GET",
      });

      const response = await getPolicies(request as unknown as Parameters<typeof getPolicies>[0]);

      expect(response.status).toBe(401);
    });
  });

  // ==========================================================================
  // Status Update Tests
  // ==========================================================================

  describe("PATCH /api/operator/policies/[id]/status - Status updates", () => {
    it("should update deployment to IN_PROGRESS", async () => {
      const scenario = setupTestScenario(store);
      const { policy, version } = createDeployablePolicy(store, scenario, {
        status: "PENDING",
      });
      const deployment = createTestDeployment(store, scenario, policy, version);

      const request = createOperatorRequest(
        `http://localhost:3000/api/operator/policies/${policy.id}/status`,
        scenario.rawToken,
        {
          method: "PATCH",
          body: { status: "IN_PROGRESS" },
        }
      );

      const response = await updatePolicyStatus(request, {
        params: Promise.resolve({ id: policy.id }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.status).toBe("IN_PROGRESS");

      // Verify deployment was updated
      const updatedDeployment = store.policyDeployments.get(deployment.id);
      expect(updatedDeployment?.status).toBe("IN_PROGRESS");
      expect(updatedDeployment?.startedAt).not.toBeNull();
    });

    it("should update policy and deployment to DEPLOYED/SUCCEEDED", async () => {
      const scenario = setupTestScenario(store);
      const { policy, version } = createDeployablePolicy(store, scenario, {
        status: "PENDING",
      });
      const deployment = createTestDeployment(store, scenario, policy, version, {
        status: "IN_PROGRESS",
        startedAt: new Date(),
      });

      const request = createOperatorRequest(
        `http://localhost:3000/api/operator/policies/${policy.id}/status`,
        scenario.rawToken,
        {
          method: "PATCH",
          body: {
            status: "DEPLOYED",
            version: 1,
            deployedResources: [
              {
                apiVersion: "cilium.io/v2",
                kind: "CiliumNetworkPolicy",
                name: "test-policy",
                namespace: "default",
              },
            ],
          },
        }
      );

      const response = await updatePolicyStatus(request, {
        params: Promise.resolve({ id: policy.id }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.status).toBe("DEPLOYED");
      expect(data.deployedVersion).toBe(1);

      // Verify policy status
      const updatedPolicy = store.policies.get(policy.id);
      expect(updatedPolicy?.status).toBe("DEPLOYED");
      expect(updatedPolicy?.deployedAt).not.toBeNull();
      expect(updatedPolicy?.deployedVersion).toBe(1);

      // Verify deployment status
      const updatedDeployment = store.policyDeployments.get(deployment.id);
      expect(updatedDeployment?.status).toBe("SUCCEEDED");
      expect(updatedDeployment?.completedAt).not.toBeNull();
      expect(updatedDeployment?.resourceName).toBe("test-policy");
      expect(updatedDeployment?.resourceNamespace).toBe("default");

      // Verify audit log was created
      expect(store.auditLogs.length).toBeGreaterThan(0);
      const auditLog = store.auditLogs.find(l => l.action === "policy.deployed");
      expect(auditLog).toBeDefined();
    });

    it("should update policy and deployment to FAILED", async () => {
      const scenario = setupTestScenario(store);
      const { policy, version } = createDeployablePolicy(store, scenario, {
        status: "PENDING",
      });
      const deployment = createTestDeployment(store, scenario, policy, version, {
        status: "IN_PROGRESS",
      });

      const request = createOperatorRequest(
        `http://localhost:3000/api/operator/policies/${policy.id}/status`,
        scenario.rawToken,
        {
          method: "PATCH",
          body: {
            status: "FAILED",
            error: "Connection to K8s API server failed",
            errorDetails: {
              type: "NetworkError",
              reason: "Timeout",
              retryable: true,
              suggestion: "Check network connectivity to cluster",
            },
          },
        }
      );

      const response = await updatePolicyStatus(request, {
        params: Promise.resolve({ id: policy.id }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.status).toBe("FAILED");

      // Verify policy status
      const updatedPolicy = store.policies.get(policy.id);
      expect(updatedPolicy?.status).toBe("FAILED");

      // Verify deployment status and error details
      const updatedDeployment = store.policyDeployments.get(deployment.id);
      expect(updatedDeployment?.status).toBe("FAILED");
      expect(updatedDeployment?.errorMessage).toBe("Connection to K8s API server failed");
      expect(updatedDeployment?.errorDetails).toMatchObject({
        type: "NetworkError",
        retryable: true,
      });

      // Verify audit log
      const auditLog = store.auditLogs.find(l => l.action === "policy.failed");
      expect(auditLog).toBeDefined();
    });

    it("should return 404 for non-existent policy", async () => {
      const scenario = setupTestScenario(store);

      const request = createOperatorRequest(
        "http://localhost:3000/api/operator/policies/non-existent-id/status",
        scenario.rawToken,
        {
          method: "PATCH",
          body: { status: "DEPLOYED" },
        }
      );

      const response = await updatePolicyStatus(request, {
        params: Promise.resolve({ id: "non-existent-id" }),
      });

      expect(response.status).toBe(404);
    });

    it("should return 404 for policy from different cluster", async () => {
      const scenario1 = setupTestScenario(store);
      const scenario2 = setupTestScenario(store);

      // Create policy for cluster 2
      const { policy } = createDeployablePolicy(store, scenario2, {
        status: "PENDING",
      });

      // Try to update from cluster 1
      const request = createOperatorRequest(
        `http://localhost:3000/api/operator/policies/${policy.id}/status`,
        scenario1.rawToken,
        {
          method: "PATCH",
          body: { status: "DEPLOYED" },
        }
      );

      const response = await updatePolicyStatus(request, {
        params: Promise.resolve({ id: policy.id }),
      });

      expect(response.status).toBe(404);
    });

    it("should return 400 for invalid status", async () => {
      const scenario = setupTestScenario(store);
      const { policy } = createDeployablePolicy(store, scenario, {
        status: "PENDING",
      });

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
      expect(data.error).toBe("Validation failed");
    });

    it("should return 400 for invalid JSON body", async () => {
      const scenario = setupTestScenario(store);
      const { policy } = createDeployablePolicy(store, scenario, {
        status: "PENDING",
      });

      // Create request with invalid JSON
      const request = new Request(
        `http://localhost:3000/api/operator/policies/${policy.id}/status`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${scenario.rawToken}`,
            "Content-Type": "application/json",
          },
          body: "invalid json {",
        }
      );

      const response = await updatePolicyStatus(
        request as unknown as Parameters<typeof updatePolicyStatus>[0],
        { params: Promise.resolve({ id: policy.id }) }
      );

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Invalid JSON in request body");
    });
  });

  // ==========================================================================
  // Complete Deployment Flow Tests
  // ==========================================================================

  describe("End-to-End Deployment Flow", () => {
    it("should complete full deployment lifecycle: PENDING → IN_PROGRESS → DEPLOYED", async () => {
      const scenario = setupTestScenario(store);
      const { policy, version } = createDeployablePolicy(store, scenario, {
        status: "PENDING",
      });
      const deployment = createTestDeployment(store, scenario, policy, version);

      // Step 1: Operator fetches policies
      const fetchRequest = createOperatorRequest(
        "http://localhost:3000/api/operator/policies",
        scenario.rawToken
      );
      const fetchResponse = await getPolicies(fetchRequest);
      const fetchData = await fetchResponse.json();

      expect(fetchResponse.status).toBe(200);
      expect(fetchData.policies).toHaveLength(1);
      expect(fetchData.policies[0].status).toBe("PENDING");

      // Step 2: Operator starts deployment (IN_PROGRESS)
      const inProgressRequest = createOperatorRequest(
        `http://localhost:3000/api/operator/policies/${policy.id}/status`,
        scenario.rawToken,
        {
          method: "PATCH",
          body: { status: "IN_PROGRESS" },
        }
      );
      const inProgressResponse = await updatePolicyStatus(inProgressRequest, {
        params: Promise.resolve({ id: policy.id }),
      });

      expect(inProgressResponse.status).toBe(200);

      // Verify intermediate state
      let currentDeployment = store.policyDeployments.get(deployment.id);
      expect(currentDeployment?.status).toBe("IN_PROGRESS");
      expect(currentDeployment?.startedAt).not.toBeNull();

      // Step 3: Operator completes deployment (DEPLOYED)
      const deployedRequest = createOperatorRequest(
        `http://localhost:3000/api/operator/policies/${policy.id}/status`,
        scenario.rawToken,
        {
          method: "PATCH",
          body: {
            status: "DEPLOYED",
            version: 1,
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
      );
      const deployedResponse = await updatePolicyStatus(deployedRequest, {
        params: Promise.resolve({ id: policy.id }),
      });

      expect(deployedResponse.status).toBe(200);

      // Verify final state
      const finalPolicy = store.policies.get(policy.id);
      expect(finalPolicy?.status).toBe("DEPLOYED");
      expect(finalPolicy?.deployedVersion).toBe(1);
      expect(finalPolicy?.deployedAt).not.toBeNull();

      currentDeployment = store.policyDeployments.get(deployment.id);
      expect(currentDeployment?.status).toBe("SUCCEEDED");
      expect(currentDeployment?.completedAt).not.toBeNull();

      // Step 4: Operator re-fetches policies (should still see DEPLOYED)
      const refetchRequest = createOperatorRequest(
        "http://localhost:3000/api/operator/policies",
        scenario.rawToken
      );
      const refetchResponse = await getPolicies(refetchRequest);
      const refetchData = await refetchResponse.json();

      expect(refetchResponse.status).toBe(200);
      expect(refetchData.policies).toHaveLength(1);
      expect(refetchData.policies[0].status).toBe("DEPLOYED");
    });

    it("should handle deployment failure: PENDING → IN_PROGRESS → FAILED", async () => {
      const scenario = setupTestScenario(store);
      const { policy, version } = createDeployablePolicy(store, scenario, {
        status: "PENDING",
      });
      const deployment = createTestDeployment(store, scenario, policy, version);

      // Step 1: Start deployment
      const inProgressRequest = createOperatorRequest(
        `http://localhost:3000/api/operator/policies/${policy.id}/status`,
        scenario.rawToken,
        {
          method: "PATCH",
          body: { status: "IN_PROGRESS" },
        }
      );
      await updatePolicyStatus(inProgressRequest, {
        params: Promise.resolve({ id: policy.id }),
      });

      // Step 2: Deployment fails
      const failedRequest = createOperatorRequest(
        `http://localhost:3000/api/operator/policies/${policy.id}/status`,
        scenario.rawToken,
        {
          method: "PATCH",
          body: {
            status: "FAILED",
            error: "CRD validation failed: spec.ingress[0].fromEndpoints is required",
            errorDetails: {
              type: "ValidationError",
              resource: "CiliumNetworkPolicy/test-policy",
              reason: "Invalid",
              retryable: false,
              suggestion: "Check the policy YAML for syntax errors",
            },
          },
        }
      );
      const failedResponse = await updatePolicyStatus(failedRequest, {
        params: Promise.resolve({ id: policy.id }),
      });

      expect(failedResponse.status).toBe(200);

      // Verify final state
      const finalPolicy = store.policies.get(policy.id);
      expect(finalPolicy?.status).toBe("FAILED");

      const finalDeployment = store.policyDeployments.get(deployment.id);
      expect(finalDeployment?.status).toBe("FAILED");
      expect(finalDeployment?.errorMessage).toContain("CRD validation failed");
      expect(finalDeployment?.errorDetails).toMatchObject({
        type: "ValidationError",
        retryable: false,
      });

      // Policy should NOT appear in operator fetch (status is FAILED)
      const fetchRequest = createOperatorRequest(
        "http://localhost:3000/api/operator/policies",
        scenario.rawToken
      );
      const fetchResponse = await getPolicies(fetchRequest);
      const fetchData = await fetchResponse.json();

      expect(fetchResponse.status).toBe(200);
      expect(fetchData.policies).toHaveLength(0);
    });

    it("should support direct PENDING → FAILED transition (pre-apply validation failure)", async () => {
      const scenario = setupTestScenario(store);
      const { policy, version } = createDeployablePolicy(store, scenario, {
        status: "PENDING",
      });
      createTestDeployment(store, scenario, policy, version);

      // Operator validates policy locally and it fails before even applying
      const failedRequest = createOperatorRequest(
        `http://localhost:3000/api/operator/policies/${policy.id}/status`,
        scenario.rawToken,
        {
          method: "PATCH",
          body: {
            status: "FAILED",
            error: "Invalid YAML: unexpected end of file",
            errorDetails: {
              type: "ValidationError",
              retryable: false,
            },
          },
        }
      );

      const response = await updatePolicyStatus(failedRequest, {
        params: Promise.resolve({ id: policy.id }),
      });

      expect(response.status).toBe(200);

      const finalPolicy = store.policies.get(policy.id);
      expect(finalPolicy?.status).toBe("FAILED");
    });
  });

  // ==========================================================================
  // Multiple Policies Tests
  // ==========================================================================

  describe("Multiple Policies Handling", () => {
    it("should handle multiple concurrent deployments to same cluster", async () => {
      const scenario = setupTestScenario(store);

      // Create 3 policies all pending
      const policies = [
        createDeployablePolicy(store, scenario, { name: "policy-1", status: "PENDING" }),
        createDeployablePolicy(store, scenario, { name: "policy-2", status: "PENDING" }),
        createDeployablePolicy(store, scenario, { name: "policy-3", status: "PENDING" }),
      ];

      // Operator fetches all pending policies
      const fetchRequest = createOperatorRequest(
        "http://localhost:3000/api/operator/policies",
        scenario.rawToken
      );
      const fetchResponse = await getPolicies(fetchRequest);
      const fetchData = await fetchResponse.json();

      expect(fetchResponse.status).toBe(200);
      expect(fetchData.policies).toHaveLength(3);

      // Deploy first two successfully, third fails
      for (let i = 0; i < 2; i++) {
        const { policy, version } = policies[i];
        createTestDeployment(store, scenario, policy, version);

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
              body: { status: "DEPLOYED", version: 1 },
            }
          ),
          { params: Promise.resolve({ id: policy.id }) }
        );
      }

      // Third policy fails
      const { policy: failingPolicy, version: failingVersion } = policies[2];
      createTestDeployment(store, scenario, failingPolicy, failingVersion);

      await updatePolicyStatus(
        createOperatorRequest(
          `http://localhost:3000/api/operator/policies/${failingPolicy.id}/status`,
          scenario.rawToken,
          { method: "PATCH", body: { status: "IN_PROGRESS" } }
        ),
        { params: Promise.resolve({ id: failingPolicy.id }) }
      );

      await updatePolicyStatus(
        createOperatorRequest(
          `http://localhost:3000/api/operator/policies/${failingPolicy.id}/status`,
          scenario.rawToken,
          {
            method: "PATCH",
            body: { status: "FAILED", error: "Resource quota exceeded" },
          }
        ),
        { params: Promise.resolve({ id: failingPolicy.id }) }
      );

      // Verify final states
      const policy1 = store.policies.get(policies[0].policy.id);
      const policy2 = store.policies.get(policies[1].policy.id);
      const policy3 = store.policies.get(policies[2].policy.id);

      expect(policy1?.status).toBe("DEPLOYED");
      expect(policy2?.status).toBe("DEPLOYED");
      expect(policy3?.status).toBe("FAILED");

      // Fetch should return only deployed policies
      const finalFetchResponse = await getPolicies(fetchRequest);
      const finalFetchData = await finalFetchResponse.json();

      expect(finalFetchData.policies).toHaveLength(2);
      expect(finalFetchData.policies.every((p: { status: string }) => p.status === "DEPLOYED")).toBe(true);
    });
  });
});
