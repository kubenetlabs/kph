# Kubernetes Policy Hub (KPH) Installation Plan

## Overview

This document defines the installation process for Kubernetes Policy Hub, designed for F5 Sales Engineering teams to deploy in demo and customer environments. KPH follows a SaaS + Agent architecture where the control plane runs in Anthropic/F5-hosted infrastructure and lightweight agents connect from customer Kubernetes clusters.

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                    KPH SaaS Control Plane                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Admin     │  │   User      │  │   API Gateway           │  │
│  │   Console   │  │   Portal    │  │   (Agent Connections)   │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│                           │                                      │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Policy Engine  │  Cluster Registry  │  Analytics Engine   ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                    TLS/mTLS (WebSocket + gRPC)
                              │
┌─────────────────────────────────────────────────────────────────┐
│                    Customer/Demo Cluster                         │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    kph-system namespace                      ││
│  │  ┌─────────────────────┐    ┌─────────────────────────────┐ ││
│  │  │   KPH Operator      │    │   KPH Collector (DaemonSet) │ ││
│  │  │   (Deployment)      │    │   Runs on every node        │ ││
│  │  │                     │    │                             │ ││
│  │  │  • SaaS connection  │    │  • eBPF telemetry capture   │ ││
│  │  │  • Policy sync      │◄───│  • Flow logs aggregation    │ ││
│  │  │  • CRD management   │    │  • Security event capture   │ ││
│  │  │  • Status reporting │    │  • Cilium/Tetragon metrics  │ ││
│  │  └─────────────────────┘    └─────────────────────────────┘ ││
│  └─────────────────────────────────────────────────────────────┘│
│                              │                                   │
│          Policies pushed by KPH Operator                        │
│                              │                                   │
│      ┌───────────────────────┼───────────────────────┐          │
│      ▼                       ▼                       ▼          │
│  ┌────────────┐       ┌────────────┐       ┌─────────────────┐  │
│  │  Cilium    │       │  Tetragon  │       │  Gateway API    │  │
│  │  (REQUIRED)│       │  (OPTIONAL)│       │  (OPTIONAL)     │  │
│  ├────────────┤       ├────────────┤       ├─────────────────┤  │
│  │NetworkPolicy       │TracingPolicy       │ HTTPRoute       │  │
│  │CiliumNP    │       │            │       │ GRPCRoute       │  │
│  │CiliumCNP   │       │            │       │ TCPRoute        │  │
│  │L3/L4/L7    │       │Process/File│       │ ReferenceGrant  │  │
│  │visibility  │       │Network     │       │                 │  │
│  └────────────┘       └────────────┘       └─────────────────┘  │
│       │                     │                     │             │
│       │                     │                     ▼             │
│       │                     │              ┌─────────────────┐  │
│       │                     │              │ Gateway Provider│  │
│       │                     │              │ (NGINX GW Fabric│  │
│       │                     │              │  Cilium GW, etc)│  │
│       │                     │              └─────────────────┘  │
│       ▼                     ▼                     │             │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Workloads / Data Plane                   ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Type | Required | Purpose |
|-----------|------|:--------:|---------|
| **KPH Operator** | Deployment (1-2 replicas) | ✓ | Control plane connection, policy lifecycle, CRD management |
| **KPH Collector** | DaemonSet (every node) | ✓ | Telemetry collection, flow logs, security events via eBPF |
| **Cilium** | DaemonSet (CNI) | ✓ | Network policy enforcement, L3-L7 visibility |
| **Tetragon** | DaemonSet | ✗ | Runtime security, process/file/network events |
| **Gateway API CRDs** | CRDs | ✗ | Ingress/routing configuration (HTTPRoute, etc.) |
| **Gateway Provider** | Varies | ✗ | NGINX Gateway Fabric, Cilium Gateway, Envoy Gateway, etc. |

### Policy Types Managed by KPH

| Policy Type | Target | CRDs | Use Case |
|-------------|--------|------|----------|
| **Network Policy** | Cilium | `NetworkPolicy`, `CiliumNetworkPolicy`, `CiliumClusterwideNetworkPolicy` | L3/L4 segmentation, L7 filtering |
| **Runtime Policy** | Tetragon | `TracingPolicy`, `TracingPolicyNamespaced` | Process execution, file access, network syscalls |
| **Ingress Policy** | Gateway API | `HTTPRoute`, `GRPCRoute`, `TCPRoute`, `TLSRoute` | North-south traffic routing, path-based routing |
| **Gateway Config** | Gateway API | `Gateway`, `GatewayClass`, `ReferenceGrant` | Gateway provisioning, cross-namespace references |

---

## Phase 1: Admin Console (Super User Interface)

### 1.1 Admin Access Control

Super administrators (e.g., Dan Henley, select F5 leadership) have elevated privileges to manage the entire KPH platform.

#### Super Admin Capabilities

| Capability | Description |
|------------|-------------|
| **User Provisioning Control** | Enable/disable self-service registration, approve pending registrations |
| **User Management** | Create, suspend, delete user accounts |
| **Organization Management** | Create and manage organizations/tenants |
| **Role Assignment** | Assign roles to users within organizations |
| **Audit Logs** | View all platform activity, user actions, agent connections |
| **System Configuration** | Configure global settings, feature flags, rate limits |
| **Cluster Oversight** | View all connected clusters across all organizations |

### 1.2 User Registration Modes

The admin console controls how new users can join the platform:

```yaml
# System Configuration Options
registration:
  mode: "invite_only"  # Options: open, invite_only, approval_required, disabled
  
  # invite_only: Users must receive email invitation from admin
  # approval_required: Users can request access, admin approves
  # open: Self-service registration (for internal demos only)
  # disabled: No new registrations
  
  allowed_domains:
    - "@f5.com"
    - "@nginx.com"
    # Restrict registration to corporate domains
  
  default_role: "viewer"  # Role assigned to new users
  default_organization: null  # If set, auto-assign to org
```

### 1.3 Admin Console UI Screens

