/**
 * Helm Values Generator
 *
 * Generates Helm chart values for installing the KPH agent on Kubernetes clusters.
 * Supports multiple installation methods and configurations.
 */

export interface HelmValuesConfig {
  // Cluster identification
  clusterId: string;
  clusterName: string;
  organizationId: string;

  // Authentication
  agentToken: string;

  // Server configuration
  serverUrl: string;

  // Optional settings
  namespace?: string;
  syncInterval?: number; // seconds
  enableTelemetry?: boolean;
  logLevel?: "debug" | "info" | "warn" | "error";
  resourceLimits?: {
    cpu?: string;
    memory?: string;
  };
  resourceRequests?: {
    cpu?: string;
    memory?: string;
  };

  // Feature flags
  enablePolicySync?: boolean;
  enableAdmissionWebhook?: boolean;
  enableAuditLogging?: boolean;
}

export interface GeneratedInstallation {
  helmValues: string;
  helmCommand: string;
  kubectlCommand: string;
  manifestUrl: string;
}

const DEFAULT_NAMESPACE = "kph-system";
const DEFAULT_SYNC_INTERVAL = 60;
const DEFAULT_LOG_LEVEL = "info";

/**
 * Generates YAML-formatted Helm values for the KPH agent
 */
export function generateHelmValues(config: HelmValuesConfig): string {
  const namespace = config.namespace ?? DEFAULT_NAMESPACE;
  const syncInterval = config.syncInterval ?? DEFAULT_SYNC_INTERVAL;
  const logLevel = config.logLevel ?? DEFAULT_LOG_LEVEL;

  const values: Record<string, unknown> = {
    // Agent configuration
    agent: {
      clusterId: config.clusterId,
      clusterName: config.clusterName,
      organizationId: config.organizationId,
      token: config.agentToken,
      serverUrl: config.serverUrl,
      syncInterval: syncInterval,
      logLevel: logLevel,
    },

    // Namespace
    namespace: namespace,

    // Telemetry
    telemetry: {
      enabled: config.enableTelemetry ?? true,
    },

    // Features
    features: {
      policySync: config.enablePolicySync ?? true,
      admissionWebhook: config.enableAdmissionWebhook ?? true,
      auditLogging: config.enableAuditLogging ?? true,
    },

    // Resources
    resources: {
      limits: {
        cpu: config.resourceLimits?.cpu ?? "500m",
        memory: config.resourceLimits?.memory ?? "256Mi",
      },
      requests: {
        cpu: config.resourceRequests?.cpu ?? "100m",
        memory: config.resourceRequests?.memory ?? "128Mi",
      },
    },
  };

  return objectToYaml(values, 0);
}

/**
 * Generates the complete Helm install command
 */
export function generateHelmCommand(config: HelmValuesConfig): string {
  const namespace = config.namespace ?? DEFAULT_NAMESPACE;
  const releaseName = `kph-agent-${sanitizeName(config.clusterName)}`;

  // Build command with inline --set flags for sensitive values
  const command = [
    "helm install",
    releaseName,
    "oci://409239147779.dkr.ecr.us-east-1.amazonaws.com/kph/kph-agent",
    `--namespace ${namespace}`,
    "--create-namespace",
    `--set agent.clusterId=${config.clusterId}`,
    `--set agent.clusterName=${config.clusterName}`,
    `--set agent.organizationId=${config.organizationId}`,
    `--set agent.token=${config.agentToken}`,
    `--set agent.serverUrl=${config.serverUrl}`,
  ];

  // Add optional settings
  if (config.syncInterval) {
    command.push(`--set agent.syncInterval=${config.syncInterval}`);
  }

  if (config.logLevel && config.logLevel !== DEFAULT_LOG_LEVEL) {
    command.push(`--set agent.logLevel=${config.logLevel}`);
  }

  if (config.enableTelemetry === false) {
    command.push("--set telemetry.enabled=false");
  }

  if (config.enableAdmissionWebhook === false) {
    command.push("--set features.admissionWebhook=false");
  }

  return command.join(" \\\n  ");
}

/**
 * Generates kubectl apply command for quick installation
 */
export function generateKubectlCommand(config: HelmValuesConfig): string {
  const namespace = config.namespace ?? DEFAULT_NAMESPACE;

  return `# Create namespace
kubectl create namespace ${namespace} --dry-run=client -o yaml | kubectl apply -f -

# Create secret with agent token
kubectl create secret generic kph-agent-token \\
  --namespace ${namespace} \\
  --from-literal=token=${config.agentToken} \\
  --dry-run=client -o yaml | kubectl apply -f -

# Apply agent manifest
kubectl apply -f ${config.serverUrl}/api/install/manifest?clusterId=${config.clusterId}`;
}

/**
 * Generates a URL for downloading the installation manifest
 */
export function generateManifestUrl(config: HelmValuesConfig): string {
  const params = new URLSearchParams({
    clusterId: config.clusterId,
    token: config.agentToken,
  });

  return `${config.serverUrl}/api/install/manifest?${params.toString()}`;
}

