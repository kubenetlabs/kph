# KPH Agent Cluster Installation Guide

Complete guide for installing the Kubernetes Policy Hub (KPH) agent on a Kubernetes cluster.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Installation Methods](#installation-methods)
4. [Configuration Reference](#configuration-reference)
5. [API Endpoints](#api-endpoints)
6. [Token Management](#token-management)
7. [Verification & Troubleshooting](#verification--troubleshooting)
8. [Security Considerations](#security-considerations)
9. [Architecture Overview](#architecture-overview)

---

## Prerequisites

### Kubernetes Cluster Requirements

- Kubernetes 1.24+ (tested up to 1.29)
- `kubectl` configured with cluster admin access
- Helm 3.x (for Helm installation method)
- Network access to SaaS endpoint (`https://policy-hub-starter.vercel.app`)

### Optional Components

- **Cilium CNI** - Required for Cilium Network Policy support
- **Hubble** - Required for network flow telemetry
- **Tetragon** - Required for process/syscall event collection

### SaaS Dashboard Setup

1. Create an organization in the KPH dashboard
2. Create a cluster record (name, provider, region, environment)
3. Navigate to the cluster installation wizard

---

## Quick Start

### 1. Get Installation Commands from Dashboard

Navigate to **Clusters > [Your Cluster] > Install** in the dashboard. The wizard will generate commands with your cluster-specific values.

### 2. Set Token Environment Variable

```bash
# Copy the token from the dashboard (shown once)
export KPH_TOKEN='kph_agent_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
```

### 3. Create Namespace and Secret

```bash
kubectl create namespace kph-system --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret generic kph-agent-token \
  --namespace kph-system \
  --from-literal=api-token="${KPH_TOKEN}" \
  --dry-run=client -o yaml | kubectl apply -f -
```

### 4. Install via Helm

```bash
helm install kph-agent oci://409239147779.dkr.ecr.us-east-1.amazonaws.com/kph/kph-agent \
  --version 0.1.3 \
  --namespace kph-system \
  --set agent.clusterId=YOUR_CLUSTER_ID \
  --set agent.clusterName=YOUR_CLUSTER_NAME \
  --set agent.organizationId=YOUR_ORG_ID \
  --set agent.existingSecret=kph-agent-token \
  --set agent.serverUrl=https://policy-hub-starter.vercel.app
```

### 5. Verify Installation

```bash
kubectl get pods -n kph-system
kubectl logs -n kph-system -l app=kph-operator --tail=50
```

---

## Installation Methods

### Method 1: Helm Chart (Recommended)

Best for production deployments with full configuration control.

**Step 1: Create the token secret first**
```bash
export KPH_TOKEN='kph_agent_...'

kubectl create namespace kph-system --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret generic kph-agent-token \
  --namespace kph-system \
  --from-literal=api-token="${KPH_TOKEN}" \
  --dry-run=client -o yaml | kubectl apply -f -
```

**Step 2: Install the Helm chart**
```bash
helm install kph-agent oci://409239147779.dkr.ecr.us-east-1.amazonaws.com/kph/kph-agent \
  --version 0.1.3 \
  --namespace kph-system \
  --set agent.clusterId=cls_xxx \
  --set agent.clusterName=my-cluster \
  --set agent.organizationId=org_xxx \
  --set agent.existingSecret=kph-agent-token \
  --set agent.serverUrl=https://policy-hub-starter.vercel.app \
  --set agent.syncInterval=60 \
  --set agent.logLevel=info
```

### Method 2: Values File (GitOps)

Best for GitOps workflows (ArgoCD, Flux).

**values.yaml**
```yaml
agent:
  clusterId: "cls_xxx"
  clusterName: "my-cluster"
  organizationId: "org_xxx"
  existingSecret: "kph-agent-token"
  serverUrl: "https://policy-hub-starter.vercel.app"
  syncInterval: 60
  heartbeatInterval: 60
  logLevel: info

namespace: kph-system

operator:
  replicas: 1
  resources:
    requests:
      cpu: 100m
      memory: 64Mi
    limits:
      cpu: 500m
      memory: 256Mi

collector:
  enabled: true
  resources:
    requests:
      cpu: 100m
      memory: 512Mi
    limits:
      cpu: 1
      memory: 2Gi

telemetry:
  enabled: true
  hubble:
    enabled: true
    address: "hubble-relay.kube-system.svc.cluster.local:80"
  tetragon:
    enabled: false
  storage:
    retentionDays: 7
    maxStorageGb: 10

features:
  policySync: true
  admissionWebhook: true
  auditLogging: true
  simulation: true
  validation: true
```

**Install with values file:**
```bash
helm install kph-agent oci://409239147779.dkr.ecr.us-east-1.amazonaws.com/kph/kph-agent \
  --version 0.1.3 \
  --namespace kph-system \
  -f values.yaml
```

### Method 3: kubectl Apply

For environments without Helm.

```bash
# Create namespace
kubectl create namespace kph-system

# Create token secret
kubectl create secret generic kph-agent-token \
  --namespace kph-system \
  --from-literal=api-token="${KPH_TOKEN}"

# Apply manifests from server
kubectl apply -f "https://policy-hub-starter.vercel.app/api/install/manifest?clusterId=cls_xxx&orgId=org_xxx"
```

---

## Configuration Reference

### Helm Values

| Parameter | Description | Default |
|-----------|-------------|---------|
| `agent.clusterId` | Cluster UUID from SaaS | Required |
| `agent.clusterName` | Friendly cluster name | Required |
| `agent.organizationId` | Organization UUID | Required |
| `agent.token` | API token (not recommended) | `""` |
| `agent.existingSecret` | Secret name containing token | `""` |
| `agent.serverUrl` | SaaS endpoint URL | `https://policy-hub-starter.vercel.app` |
| `agent.syncInterval` | Policy sync interval (seconds) | `30` |
| `agent.heartbeatInterval` | Heartbeat interval (seconds) | `60` |
| `agent.logLevel` | Log level (debug/info/warn/error) | `info` |
| `namespace` | Kubernetes namespace | `kph-system` |
| `operator.replicas` | Operator pod replicas | `1` |
| `collector.enabled` | Enable telemetry collector | `true` |
| `telemetry.hubble.enabled` | Enable Hubble flow collection | `true` |
| `telemetry.hubble.address` | Hubble relay address | `hubble-relay.kube-system.svc.cluster.local:80` |
| `telemetry.tetragon.enabled` | Enable Tetragon events | `false` |
| `telemetry.storage.retentionDays` | Local storage retention | `7` |
| `telemetry.storage.maxStorageGb` | Max local storage | `10` |
| `features.policySync` | Enable policy synchronization | `true` |
| `features.admissionWebhook` | Enable admission webhook | `true` |
| `features.simulation` | Enable policy simulation | `true` |
| `features.validation` | Enable policy validation | `true` |

### Environment Variables (Operator)

| Variable | Source | Description |
|----------|--------|-------------|
| `CLUSTER_ID` | Secret: kph-agent-config | Cluster UUID |
| `CLUSTER_NAME` | Secret: kph-agent-config | Cluster name |
| `ORGANIZATION_ID` | Secret: kph-agent-config | Organization UUID |
| `SAAS_ENDPOINT` | Secret: kph-agent-config | SaaS server URL |
| `SAAS_API_KEY` | Secret: kph-agent-token | API token |

### Environment Variables (Collector)

| Variable | Source | Description |
|----------|--------|-------------|
| `HUBBLE_ADDRESS` | ConfigMap | Hubble relay address |
| `HUBBLE_ENABLED` | ConfigMap | Enable Hubble collection |
| `TETRAGON_ADDRESS` | ConfigMap | Tetragon socket path |
| `TETRAGON_ENABLED` | ConfigMap | Enable Tetragon collection |
| `STORAGE_PATH` | ConfigMap | Local telemetry storage path |
| `RETENTION_DAYS` | ConfigMap | Data retention period |
| `LOG_LEVEL` | ConfigMap | Logging verbosity |

---

## API Endpoints

### Operator Authentication

All operator API calls require a Bearer token:
```
Authorization: Bearer kph_agent_xxxxx
```

### POST /api/operator/bootstrap

Initial cluster registration (called once at first startup).

**Request:**
```json
{
  "clusterName": "eks-prod-us-east-1",
  "operatorVersion": "0.1.0",
  "kubernetesVersion": "1.27.0",
  "nodeCount": 10,
  "namespaceCount": 25,
  "provider": "AWS",
  "region": "us-east-1",
  "environment": "PRODUCTION"
}
```

**Response:**
```json
{
  "success": true,
  "cluster": {
    "id": "cls_abc123",
    "name": "eks-prod-us-east-1",
    "operatorId": "op_xyz789"
  },
  "clusterToken": "kph_agent_NEW_TOKEN...",
  "config": {
    "syncInterval": 30,
    "heartbeatInterval": 60
  }
}
```

### POST /api/operator/register

Operator registration at startup (after bootstrap).

**Request:**
```json
{
  "operatorVersion": "0.1.0",
  "kubernetesVersion": "1.27.0",
  "nodeCount": 10,
  "namespaceCount": 25
}
```

**Response:**
```json
{
  "success": true,
  "operatorId": "op_xyz789",
  "clusterId": "cls_abc123",
  "syncInterval": 30,
  "heartbeatInterval": 60
}
```

### POST /api/operator/heartbeat

Periodic health status updates (every 60 seconds).

**Request:**
```json
{
  "operatorVersion": "0.1.0",
  "kubernetesVersion": "1.27.0",
  "nodeCount": 10,
  "namespaceCount": 25,
  "managedPoliciesCount": 5,
  "status": "healthy",
  "error": null
}
```

**Response:**
```json
{
  "success": true,
  "clusterId": "cls_abc123",
  "clusterStatus": "CONNECTED",
  "pendingPoliciesCount": 2,
  "nextHeartbeat": 60
}
```

### GET /api/operator/policies

Fetch policies to deploy.

**Response:**
```json
{
  "success": true,
  "policies": [
    {
      "id": "pol_xyz123",
      "name": "Allow frontend to backend",
      "type": "CILIUM_NETWORK_POLICY",
      "status": "PENDING",
      "content": "apiVersion: cilium.io/v2\nkind: CiliumNetworkPolicy\n...",
      "version": 2
    }
  ],
  "count": 1
}
```

### PATCH /api/operator/policies/{id}/status

Update policy deployment status.

**Request:**
```json
{
  "status": "DEPLOYED",
  "error": null,
  "deployedResources": [
    {
      "apiVersion": "cilium.io/v2",
      "kind": "CiliumNetworkPolicy",
      "name": "allow-frontend-to-backend",
      "namespace": "default"
    }
  ],
  "version": 2
}
```

**Response:**
```json
{
  "success": true,
  "policyId": "pol_xyz123",
  "status": "DEPLOYED",
  "deployedVersion": 2
}
```

---

## Token Management

### Token Types

| Type | Prefix | Purpose | Default Expiry |
|------|--------|---------|----------------|
| Registration | `kph_reg_` | Initial cluster setup | 7 days |
| Agent | `kph_agent_` | Operator authentication | 1 year |
| API | `kph_api_` | External API access | 90 days |

### Token Scopes (Agent)

| Scope | Description |
|-------|-------------|
| `cluster:read` | Read cluster information |
| `cluster:write` | Update cluster status, heartbeat |
| `policy:read` | Fetch policies |
| `policy:write` | Update policy status |
| `flow:write` | Send flow telemetry |
| `telemetry:write` | Send telemetry aggregates |
| `simulation:read` | Fetch simulation requests |
| `simulation:write` | Submit simulation results |
| `validation:write` | Submit validation results |

### Token Security

- Tokens are shown **once** during creation
- Only SHA-256 hashes are stored in the database
- Tokens can be revoked immediately from the dashboard
- Use `existingSecret` to avoid tokens in Helm values/history

### Rotating Tokens

1. Generate new token in dashboard
2. Update the Kubernetes secret:
   ```bash
   kubectl create secret generic kph-agent-token \
     --namespace kph-system \
     --from-literal=api-token="${NEW_KPH_TOKEN}" \
     --dry-run=client -o yaml | kubectl apply -f -
   ```
3. Restart operator pod:
   ```bash
   kubectl rollout restart deployment/kph-operator -n kph-system
   ```
4. Revoke old token in dashboard

---

## Verification & Troubleshooting

### Verify Installation

**Check pods are running:**
```bash
kubectl get pods -n kph-system
```

Expected output:
```
NAME                            READY   STATUS    RESTARTS   AGE
kph-operator-5d4f6c7b8-x2z9k   1/1     Running   0          2m
kph-collector-abc12            1/1     Running   0          2m
kph-collector-def34            1/1     Running   0          2m
```

**Check operator logs:**
```bash
kubectl logs -n kph-system -l app=kph-operator --tail=100
```

Expected log messages:
```
INFO  Starting KPH Operator v0.1.0
INFO  Successfully bootstrapped with SaaS platform
INFO  Successfully registered with SaaS platform
INFO  Starting heartbeat loop (interval: 60s)
INFO  Starting policy sync loop (interval: 30s)
```

**Check collector logs:**
```bash
kubectl logs -n kph-system -l app=kph-collector --tail=100
```

**Check dashboard:**
- Cluster status should show `CONNECTED` (green)
- Last heartbeat should be < 2 minutes ago

### Common Issues

#### ImagePullBackOff

**Symptoms:** Pod stuck in `ImagePullBackOff` status

**Cause:** Cannot pull container image from ECR

**Solution:**
```bash
# Check if you have ECR access
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin 409239147779.dkr.ecr.us-east-1.amazonaws.com

# For EKS, ensure the node IAM role has ECR read access
```

#### CrashLoopBackOff

**Symptoms:** Pod repeatedly crashes

**Cause:** Usually configuration or authentication issues

**Solution:**
```bash
# Check logs for specific error
kubectl logs -n kph-system -l app=kph-operator --previous

# Common causes:
# - Invalid token (check kph-agent-token secret)
# - Wrong cluster ID or org ID
# - Cannot reach SaaS endpoint (network policy?)
```

#### Cluster shows DISCONNECTED

**Symptoms:** Dashboard shows cluster as disconnected

**Cause:** No heartbeat received in > 5 minutes

**Solution:**
```bash
# Check operator is running
kubectl get pods -n kph-system -l app=kph-operator

# Check logs for heartbeat errors
kubectl logs -n kph-system -l app=kph-operator | grep -i heartbeat

# Check network connectivity to SaaS
kubectl exec -n kph-system deploy/kph-operator -- \
  wget -q -O- https://policy-hub-starter.vercel.app/api/health
```

#### Policies not deploying

**Symptoms:** Policies stuck in PENDING status

**Cause:** Operator not syncing or RBAC issues

**Solution:**
```bash
# Check operator logs for sync errors
kubectl logs -n kph-system -l app=kph-operator | grep -i policy

# Check RBAC permissions
kubectl auth can-i create ciliumnetworkpolicies \
  --as=system:serviceaccount:kph-system:kph-operator

# Manually trigger sync by restarting operator
kubectl rollout restart deployment/kph-operator -n kph-system
```

---

## Security Considerations

### Token Security

- **Never commit tokens** to version control
- Use `existingSecret` instead of `agent.token` in Helm values
- Set token via environment variable to avoid shell history:
  ```bash
  read -s KPH_TOKEN  # Type token, press Enter (not shown)
  export KPH_TOKEN
  ```

### Network Security

- All API calls use HTTPS/TLS
- Consider network policies to restrict operator egress
- Telemetry data stays in-cluster (only aggregates sent to SaaS)

### RBAC

The operator uses least-privilege RBAC:
- Read-only access to most resources
- Write access only to policies and secrets it manages
- No privileged container access

### Pod Security

- Operator runs as non-root user (UID 65534)
- Read-only root filesystem
- No privileged mode
- Security context enforced

---

## Architecture Overview

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                    KUBERNETES CLUSTER                       │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   kph-system namespace               │   │
│  │                                                       │   │
│  │  ┌─────────────────┐    ┌─────────────────────────┐ │   │
│  │  │  kph-operator   │    │    kph-collector        │ │   │
│  │  │  (Deployment)   │    │    (DaemonSet)          │ │   │
│  │  │                 │    │                         │ │   │
│  │  │ - Policy sync   │    │ - Hubble flows          │ │   │
│  │  │ - Heartbeat     │    │ - Tetragon events       │ │   │
│  │  │ - Status update │    │ - Local storage         │ │   │
│  │  └────────┬────────┘    └────────────┬────────────┘ │   │
│  │           │                          │               │   │
│  │           │   HTTPS/TLS              │               │   │
│  │           │                          │               │   │
│  └───────────┼──────────────────────────┼───────────────┘   │
│              │                          │                    │
└──────────────┼──────────────────────────┼────────────────────┘
               │                          │
               ▼                          ▼
┌─────────────────────────────────────────────────────────────┐
│                      KPH SaaS Platform                      │
│                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────┐  │
│  │  /api/operator  │  │    Dashboard    │  │  Database  │  │
│  │  - bootstrap    │  │  - Clusters     │  │  - Policies│  │
│  │  - register     │  │  - Policies     │  │  - Tokens  │  │
│  │  - heartbeat    │  │  - Topology     │  │  - Audit   │  │
│  │  - policies     │  │  - Simulation   │  │            │  │
│  └─────────────────┘  └─────────────────┘  └────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Installation**: User runs Helm install with cluster credentials
2. **Bootstrap**: Operator registers with SaaS, receives cluster token
3. **Heartbeat**: Every 60s, operator sends status to SaaS
4. **Policy Sync**: Every 30s, operator fetches and applies policies
5. **Telemetry**: Collector gathers flows, stores locally, sends hourly aggregates

### Cluster Status States

| Status | Description |
|--------|-------------|
| `PENDING` | Cluster created, operator not yet installed |
| `CONNECTED` | Heartbeat received within last 5 minutes |
| `DEGRADED` | Operator reporting degraded status |
| `ERROR` | Operator reporting error or stale heartbeat (>2 hours) |
| `DISCONNECTED` | No heartbeat for >15 minutes |

---

## Upgrading

### Upgrade Helm Release

```bash
helm upgrade kph-agent oci://409239147779.dkr.ecr.us-east-1.amazonaws.com/kph/kph-agent \
  --version 0.1.4 \
  --namespace kph-system \
  --reuse-values
```

### Uninstall

```bash
# Remove Helm release
helm uninstall kph-agent -n kph-system

# Remove secrets and namespace
kubectl delete secret kph-agent-token kph-agent-config -n kph-system
kubectl delete namespace kph-system

# Remove CRDs (if installed)
kubectl delete crd policyhubconfigs.policyhub.io managedpolicies.policyhub.io
```

---

## Support

- **Dashboard**: https://policy-hub-starter.vercel.app
- **GitHub Issues**: https://github.com/henleda/kubernetes-policy-hub/issues
- **Documentation**: See `docs/` directory in repository
