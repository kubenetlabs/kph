/**
 * Operator Authentication Integration Tests
 *
 * Tests the authentication and authorization flow for operator-to-SaaS
 * communication, including token validation, scope checking, and error handling.
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
// TEST SUITE: Operator Authentication
// ============================================================================

describe("Operator Authentication Integration Tests", () => {
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
  // Token Validation Tests
  // ==========================================================================

  describe("Token Validation", () => {
    it("should authenticate valid Bearer token", async () => {
      const scenario = setupTestScenario(store);
      createDeployablePolicy(store, scenario, { status: "PENDING" });

      const request = createOperatorRequest(
        "http://localhost:3000/api/operator/policies",
        scenario.rawToken
      );

      const response = await getPolicies(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it("should reject request without Authorization header", async () => {
      const request = new Request("http://localhost:3000/api/operator/policies", {
        method: "GET",
      });

      const response = await getPolicies(request as Parameters<typeof getPolicies>[0]);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("should reject request with malformed Authorization header", async () => {
      const request = new Request("http://localhost:3000/api/operator/policies", {
        method: "GET",
        headers: {
          Authorization: "NotBearer sometoken",
        },
      });

      const response = await getPolicies(request as Parameters<typeof getPolicies>[0]);

      expect(response.status).toBe(401);
    });

    it("should reject request with invalid token", async () => {
      const request = createOperatorRequest(
        "http://localhost:3000/api/operator/policies",
        "phub_invalid_token_that_does_not_exist"
      );

      const response = await getPolicies(request);

      expect(response.status).toBe(401);
    });

    it("should reject revoked token", async () => {
      const scenario = setupTestScenario(store);

      // Revoke the token
      const token = store.apiTokens.get(scenario.apiToken.id);
      if (token) {
        token.revokedAt = new Date();
        store.apiTokens.set(token.id, token);
      }

      const request = createOperatorRequest(
        "http://localhost:3000/api/operator/policies",
        scenario.rawToken
      );

      const response = await getPolicies(request);

      expect(response.status).toBe(401);
    });

    it("should reject expired token", async () => {
      const scenario = setupTestScenario(store);

      // Set expiration to past date
      const token = store.apiTokens.get(scenario.apiToken.id);
      if (token) {
        token.expiresAt = new Date(Date.now() - 3600000); // 1 hour ago
        store.apiTokens.set(token.id, token);
      }

      const request = createOperatorRequest(
        "http://localhost:3000/api/operator/policies",
        scenario.rawToken
      );

      const response = await getPolicies(request);

      expect(response.status).toBe(401);
    });

    it("should accept non-expired token", async () => {
      const scenario = setupTestScenario(store);
      createDeployablePolicy(store, scenario, { status: "PENDING" });

      // Set expiration to future date
      const token = store.apiTokens.get(scenario.apiToken.id);
      if (token) {
        token.expiresAt = new Date(Date.now() + 3600000); // 1 hour from now
        store.apiTokens.set(token.id, token);
      }

      const request = createOperatorRequest(
        "http://localhost:3000/api/operator/policies",
        scenario.rawToken
      );

      const response = await getPolicies(request);

      expect(response.status).toBe(200);
    });

    it("should reject org-level token (no cluster) for policy endpoints", async () => {
      // Create org-level token (no clusterId)
      const org = testFactories.organization(store, {
        name: "Test Org",
        slug: "test-org",
      });

      const { rawToken } = testFactories.apiToken(store, {
        organizationId: org.id,
        clusterId: null, // Org-level token
        scopes: ["cluster:create", "policy:read"],
      });

      const request = createOperatorRequest(
        "http://localhost:3000/api/operator/policies",
        rawToken
      );

      const response = await getPolicies(request);

      // Should fail because operator auth requires clusterId
      expect(response.status).toBe(401);
    });
  });

  // ==========================================================================
  // Scope Validation Tests
  // ==========================================================================

  describe("Scope Validation", () => {
    it("should allow request with required scope", async () => {
      const scenario = setupTestScenario(store);
      createDeployablePolicy(store, scenario, { status: "PENDING" });

      // Verify token has policy:read scope
      const token = store.apiTokens.get(scenario.apiToken.id);
      expect(token?.scopes).toContain("policy:read");

      const request = createOperatorRequest(
        "http://localhost:3000/api/operator/policies",
        scenario.rawToken
      );

      const response = await getPolicies(request);

      expect(response.status).toBe(200);
    });

    it("should reject request without required scope", async () => {
      const org = testFactories.organization(store, { name: "Test Org" });
      const cluster = testFactories.cluster(store, { organizationId: org.id });

      // Create token WITHOUT policy:read scope
      const { rawToken } = testFactories.apiToken(store, {
        organizationId: org.id,
        clusterId: cluster.id,
        scopes: ["flow:write"], // Missing policy:read
      });

      const request = createOperatorRequest(
        "http://localhost:3000/api/operator/policies",
        rawToken
      );

      const response = await getPolicies(request);

      // Should return 403 Forbidden
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toContain("scope");
    });

    it("should allow status update with policy:read scope", async () => {
      const scenario = setupTestScenario(store);
      const { policy, version } = createDeployablePolicy(store, scenario, {
        status: "PENDING",
      });

      // Create deployment
      testFactories.policyDeployment(store, {
        policyId: policy.id,
        versionId: version.id,
        clusterId: scenario.cluster.id,
        deployedById: scenario.user.id,
        status: "IN_PROGRESS",
      });

      const request = createOperatorRequest(
        `http://localhost:3000/api/operator/policies/${policy.id}/status`,
        scenario.rawToken,
        {
          method: "PATCH",
          body: { status: "DEPLOYED", version: 1 },
        }
      );

      const response = await updatePolicyStatus(request, {
        params: Promise.resolve({ id: policy.id }),
      });

      expect(response.status).toBe(200);
    });
  });

  // ==========================================================================
  // Cross-Tenant Isolation Tests
  // ==========================================================================

  describe("Cross-Tenant Isolation", () => {
    it("should not allow access to policies from other organizations", async () => {
      // Setup two organizations with clusters
      const scenario1 = setupTestScenario(store);
      const scenario2 = setupTestScenario(store);

      // Create policy for org 2
      createDeployablePolicy(store, scenario2, { status: "PENDING" });

      // Try to fetch using org 1's token
      const request = createOperatorRequest(
        "http://localhost:3000/api/operator/policies",
        scenario1.rawToken
      );

      const response = await getPolicies(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      // Should not see org 2's policies
      expect(data.policies).toHaveLength(0);
    });

    it("should not allow status update on policies from other clusters", async () => {
      const scenario1 = setupTestScenario(store);
      const scenario2 = setupTestScenario(store);

      // Create policy for cluster 2
      const { policy } = createDeployablePolicy(store, scenario2, {
        status: "PENDING",
      });

      // Try to update using cluster 1's token
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

    it("should isolate policies between clusters in same organization", async () => {
      const org = testFactories.organization(store, { name: "Shared Org" });
      const user = testFactories.user(store, { organizationId: org.id });

      // Create two clusters in same org
      const cluster1 = testFactories.cluster(store, {
        organizationId: org.id,
        name: "cluster-1",
      });
      const cluster2 = testFactories.cluster(store, {
        organizationId: org.id,
        name: "cluster-2",
      });

      // Create tokens for each cluster
      const { rawToken: token1 } = testFactories.apiToken(store, {
        organizationId: org.id,
        clusterId: cluster1.id,
        scopes: ["policy:read"],
      });
      const { rawToken: token2 } = testFactories.apiToken(store, {
        organizationId: org.id,
        clusterId: cluster2.id,
        scopes: ["policy:read"],
      });

      // Create policy for cluster 1
      testFactories.policy(store, {
        organizationId: org.id,
        clusterId: cluster1.id,
        createdById: user.id,
        status: "PENDING",
        name: "cluster1-policy",
      });

      // Create policy for cluster 2
      testFactories.policy(store, {
        organizationId: org.id,
        clusterId: cluster2.id,
        createdById: user.id,
        status: "PENDING",
        name: "cluster2-policy",
      });

      // Fetch with cluster 1 token
      const request1 = createOperatorRequest(
        "http://localhost:3000/api/operator/policies",
        token1
      );
      const response1 = await getPolicies(request1);
      const data1 = await response1.json();

      expect(response1.status).toBe(200);
      expect(data1.policies).toHaveLength(1);
      expect(data1.policies[0].name).toBe("cluster1-policy");

      // Fetch with cluster 2 token
      const request2 = createOperatorRequest(
        "http://localhost:3000/api/operator/policies",
        token2
      );
      const response2 = await getPolicies(request2);
      const data2 = await response2.json();

      expect(response2.status).toBe(200);
      expect(data2.policies).toHaveLength(1);
      expect(data2.policies[0].name).toBe("cluster2-policy");
    });
  });

  // ==========================================================================
  // Token Usage Tracking Tests
  // ==========================================================================

  describe("Token Usage Tracking", () => {
    it("should update lastUsedAt timestamp on successful auth", async () => {
      const scenario = setupTestScenario(store);
      createDeployablePolicy(store, scenario, { status: "PENDING" });

      const tokenBefore = store.apiTokens.get(scenario.apiToken.id);
      const lastUsedBefore = tokenBefore?.lastUsedAt;

      // Make a request
      const request = createOperatorRequest(
        "http://localhost:3000/api/operator/policies",
        scenario.rawToken
      );

      await getPolicies(request);

      // Verify lastUsedAt was updated (via the mock)
      expect(mockDb.apiToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: scenario.apiToken.id },
          data: expect.objectContaining({ lastUsedAt: expect.any(Date) }),
        })
      );
    });
  });

  // ==========================================================================
  // Multiple Token Tests
  // ==========================================================================

  describe("Multiple Tokens", () => {
    it("should allow same cluster to have multiple valid tokens", async () => {
      const org = testFactories.organization(store, { name: "Test Org" });
      const user = testFactories.user(store, { organizationId: org.id });
      const cluster = testFactories.cluster(store, { organizationId: org.id });

      // Create two tokens for the same cluster
      const { rawToken: token1 } = testFactories.apiToken(store, {
        name: "Token 1",
        organizationId: org.id,
        clusterId: cluster.id,
        scopes: ["policy:read"],
      });

      const { rawToken: token2 } = testFactories.apiToken(store, {
        name: "Token 2",
        organizationId: org.id,
        clusterId: cluster.id,
        scopes: ["policy:read"],
      });

      // Create a policy
      testFactories.policy(store, {
        organizationId: org.id,
        clusterId: cluster.id,
        createdById: user.id,
        status: "PENDING",
      });

      // Both tokens should work
      const request1 = createOperatorRequest(
        "http://localhost:3000/api/operator/policies",
        token1
      );
      const response1 = await getPolicies(request1);
      expect(response1.status).toBe(200);

      const request2 = createOperatorRequest(
        "http://localhost:3000/api/operator/policies",
        token2
      );
      const response2 = await getPolicies(request2);
      expect(response2.status).toBe(200);
    });

    it("should allow revoking one token without affecting others", async () => {
      const org = testFactories.organization(store, { name: "Test Org" });
      const user = testFactories.user(store, { organizationId: org.id });
      const cluster = testFactories.cluster(store, { organizationId: org.id });

      // Create two tokens
      const token1Data = testFactories.apiToken(store, {
        name: "Token 1",
        organizationId: org.id,
        clusterId: cluster.id,
        scopes: ["policy:read"],
      });

      const { rawToken: token2 } = testFactories.apiToken(store, {
        name: "Token 2",
        organizationId: org.id,
        clusterId: cluster.id,
        scopes: ["policy:read"],
      });

      // Create a policy
      testFactories.policy(store, {
        organizationId: org.id,
        clusterId: cluster.id,
        createdById: user.id,
        status: "PENDING",
      });

      // Revoke token 1
      const token1 = store.apiTokens.get(token1Data.id);
      if (token1) {
        token1.revokedAt = new Date();
        store.apiTokens.set(token1.id, token1);
      }

      // Token 1 should fail
      const request1 = createOperatorRequest(
        "http://localhost:3000/api/operator/policies",
        token1Data.rawToken
      );
      const response1 = await getPolicies(request1);
      expect(response1.status).toBe(401);

      // Token 2 should still work
      const request2 = createOperatorRequest(
        "http://localhost:3000/api/operator/policies",
        token2
      );
      const response2 = await getPolicies(request2);
      expect(response2.status).toBe(200);
    });
  });
});
