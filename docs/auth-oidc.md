# OIDC Authentication Setup

This guide covers setting up OpenID Connect (OIDC) authentication for KPH, enabling Single Sign-On (SSO) with enterprise identity providers.

## Supported Identity Providers

KPH works with any OIDC-compliant identity provider:

- **Okta**
- **Auth0**
- **Azure AD / Entra ID**
- **Keycloak**
- **Google Workspace**
- **AWS Cognito**
- **GitLab**
- **GitHub Enterprise**
- And any other OIDC provider

## Prerequisites

- KPH installed on Kubernetes
- Public URL for your KPH deployment
- Access to your OIDC provider's admin console
- Basic understanding of OAuth 2.0 / OIDC

## Quick Start

1. Register KPH as an application in your identity provider
2. Configure redirect URI: `https://your-kph-domain/api/auth/callback/oidc`
3. Get issuer URL, client ID, and client secret
4. Configure KPH with these credentials
5. Deploy and test

## Configuration Steps

### Step 1: Register Application

In your OIDC provider's admin console:

1. Create a new application/client
2. **Application Type:** Web Application
3. **Redirect URIs:**
   - Production: `https://kph.example.com/api/auth/callback/oidc`
   - Development: `http://localhost:3000/api/auth/callback/oidc`
4. **Grant Types:** Authorization Code
5. **Response Types:** code
6. Note down:
   - Issuer URL / Discovery URL
   - Client ID
   - Client Secret

### Step 2: Configure KPH

#### Option A: Helm Values

Create a `values-oidc.yaml`:

```yaml
app:
  auth:
    provider: "oidc"
    oidc:
      issuerUrl: "https://your-idp.com"
      clientId: "kph-client"
      clientSecret: "your-client-secret"
      # Optional: customize claim mappings
      usernameClaim: "preferred_username"  # default: "sub"
      emailClaim: "email"                  # default: "email"
      nameClaim: "name"                    # default: "name"
```

Deploy:

```bash
helm upgrade kph kph/kph -n kph -f values-oidc.yaml
```

#### Option B: Kubernetes Secret (Recommended)

```bash
# Create secret
kubectl create secret generic kph-oidc -n kph \
  --from-literal=issuer-url='https://your-idp.com' \
  --from-literal=client-id='kph-client' \
  --from-literal=client-secret='your-client-secret'
```

Configure Helm:

```yaml
app:
  auth:
    provider: "oidc"
    oidc:
      existingSecret: "kph-oidc"
      issuerUrlKey: "issuer-url"
      clientIdKey: "client-id"
      clientSecretKey: "client-secret"
```

#### Option C: Environment Variables

```yaml
# docker-compose.yml or Kubernetes env
KPH_AUTH_PROVIDER=oidc
KPH_OIDC_ISSUER_URL=https://your-idp.com
KPH_OIDC_CLIENT_ID=kph-client
KPH_OIDC_CLIENT_SECRET=your-client-secret
```

### Step 3: Verify Configuration

```bash
# Check authentication status
kubectl exec -n kph deploy/kph -- \
  wget -qO- http://localhost:3000/api/status/auth | jq
```

Expected response:

```json
{
  "provider": "oidc",
  "configured": true,
  "enabled": true,
  "features": {
    "multiTenant": true,
    "userManagement": true
  },
  "docs": "https://github.com/kubenetlabs/kph/blob/main/docs/auth-oidc.md"
}
```

### Step 4: Test Login

1. Access your KPH deployment
2. Click **Sign In**
3. You'll be redirected to your OIDC provider
4. Sign in with your corporate credentials
5. Approve scopes if prompted
6. You'll be redirected back to KPH

## Provider-Specific Guides

### Okta

1. Go to **Applications** → **Create App Integration**
2. Select **OIDC** → **Web Application**
3. Configure:
   - **Sign-in redirect URIs:** `https://kph.example.com/api/auth/callback/oidc`
   - **Sign-out redirect URIs:** `https://kph.example.com`
   - **Assignments:** Choose who can access
