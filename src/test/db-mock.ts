import { vi, type Mock } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockFn = Mock<(...args: any[]) => any>;

// Type for a mocked Prisma model
interface MockPrismaModel {
  findFirst: MockFn;
  findUnique: MockFn;
  findMany: MockFn;
  create: MockFn;
  update: MockFn;
  delete: MockFn;
  count: MockFn;
  upsert: MockFn;
}

// Type for the mock database
export interface MockPrismaClient {
  policy: MockPrismaModel;
  policyVersion: MockPrismaModel;
  policyDeployment: MockPrismaModel;
  cluster: MockPrismaModel;
  organization: MockPrismaModel;
  user: MockPrismaModel;
  auditLog: MockPrismaModel;
  flowSummary: MockPrismaModel;
  processSummary: MockPrismaModel;
  validationSummary: MockPrismaModel;
  simulation: MockPrismaModel;
  simulationResult: MockPrismaModel;
}

// Create a deep mock of the Prisma client
export function createMockPrismaClient(): MockPrismaClient {
  const mockMethods = (): MockPrismaModel => ({
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
    upsert: vi.fn(),
  });

  return {
    policy: mockMethods(),
    policyVersion: mockMethods(),
    policyDeployment: mockMethods(),
    cluster: mockMethods(),
    organization: mockMethods(),
    user: mockMethods(),
    auditLog: mockMethods(),
    flowSummary: mockMethods(),
    processSummary: mockMethods(),
    validationSummary: mockMethods(),
    simulation: mockMethods(),
    simulationResult: mockMethods(),
  };
}

// Factory functions for creating test data
export const factories = {
  organization: (overrides = {}) => ({
    id: "org-1",
    name: "Test Organization",
    slug: "test-org",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }),

  user: (overrides = {}) => ({
    id: "user-1",
    email: "test@example.com",
    name: "Test User",
    organizationId: "org-1",
    role: "ADMIN" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }),

  cluster: (overrides = {}) => ({
    id: "cluster-1",
    name: "test-cluster",
    provider: "EKS",
    region: "us-west-2",
    organizationId: "org-1",
    apiToken: "test-token",
    status: "CONNECTED" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }),

  policy: (overrides = {}) => ({
    id: "policy-1",
    name: "test-policy",
    type: "CILIUM_NETWORK" as const,
    status: "DRAFT" as const,
    organizationId: "org-1",
    clusterId: "cluster-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    deployedVersion: null,
    deployedAt: null,
    ...overrides,
  }),

  policyVersion: (overrides = {}) => ({
    id: "version-1",
    policyId: "policy-1",
    version: 1,
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
    changelog: "Initial version",
    createdAt: new Date(),
    ...overrides,
  }),

  policyDeployment: (overrides = {}) => ({
    id: "deployment-1",
    policyId: "policy-1",
    versionId: "version-1",
    clusterId: "cluster-1",
    deployedById: "user-1",
    status: "PENDING" as const,
    retryCount: 0,
    maxRetries: 3,
    requestedAt: new Date(),
    startedAt: null,
    completedAt: null,
    errorMessage: null,
    errorDetails: null,
    resourceName: null,
    resourceNamespace: null,
    lastRetryAt: null,
    previousDeploymentId: null,
    ...overrides,
  }),
};

// Helper to set up common mock returns
export function setupMockReturns(
  mockDb: MockPrismaClient,
  data: {
    organization?: ReturnType<typeof factories.organization>;
    user?: ReturnType<typeof factories.user>;
    cluster?: ReturnType<typeof factories.cluster>;
    policy?: ReturnType<typeof factories.policy>;
    policyVersion?: ReturnType<typeof factories.policyVersion>;
    policyDeployment?: ReturnType<typeof factories.policyDeployment>;
  }
) {
  if (data.organization) {
    mockDb.organization.findFirst.mockResolvedValue(data.organization);
    mockDb.organization.findUnique.mockResolvedValue(data.organization);
  }
  if (data.user) {
    mockDb.user.findFirst.mockResolvedValue(data.user);
    mockDb.user.findUnique.mockResolvedValue(data.user);
  }
  if (data.cluster) {
    mockDb.cluster.findFirst.mockResolvedValue(data.cluster);
    mockDb.cluster.findUnique.mockResolvedValue(data.cluster);
  }
  if (data.policy) {
    mockDb.policy.findFirst.mockResolvedValue(data.policy);
    mockDb.policy.findUnique.mockResolvedValue(data.policy);
  }
  if (data.policyVersion) {
    mockDb.policyVersion.findFirst.mockResolvedValue(data.policyVersion);
    mockDb.policyVersion.findUnique.mockResolvedValue(data.policyVersion);
  }
  if (data.policyDeployment) {
    mockDb.policyDeployment.findFirst.mockResolvedValue(data.policyDeployment);
    mockDb.policyDeployment.findUnique.mockResolvedValue(data.policyDeployment);
  }
}
