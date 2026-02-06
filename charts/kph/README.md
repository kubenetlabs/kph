# KPH Helm Chart

Kubernetes Policy Hub - A platform for managing Cilium network policies, Tetragon policies, and Gateway API routes across multiple Kubernetes clusters.

## Prerequisites

- Kubernetes 1.23+
- Helm 3.8+

## Installation

### Quick Start (Anonymous Mode)

```bash
helm install kph ./charts/kph \
  --namespace kph \
  --create-namespace \
  --set database.embedded.enabled=true
```

This deploys KPH with:
- Anonymous authentication (no login required)
- Embedded PostgreSQL database
- LLM and email features disabled

### With External Database

```bash
helm install kph ./charts/kph \
  --namespace kph \
  --create-namespace \
  --set database.embedded.enabled=false \
  --set database.external.enabled=true \
  --set database.external.url="postgresql://user:pass@host:5432/kph"
```

### With Clerk Authentication

```bash
helm install kph ./charts/kph \
  --namespace kph \
  --create-namespace \
  --set auth.provider=clerk \
  --set auth.clerk.publishableKey="pk_..." \
  --set auth.clerk.secretKey="sk_..."
```

### With LLM Support

```bash
helm install kph ./charts/kph \
  --namespace kph \
  --create-namespace \
  --set llm.enabled=true \
  --set llm.provider=anthropic \
  --set llm.apiKey="sk-ant-..."
```

## Configuration

### Global Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `global.imageRegistry` | Global Docker image registry | `""` |
| `global.imagePullSecrets` | Global Docker registry secret names | `[]` |

### Application

| Parameter | Description | Default |
|-----------|-------------|---------|
| `app.enabled` | Enable the KPH application | `true` |
| `app.replicaCount` | Number of app replicas | `1` |
| `app.image.repository` | App image repository | `ghcr.io/kubenetlabs/kph` |
| `app.image.tag` | App image tag (defaults to Chart.appVersion) | `""` |
| `app.service.type` | Kubernetes service type | `ClusterIP` |
| `app.service.port` | Service port | `3000` |
| `app.ingress.enabled` | Enable ingress | `false` |
| `app.autoMigrate` | Run Prisma migrations on startup | `true` |
| `app.resources` | CPU/Memory resources | See values.yaml |

### Authentication

| Parameter | Description | Default |
|-----------|-------------|---------|
| `auth.provider` | Auth provider: `none`, `clerk`, or `oidc` | `none` |
| `auth.clerk.publishableKey` | Clerk publishable key | `""` |
| `auth.clerk.secretKey` | Clerk secret key | `""` |
| `auth.clerk.existingSecret` | Use existing secret for Clerk credentials | `""` |
| `auth.oidc.issuerUrl` | OIDC issuer URL | `""` |
| `auth.oidc.clientId` | OIDC client ID | `""` |
| `auth.oidc.clientSecret` | OIDC client secret | `""` |

### Database

| Parameter | Description | Default |
|-----------|-------------|---------|
| `database.embedded.enabled` | Use embedded PostgreSQL | `true` |
| `database.embedded.image.repository` | PostgreSQL image | `postgres` |
| `database.embedded.image.tag` | PostgreSQL version | `16-alpine` |
| `database.embedded.auth.database` | Database name | `kph` |
| `database.embedded.auth.username` | Database username | `kph` |
| `database.embedded.auth.password` | Database password (auto-generated if empty) | `""` |
| `database.embedded.persistence.enabled` | Enable PVC for database | `true` |
| `database.embedded.persistence.size` | PVC size | `10Gi` |
| `database.external.enabled` | Use external database | `false` |
| `database.external.url` | External database URL | `""` |
| `database.external.existingSecret` | Secret containing database URL | `""` |

### LLM / AI Features

| Parameter | Description | Default |
|-----------|-------------|---------|
| `llm.enabled` | Enable LLM integration | `false` |
| `llm.provider` | LLM provider: `anthropic`, `openai`, `ollama`, `openai-compatible` | `""` |
| `llm.apiKey` | API key for LLM provider | `""` |
| `llm.model` | Model override | `""` |
| `llm.endpoint` | Custom endpoint (for ollama/compatible) | `""` |
| `llm.existingSecret` | Use existing secret for API key | `""` |

### Email

| Parameter | Description | Default |
|-----------|-------------|---------|
| `email.provider` | Email provider: `none`, `resend`, `smtp` | `none` |
| `email.fromAddress` | From address for emails | `Policy Hub <noreply@kph.local>` |
| `email.resend.apiKey` | Resend API key | `""` |

### Security

| Parameter | Description | Default |
|-----------|-------------|---------|
| `security.encryptionKey` | Encryption key for sensitive data | `""` (auto-generated) |
| `security.existingSecret` | Use existing secret for encryption key | `""` |

## Upgrading

```bash
helm upgrade kph ./charts/kph --namespace kph
```

## Uninstalling

```bash
helm uninstall kph --namespace kph
```

**Note:** The embedded database PVC is not deleted by default. To remove all data:

```bash
kubectl delete pvc -l app.kubernetes.io/instance=kph -n kph
```

## Running Tests

```bash
helm test kph -n kph
```
