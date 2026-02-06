# Clerk Authentication Setup

This guide covers setting up Clerk authentication for KPH, enabling OAuth social login and email/password authentication with built-in user management.

## Prerequisites

- Clerk account (sign up at [clerk.com](https://clerk.com))
- KPH installed on Kubernetes
- Public URL for your KPH deployment

## Step 1: Create Clerk Application

1. Go to [Clerk Dashboard](https://dashboard.clerk.com)
2. Click **Create Application**
3. Name your application (e.g., "Kubernetes Policy Hub")
4. Select authentication methods:
   - ✓ Email
   - ✓ Google (recommended)
   - ✓ GitHub (recommended)
   - Additional OAuth providers as needed
5. Click **Create Application**

## Step 2: Get API Keys

From your Clerk application dashboard:

1. Go to **API Keys** section
2. Copy the **Publishable Key** (starts with `pk_`)
3. Copy the **Secret Key** (starts with `sk_`)

## Step 3: Configure Application URLs

In Clerk Dashboard → **Domains**:

1. Add your production domain (e.g., `https://kph.example.com`)
2. For development, add `http://localhost:3000`

Clerk will automatically configure redirect URLs.

## Step 4: Configure KPH

### Option A: Helm Values

Create a `values-clerk.yaml`:

```yaml
app:
  auth:
    provider: "clerk"
    clerk:
      publishableKey: "pk_live_your_publishable_key"
      secretKey: "sk_live_your_secret_key"
```

Install or upgrade KPH:

```bash
helm upgrade kph kph/kph -n kph -f values-clerk.yaml
```

### Option B: Kubernetes Secret

For better security, use a Kubernetes secret:

```bash
# Create secret with Clerk keys
kubectl create secret generic kph-clerk -n kph \
  --from-literal=publishable-key='pk_live_...' \
  --from-literal=secret-key='sk_live_...'
```

Then configure Helm to use the secret:

```yaml
app:
  auth:
    provider: "clerk"
    clerk:
      existingSecret: "kph-clerk"
      publishableKeyKey: "publishable-key"
      secretKeyKey: "secret-key"
```

### Option C: Environment Variables (Docker Compose)

```yaml
# docker-compose.yml
services:
  kph:
    environment:
      - KPH_AUTH_PROVIDER=clerk
      - NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
      - CLERK_SECRET_KEY=sk_live_...
```

## Step 5: Verify Configuration

After deployment, verify Clerk is configured correctly:

```bash
# Check authentication status
kubectl exec -n kph deploy/kph -- \
  wget -qO- http://localhost:3000/api/status/auth | jq
```

Expected response:

```json
{
  "provider": "clerk",
  "configured": true,
  "enabled": true,
  "features": {
    "multiTenant": true,
    "userManagement": true
  },
  "docs": "https://github.com/kubenetlabs/kph/blob/main/docs/auth-clerk.md"
}
```

## Step 6: Test Login

1. Access your KPH deployment
2. You should see a Clerk sign-in page
3. Sign in with email or OAuth provider
4. You'll be redirected to KPH dashboard

## User Management

### First User (Super Admin)

The first user to sign in becomes a **Super Admin** with full system access.

### Invite Additional Users

Super Admins can invite users:

1. Go to **Settings** → **Users**
2. Click **Invite User**
3. Enter email address
4. User receives invitation email via Clerk

### User Roles

Assign roles to users:

- **ORG_ADMIN** - Full organization access
- **ORG_MEMBER** - Read-only organization access

## Customization

### Clerk Appearance

Customize the sign-in appearance in Clerk Dashboard → **Customization**:

- Upload your logo
- Choose color scheme
- Customize text and labels

### OAuth Providers

Add additional OAuth providers in Clerk Dashboard → **User & Authentication** → **Social Connections**:

- Microsoft Azure AD
- Twitter / X
- LinkedIn
- Apple
- And more...

## Environment Variables Reference

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `KPH_AUTH_PROVIDER` | Yes | Authentication provider | `clerk` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | Clerk publishable key | `pk_live_...` |
| `CLERK_SECRET_KEY` | Yes | Clerk secret key | `sk_live_...` |

## Troubleshooting

### Error: Missing NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

**Problem:** Pod fails to start with configuration error.

**Solution:**
```bash
# Check if env var is set correctly
kubectl describe deployment kph -n kph | grep CLERK

# Verify secret exists
kubectl get secret kph-clerk -n kph

# Check pod logs
kubectl logs -n kph deploy/kph --tail=50
```

### Error: Missing CLERK_SECRET_KEY

**Problem:** Same as above, secret key is not configured.

**Solution:** Ensure both publishable and secret keys are provided in Helm values or Kubernetes secret.

### Users Can't Sign In

**Problem:** Users see Clerk error page or can't complete sign-in.

**Solution:**

1. Verify your domain is configured in Clerk Dashboard → **Domains**
2. Check redirect URLs are correct
3. Ensure Clerk application is not in development mode if using production keys

```bash
# Verify deployment URL matches Clerk configuration
kubectl get ingress -n kph
```

### Error: Invalid Publishable Key Format

**Problem:** Clerk API returns invalid key error.

**Solution:**
- Development keys: `pk_test_...`
- Production keys: `pk_live_...`

Ensure you're using the correct environment keys for your deployment.

### Session Timeout Issues

**Problem:** Users are logged out too frequently.

**Solution:** Configure session settings in Clerk Dashboard → **Sessions**:

- Increase session lifetime
- Enable multi-session support
- Configure "Remember me" option

## Development vs Production

### Development Mode

Use test keys for local development:

```yaml
app:
  auth:
    provider: "clerk"
    clerk:
      publishableKey: "pk_test_..."
      secretKey: "sk_test_..."
```

### Production Mode

Use live keys for production:

```yaml
app:
  auth:
    provider: "clerk"
    clerk:
      publishableKey: "pk_live_..."
      secretKey: "sk_live_..."
```

**Important:** Never commit API keys to version control. Use Kubernetes secrets or environment variables.

## Security Best Practices

1. **Use Kubernetes Secrets** for storing Clerk keys
2. **Enable MFA** in Clerk Dashboard for admin users
3. **Configure session timeouts** appropriately for your security requirements
4. **Monitor sign-in logs** in Clerk Dashboard
5. **Rotate keys regularly** (Clerk allows key rotation without downtime)

## Next Steps

- [OIDC Authentication](./auth-oidc.md) - Alternative SSO option
- [Configuration Reference](./configuration.md) - Full configuration options
- [User Management](./user-management.md) - Managing users and roles

## Support

- **Clerk Documentation:** [clerk.com/docs](https://clerk.com/docs)
- **Clerk Support:** Available in Clerk Dashboard
- **KPH Issues:** [GitHub Issues](https://github.com/kubenetlabs/kph/issues)
