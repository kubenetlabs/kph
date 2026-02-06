# Installation Verification

Complete guide to verify your KPH installation is working correctly.

## Quick Verification

Run these commands after installation:

```bash
# 1. Check all pods are running
kubectl get pods -n kph

# 2. Wait for pods to be ready
kubectl wait --for=condition=ready pod \
  -l app.kubernetes.io/instance=kph \
  -n kph \
  --timeout=300s

# 3. Run Helm tests
helm test kph -n kph
```

If all pass: ✅ Installation is successful!

---

## Detailed Verification Steps

### 1. Pod Status

Check that all KPH pods are in "Running" state:

```bash
kubectl get pods -n kph -l app.kubernetes.io/instance=kph
```

**Expected output:**

```
NAME                      READY   STATUS    RESTARTS   AGE
kph-7f8b9d5c4-xxxxx      1/1     Running   0          2m
kph-db-0                  1/1     Running   0          2m
```

**✅ Success criteria:**
- All pods show `STATUS: Running`
- `READY` shows 1/1 for each pod
- No pods in `CrashLoopBackOff`, `Error`, or `Pending` state

**❌ If pods are not running:**
```bash
# Check pod events
kubectl describe pod -n kph kph-xxxxx

# Check logs
kubectl logs -n kph kph-xxxxx --tail=50
```

See [Troubleshooting Guide](./troubleshooting.md) for common issues.

---

### 2. Database Connectivity

Verify PostgreSQL is accepting connections:

```bash
kubectl exec -n kph deploy/kph-db -- \
  pg_isready -U kph -d kph
```

**Expected output:**

```
/var/run/postgresql:5432 - accepting connections
```

**✅ Success criteria:**
- Message shows "accepting connections"
- Exit code is 0

**❌ If connection fails:**
```bash
# Check database pod logs
kubectl logs -n kph kph-db-0 --tail=50

# Check if database pod is running
kubectl get pod -n kph kph-db-0

# Check persistent volume
kubectl get pvc -n kph
```

---

### 3. Application Health

Check the application health endpoint:

```bash
kubectl exec -n kph deploy/kph -- \
  wget -qO- http://localhost:3000/api/health | jq
```

**Expected output:**

```json
{
  "status": "ok",
  "timestamp": "2026-02-06T20:00:00.000Z",
  "uptime": 120,
  "database": {
    "connected": true
  },
  "auth": {
    "provider": "none",
    "configured": true
  },
  "llm": {
    "enabled": false,
    "provider": null,
    "configured": false
  },
  "email": {
    "provider": "none",
    "configured": true
  }
}
```

**✅ Success criteria:**
- `status: "ok"`
- `database.connected: true`
- `auth.configured: true`

**❌ If status is "error":**
```bash
# Check application logs
kubectl logs -n kph deploy/kph --tail=50

# Look for configuration errors
kubectl logs -n kph deploy/kph | grep -A 10 "CONFIGURATION ERRORS"
```

---

### 4. Database Migrations

Verify database migrations ran successfully:

```bash
# Check migration job completed
kubectl get jobs -n kph

# Check migration logs
kubectl logs -n kph job/kph-migrate
```

**Expected output:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
KPH Database Migration
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
→ Waiting for database to be ready...
✓ Database is ready

→ Running migrations...
✓ Migrations completed successfully
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**✅ Success criteria:**
- Job shows `COMPLETIONS: 1/1`
- Log shows "Migrations completed successfully"

---

### 5. Configuration Status

Check authentication, LLM, and email configuration:

```bash
# Authentication status
kubectl exec -n kph deploy/kph -- \
  wget -qO- http://localhost:3000/api/status/auth | jq

# LLM status (if configured)
kubectl exec -n kph deploy/kph -- \
  wget -qO- http://localhost:3000/api/status/llm | jq

# Email status (if configured)
kubectl exec -n kph deploy/kph -- \
  wget -qO- http://localhost:3000/api/status/email | jq
```

**Expected:** Each should show `configured: true` if the feature is enabled.

---

### 6. Helm Test Suite

Run the automated Helm tests:

```bash
helm test kph -n kph
```

**Expected output:**

```
NAME: kph
LAST DEPLOYED: ...
NAMESPACE: kph
STATUS: deployed
REVISION: 1
TEST SUITE:     kph-test
Last Started:   ...
Last Completed: ...
Phase:          Succeeded
```

**✅ Success criteria:**
- Phase shows "Succeeded"
- Test pod exits with code 0

**Test details:**
```bash
# View test pod logs
kubectl logs -n kph kph-test
```

Expected test log:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
KPH Helm Test: Health Check Validation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
→ Testing health endpoint: http://kph:3000/api/health
→ Response: {"status":"ok",...}
✓ Health check passed
✓ Database is connected

Configuration detected:
  "auth":{"provider":"none","configured":true}
  "llm":{"enabled":false,...}
  "email":{"provider":"none",...}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ All tests passed - KPH is healthy!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