#### Dashboard
- Total users, active users (last 7 days)
- Total organizations
- Total connected clusters
- Recent activity feed
- System health status

#### User Management
```
┌────────────────────────────────────────────────────────────────┐
│ Users                                            [+ Invite User]│
├────────────────────────────────────────────────────────────────┤
│ Search: [_______________]  Filter: [All Roles ▼] [All Orgs ▼]  │
├────────────────────────────────────────────────────────────────┤
│ ☑ │ Name           │ Email              │ Org      │ Role     │
├───┼────────────────┼────────────────────┼──────────┼──────────┤
│ ☐ │ Dan Henley     │ d.henley@f5.com    │ F5 Labs  │ SuperAdmin│
│ ☐ │ Jane Smith     │ j.smith@f5.com     │ SE Team  │ Admin    │
│ ☐ │ Bob Johnson    │ b.johnson@f5.com   │ SE Team  │ User     │
└───┴────────────────┴────────────────────┴──────────┴──────────┘
│ [Suspend Selected]  [Delete Selected]  [Change Role]           │
└────────────────────────────────────────────────────────────────┘
```

#### Pending Approvals (if approval_required mode)
```
┌────────────────────────────────────────────────────────────────┐
│ Pending Registration Requests                                   │
├────────────────────────────────────────────────────────────────┤
│ Email                │ Requested    │ Justification    │ Action│
├──────────────────────┼──────────────┼──────────────────┼───────┤
│ new.se@f5.com        │ 2025-01-18   │ "New SE, West"   │[✓] [✗]│
│ partner@acme.com     │ 2025-01-17   │ "Partner demo"   │[✓] [✗]│
└──────────────────────┴──────────────┴──────────────────┴───────┘
```

#### Organization Management
```
┌────────────────────────────────────────────────────────────────┐
│ Organizations                                   [+ Create Org]  │
├────────────────────────────────────────────────────────────────┤
│ Name            │ Users │ Clusters │ Created    │ Actions      │
├─────────────────┼───────┼──────────┼────────────┼──────────────┤
│ F5 Labs         │ 3     │ 2        │ 2025-01-01 │ [Edit] [···] │
│ SE West Region  │ 12    │ 8        │ 2025-01-05 │ [Edit] [···] │
│ Partner: Acme   │ 2     │ 1        │ 2025-01-15 │ [Edit] [···] │
└─────────────────┴───────┴──────────┴────────────┴──────────────┘
```

---

## Phase 2: Role-Based Access Control (RBAC)

### 2.1 Role Hierarchy

```
SuperAdmin
    │
    ├── OrgAdmin (Organization Administrator)
    │       │
    │       ├── ClusterAdmin (Cluster Administrator)
    │       │       │
    │       │       ├── PolicyEditor
    │       │       │
    │       │       └── Viewer
    │       │
    │       └── Viewer
    │
    └── Viewer (Read-only across everything)
```

### 2.2 Role Definitions

#### SuperAdmin (Platform Level)
```yaml
role: SuperAdmin
scope: platform
permissions:
  users:
    - create
    - read
    - update
    - delete
    - suspend
    - invite
  organizations:
    - create
    - read
    - update
    - delete
  clusters:
    - read  # View all clusters
    - disconnect  # Force disconnect any cluster
  policies:
    - read  # View all policies
  system:
    - configure
    - audit_logs
    - feature_flags
```

#### OrgAdmin (Organization Level)
```yaml
role: OrgAdmin
scope: organization
permissions:
  users:
    - invite  # Invite users to their org
    - read    # View org users
    - update  # Update user roles within org
    - remove  # Remove from org (not delete account)
  clusters:
    - create  # Register new clusters
    - read
    - update
    - delete
    - connect
  policies:
    - create
    - read
    - update
    - delete
    - deploy
  tokens:
    - create
    - read
    - revoke
```

#### ClusterAdmin (Cluster Level)
```yaml
role: ClusterAdmin
scope: cluster
permissions:
  clusters:
    - read    # View assigned clusters
    - update  # Update cluster config
  policies:
    - create
    - read
    - update
    - delete
    - deploy  # Deploy to assigned clusters only
  tokens:
    - read    # View (masked) tokens for assigned clusters
```

#### PolicyEditor
```yaml
role: PolicyEditor
scope: cluster
permissions:
  policies:
    - create
    - read
    - update
    - delete
    # Cannot deploy - must request approval or have ClusterAdmin do it
  clusters:
    - read
```

#### Viewer
```yaml
role: Viewer
scope: varies  # Can be platform, org, or cluster level
permissions:
  users:
    - read  # If platform/org scope
  organizations:
    - read  # If platform scope
  clusters:
    - read
  policies:
    - read
  audit_logs:
    - read  # Read logs for their scope
```

### 2.3 Permission Matrix

| Action | SuperAdmin | OrgAdmin | ClusterAdmin | PolicyEditor | Viewer |
|--------|:----------:|:--------:|:------------:|:------------:|:------:|
| Create Organization | ✓ | - | - | - | - |
| Invite Users (Platform) | ✓ | - | - | - | - |
| Invite Users (Org) | ✓ | ✓ | - | - | - |
| Register Cluster | ✓ | ✓ | - | - | - |
| Generate Agent Token | ✓ | ✓ | - | - | - |
| Create Policy | ✓ | ✓ | ✓ | ✓ | - |
| Deploy Policy | ✓ | ✓ | ✓ | - | - |
| View Policies | ✓ | ✓ | ✓ | ✓ | ✓ |
| View Audit Logs | ✓ | ✓* | ✓* | - | ✓* |
| System Configuration | ✓ | - | - | - | - |

*Scoped to their organization/cluster

---

## Phase 3: User Onboarding Flow

### 3.1 New User Journey (Invite-Only Mode)

