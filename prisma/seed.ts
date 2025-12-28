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

  // Create Policy Packs for Marketplace
  console.log("\n📦 Creating Policy Packs...");

  const policyPacks = [
    // Community Packs
    {
      id: "pack_microservices_baseline",
      slug: "microservices-baseline",
      name: "Microservices Baseline",
      description: "Essential network policies for microservices architectures. Includes default deny policies, service-to-service communication patterns, and ingress controls.",
      tier: "COMMUNITY" as const,
      category: "WORKLOAD" as const,
      version: "1.0.0",
      tags: ["microservices", "default-deny", "ingress", "egress"],
      isPublished: true,
      policies: [
        {
          name: "default-deny-ingress",
          description: "Deny all ingress traffic by default",
          policyType: "CILIUM_NETWORK" as const,
          yamlContent: `apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: default-deny-ingress
spec:
  endpointSelector: {}
  ingress:
    - {}`,
          order: 1,
        },
        {
          name: "default-deny-egress",
          description: "Deny all egress traffic by default, allow DNS",
          policyType: "CILIUM_NETWORK" as const,
          yamlContent: `apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: default-deny-egress
spec:
  endpointSelector: {}
  egress:
    - toEndpoints:
        - matchLabels:
            k8s:io.kubernetes.pod.namespace: kube-system
            k8s-app: kube-dns
      toPorts:
        - ports:
            - port: "53"
              protocol: UDP`,
          order: 2,
        },
        {
          name: "allow-same-namespace",
          description: "Allow pods within the same namespace to communicate",
          policyType: "CILIUM_NETWORK" as const,
          yamlContent: `apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: allow-same-namespace
spec:
  endpointSelector: {}
  ingress:
    - fromEndpoints:
        - {}
  egress:
    - toEndpoints:
        - {}`,
          order: 3,
        },
      ],
    },
    {
      id: "pack_database_isolation",
      slug: "database-tier-isolation",
      name: "Database Tier Isolation",
      description: "Secure network policies for database workloads including PostgreSQL, MySQL, and Redis. Restricts access to database pods from authorized services only.",
      tier: "COMMUNITY" as const,
      category: "SECURITY" as const,
      version: "1.0.0",
      tags: ["database", "postgresql", "mysql", "redis", "isolation"],
      isPublished: true,
      policies: [
        {
          name: "postgresql-access",
          description: "Restrict PostgreSQL access to backend services",
          policyType: "CILIUM_NETWORK" as const,
          yamlContent: `apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: postgresql-access
spec:
  endpointSelector:
    matchLabels:
      app: postgresql
  ingress:
    - fromEndpoints:
        - matchLabels:
            tier: backend
      toPorts:
        - ports:
            - port: "5432"
              protocol: TCP`,
          order: 1,
        },
        {
          name: "mysql-access",
          description: "Restrict MySQL access to backend services",
          policyType: "CILIUM_NETWORK" as const,
          yamlContent: `apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: mysql-access
spec:
  endpointSelector:
    matchLabels:
      app: mysql
  ingress:
    - fromEndpoints:
        - matchLabels:
            tier: backend
      toPorts:
        - ports:
            - port: "3306"
              protocol: TCP`,
          order: 2,
        },
        {
          name: "redis-access",
          description: "Restrict Redis access to backend and cache clients",
          policyType: "CILIUM_NETWORK" as const,
          yamlContent: `apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: redis-access
spec:
  endpointSelector:
    matchLabels:
      app: redis
  ingress:
    - fromEndpoints:
        - matchLabels:
            tier: backend
        - matchLabels:
            tier: cache-client
      toPorts:
        - ports:
            - port: "6379"
              protocol: TCP`,
          order: 3,
        },
      ],
    },
    {
      id: "pack_api_gateway",
      slug: "api-gateway-patterns",
      name: "API Gateway Patterns",
      description: "Network policies for API gateway and north-south traffic patterns. Secure ingress from external load balancers and route to internal services.",
      tier: "COMMUNITY" as const,
      category: "WORKLOAD" as const,
      version: "1.0.0",
      tags: ["api-gateway", "ingress", "north-south", "load-balancer"],
      isPublished: true,
      policies: [
        {
          name: "gateway-ingress",
          description: "Allow external traffic to API gateway",
          policyType: "CILIUM_NETWORK" as const,
          yamlContent: `apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: gateway-ingress
spec:
  endpointSelector:
    matchLabels:
      app: api-gateway
  ingress:
    - fromEntities:
        - world
      toPorts:
        - ports:
            - port: "443"
              protocol: TCP
            - port: "80"
              protocol: TCP`,
          order: 1,
        },
        {
          name: "gateway-to-services",
          description: "Allow gateway to reach internal API services",
          policyType: "CILIUM_NETWORK" as const,
          yamlContent: `apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: gateway-to-services
spec:
  endpointSelector:
    matchLabels:
      app: api-gateway
  egress:
    - toEndpoints:
        - matchLabels:
            tier: api
      toPorts:
        - ports:
            - port: "8080"
              protocol: TCP`,
          order: 2,
        },
        {
          name: "api-from-gateway",
          description: "Allow API services to receive traffic from gateway only",
          policyType: "CILIUM_NETWORK" as const,
          yamlContent: `apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: api-from-gateway
spec:
  endpointSelector:
    matchLabels:
      tier: api
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: api-gateway
      toPorts:
        - ports:
            - port: "8080"
              protocol: TCP`,
          order: 3,
        },
      ],
    },
    {
      id: "pack_observability",
      slug: "observability-stack",
      name: "Observability Stack",
      description: "Network policies for monitoring and observability tools including Prometheus, Grafana, and OpenTelemetry collectors.",
      tier: "COMMUNITY" as const,
      category: "WORKLOAD" as const,
      version: "1.0.0",
      tags: ["prometheus", "grafana", "opentelemetry", "monitoring", "observability"],
      isPublished: true,
      policies: [
        {
          name: "prometheus-scrape",
          description: "Allow Prometheus to scrape metrics from all pods",
          policyType: "CILIUM_CLUSTERWIDE" as const,
          yamlContent: `apiVersion: "cilium.io/v2"
kind: CiliumClusterwideNetworkPolicy
metadata:
  name: prometheus-scrape
spec:
  endpointSelector: {}
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: prometheus
      toPorts:
        - ports:
            - port: "9090"
              protocol: TCP
            - port: "9091"
              protocol: TCP`,
          order: 1,
        },
        {
          name: "grafana-access",
          description: "Allow Grafana to query Prometheus and Loki",
          policyType: "CILIUM_NETWORK" as const,
          yamlContent: `apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: grafana-access
spec:
  endpointSelector:
    matchLabels:
      app: grafana
  egress:
    - toEndpoints:
        - matchLabels:
            app: prometheus
      toPorts:
        - ports:
            - port: "9090"
              protocol: TCP
    - toEndpoints:
        - matchLabels:
            app: loki
      toPorts:
        - ports:
            - port: "3100"
              protocol: TCP`,
          order: 2,
        },
        {
          name: "otel-collector",
          description: "Allow OpenTelemetry collector to receive and export telemetry",
          policyType: "CILIUM_NETWORK" as const,
          yamlContent: `apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: otel-collector
spec:
  endpointSelector:
    matchLabels:
      app: otel-collector
  ingress:
    - fromEntities:
        - cluster
      toPorts:
        - ports:
            - port: "4317"
              protocol: TCP
            - port: "4318"
              protocol: TCP
  egress:
    - toEntities:
        - world
      toPorts:
        - ports:
            - port: "443"
              protocol: TCP`,
          order: 3,
        },
      ],
    },
    // Enterprise Packs
    {
      id: "pack_soc2",
      slug: "soc2-network-controls",
      name: "SOC2 Network Controls",
      description: "Comprehensive network policies aligned with SOC2 Trust Services Criteria. Covers CC6.1 logical access controls with full audit trail support.",
      tier: "ENTERPRISE" as const,
      category: "COMPLIANCE" as const,
      complianceFramework: "SOC2",
      auditorName: "Deloitte",
      certificationDate: new Date("2024-01-15"),
      version: "2.1.0",
      tags: ["soc2", "compliance", "audit", "access-control"],
      isPublished: true,
      policies: [
        {
          name: "cc6-1-network-segmentation",
          description: "Network segmentation for logical access boundaries",
          policyType: "CILIUM_CLUSTERWIDE" as const,
          controlIds: ["CC6.1.1", "CC6.1.2"],
          yamlContent: `apiVersion: "cilium.io/v2"
kind: CiliumClusterwideNetworkPolicy
metadata:
  name: cc6-1-network-segmentation
spec:
  endpointSelector:
    matchLabels:
      compliance: soc2
  ingress:
    - fromEndpoints:
        - matchLabels:
            compliance: soc2
  egress:
    - toEndpoints:
        - matchLabels:
            compliance: soc2`,
          order: 1,
        },
        {
          name: "cc6-1-pii-isolation",
          description: "Isolate PII data processing from general workloads",
          policyType: "CILIUM_NETWORK" as const,
          controlIds: ["CC6.1.3", "CC6.1.4"],
          yamlContent: `apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: cc6-1-pii-isolation
spec:
  endpointSelector:
    matchLabels:
      data-classification: pii
  ingress:
    - fromEndpoints:
        - matchLabels:
            pii-authorized: "true"
      toPorts:
        - ports:
            - port: "443"
              protocol: TCP`,
          order: 2,
        },
        {
          name: "cc6-1-audit-logging",
          description: "Ensure all network flows to sensitive systems are logged",
          policyType: "TETRAGON" as const,
          controlIds: ["CC6.1.5"],
          yamlContent: `apiVersion: cilium.io/v1alpha1
kind: TracingPolicy
metadata:
  name: cc6-1-audit-logging
spec:
  kprobes:
    - call: "tcp_connect"
      syscall: false
      args:
        - index: 0
          type: "sock"
      selectors:
        - matchLabels:
            compliance: soc2`,
          order: 3,
        },
      ],
    },
    {
      id: "pack_pci_dss",
      slug: "pci-dss-segmentation",
      name: "PCI-DSS Network Segmentation",
      description: "Network policies for PCI-DSS compliant cardholder data environments. Implements strict segmentation between CDE and non-CDE networks.",
      tier: "ENTERPRISE" as const,
      category: "COMPLIANCE" as const,
      complianceFramework: "PCI-DSS",
      auditorName: "PwC",
      certificationDate: new Date("2024-02-01"),
      version: "4.0.1",
      tags: ["pci-dss", "payment", "cardholder", "segmentation"],
      isPublished: true,
      policies: [
        {
          name: "cde-isolation",
          description: "Isolate Cardholder Data Environment from other networks",
          policyType: "CILIUM_CLUSTERWIDE" as const,
          controlIds: ["1.3.1", "1.3.2"],
          yamlContent: `apiVersion: "cilium.io/v2"
kind: CiliumClusterwideNetworkPolicy
metadata:
  name: cde-isolation
spec:
  endpointSelector:
    matchLabels:
      pci-zone: cde
  ingress:
    - fromEndpoints:
        - matchLabels:
            pci-zone: cde
        - matchLabels:
            pci-authorized: "true"
  egress:
    - toEndpoints:
        - matchLabels:
            pci-zone: cde`,
          order: 1,
        },
        {
          name: "payment-gateway-access",
          description: "Restrict payment gateway to authorized services only",
          policyType: "CILIUM_NETWORK" as const,
          controlIds: ["1.3.3", "1.3.4"],
          yamlContent: `apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: payment-gateway-access
spec:
  endpointSelector:
    matchLabels:
      app: payment-gateway
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: checkout-service
      toPorts:
        - ports:
            - port: "443"
              protocol: TCP
  egress:
    - toEntities:
        - world
      toPorts:
        - ports:
            - port: "443"
              protocol: TCP`,
          order: 2,
        },
        {
          name: "pan-data-encryption",
          description: "Monitor access to PAN data storage",
          policyType: "TETRAGON" as const,
          controlIds: ["3.4", "3.5"],
          yamlContent: `apiVersion: cilium.io/v1alpha1
kind: TracingPolicy
metadata:
  name: pan-data-encryption
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
                - "/var/data/pan/"`,
          order: 3,
        },
      ],
    },
    {
      id: "pack_dora",
      slug: "dora-ict-risk",
      name: "DORA ICT Risk Management",
      description: "Network policies for EU Digital Operational Resilience Act compliance. Covers ICT risk management and third-party service provider controls.",
      tier: "ENTERPRISE" as const,
      category: "COMPLIANCE" as const,
      complianceFramework: "DORA",
      auditorName: "KPMG",
      certificationDate: new Date("2024-03-01"),
      version: "1.0.0",
      tags: ["dora", "eu-regulation", "ict-risk", "resilience"],
      isPublished: true,
      policies: [
        {
          name: "third-party-isolation",
          description: "Isolate third-party service integrations",
          policyType: "CILIUM_NETWORK" as const,
          controlIds: ["Art.28", "Art.29"],
          yamlContent: `apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: third-party-isolation
spec:
  endpointSelector:
    matchLabels:
      integration-type: third-party
  egress:
    - toFQDNs:
        - matchPattern: "*.approved-vendor.com"
      toPorts:
        - ports:
            - port: "443"
              protocol: TCP`,
          order: 1,
        },
        {
          name: "critical-function-protection",
          description: "Protect critical business functions with strict access controls",
          policyType: "CILIUM_CLUSTERWIDE" as const,
          controlIds: ["Art.9", "Art.10"],
          yamlContent: `apiVersion: "cilium.io/v2"
kind: CiliumClusterwideNetworkPolicy
metadata:
  name: critical-function-protection
spec:
  endpointSelector:
    matchLabels:
      criticality: high
  ingress:
    - fromEndpoints:
        - matchLabels:
            authorized-for-critical: "true"`,
          order: 2,
        },
      ],
    },
    {
      id: "pack_cis_benchmark",
      slug: "cis-kubernetes-benchmark",
      name: "CIS Kubernetes Benchmark",
      description: "Network policies implementing CIS Kubernetes Benchmark v1.8 network controls. Includes pod-to-pod restrictions and namespace isolation.",
      tier: "ENTERPRISE" as const,
      category: "COMPLIANCE" as const,
      complianceFramework: "CIS",
      auditorName: "Ernst & Young",
      certificationDate: new Date("2024-01-01"),
      version: "1.8.0",
      tags: ["cis", "kubernetes", "benchmark", "hardening"],
      isPublished: true,
      policies: [
        {
          name: "cis-5-3-1-namespace-isolation",
          description: "Ensure namespace isolation with default deny",
          policyType: "CILIUM_CLUSTERWIDE" as const,
          controlIds: ["5.3.1"],
          yamlContent: `apiVersion: "cilium.io/v2"
kind: CiliumClusterwideNetworkPolicy
metadata:
  name: cis-5-3-1-namespace-isolation
spec:
  endpointSelector: {}
  ingress:
    - fromEndpoints:
        - {}
  egress:
    - toEndpoints:
        - {}`,
          order: 1,
        },
        {
          name: "cis-5-3-2-deny-external",
          description: "Deny external egress except for required services",
          policyType: "CILIUM_CLUSTERWIDE" as const,
          controlIds: ["5.3.2"],
          yamlContent: `apiVersion: "cilium.io/v2"
kind: CiliumClusterwideNetworkPolicy
metadata:
  name: cis-5-3-2-deny-external
spec:
  endpointSelector:
    matchLabels:
      external-egress: restricted
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
          order: 2,
        },
      ],
    },
  ];

  for (const pack of policyPacks) {
    const createdPack = await prisma.policyPack.upsert({
      where: { id: pack.id },
      update: {},
      create: {
        id: pack.id,
        slug: pack.slug,
        name: pack.name,
        description: pack.description,
        tier: pack.tier,
        category: pack.category,
        complianceFramework: pack.complianceFramework,
        auditorName: pack.auditorName,
        certificationDate: pack.certificationDate,
        version: pack.version,
        tags: pack.tags,
        isPublished: pack.isPublished,
      },
    });

    // Create policy items for this pack
    for (const policy of pack.policies) {
      await prisma.policyPackItem.upsert({
        where: {
          id: `${pack.id}_${policy.name}`,
        },
        update: {},
        create: {
          id: `${pack.id}_${policy.name}`,
          packId: createdPack.id,
          name: policy.name,
          description: policy.description,
          policyType: policy.policyType,
          yamlContent: policy.yamlContent,
          controlIds: (policy as { controlIds?: string[] }).controlIds ?? [],
          order: policy.order,
        },
      });
    }

    console.log(`✓ Policy Pack: ${createdPack.name} (${pack.tier}, ${pack.policies.length} policies)`);
  }

  // Create a subscription for the demo org (Enterprise tier for demo purposes)
  await prisma.subscription.upsert({
    where: { organizationId: org.id },
    update: {},
    create: {
      organizationId: org.id,
      tier: "ENTERPRISE",
      status: "ACTIVE",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
    },
  });
  console.log(`✓ Subscription: Enterprise (Active)`);

  console.log("\n✅ Seeding complete!");
  console.log(`
Summary:
  - 1 Organization
  - 1 User
  - ${clusters.length} Clusters
  - ${policies.length} Policies
  - ${simulations.length} Simulations
  - ${policyPacks.length} Policy Packs
  - 1 Subscription (Enterprise)
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