### 7. Access the UI

#### Port Forward Method

```bash
export POD_NAME=$(kubectl get pods --namespace kph \
  -l "app.kubernetes.io/name=kph,app.kubernetes.io/instance=kph,app.kubernetes.io/component=app" \
  -o jsonpath="{.items[0].metadata.name}")

kubectl --namespace kph port-forward $POD_NAME 8080:3000
```

Visit http://localhost:8080

**✅ Success criteria:**
- Browser shows KPH login or dashboard page
- No errors in browser console
- Page loads completely

#### Ingress Method (if configured)

```bash
# Get ingress URL
kubectl get ingress -n kph
```

Visit the URL shown in the `HOSTS` column.

---

### 8. Create Test Policy

Verify the application is fully functional by creating a test policy:

1. **Access KPH UI**
2. **Go to Policies** → **Create Policy**
3. **Create a simple test policy:**

```yaml
apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: test-policy
spec:
  endpointSelector:
    matchLabels:
      app: test
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: allowed
```

4. **Save the policy**
5. **Verify it appears in the policies list**

**✅ Success criteria:**
- Policy is created without errors
- Policy appears in the list
- No database errors in logs

---

## Expected Timing

After running `helm install`:

| Component | Ready Time | What to Expect |
|-----------|-----------|----------------|
| Database Pod | 30-45 seconds | PostgreSQL starts, initializes data directory |
| Migration Job | 10-20 seconds | Runs after database is ready |
| App Pod (StartupProbe) | 15-30 seconds | App starts, connects to database |
| App Pod (ReadyProbe) | 5-10 seconds | Health checks pass |
| **Total** | **2-3 minutes** | All pods running and ready |

**If installation takes longer than 5 minutes**, check logs for issues.

---

## Verification Checklist

Use this checklist to verify each component:

- [ ] All pods in "Running" state
- [ ] Database accepts connections
- [ ] Health endpoint returns `status: "ok"`
- [ ] Database migrations completed
- [ ] Migration job shows 1/1 completions
- [ ] Configuration status shows all features configured correctly
- [ ] Helm test passes
- [ ] UI is accessible
- [ ] Can create and view policies
- [ ] No errors in pod logs

---

## Automated Verification Script

Save this as `verify-kph.sh`:

```bash
#!/bin/bash
set -e

NAMESPACE=${1:-kph}
RELEASE=${2:-kph}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "KPH Installation Verification"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 1. Check pods
echo "1. Checking pod status..."
kubectl get pods -n $NAMESPACE -l app.kubernetes.io/instance=$RELEASE
echo ""

# 2. Wait for ready
echo "2. Waiting for pods to be ready..."
kubectl wait --for=condition=ready pod \
  -l app.kubernetes.io/instance=$RELEASE \
  -n $NAMESPACE \
  --timeout=300s
echo "✓ All pods ready"
echo ""

# 3. Check database
echo "3. Verifying database connectivity..."
kubectl exec -n $NAMESPACE deploy/$RELEASE-db -- \
  pg_isready -U kph -d kph
echo "✓ Database connected"
echo ""

# 4. Check health
echo "4. Checking application health..."
kubectl exec -n $NAMESPACE deploy/$RELEASE -- \
  wget -qO- http://localhost:3000/api/health | jq -r '.status'
echo "✓ Application healthy"
echo ""

# 5. Run tests
echo "5. Running Helm tests..."
helm test $RELEASE -n $NAMESPACE
echo "✓ Helm tests passed"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✓ Installation verification complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
```

Run it:

```bash
chmod +x verify-kph.sh
./verify-kph.sh kph kph
```

---

## Monitoring

Set up ongoing monitoring:

### Pod Status

```bash
# Watch pod status
kubectl get pods -n kph -w

# Check pod resource usage
kubectl top pods -n kph
```

### Application Logs

```bash
# Follow application logs
kubectl logs -n kph deploy/kph -f

# Follow database logs
kubectl logs -n kph kph-db-0 -f
```

### Health Endpoint

```bash
# Monitor health status (run in separate terminal)
watch -n 5 'kubectl exec -n kph deploy/kph -- \
  wget -qO- http://localhost:3000/api/health | jq'
```

---

## Next Steps

Once verification is complete:

1. [Configure Authentication](./authentication.md) - Set up user access
2. [Configure LLM](./byom-llm-setup.md) - Enable AI features
3. [Configure Email](./email-setup.md) - Enable notifications
4. [Install Operator](./CLUSTER-INSTALLATION.md) - Connect your clusters

## Troubleshooting

If any verification steps fail, see:

- [Troubleshooting Guide](./troubleshooting.md) - Common issues and solutions
- [Configuration Reference](./configuration.md) - Configuration options
- [GitHub Issues](https://github.com/kubenetlabs/kph/issues) - Report bugs