```
┌─────────────────────────────────────────────────────────────────┐
│ ADMIN WORKFLOW                                                   │
├─────────────────────────────────────────────────────────────────┤
│  1. Admin opens User Management                                  │
│  2. Clicks [+ Invite User]                                       │
│  3. Enters email, selects organization, assigns initial role     │
│  4. System sends invitation email                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ USER WORKFLOW                                                    │
├─────────────────────────────────────────────────────────────────┤
│  1. User receives email: "You've been invited to KPH"           │
│  2. Clicks invitation link (valid 7 days)                       │
│  3. Creates account with email/password                         │
│  4. Lands on User Portal dashboard                              │
│  5. Sees their organization and assigned clusters               │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 First Cluster Connection (User Portal)

```
┌─────────────────────────────────────────────────────────────────┐
│ KPH User Portal - SE West Region                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Welcome, Jane! Let's connect your first cluster.               │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Step 1: Name Your Cluster                                  │ │
│  │                                                            │ │
│  │ Cluster Name: [demo-eks-west______________]                │ │
│  │ Environment:  [○ Demo  ○ Dev  ○ Staging  ○ Production]     │ │
│  │ Description:  [Customer ABC demo environment____]          │ │
│  │                                                            │ │
│  │                                       [Continue →]         │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

                              │
                              ▼

┌─────────────────────────────────────────────────────────────────┐
│ KPH User Portal - SE West Region                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Step 2: Generate Agent Token                               │ │
│  │                                                            │ │
│  │ Your agent token has been generated:                       │ │
│  │                                                            │ │
│  │ ┌────────────────────────────────────────────────────────┐ │ │
│  │ │ kph_at_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx    │ │ │
│  │ │                                              [Copy 📋] │ │ │
│  │ └────────────────────────────────────────────────────────┘ │ │
│  │                                                            │ │
│  │ ⚠️  Save this token! It will only be shown once.          │ │
│  │                                                            │ │
│  │ Token expires: Never (revoke manually when done)           │ │
│  │                                                            │ │
│  │                                       [Continue →]         │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

                              │
                              ▼

┌─────────────────────────────────────────────────────────────────┐
│ KPH User Portal - SE West Region                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Step 3: Install KPH Components                             │ │
│  │                                                            │ │
│  │ Before installing, verify Cilium is running:               │ │
│  │ ┌──────────────────────────────────────────────────────┐   │ │
│  │ │ cilium status && hubble status                       │   │ │
│  │ └──────────────────────────────────────────────────────┘   │ │
│  │                                                            │ │
│  │ Run these commands in your cluster:                        │ │
│  │                                                            │ │
│  │ # Add the KPH Helm repository                              │ │
│  │ ┌──────────────────────────────────────────────────────┐   │ │
│  │ │ helm repo add kph https://charts.kph.f5.com          │   │ │
│  │ │ helm repo update                                     │   │ │
│  │ └──────────────────────────────────────────────────────┘   │ │
│  │                                                            │ │
│  │ # Install KPH (operator + collector daemonset)             │ │
│  │ ┌──────────────────────────────────────────────────────┐   │ │
│  │ │ helm install kph kph/kph \                           │   │ │
│  │ │   --namespace kph-system \                           │   │ │
│  │ │   --create-namespace \                               │   │ │
│  │ │   --set global.token=kph_at_xxxxxxxx \               │   │ │
│  │ │   --set global.clusterName=demo-eks-west             │   │ │
│  │ └──────────────────────────────────────────────────────┘   │ │
│  │                                              [Copy All 📋] │ │
│  │                                                            │ │
│  │ Optional integrations (if installed in cluster):           │ │
│  │ ┌──────────────────────────────────────────────────────┐   │ │
│  │ │ # Add Tetragon support                               │   │ │
│  │ │ --set tetragon.enabled=true                          │   │ │
│  │ │                                                      │   │ │
│  │ │ # Add Gateway API support                            │   │ │
│  │ │ --set gatewayAPI.enabled=true                        │   │ │
│  │ └──────────────────────────────────────────────────────┘   │ │
│  │                                                            │ │
│  │ Or download the values file:  [Download values.yaml]       │ │
│  │                                                            │ │
│  │ This will install:                                         │ │
│  │ • KPH Operator (1 replica) - SaaS connection & policies    │ │
│  │ • KPH Collector (DaemonSet) - Telemetry on every node      │ │
│  │                                                            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Waiting for agent connection...  ⟳                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 4: Agent Installation

### 4.1 Prerequisites

#### Required

| Requirement | kind (Local) | EKS | GKE | AKS |
|-------------|:------------:|:---:|:---:|:---:|
| Kubernetes Version | 1.25+ | 1.25+ | 1.25+ | 1.25+ |
| Helm 3.x | ✓ | ✓ | ✓ | ✓ |
| kubectl configured | ✓ | ✓ | ✓ | ✓ |
| Outbound HTTPS (443) | ✓ | ✓ | ✓ | ✓ |
| ClusterRole permissions | ✓ | ✓ | ✓ | ✓ |
| **Cilium CNI** | ✓ | ✓ | ✓ | ✓ |
| Linux Kernel 4.19+ (eBPF) | ✓ | ✓ | ✓ | ✓ |
| Privileged pods allowed | ✓ | ✓* | ✓ | ✓* |

*May require PSP/SCC configuration

#### Optional (for full-stack demos)

| Component | Purpose | KPH Integration |
|-----------|---------|-----------------|
| **Tetragon** | Runtime security (process/file/network) | Push TracingPolicy CRDs, collect security events |
| **Gateway API CRDs** | Ingress routing standard | Push HTTPRoute, GRPCRoute, Gateway configs |
| **NGINX Gateway Fabric** | Gateway API implementation | L7 routing, TLS termination |
| **Cilium Gateway** | Alternative Gateway API impl | Native Cilium integration |

#### Verifying Prerequisites

```bash
# Required: Verify Cilium is running
cilium status
hubble status

# Optional: Check if Tetragon is installed
kubectl get pods -n kube-system -l app.kubernetes.io/name=tetragon

# Optional: Check if Gateway API CRDs are installed
kubectl get crd gateways.gateway.networking.k8s.io

# Optional: Check for Gateway provider (NGINX Gateway Fabric example)
kubectl get pods -n nginx-gateway
```

#### Cilium Requirement

