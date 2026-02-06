# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please report it responsibly.

**Please do NOT create a public GitHub issue for security vulnerabilities.**

### How to Report

Email security concerns to: **security@kubenetlabs.com**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fixes (optional)

### What to Expect

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 7 days
- **Resolution Timeline**: Depends on severity, typically 30-90 days

### Scope

In scope:
- Authentication and authorization bypasses
- SQL injection, XSS, CSRF
- Secrets exposure
- Kubernetes RBAC escalation
- Remote code execution

Out of scope:
- Denial of service attacks
- Social engineering
- Physical security
- Third-party dependencies (report to upstream)

## Security Best Practices

When deploying KPH:

1. **Use TLS** - Always enable HTTPS via ingress
2. **Rotate secrets** - Regularly rotate database passwords and API keys
3. **Network policies** - Restrict pod-to-pod communication
4. **RBAC** - Use minimal permissions for the operator service account
5. **Updates** - Keep KPH and dependencies updated

Thank you for helping keep Kubernetes Policy Hub secure.
