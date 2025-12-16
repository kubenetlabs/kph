# Policy Hub Operator Bootstrap Guide

This document describes how the Policy Hub operator self-registration (bootstrap) flow works and how to use it.

## Overview

The bootstrap flow allows the Policy Hub operator to automatically register with the SaaS platform and create a cluster connection, without requiring users to manually configure cluster credentials in the UI first.

### Benefits

- **Simpler setup**: No need to obtain Kubernetes service account tokens or configure cluster credentials in the SaaS UI
- **Self-registration**: Operator registers itself when deployed
- **Multiple clusters**: One registration token can be used to bootstrap multiple clusters
- **Automatic token management**: Cluster-specific tokens are generated and managed automatically

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Policy Hub SaaS                                    │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                         Registration Tokens                             │ │
│  │  • Organization-level tokens                                            │ │
│  │  • Scope: cluster:create                                                │ │
│  │  • Can be used to register multiple clusters                           │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│                                    ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                      POST /api/operator/bootstrap                       │ │
│  │  • Validates registration token                                         │ │
│  │  • Creates cluster record                                               │ │
│  │  • Generates cluster-specific token                                     │ │
│  │  • Returns token + cluster ID                                          │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│                                    ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                         Cluster Tokens                                  │ │
│  │  • Cluster-specific tokens                                              │ │
│  │  • Scopes: cluster:read, cluster:write, policy:read, flow:write        │ │
│  │  • Used for ongoing communication                                       │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ HTTPS
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Kubernetes Cluster                                    │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                      Policy Hub Operator                                │ │
│  │                                                                          │ │
│  │  1. Read registration token from secret                                 │ │
│  │  2. Call /api/operator/bootstrap                                        │ │
│  │  3. Receive cluster token                                               │ │
│  │  4. Store cluster token in secret                                       │ │
│  │  5. Begin normal operation (sync, heartbeat, flows)                     │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Setup Instructions

### Step 1: Create a Registration Token

1. Log in to Policy Hub
2. Navigate to **Clusters** > **Registration Tokens** tab
3. Click **Create Token**
4. Enter a name (e.g., "Production clusters")
5. Optionally set an expiration (leave empty for no expiration)
6. Click **Create Token**
7. **IMPORTANT**: Copy the token immediately - it will only be shown once!

### Step 2: Deploy the Operator

#### Option A: Using kubectl

```bash
# Create namespace
kubectl create namespace policy-hub-system

# Create the registration token secret
kubectl create secret generic policy-hub-registration \
  --namespace policy-hub-system \
  --from-literal=registration-token=phub_YOUR_TOKEN_HERE

# Apply the operator manifests
kubectl apply -f https://raw.githubusercontent.com/policy-hub/operator/main/deploy/operator.yaml

# Create the PolicyHubConfig
cat <<EOF | kubectl apply -f -
apiVersion: policyhub.io/v1alpha1
kind: PolicyHubConfig
metadata:
  name: policy-hub-config
  namespace: policy-hub-system
spec:
  saasEndpoint: https://your-policy-hub-instance.com
  clusterName: my-production-cluster
  registrationTokenSecretRef:
    name: policy-hub-registration
    key: registration-token
  provider: AWS
  region: us-east-1
  environment: PRODUCTION
  syncInterval: 30s
  heartbeatInterval: 60s
EOF
```

#### Option B: Using Helm

```bash
# Add the Policy Hub Helm repository
helm repo add policy-hub https://charts.policy-hub.io
helm repo update

# Create namespace
kubectl create namespace policy-hub-system

# Create the registration token secret
kubectl create secret generic policy-hub-registration \
  --namespace policy-hub-system \
  --from-literal=registration-token=phub_YOUR_TOKEN_HERE

# Install the operator
helm install policy-hub-operator policy-hub/operator \
  --namespace policy-hub-system \
  --set config.saasEndpoint=https://your-policy-hub-instance.com \
  --set config.clusterName=my-production-cluster \
  --set config.registrationTokenSecretRef.name=policy-hub-registration \
  --set config.registrationTokenSecretRef.key=registration-token \
  --set config.provider=AWS \
  --set config.region=us-east-1 \
  --set config.environment=PRODUCTION
```

### Step 3: Verify Installation