KPH assumes Cilium is already running as the CNI in your cluster. The collector daemonset integrates with Cilium's Hubble observability layer to capture flow logs, DNS queries, and policy enforcement events.

```bash
# Verify Cilium is running
cilium status

# Verify Hubble is enabled (required for flow visibility)
hubble status
```

If Hubble is not enabled, enable it before installing KPH:
```bash
cilium hubble enable
```

**Note for EKS with VPC CNI:** KPH requires Cilium as the primary CNI. If your EKS cluster uses VPC CNI, you'll need to migrate to Cilium before installing KPH.

#### Optional: Tetragon Setup

If Tetragon is installed, KPH can push TracingPolicy configurations for runtime security and collect security events (process exec, file access, network connections).

```bash
# Check Tetragon status
kubectl get pods -n kube-system -l app.kubernetes.io/name=tetragon

# Verify Tetragon CRDs are available
kubectl get crd tracingpolicies.cilium.io
```

#### Optional: Gateway API Setup

If Gateway API CRDs are installed with a compatible provider, KPH can push routing configurations (HTTPRoute, GRPCRoute, etc.).

```bash
# Check Gateway API CRDs (v1.0+)
kubectl get crd gateways.gateway.networking.k8s.io
kubectl get crd httproutes.gateway.networking.k8s.io

# Check for a Gateway provider
kubectl get gatewayclass

# Example output with NGINX Gateway Fabric:
# NAME    CONTROLLER                      ACCEPTED   AGE
# nginx   gateway.nginx.org/nginx-gateway True       1d
```

**Supported Gateway Providers:**
- NGINX Gateway Fabric
- Cilium Gateway API
- Envoy Gateway
- Any Gateway API v1.0+ compliant implementation

### 4.2 Installation Methods

#### Method A: Helm (Recommended)

```bash
# 1. Add repository
helm repo add kph https://charts.kph.f5.com
helm repo update

# 2. Create namespace
kubectl create namespace kph-system

# 3. Create secret for token
kubectl create secret generic kph-agent-token \
  --namespace kph-system \
  --from-literal=token=kph_at_xxxxxxxxxxxx

# 4. Install KPH (includes both operator and collector)
helm install kph kph/kph \
  --namespace kph-system \
  --set global.clusterName=my-cluster \
  --set global.tokenSecretName=kph-agent-token
```

#### Method B: Manifest (Air-gapped / Restricted)

```bash
# 1. Download manifests
curl -LO https://install.kph.f5.com/v1/manifests.yaml

# 2. Edit configuration
# Update CLUSTER_NAME and TOKEN in manifests.yaml

# 3. Apply
kubectl apply -f manifests.yaml
```

### 4.3 Helm Values Reference

