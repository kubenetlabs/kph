# Email Setup

KPH can send email notifications for policy deployments, user invitations, and system alerts. Email configuration is optional but recommended for production deployments.

## Supported Email Providers

- **Resend** - Modern email API (recommended)
- **SMTP** - Any SMTP server (Gmail, SendGrid, Mailgun, etc.)
- **None** - Email disabled (default)

## Features Enabled by Email

When email is configured, KPH enables:

- ✅ **Deployment Notifications** - Alert team when policies are deployed
- ✅ **User Invitations** - Send invite emails to new users
- ✅ **System Alerts** - Critical system notifications
- ✅ **Policy Reports** - Scheduled policy audit reports

---

## Resend

Modern email API with excellent deliverability and developer experience.

### Why Resend?

- ✅ Simple API with SDKs
- ✅ Free tier: 100 emails/day, 3,000/month
- ✅ Excellent deliverability
- ✅ Built-in templates and tracking
- ✅ Custom domains supported

### Step 1: Sign Up

1. Go to [resend.com](https://resend.com)
2. Sign up for a free account
3. Verify your email address

### Step 2: Get API Key

1. Go to [resend.com/api-keys](https://resend.com/api-keys)
2. Click **Create API Key**
3. Name it (e.g., "KPH Production")
4. Select permissions: **Sending access**
5. Copy your API key (starts with `re_`)

### Step 3: Configure Domain (Production)

For production deployments, verify your domain:

1. Go to [resend.com/domains](https://resend.com/domains)
2. Click **Add Domain**
3. Enter your domain (e.g., `example.com`)
4. Add DNS records as shown:
   - **SPF:** TXT record for deliverability
   - **DKIM:** TXT record for authentication
   - **DMARC:** TXT record for policy
5. Wait for DNS propagation (~5-30 minutes)
6. Verify domain

### Step 4: Configure KPH

#### Option A: Helm Values

```yaml
# values-email.yaml
app:
  email:
    provider: "resend"
    resendApiKey: "re_xxx"
    fromAddress: "noreply@example.com"  # Use your verified domain
    fromName: "Kubernetes Policy Hub"
```

Deploy:

```bash
helm upgrade kph kph/kph -n kph -f values-email.yaml
```

#### Option B: Kubernetes Secret (Recommended)

```bash
# Create secret
kubectl create secret generic kph-email -n kph \
  --from-literal=api-key='re_xxx'
```

Configure Helm:

```yaml
app:
  email:
    provider: "resend"
    existingSecret: "kph-email"
    apiKeyKey: "api-key"
    fromAddress: "noreply@example.com"
    fromName: "Kubernetes Policy Hub"
```

#### Option C: Environment Variables

```bash
KPH_EMAIL_PROVIDER=resend
RESEND_API_KEY=re_xxx
KPH_EMAIL_FROM=noreply@example.com
KPH_EMAIL_FROM_NAME="Kubernetes Policy Hub"
```

### Step 5: Verify Configuration

```bash
kubectl exec -n kph deploy/kph -- \
  wget -qO- http://localhost:3000/api/status/email | jq
```

Expected response:

```json
{
  "provider": "resend",
  "configured": true,
  "enabled": true,
  "features": {
    "notifications": true,
    "invitations": true
  }
}
```

### Development vs Production

**Development:** Use `onboarding@resend.dev` (works without domain verification)

```yaml
app:
  email:
    provider: "resend"
    resendApiKey: "re_xxx"
    fromAddress: "onboarding@resend.dev"
```

**Production:** Use your own verified domain

```yaml
app:
  email:
    provider: "resend"
    resendApiKey: "re_xxx"
    fromAddress: "noreply@yourdomain.com"
```

---

## SMTP

Use any SMTP server including Gmail, SendGrid, Mailgun, AWS SES, or your own mail server.

### Common SMTP Providers

| Provider | SMTP Host | Port | Auth |
|----------|-----------|------|------|
| Gmail | smtp.gmail.com | 587 | TLS |
| SendGrid | smtp.sendgrid.net | 587 | TLS |
| Mailgun | smtp.mailgun.org | 587 | TLS |
| AWS SES | email-smtp.us-east-1.amazonaws.com | 587 | TLS |
| Office 365 | smtp.office365.com | 587 | TLS |

### Gmail Setup

#### Step 1: Enable 2FA and Create App Password

1. Go to [myaccount.google.com/security](https://myaccount.google.com/security)
2. Enable **2-Step Verification** if not already enabled
3. Go to **App passwords**
4. Select app: **Mail**, device: **Other (Custom name)**
5. Enter name: "KPH"
6. Copy the 16-character app password

#### Step 2: Configure KPH

```yaml
app:
  email:
    provider: "smtp"
    smtp:
      host: "smtp.gmail.com"
      port: 587
      user: "your-email@gmail.com"
      password: "xxxx xxxx xxxx xxxx"  # App password
      secure: false  # Use STARTTLS
    fromAddress: "your-email@gmail.com"
    fromName: "Kubernetes Policy Hub"
```

Or with Kubernetes secret:

```bash
kubectl create secret generic kph-smtp -n kph \
  --from-literal=host='smtp.gmail.com' \
  --from-literal=port='587' \
  --from-literal=user='your-email@gmail.com' \
  --from-literal=password='xxxx xxxx xxxx xxxx'
```

### SendGrid Setup

#### Step 1: Get API Key

1. Sign up at [sendgrid.com](https://sendgrid.com)
2. Go to **Settings** → **API Keys**
3. Click **Create API Key**
4. Name: "KPH", Permissions: **Full Access** or **Mail Send**
5. Copy API key

#### Step 2: Configure KPH

```yaml
app:
  email:
    provider: "smtp"
    smtp:
      host: "smtp.sendgrid.net"
      port: 587
      user: "apikey"  # Literally "apikey"
      password: "SG.xxx"  # Your API key
    fromAddress: "noreply@yourdomain.com"
```

### AWS SES Setup

#### Step 1: Verify Domain/Email

1. Go to AWS SES Console
2. Verify your domain or email address
3. Create SMTP credentials in **SMTP Settings**

#### Step 2: Configure KPH

```yaml
app:
  email:
    provider: "smtp"
    smtp:
      host: "email-smtp.us-east-1.amazonaws.com"
      port: 587
      user: "AKIAIOSFODNN7EXAMPLE"  # SMTP username
      password: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"  # SMTP password
    fromAddress: "noreply@yourdomain.com"
```

### Custom SMTP Server

```yaml
app:
  email:
    provider: "smtp"
    smtp:
      host: "mail.yourdomain.com"
      port: 587
      user: "smtp-user"
      password: "smtp-password"
      secure: false  # true for SSL, false for STARTTLS
    fromAddress: "noreply@yourdomain.com"
```

---

## Environment Variables Reference

### Resend

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `KPH_EMAIL_PROVIDER` | Yes | Email provider | `resend` |
| `RESEND_API_KEY` | Yes | Resend API key | `re_xxx` |
| `KPH_EMAIL_FROM` | No | From email address | `noreply@example.com` |
| `KPH_EMAIL_FROM_NAME` | No | From name | `KPH` |

### SMTP

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `KPH_EMAIL_PROVIDER` | Yes | Email provider | `smtp` |
| `KPH_SMTP_HOST` | Yes | SMTP server hostname | `smtp.gmail.com` |
| `KPH_SMTP_PORT` | No | SMTP port | `587` (default) |
| `KPH_SMTP_USER` | Yes | SMTP username | `user@example.com` |
| `KPH_SMTP_PASSWORD` | Yes | SMTP password | `password123` |
| `KPH_SMTP_SECURE` | No | Use SSL (true) or STARTTLS (false) | `false` (default) |
| `KPH_EMAIL_FROM` | No | From email address | `noreply@example.com` |
| `KPH_EMAIL_FROM_NAME` | No | From name | `KPH` |

---

## Testing Email Configuration

### Send Test Email

Access KPH UI and:

1. Go to **Settings** → **Email**
2. Click **Send Test Email**
3. Check your inbox

Or via API:

```bash
kubectl exec -n kph deploy/kph -- \
  wget --post-data='{"to":"your-email@example.com"}' \
  -qO- http://localhost:3000/api/test/email
```

### Check Email Logs

```bash
# View email sending logs
kubectl logs -n kph deploy/kph | grep -i email

# Check for errors
kubectl logs -n kph deploy/kph | grep -i "email error"
```

---

## Troubleshooting

### Error: Missing RESEND_API_KEY

**Problem:** Pod fails to start when email provider is set to resend.

**Solution:**

```bash
# Verify environment variables
kubectl describe deployment kph -n kph | grep EMAIL

# Check secret
kubectl get secret kph-email -n kph -o yaml

# View logs
kubectl logs -n kph deploy/kph --tail=50
```

### Error: Missing KPH_SMTP_HOST

**Problem:** Pod fails to start when using SMTP.

**Solution:** Ensure all required SMTP variables are set:
- `KPH_SMTP_HOST`
- `KPH_SMTP_USER`
- `KPH_SMTP_PASSWORD`

### Emails Not Sending (Resend)

**Problem:** Test emails don't arrive.

**Solution:**

1. **Check API key validity:**
```bash
curl -X POST 'https://api.resend.com/emails' \
  -H 'Authorization: Bearer re_xxx' \
  -H 'Content-Type: application/json' \
  -d '{"from":"onboarding@resend.dev","to":"you@example.com","subject":"Test","html":"<p>Test</p>"}'
```

2. **Verify domain** if using custom domain
3. **Check spam folder**
4. **Review Resend logs** at resend.com/emails

### Emails Not Sending (SMTP)

**Problem:** SMTP authentication or connection fails.

**Solution:**

1. **Test SMTP connectivity:**
```bash
kubectl run -it --rm debug --image=alpine --restart=Never -- sh
apk add --no-cache openssl
openssl s_client -starttls smtp -connect smtp.gmail.com:587
```

2. **Check credentials** are correct
3. **Verify firewall rules** allow outbound port 587/465
4. **For Gmail:** Ensure app password is used (not account password)

### Emails Go to Spam

**Problem:** Emails are marked as spam.

**Solution:**

1. **Verify domain** (Resend) with SPF, DKIM, DMARC records
2. **Use verified domain** instead of generic addresses
3. **Avoid spam trigger words** in email content
4. **Warm up domain** by sending to known addresses first

### SSL/TLS Errors

**Problem:** Certificate verification fails.

**Solution:**

```yaml
app:
  email:
    smtp:
      secure: false  # Use STARTTLS instead of SSL
      # OR
      rejectUnauthorized: false  # Only for development with self-signed certs
```

---

## Email Templates

KPH includes pre-designed email templates for:

- **User Invitations** - Welcome new users
- **Deployment Notifications** - Policy deployment alerts
- **System Alerts** - Critical system notifications

Templates are responsive and work across all major email clients.

---

## Rate Limits

### Resend

**Free tier:**
- 100 emails per day
- 3,000 emails per month

**Paid tier:**
- 50,000 emails per month
- $20/month, additional emails at $0.001 each

### SMTP Providers

Check your provider's rate limits:
- **Gmail:** 500 emails/day (personal), 2,000/day (Workspace)
- **SendGrid:** 100 emails/day (free), higher with paid plans
- **AWS SES:** Based on sending quotas

---

## Production Best Practices

1. **Use dedicated email service** (Resend or SendGrid)
2. **Verify custom domain** for better deliverability
3. **Store credentials in secrets** (never in values files)
4. **Monitor email logs** regularly
5. **Set up SPF/DKIM/DMARC** records
6. **Test emails** before production rollout
7. **Configure retry logic** for transient failures

---

## Disabling Email

Email is optional. To disable:

```yaml
app:
  email:
    provider: null  # or omit entirely
```

Or unset environment variable:

```bash
unset KPH_EMAIL_PROVIDER
```

Email features will be hidden in the UI when not configured.

---

## Next Steps

- [LLM Integration](./byom-llm-setup.md) - Configure AI features
- [Configuration Reference](./configuration.md) - Full configuration
- [Troubleshooting](./troubleshooting.md) - Common issues

## Support

- **Resend:** [resend.com/docs](https://resend.com/docs)
- **SendGrid:** [docs.sendgrid.com](https://docs.sendgrid.com)
- **AWS SES:** [docs.aws.amazon.com/ses](https://docs.aws.amazon.com/ses)
- **KPH Issues:** [GitHub Issues](https://github.com/kubenetlabs/kph/issues)
