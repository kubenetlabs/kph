"use client";

import { useState } from "react";
import Button from "~/components/ui/button";

interface OperatorInstallInstructionsProps {
  clusterId: string;
  clusterName: string;
  operatorToken: string;
  saasEndpoint?: string;
  onClose?: () => void;
}

type InstallMethod = "helm" | "kubectl";

export default function OperatorInstallInstructions({
  clusterId,
  clusterName,
  operatorToken,
  saasEndpoint = "https://policy-hub.example.com",
  onClose,
}: OperatorInstallInstructionsProps) {
  const [installMethod, setInstallMethod] = useState<InstallMethod>("helm");
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedCommands, setCopiedCommands] = useState(false);

  const handleCopyToken = async () => {
    await navigator.clipboard.writeText(operatorToken);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  const helmCommands = `# Add the Policy Hub Helm repository
helm repo add policy-hub https://charts.policy-hub.io
helm repo update

# Create namespace
kubectl create namespace policy-hub-system

# Create secret with API token
kubectl create secret generic policy-hub-operator \\
  --namespace policy-hub-system \\
  --from-literal=api-token=${operatorToken}

# Install the operator
helm install policy-hub-operator policy-hub/operator \\
  --namespace policy-hub-system \\
  --set config.saasEndpoint=${saasEndpoint} \\
  --set config.clusterId=${clusterId}`;

  const kubectlCommands = `# Create namespace
kubectl create namespace policy-hub-system

# Create secret with API token
kubectl create secret generic policy-hub-operator \\
  --namespace policy-hub-system \\
  --from-literal=api-token=${operatorToken}

# Apply the operator manifest
kubectl apply -f https://raw.githubusercontent.com/policy-hub/operator/main/deploy/operator.yaml

# Create the configuration
cat <<EOF | kubectl apply -f -
apiVersion: policyhub.io/v1alpha1
kind: PolicyHubConfig
metadata:
  name: policy-hub-config
  namespace: policy-hub-system
spec:
  saasEndpoint: ${saasEndpoint}
  clusterId: ${clusterId}
  apiTokenSecretRef:
    name: policy-hub-operator
    key: api-token
  syncInterval: 30s
  heartbeatInterval: 60s
EOF`;

  const currentCommands = installMethod === "helm" ? helmCommands : kubectlCommands;

  const handleCopyCommands = async () => {
    await navigator.clipboard.writeText(currentCommands);
    setCopiedCommands(true);
    setTimeout(() => setCopiedCommands(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Success Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-success/20">
          <svg className="h-6 w-6 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-foreground">
            Cluster &quot;{clusterName}&quot; Created Successfully
          </h3>
          <p className="text-sm text-muted">
            Install the Policy Hub operator to start syncing policies
          </p>
        </div>
      </div>

      {/* API Token Section */}
      <div className="rounded-lg border border-warning/30 bg-warning/5 p-4">
        <div className="flex items-start gap-3">
          <svg className="h-5 w-5 flex-shrink-0 text-warning mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div className="flex-1">
            <p className="text-sm font-medium text-warning">Save Your API Token</p>
            <p className="mt-1 text-xs text-muted">
              This token will only be shown once. Make sure to copy it before closing this dialog.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <code className="flex-1 rounded bg-card px-3 py-2 text-xs font-mono text-foreground break-all border border-border">
                {operatorToken}
              </code>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCopyToken}
              >
                {copiedToken ? (
                  <>
                    <svg className="mr-1.5 h-4 w-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Copied
                  </>
                ) : (
                  <>
                    <svg className="mr-1.5 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Installation Method Tabs */}
      <div>
        <div className="flex border-b border-border">
          <button
            type="button"
            onClick={() => setInstallMethod("helm")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              installMethod === "helm"
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            Helm (Recommended)
          </button>
          <button
            type="button"
            onClick={() => setInstallMethod("kubectl")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              installMethod === "kubectl"
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            kubectl
          </button>
        </div>

        {/* Installation Commands */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-muted">
              {installMethod === "helm"
                ? "Run these commands to install the operator using Helm:"
                : "Run these commands to install the operator using kubectl:"}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopyCommands}
            >
              {copiedCommands ? (
                <>
                  <svg className="mr-1.5 h-4 w-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Copied
                </>
              ) : (
                <>
                  <svg className="mr-1.5 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy All
                </>
              )}
            </Button>
          </div>
          <pre className="rounded-lg bg-card border border-border p-4 text-xs font-mono text-foreground overflow-x-auto">
            {currentCommands}
          </pre>
        </div>
      </div>

      {/* Next Steps */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h4 className="text-sm font-medium text-foreground mb-3">Next Steps</h4>
        <ol className="space-y-2 text-sm text-muted list-decimal list-inside">
          <li>Copy the API token above and keep it secure</li>
          <li>Run the installation commands in your cluster</li>
          <li>Wait for the operator to register (usually under 1 minute)</li>
          <li>Create policies in the Policy Hub UI - they&apos;ll automatically sync to your cluster</li>
        </ol>
      </div>

      {/* Verification Command */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h4 className="text-sm font-medium text-foreground mb-2">Verify Installation</h4>
        <p className="text-xs text-muted mb-2">
          After installation, verify the operator is running:
        </p>
        <code className="block rounded bg-background px-3 py-2 text-xs font-mono text-foreground border border-border">
          kubectl get pods -n policy-hub-system
        </code>
      </div>

      {/* Close Button */}
      {onClose && (
        <div className="flex justify-end pt-2">
          <Button onClick={onClose}>
            Done
          </Button>
        </div>
      )}
    </div>
  );
}
