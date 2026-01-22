"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";
import {
  generateHelmCommand,
  generateKubectlCommand,
  generateOneLiner,
  generateHelmValues,
  generateInstallInstructions,
  type HelmValuesConfig,
} from "~/lib/helm-values-generator";

type InstallMethod = "helm" | "kubectl" | "script" | "values";
type WizardStep = "method" | "configure" | "install" | "verify";

interface ClusterInstallWizardProps {
  cluster: {
    id: string;
    name: string;
    organizationId: string;
  };
  agentToken: string;
  serverUrl: string;
  onComplete?: () => void;
  onCancel?: () => void;
}

const INSTALL_METHODS = [
  {
    id: "helm" as const,
    name: "Helm Chart",
    description: "Recommended for production. Full configuration options.",
    icon: (
      <svg className="h-8 w-8" viewBox="0 0 32 32" fill="currentColor">
        <path d="M16 2L2 9l14 7 14-7L16 2zM2 23l14 7 14-7M2 16l14 7 14-7" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    ),
    recommended: true,
  },
  {
    id: "kubectl" as const,
    name: "kubectl Apply",
    description: "Direct manifest application. Simple setup.",
    icon: (
      <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 17l6-6-6-6M12 19h8" />
      </svg>
    ),
    recommended: false,
  },
  {
    id: "script" as const,
    name: "Quick Install",
    description: "One-liner script. Development only.",
    icon: (
      <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    ),
    recommended: false,
  },
  {
    id: "values" as const,
    name: "Values File",
    description: "Download values.yaml for GitOps workflows.",
    icon: (
      <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
      </svg>
    ),
    recommended: false,
  },
];