```bash
# Check the operator pod is running
kubectl get pods -n policy-hub-system

# Check the PolicyHubConfig status
kubectl get policyhubconfig -n policy-hub-system

# View detailed status
kubectl describe policyhubconfig policy-hub-config -n policy-hub-system
```

The status should show:
- `phase: Registered` or `phase: Syncing`
- `bootstrapped: true`
- `clusterId: cl_...` (the assigned cluster ID)

## How It Works

### Bootstrap Flow

1. **Operator starts**: Reads the `PolicyHubConfig` resource
2. **Detects bootstrap mode**: Sees `clusterName` + `registrationTokenSecretRef` (no `clusterId`)
3. **Reads registration token**: From the secret reference
4. **Calls bootstrap endpoint**: `POST /api/operator/bootstrap` with cluster metadata
5. **Receives response**: Cluster ID, operator ID, and cluster-specific token
6. **Stores cluster token**: Creates/updates a secret with the new token
7. **Updates status**: Sets `clusterId`, `bootstrapped: true`, etc.
8. **Begins normal operation**: Sync policies, send heartbeats, collect flows

### Token Types

| Token Type | Scope | Usage |
|------------|-------|-------|
| Registration Token | `cluster:create` | Bootstrap new clusters (org-level) |
| Cluster Token | `cluster:read`, `cluster:write`, `policy:read`, `policy:write`, `flow:write` | Ongoing cluster operations |

### Security Considerations

- Registration tokens can create new clusters - protect them accordingly
- Registration tokens can be revoked without affecting existing clusters
- Cluster tokens are automatically generated during bootstrap
- Each cluster gets its own unique token
- Tokens are stored in Kubernetes secrets

## PolicyHubConfig CRD Reference

### Bootstrap Mode Fields

```yaml
spec:
  # Required for bootstrap mode
  clusterName: string          # Name for the cluster (shown in UI)
  registrationTokenSecretRef:
    name: string               # Secret name
    key: string                # Key in secret containing token
    namespace: string          # Optional: defaults to PolicyHubConfig namespace

  # Optional cluster metadata
  provider: string             # AWS, GCP, AZURE, ON_PREM, OTHER
  region: string               # Cloud region
  environment: string          # DEVELOPMENT, STAGING, PRODUCTION, TESTING
```

### Legacy Mode Fields

```yaml
spec:
  # Required for legacy mode (cluster already exists in SaaS)
  clusterId: string            # Cluster ID from SaaS
  apiTokenSecretRef:
    name: string               # Secret name
    key: string                # Key in secret containing token
```

### Status Fields

```yaml
status:
  phase: string               # Initializing, Bootstrapping, Registered, Syncing, Error
  bootstrapped: bool          # True if bootstrap completed
  clusterId: string           # Cluster ID (from bootstrap or spec)
  clusterName: string         # Cluster name
  operatorId: string          # Unique operator instance ID
  lastHeartbeat: timestamp    # Last successful heartbeat
  lastSync: timestamp         # Last successful policy sync
  managedPolicies: int        # Number of policies being managed
  conditions: []              # Kubernetes-style conditions
  message: string             # Additional status information
```

## Troubleshooting

### Operator Not Registering

1. Check the operator logs:
   ```bash
   kubectl logs -n policy-hub-system deployment/policy-hub-operator
   ```

2. Verify the registration token is correct:
   ```bash
   kubectl get secret policy-hub-registration -n policy-hub-system -o yaml
   ```

3. Check the PolicyHubConfig status:
   ```bash
   kubectl describe policyhubconfig policy-hub-config -n policy-hub-system
   ```

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "Invalid or missing registration token" | Token not found or revoked | Create a new registration token in the UI |
| "Cluster already registered" | Cluster name already exists | Use a different cluster name or delete the existing cluster |
| "Bootstrap failed: token expired" | Registration token has expired | Create a new registration token |

## Migration from Legacy Mode

If you have existing clusters using the legacy mode (with `clusterId` and `apiTokenSecretRef`), you can continue using them. The operator supports both modes.

To migrate an existing cluster to bootstrap mode:
1. Delete the existing PolicyHubConfig
2. Delete the existing cluster in the SaaS UI
3. Deploy using bootstrap mode with the same cluster name

Note: Migrating will generate a new cluster ID, so policy deployment history will be reset.
