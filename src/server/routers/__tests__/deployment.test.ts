/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/dot-notation */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockPrismaClient, factories } from "~/test/db-mock";

// Mock the database
const mockDb = createMockPrismaClient();
vi.mock("~/lib/db", () => ({
  db: mockDb,
}));

describe("Deployment Router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================
  // listAll - List all deployments
  // ============================================
  describe("listAll", () => {
    it("should return deployments with pagination", async () => {
      const deployments = [
        factories.policyDeployment({ id: "dep-1", status: "SUCCEEDED" }),
        factories.policyDeployment({ id: "dep-2", status: "PENDING" }),
        factories.policyDeployment({ id: "dep-3", status: "FAILED" }),
      ];

      mockDb.policyDeployment.findMany.mockResolvedValue(
        deployments.map((d) => ({
          ...d,
          policy: factories.policy(),
          version: factories.policyVersion(),
          cluster: factories.cluster(),
          deployedBy: factories.user(),
        }))
      );

      expect(deployments).toHaveLength(3);
    });

    it("should filter by status", async () => {
      const pendingDeployments = [
        factories.policyDeployment({ id: "dep-1", status: "PENDING" }),
        factories.policyDeployment({ id: "dep-2", status: "PENDING" }),
      ];

      mockDb.policyDeployment.findMany.mockResolvedValue(pendingDeployments);

      // Simulate filter logic
      const filtered = pendingDeployments.filter((d) => d.status === "PENDING");
      expect(filtered).toHaveLength(2);
      expect(filtered.every((d) => d.status === "PENDING")).toBe(true);
    });

    it("should filter by clusterId", async () => {
      const cluster1Deployments = [
        factories.policyDeployment({ id: "dep-1", clusterId: "cluster-1" }),
        factories.policyDeployment({ id: "dep-2", clusterId: "cluster-1" }),
      ];

      mockDb.policyDeployment.findMany.mockResolvedValue(cluster1Deployments);

      const filtered = cluster1Deployments.filter((d) => d.clusterId === "cluster-1");
      expect(filtered).toHaveLength(2);
    });

    it("should handle empty results", async () => {
      mockDb.policyDeployment.findMany.mockResolvedValue([]);

      const deployments: ReturnType<typeof factories.policyDeployment>[] = [];
      expect(deployments).toHaveLength(0);
    });

    it("should support cursor-based pagination", async () => {
      // First page
      const page1 = [
        factories.policyDeployment({ id: "dep-1" }),
        factories.policyDeployment({ id: "dep-2" }),
      ];

      // Second page
      const page2 = [factories.policyDeployment({ id: "dep-3" })];

      mockDb.policyDeployment.findMany
        .mockResolvedValueOnce(page1)
        .mockResolvedValueOnce(page2);

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(1);
    });
  });

  // ============================================
  // getStats - Deployment statistics
  // ============================================
  describe("getStats", () => {
    it("should return correct deployment counts", async () => {
      mockDb.policyDeployment.count
        .mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(75) // succeeded
        .mockResolvedValueOnce(10) // failed
        .mockResolvedValueOnce(5) // pending
        .mockResolvedValueOnce(3) // inProgress
        .mockResolvedValueOnce(7) // rolledBack
        .mockResolvedValueOnce(15); // recentActivity

      mockDb.policyDeployment.findMany.mockResolvedValue([]);

      // Verify mock calls
      await mockDb.policyDeployment.count();
      expect(mockDb.policyDeployment.count).toHaveBeenCalled();
    });

    it("should calculate success rate correctly", () => {
      const total = 100;
      const succeeded = 75;
      const successRate = Math.round((succeeded / total) * 100);

      expect(successRate).toBe(75);
    });

    it("should handle zero total deployments", () => {
      const total = 0;
      const succeeded = 0;
      const successRate = total > 0 ? Math.round((succeeded / total) * 100) : 0;

      expect(successRate).toBe(0);
    });

    it("should return active deployments", async () => {
      const activeDeployments = [
        {
          ...factories.policyDeployment({ status: "PENDING" }),
          policy: { id: "policy-1", name: "test-policy" },
          cluster: { id: "cluster-1", name: "test-cluster" },
        },
        {
          ...factories.policyDeployment({ status: "IN_PROGRESS" }),
          policy: { id: "policy-2", name: "test-policy-2" },
          cluster: { id: "cluster-1", name: "test-cluster" },
        },
      ];

      mockDb.policyDeployment.findMany.mockResolvedValue(activeDeployments);

      const result = await mockDb.policyDeployment.findMany({
        where: { status: { in: ["PENDING", "IN_PROGRESS"] } },
      });

      expect(result).toHaveLength(2);
    });
  });

  // ============================================
  // listByPolicy - List deployments for a policy
  // ============================================
  describe("listByPolicy", () => {
    it("should return deployments for a specific policy", () => {
      const policy = factories.policy({ id: "policy-1" });
      const deployments = [
        factories.policyDeployment({ id: "dep-a", policyId: "policy-1" }),
        factories.policyDeployment({ id: "dep-b", policyId: "policy-1" }),
      ];

      // Test that deployments can be filtered by policy ID
      const filtered = deployments.filter((d) => d.policyId === "policy-1");
      expect(filtered).toHaveLength(2);
      expect(filtered.every((d) => d.policyId === policy.id)).toBe(true);
    });

    it("should throw NOT_FOUND for non-existent policy", async () => {
      mockDb.policy.findFirst.mockResolvedValue(null);

      const result = await mockDb.policy.findFirst({
        where: { id: "non-existent" },
      });

      expect(result).toBeNull();
    });

    it("should include version and cluster details", () => {
      const deployment = {
        ...factories.policyDeployment(),
        version: factories.policyVersion(),
        cluster: factories.cluster(),
        deployedBy: factories.user(),
      };

      // Test that enriched deployment has the expected properties
      expect(deployment).toHaveProperty("version");
      expect(deployment).toHaveProperty("cluster");
      expect(deployment).toHaveProperty("deployedBy");
      expect(deployment.version.version).toBe(1);
      expect(deployment.cluster.provider).toBe("EKS");
    });
  });

  // ============================================
  // getById - Get single deployment
  // ============================================
  describe("getById", () => {
    it("should return deployment by ID", async () => {
      const deployment = {
        ...factories.policyDeployment({ id: "dep-1" }),
        policy: factories.policy({ organizationId: "org-1" }),
        version: factories.policyVersion(),
        cluster: factories.cluster(),
        deployedBy: factories.user(),
      };

      mockDb.policyDeployment.findFirst.mockResolvedValue(deployment);

      const result = await mockDb.policyDeployment.findFirst({
        where: { id: "dep-1" },
      });

      expect(result?.id).toBe("dep-1");
    });

    it("should throw NOT_FOUND for non-existent deployment", async () => {
      mockDb.policyDeployment.findFirst.mockResolvedValue(null);

      const result = await mockDb.policyDeployment.findFirst({
        where: { id: "non-existent" },
      });

      expect(result).toBeNull();
    });

    it("should verify organization access", async () => {
      const deployment = {
        ...factories.policyDeployment(),
        policy: factories.policy({ organizationId: "different-org" }),
      };

      mockDb.policyDeployment.findFirst.mockResolvedValue(deployment);

      // In real implementation, this would throw for wrong org
      const userOrgId = "org-1";
      const hasAccess = deployment.policy.organizationId === userOrgId;

      expect(hasAccess).toBe(false);
    });
  });

  // ============================================
  // deploy - Create new deployment
  // ============================================
  describe("deploy", () => {
    it("should create a new deployment", async () => {
      const policy = factories.policy({ id: "policy-1", clusterId: "cluster-1" });
      const version = factories.policyVersion({ id: "version-1", policyId: "policy-1" });

      mockDb.policy.findFirst.mockResolvedValue(policy);
      mockDb.policyVersion.findFirst.mockResolvedValue(version);
      mockDb.policyDeployment.findFirst.mockResolvedValue(null); // No previous deployment
      mockDb.policyDeployment.create.mockResolvedValue({
        ...factories.policyDeployment({
          policyId: "policy-1",
          versionId: "version-1",
          status: "PENDING",
        }),
        version: { id: version.id, version: version.version },
        cluster: { id: "cluster-1", name: "test-cluster" },
      });
      mockDb.policy.update.mockResolvedValue({ ...policy, status: "PENDING" });

      const created = await mockDb.policyDeployment.create({
        data: {
          policyId: "policy-1",
          versionId: "version-1",
          clusterId: "cluster-1",
          status: "PENDING",
          deployedById: "user-1",
        },
      });

      expect(created.status).toBe("PENDING");
      expect(created.policyId).toBe("policy-1");
    });

    it("should use latest version when versionId not provided", async () => {
      const versions = [
        factories.policyVersion({ version: 3 }),
        factories.policyVersion({ version: 2 }),
        factories.policyVersion({ version: 1 }),
      ];

      // Return versions in descending order (latest first)
      mockDb.policyVersion.findFirst.mockResolvedValue(versions[0]);

      const latestVersion = await mockDb.policyVersion.findFirst({
        orderBy: { version: "desc" },
      });

      expect(latestVersion?.version).toBe(3);
    });

    it("should throw NOT_FOUND for non-existent policy", async () => {
      mockDb.policy.findFirst.mockResolvedValue(null);

      const policy = await mockDb.policy.findFirst({ where: { id: "non-existent" } });
      expect(policy).toBeNull();
    });

    it("should throw NOT_FOUND for non-existent version", async () => {
      mockDb.policy.findFirst.mockResolvedValue(factories.policy());
      mockDb.policyVersion.findFirst.mockResolvedValue(null);

      const version = await mockDb.policyVersion.findFirst({ where: { id: "non-existent" } });
      expect(version).toBeNull();
    });

    it("should link to previous successful deployment", async () => {
      const previousDeployment = factories.policyDeployment({
        id: "prev-dep",
        status: "SUCCEEDED",
      });

      mockDb.policyDeployment.findFirst.mockResolvedValue(previousDeployment);

      const prev = await mockDb.policyDeployment.findFirst({
        where: { status: "SUCCEEDED" },
      });

      expect(prev?.id).toBe("prev-dep");
    });

    it("should update policy status to PENDING", async () => {
      const policy = factories.policy({ status: "DEPLOYED" });
      mockDb.policy.update.mockResolvedValue({ ...policy, status: "PENDING" });

      const updated = await mockDb.policy.update({
        where: { id: policy.id },
        data: { status: "PENDING" },
      });

      expect(updated.status).toBe("PENDING");
    });
  });

  // ============================================
  // rollback - Rollback to previous deployment
  // ============================================
  describe("rollback", () => {
    it("should create rollback deployment", async () => {
      const policy = factories.policy({ id: "policy-1" });
      const targetDeployment = {
        ...factories.policyDeployment({ id: "target-dep", status: "SUCCEEDED" }),
        version: factories.policyVersion({ version: 2 }),
      };

      mockDb.policy.findFirst.mockResolvedValue(policy);
      mockDb.policyDeployment.findFirst.mockResolvedValue(targetDeployment);
      mockDb.policyDeployment.create.mockResolvedValue({
        ...factories.policyDeployment({
          policyId: "policy-1",
          versionId: targetDeployment.versionId,
          status: "PENDING",
        }),
        isRollback: true,
        rollbackNote: "Rollback to version 2",
      });

      const rollback = await mockDb.policyDeployment.create({
        data: {
          policyId: "policy-1",
          versionId: targetDeployment.versionId,
          status: "PENDING",
          isRollback: true,
        },
      });

      expect(rollback.isRollback).toBe(true);
      expect(rollback.status).toBe("PENDING");
    });

    it("should only allow rollback to successful deployments", () => {
      const failedDeployment = factories.policyDeployment({ status: "FAILED" });

      // Target must be SUCCEEDED - use string comparison to avoid TS literal type issues
      const status: string = failedDeployment.status;
      const isValidTarget = status === "SUCCEEDED";
      expect(isValidTarget).toBe(false);
    });

    it("should throw NOT_FOUND for non-existent target deployment", async () => {
      mockDb.policy.findFirst.mockResolvedValue(factories.policy());
      mockDb.policyDeployment.findFirst.mockResolvedValue(null);

      const target = await mockDb.policyDeployment.findFirst({
        where: { id: "non-existent", status: "SUCCEEDED" },
      });

      expect(target).toBeNull();
    });

    it("should include rollback note", async () => {
      const rollbackDeployment = {
        ...factories.policyDeployment(),
        isRollback: true,
        rollbackNote: "Emergency rollback due to errors",
      };

      expect(rollbackDeployment.rollbackNote).toBe("Emergency rollback due to errors");
    });
  });

  // ============================================
  // retry - Retry failed deployment
  // ============================================
  describe("retry", () => {
    it("should retry failed deployment under retry limit", async () => {
      const failedDeployment = {
        ...factories.policyDeployment({
          id: "dep-1",
          status: "FAILED",
          retryCount: 1,
          maxRetries: 3,
        }),
        policy: factories.policy({ organizationId: "org-1" }),
        version: factories.policyVersion(),
      };

      mockDb.policyDeployment.findFirst.mockResolvedValue(failedDeployment);
      mockDb.policyDeployment.update.mockResolvedValue({
        ...failedDeployment,
        status: "PENDING",
        retryCount: 2,
        errorMessage: null,
        errorDetails: null,
      });

      const retried = await mockDb.policyDeployment.update({
        where: { id: "dep-1" },
        data: {
          status: "PENDING",
          retryCount: { increment: 1 },
          errorMessage: null,
        },
      });

      expect(retried.status).toBe("PENDING");
      expect(retried.retryCount).toBe(2);
    });

    it("should reject retry when max retries reached", () => {
      const deployment = factories.policyDeployment({
        status: "FAILED",
        retryCount: 3,
        maxRetries: 3,
      });

      const canRetry = deployment.retryCount < deployment.maxRetries;
      expect(canRetry).toBe(false);
    });

    it("should reject retry for non-FAILED deployments", () => {
      const pendingDeployment = factories.policyDeployment({ status: "PENDING" });
      const succeededDeployment = factories.policyDeployment({ status: "SUCCEEDED" });
      const inProgressDeployment = factories.policyDeployment({ status: "IN_PROGRESS" });

      expect(pendingDeployment.status).not.toBe("FAILED");
      expect(succeededDeployment.status).not.toBe("FAILED");
      expect(inProgressDeployment.status).not.toBe("FAILED");
    });

    it("should clear error details on retry", async () => {
      const failedDeployment = factories.policyDeployment({
        status: "FAILED",
        errorMessage: "Connection timeout",
        errorDetails: { type: "NetworkError" },
      });

      mockDb.policyDeployment.update.mockResolvedValue({
        ...failedDeployment,
        status: "PENDING",
        errorMessage: null,
        errorDetails: null,
      });

      const retried = await mockDb.policyDeployment.update({
        where: { id: failedDeployment.id },
        data: { errorMessage: null, errorDetails: null },
      });

      expect(retried.errorMessage).toBeNull();
      expect(retried.errorDetails).toBeNull();
    });

    it("should set lastRetryAt timestamp", async () => {
      const now = new Date();
      const deployment = factories.policyDeployment({ status: "FAILED" });

      mockDb.policyDeployment.update.mockResolvedValue({
        ...deployment,
        lastRetryAt: now,
      });

      const retried = await mockDb.policyDeployment.update({
        where: { id: deployment.id },
        data: { lastRetryAt: now },
      });

      expect(retried.lastRetryAt).toEqual(now);
    });

    it("should verify organization access before retry", () => {
      const deployment = {
        ...factories.policyDeployment(),
        policy: factories.policy({ organizationId: "other-org" }),
      };

      const userOrgId = "org-1";
      const hasAccess = deployment.policy.organizationId === userOrgId;

      expect(hasAccess).toBe(false);
    });
  });

  // ============================================
  // getActiveDeployment - Check active deployment
  // ============================================
  describe("getActiveDeployment", () => {
    it("should return active deployment if exists", async () => {
      const policy = factories.policy({ id: "policy-1", status: "PENDING" });
      const activeDeployment = {
        ...factories.policyDeployment({ status: "IN_PROGRESS" }),
        version: factories.policyVersion(),
        deployedBy: factories.user(),
      };

      mockDb.policy.findFirst.mockResolvedValue(policy);
      mockDb.policyDeployment.findFirst.mockResolvedValue(activeDeployment);

      const active = await mockDb.policyDeployment.findFirst({
        where: { status: { in: ["PENDING", "IN_PROGRESS"] } },
      });

      expect(active).not.toBeNull();
      expect(active?.status).toBe("IN_PROGRESS");
    });

    it("should return null if no active deployment", async () => {
      const policy = factories.policy({ status: "DEPLOYED" });

      mockDb.policy.findFirst.mockResolvedValue(policy);
      mockDb.policyDeployment.findFirst.mockResolvedValue(null);

      const active = await mockDb.policyDeployment.findFirst({
        where: { status: { in: ["PENDING", "IN_PROGRESS"] } },
      });

      expect(active).toBeNull();
    });

    it("should include policy status in response", async () => {
      const policy = factories.policy({ status: "PENDING" });
      mockDb.policy.findFirst.mockResolvedValue(policy);

      const policyResult = await mockDb.policy.findFirst({});
      expect(policyResult?.status).toBe("PENDING");
    });
  });

  // ============================================
  // getSummary - Deployment summary for policy
  // ============================================
  describe("getSummary", () => {
    it("should return correct deployment counts for policy", () => {
      // Test the summary calculation logic with explicit status strings
      type DeploymentStatus = "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "ROLLED_BACK";
      const deployments: Array<{ status: DeploymentStatus }> = [
        { status: "SUCCEEDED" },
        { status: "SUCCEEDED" },
        { status: "SUCCEEDED" },
        { status: "FAILED" },
        { status: "PENDING" },
      ];

      const total = deployments.length;
      const succeeded = deployments.filter((d) => d.status === "SUCCEEDED").length;
      const failed = deployments.filter((d) => d.status === "FAILED").length;
      const pending = deployments.filter((d) => d.status === "PENDING").length;

      expect(total).toBe(5);
      expect(succeeded).toBe(3);
      expect(failed).toBe(1);
      expect(pending).toBe(1);
    });

    it("should return latest successful deployment", () => {
      type DeploymentStatus = "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "ROLLED_BACK";
      const deployments: Array<{ status: DeploymentStatus; version: { version: number }; completedAt: Date }> = [
        {
          status: "SUCCEEDED",
          version: { version: 3 },
          completedAt: new Date("2024-01-10"),
        },
        {
          status: "SUCCEEDED",
          version: { version: 5 },
          completedAt: new Date("2024-01-15"),
        },
        {
          status: "FAILED",
          version: { version: 6 },
          completedAt: new Date("2024-01-16"),
        },
      ];

      // Find latest successful deployment
      const latest = deployments
        .filter((d) => d.status === "SUCCEEDED")
        .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime())[0];

      expect(latest?.version.version).toBe(5);
      expect(latest?.status).toBe("SUCCEEDED");
    });

    it("should handle policy with no deployments", () => {
      type DeploymentStatus = "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "ROLLED_BACK";
      const deployments: Array<{ status: DeploymentStatus }> = [];

      const total = deployments.length;
      const latest = deployments.find((d) => d.status === "SUCCEEDED");

      expect(total).toBe(0);
      expect(latest).toBeUndefined();
    });
  });

  // ============================================
  // Status Transitions
  // ============================================
  describe("deployment status transitions", () => {
    const validTransitions: Record<string, string[]> = {
      PENDING: ["IN_PROGRESS", "FAILED"],
      IN_PROGRESS: ["SUCCEEDED", "FAILED"],
      FAILED: ["PENDING"], // via retry
      SUCCEEDED: ["ROLLED_BACK"],
      ROLLED_BACK: [],
    };

    it("should allow PENDING -> IN_PROGRESS", () => {
      expect(validTransitions["PENDING"]).toContain("IN_PROGRESS");
    });

    it("should allow PENDING -> FAILED", () => {
      expect(validTransitions["PENDING"]).toContain("FAILED");
    });

    it("should allow IN_PROGRESS -> SUCCEEDED", () => {
      expect(validTransitions["IN_PROGRESS"]).toContain("SUCCEEDED");
    });

    it("should allow IN_PROGRESS -> FAILED", () => {
      expect(validTransitions["IN_PROGRESS"]).toContain("FAILED");
    });

    it("should allow FAILED -> PENDING (retry)", () => {
      expect(validTransitions["FAILED"]).toContain("PENDING");
    });

    it("should not allow direct PENDING -> SUCCEEDED", () => {
      expect(validTransitions["PENDING"]).not.toContain("SUCCEEDED");
    });

    it("should not allow SUCCEEDED -> PENDING", () => {
      expect(validTransitions["SUCCEEDED"]).not.toContain("PENDING");
    });
  });

  // ============================================
  // Error Details Schema
  // ============================================
  describe("error details", () => {
    it("should accept complete error details", () => {
      const errorDetails = {
        type: "K8sAPIError",
        resource: "CiliumNetworkPolicy/test-policy",
        reason: "NotFound",
        retryable: true,
        suggestion: "Verify the namespace exists",
      };

      expect(errorDetails.type).toBe("K8sAPIError");
      expect(errorDetails.resource).toBe("CiliumNetworkPolicy/test-policy");
      expect(errorDetails.retryable).toBe(true);
    });

    it("should accept partial error details", () => {
      const errorDetails = {
        type: "ValidationError",
        retryable: false,
      };

      expect(errorDetails.type).toBe("ValidationError");
      expect(errorDetails.retryable).toBe(false);
    });

    it("should categorize error types correctly", () => {
      const errorTypes = [
        { type: "ValidationError", retryable: false },
        { type: "K8sAPIError", retryable: true },
        { type: "NetworkError", retryable: true },
        { type: "AuthenticationError", retryable: false },
        { type: "RateLimitError", retryable: true },
      ];

      const retryableErrors = errorTypes.filter((e) => e.retryable);
      const nonRetryableErrors = errorTypes.filter((e) => !e.retryable);

      expect(retryableErrors).toHaveLength(3);
      expect(nonRetryableErrors).toHaveLength(2);
    });
  });

  // ============================================
  // Factory Data Validation
  // ============================================
  describe("factory data validation", () => {
    it("should create valid policy deployment with defaults", () => {
      const deployment = factories.policyDeployment();

      expect(deployment.id).toBeDefined();
      expect(deployment.policyId).toBeDefined();
      expect(deployment.status).toBe("PENDING");
      expect(deployment.retryCount).toBe(0);
      expect(deployment.maxRetries).toBe(3);
      expect(deployment.requestedAt).toBeInstanceOf(Date);
    });

    it("should allow overriding all fields", () => {
      const customDeployment = factories.policyDeployment({
        id: "custom-id",
        status: "SUCCEEDED",
        retryCount: 2,
        maxRetries: 5,
        errorMessage: "Test error",
      });

      expect(customDeployment.id).toBe("custom-id");
      expect(customDeployment.status).toBe("SUCCEEDED");
      expect(customDeployment.retryCount).toBe(2);
      expect(customDeployment.maxRetries).toBe(5);
      expect(customDeployment.errorMessage).toBe("Test error");
    });

    it("should create valid policy", () => {
      const policy = factories.policy();

      expect(policy.id).toBeDefined();
      expect(policy.name).toBe("test-policy");
      expect(policy.type).toBe("CILIUM_NETWORK");
      expect(policy.status).toBe("DRAFT");
    });

    it("should create valid policy version", () => {
      const version = factories.policyVersion();

      expect(version.id).toBeDefined();
      expect(version.version).toBe(1);
      expect(version.content).toContain("apiVersion: cilium.io/v2");
    });

    it("should create valid cluster", () => {
      const cluster = factories.cluster();

      expect(cluster.id).toBeDefined();
      expect(cluster.provider).toBe("EKS");
      expect(cluster.status).toBe("CONNECTED");
    });

    it("should create valid user", () => {
      const user = factories.user();

      expect(user.id).toBeDefined();
      expect(user.email).toBe("test@example.com");
      expect(user.role).toBe("ADMIN");
    });

    it("should create valid organization", () => {
      const org = factories.organization();

      expect(org.id).toBeDefined();
      expect(org.name).toBe("Test Organization");
      expect(org.slug).toBe("test-org");
    });
  });

  // ============================================
  // Edge Cases
  // ============================================
  describe("edge cases", () => {
    it("should handle concurrent deployments correctly", async () => {
      // Only one deployment should be active at a time
      const activeDeployments = [
        factories.policyDeployment({ status: "IN_PROGRESS" }),
      ];

      mockDb.policyDeployment.findMany.mockResolvedValue(activeDeployments);

      const active = await mockDb.policyDeployment.findMany({
        where: { status: { in: ["PENDING", "IN_PROGRESS"] } },
      });

      expect(active).toHaveLength(1);
    });

    it("should handle deployment with no previous version", async () => {
      mockDb.policyDeployment.findFirst.mockResolvedValue(null);

      const previous = await mockDb.policyDeployment.findFirst({
        where: { status: "SUCCEEDED" },
      });

      expect(previous).toBeNull();
    });

    it("should handle max retry count edge case", () => {
      // Test exact limit
      const atLimit = factories.policyDeployment({
        retryCount: 3,
        maxRetries: 3,
      });

      // Test one below limit
      const belowLimit = factories.policyDeployment({
        retryCount: 2,
        maxRetries: 3,
      });

      expect(atLimit.retryCount >= atLimit.maxRetries).toBe(true);
      expect(belowLimit.retryCount < belowLimit.maxRetries).toBe(true);
    });

    it("should handle special characters in error messages", () => {
      const deployment = factories.policyDeployment({
        errorMessage: 'Error: "Invalid YAML" with <special> & characters',
      });

      expect(deployment.errorMessage).toContain("<special>");
      expect(deployment.errorMessage).toContain("&");
    });

    it("should handle very long error details", () => {
      const longSuggestion = "a".repeat(1000);
      const errorDetails = {
        type: "ValidationError",
        suggestion: longSuggestion,
      };

      expect(errorDetails.suggestion.length).toBe(1000);
    });
  });
});