```yaml
# values.yaml - Full configuration reference

global:
  # Required: Cluster identifier (must match SaaS registration)
  clusterName: ""
  
  # Required: Authentication token (use secret reference in production)
  token: ""
  tokenSecretName: ""  # If set, reads token from this secret
  tokenSecretKey: "token"  # Key within the secret
  
  # SaaS connection settings
  endpoint: "wss://api.kph.f5.com"
  
  # Image settings (for air-gapped environments)
  imageRegistry: "registry.kph.f5.com"
  imagePullSecrets: []

# ============================================
# KPH Operator (Deployment)
# ============================================
operator:
  enabled: true
  
  # Replica count (2 for HA in production)
  replicas: 1
  
  image:
    repository: kph/operator
    tag: "1.0.0"
    pullPolicy: IfNotPresent
  
  resources:
    requests:
      cpu: 100m
      memory: 128Mi
    limits:
      cpu: 500m
      memory: 512Mi
  
  # Log level: debug, info, warn, error
  logLevel: info
  
  # Policy sync interval (seconds)
  syncInterval: 30
  
  # Enable policy write operations (deploy/update/delete)
  policyWrite:
    enabled: true
    # Dry-run mode: validate but don't apply
    dryRun: false
  
  # CRD management
  crds:
    # Install KPH CRDs
    install: true
    # Manage Cilium NetworkPolicy CRDs
    manageCiliumPolicies: true
    # Manage native K8s NetworkPolicy
    manageK8sPolicies: true
    # Manage Tetragon TracingPolicy CRDs (requires Tetragon installed)
    manageTetragonPolicies: false
    # Manage Gateway API CRDs (requires Gateway API + provider installed)
    manageGatewayAPI: false
  
  # Health check settings
  healthCheck:
    enabled: true
    port: 8080
    path: /healthz
  
  # Leader election (for HA)
  leaderElection:
    enabled: true
    leaseDuration: 15s
    renewDeadline: 10s
    retryPeriod: 2s

# ============================================
# KPH Collector (DaemonSet)
# ============================================
collector:
  enabled: true
  
  image:
    repository: kph/collector
    tag: "1.0.0"
    pullPolicy: IfNotPresent
  
  resources:
    requests:
      cpu: 50m
      memory: 64Mi
    limits:
      cpu: 200m
      memory: 256Mi
  
  # Log level
  logLevel: info
  
  # eBPF settings
  ebpf:
    enabled: true
    # Mount BPF filesystem
    bpffsPath: /sys/fs/bpf
  
  # Telemetry collection settings
  telemetry:
    # Flow log collection
    flowLogs:
      enabled: true
      # Sample rate (1 = all flows, 100 = 1% sample)
      sampleRate: 1
      # Aggregation window before sending to operator
      aggregationInterval: 10s
    
    # DNS query logging
    dns:
      enabled: true
    
    # HTTP/L7 visibility (requires Cilium L7 proxy)
    l7:
      enabled: false
      # Protocols to capture
      protocols:
        - http
        - grpc
  
  # Cilium integration
  cilium:
    # Auto-detect Cilium installation
    autoDetect: true
    # Path to Cilium socket
    socketPath: /var/run/cilium/cilium.sock
    # Enable Hubble relay connection
    hubble:
      enabled: true
      address: hubble-relay.kube-system.svc:4245
  
  # Tetragon integration (optional - enable if Tetragon is installed)
  tetragon:
    enabled: false
    # Path to Tetragon events
    eventsPath: /var/run/tetragon/tetragon.sock
    # Collect process execution events
    processEvents: true
    # Collect file access events
    fileEvents: true
    # Collect network events (in addition to Cilium flows)
    networkEvents: true

# ============================================
# Tetragon Policy Management (Optional)
# ============================================
tetragon:
  # Enable Tetragon policy management (requires Tetragon installed)
  enabled: false
  
  # Auto-detect Tetragon installation
  autoDetect: true
  
  # TracingPolicy management
  policies:
    # Allow KPH to create/update/delete TracingPolicies
    manage: true
    # Namespace for namespaced policies (empty = all namespaces)
    allowedNamespaces: []
    # Default enforcement action: Audit, Block
    defaultAction: Audit

# ============================================
# Gateway API Management (Optional)
# ============================================
gatewayAPI:
  # Enable Gateway API resource management
  enabled: false
  
  # Auto-detect Gateway API CRDs
  autoDetect: true
  
  # Supported resources
  resources:
    # Gateway management
    gateways: true
    # HTTPRoute management
    httpRoutes: true
    # GRPCRoute management
    grpcRoutes: true
    # TCPRoute management
    tcpRoutes: false
    # TLSRoute management
    tlsRoutes: false
    # ReferenceGrant management (cross-namespace references)
    referenceGrants: true
  
  # Gateway provider settings
  provider:
    # Auto-detect provider from GatewayClass
    autoDetect: true
    # Or specify explicitly: nginx, cilium, envoy, istio
    name: ""
  
  # Default GatewayClass to use when creating Gateways
  defaultGatewayClass: ""
  
  # Namespace restrictions
  allowedNamespaces: []  # Empty = all namespaces
  
  # Security events
  securityEvents:
    # Policy deny events
    policyDenies: true
    # Connection tracking
    connectionTracking: true
  
  # Buffer settings
  buffer:
    # Max events to buffer before sending
    maxSize: 10000
    # Flush interval
    flushInterval: 5s
  
  # Node affinity/tolerations for DaemonSet
  tolerations:
    - operator: Exists  # Run on all nodes including masters
  
  # Volume mounts for eBPF access
  hostPaths:
    bpf: /sys/fs/bpf
    cgroup: /sys/fs/cgroup
    proc: /proc

# ============================================
# Service Account & RBAC
# ============================================
serviceAccount:
  create: true
  name: kph
  annotations: {}

rbac:
  create: true
  # Operator needs cluster-wide permissions for policies
  operator:
    clusterRole: true
  # Collector needs node-level access
  collector:
    clusterRole: true
    # PSP/SCC for privileged access (eBPF)
    privileged: true

# ============================================
# Pod Security
# ============================================
# Operator pod security (unprivileged)
operator:
  podSecurityContext:
    runAsNonRoot: true
    runAsUser: 1000
    fsGroup: 1000
  securityContext:
    allowPrivilegeEscalation: false
    readOnlyRootFilesystem: true
    capabilities:
      drop:
        - ALL

# Collector pod security (privileged for eBPF)
collector:
  podSecurityContext:
    runAsUser: 0  # Required for eBPF
  securityContext:
    privileged: true  # Required for eBPF
    capabilities:
      add:
        - SYS_ADMIN
        - SYS_RESOURCE
        - NET_ADMIN
        - BPF

# ============================================
# Network Policies
# ============================================
networkPolicy:
  enabled: false
  # If enabled, creates NetworkPolicy allowing:
  # - Operator egress to KPH SaaS
  # - Collector to Operator communication
  # - Collector to Cilium/Hubble

# ============================================
# Monitoring
# ============================================
metrics:
  enabled: true
  
  operator:
    port: 9090
  
  collector:
    port: 9091
  
  serviceMonitor:
    enabled: false
    namespace: ""
    interval: 30s
    labels: {}

# ============================================
# Prerequisites Check
# ============================================
prerequisites:
  # Check for Cilium before installing
  ciliumCheck:
    enabled: true
    # Fail if Cilium not found
    required: true
  
  # Check kernel version for eBPF
  kernelCheck:
    enabled: true
    minVersion: "4.19"
```

### 4.4 Installation Profiles

For convenience, KPH provides installation profiles for common scenarios:

```bash
# Demo/Development (minimal resources, Cilium only)
helm install kph kph/kph \
  --namespace kph-system \
  --set global.clusterName=demo-cluster \
  --set global.token=kph_at_xxx \
  --values https://charts.kph.f5.com/profiles/demo.yaml

# Full-Stack Demo (Cilium + Tetragon + Gateway API)
helm install kph kph/kph \
  --namespace kph-system \
  --set global.clusterName=fullstack-demo \
  --set global.token=kph_at_xxx \
  --values https://charts.kph.f5.com/profiles/fullstack-demo.yaml

# Production (HA, conservative resources, Cilium only)
helm install kph kph/kph \
  --namespace kph-system \
  --set global.clusterName=prod-cluster \
  --set global.tokenSecretName=kph-token \
  --values https://charts.kph.f5.com/profiles/production.yaml

# Observability-only (collector only, no policy writes)
helm install kph kph/kph \
  --namespace kph-system \
  --set global.clusterName=obs-cluster \
  --set global.token=kph_at_xxx \
  --set operator.policyWrite.enabled=false \
  --values https://charts.kph.f5.com/profiles/observability.yaml
```

**Profile Comparison:**

| Setting | Demo | Full-Stack Demo | Production | Observability |
|---------|------|-----------------|------------|---------------|
| Operator replicas | 1 | 1 | 2 | 1 |
| Policy write | ✓ | ✓ | ✓ | ✗ |
| Cilium policies | ✓ | ✓ | ✓ | ✗ |
| Tetragon policies | ✗ | ✓ | ✗ | ✗ |
| Gateway API | ✗ | ✓ | ✗ | ✗ |
| Flow log sampling | 100% | 100% | 10% | 100% |
| L7 visibility | ✓ | ✓ | ✗ | ✓ |
| Tetragon events | ✗ | ✓ | ✗ | ✗ |
| Resource limits | Low | Low | Standard | Low |

