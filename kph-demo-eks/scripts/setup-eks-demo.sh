#!/bin/bash
# =============================================================================
# KPH LLM Security Demo - EKS Setup Script
# =============================================================================
# This script sets up the demo on an existing EKS cluster
#
# Components installed:
#   - Cilium CNI with Hubble (replaces VPC CNI)
#   - Tetragon runtime security
#   - NGINX Gateway Fabric (L7 ingress)
#   - OpenWebUI + Ollama (LLM stack)
#
# Prerequisites:
#   - AWS CLI configured
#   - kubectl configured for your EKS cluster
#   - Helm installed
#   - eksctl installed (optional, for cluster creation)
#
# Usage: ./setup-eks-demo.sh
# =============================================================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${CYAN}[STEP]${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# =============================================================================
# Step 1: Verify Prerequisites
# =============================================================================
verify_prerequisites() {
    log_step "Verifying prerequisites..."

    # Check kubectl
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl not found. Please install kubectl."
        exit 1
    fi

    # Check helm
    if ! command -v helm &> /dev/null; then
        log_error "Helm not found. Please install Helm."
        exit 1
    fi

    # Check cluster connection
    if ! kubectl cluster-info &> /dev/null; then
        log_error "Cannot connect to Kubernetes cluster. Check your kubeconfig."
        exit 1
    fi

    # Check if it's EKS
    CLUSTER_INFO=$(kubectl cluster-info 2>/dev/null || true)
    if [[ ! "$CLUSTER_INFO" == *"eks"* ]]; then
        log_warn "This doesn't appear to be an EKS cluster. Continuing anyway..."
    fi

    log_success "Prerequisites verified"
}

