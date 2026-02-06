# Authentication

KPH supports multiple authentication providers to fit different deployment scenarios.

## Authentication Providers

### Anonymous Mode (Default)

No authentication required - all users access the system as a default admin user.

**Use Cases:**
- Local development
- Single-user deployments
- Deployments behind VPN or reverse proxy with external auth
- Proof of concept / testing

**Configuration:**

```yaml
# values.yaml
app:
  auth:
    provider: "none"
```

**Features:**
- ✓ Immediate access, no login required
- ✓ Simple setup
- ✗ No multi-tenancy
- ✗ No user management
- ✗ Not suitable for multi-user production deployments

**Default User:**
- Email: `admin@kph.local`
- Role: Org Admin + Super Admin
- Organization: Default Organization

### Clerk Authentication

Modern authentication with OAuth providers and email/password.

**Use Cases:**
- Production SaaS deployments
- Multi-tenant environments
- Organizations requiring social login (Google, GitHub, etc.)

**Features:**
- ✓ OAuth providers (Google, GitHub, Microsoft, etc.)
- ✓ Email/password authentication
- ✓ Multi-factor authentication (MFA)
- ✓ User management UI
- ✓ Multi-tenancy support
- ✓ Session management

See: [Clerk Setup Guide](./auth-clerk.md)

### OIDC (OpenID Connect)

Enterprise SSO integration with any OIDC-compliant provider.

**Use Cases:**
- Enterprise deployments with existing identity providers
- Integration with Okta, Auth0, Keycloak, Azure AD, etc.
- Organizations with strict SSO requirements

**Features:**
- ✓ Single Sign-On (SSO)
- ✓ Integration with corporate identity providers
- ✓ Standards-based authentication
- ✓ Multi-tenancy support

See: [OIDC Setup Guide](./auth-oidc.md)

## Choosing an Authentication Provider

| Scenario | Recommended Provider |
|----------|---------------------|
| Local development | Anonymous (`none`) |
| Single-user deployment | Anonymous (`none`) |
| Behind VPN with external auth | Anonymous (`none`) |
| Multi-user SaaS | Clerk |
| Need social login | Clerk |
| Enterprise with existing IdP | OIDC |
| Okta/Auth0/Azure AD integration | OIDC |

## Configuration Status

Check authentication configuration:

```bash
# Check if auth is properly configured
kubectl exec -n kph deploy/kph -- wget -qO- http://localhost:3000/api/status/auth
```

Example response:

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

If misconfigured, the response includes missing environment variables:

```json
{
  "provider": "clerk",
  "configured": false,
  "enabled": true,
  "missing": ["CLERK_SECRET_KEY"],
  "message": "Missing required environment variables: CLERK_SECRET_KEY"
}
```

## Switching Authentication Providers

To change authentication providers:

1. Update the Helm values:

```bash
helm upgrade kph kph/kph -n kph \
  --set app.auth.provider=clerk \
  --set app.auth.clerk.publishableKey=pk_live_... \
  --set app.auth.clerk.secretKey=sk_live_...
```

2. Restart the application:

```bash
kubectl rollout restart deployment/kph -n kph
```

3. Verify configuration:

```bash
kubectl logs -n kph deploy/kph --tail=20 | grep -A 5 "Configuration validated"
```

## User Roles

KPH supports two role models:

### Organization Roles (Active)

- **ORG_ADMIN** - Full access to organization resources
- **ORG_MEMBER** - Read access to organization resources

### Legacy Roles (Deprecated)

- **ADMIN** - Legacy admin role
- **USER** - Legacy user role

The system prioritizes `newRole` (ORG_ADMIN/ORG_MEMBER) over legacy `role` field.

## Troubleshooting

### Pods Failing to Start

If pods are failing to start after enabling authentication:

```bash
# Check logs for configuration errors
kubectl logs -n kph deploy/kph --tail=50
```

Look for configuration validation errors with specific field names and fix instructions.

### Missing Environment Variables

Configuration errors include the exact environment variable names needed:

```
┌────────────────────────────────────────────────────────────┐
│  ❌ CONFIGURATION ERRORS                                   │
└────────────────────────────────────────────────────────────┘

1. Clerk publishable key is required when using Clerk authentication
   Field: NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
   Fix: Set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY environment variable
   Docs: https://github.com/kubenetlabs/kph/blob/main/docs/auth-clerk.md
```

### Users Can't Log In

1. Check auth provider is enabled:
```bash
kubectl exec -n kph deploy/kph -- wget -qO- http://localhost:3000/api/status/auth
```

2. For Clerk: Verify application URL is configured in Clerk dashboard

3. For OIDC: Verify redirect URIs match your deployment URL

## Next Steps

- [Clerk Setup Guide](./auth-clerk.md)
- [OIDC Setup Guide](./auth-oidc.md)
- [Configuration Reference](./configuration.md)