#### Full-Stack Demo Profile Details

The full-stack demo profile enables all KPH capabilities for SE demonstrations:

```yaml
# profiles/fullstack-demo.yaml
operator:
  replicas: 1
  logLevel: info
  policyWrite:
    enabled: true
  crds:
    manageCiliumPolicies: true
    manageK8sPolicies: true
    manageTetragonPolicies: true
    manageGatewayAPI: true

collector:
  logLevel: info
  telemetry:
    flowLogs:
      enabled: true
      sampleRate: 1
    dns:
      enabled: true
    l7:
      enabled: true
  tetragon:
    enabled: true
    processEvents: true
    fileEvents: true
    networkEvents: true

tetragon:
  enabled: true
  policies:
    manage: true
    defaultAction: Audit

gatewayAPI:
  enabled: true
  resources:
    gateways: true
    httpRoutes: true
    grpcRoutes: true
    referenceGrants: true
```

#### Enabling Individual Features via CLI

You can also enable features individually without using a profile:

```bash
# Base install + Tetragon
helm install kph kph/kph \
  --namespace kph-system \
  --set global.clusterName=my-cluster \
  --set global.token=kph_at_xxx \
  --set tetragon.enabled=true \
  --set collector.tetragon.enabled=true \
  --set operator.crds.manageTetragonPolicies=true

# Base install + Gateway API
helm install kph kph/kph \
  --namespace kph-system \
  --set global.clusterName=my-cluster \
  --set global.token=kph_at_xxx \
  --set gatewayAPI.enabled=true \
  --set operator.crds.manageGatewayAPI=true

# Base install + Tetragon + Gateway API (full stack)
helm install kph kph/kph \
  --namespace kph-system \
  --set global.clusterName=my-cluster \
  --set global.token=kph_at_xxx \
  --set tetragon.enabled=true \
  --set collector.tetragon.enabled=true \
  --set operator.crds.manageTetragonPolicies=true \
  --set gatewayAPI.enabled=true \
  --set operator.crds.manageGatewayAPI=true
```

### 4.5 Quick Start Examples

#### kind (Local Development)

```bash
# Assuming kind cluster with Cilium already running
# Verify Cilium status first
cilium status
hubble status

# Install KPH (operator + collector daemonset)
helm install kph kph/kph \
  --namespace kph-system \
  --create-namespace \
  --set global.token=kph_at_demo_token \
  --set global.clusterName=local-kind-demo \
  --set operator.logLevel=debug \
  --set collector.logLevel=debug
```

#### EKS

```bash
# Ensure kubectl is configured for EKS
aws eks update-kubeconfig --name my-eks-cluster --region us-west-2

# Verify Cilium and Hubble are running
cilium status
hubble status

# Create namespace
kubectl create namespace kph-system

# Create secret (recommended for production)
kubectl create secret generic kph-token \
  --namespace kph-system \
  --from-literal=token=${KPH_TOKEN}

# Install with production settings
helm install kph kph/kph \
  --namespace kph-system \
  --set global.clusterName=eks-prod-west \
  --set global.tokenSecretName=kph-token \
  --set operator.replicas=2 \
  --set collector.telemetry.flowLogs.sampleRate=10 \
  --set metrics.serviceMonitor.enabled=true
```

---

## Phase 5: Verification & Health Checks

### 5.1 Installation Verification

```bash
# Check all KPH components
kubectl get pods -n kph-system

# Expected output:
# NAME                            READY   STATUS    RESTARTS   AGE
# kph-operator-7d8f9b6c4d-x2k9p   1/1     Running   0          2m
# kph-collector-abc12             1/1     Running   0          2m    # Node 1
# kph-collector-def34             1/1     Running   0          2m    # Node 2
# kph-collector-ghi56             1/1     Running   0          2m    # Node 3

# Verify DaemonSet is running on all nodes
kubectl get daemonset -n kph-system

# Expected output:
# NAME            DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE   NODE SELECTOR   AGE
# kph-collector   3         3         3       3            3           <none>          2m
```

### 5.2 Operator Health Verification

```bash
# Check operator logs for SaaS connection
kubectl logs -n kph-system -l app.kubernetes.io/component=operator --tail=50

# Expected log entries:
# {"level":"info","msg":"Starting KPH Operator","version":"1.0.0"}
# {"level":"info","msg":"Connecting to KPH SaaS","endpoint":"wss://api.kph.f5.com"}
# {"level":"info","msg":"Connection established","cluster":"demo-eks-west"}
# {"level":"info","msg":"Policy write enabled","dryRun":false}
# {"level":"info","msg":"Initial policy sync complete","policies":0}
# {"level":"info","msg":"CRD management enabled","cilium":true,"k8s":true}
```

### 5.3 Collector Health Verification

```bash
# Check collector logs for telemetry flow
kubectl logs -n kph-system -l app.kubernetes.io/component=collector --tail=50

# Expected log entries:
# {"level":"info","msg":"Starting KPH Collector","version":"1.0.0","node":"ip-10-0-1-50"}
# {"level":"info","msg":"eBPF programs loaded","programs":["flow_capture","dns_monitor"]}
# {"level":"info","msg":"Cilium integration active","hubble":true}
# {"level":"info","msg":"Connected to operator","address":"kph-operator:8081"}
# {"level":"info","msg":"Telemetry streaming started","flowLogs":true,"dns":true}

# Verify collector is receiving flows
kubectl exec -n kph-system -it $(kubectl get pod -n kph-system -l app.kubernetes.io/component=collector -o jsonpath='{.items[0].metadata.name}') -- kph-collector status

# Expected output:
# KPH Collector Status
# ====================
# Node:           ip-10-0-1-50
# Uptime:         5m32s
# eBPF Status:    Active
# Cilium Status:  Connected
# Hubble Status:  Connected
# 
# Telemetry Stats (last 60s):
#   Flow logs:      1,234 events
#   DNS queries:    567 events
#   Policy denies:  0 events
#
# Buffer:         234/10000 (2.3%)
# Last flush:     3s ago
```

