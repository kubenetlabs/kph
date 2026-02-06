# Troubleshooting Guide

Common issues and solutions for Kubernetes Policy Hub.

## Quick Diagnostics

Run these commands first to gather information:

```bash
# Check pod status
kubectl get pods -n kph

# Check pod logs
kubectl logs -n kph deploy/kph --tail=100

# Check database logs
kubectl logs -n kph kph-db-0 --tail=50

# Check events
kubectl get events -n kph --sort-by='.lastTimestamp'

# Check health status
kubectl exec -n kph deploy/kph -- \
  wget -qO- http://localhost:3000/api/health 2>/dev/null | jq
```

---

## Pod Issues

### Pods in CrashLoopBackOff

**Symptom:** Pods keep restarting

**Diagnosis:**
```bash
# Check recent logs
kubectl logs -n kph kph-xxxxx --previous

# Check pod events
kubectl describe pod -n kph kph-xxxxx
```

**Common causes:**

#### 1. Configuration Errors

**Log shows:**
```
┌────────────────────────────────────────────────────────────┐
│  ❌ CONFIGURATION ERRORS                                   │
└────────────────────────────────────────────────────────────┘

1. Clerk publishable key is required when using Clerk authentication
   Field: NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
   Fix: Set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY environment variable
   Docs: https://github.com/kubenetlabs/kph/blob/main/docs/auth-clerk.md
```

**Solution:**
1. Read the error message carefully
2. Follow the documentation link provided
3. Add the missing environment variable:
```bash
helm upgrade kph kph/kph -n kph \
  --set app.auth.clerk.publishableKey=pk_live_...
```

#### 2. Database Connection Failed

**Log shows:**
```
Error: connect ECONNREFUSED kph-db:5432
```

**Solution:**
```bash
# Check if database pod is running
kubectl get pod -n kph kph-db-0

# If not running, check database logs
kubectl logs -n kph kph-db-0

# Check service
kubectl get svc -n kph kph-db

# Verify DATABASE_URL is correct
kubectl describe deployment kph -n kph | grep DATABASE_URL
```

#### 3. Missing Encryption Key

**Log shows:**
```
Error: ENCRYPTION_KEY is required
```

**Solution:** Encryption key is auto-generated in Phase 1 fixes. If you see this:
```bash
# Verify secret exists
kubectl get secret -n kph kph-security

# If missing, create it
kubectl create secret generic kph-security -n kph \
  --from-literal=encryption-key=$(openssl rand -base64 32)

# Restart pods
kubectl rollout restart deployment/kph -n kph
```

---

### Pods Stuck in Pending

**Symptom:** Pod never starts, stays in Pending state

**Diagnosis:**
```bash
kubectl describe pod -n kph kph-xxxxx
```

**Common causes:**

#### 1. Insufficient Resources

**Events show:**
```
0/3 nodes are available: 3 Insufficient cpu, 3 Insufficient memory
```

**Solution:**
```bash
# Check node resources
kubectl top nodes

# Reduce resource requests
helm upgrade kph kph/kph -n kph \
  --set app.resources.requests.cpu=100m \
  --set app.resources.requests.memory=128Mi
```

#### 2. PVC Not Bound

**Events show:**
```
waiting for PVC kph-db-data-kph-db-0 to be bound
```

**Solution:**
```bash
# Check PVC status
kubectl get pvc -n kph

# Check storage class
kubectl get storageclass

# If no default storage class, create PVC manually or use different storage class
helm upgrade kph kph/kph -n kph \
  --set database.embedded.storage.storageClass=gp2  # or your storage class
```

#### 3. Image Pull Errors

**Events show:**
```
Failed to pull image "ghcr.io/kubenetlabs/kph:1.0.0": rpc error: code = Unknown desc = Error response from daemon: pull access denied
```

**Solution:**
```bash
# For private registries, create image pull secret
kubectl create secret docker-registry ghcr-secret -n kph \
  --docker-server=ghcr.io \
  --docker-username=your-username \
  --docker-password=your-token

# Update Helm values
helm upgrade kph kph/kph -n kph \
  --set global.imagePullSecrets[0].name=ghcr-secret
```

