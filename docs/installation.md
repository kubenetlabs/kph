# KPH Installation Guide

This guide covers installing Kubernetes Policy Hub (KPH) using Helm on any Kubernetes cluster.

## Prerequisites

- Kubernetes cluster (1.24+)
- Helm 3.8+
- kubectl configured to access your cluster
- 2 CPU / 4GB RAM minimum

## Quick Start

Install KPH with default settings (anonymous mode, embedded database):

```bash
# Add the KPH Helm repository
helm repo add kph https://kubenetlabs.github.io/kph
helm repo update

# Install KPH
helm install kph kph/kph --namespace kph --create-namespace

# Wait for pods to be ready (takes 1-2 minutes)
kubectl wait --for=condition=ready pod \
  -l app.kubernetes.io/instance=kph \
  -n kph \
  --timeout=300s
```

## Access the Application

After installation, follow the instructions from `helm status kph -n kph` to access the UI:

```bash
# Port forward to access locally
export POD_NAME=$(kubectl get pods --namespace kph -l "app.kubernetes.io/name=kph,app.kubernetes.io/instance=kph,app.kubernetes.io/component=app" -o jsonpath="{.items[0].metadata.name}")
kubectl --namespace kph port-forward $POD_NAME 8080:3000

# Visit http://localhost:8080
```

## Verification Steps

After installation, verify everything is working:

### 1. Check Pod Status

```bash
kubectl get pods -n kph -l app.kubernetes.io/instance=kph
```

Expected: All pods in "Running" state

### 2. Verify Database Connectivity

```bash
kubectl exec -n kph deploy/kph-db -- pg_isready -U kph
```

Expected: "accepting connections"

### 3. Check Application Health

```bash
kubectl exec -n kph deploy/kph -- wget -qO- http://localhost:3000/api/health
```

Expected: `{"status":"ok", ...}`

### 4. Run Helm Tests

```bash
helm test kph -n kph
```

Expected: Test pods succeed

## Installation Timing

- Database ready: ~30-45 seconds
- Application ready: ~60-90 seconds
- Total install time: ~2-3 minutes

If pods are not ready after 5 minutes, check logs:

```bash
kubectl logs -n kph deploy/kph --tail=50
```

## Configuration

KPH supports various configuration options:

- **Authentication**: Anonymous (default), Clerk, OIDC
- **Database**: Embedded PostgreSQL (default), External PostgreSQL
- **LLM**: Optional AI features (Anthropic, OpenAI, Ollama)
- **Email**: Optional notifications (Resend, SMTP)

See [Configuration Guide](./configuration.md) for detailed options.

## Next Steps

- [Configure Authentication](./authentication.md)
- [Set Up LLM Integration](./byom-llm-setup.md)
- [Configure Email Notifications](./email-setup.md)
- [Verification Guide](./verification.md)
- [Troubleshooting](./troubleshooting.md)

## Upgrade

```bash
helm repo update
helm upgrade kph kph/kph -n kph
```

## Uninstall

```bash
helm uninstall kph -n kph
```

Note: This will delete the namespace and all data. Back up your database first if needed.