### 5.4 SaaS Connection Verification

In the KPH User Portal, the cluster status should update:

```
┌────────────────────────────────────────────────────────────────┐
│ Clusters                                                        │
├────────────────────────────────────────────────────────────────┤
│ Name            │ Status      │ Nodes │ Policies │ Last Seen   │
├─────────────────┼─────────────┼───────┼──────────┼─────────────┤
│ demo-eks-west   │ ● Connected │ 3/3   │ 0        │ Just now    │
│ local-kind-demo │ ○ Pending   │ -     │ -        │ Never       │
└─────────────────┴─────────────┴───────┴──────────┴─────────────┘

Cluster Detail View:
┌────────────────────────────────────────────────────────────────┐
│ demo-eks-west                                    [Disconnect]  │
├────────────────────────────────────────────────────────────────┤
│ Status: ● Connected                                            │
│ Environment: Demo                                              │
│ Operator Version: 1.0.0                                        │
│ Collector Version: 1.0.0                                       │
│                                                                │
│ Nodes (3/3 reporting):                                         │
│ ┌──────────────────┬────────────┬─────────────────────────────┐│
│ │ Node             │ Status     │ Flows (last hour)           ││
│ ├──────────────────┼────────────┼─────────────────────────────┤│
│ │ ip-10-0-1-50     │ ● Healthy  │ 12,456                      ││
│ │ ip-10-0-1-51     │ ● Healthy  │ 8,234                       ││
│ │ ip-10-0-1-52     │ ● Healthy  │ 15,678                      ││
│ └──────────────────┴────────────┴─────────────────────────────┘│
│                                                                │
│ Integrations:                                                  │
│ ┌──────────────────┬────────────┬─────────────────────────────┐│
│ │ Component        │ Status     │ Policy Management           ││
│ ├──────────────────┼────────────┼─────────────────────────────┤│
│ │ Cilium           │ ✓ v1.15.0  │ ✓ Enabled                   ││
│ │ Hubble           │ ✓ Enabled  │ -                           ││
│ │ Tetragon         │ ✓ v1.0.0   │ ✓ Enabled                   ││
│ │ Gateway API      │ ✓ v1.0.0   │ ✓ Enabled                   ││
│ │ Gateway Provider │ nginx      │ -                           ││
│ └──────────────────┴────────────┴─────────────────────────────┘│
└────────────────────────────────────────────────────────────────┘
```

### 5.5 Optional Integration Verification

#### Tetragon Integration (if enabled)

```bash
# Check collector is receiving Tetragon events
kubectl logs -n kph-system -l app.kubernetes.io/component=collector --tail=20 | grep tetragon

# Expected log entries:
# {"level":"info","msg":"Tetragon integration active","socket":"/var/run/tetragon/tetragon.sock"}
# {"level":"info","msg":"Tetragon event streaming started","process":true,"file":true,"network":true}

# Verify operator can manage TracingPolicies
kubectl auth can-i create tracingpolicies --as=system:serviceaccount:kph-system:kph

# List any existing TracingPolicies
kubectl get tracingpolicies -A
```

#### Gateway API Integration (if enabled)

```bash
# Check operator detected Gateway API
kubectl logs -n kph-system -l app.kubernetes.io/component=operator --tail=20 | grep gateway

# Expected log entries:
# {"level":"info","msg":"Gateway API CRDs detected","version":"v1.0.0"}
# {"level":"info","msg":"Gateway provider detected","provider":"nginx","class":"nginx"}
# {"level":"info","msg":"Gateway API management enabled","resources":["Gateway","HTTPRoute","GRPCRoute"]}

# Verify operator can manage Gateway resources
kubectl auth can-i create httproutes --as=system:serviceaccount:kph-system:kph
kubectl auth can-i create gateways --as=system:serviceaccount:kph-system:kph

# List existing Gateway resources
kubectl get gateway -A
kubectl get httproute -A
```

### 5.6 Troubleshooting

| Symptom | Likely Cause | Resolution |
|---------|--------------|------------|
| Operator CrashLoopBackOff | Invalid token | Regenerate token in SaaS, update secret |
| Collector CrashLoopBackOff | Missing privileges | Check PSP/SCC allows privileged pods |
| Collector not starting | Kernel too old | Requires kernel 4.19+ for eBPF |
| Status: Pending (SaaS) | Network blocked | Check egress to api.kph.f5.com:443 |
| Connection drops | Token revoked | Check token status in SaaS |
| Policies not syncing | RBAC insufficient | Verify ClusterRole binding |
| No flow data | Cilium not detected | Verify Cilium is running, check socket path |
| Partial node reporting | DaemonSet tolerations | Check node taints vs tolerations |
| Tetragon not detected | Socket path wrong | Verify `/var/run/tetragon/tetragon.sock` exists |
| Tetragon policies fail | CRDs missing | Verify Tetragon is installed with CRDs |
| Gateway API not detected | CRDs not installed | Install Gateway API CRDs v1.0+ |
| HTTPRoute creation fails | No GatewayClass | Ensure Gateway provider is installed |
| Gateway policies rejected | Provider mismatch | Check GatewayClass matches installed provider |

```bash
# Debug operator connectivity
kubectl run -n kph-system curl-test --rm -it --image=curlimages/curl -- \
  curl -v https://api.kph.f5.com/health

# Check RBAC for operator (Cilium)
kubectl auth can-i list ciliumnetworkpolicies --as=system:serviceaccount:kph-system:kph

# Check RBAC for Tetragon (if enabled)
kubectl auth can-i create tracingpolicies --as=system:serviceaccount:kph-system:kph

# Check RBAC for Gateway API (if enabled)
kubectl auth can-i create httproutes --as=system:serviceaccount:kph-system:kph

# Check collector eBPF status
kubectl exec -n kph-system -it $(kubectl get pod -n kph-system -l app.kubernetes.io/component=collector -o jsonpath='{.items[0].metadata.name}') -- cat /sys/fs/bpf/kph/status

# View operator configuration
kubectl get configmap -n kph-system kph-operator-config -o yaml

# Check for node-level issues
kubectl describe daemonset -n kph-system kph-collector

# Debug Tetragon integration
kubectl exec -n kph-system -it $(kubectl get pod -n kph-system -l app.kubernetes.io/component=collector -o jsonpath='{.items[0].metadata.name}') -- ls -la /var/run/tetragon/

# Debug Gateway API integration
kubectl get crd | grep gateway
kubectl get gatewayclass
```