4. Copy from **General** tab:
   - **Issuer URL:** `https://your-domain.okta.com`
   - **Client ID:** From credentials section
   - **Client Secret:** From credentials section

```yaml
app:
  auth:
    provider: "oidc"
    oidc:
      issuerUrl: "https://your-domain.okta.com"
      clientId: "0oa..."
      clientSecret: "xxx"
```

### Azure AD / Entra ID

1. Go to **Azure Portal** → **Azure Active Directory** → **App registrations**
2. Click **New registration**
3. Configure:
   - **Name:** Kubernetes Policy Hub
   - **Supported account types:** Single tenant
   - **Redirect URI:** Web, `https://kph.example.com/api/auth/callback/oidc`
4. After creation:
   - Copy **Application (client) ID**
   - Copy **Directory (tenant) ID**
   - Go to **Certificates & secrets** → Create new client secret
5. Issuer URL format: `https://login.microsoftonline.com/{tenant-id}/v2.0`

```yaml
app:
  auth:
    provider: "oidc"
    oidc:
      issuerUrl: "https://login.microsoftonline.com/{tenant-id}/v2.0"
      clientId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
      clientSecret: "xxx"
      usernameClaim: "preferred_username"
      emailClaim: "email"
      nameClaim: "name"
```

### Auth0

1. Go to **Applications** → **Create Application**
2. Select **Regular Web Applications**
3. Configure:
   - **Allowed Callback URLs:** `https://kph.example.com/api/auth/callback/oidc`
   - **Allowed Logout URLs:** `https://kph.example.com`
4. Copy from **Settings**:
   - **Domain:** your-tenant.auth0.com
   - **Client ID**
   - **Client Secret**
5. Issuer URL format: `https://{domain}`

```yaml
app:
  auth:
    provider: "oidc"
    oidc:
      issuerUrl: "https://your-tenant.auth0.com"
      clientId: "xxx"
      clientSecret: "xxx"
```

### Keycloak

1. Go to your realm → **Clients** → **Create client**
2. Configure:
   - **Client type:** OpenID Connect
   - **Client ID:** kph
   - **Valid redirect URIs:** `https://kph.example.com/api/auth/callback/oidc`
   - **Access type:** confidential
3. Copy from **Credentials** tab:
   - **Secret**
4. Issuer URL format: `https://keycloak.example.com/realms/{realm-name}`

```yaml
app:
  auth:
    provider: "oidc"
    oidc:
      issuerUrl: "https://keycloak.example.com/realms/master"
      clientId: "kph"
      clientSecret: "xxx"
```

## Claim Mapping

KPH uses OIDC claims to populate user information:

| KPH Field | Default Claim | Configurable |
|-----------|---------------|--------------|
| User ID | `sub` | No (standard) |
| Email | `email` | Yes (`emailClaim`) |
| Name | `name` | Yes (`nameClaim`) |
| Username | `sub` | Yes (`usernameClaim`) |

Example custom mapping:

```yaml
app:
  auth:
    provider: "oidc"
    oidc:
      issuerUrl: "https://your-idp.com"
      clientId: "kph-client"
      clientSecret: "xxx"
      usernameClaim: "preferred_username"  # Use preferred_username instead of sub
      emailClaim: "mail"                    # Some IdPs use "mail" instead of "email"
      nameClaim: "displayName"              # Custom display name claim
```

## Scopes

KPH requests these OIDC scopes by default:

- `openid` - Required for OIDC
- `profile` - User profile information
- `email` - User email address

These are standard scopes and should work with all OIDC providers.