---

## Database Issues

### Database Won't Start

**Symptom:** `kph-db-0` pod in CrashLoopBackOff

**Diagnosis:**
```bash
kubectl logs -n kph kph-db-0
```

**Common causes:**

#### 1. Corrupted Data Directory

**Log shows:**
```
FATAL: database files are incompatible with server
```

**Solution (⚠️ DATA LOSS):**
```bash
# Delete PVC and recreate
kubectl delete pvc -n kph data-kph-db-0
kubectl delete pod -n kph kph-db-0
# Pod will recreate with fresh database
```

#### 2. Permission Issues

**Log shows:**
```
initdb: could not change permissions of directory "/var/lib/postgresql/data": Operation not permitted
```

**Solution:**
```bash
# Check pod security context
kubectl describe statefulset kph-db -n kph | grep -A 10 "Security Context"

# Ensure fsGroup is set correctly (should be 999 for postgres)
```

---

### Migration Failures

**Symptom:** Migration job fails, app can't start

**Diagnosis:**
```bash
# Check migration job
kubectl get jobs -n kph

# Check migration logs
kubectl logs -n kph job/kph-migrate
```

**Common causes:**

#### 1. Database Not Ready

**Log shows:**
```
→ Waiting for database to be ready...
  Database not ready, retrying in 2s...
```
(Repeats many times then fails)

**Solution:**
```bash
# Check if database is actually running
kubectl get pod -n kph kph-db-0

# Check database logs
kubectl logs -n kph kph-db-0

# If database is stuck, delete and recreate migration job
kubectl delete job -n kph kph-migrate
helm upgrade kph kph/kph -n kph --reuse-values
```

#### 2. Migration SQL Errors

**Log shows:**
```
Error: P1001: Can't reach database server
```

or

```
Error: Migration failed to apply
```

**Solution:**
```bash
# Check DATABASE_URL is correct in migration job
kubectl describe job kph-migrate -n kph | grep DATABASE_URL

# Manually run migration to see detailed error
kubectl run -it --rm migrate-debug --image=ghcr.io/kubenetlabs/kph:1.0.0 -n kph -- \
  node node_modules/prisma/build/index.js migrate deploy
```

---

## Health Check Failures

### Readiness Probe Failing

**Symptom:** Pod shows 0/1 ready, never becomes ready

**Diagnosis:**
```bash
# Check pod events
kubectl describe pod -n kph kph-xxxxx

# Check health endpoint directly
kubectl exec -n kph kph-xxxxx -- \
  wget --spider http://localhost:3000/api/health
```

**Common causes:**

#### 1. Application Not Started

**Events show:**
```
Readiness probe failed: HTTP probe failed with statuscode: 503
```

**Solution:**
```bash
# Check if app is still starting up
kubectl logs -n kph kph-xxxxx | grep -i "starting\|ready"

# If taking too long, check for errors
kubectl logs -n kph kph-xxxxx | grep -i "error\|fail"

# Increase startup probe failure threshold if needed
helm upgrade kph kph/kph -n kph \
  --set app.startupProbe.failureThreshold=60
```

#### 2. Database Connection Lost

**Health endpoint returns:**
```json
{
  "status": "error",
  "database": {
    "connected": false
  }
}
```

**Solution:**
```bash
# Check if database pod is healthy
kubectl exec -n kph deploy/kph-db -- pg_isready -U kph

# Check network connectivity
kubectl exec -n kph deploy/kph -- nc -zv kph-db 5432

# Check DATABASE_URL
kubectl exec -n kph deploy/kph -- env | grep DATABASE_URL
```

---

## Authentication Issues

### Can't Log In (Clerk)

**Symptom:** Clerk shows error page or redirect fails

**Diagnosis:**
```bash
# Check auth status
kubectl exec -n kph deploy/kph -- \
  wget -qO- http://localhost:3000/api/status/auth | jq
```

**Common causes:**

#### 1. Missing or Invalid API Keys

