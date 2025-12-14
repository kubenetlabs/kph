import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...\n");

  // Create organization (matching mock ID in tRPC context)
  const org = await prisma.organization.upsert({
    where: { id: "org_demo" },
    update: {},
    create: {
      id: "org_demo",
      name: "Acme Corporation",
      slug: "acme-corp",
    },
  });
  console.log(`✓ Organization: ${org.name}`);

  // Create user (matching mock ID in tRPC context)
  const user = await prisma.user.upsert({
    where: { id: "user_demo" },
    update: {},
    create: {
      id: "user_demo",
      email: "admin@acme.corp",
      name: "Demo Admin",
      role: "ADMIN",
      organizationId: org.id,
    },
  });
  console.log(`✓ User: ${user.name} (${user.email})`);

  // Create clusters
  const clusters = await Promise.all([
    prisma.cluster.upsert({
      where: { id: "cluster_prod_east" },
      update: {},
      create: {
        id: "cluster_prod_east",
        name: "prod-us-east",
        description: "Production workloads - US East region",
        provider: "AWS",
        region: "us-east-1",
        environment: "PRODUCTION",
        status: "CONNECTED",
        endpoint: "https://prod-east.k8s.acme.corp:6443",
        operatorInstalled: true,
        operatorVersion: "1.2.0",
        lastHeartbeat: new Date(),
        kubernetesVersion: "1.28.4",
        nodeCount: 24,
        namespaceCount: 18,
        organizationId: org.id,
      },
    }),
    prisma.cluster.upsert({
      where: { id: "cluster_prod_west" },
      update: {},
      create: {
        id: "cluster_prod_west",
        name: "prod-us-west",
        description: "Production workloads - US West region",
        provider: "AWS",
        region: "us-west-2",
        environment: "PRODUCTION",
        status: "CONNECTED",
        endpoint: "https://prod-west.k8s.acme.corp:6443",
        operatorInstalled: true,
        operatorVersion: "1.2.0",
        lastHeartbeat: new Date(),
        kubernetesVersion: "1.28.4",
        nodeCount: 18,
        namespaceCount: 12,
        organizationId: org.id,
      },
    }),
    prisma.cluster.upsert({
      where: { id: "cluster_staging" },
      update: {},
      create: {
        id: "cluster_staging",
        name: "staging-us-west",
        description: "Staging environment for pre-production testing",
        provider: "AWS",
        region: "us-west-2",
        environment: "STAGING",
        status: "CONNECTED",
        endpoint: "https://staging.k8s.acme.corp:6443",
        operatorInstalled: true,
        operatorVersion: "1.2.0",
        lastHeartbeat: new Date(),
        kubernetesVersion: "1.29.0",
        nodeCount: 8,
        namespaceCount: 10,
        organizationId: org.id,
      },
    }),
    prisma.cluster.upsert({
      where: { id: "cluster_dev" },
      update: {},
      create: {
        id: "cluster_dev",
        name: "dev-local",
        description: "Development cluster for testing",
        provider: "OTHER",
        region: "local",
        environment: "DEVELOPMENT",
        status: "CONNECTED",
        endpoint: "https://localhost:6443",
        operatorInstalled: true,
        operatorVersion: "1.2.0",
        lastHeartbeat: new Date(),
        kubernetesVersion: "1.29.0",
        nodeCount: 3,
        namespaceCount: 5,
        organizationId: org.id,
      },
    }),
  ]);
  console.log(`✓ Clusters: ${clusters.map((c) => c.name).join(", ")}`);

  // Create policies with various types and statuses
  const policies = [
    {
      id: "policy_frontend_ingress",
      name: "frontend-ingress",
      description: "HTTP routing for frontend services with path-based routing",
      type: "GATEWAY_HTTPROUTE" as const,
      status: "DEPLOYED" as const,
      clusterId: "cluster_prod_east",
      targetNamespaces: ["frontend", "web"],
      deployedAt: new Date("2024-03-10T14:30:00"),
      deployedVersion: 2,
      content: `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: frontend-ingress
  namespace: frontend
spec:
  parentRefs:
    - name: main-gateway
      namespace: gateway-system
  hostnames:
    - "app.acme.corp"
    - "www.acme.corp"
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /
      backendRefs:
        - name: frontend-service
          port: 80
          weight: 100`,
    },
    {
      id: "policy_api_network",
      name: "api-network-policy",
      description: "Restrict API pod communication to allowed services only",
      type: "CILIUM_NETWORK" as const,
      status: "SIMULATING" as const,
      clusterId: "cluster_prod_east",
      targetNamespaces: ["api"],
      content: `apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: api-network-policy
  namespace: api
spec:
  endpointSelector:
    matchLabels:
      app: api-server
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: frontend
        - matchLabels:
            app: gateway
      toPorts:
        - ports:
            - port: "8080"
              protocol: TCP
  egress:
    - toEndpoints:
        - matchLabels:
            app: database
      toPorts:
        - ports:
            - port: "5432"
              protocol: TCP
    - toEndpoints:
        - matchLabels:
            app: cache
      toPorts:
        - ports:
            - port: "6379"
              protocol: TCP`,
    },
    {
      id: "policy_runtime_exec",
      name: "runtime-exec-audit",
      description: "Audit all exec calls in production pods for security monitoring",
      type: "TETRAGON" as const,
      status: "DRAFT" as const,
      clusterId: "cluster_staging",
      targetNamespaces: [],
      content: `apiVersion: cilium.io/v1alpha1
kind: TracingPolicy
metadata:
  name: runtime-exec-audit
spec:
  kprobes:
    - call: "sys_execve"
      syscall: true
      args:
        - index: 0
          type: "string"
      selectors:
        - matchNamespaces:
            - namespace: production
              operator: In
        - matchNamespaces:
            - namespace: api
              operator: In`,
    },
    {
      id: "policy_db_isolation",
      name: "database-isolation",
      description: "Clusterwide policy for database namespace isolation",
      type: "CILIUM_CLUSTERWIDE" as const,
      status: "DEPLOYED" as const,
      clusterId: "cluster_prod_east",
      targetNamespaces: [],
      deployedAt: new Date("2024-03-01T09:00:00"),
      deployedVersion: 1,
      content: `apiVersion: "cilium.io/v2"
kind: CiliumClusterwideNetworkPolicy
metadata:
  name: database-isolation
spec:
  endpointSelector:
    matchLabels:
      tier: database
  ingress:
    - fromEndpoints:
        - matchLabels:
            tier: backend
      toPorts:
        - ports:
            - port: "5432"
              protocol: TCP
            - port: "3306"
              protocol: TCP
  egress:
    - toEntities:
        - cluster`,
    },
    {
      id: "policy_grpc_api",
      name: "grpc-api-route",
      description: "gRPC routing for internal microservices communication",
      type: "GATEWAY_GRPCROUTE" as const,
      status: "DEPLOYED" as const,
      clusterId: "cluster_prod_west",
      targetNamespaces: ["services"],
      deployedAt: new Date("2024-03-05T11:00:00"),
      deployedVersion: 1,
      content: `apiVersion: gateway.networking.k8s.io/v1alpha2
kind: GRPCRoute
metadata:
  name: grpc-api-route
  namespace: services
spec:
  parentRefs:
    - name: grpc-gateway
      namespace: gateway-system
  hostnames:
    - "grpc.internal.acme.corp"
  rules:
    - matches:
        - method:
            service: user.UserService
      backendRefs:
        - name: user-service
          port: 9090
    - matches:
        - method:
            service: order.OrderService
      backendRefs:
        - name: order-service
          port: 9090`,
    },
    {
      id: "policy_deny_external",
      name: "deny-external-egress",
      description: "Block all external egress traffic from sensitive namespaces",
      type: "CILIUM_NETWORK" as const,
      status: "PENDING" as const,
      clusterId: "cluster_prod_east",
      targetNamespaces: ["payments", "pii-data"],
      content: `apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: deny-external-egress
  namespace: payments
spec:
  endpointSelector: {}
  egress:
    - toEntities:
        - cluster
    - toEndpoints:
        - matchLabels:
            k8s:io.kubernetes.pod.namespace: kube-system
      toPorts:
        - ports:
            - port: "53"
              protocol: UDP`,
    },
    {
      id: "policy_file_integrity",
      name: "file-integrity-monitor",
      description: "Monitor file modifications in sensitive directories",
      type: "TETRAGON" as const,
      status: "DEPLOYED" as const,
      clusterId: "cluster_prod_east",
      targetNamespaces: ["security"],
      deployedAt: new Date("2024-02-20T16:00:00"),
      deployedVersion: 3,
      content: `apiVersion: cilium.io/v1alpha1
kind: TracingPolicy
metadata:
  name: file-integrity-monitor
spec:
  kprobes:
    - call: "security_file_open"
      syscall: false
      args:
        - index: 0
          type: "file"
      selectors:
        - matchArgs:
            - index: 0
              operator: "Prefix"
              values:
                - "/etc/"
                - "/var/run/secrets/"`,
    },
    {
      id: "policy_tcp_database",
      name: "tcp-database-route",
      description: "TCP routing for external database connections",
      type: "GATEWAY_TCPROUTE" as const,
      status: "DRAFT" as const,
      clusterId: "cluster_staging",
      targetNamespaces: ["database"],
      content: `apiVersion: gateway.networking.k8s.io/v1alpha2
kind: TCPRoute
metadata:
  name: tcp-database-route
  namespace: database
spec:
  parentRefs:
    - name: tcp-gateway
      namespace: gateway-system
      sectionName: postgres
  rules:
    - backendRefs:
        - name: postgres-primary
          port: 5432`,
    },
    {
      id: "policy_ai_generated",
      name: "ai-suggested-policy",
      description: "Auto-generated policy for frontend to API communication",
      type: "CILIUM_NETWORK" as const,
      status: "DRAFT" as const,
      clusterId: "cluster_dev",
      targetNamespaces: ["frontend", "api"],
      generatedFrom: "Allow frontend pods to communicate with API service on port 8080",
      generatedModel: "claude-3-sonnet",
      content: `apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: ai-suggested-policy
  namespace: frontend
spec:
  description: "Allow frontend pods to communicate with API service on port 8080"
  endpointSelector:
    matchLabels:
      app: frontend
  egress:
    - toEndpoints:
        - matchLabels:
            app: api
            k8s:io.kubernetes.pod.namespace: api
      toPorts:
        - ports:
            - port: "8080"
              protocol: TCP`,
    },
    {
      id: "policy_failed",
      name: "misconfigured-policy",
      description: "Policy that failed deployment due to invalid selector",
      type: "CILIUM_NETWORK" as const,
      status: "FAILED" as const,
      clusterId: "cluster_staging",
      targetNamespaces: ["test"],
      content: `apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: misconfigured-policy
  namespace: test
spec:
  endpointSelector:
    matchLabels:
      app: nonexistent-app
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: source`,
    },
  ];

  for (const policy of policies) {
    const created = await prisma.policy.upsert({
      where: { id: policy.id },
      update: {},
      create: {
        id: policy.id,
        name: policy.name,
        description: policy.description,
        type: policy.type,
        status: policy.status,
        content: policy.content,
        targetNamespaces: policy.targetNamespaces,
        deployedAt: policy.deployedAt,
        deployedVersion: policy.deployedVersion,
        generatedFrom: policy.generatedFrom,
        generatedModel: policy.generatedModel,
        organizationId: org.id,
        clusterId: policy.clusterId,
        createdById: user.id,
      },
    });

    // Create initial version
    await prisma.policyVersion.upsert({
      where: {
        policyId_version: {
          policyId: created.id,
          version: 1,
        },
      },
      update: {},
      create: {
        policyId: created.id,
        version: 1,
        content: policy.content,
        changelog: "Initial version",
      },
    });

    console.log(`✓ Policy: ${created.name} (${created.status})`);
  }

  // Create some simulations for deployed policies
  const simulations = [
    {
      id: "sim_api_network",
      name: "API Network Policy Simulation",
      description: "Testing API network policy against last 24h of traffic",
      status: "COMPLETED" as const,
      policyId: "policy_api_network",
      clusterId: "cluster_prod_east",
      startTime: new Date(Date.now() - 24 * 60 * 60 * 1000),
      endTime: new Date(),
      flowsAnalyzed: 15420,
      flowsAllowed: 14850,
      flowsDenied: 520,
      flowsChanged: 50,
      completedAt: new Date(),
    },
    {
      id: "sim_db_isolation",
      name: "Database Isolation Verification",
      description: "Verify database isolation policy effectiveness",
      status: "COMPLETED" as const,
      policyId: "policy_db_isolation",
      clusterId: "cluster_prod_east",
      startTime: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      endTime: new Date(),
      flowsAnalyzed: 89234,
      flowsAllowed: 88100,
      flowsDenied: 1134,
      flowsChanged: 0,
      completedAt: new Date(),
    },
  ];

  for (const sim of simulations) {
    await prisma.simulation.upsert({
      where: { id: sim.id },
      update: {},
      create: {
        id: sim.id,
        name: sim.name,
        description: sim.description,
        status: sim.status,
        startTime: sim.startTime,
        endTime: sim.endTime,
        flowsAnalyzed: sim.flowsAnalyzed,
        flowsAllowed: sim.flowsAllowed,
        flowsDenied: sim.flowsDenied,
        flowsChanged: sim.flowsChanged,
        completedAt: sim.completedAt,
        organizationId: org.id,
        clusterId: sim.clusterId,
        policyId: sim.policyId,
        runnerId: user.id,
      },
    });
    console.log(`✓ Simulation: ${sim.name}`);
  }

  console.log("\n✅ Seeding complete!");
  console.log(`
Summary:
  - 1 Organization
  - 1 User
  - ${clusters.length} Clusters
  - ${policies.length} Policies
  - ${simulations.length} Simulations
  `);
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
