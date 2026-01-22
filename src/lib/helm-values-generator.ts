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
  helmSecretCommand: string; // Separate secret creation command (not logged in shell history)
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
 * Generates the kubectl command to create the agent token secret
 * This should be run separately to avoid exposing the token in shell history
 */
export function generateSecretCommand(config: HelmValuesConfig): string {
  const namespace = config.namespace ?? DEFAULT_NAMESPACE;

  return `# Create namespace (if not exists)
kubectl create namespace ${namespace} --dry-run=client -o yaml | kubectl apply -f -

# Create secret with agent token
# IMPORTANT: Set KPH_TOKEN environment variable first to avoid shell history exposure
# export KPH_TOKEN='<your-token-here>'
kubectl create secret generic kph-agent-token \\
  --namespace ${namespace} \\
  --from-literal=api-token="\${KPH_TOKEN}" \\
  --dry-run=client -o yaml | kubectl apply -f -`;
}

/**
 * Generates the complete Helm install command (without token - references secret)
 */
export function generateHelmCommand(config: HelmValuesConfig): string {
  const namespace = config.namespace ?? DEFAULT_NAMESPACE;
  const releaseName = `kph-agent-${sanitizeName(config.clusterName)}`;

  // Build command WITHOUT token - references existing secret
  const command = [
    "helm install",
    releaseName,
    "oci://409239147779.dkr.ecr.us-east-1.amazonaws.com/kph/kph-agent --version 0.1.3",
    `--namespace ${namespace}`,
    "--create-namespace",
    `--set agent.clusterId=${config.clusterId}`,
    `--set agent.clusterName=${config.clusterName}`,
    `--set agent.organizationId=${config.organizationId}`,
    `--set agent.existingSecret=kph-agent-token`,
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
 * Uses environment variable to avoid exposing token in shell history
 */
export function generateKubectlCommand(config: HelmValuesConfig): string {
  const namespace = config.namespace ?? DEFAULT_NAMESPACE;

  return `# Create namespace
kubectl create namespace ${namespace} --dry-run=client -o yaml | kubectl apply -f -

# Create secret with agent token
# IMPORTANT: Set KPH_TOKEN environment variable first to avoid shell history exposure
# export KPH_TOKEN='<your-token-here>'
kubectl create secret generic kph-agent-token \\
  --namespace ${namespace} \\
  --from-literal=api-token="\${KPH_TOKEN}" \\
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
    helmSecretCommand: generateSecretCommand(config),
    kubectlCommand: generateKubectlCommand(config),
    manifestUrl: generateManifestUrl(config),
  };
}

/**
 * Generates a one-liner installation script
 * Note: Token should be set via KPH_TOKEN environment variable before running
 */
export function generateOneLiner(config: HelmValuesConfig): string {
  const namespace = config.namespace ?? DEFAULT_NAMESPACE;

  return `# Set token first (avoids shell history):
# export KPH_TOKEN='<your-token-here>'

curl -sfL ${config.serverUrl}/api/install/script | \\
  CLUSTER_ID=${config.clusterId} \\
  TOKEN="\${KPH_TOKEN}" \\
  NAMESPACE=${namespace} sh -`;
}

/**
 * Generates environment-specific installation instructions
 */
export function generateInstallInstructions(
  config: HelmValuesConfig,
  environment: "production" | "staging" | "development"
): string {
  const namespace = config.namespace ?? DEFAULT_NAMESPACE;

  const baseInstructions = `# Kubernetes Policy Hub Agent Installation
# Cluster: ${config.clusterName}
# Environment: ${environment}

`;

  const securityNote = `## Security Note

**IMPORTANT:** Never expose the agent token in shell commands or commit to version control.

1. Store the token in a secure location (secrets manager, password manager, etc.)
2. Set the token via environment variable before running installation commands
3. Clear your shell history after installation if needed: \`history -c && history -w\`

`;

  const tokenSetup = `## Step 1: Set Token Environment Variable

\`\`\`bash
# Copy your token and set it (this won't be logged in shell history if you use read -s)
read -s KPH_TOKEN
# Paste your token and press Enter

# Or export directly (less secure - visible in history):
# export KPH_TOKEN='YOUR_TOKEN_HERE'
\`\`\`

`;

  const helmSection = `## Step 2a: Helm Installation (Recommended)

\`\`\`bash
# Create namespace and secret
${generateSecretCommand(config)}

# Install the agent (references the secret created above)
${generateHelmCommand(config)}
\`\`\`

`;

  const kubectlSection = `## Step 2b: kubectl Installation (Alternative)

\`\`\`bash
${generateKubectlCommand(config)}
\`\`\`

`;

  const oneLinerSection = `## Step 2c: Quick Install (Development Only)

\`\`\`bash
${generateOneLiner(config)}
\`\`\`

`;

  const verificationSection = `## Step 3: Verify Installation

\`\`\`bash
# Check agent status
kubectl get pods -n ${namespace}

# View agent logs
kubectl logs -n ${namespace} -l app=kph-agent -f

# Check agent connectivity
kubectl exec -n ${namespace} deploy/kph-agent -- kph-agent status
\`\`\`
`;

  return (
    baseInstructions +
    securityNote +
    tokenSetup +
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