export default function ClusterInstallWizard({
  cluster,
  agentToken,
  serverUrl,
  onComplete,
  onCancel,
}: ClusterInstallWizardProps) {
  const [step, setStep] = useState<WizardStep>("method");
  const [method, setMethod] = useState<InstallMethod>("helm");
  const [copied, setCopied] = useState(false);
  const [config, setConfig] = useState({
    namespace: "kph-system",
    syncInterval: 60,
    enableTelemetry: true,
    enableAdmissionWebhook: true,
    logLevel: "info" as const,
  });

  const helmConfig: HelmValuesConfig = {
    clusterId: cluster.id,
    clusterName: cluster.name,
    organizationId: cluster.organizationId,
    agentToken,
    serverUrl,
    namespace: config.namespace,
    syncInterval: config.syncInterval,
    enableTelemetry: config.enableTelemetry,
    enableAdmissionWebhook: config.enableAdmissionWebhook,
    logLevel: config.logLevel,
  };

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadValues = () => {
    const values = generateHelmValues(helmConfig);
    const blob = new Blob([values], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kph-agent-${cluster.name.toLowerCase().replace(/\s+/g, "-")}-values.yaml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadInstructions = () => {
    const instructions = generateInstallInstructions(helmConfig, "production");
    const blob = new Blob([instructions], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kph-agent-${cluster.name.toLowerCase().replace(/\s+/g, "-")}-install.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getInstallCommand = () => {
    switch (method) {
      case "helm":
        return generateHelmCommand(helmConfig);
      case "kubectl":
        return generateKubectlCommand(helmConfig);
      case "script":
        return generateOneLiner(helmConfig);
      case "values":
        return generateHelmValues(helmConfig);
    }
  };

  const renderMethodSelection = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-foreground">Choose Installation Method</h3>
        <p className="mt-1 text-sm text-muted">
          Select how you&apos;d like to install the KPH agent on your cluster.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {INSTALL_METHODS.map((m) => (
          <button
            key={m.id}
            onClick={() => setMethod(m.id)}
            className={`relative flex flex-col items-center rounded-lg border p-6 text-center transition-colors ${
              method === m.id
                ? "border-primary bg-primary/10"
                : "border-card-border hover:border-primary/50 hover:bg-card-hover"
            }`}
          >
            {m.recommended && (
              <Badge variant="accent" className="absolute right-2 top-2 text-xs">
                Recommended
              </Badge>
            )}
            <div className={method === m.id ? "text-primary" : "text-muted"}>{m.icon}</div>
            <h4 className="mt-3 font-medium text-foreground">{m.name}</h4>
            <p className="mt-1 text-xs text-muted">{m.description}</p>
          </button>
        ))}
      </div>

      <div className="flex justify-end gap-3">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button onClick={() => setStep("configure")}>Continue</Button>
      </div>
    </div>
  );

  const renderConfiguration = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-foreground">Configure Agent</h3>
        <p className="mt-1 text-sm text-muted">
          Customize the agent configuration for your cluster.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">Namespace</label>
          <input
            type="text"
            value={config.namespace}
            onChange={(e) => setConfig({ ...config, namespace: e.target.value })}
            className="w-full rounded-md border border-card-border bg-background px-3 py-2 text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <p className="mt-1 text-xs text-muted">Kubernetes namespace for agent deployment</p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            Sync Interval (seconds)
          </label>
          <input
            type="number"
            min={10}
            max={3600}
            value={config.syncInterval}
            onChange={(e) => setConfig({ ...config, syncInterval: parseInt(e.target.value) || 60 })}
            className="w-full rounded-md border border-card-border bg-background px-3 py-2 text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <p className="mt-1 text-xs text-muted">How often the agent syncs with the server</p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">Log Level</label>
          <select
            value={config.logLevel}
            onChange={(e) => setConfig({ ...config, logLevel: e.target.value as typeof config.logLevel })}
            className="w-full rounded-md border border-card-border bg-background px-3 py-2 text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warn">Warning</option>
            <option value="error">Error</option>
          </select>
        </div>

        <div className="space-y-3 rounded-lg border border-card-border p-4">
          <h4 className="font-medium text-foreground">Features</h4>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={config.enableTelemetry}
              onChange={(e) => setConfig({ ...config, enableTelemetry: e.target.checked })}
              className="h-4 w-4 rounded border-card-border bg-background text-primary focus:ring-primary"
            />
            <span className="text-sm text-foreground">Enable Telemetry Collection</span>
          </label>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={config.enableAdmissionWebhook}
              onChange={(e) => setConfig({ ...config, enableAdmissionWebhook: e.target.checked })}
              className="h-4 w-4 rounded border-card-border bg-background text-primary focus:ring-primary"
            />
            <span className="text-sm text-foreground">Enable Admission Webhook</span>
          </label>
        </div>
      </div>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={() => setStep("method")}>
          Back
        </Button>
        <Button onClick={() => setStep("install")}>Continue</Button>
      </div>
    </div>
  );

  const renderInstallation = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-foreground">Install Agent</h3>
        <p className="mt-1 text-sm text-muted">
          {method === "values"
            ? "Download the values file and use it with your GitOps tooling."
            : "Run the following command on your cluster."}
        </p>
      </div>

      {/* Token Warning */}
      <div className="rounded-lg border border-yellow-600/50 bg-yellow-600/10 p-4">
        <div className="flex gap-3">
          <svg className="h-5 w-5 flex-shrink-0 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <p className="text-sm font-medium text-yellow-500">Security Note</p>
            <p className="mt-1 text-xs text-yellow-400/80">
              The agent token is included in this command. Do not share or commit this to version control.
              Store securely using a secrets manager.
            </p>
          </div>
        </div>
      </div>

      {/* Command/Values Display */}
      <div className="relative">
        <div className="absolute right-2 top-2 flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => handleCopy(getInstallCommand())}
          >
            {copied ? (
              <svg className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            )}
          </Button>
        </div>
        <pre className="max-h-96 overflow-auto rounded-lg bg-black/50 p-4 text-xs text-green-400">
          <code>{getInstallCommand()}</code>
        </pre>
      </div>

      {/* Download Buttons */}
      <div className="flex gap-3">
        {method === "values" ? (
          <Button onClick={handleDownloadValues} className="flex-1">
            <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download values.yaml
          </Button>
        ) : (
          <Button variant="secondary" onClick={handleDownloadInstructions} className="flex-1">
            <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Download Instructions
          </Button>
        )}
      </div>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={() => setStep("configure")}>
          Back
        </Button>
        <Button onClick={() => setStep("verify")}>I&apos;ve Run the Command</Button>
      </div>
    </div>
  );

  const renderVerification = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-foreground">Verify Installation</h3>
        <p className="mt-1 text-sm text-muted">
          Confirm that the agent is running and connected to the server.
        </p>
      </div>

      {/* Verification Steps */}
      <div className="space-y-4">
        <div className="rounded-lg border border-card-border p-4">
          <h4 className="font-medium text-foreground">1. Check Pod Status</h4>
          <pre className="mt-2 rounded bg-black/50 p-3 text-xs text-green-400">
            kubectl get pods -n {config.namespace} -l app=kph-agent
          </pre>
          <p className="mt-2 text-xs text-muted">
            The agent pod should show <code className="text-green-400">Running</code> status.
          </p>
        </div>

        <div className="rounded-lg border border-card-border p-4">
          <h4 className="font-medium text-foreground">2. Check Agent Logs</h4>
          <pre className="mt-2 rounded bg-black/50 p-3 text-xs text-green-400">
            kubectl logs -n {config.namespace} -l app=kph-agent --tail=50
          </pre>
          <p className="mt-2 text-xs text-muted">
            Look for &quot;Connected to server&quot; and &quot;Initial sync complete&quot; messages.
          </p>
        </div>

        <div className="rounded-lg border border-card-border p-4">
          <h4 className="font-medium text-foreground">3. Verify Connection</h4>
          <p className="text-sm text-muted">
            Once the agent connects, the cluster status in the dashboard will change to{" "}
            <Badge variant="success">Connected</Badge>.
          </p>
        </div>
      </div>

      {/* Troubleshooting */}
      <details className="rounded-lg border border-card-border">
        <summary className="cursor-pointer p-4 text-sm font-medium text-foreground hover:bg-card-hover">
          Troubleshooting
        </summary>
        <div className="border-t border-card-border p-4 text-sm text-muted">
          <ul className="list-inside list-disc space-y-2">
            <li>
              <strong>ImagePullBackOff:</strong> Ensure your cluster has access to the container
              registry.
            </li>
            <li>
              <strong>CrashLoopBackOff:</strong> Check logs for authentication or configuration
              errors.
            </li>
            <li>
              <strong>No connection:</strong> Verify network policies allow egress to{" "}
              <code className="text-xs">{serverUrl}</code>
            </li>
            <li>
              <strong>Token invalid:</strong> Generate a new token from the cluster settings page.
            </li>
          </ul>
        </div>
      </details>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={() => setStep("install")}>
          Back
        </Button>
        <Button onClick={onComplete}>Done</Button>
      </div>
    </div>
  );

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Install KPH Agent</CardTitle>
            <CardDescription>
              Connect <span className="font-medium text-foreground">{cluster.name}</span> to
              Kubernetes Policy Hub
            </CardDescription>
          </div>
          <Badge variant="muted">
            Step {["method", "configure", "install", "verify"].indexOf(step) + 1} of 4
          </Badge>
        </div>

        {/* Progress Bar */}
        <div className="mt-4 flex gap-1">
          {["method", "configure", "install", "verify"].map((s, i) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full transition-colors ${
                ["method", "configure", "install", "verify"].indexOf(step) >= i
                  ? "bg-primary"
                  : "bg-card-border"
              }`}
            />
          ))}
        </div>
      </CardHeader>

      <CardContent>
        {step === "method" && renderMethodSelection()}
        {step === "configure" && renderConfiguration()}
        {step === "install" && renderInstallation()}
        {step === "verify" && renderVerification()}
      </CardContent>
    </Card>
  );
}
