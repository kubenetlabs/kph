/**
 * Integration Test Helpers
 *
 * Provides utilities for API-level integration tests that simulate
 * the operator-to-SaaS communication flow.
 */

import { vi } from "vitest";
import { NextRequest } from "next/server";
import crypto from "crypto";

// ============================================================================
// STATEFUL MOCK DATABASE
// ============================================================================

/**
 * In-memory database store for integration tests.
 * Tracks state across multiple operations to simulate real database behavior.
 */
export interface TestDatabaseStore {
  organizations: Map<string, TestOrganization>;
  users: Map<string, TestUser>;
  clusters: Map<string, TestCluster>;
  policies: Map<string, TestPolicy>;
  policyVersions: Map<string, TestPolicyVersion>;
  policyDeployments: Map<string, TestPolicyDeployment>;
  apiTokens: Map<string, TestApiToken>;
  auditLogs: TestAuditLog[];
}

export interface TestOrganization {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TestUser {
  id: string;
  email: string;
  name: string | null;
  role: "ADMIN" | "OPERATOR" | "VIEWER";
  organizationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TestCluster {
  id: string;
  name: string;
  description: string | null;
  provider: "AWS" | "GCP" | "AZURE" | "ON_PREM" | "OTHER";
  region: string;
  environment: "PRODUCTION" | "STAGING" | "DEVELOPMENT" | "TESTING";
  status: "PENDING" | "CONNECTED" | "DEGRADED" | "DISCONNECTED" | "ERROR";
  endpoint: string;
  operatorInstalled: boolean;
  operatorVersion: string | null;
  operatorId: string | null;
  lastHeartbeat: Date | null;
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TestPolicy {
  id: string;
  name: string;
  description: string | null;
  type: "CILIUM_NETWORK" | "CILIUM_CLUSTERWIDE" | "TETRAGON" | "GATEWAY_HTTPROUTE" | "GATEWAY_GRPCROUTE" | "GATEWAY_TCPROUTE" | "GATEWAY_TLSROUTE";
  status: "DRAFT" | "SIMULATING" | "PENDING" | "DEPLOYED" | "UNDEPLOYING" | "FAILED" | "ARCHIVED";
  content: string;
  targetNamespaces: string[];
  clusterId: string;
  organizationId: string;
  createdById: string;
  deployedAt: Date | null;
  deployedVersion: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TestPolicyVersion {
  id: string;
  policyId: string;
  version: number;
  content: string;
  changelog: string | null;
  createdAt: Date;
}

export interface TestPolicyDeployment {
  id: string;
  policyId: string;
  versionId: string;
  clusterId: string;
  deployedById: string;
  status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "ROLLED_BACK" | "UNDEPLOYING" | "UNDEPLOYED";
  resourceName: string | null;
  resourceNamespace: string | null;
  resourceVersion: string | null;
  previousDeploymentId: string | null;
  isRollback: boolean;
  rollbackNote: string | null;
  errorMessage: string | null;
  errorDetails: Record<string, unknown> | null;
  retryCount: number;
  maxRetries: number;
  lastRetryAt: Date | null;
  requestedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TestApiToken {
  id: string;
  name: string;
  tokenHash: string;
  prefix: string;
  scopes: string[];
  clusterId: string | null;
  organizationId: string;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface TestAuditLog {
  id: string;
  action: string;
  resource: string;
  resourceId: string | null;
  details: Record<string, unknown> | null;
  organizationId: string;
  timestamp: Date;
}

/**
 * Creates a fresh test database store.
 */
export function createTestDatabase(): TestDatabaseStore {
  return {
    organizations: new Map(),
    users: new Map(),
    clusters: new Map(),
    policies: new Map(),
    policyVersions: new Map(),
    policyDeployments: new Map(),
    apiTokens: new Map(),
    auditLogs: [],
  };
}

// ============================================================================
// TEST DATA FACTORIES
// ============================================================================

let idCounter = 0;
function generateId(prefix: string): string {
  return `${prefix}-${++idCounter}-${Date.now()}`;
}

export const testFactories = {
  organization: (store: TestDatabaseStore, overrides: Partial<TestOrganization> = {}): TestOrganization => {
    const org: TestOrganization = {
      id: generateId("org"),
      name: "Test Organization",
      slug: `test-org-${idCounter}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
    store.organizations.set(org.id, org);
    return org;
  },

  user: (store: TestDatabaseStore, overrides: Partial<TestUser> = {}): TestUser => {
    const user: TestUser = {
      id: generateId("user"),
      email: `test-${idCounter}@example.com`,
      name: "Test User",
      role: "ADMIN",
      organizationId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
    store.users.set(user.id, user);
    return user;
  },

  cluster: (store: TestDatabaseStore, overrides: Partial<TestCluster> = {}): TestCluster => {
    const cluster: TestCluster = {
      id: generateId("cluster"),
      name: `test-cluster-${idCounter}`,
      description: null,
      provider: "AWS",
      region: "us-west-2",
      environment: "DEVELOPMENT",
      status: "CONNECTED",
      endpoint: "https://k8s.example.com",
      operatorInstalled: true,
      operatorVersion: "1.0.0",
      operatorId: generateId("op"),
      lastHeartbeat: new Date(),
      organizationId: "",
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
    store.clusters.set(cluster.id, cluster);
    return cluster;
  },

  policy: (store: TestDatabaseStore, overrides: Partial<TestPolicy> = {}): TestPolicy => {
    const policy: TestPolicy = {
      id: generateId("policy"),
      name: `test-policy-${idCounter}`,
      description: null,
      type: "CILIUM_NETWORK",
      status: "DRAFT",
      content: `apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: test-policy
spec:
  endpointSelector:
    matchLabels:
      app: test
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: frontend`,
      targetNamespaces: [],
      clusterId: "",
      organizationId: "",
      createdById: "",
      deployedAt: null,
      deployedVersion: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
    store.policies.set(policy.id, policy);
    return policy;
  },

  policyVersion: (store: TestDatabaseStore, overrides: Partial<TestPolicyVersion> = {}): TestPolicyVersion => {
    const version: TestPolicyVersion = {
      id: generateId("version"),
      policyId: "",
      version: 1,
      content: `apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: test-policy
spec:
  endpointSelector:
    matchLabels:
      app: test`,
      changelog: "Initial version",
      createdAt: new Date(),
      ...overrides,
    };
    store.policyVersions.set(version.id, version);
    return version;
  },

  policyDeployment: (store: TestDatabaseStore, overrides: Partial<TestPolicyDeployment> = {}): TestPolicyDeployment => {
    const deployment: TestPolicyDeployment = {
      id: generateId("deployment"),
      policyId: "",
      versionId: "",
      clusterId: "",
      deployedById: "",
      status: "PENDING",
      resourceName: null,
      resourceNamespace: null,
      resourceVersion: null,
      previousDeploymentId: null,
      isRollback: false,
      rollbackNote: null,
      errorMessage: null,
      errorDetails: null,
      retryCount: 0,
      maxRetries: 3,
      lastRetryAt: null,
      requestedAt: new Date(),
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
    store.policyDeployments.set(deployment.id, deployment);
    return deployment;
  },

  apiToken: (store: TestDatabaseStore, overrides: Partial<TestApiToken> & { rawToken?: string } = {}): TestApiToken & { rawToken: string } => {
    const rawToken = overrides.rawToken ?? `phub_${crypto.randomBytes(32).toString("base64url")}`;
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    // Build token object - tokenHash must be computed from rawToken, not from overrides
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { tokenHash: _ignoredTokenHash, ...safeOverrides } = overrides;
    const token: TestApiToken = {
      id: generateId("token"),
      name: "Test Token",
      tokenHash,
      prefix: rawToken.substring(0, 12),
      scopes: ["policy:read", "policy:write", "flow:write"],
      clusterId: null,
      organizationId: "",
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date(),
      ...safeOverrides,
    };
    store.apiTokens.set(token.id, token);
    return { ...token, rawToken };
  },
};

// ============================================================================
// STATEFUL MOCK PRISMA CLIENT
// ============================================================================

/**
 * Creates a Prisma client mock that uses the test database store.
 * This allows tests to verify actual data state changes.
 */
export function createStatefulMockPrisma(store: TestDatabaseStore) {
  return {
    organization: {
      findFirst: vi.fn().mockImplementation(({ where }: { where?: { id?: string; slug?: string } }) => {
        if (where?.id) return store.organizations.get(where.id) ?? null;
        if (where?.slug) {
          return Array.from(store.organizations.values()).find(o => o.slug === where.slug) ?? null;
        }
        return Array.from(store.organizations.values())[0] ?? null;
      }),
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id?: string; slug?: string } }) => {
        if (where.id) return store.organizations.get(where.id) ?? null;
        if (where.slug) {
          return Array.from(store.organizations.values()).find(o => o.slug === where.slug) ?? null;
        }
        return null;
      }),
    },

    user: {
      findFirst: vi.fn().mockImplementation(({ where }: { where?: { id?: string; email?: string } }) => {
        if (where?.id) return store.users.get(where.id) ?? null;
        if (where?.email) {
          return Array.from(store.users.values()).find(u => u.email === where.email) ?? null;
        }
        return Array.from(store.users.values())[0] ?? null;
      }),
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id?: string; email?: string } }) => {
        if (where.id) return store.users.get(where.id) ?? null;
        if (where.email) {
          return Array.from(store.users.values()).find(u => u.email === where.email) ?? null;
        }
        return null;
      }),
    },

    cluster: {
      findFirst: vi.fn().mockImplementation(({ where }: { where?: { id?: string; organizationId?: string } }) => {
        if (where?.id) return store.clusters.get(where.id) ?? null;
        const clusters = Array.from(store.clusters.values());
        if (where?.organizationId) {
          return clusters.find(c => c.organizationId === where.organizationId) ?? null;
        }
        return clusters[0] ?? null;
      }),
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        return store.clusters.get(where.id) ?? null;
      }),
      update: vi.fn().mockImplementation(({ where, data }: { where: { id: string }; data: Partial<TestCluster> }) => {
        const cluster = store.clusters.get(where.id);
        if (!cluster) return null;
        const updated = { ...cluster, ...data, updatedAt: new Date() };
        store.clusters.set(where.id, updated);
        return updated;
      }),
    },

    policy: {
      findFirst: vi.fn().mockImplementation(({ where }: { where?: { id?: string; clusterId?: string; status?: { in?: string[] } } }) => {
        const policies = Array.from(store.policies.values());
        if (where?.id && where?.clusterId) {
          return policies.find(p => p.id === where.id && p.clusterId === where.clusterId) ?? null;
        }
        if (where?.id) return store.policies.get(where.id) ?? null;
        if (where?.clusterId) {
          return policies.find(p => p.clusterId === where.clusterId) ?? null;
        }
        return policies[0] ?? null;
      }),
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        return store.policies.get(where.id) ?? null;
      }),
      findMany: vi.fn().mockImplementation(({ where }: { where?: { clusterId?: string; status?: { in?: string[] } } } = {}) => {
        let policies = Array.from(store.policies.values());
        if (where?.clusterId) {
          policies = policies.filter(p => p.clusterId === where.clusterId);
        }
        if (where?.status?.in) {
          policies = policies.filter(p => where.status!.in!.includes(p.status));
        }
        return policies;
      }),
      update: vi.fn().mockImplementation(({ where, data }: { where: { id: string }; data: Partial<TestPolicy> }) => {
        const policy = store.policies.get(where.id);
        if (!policy) return null;
        const updated = { ...policy, ...data, updatedAt: new Date() };
        store.policies.set(where.id, updated);
        return updated;
      }),
      create: vi.fn().mockImplementation(({ data }: { data: Partial<TestPolicy> }) => {
        const policy = testFactories.policy(store, data);
        return policy;
      }),
    },

    policyVersion: {
      findFirst: vi.fn().mockImplementation(({ where, orderBy }: { where?: { policyId?: string; id?: string }; orderBy?: { version?: string } }) => {
        let versions = Array.from(store.policyVersions.values());
        if (where?.policyId) {
          versions = versions.filter(v => v.policyId === where.policyId);
        }
        if (where?.id) {
          return store.policyVersions.get(where.id) ?? null;
        }
        if (orderBy?.version === "desc") {
          versions.sort((a, b) => b.version - a.version);
        }
        return versions[0] ?? null;
      }),
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        return store.policyVersions.get(where.id) ?? null;
      }),
    },

    policyDeployment: {
      findFirst: vi.fn().mockImplementation(({ where, orderBy }: { where?: { id?: string; policyId?: string; status?: string | { in?: string[] } }; orderBy?: { requestedAt?: string } }) => {
        let deployments = Array.from(store.policyDeployments.values());
        if (where?.policyId) {
          deployments = deployments.filter(d => d.policyId === where.policyId);
        }
        if (where?.id) {
          return store.policyDeployments.get(where.id) ?? null;
        }
        if (typeof where?.status === "string") {
          deployments = deployments.filter(d => d.status === where.status);
        } else if (where?.status && typeof where.status === "object" && "in" in where.status && where.status.in) {
          const statusList = where.status.in;
          deployments = deployments.filter(d => statusList.includes(d.status));
        }
        if (orderBy?.requestedAt === "desc") {
          deployments.sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());
        }
        return deployments[0] ?? null;
      }),
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        return store.policyDeployments.get(where.id) ?? null;
      }),
      findMany: vi.fn().mockImplementation(({ where }: { where?: { policyId?: string; status?: { in?: string[] } } } = {}) => {
        let deployments = Array.from(store.policyDeployments.values());
        if (where?.policyId) {
          deployments = deployments.filter(d => d.policyId === where.policyId);
        }
        if (where?.status?.in) {
          deployments = deployments.filter(d => where.status!.in!.includes(d.status));
        }
        return deployments;
      }),
      update: vi.fn().mockImplementation(({ where, data }: { where: { id: string }; data: Partial<TestPolicyDeployment> }) => {
        const deployment = store.policyDeployments.get(where.id);
        if (!deployment) return null;
        const updated = { ...deployment, ...data, updatedAt: new Date() };
        store.policyDeployments.set(where.id, updated);
        return updated;
      }),
      create: vi.fn().mockImplementation(({ data }: { data: Partial<TestPolicyDeployment> }) => {
        const deployment = testFactories.policyDeployment(store, data);
        return deployment;
      }),
    },

    apiToken: {
      findUnique: vi.fn().mockImplementation(({ where, include }: { where: { id?: string; tokenHash?: string }; include?: { cluster?: boolean; organization?: boolean } }) => {
        let token: TestApiToken | undefined;
        if (where.id) {
          token = store.apiTokens.get(where.id);
        } else if (where.tokenHash) {
          token = Array.from(store.apiTokens.values()).find(t => t.tokenHash === where.tokenHash);
        }
        if (!token) return null;

        const result: Record<string, unknown> = { ...token };
        if (include?.cluster && token.clusterId) {
          result.cluster = store.clusters.get(token.clusterId);
        }
        if (include?.organization) {
          result.organization = store.organizations.get(token.organizationId);
        }
        return result;
      }),
      update: vi.fn().mockImplementation(({ where, data }: { where: { id: string }; data: Partial<TestApiToken> }) => {
        const token = store.apiTokens.get(where.id);
        if (!token) return null;
        const updated = { ...token, ...data };
        store.apiTokens.set(where.id, updated);
        return updated;
      }),
    },

    auditLog: {
      create: vi.fn().mockImplementation(({ data }: { data: Partial<TestAuditLog> }) => {
        const log: TestAuditLog = {
          id: generateId("audit"),
          action: data.action ?? "",
          resource: data.resource ?? "",
          resourceId: data.resourceId ?? null,
          details: data.details ?? null,
          organizationId: data.organizationId ?? "",
          timestamp: new Date(),
        };
        store.auditLogs.push(log);
        return log;
      }),
    },
  };
}

// ============================================================================
// API REQUEST HELPERS
// ============================================================================

/**
 * Creates a NextRequest object for testing API routes.
 */
export function createTestRequest(
  url: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {}
): NextRequest {
  const { method = "GET", body, headers = {} } = options;

  const requestHeaders = new Headers(headers);

  if (body !== undefined) {
    requestHeaders.set("Content-Type", "application/json");
  }

  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method,
    headers: requestHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/**
 * Creates an authenticated operator request.
 */
export function createOperatorRequest(
  url: string,
  token: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {}
): NextRequest {
  return createTestRequest(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  });
}

// ============================================================================
// TEST SCENARIO HELPERS
// ============================================================================

/**
 * Sets up a complete test scenario with organization, user, cluster, and token.
 */
export function setupTestScenario(store: TestDatabaseStore) {
  const org = testFactories.organization(store, {
    name: "Integration Test Org",
    slug: "integration-test-org",
  });

  const user = testFactories.user(store, {
    organizationId: org.id,
    email: "operator@test.com",
    role: "OPERATOR",
  });

  const cluster = testFactories.cluster(store, {
    organizationId: org.id,
    name: "test-cluster",
    status: "CONNECTED",
  });

  const { rawToken, ...apiToken } = testFactories.apiToken(store, {
    organizationId: org.id,
    clusterId: cluster.id,
    scopes: ["policy:read", "policy:write", "flow:write"],
  });

  return { org, user, cluster, apiToken, rawToken };
}

/**
 * Creates a policy with a version, ready for deployment.
 */
export function createDeployablePolicy(
  store: TestDatabaseStore,
  scenario: ReturnType<typeof setupTestScenario>,
  overrides: Partial<TestPolicy> = {}
) {
  const policy = testFactories.policy(store, {
    organizationId: scenario.org.id,
    clusterId: scenario.cluster.id,
    createdById: scenario.user.id,
    status: "DRAFT",
    ...overrides,
  });

  const version = testFactories.policyVersion(store, {
    policyId: policy.id,
    version: 1,
    content: policy.content,
  });

  return { policy, version };
}

/**
 * Creates a deployment for a policy.
 */
export function createTestDeployment(
  store: TestDatabaseStore,
  scenario: ReturnType<typeof setupTestScenario>,
  policy: TestPolicy,
  version: TestPolicyVersion,
  overrides: Partial<TestPolicyDeployment> = {}
) {
  const deployment = testFactories.policyDeployment(store, {
    policyId: policy.id,
    versionId: version.id,
    clusterId: scenario.cluster.id,
    deployedById: scenario.user.id,
    status: "PENDING",
    ...overrides,
  });

  // Update policy status
  policy.status = "PENDING";
  store.policies.set(policy.id, policy);

  return deployment;
}

// ============================================================================
// RESET HELPERS
// ============================================================================

/**
 * Resets the ID counter between tests.
 */
export function resetIdCounter(): void {
  idCounter = 0;
}