**Response shows:**
```json
{
  "provider": "clerk",
  "configured": false,
  "missing": ["CLERK_SECRET_KEY"]
}
```

**Solution:**
```bash
# Verify keys are set
kubectl get secret -n kph kph-clerk -o yaml | grep -v '^\s*$'

# Update with correct keys
kubectl create secret generic kph-clerk -n kph \
  --from-literal=publishable-key='pk_live_...' \
  --from-literal=secret-key='sk_live_...' \
  --dry-run=client -o yaml | kubectl apply -f -

# Restart pods
kubectl rollout restart deployment/kph -n kph
```

#### 2. Domain Not Configured

**Error in browser:**
```
Invalid publishable key
```

**Solution:**
1. Go to Clerk Dashboard → Domains
2. Add your deployment domain (e.g., `https://kph.example.com`)
3. Verify redirect URIs are configured

---

### Can't Log In (OIDC)

**Symptom:** OIDC redirect fails or shows error

**Common causes:**

#### 1. Invalid Issuer URL

**Solution:**
```bash
# Test OIDC discovery
curl https://your-idp.com/.well-known/openid-configuration

# Should return JSON with authorization_endpoint, token_endpoint, etc.
```

#### 2. Redirect URI Mismatch

**Error:**
```
redirect_uri_mismatch
```

**Solution:** Verify redirect URI in your IdP matches exactly:
```
https://your-kph-domain/api/auth/callback/oidc
```

---

## LLM Issues

### LLM Features Not Showing

**Symptom:** AI features missing from UI

**Diagnosis:**
```bash
kubectl exec -n kph deploy/kph -- \
  wget -qO- http://localhost:3000/api/status/llm | jq
```

**Common causes:**

#### 1. LLM Not Configured

**Response shows:**
```json
{
  "enabled": false
}
```

**Solution:**
```bash
# Set LLM provider and API key
helm upgrade kph kph/kph -n kph \
  --set app.llm.provider=anthropic \
  --set app.llm.apiKey=sk-ant-...
```

#### 2. Invalid API Key

**Response shows:**
```json
{
  "enabled": true,
  "configured": false,
  "missing": ["KPH_LLM_API_KEY"]
}
```

**Solution:** Verify API key is correct and active in provider dashboard.

---

### Ollama Connection Failed

**Symptom:** LLM requests fail with connection errors

**Diagnosis:**
```bash
# Test Ollama connectivity
kubectl exec -n kph deploy/kph -- \
  wget -qO- http://ollama:11434/api/version
```

**Solutions:**

```bash
# Check if Ollama pod is running
kubectl get pod -n kph -l app=ollama

# Check Ollama service
kubectl get svc -n kph ollama

# Verify endpoint in KPH config
kubectl describe deployment kph -n kph | grep LLM_ENDPOINT
```

---

## Email Issues

### Emails Not Sending

**Symptom:** Test emails don't arrive

**Diagnosis:**
```bash
# Check email status
kubectl exec -n kph deploy/kph -- \
  wget -qO- http://localhost:3000/api/status/email | jq

# Check logs for email errors
kubectl logs -n kph deploy/kph | grep -i email
```

**Common causes:**

#### 1. Resend API Key Invalid

**Solution:**
```bash
# Test Resend API key
curl -X POST 'https://api.resend.com/emails' \
  -H 'Authorization: Bearer re_xxx' \
  -H 'Content-Type: application/json' \
  -d '{
    "from": "onboarding@resend.dev",
    "to": "your-email@example.com",
    "subject": "Test",
    "html": "<p>Test</p>"
  }'
```

#### 2. SMTP Authentication Failed

**Log shows:**
```
Error: Invalid login: 535 Authentication credentials invalid
```

**Solution:**
- For Gmail: Use App Password, not account password
- Verify SMTP credentials are correct
- Check SMTP host and port

---

## Performance Issues

### Slow Application Response

**Symptom:** UI is slow, requests timeout

**Diagnosis:**
```bash
# Check resource usage
kubectl top pods -n kph

# Check database connections
kubectl exec -n kph deploy/kph-db -- \
  psql -U kph -c "SELECT count(*) FROM pg_stat_activity;"
```

