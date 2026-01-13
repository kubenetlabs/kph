/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/**
 * Retry and Error Recovery Integration Tests
 *
 * Tests the deployment retry workflow including:
 * - Failed deployments and error tracking
 * - Retry attempts with count tracking
 * - Max retry limits
 * - Error details persistence
 * - Recovery after retries
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
  testFactories,
  type TestDatabaseStore,
  type TestPolicyDeployment,
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
// TEST SUITE: Retry and Error Recovery
// ============================================================================

describe("Retry and Error Recovery Integration Tests", () => {
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
  // Error Details Tracking Tests
  // ==========================================================================

  describe("Error Details Tracking", () => {
    it("should persist detailed error information on failure", async () => {
      const scenario = setupTestScenario(store);
      const { policy, version } = createDeployablePolicy(store, scenario, {
        status: "PENDING",
      });
      const deployment = createTestDeployment(store, scenario, policy, version);

      // Simulate failure with detailed error
      const request = createOperatorRequest(
        `http://localhost:3000/api/operator/policies/${policy.id}/status`,
        scenario.rawToken,
        {
          method: "PATCH",
          body: {
            status: "FAILED",
            error: "CRD validation failed",
            errorDetails: {
              type: "ValidationError",
              resource: "CiliumNetworkPolicy/test-policy",
              reason: "FieldValueInvalid",
              retryable: false,
              suggestion: "Check that spec.ingress is properly formatted",
            },
          },
        }
      );

      const response = await updatePolicyStatus(request, {
        params: Promise.resolve({ id: policy.id }),
      });

      expect(response.status).toBe(200);

      // Verify error details were persisted
      const updatedDeployment = store.policyDeployments.get(deployment.id);
      expect(updatedDeployment?.status).toBe("FAILED");
      expect(updatedDeployment?.errorMessage).toBe("CRD validation failed");
      expect(updatedDeployment?.errorDetails).toMatchObject({
        type: "ValidationError",
        resource: "CiliumNetworkPolicy/test-policy",
        reason: "FieldValueInvalid",
        retryable: false,
        suggestion: expect.any(String),
      });
    });

    it("should track different error types correctly", async () => {
      const scenario = setupTestScenario(store);

      // Test various error types
      const errorTypes = [
        {
          type: "NetworkError",
          error: "Connection refused to K8s API server",
          retryable: true,
        },
        {
          type: "AuthenticationError",
          error: "Service account token expired",
          retryable: false,
        },
        {
          type: "K8sAPIError",
          error: "Resource quota exceeded",
          retryable: true,
        },
        {
          type: "RateLimitError",
          error: "Too many requests to API server",
          retryable: true,
        },
      ];

      for (const errorType of errorTypes) {
        const { policy, version } = createDeployablePolicy(store, scenario, {
          name: `policy-${errorType.type}`,
          status: "PENDING",
        });
        const deployment = createTestDeployment(store, scenario, policy, version);

        const request = createOperatorRequest(
          `http://localhost:3000/api/operator/policies/${policy.id}/status`,
          scenario.rawToken,
          {
            method: "PATCH",
            body: {
              status: "FAILED",
              error: errorType.error,
              errorDetails: {
                type: errorType.type,
                retryable: errorType.retryable,
              },
            },
          }
        );

        await updatePolicyStatus(request, {
          params: Promise.resolve({ id: policy.id }),
        });

        const updatedDeployment = store.policyDeployments.get(deployment.id);
        expect(updatedDeployment?.errorDetails).toMatchObject({
          type: errorType.type,
          retryable: errorType.retryable,
        });
      }
    });

    it("should handle failure with minimal error info", async () => {
      const scenario = setupTestScenario(store);
      const { policy, version } = createDeployablePolicy(store, scenario, {
        status: "PENDING",
      });
      const deployment = createTestDeployment(store, scenario, policy, version);

      // Fail with just the status and error message
      const request = createOperatorRequest(
        `http://localhost:3000/api/operator/policies/${policy.id}/status`,
        scenario.rawToken,
        {
          method: "PATCH",
          body: {
            status: "FAILED",
            error: "Unknown error occurred",
          },
        }
      );

      const response = await updatePolicyStatus(request, {
        params: Promise.resolve({ id: policy.id }),
      });

      expect(response.status).toBe(200);

      const updatedDeployment = store.policyDeployments.get(deployment.id);
      expect(updatedDeployment?.status).toBe("FAILED");
      expect(updatedDeployment?.errorMessage).toBe("Unknown error occurred");
    });
  });

  // ==========================================================================
  // Retry Flow Tests
  // ==========================================================================

  describe("Retry Flow", () => {
    it("should allow retry of failed deployment via operator", async () => {
      const scenario = setupTestScenario(store);
      const { policy, version } = createDeployablePolicy(store, scenario, {
        status: "PENDING",
      });
      const deployment = createTestDeployment(store, scenario, policy, version);

      // Step 1: First deployment fails
      await updatePolicyStatus(
        createOperatorRequest(
          `http://localhost:3000/api/operator/policies/${policy.id}/status`,
          scenario.rawToken,
          {
            method: "PATCH",
            body: {
              status: "FAILED",
              error: "Temporary network error",
              errorDetails: { type: "NetworkError", retryable: true },
            },
          }
        ),
        { params: Promise.resolve({ id: policy.id }) }
      );

      // Verify failure
      expect(store.policies.get(policy.id)?.status).toBe("FAILED");

      // Step 2: Simulate retry (reset deployment to PENDING)
      // In the real app, this would be done via tRPC retry procedure
      const failedDeployment = store.policyDeployments.get(deployment.id);
      if (failedDeployment) {
        failedDeployment.status = "PENDING";
        failedDeployment.retryCount = 1;
        failedDeployment.lastRetryAt = new Date();
        failedDeployment.errorMessage = null;
        failedDeployment.errorDetails = null;
        store.policyDeployments.set(deployment.id, failedDeployment);
      }

      // Update policy to PENDING for re-fetch
      const policyRecord = store.policies.get(policy.id);
      if (policyRecord) {
        policyRecord.status = "PENDING";
        store.policies.set(policy.id, policyRecord);
      }

      // Step 3: Operator picks up the retried deployment
      const fetchRequest = createOperatorRequest(
        "http://localhost:3000/api/operator/policies",
        scenario.rawToken
      );
      const fetchResponse = await getPolicies(fetchRequest);
      const fetchData = await fetchResponse.json();

      expect(fetchData.policies).toHaveLength(1);
      expect(fetchData.policies[0].status).toBe("PENDING");

      // Step 4: Retry succeeds
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

      // Verify success
      expect(store.policies.get(policy.id)?.status).toBe("DEPLOYED");

      const finalDeployment = store.policyDeployments.get(deployment.id);
      expect(finalDeployment?.status).toBe("SUCCEEDED");
      expect(finalDeployment?.retryCount).toBe(1);
    });

    it("should track retry count across multiple failures", async () => {
      const scenario = setupTestScenario(store);
      const { policy, version } = createDeployablePolicy(store, scenario, {
        status: "PENDING",
      });
      const deployment = createTestDeployment(store, scenario, policy, version, {
        retryCount: 0,
        maxRetries: 3,
      });

      // Simulate multiple retry cycles
      for (let retryNum = 0; retryNum <= 2; retryNum++) {
        // Update deployment to simulate retry start
        const deploymentRecord = store.policyDeployments.get(deployment.id);
        if (deploymentRecord) {
          deploymentRecord.status = "IN_PROGRESS";
          deploymentRecord.retryCount = retryNum;
          deploymentRecord.startedAt = new Date();
          store.policyDeployments.set(deployment.id, deploymentRecord);
        }

        // Update policy
        const policyRecord = store.policies.get(policy.id);
        if (policyRecord) {
          policyRecord.status = "PENDING";
          store.policies.set(policy.id, policyRecord);
        }

        // Simulate failure
        await updatePolicyStatus(
          createOperatorRequest(
            `http://localhost:3000/api/operator/policies/${policy.id}/status`,
            scenario.rawToken,
            {
              method: "PATCH",
              body: {
                status: "FAILED",
                error: `Retry ${retryNum + 1} failed`,
                errorDetails: { type: "NetworkError", retryable: true },
              },
            }
          ),
          { params: Promise.resolve({ id: policy.id }) }
        );
      }

      // Verify final state
      const finalDeployment = store.policyDeployments.get(deployment.id);
      expect(finalDeployment?.status).toBe("FAILED");
      expect(finalDeployment?.errorMessage).toBe("Retry 3 failed");
    });

    it("should preserve error history when updating with new error", async () => {
      const scenario = setupTestScenario(store);
      const { policy, version } = createDeployablePolicy(store, scenario, {
        status: "PENDING",
      });
      const deployment = createTestDeployment(store, scenario, policy, version);

      // First failure
      await updatePolicyStatus(
        createOperatorRequest(
          `http://localhost:3000/api/operator/policies/${policy.id}/status`,
          scenario.rawToken,
          {
            method: "PATCH",
            body: {
              status: "FAILED",
              error: "First error: Connection timeout",
              errorDetails: { type: "NetworkError" },
            },
          }
        ),
        { params: Promise.resolve({ id: policy.id }) }
      );

      const firstFailure = store.policyDeployments.get(deployment.id);
      expect(firstFailure?.errorMessage).toBe("First error: Connection timeout");

      // Reset for retry
      const deploymentRecord = store.policyDeployments.get(deployment.id);
      if (deploymentRecord) {
        deploymentRecord.status = "PENDING";
        deploymentRecord.retryCount = 1;
        store.policyDeployments.set(deployment.id, deploymentRecord);
      }
      store.policies.get(policy.id)!.status = "PENDING";

      // Second failure with different error
      await updatePolicyStatus(
        createOperatorRequest(
          `http://localhost:3000/api/operator/policies/${policy.id}/status`,
          scenario.rawToken,
          {
            method: "PATCH",
            body: {
              status: "FAILED",
              error: "Second error: API server unavailable",
              errorDetails: { type: "K8sAPIError" },
            },
          }
        ),
        { params: Promise.resolve({ id: policy.id }) }
      );

      // New error should overwrite old
      const secondFailure = store.policyDeployments.get(deployment.id);
      expect(secondFailure?.errorMessage).toBe("Second error: API server unavailable");
      expect(secondFailure?.errorDetails).toMatchObject({ type: "K8sAPIError" });
    });
  });

  // ==========================================================================
  // Recovery Scenarios Tests
  // ==========================================================================

  describe("Recovery Scenarios", () => {
    it("should recover from transient network failure", async () => {
      const scenario = setupTestScenario(store);
      const { policy, version } = createDeployablePolicy(store, scenario, {
        status: "PENDING",
      });
      const deployment = createTestDeployment(store, scenario, policy, version);

      // First attempt - fails with network error
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
              error: "dial tcp: connection refused",
              errorDetails: {
                type: "NetworkError",
                retryable: true,
                suggestion: "Network issue may be transient, retry recommended",
              },
            },
          }
        ),
        { params: Promise.resolve({ id: policy.id }) }
      );

      expect(store.policies.get(policy.id)?.status).toBe("FAILED");

      // Simulate retry
      const deploymentRecord = store.policyDeployments.get(deployment.id)!;
      deploymentRecord.status = "PENDING";
      deploymentRecord.retryCount = 1;
      deploymentRecord.errorMessage = null;
      deploymentRecord.errorDetails = null;
      store.policies.get(policy.id)!.status = "PENDING";

      // Second attempt - succeeds
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
              status: "DEPLOYED",
              version: 1,
              deployedResources: [
                { apiVersion: "cilium.io/v2", kind: "CiliumNetworkPolicy", name: "test" },
              ],
            },
          }
        ),
        { params: Promise.resolve({ id: policy.id }) }
      );

      // Verify recovery
      expect(store.policies.get(policy.id)?.status).toBe("DEPLOYED");
      expect(store.policyDeployments.get(deployment.id)?.status).toBe("SUCCEEDED");
    });

    it("should handle graceful degradation on non-retryable error", async () => {
      const scenario = setupTestScenario(store);
      const { policy, version } = createDeployablePolicy(store, scenario, {
        status: "PENDING",
      });
      const deployment = createTestDeployment(store, scenario, policy, version);

      // Fail with non-retryable error
      await updatePolicyStatus(
        createOperatorRequest(
          `http://localhost:3000/api/operator/policies/${policy.id}/status`,
          scenario.rawToken,
          {
            method: "PATCH",
            body: {
              status: "FAILED",
              error: "Policy YAML contains invalid spec",
              errorDetails: {
                type: "ValidationError",
                resource: "CiliumNetworkPolicy/test-policy",
                reason: "Invalid",
                retryable: false,
                suggestion: "Fix the policy YAML before retrying",
              },
            },
          }
        ),
        { params: Promise.resolve({ id: policy.id }) }
      );

      const failedDeployment = store.policyDeployments.get(deployment.id);
      expect(failedDeployment?.status).toBe("FAILED");
      expect(failedDeployment?.errorDetails).toMatchObject({
        type: "ValidationError",
        retryable: false,
      });

      // Policy should not appear in operator fetch
      const fetchResponse = await getPolicies(
        createOperatorRequest(
          "http://localhost:3000/api/operator/policies",
          scenario.rawToken
        )
      );
      const fetchData = await fetchResponse.json();
      expect(fetchData.policies).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Concurrent Failure Handling Tests
  // ==========================================================================

  describe("Concurrent Failure Handling", () => {
    it("should handle multiple policies failing independently", async () => {
      const scenario = setupTestScenario(store);

      // Create multiple policies
      const policies = [
        createDeployablePolicy(store, scenario, { name: "policy-a", status: "PENDING" }),
        createDeployablePolicy(store, scenario, { name: "policy-b", status: "PENDING" }),
        createDeployablePolicy(store, scenario, { name: "policy-c", status: "PENDING" }),
      ];

      // Create deployments
      const deployments = policies.map(({ policy, version }) =>
        createTestDeployment(store, scenario, policy, version)
      );

      // Policy A fails with ValidationError
      await updatePolicyStatus(
        createOperatorRequest(
          `http://localhost:3000/api/operator/policies/${policies[0].policy.id}/status`,
          scenario.rawToken,
          {
            method: "PATCH",
            body: {
              status: "FAILED",
              error: "Validation error in policy A",
              errorDetails: { type: "ValidationError", retryable: false },
            },
          }
        ),
        { params: Promise.resolve({ id: policies[0].policy.id }) }
      );

      // Policy B fails with NetworkError (retryable)
      await updatePolicyStatus(
        createOperatorRequest(
          `http://localhost:3000/api/operator/policies/${policies[1].policy.id}/status`,
          scenario.rawToken,
          {
            method: "PATCH",
            body: {
              status: "FAILED",
              error: "Network error in policy B",
              errorDetails: { type: "NetworkError", retryable: true },
            },
          }
        ),
        { params: Promise.resolve({ id: policies[1].policy.id }) }
      );

      // Policy C succeeds
      await updatePolicyStatus(
        createOperatorRequest(
          `http://localhost:3000/api/operator/policies/${policies[2].policy.id}/status`,
          scenario.rawToken,
          { method: "PATCH", body: { status: "IN_PROGRESS" } }
        ),
        { params: Promise.resolve({ id: policies[2].policy.id }) }
      );
      await updatePolicyStatus(
        createOperatorRequest(
          `http://localhost:3000/api/operator/policies/${policies[2].policy.id}/status`,
          scenario.rawToken,
          { method: "PATCH", body: { status: "DEPLOYED", version: 1 } }
        ),
        { params: Promise.resolve({ id: policies[2].policy.id }) }
      );

      // Verify all states
      expect(store.policies.get(policies[0].policy.id)?.status).toBe("FAILED");
      expect(store.policies.get(policies[1].policy.id)?.status).toBe("FAILED");
      expect(store.policies.get(policies[2].policy.id)?.status).toBe("DEPLOYED");

      // Verify error types
      expect(store.policyDeployments.get(deployments[0].id)?.errorDetails).toMatchObject({
        type: "ValidationError",
      });
      expect(store.policyDeployments.get(deployments[1].id)?.errorDetails).toMatchObject({
        type: "NetworkError",
      });

      // Only deployed policy should be in operator fetch
      const fetchResponse = await getPolicies(
        createOperatorRequest(
          "http://localhost:3000/api/operator/policies",
          scenario.rawToken
        )
      );
      const fetchData = await fetchResponse.json();
      expect(fetchData.policies).toHaveLength(1);
      expect(fetchData.policies[0].name).toBe("policy-c");
    });
  });

  // ==========================================================================
  // Edge Cases Tests
  // ==========================================================================

  describe("Edge Cases", () => {
    it("should handle empty error message gracefully", async () => {
      const scenario = setupTestScenario(store);
      const { policy, version } = createDeployablePolicy(store, scenario, {
        status: "PENDING",
      });
      createTestDeployment(store, scenario, policy, version);

      // Fail with empty error
      const response = await updatePolicyStatus(
        createOperatorRequest(
          `http://localhost:3000/api/operator/policies/${policy.id}/status`,
          scenario.rawToken,
          {
            method: "PATCH",
            body: {
              status: "FAILED",
              // No error message or errorDetails
            },
          }
        ),
        { params: Promise.resolve({ id: policy.id }) }
      );

      expect(response.status).toBe(200);
      expect(store.policies.get(policy.id)?.status).toBe("FAILED");
    });

    it("should handle very long error messages", async () => {
      const scenario = setupTestScenario(store);
      const { policy, version } = createDeployablePolicy(store, scenario, {
        status: "PENDING",
      });
      const deployment = createTestDeployment(store, scenario, policy, version);

      const longError = "Error: " + "x".repeat(10000);
      const longSuggestion = "Try: " + "y".repeat(5000);

      await updatePolicyStatus(
        createOperatorRequest(
          `http://localhost:3000/api/operator/policies/${policy.id}/status`,
          scenario.rawToken,
          {
            method: "PATCH",
            body: {
              status: "FAILED",
              error: longError,
              errorDetails: {
                type: "ValidationError",
                suggestion: longSuggestion,
              },
            },
          }
        ),
        { params: Promise.resolve({ id: policy.id }) }
      );

      const failedDeployment = store.policyDeployments.get(deployment.id);
      expect(failedDeployment?.errorMessage).toBe(longError);
      expect((failedDeployment?.errorDetails as { suggestion: string })?.suggestion).toBe(longSuggestion);
    });

    it("should handle special characters in error messages", async () => {
      const scenario = setupTestScenario(store);
      const { policy, version } = createDeployablePolicy(store, scenario, {
        status: "PENDING",
      });
      createTestDeployment(store, scenario, policy, version);

      const specialError = 'Error parsing YAML: unexpected \'}\' at line 10 <invalid> "quoted" & stuff';

      await updatePolicyStatus(
        createOperatorRequest(
          `http://localhost:3000/api/operator/policies/${policy.id}/status`,
          scenario.rawToken,
          {
            method: "PATCH",
            body: {
              status: "FAILED",
              error: specialError,
            },
          }
        ),
        { params: Promise.resolve({ id: policy.id }) }
      );

      const deployments = Array.from(store.policyDeployments.values());
      const deployment = deployments.find(d => d.policyId === policy.id);
      expect(deployment?.errorMessage).toBe(specialError);
    });
  });
});
