# LLM Integration (Bring Your Own Model)

KPH supports AI-powered features including policy generation, recommendations, and analysis. You can bring your own LLM provider or use a local model.

## Supported LLM Providers

- **Anthropic Claude** - Recommended for policy generation
- **OpenAI GPT** - Alternative cloud provider
- **Ollama** - Local model hosting
- **OpenAI-Compatible** - Any OpenAI API-compatible service

## Features Enabled by LLM

When LLM is configured, KPH enables:

- ✅ **AI Policy Generation** - Generate network policies from natural language
- ✅ **Policy Recommendations** - Adaptive suggestions based on traffic patterns
- ✅ **Coverage Analysis** - AI-powered gap detection
- ✅ **Policy Optimization** - Suggestions to consolidate or simplify policies

## Prerequisites

- KPH installed on Kubernetes
- API key for your chosen cloud provider (Anthropic/OpenAI)
- OR Ollama running locally/in-cluster

---

## Anthropic

Recommended provider for policy generation with Claude models.

### Step 1: Get API Key

1. Sign up at [console.anthropic.com](https://console.anthropic.com)
2. Go to **API Keys**
3. Click **Create Key**
4. Copy your API key (starts with `sk-ant-`)

### Step 2: Configure KPH

#### Option A: Helm Values

```yaml
# values-anthropic.yaml
app:
  llm:
    provider: "anthropic"
    apiKey: "sk-ant-api03-xxx"
```

Deploy:

```bash
helm upgrade kph kph/kph -n kph -f values-anthropic.yaml
```

#### Option B: Kubernetes Secret (Recommended)

```bash
# Create secret
kubectl create secret generic kph-llm -n kph \
  --from-literal=api-key='sk-ant-api03-xxx'
```

Configure Helm:

```yaml
app:
  llm:
    provider: "anthropic"
    existingSecret: "kph-llm"
    apiKeyKey: "api-key"
```

#### Option C: Environment Variables

```bash
KPH_LLM_PROVIDER=anthropic
KPH_LLM_API_KEY=sk-ant-api03-xxx
# OR
ANTHROPIC_API_KEY=sk-ant-api03-xxx
```

### Verify Configuration

```bash
kubectl exec -n kph deploy/kph -- \
  wget -qO- http://localhost:3000/api/status/llm | jq
```

Expected response:

```json
{
  "enabled": true,
  "provider": "anthropic",
  "configured": true,
  "model": "claude-3-5-sonnet-20241022",
  "features": {
    "policyGeneration": true
  }
}
```

### Models

KPH uses Claude 3.5 Sonnet by default, which provides the best balance of performance and cost for policy generation.

---

## OpenAI

Alternative cloud provider using GPT models.

### Step 1: Get API Key

1. Sign up at [platform.openai.com](https://platform.openai.com)
2. Go to **API Keys**
3. Click **Create new secret key**
4. Copy your API key (starts with `sk-`)

### Step 2: Configure KPH

#### Helm Values

```yaml
app:
  llm:
    provider: "openai"
    apiKey: "sk-xxx"
```

#### Kubernetes Secret

```bash
kubectl create secret generic kph-llm -n kph \
  --from-literal=api-key='sk-xxx'
```

```yaml
app:
  llm:
    provider: "openai"
    existingSecret: "kph-llm"
    apiKeyKey: "api-key"
```

#### Environment Variables

```bash
KPH_LLM_PROVIDER=openai
KPH_LLM_API_KEY=sk-xxx
```

### Models

KPH uses GPT-4 for policy generation when using OpenAI.

---

## Ollama

Run AI models locally on your infrastructure.

### Step 1: Deploy Ollama

#### Option A: In-Cluster (Recommended)

Deploy Ollama to your Kubernetes cluster:

```yaml
# ollama-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ollama
  namespace: kph
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ollama
  template:
    metadata:
      labels:
        app: ollama
    spec:
      containers:
        - name: ollama
          image: ollama/ollama:latest
          ports:
            - containerPort: 11434
          resources:
            requests:
              memory: "4Gi"
              cpu: "2"
            limits:
              memory: "8Gi"
              cpu: "4"
---
apiVersion: v1
kind: Service
metadata:
  name: ollama
  namespace: kph
spec:
  ports:
    - port: 11434
      targetPort: 11434
  selector:
    app: ollama
```

Deploy:

```bash
kubectl apply -f ollama-deployment.yaml
```

Pull a model:

```bash
# Recommended: llama2 or mistral
kubectl exec -n kph deploy/ollama -- ollama pull llama2
```

#### Option B: External Ollama

If running Ollama outside the cluster:

```bash
# On your host
ollama serve
ollama pull llama2
```

### Step 2: Configure KPH

```yaml
app:
  llm:
    provider: "ollama"
    endpoint: "http://ollama:11434"  # or http://host.docker.internal:11434
    model: "llama2"  # or "mistral", "codellama", etc.
```

Environment variables:

```bash
KPH_LLM_PROVIDER=ollama
KPH_LLM_ENDPOINT=http://ollama:11434
KPH_LLM_MODEL=llama2
```

### Recommended Models

For policy generation:

- **llama2** (7B) - Good balance of quality and speed
- **mistral** (7B) - Fast, good for analysis
- **codellama** (7B) - Optimized for code generation

Larger models (13B, 70B) provide better quality but require more resources.

---

## OpenAI-Compatible

Use any service with OpenAI-compatible API (Together AI, Groq, local vLLM, etc.)

### Configuration

```yaml
app:
  llm:
    provider: "openai-compatible"
    endpoint: "http://your-llm-service:8080/v1"
    apiKey: "your-api-key"  # if required
    model: "your-model-name"
```

Environment variables:

```bash
KPH_LLM_PROVIDER=openai-compatible
KPH_LLM_ENDPOINT=http://your-llm-service:8080/v1
KPH_LLM_API_KEY=xxx  # optional
KPH_LLM_MODEL=your-model-name  # optional
```

### Examples

**Together AI:**

```yaml
app:
  llm:
    provider: "openai-compatible"
    endpoint: "https://api.together.xyz/v1"
    apiKey: "your-together-api-key"
    model: "mistralai/Mixtral-8x7B-Instruct-v0.1"
```

**vLLM (self-hosted):**

```yaml
app:
  llm:
    provider: "openai-compatible"
    endpoint: "http://vllm:8000/v1"
    model: "mistralai/Mistral-7B-Instruct-v0.1"
```

---

## Disabling LLM

LLM integration is optional. To disable:

```yaml
app:
  llm:
    provider: null  # or omit entirely
```

Or unset environment variable:

```bash
unset KPH_LLM_PROVIDER
```

AI features will be hidden in the UI when LLM is not configured.

---

## Environment Variables Reference

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `KPH_LLM_PROVIDER` | No | LLM provider name | - |
| `KPH_LLM_API_KEY` | Yes* | API key for cloud providers | - |
| `ANTHROPIC_API_KEY` | Yes* | Alternative for Anthropic | - |
| `KPH_LLM_ENDPOINT` | Yes** | Endpoint URL for local/compatible | - |
| `KPH_LLM_MODEL` | No | Model name (Ollama/compatible) | Auto-detected |

\* Required for Anthropic, OpenAI, OpenAI-compatible (if auth needed)
\** Required for Ollama and OpenAI-compatible

---

## Troubleshooting

### Error: Missing KPH_LLM_API_KEY

**Problem:** Pod fails to start when LLM provider is set.

**Solution:**

```bash
# Check environment variables
kubectl describe deployment kph -n kph | grep LLM

# Verify secret
kubectl get secret kph-llm -n kph -o yaml

# Check logs
kubectl logs -n kph deploy/kph --tail=50
```

### Error: Cannot Connect to Ollama

**Problem:** Ollama endpoint not reachable.

**Solution:**

```bash
# Test connectivity from KPH pod
kubectl exec -n kph deploy/kph -- wget -qO- http://ollama:11434/api/version

# Check Ollama service
kubectl get svc ollama -n kph

# View Ollama logs
kubectl logs -n kph deploy/ollama
```

### LLM Features Not Appearing

**Problem:** AI features are hidden in the UI.

**Solution:**

Check LLM status:

```bash
kubectl exec -n kph deploy/kph -- \
  wget -qO- http://localhost:3000/api/status/llm | jq
```

If `enabled: false`, verify:
1. `KPH_LLM_PROVIDER` is set correctly
2. Required credentials are provided
3. Pod has been restarted after configuration change

### Poor Policy Quality

**Problem:** Generated policies are not useful.

**Solution:**

1. **For Anthropic/OpenAI:** Already using high-quality models
2. **For Ollama:** Try a larger model:
   ```bash
   kubectl exec -n kph deploy/ollama -- ollama pull llama2:13b
   ```
   Update configuration to use `llama2:13b`
3. **Provide more context:** Add details about your network architecture

### Rate Limiting

**Problem:** API rate limit errors from cloud provider.

**Solution:**

1. **Anthropic/OpenAI:** Check your rate limits in provider dashboard
2. **Upgrade tier** if needed for higher limits
3. **Cache responses:** KPH caches similar requests to reduce API calls

---

## Cost Considerations

### Anthropic

- **Claude 3.5 Sonnet:** $3 per million input tokens, $15 per million output tokens
- Typical policy generation: ~1000 input tokens, ~500 output tokens = ~$0.01 per request
- **Recommendation:** Suitable for production use

### OpenAI

- **GPT-4:** $30 per million input tokens, $60 per million output tokens
- Typical policy generation: ~1000 input tokens, ~500 output tokens = ~$0.06 per request
- **Recommendation:** More expensive than Anthropic

### Ollama (Self-Hosted)

- **Cost:** Infrastructure only (compute resources)
- **7B model:** ~4GB RAM, 2 CPU cores
- **13B model:** ~8GB RAM, 4 CPU cores
- **Recommendation:** Cost-effective for high usage

---

## Performance Tuning

### For Cloud Providers

Increase timeout if requests are slow:

```yaml
app:
  llm:
    timeout: 60  # seconds (default: 30)
```

### For Ollama

1. **Use GPU acceleration** if available:
```yaml
spec:
  containers:
    - name: ollama
      resources:
        limits:
          nvidia.com/gpu: 1
```

2. **Allocate more CPU/RAM** for better performance
3. **Use smaller models** (7B instead of 13B) for faster responses

---

## Security Best Practices

1. **Never commit API keys** to version control
2. **Use Kubernetes secrets** for storing credentials
3. **Rotate API keys** regularly
4. **Monitor usage** in provider dashboards
5. **Network policies:** Restrict egress to LLM endpoints only
6. **For Ollama:** Run in isolated namespace with resource quotas

---

## Next Steps

- [Configuration Reference](./configuration.md) - Full configuration options
- [Email Setup](./email-setup.md) - Configure notifications
- [Troubleshooting](./troubleshooting.md) - Common issues

## Support

- **Anthropic:** [docs.anthropic.com](https://docs.anthropic.com)
- **OpenAI:** [platform.openai.com/docs](https://platform.openai.com/docs)
- **Ollama:** [ollama.ai/docs](https://ollama.ai/docs)
- **KPH Issues:** [GitHub Issues](https://github.com/kubenetlabs/kph/issues)