**Solutions:**

#### 1. Insufficient Resources

```bash
# Increase resource limits
helm upgrade kph kph/kph -n kph \
  --set app.resources.limits.cpu=2000m \
  --set app.resources.limits.memory=2Gi
```

#### 2. Database Performance

```bash
# Check database size
kubectl exec -n kph deploy/kph-db -- \
  psql -U kph -c "SELECT pg_size_pretty(pg_database_size('kph'));"

# Check slow queries
kubectl exec -n kph deploy/kph-db -- \
  psql -U kph -c "SELECT * FROM pg_stat_statements ORDER BY mean_time DESC LIMIT 10;"
```

---

### High Memory Usage

**Symptom:** Pod OOMKilled or restarting frequently

**Diagnosis:**
```bash
# Check memory usage
kubectl top pod -n kph kph-xxxxx

# Check OOMKills
kubectl describe pod -n kph kph-xxxxx | grep -i oom
```

**Solutions:**

```bash
# Increase memory limits
helm upgrade kph kph/kph -n kph \
  --set app.resources.limits.memory=2Gi

# For Node.js, set max memory
helm upgrade kph kph/kph -n kph \
  --set app.extraEnv[0].name=NODE_OPTIONS \
  --set app.extraEnv[0].value="--max-old-space-size=1536"
```

---

## Upgrade Issues

### Upgrade Fails

**Symptom:** `helm upgrade` command fails

**Diagnosis:**
```bash
# Check Helm release status
helm status kph -n kph

# Check for pending operations
helm list -n kph --pending
```

**Solution:**
```bash
# Rollback to previous version
helm rollback kph -n kph

# Check what changed
helm diff upgrade kph kph/kph -n kph -f values.yaml
```

---

### Data Loss After Upgrade

**Symptom:** Policies or data missing after upgrade

**Prevention:**
```bash
# Always backup database before upgrade
kubectl exec -n kph kph-db-0 -- \
  pg_dump -U kph kph > backup-$(date +%Y%m%d).sql

# Restore if needed
cat backup-20260206.sql | kubectl exec -i -n kph kph-db-0 -- \
  psql -U kph kph
```

---

## Networking Issues

### Ingress Not Working

**Symptom:** Can't access KPH via ingress URL

**Diagnosis:**
```bash
# Check ingress
kubectl get ingress -n kph

# Check ingress controller logs
kubectl logs -n ingress-nginx deployment/ingress-nginx-controller
```

**Solutions:**

```bash
# Verify ingress class exists
kubectl get ingressclass

# Check ingress annotations
kubectl describe ingress -n kph kph

# Test service directly
kubectl port-forward -n kph svc/kph 8080:3000
```

---

## Getting Help

### Gather Diagnostic Information

When reporting issues, include:

```bash
# 1. Pod status and logs
kubectl get pods -n kph
kubectl logs -n kph deploy/kph --tail=200 > kph-logs.txt
kubectl logs -n kph kph-db-0 --tail=100 > db-logs.txt

# 2. Describe resources
kubectl describe deployment -n kph kph > kph-deployment.txt
kubectl describe statefulset -n kph kph-db > kph-db-statefulset.txt

# 3. Events
kubectl get events -n kph --sort-by='.lastTimestamp' > events.txt

# 4. Helm values
helm get values kph -n kph > values.yaml

# 5. Health status
kubectl exec -n kph deploy/kph -- \
  wget -qO- http://localhost:3000/api/health > health.json
```

### Report Issue

Create an issue at [GitHub Issues](https://github.com/kubenetlabs/kph/issues) with:

1. Description of the problem
2. Steps to reproduce
3. Expected vs actual behavior
4. Diagnostic information above
5. Environment details (K8s version, cloud provider, etc.)

---

## Additional Resources

- [Installation Guide](./installation.md) - Initial setup
- [Configuration Reference](./configuration.md) - All configuration options
- [Verification Guide](./verification.md) - Post-install verification
- [GitHub Discussions](https://github.com/kubenetlabs/kph/discussions) - Community support