/**
 * Generates all installation options for a cluster
 */
export function generateInstallation(config: HelmValuesConfig): GeneratedInstallation {
  return {
    helmValues: generateHelmValues(config),
    helmCommand: generateHelmCommand(config),
    kubectlCommand: generateKubectlCommand(config),
    manifestUrl: generateManifestUrl(config),
  };
}

/**
 * Generates a one-liner installation script
 */
export function generateOneLiner(config: HelmValuesConfig): string {
  const namespace = config.namespace ?? DEFAULT_NAMESPACE;

  return `curl -sfL ${config.serverUrl}/api/install/script | CLUSTER_ID=${config.clusterId} TOKEN=${config.agentToken} NAMESPACE=${namespace} sh -`;
}

/**
 * Generates environment-specific installation instructions
 */
export function generateInstallInstructions(
  config: HelmValuesConfig,
  environment: "production" | "staging" | "development"
): string {
  const baseInstructions = `# Kubernetes Policy Hub Agent Installation
# Cluster: ${config.clusterName}
# Environment: ${environment}

`;

  const securityNote =
    environment === "production"
      ? `# IMPORTANT: Store the agent token securely. Do not commit to version control.
# Consider using a secrets manager like Vault, AWS Secrets Manager, or Kubernetes External Secrets.

`
      : "";

  const helmSection = `## Option 1: Helm Installation (Recommended)

\`\`\`bash
${generateHelmCommand(config)}
\`\`\`

`;

  const kubectlSection = `## Option 2: kubectl Installation

\`\`\`bash
${generateKubectlCommand(config)}
\`\`\`

`;

  const oneLinerSection = `## Option 3: Quick Install (Development Only)

\`\`\`bash
${generateOneLiner(config)}
\`\`\`

`;

  const verificationSection = `## Verify Installation

\`\`\`bash
# Check agent status
kubectl get pods -n ${config.namespace ?? DEFAULT_NAMESPACE}

# View agent logs
kubectl logs -n ${config.namespace ?? DEFAULT_NAMESPACE} -l app=kph-agent -f

# Check agent connectivity
kubectl exec -n ${config.namespace ?? DEFAULT_NAMESPACE} deploy/kph-agent -- kph-agent status
\`\`\`
`;

  return (
    baseInstructions +
    securityNote +
    helmSection +
    kubectlSection +
    (environment !== "production" ? oneLinerSection : "") +
    verificationSection
  );
}

// Helper functions

/**
 * Converts a JavaScript object to YAML format
 */
function objectToYaml(obj: Record<string, unknown>, indent: number): string {
  const spaces = "  ".repeat(indent);
  let yaml = "";

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      continue;
    }

    if (typeof value === "object" && !Array.isArray(value)) {
      yaml += `${spaces}${key}:\n`;
      yaml += objectToYaml(value as Record<string, unknown>, indent + 1);
    } else if (Array.isArray(value)) {
      yaml += `${spaces}${key}:\n`;
      for (const item of value) {
        if (typeof item === "object") {
          yaml += `${spaces}  -\n`;
          yaml += objectToYaml(item as Record<string, unknown>, indent + 2);
        } else {
          yaml += `${spaces}  - ${formatYamlValue(item)}\n`;
        }
      }
    } else {
      yaml += `${spaces}${key}: ${formatYamlValue(value)}\n`;
    }
  }

  return yaml;
}

/**
 * Formats a value for YAML output
 */
function formatYamlValue(value: unknown): string {
  if (typeof value === "string") {
    // Quote strings that need escaping
    if (
      value.includes(":") ||
      value.includes("#") ||
      value.includes("'") ||
      value.includes('"') ||
      value.includes("\n") ||
      value.startsWith(" ") ||
      value.endsWith(" ")
    ) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return String(value);
  }
  return String(value);
}

/**
 * Sanitizes a name for use in Kubernetes resources
 */
function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 63);
}

/**
 * Validates Helm values configuration
 */
export function validateHelmConfig(config: Partial<HelmValuesConfig>): string[] {
  const errors: string[] = [];

  if (!config.clusterId) {
    errors.push("Cluster ID is required");
  }

  if (!config.clusterName) {
    errors.push("Cluster name is required");
  }

  if (!config.organizationId) {
    errors.push("Organization ID is required");
  }

  if (!config.agentToken) {
    errors.push("Agent token is required");
  }

  if (!config.serverUrl) {
    errors.push("Server URL is required");
  } else if (!isValidUrl(config.serverUrl)) {
    errors.push("Server URL must be a valid URL");
  }

  if (config.syncInterval !== undefined && (config.syncInterval < 10 || config.syncInterval > 3600)) {
    errors.push("Sync interval must be between 10 and 3600 seconds");
  }

  if (config.namespace && !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(config.namespace)) {
    errors.push("Namespace must be a valid Kubernetes namespace name");
  }

  return errors;
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}