---

## Phase 6: Token Management

### 6.1 Token Types

| Token Type | Prefix | Scope | Lifetime | Use Case |
|------------|--------|-------|----------|----------|
| Agent Token | `kph_at_` | Single cluster | Until revoked | Agent authentication |
| API Token | `kph_api_` | User-scoped | Configurable | CI/CD, automation |
| Admin Token | `kph_admin_` | Organization | 24 hours | Emergency access |

### 6.2 Token Lifecycle

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   Created   │ ───▶ │   Active    │ ───▶ │   Revoked   │
└─────────────┘      └─────────────┘      └─────────────┘
                           │
                           │ (expiration)
                           ▼
                     ┌─────────────┐
                     │   Expired   │
                     └─────────────┘
```

### 6.3 Token Operations (UI)

```
┌────────────────────────────────────────────────────────────────┐
│ Agent Tokens - demo-eks-west                                    │
├────────────────────────────────────────────────────────────────┤
│ Token ID    │ Created      │ Last Used    │ Status  │ Actions  │
├─────────────┼──────────────┼──────────────┼─────────┼──────────┤
│ tok_abc123  │ 2025-01-15   │ 2 min ago    │ Active  │ [Revoke] │
│ tok_def456  │ 2025-01-10   │ 2025-01-12   │ Revoked │ [Delete] │
└─────────────┴──────────────┴──────────────┴─────────┴──────────┘
│                                         [+ Generate New Token]  │
└────────────────────────────────────────────────────────────────┘
```

---

## Appendix A: API Endpoints

### Authentication
```
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
```

### Users (Admin)
```
GET    /api/v1/admin/users
POST   /api/v1/admin/users/invite
GET    /api/v1/admin/users/:id
PATCH  /api/v1/admin/users/:id
DELETE /api/v1/admin/users/:id
POST   /api/v1/admin/users/:id/suspend
POST   /api/v1/admin/users/:id/activate
```

### Organizations (Admin)
```
GET    /api/v1/admin/organizations
POST   /api/v1/admin/organizations
GET    /api/v1/admin/organizations/:id
PATCH  /api/v1/admin/organizations/:id
DELETE /api/v1/admin/organizations/:id
```

### Clusters
```
GET    /api/v1/clusters
POST   /api/v1/clusters
GET    /api/v1/clusters/:id
PATCH  /api/v1/clusters/:id
DELETE /api/v1/clusters/:id
POST   /api/v1/clusters/:id/tokens
GET    /api/v1/clusters/:id/tokens
DELETE /api/v1/clusters/:id/tokens/:tokenId
```

### Policies
```
GET    /api/v1/policies
POST   /api/v1/policies
GET    /api/v1/policies/:id
PATCH  /api/v1/policies/:id
DELETE /api/v1/policies/:id
POST   /api/v1/policies/:id/deploy
GET    /api/v1/policies/:id/deployments
```

### Agent WebSocket
```
WSS /api/v1/agent/connect
  - Authentication: Bearer token in header
  - Messages: JSON-RPC 2.0
```

---

## Appendix B: Database Schema (Core Entities)

```sql
-- Organizations
CREATE TABLE organizations (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(63) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Users
CREATE TABLE users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    password_hash VARCHAR(255),
    status VARCHAR(20) DEFAULT 'active', -- active, suspended, pending
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Organization Memberships (with roles)
CREATE TABLE organization_members (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    organization_id UUID REFERENCES organizations(id),
    role VARCHAR(50) NOT NULL, -- OrgAdmin, ClusterAdmin, PolicyEditor, Viewer
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, organization_id)
);

-- Clusters
CREATE TABLE clusters (
    id UUID PRIMARY KEY,
    organization_id UUID REFERENCES organizations(id),
    name VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    environment VARCHAR(50), -- demo, dev, staging, production
    status VARCHAR(50) DEFAULT 'pending', -- pending, connected, disconnected
    last_seen_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(organization_id, name)
);

-- Agent Tokens
CREATE TABLE agent_tokens (
    id UUID PRIMARY KEY,
    cluster_id UUID REFERENCES clusters(id),
    token_hash VARCHAR(255) NOT NULL,
    token_prefix VARCHAR(20) NOT NULL, -- First chars for identification
    status VARCHAR(20) DEFAULT 'active', -- active, revoked
    last_used_at TIMESTAMP,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    revoked_at TIMESTAMP
);

-- Audit Log
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    organization_id UUID REFERENCES organizations(id),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id UUID,
    details JSONB,
    ip_address INET,
    created_at TIMESTAMP DEFAULT NOW()
);
```

---

## Appendix C: Environment Variables

### SaaS Application

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/kph

# Authentication
JWT_SECRET=<random-256-bit-key>
JWT_EXPIRY=15m
REFRESH_TOKEN_EXPIRY=7d

# Email (Invitations)
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=<sendgrid-api-key>
EMAIL_FROM=noreply@kph.f5.com

# Feature Flags
REGISTRATION_MODE=invite_only
ALLOWED_EMAIL_DOMAINS=f5.com,nginx.com
```

### Agent

```bash
# Required
KPH_TOKEN=kph_at_xxxxxxxxxxxx
KPH_CLUSTER_NAME=my-cluster

# Optional
KPH_ENDPOINT=wss://api.kph.f5.com
KPH_LOG_LEVEL=info
KPH_SYNC_INTERVAL=30
```

---

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-01-19 | Dan Henley | Initial draft |