## Environment Variables Reference

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `KPH_AUTH_PROVIDER` | Yes | Authentication provider | `oidc` |
| `KPH_OIDC_ISSUER_URL` | Yes | OIDC provider issuer URL | `https://auth.example.com` |
| `KPH_OIDC_CLIENT_ID` | Yes | OAuth client ID | `kph-client` |
| `KPH_OIDC_CLIENT_SECRET` | Yes | OAuth client secret | `secret123` |
| `KPH_OIDC_USERNAME_CLAIM` | No | Claim for username | `preferred_username` |
| `KPH_OIDC_EMAIL_CLAIM` | No | Claim for email | `email` |
| `KPH_OIDC_NAME_CLAIM` | No | Claim for display name | `name` |

## Troubleshooting

### Error: Missing KPH_OIDC_ISSUER_URL

**Problem:** Pod fails to start with configuration error.

**Solution:**
```bash
# Verify environment variables
kubectl describe deployment kph -n kph | grep OIDC

# Check secret
kubectl get secret kph-oidc -n kph -o yaml

# View pod logs
kubectl logs -n kph deploy/kph --tail=50
```

### Error: Invalid Issuer URL

**Problem:** OIDC discovery fails.

**Solution:**
1. Verify issuer URL format (should end with the realm/tenant path)
2. Test discovery endpoint:
```bash
curl https://your-idp.com/.well-known/openid-configuration
```

Expected: JSON response with authorization and token endpoints.

### Error: Redirect URI Mismatch

**Problem:** After signing in, user sees "redirect_uri_mismatch" error.

**Solution:**
1. Check configured redirect URI in your IdP matches exactly:
   ```
   https://your-kph-domain/api/auth/callback/oidc
   ```
2. Note: URLs are case-sensitive and must match protocol (http vs https)

### Users Can't Sign In

**Problem:** Sign-in button doesn't work or shows error.

**Solution:**

1. Verify OIDC provider is reachable from the cluster:
```bash
kubectl run -it --rm debug --image=curlimages/curl --restart=Never -- \
  curl https://your-idp.com/.well-known/openid-configuration
```

2. Check client credentials are correct
3. Verify user has access to the application in the IdP

### Missing Email or Name

**Problem:** Users sign in but email or name is missing.

**Solution:**
1. Check if your IdP includes these claims:
```bash
# Decode a JWT token from your IdP to see available claims
echo "your-id-token" | base64 -d
```

2. Configure custom claim mapping if your IdP uses different claim names:
```yaml
app:
  auth:
    oidc:
      emailClaim: "mail"  # or "email_address", etc.
      nameClaim: "displayName"  # or "fullName", etc.
```

## Security Best Practices

1. **Use HTTPS** - Always use HTTPS in production
2. **Rotate Secrets** - Regularly rotate client secrets
3. **Limit Scopes** - Only request necessary OIDC scopes
4. **Monitor Access** - Review IdP audit logs regularly
5. **Network Policies** - Restrict egress to IdP endpoints only
6. **Session Timeouts** - Configure appropriate session lifetimes

## Advanced Configuration

### Custom Scopes

Request additional scopes:

```yaml
app:
  auth:
    oidc:
      scopes: ["openid", "profile", "email", "groups"]
```

### Token Validation

KPH validates ID tokens using:
- OIDC discovery (automatic)
- Signature verification (RS256)
- Issuer validation
- Audience validation
- Expiry check

No additional configuration needed for standard OIDC providers.

## Next Steps

- [Clerk Authentication](./auth-clerk.md) - Alternative OAuth option
- [Configuration Reference](./configuration.md) - Full configuration
- [User Management](./user-management.md) - Managing users and roles

## Support

For provider-specific issues, consult your IdP's documentation:

- **Okta:** [developer.okta.com/docs](https://developer.okta.com/docs)
- **Azure AD:** [docs.microsoft.com/azure/active-directory](https://docs.microsoft.com/azure/active-directory)
- **Auth0:** [auth0.com/docs](https://auth0.com/docs)
- **Keycloak:** [keycloak.org/docs](https://www.keycloak.org/docs)

For KPH issues: [GitHub Issues](https://github.com/kubenetlabs/kph/issues)
