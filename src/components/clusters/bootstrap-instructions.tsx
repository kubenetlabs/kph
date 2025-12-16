"use client";

import { useState } from "react";
import Button from "~/components/ui/button";

interface BootstrapInstructionsProps {
  registrationToken: string;
  saasEndpoint?: string;
  onClose?: () => void;
}

type InstallMethod = "helm" | "kubectl";

export default function BootstrapInstructions({
  registrationToken,
  saasEndpoint = process.env.NEXT_PUBLIC_APP_URL ?? "https://policy-hub.example.com",
  onClose,
}: BootstrapInstructionsProps) {
  const [installMethod, setInstallMethod] = useState<InstallMethod>("helm");
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedCommands, setCopiedCommands] = useState(false);
  const [clusterName, setClusterName] = useState("my-cluster");

  const handleCopyToken = async () => {
    await navigator.clipboard.writeText(registrationToken);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  const helmCommands = `# Add the Policy Hub Helm repository
helm repo add policy-hub https://charts.policy-hub.io
helm repo update

# Create namespace
kubectl create namespace policy-hub-system

# Create secret with registration token
kubectl create secret generic policy-hub-registration \\
  --namespace policy-hub-system \\
  --from-literal=registration-token=${registrationToken}

# Install the operator (replace ${clusterName} with your cluster name)
helm install policy-hub-operator policy-hub/operator \\
  --namespace policy-hub-system \\
  --set config.saasEndpoint=${saasEndpoint} \\
  --set config.clusterName=${clusterName} \\
  --set config.registrationTokenSecretRef.name=policy-hub-registration \\
  --set config.registrationTokenSecretRef.key=registration-token`;

  const kubectlCommands = `# Create namespace
kubectl create namespace policy-hub-system

# Create secret with registration token
kubectl create secret generic policy-hub-registration \\
  --namespace policy-hub-system \\
  --from-literal=registration-token=${registrationToken}

# Apply the operator manifest
kubectl apply -f https://raw.githubusercontent.com/policy-hub/operator/main/deploy/operator.yaml

# Create the configuration (replace ${clusterName} with your cluster name)
cat <<EOF | kubectl apply -f -
apiVersion: policyhub.io/v1alpha1
kind: PolicyHubConfig
metadata:
  name: policy-hub-config
  namespace: policy-hub-system
spec:
  saasEndpoint: ${saasEndpoint}
  clusterName: ${clusterName}
  registrationTokenSecretRef:
    name: policy-hub-registration
    key: registration-token
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
      {/* Info Header */}
      <div className="rounded-lg border border-accent/30 bg-accent/5 p-4">
        <div className="flex items-start gap-3">
          <svg className="h-5 w-5 flex-shrink-0 text-accent mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="text-sm font-medium text-accent">Self-Registration Mode</p>
            <p className="mt-1 text-xs text-muted">
              The operator will automatically register with Policy Hub and create the cluster connection.
              No need to configure cluster credentials in the UI first.
            </p>
          </div>
        </div>
      </div>

      {/* Registration Token Section */}
      <div className="rounded-lg border border-warning/30 bg-warning/5 p-4">
        <div className="flex items-start gap-3">
          <svg className="h-5 w-5 flex-shrink-0 text-warning mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div className="flex-1">
            <p className="text-sm font-medium text-warning">Your Registration Token</p>
            <p className="mt-1 text-xs text-muted">
              This token can be used to register multiple clusters.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <code className="flex-1 rounded bg-card px-3 py-2 text-xs font-mono text-foreground break-all border border-border">
                {registrationToken}
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

      {/* Cluster Name Input */}
      <div>
        <label htmlFor="clusterName" className="block text-sm font-medium text-foreground mb-1">
          Cluster Name
        </label>
        <input
          id="clusterName"
          type="text"
          value={clusterName}
          onChange={(e) => setClusterName(e.target.value)}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="Enter a name for this cluster"
        />
        <p className="mt-1 text-xs text-muted">
          This name will be shown in the Policy Hub UI
        </p>
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
          <pre className="rounded-lg bg-card border border-border p-4 text-xs font-mono text-foreground overflow-x-auto whitespace-pre-wrap">
            {currentCommands}
          </pre>
        </div>
      </div>

      {/* How It Works */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h4 className="text-sm font-medium text-foreground mb-3">How It Works</h4>
        <ol className="space-y-2 text-sm text-muted list-decimal list-inside">
          <li>The operator starts and reads the registration token from the secret</li>
          <li>It calls the Policy Hub API to bootstrap a new cluster connection</li>
          <li>Policy Hub creates the cluster record and returns a cluster-specific token</li>
          <li>The operator stores this token and uses it for all future communication</li>
          <li>The cluster appears in your Policy Hub dashboard automatically</li>
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
        <p className="text-xs text-muted mt-2">
          Check if the cluster registered successfully:
        </p>
        <code className="block rounded bg-background px-3 py-2 text-xs font-mono text-foreground border border-border mt-1">
          kubectl get policyhubconfig -n policy-hub-system -o yaml
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
