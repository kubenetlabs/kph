# KPH Configuration Reference

Complete reference for configuring Kubernetes Policy Hub.

## Configuration Methods

KPH can be configured via:

1. **Helm Values** - Primary method for Kubernetes deployments
2. **Environment Variables** - For Docker Compose or standalone deployments
3. **Kubernetes Secrets** - For sensitive values like API keys

## Core Configuration

### Authentication

Control user authentication and access:

```yaml
# values.yaml
app:
  auth:
    provider: "none"  # Options: none, clerk, oidc
```

**Environment Variable:** `KPH_AUTH_PROVIDER`

**Options:**
- `none` - Anonymous mode (default), suitable for single-user or VPN-protected deployments
- `clerk` - Clerk authentication with OAuth and email
- `oidc` - OpenID Connect authentication

See: [Authentication Guide](./authentication.md)

### Database

#### Embedded PostgreSQL (Default)

```yaml
database:
  embedded:
    enabled: true
    auth:
      username: kph
      database: kph
      passwordKey: postgres-password
    storage:
      size: 10Gi
```

#### External PostgreSQL

```yaml
database:
  embedded:
    enabled: false
  external:
    enabled: true
    url: "postgresql://user:pass@host:5432/kph"
    # OR use existing secret:
    existingSecret: "my-db-secret"
    urlKey: "database-url"
```

**Environment Variable:** `DATABASE_URL`

### Security

#### Encryption Key

Used for encrypting sensitive data at rest:

```yaml
security:
  encryptionKey: "your-32-character-key-here"
  # OR use existing secret:
  existingSecret: "my-security-secret"
```

**Environment Variable:** `ENCRYPTION_KEY`

If not provided, a random key is auto-generated (not recommended for production with multiple replicas).

## Optional Features

### LLM Integration

Enable AI-powered policy generation and recommendations:

```yaml
app:
  llm:
    provider: "anthropic"  # Options: anthropic, openai, ollama, openai-compatible
    apiKey: "sk-ant-..."   # API key for cloud providers
    # For Ollama or OpenAI-compatible:
    endpoint: "http://ollama:11434"
```

**Environment Variables:**
- `KPH_LLM_PROVIDER` - Provider name
- `KPH_LLM_API_KEY` - API key (or `ANTHROPIC_API_KEY` for Anthropic)
- `KPH_LLM_ENDPOINT` - Custom endpoint URL

See: [LLM Setup Guide](./byom-llm-setup.md)

### Email Notifications

Send policy deployment notifications and user invitations:

```yaml
app:
  email:
    provider: "resend"  # Options: resend, smtp, none
    # For Resend:
    resendApiKey: "re_..."
    # For SMTP:
    smtp:
      host: "smtp.gmail.com"
      port: 587
      user: "your-email@gmail.com"
      password: "your-app-password"
```

**Environment Variables:**
- `KPH_EMAIL_PROVIDER` - Provider name
- `RESEND_API_KEY` - Resend API key
- `KPH_SMTP_HOST` - SMTP server host
- `KPH_SMTP_PORT` - SMTP server port (default: 587)
- `KPH_SMTP_USER` - SMTP username
- `KPH_SMTP_PASSWORD` - SMTP password

See: [Email Setup Guide](./email-setup.md)

## Deployment Options

### Replicas

Scale the application for high availability:

```yaml
app:
  replicaCount: 3
```

Note: Database migrations are handled by a pre-install Job to prevent race conditions.

### Resources

Customize resource requests and limits:

```yaml
app:
  resources:
    requests:
      cpu: 100m
      memory: 256Mi
    limits:
      cpu: 1000m
      memory: 1Gi

database:
  resources:
    requests:
      cpu: 100m
      memory: 256Mi
    limits:
      cpu: 500m
      memory: 512Mi
```

### Image Configuration

```yaml
app:
  image:
    registry: ghcr.io
    repository: kubenetlabs/kph
    tag: "1.0.0"
    pullPolicy: IfNotPresent

global:
  imagePullSecrets:
    - name: my-registry-secret
```

### Ingress

Expose KPH externally:

```yaml
app:
  ingress:
    enabled: true
    className: "nginx"
    hosts:
      - host: kph.example.com
        paths:
          - path: /
            pathType: Prefix
    tls:
      - secretName: kph-tls
        hosts:
          - kph.example.com
```

## Advanced Configuration

### Auto-Migration

Control database migration behavior:

```yaml
app:
  autoMigrate: true  # Run migrations on install/upgrade (default)
```

**Environment Variable:** `KPH_AUTO_MIGRATE`

Set to `false` to run migrations manually:

```bash
kubectl exec -n kph deploy/kph -- node node_modules/prisma/build/index.js migrate deploy
```

### Health Checks

Customize health check behavior:

```yaml
app:
  livenessProbe:
    initialDelaySeconds: 15
    periodSeconds: 10
    timeoutSeconds: 5
    failureThreshold: 3

  readinessProbe:
    initialDelaySeconds: 10
    periodSeconds: 5
    timeoutSeconds: 3
    failureThreshold: 3

  startupProbe:
    initialDelaySeconds: 5
    periodSeconds: 2
    timeoutSeconds: 3
    failureThreshold: 30
```

### Extra Environment Variables

Add custom environment variables:

```yaml
app:
  extraEnv:
    - name: NODE_OPTIONS
      value: "--max-old-space-size=4096"
    - name: LOG_LEVEL
      value: "debug"
```

## Configuration Validation

KPH validates configuration at startup and provides clear error messages with documentation links if anything is missing or misconfigured.

Check configuration status:

```bash
# Overall health
kubectl exec -n kph deploy/kph -- wget -qO- http://localhost:3000/api/health

# Auth status
kubectl exec -n kph deploy/kph -- wget -qO- http://localhost:3000/api/status/auth

# LLM status
kubectl exec -n kph deploy/kph -- wget -qO- http://localhost:3000/api/status/llm

# Email status
kubectl exec -n kph deploy/kph -- wget -qO- http://localhost:3000/api/status/email
```

## Example Configurations

### Production with Clerk Auth

```yaml
app:
  auth:
    provider: clerk
    clerk:
      publishableKey: "pk_live_..."
      secretKey: "sk_live_..."
  replicaCount: 3

database:
  external:
    enabled: true
    existingSecret: "kph-db-secret"

security:
  existingSecret: "kph-security"
```

### Development with LLM

```yaml
app:
  auth:
    provider: none
  llm:
    provider: anthropic
    apiKey: "sk-ant-..."

database:
  embedded:
    enabled: true
```

## Next Steps

- [Authentication Setup](./authentication.md)
- [LLM Integration](./byom-llm-setup.md)
- [Email Configuration](./email-setup.md)
- [Troubleshooting](./troubleshooting.md)
