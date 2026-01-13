# KPH LLM Security Demo - EKS Version

## Prerequisites

1. **EKS Cluster** - running with kubectl access configured
2. **AWS Load Balancer Controller** - installed in cluster (for LoadBalancer services)
3. **Helm** - installed locally
4. **kubectl** - configured for your EKS cluster

## Quick Start

```bash
# 1. Verify cluster access
kubectl cluster-info

# 2. Run setup
./scripts/setup-eks-demo.sh

# 3. Get LoadBalancer URL
kubectl -n nginx-gateway get svc nginx-gateway-nginx-gateway-fabric

# 4. Access OpenWebUI
# Either use the LoadBalancer hostname directly, or add to /etc/hosts:
#   <LB_IP> chat.llm.local
# Then open: http://chat.llm.local
```

## Demo Workflow

1. **Access OpenWebUI** and create an account
2. **Chat with the LLM** to verify it works
3. **Run attack simulations** (shows vulnerabilities):
   ```bash
   ./scripts/demo-attacks.sh
   ```
4. **Apply KPH security policies**:
   ```bash
   ./scripts/apply-policies.sh
   ```
5. **Re-run attacks** to show they're blocked:
   ```bash
   ./scripts/demo-attacks.sh
   ```

## Architecture

```
Internet → AWS NLB → NGINX Gateway Fabric → OpenWebUI → Ollama
                            ↓
                    Cilium/Tetragon
                   (Security Policies)
```

## Components

| Component | Purpose |
|-----------|---------|
| NGINX Gateway Fabric | L7 ingress, routing, security headers |
| Tetragon | Runtime security (process blocking, file auditing) |
| Cilium Network Policies | L3/L4 network segmentation |
| OpenWebUI | LLM chat interface |
| Ollama | Local LLM inference |

## Troubleshooting

### LoadBalancer not getting external IP
Ensure AWS Load Balancer Controller is installed:
```bash
kubectl get deployment -n kube-system aws-load-balancer-controller
```

### Pods can't pull images
Check node IAM role has ECR access, or images are in a public registry.

### Model not loading
Pull model manually:
```bash
OLLAMA_POD=$(kubectl -n llm-system get pod -l app=ollama -o jsonpath='{.items[0].metadata.name}')
kubectl -n llm-system exec -it $OLLAMA_POD -- ollama pull tinyllama
```