# =============================================================================
# Step 2: Install Cilium (ENI mode for EKS)
# =============================================================================
install_cilium() {
    log_step "Installing Cilium as CNI..."

    # Check if Cilium CLI is installed
    if ! command -v cilium &> /dev/null; then
        log_info "Installing Cilium CLI..."
        CILIUM_CLI_VERSION=$(curl -s https://raw.githubusercontent.com/cilium/cilium-cli/main/stable.txt)
        if [[ "$(uname -m)" == "arm64" ]] || [[ "$(uname -m)" == "aarch64" ]]; then
            CLI_ARCH=arm64
        else
            CLI_ARCH=amd64
        fi
        curl -L --fail --remote-name-all https://github.com/cilium/cilium-cli/releases/download/${CILIUM_CLI_VERSION}/cilium-darwin-${CLI_ARCH}.tar.gz 2>/dev/null || \
        curl -L --fail --remote-name-all https://github.com/cilium/cilium-cli/releases/download/${CILIUM_CLI_VERSION}/cilium-linux-${CLI_ARCH}.tar.gz
        sudo tar xzvfC cilium-*-${CLI_ARCH}.tar.gz /usr/local/bin
        rm -f cilium-*-${CLI_ARCH}.tar.gz
    fi

    # Check if Cilium is already installed
    if kubectl get daemonset -n kube-system cilium &> /dev/null; then
        log_warn "Cilium already installed, skipping..."
        cilium status
        return
    fi

    # Install Cilium on EKS in ENI mode (uses AWS ENIs directly)
    log_info "Installing Cilium in ENI mode..."
    cilium install \
        --set eni.enabled=true \
        --set ipam.mode=eni \
        --set egressMasqueradeInterfaces=ens5 \
        --set routingMode=native \
        --set hubble.relay.enabled=true \
        --set hubble.ui.enabled=true

    # Wait for Cilium
    log_info "Waiting for Cilium to be ready (this may take 3-5 minutes)..."
    cilium status --wait --wait-duration 10m

    # Enable Hubble
    log_info "Enabling Hubble observability..."
    cilium hubble enable --ui

    log_success "Cilium installed with Hubble"
}

# =============================================================================
# Step 3: Install Tetragon
# =============================================================================
install_tetragon() {
    log_step "Installing Tetragon..."

    # Add Cilium Helm repo (ignore if exists)
    helm repo add cilium https://helm.cilium.io 2>/dev/null || true
    helm repo update

    # Check if already installed
    if helm status tetragon -n kube-system &> /dev/null; then
        log_warn "Tetragon already installed, skipping..."
        return
    fi

    # Install Tetragon
    helm install tetragon cilium/tetragon \
        --namespace kube-system \
        --set tetragon.enableProcessCred=true \
        --set tetragon.enableProcessNs=true

    # Wait for Tetragon
    log_info "Waiting for Tetragon to be ready..."
    kubectl -n kube-system wait --for=condition=Ready pod -l app.kubernetes.io/name=tetragon --timeout=120s

    log_success "Tetragon installed"
}

# =============================================================================
# Step 4: Install AWS Load Balancer Controller (if not present)
# =============================================================================
install_aws_lb_controller() {
    log_step "Checking AWS Load Balancer Controller..."

    if kubectl get deployment -n kube-system aws-load-balancer-controller &> /dev/null; then
        log_info "AWS Load Balancer Controller already installed"
        return
    fi

    log_warn "AWS Load Balancer Controller not found."
    log_warn "For LoadBalancer services to work, install it following AWS docs:"
    log_warn "https://docs.aws.amazon.com/eks/latest/userguide/aws-load-balancer-controller.html"
    log_warn ""
    log_warn "Continuing with NodePort as fallback..."
}

# =============================================================================
# Step 5: Install Gateway API CRDs and NGINX Gateway Fabric
# =============================================================================
install_nginx_gateway_fabric() {
    log_step "Installing NGINX Gateway Fabric..."

    # Install Gateway API CRDs
    log_info "Installing Gateway API CRDs v1.1.0..."
    kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.1.0/standard-install.yaml

    # Create namespace
    kubectl create namespace nginx-gateway --dry-run=client -o yaml | kubectl apply -f -

    # Check if already installed
    if helm status nginx-gateway -n nginx-gateway &> /dev/null; then
        log_warn "NGF already installed, skipping..."
        return
    fi

    # Install NGF with LoadBalancer (works on EKS with AWS LB Controller)
    log_info "Installing NGINX Gateway Fabric v1.4.0..."
    helm install nginx-gateway oci://ghcr.io/nginx/charts/nginx-gateway-fabric \
        --version 1.4.0 \
        --namespace nginx-gateway \
        --set service.type=LoadBalancer \
        --set service.annotations."service\.beta\.kubernetes\.io/aws-load-balancer-type"=nlb \
        --set service.annotations."service\.beta\.kubernetes\.io/aws-load-balancer-scheme"=internet-facing

    # Wait for NGF
    log_info "Waiting for NGINX Gateway Fabric to be ready..."
    kubectl -n nginx-gateway wait --for=condition=Ready pod -l app.kubernetes.io/name=nginx-gateway-fabric --timeout=120s

    # Wait for LoadBalancer
    log_info "Waiting for LoadBalancer hostname (this may take 2-3 minutes)..."
    for i in {1..60}; do
        LB_HOSTNAME=$(kubectl -n nginx-gateway get svc nginx-gateway-nginx-gateway-fabric -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)
        if [[ -n "$LB_HOSTNAME" ]]; then
            break
        fi
        sleep 5
    done

    if [[ -n "$LB_HOSTNAME" ]]; then
        log_success "NGINX Gateway Fabric installed - LB: ${LB_HOSTNAME}"
    else
        log_warn "NGF installed but LoadBalancer hostname not yet assigned"
    fi
}

# =============================================================================
# Step 6: Deploy LLM Stack
# =============================================================================
deploy_llm_stack() {
    log_step "Deploying LLM stack (OpenWebUI + Ollama)..."

    # Apply manifests
    kubectl apply -f "${PROJECT_DIR}/manifests/base/"

    # Wait for deployments
    log_info "Waiting for Ollama to be ready..."
    kubectl -n llm-system wait --for=condition=Available deployment/ollama --timeout=300s || true

    log_info "Waiting for OpenWebUI to be ready..."
    kubectl -n llm-frontend wait --for=condition=Available deployment/openwebui --timeout=180s || true

    log_success "LLM stack deployed"
}

# =============================================================================
# Step 7: Generate Secrets
# =============================================================================
generate_secrets() {
    log_step "Generating secure secret key..."

    SECRET_KEY=$(openssl rand -hex 32)

    kubectl -n llm-frontend create secret generic openwebui-secrets \
        --from-literal=secret-key="$SECRET_KEY" \
        --dry-run=client -o yaml | kubectl apply -f -

    # Restart OpenWebUI to pick up secret
    kubectl -n llm-frontend rollout restart deployment/openwebui

    log_success "Secrets generated"
}

# =============================================================================
# Step 8: Pull LLM Model
# =============================================================================
pull_llm_model() {
    log_step "Pulling LLM model (tinyllama)..."

    # Wait for Ollama pod to be ready
    kubectl -n llm-system wait --for=condition=Ready pod -l app=ollama --timeout=120s

    OLLAMA_POD=$(kubectl -n llm-system get pod -l app=ollama -o jsonpath='{.items[0].metadata.name}')

    log_info "Pulling tinyllama model (this may take a few minutes)..."
    kubectl -n llm-system exec -it $OLLAMA_POD -- ollama pull tinyllama || {
        log_warn "Failed to pull model. You can pull it manually later:"
        log_warn "  kubectl -n llm-system exec -it \$(kubectl -n llm-system get pod -l app=ollama -o jsonpath='{.items[0].metadata.name}') -- ollama pull tinyllama"
    }

    log_success "LLM model ready"
}

# =============================================================================
# Step 9: Display Access Information
# =============================================================================
display_access_info() {
    log_step "Getting access information..."

    # Get LoadBalancer hostname
    LB_HOSTNAME=$(kubectl -n nginx-gateway get svc nginx-gateway-nginx-gateway-fabric -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || echo "pending")

    echo ""
    echo "============================================================="
    log_success "Demo environment setup complete!"
    echo "============================================================="
    echo ""
    echo "Architecture:"
    echo "  Internet → AWS NLB → NGF → OpenWebUI → Ollama"
    echo ""
    echo "Components installed:"
    echo "  ✓ Cilium CNI with Hubble (network policies + observability)"
    echo "  ✓ Tetragon (runtime security)"
    echo "  ✓ NGINX Gateway Fabric (L7 ingress)"
    echo "  ✓ OpenWebUI + Ollama (LLM stack)"
    echo ""
    echo "============================================================="
    echo "  ACCESS INFORMATION"
    echo "============================================================="
    echo ""
    echo "  LoadBalancer: ${LB_HOSTNAME}"
    echo ""
    if [[ "$LB_HOSTNAME" != "pending" ]]; then
        echo "  Add to your /etc/hosts (get IP with: nslookup ${LB_HOSTNAME}):"
        echo "    <LB_IP> chat.llm.local"
        echo ""
        echo "  Or access directly:"
        echo "    http://${LB_HOSTNAME}"
    else
        echo "  LoadBalancer still provisioning. Check with:"
        echo "    kubectl -n nginx-gateway get svc"
    fi
    echo ""
    echo "============================================================="
    echo "  DEMO WORKFLOW"
    echo "============================================================="
    echo ""
    echo "1. Open http://chat.llm.local (or LB hostname) and create account"
    echo "2. Run './scripts/demo-attacks.sh' to show vulnerabilities"
    echo "3. Run './scripts/apply-policies.sh' to apply KPH security"
    echo "4. Re-run attacks to show they're now blocked"
    echo ""
}

# =============================================================================
# Main
# =============================================================================
main() {
    echo ""
    echo "============================================================="
    echo "  KPH LLM Security Demo - EKS Setup"
    echo "  Cilium + Tetragon + NGINX Gateway Fabric + OpenWebUI"
    echo "============================================================="
    echo ""

    verify_prerequisites
    install_cilium
    install_tetragon
    install_aws_lb_controller
    install_nginx_gateway_fabric
    deploy_llm_stack
    generate_secrets
    pull_llm_model
    display_access_info
}

main "$@"
