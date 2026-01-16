"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AppShell from "~/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";
import Select from "~/components/ui/select";
import Textarea from "~/components/ui/textarea";
import Input from "~/components/ui/input";
import Modal from "~/components/ui/modal";
import { trpc } from "~/lib/trpc";
import { validatePolicy, type ValidationResult } from "~/lib/policy-validator";

type PolicyType =
  | "CILIUM_NETWORK"
  | "CILIUM_CLUSTERWIDE"
  | "TETRAGON"
  | "GATEWAY_HTTPROUTE"
  | "GATEWAY_GRPCROUTE"
  | "GATEWAY_TCPROUTE"
  | "GATEWAY_TLSROUTE";

interface GeneratedPolicy {
  name: string;
  description: string;
  type: PolicyType;
  content: string;
  targetNamespaces: string[];
  generatedFrom: string;
  generatedModel: string;
}

interface GenerateResponse {
  success: boolean;
  policy: GeneratedPolicy;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

const policyTypeOptions = [
  { value: "CILIUM_NETWORK", label: "Cilium Network Policy" },
  { value: "CILIUM_CLUSTERWIDE", label: "Cilium Clusterwide Policy" },
  { value: "TETRAGON", label: "Tetragon Tracing Policy" },
  { value: "GATEWAY_HTTPROUTE", label: "Gateway HTTP Route" },
  { value: "GATEWAY_GRPCROUTE", label: "Gateway gRPC Route" },
  { value: "GATEWAY_TCPROUTE", label: "Gateway TCP Route" },
];

const networkExamplePrompts = [
  "Allow frontend pods to communicate with the API service on port 8080",
  "Block all egress traffic except DNS queries to kube-system",
  "Allow ingress from the internet on ports 80 and 443 for pods with label app=web",
  "Allow database pods to only receive connections from backend services on port 5432",
];

const tetragonExamplePrompts = [
  "Block all shell execution (sh, bash, zsh) in the llm-system namespace and kill the process immediately",
  "Block network reconnaissance tools (curl, wget, nc, netcat) in LLM pods to prevent data exfiltration",
  "Block Python and scripting interpreters in the llm-frontend namespace to prevent code injection",
  "Alert and log when any process reads files in /root/.ollama/models/ to detect model theft attempts",
  "Block privilege escalation attempts (setuid, setgid syscalls) in all pods in the llm-system namespace",
];

function GeneratePolicyPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [prompt, setPrompt] = useState("");
  const [policyType, setPolicyType] = useState<PolicyType>("CILIUM_NETWORK");
  const [targetNamespace, setTargetNamespace] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedPolicy, setGeneratedPolicy] = useState<GeneratedPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [selectedClusterId, setSelectedClusterId] = useState("");
  const [prefilled, setPrefilled] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);

  const utils = trpc.useUtils();

  // Validate generated policy whenever it changes
  useEffect(() => {
    if (generatedPolicy) {
      const result = validatePolicy(generatedPolicy.content, generatedPolicy.type);
      setValidationResult(result);
    } else {
      setValidationResult(null);
    }
  }, [generatedPolicy]);

  // Read pre-filled values from URL params (from telemetry panel)
  useEffect(() => {
    const urlPrompt = searchParams.get("prompt");
    const urlType = searchParams.get("type");
    const urlNamespace = searchParams.get("namespace");

    if (urlPrompt) {
      setPrompt(decodeURIComponent(urlPrompt));
      setPrefilled(true);
    }
    if (urlType && policyTypeOptions.some((p) => p.value === urlType)) {
      setPolicyType(urlType as PolicyType);
    }
    if (urlNamespace) {
      setTargetNamespace(decodeURIComponent(urlNamespace));
    }

    // Clear URL params after reading to avoid confusion on refresh
    if (urlPrompt !== null || urlType !== null || urlNamespace !== null) {
      router.replace("/policies/generate", { scroll: false });
    }
  }, [searchParams, router]);

  // Fetch clusters for save modal
  const { data: clusters } = trpc.cluster.list.useQuery();

  // Save mutation
  const saveMutation = trpc.policy.create.useMutation({
    onSuccess: (data) => {
      void utils.policy.list.invalidate();
      router.push(`/policies/${data.id}`);
    },
  });

  const clusterOptions =
    clusters?.map((c) => ({
      value: c.id,
      label: `${c.name} (${c.environment})`,
    })) ?? [];

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError("Please enter a policy description");
      return;
    }

    setIsGenerating(true);
    setError(null);
    setGeneratedPolicy(null);

    try {
      const response = await fetch("/api/policies/generate-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          policyType,
          targetNamespace: targetNamespace.trim() || undefined,
        }),
      });

      const data: unknown = await response.json();

      if (!response.ok) {
        const errorData = data as { message?: string; error?: string };
        throw new Error(errorData.message ?? errorData.error ?? "Failed to generate policy");
      }

      const result = data as GenerateResponse;
      setGeneratedPolicy(result.policy);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = () => {
    if (!generatedPolicy || !selectedClusterId) return;

    saveMutation.mutate({
      name: generatedPolicy.name,
      description: generatedPolicy.description,
      type: generatedPolicy.type,
      content: generatedPolicy.content,
      clusterId: selectedClusterId,
      targetNamespaces: generatedPolicy.targetNamespaces,
      generatedFrom: generatedPolicy.generatedFrom,
      generatedModel: generatedPolicy.generatedModel,
    });
  };

  const handleCopyToClipboard = () => {
    if (generatedPolicy) {
      void navigator.clipboard.writeText(generatedPolicy.content);
    }
  };

  const handleUseExample = (example: string) => {
    setPrompt(example);
  };

  return (
    <AppShell>
      {/* Header */}
      <div className="mb-8">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/policies")}
          className="mb-4"
        >
          ← Back to Policies
        </Button>
        <h1 className="text-2xl font-bold text-foreground">Generate Policy with AI</h1>
        <p className="mt-1 text-muted">
          Describe your policy requirements in natural language and let Claude generate the YAML
        </p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Input Section */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Policy Description</CardTitle>
                {prefilled && (
                  <Badge variant="tetragon">
                    <svg className="mr-1 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    From Telemetry
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {prefilled && (
                <div className="rounded-md border border-tetragon/30 bg-tetragon/10 p-3 mb-4">
                  <div className="flex items-start gap-2">
                    <svg className="h-5 w-5 text-tetragon flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-tetragon">Policy generated from observed telemetry</p>
                      <p className="text-xs text-muted mt-0.5">
                        This prompt was created based on suspicious runtime activity detected by Tetragon.
                        Review and customize before generating.
                      </p>
                    </div>
                  </div>
                </div>
              )}
              <Textarea
                label="What should this policy do?"
                placeholder="E.g., Allow frontend pods to communicate with the API service on port 8080, but block all other egress traffic except DNS..."
                value={prompt}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  if (prefilled) setPrefilled(false);
                }}
                rows={6}
                disabled={isGenerating}
              />

              <div className="grid grid-cols-2 gap-4">
                <Select
                  label="Policy Type"
                  options={policyTypeOptions}
                  value={policyType}
                  onChange={(e) => setPolicyType(e.target.value as PolicyType)}
                  disabled={isGenerating}
                />
                <Input
                  label="Target Namespace (optional)"
                  placeholder="default"
                  value={targetNamespace}
                  onChange={(e) => setTargetNamespace(e.target.value)}
                  disabled={isGenerating}
                />
              </div>

              <Button
                onClick={handleGenerate}
                isLoading={isGenerating}
                className="w-full"
              >
                <svg
                  className="mr-2 h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
                {isGenerating ? "Generating..." : "Generate Policy"}
              </Button>

              {error && (
                <div className="rounded-md border border-danger/30 bg-danger/10 p-3">
                  <p className="text-sm text-danger">{error}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Example Prompts */}
          <Card>
            <CardHeader>
              <CardTitle>Example Prompts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Tetragon Runtime Security Examples */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="tetragon">Tetragon</Badge>
                  <span className="text-xs text-muted">Runtime Security</span>
                </div>
                <div className="space-y-2">
                  {tetragonExamplePrompts.map((example, index) => (
                    <button
                      key={`tetragon-${index}`}
                      onClick={() => {
                        handleUseExample(example);
                        setPolicyType("TETRAGON");
                      }}
                      className="w-full rounded-md border border-tetragon/30 bg-tetragon/5 p-3 text-left text-sm text-muted hover:border-tetragon/50 hover:text-foreground transition-colors"
                      disabled={isGenerating}
                    >
                      &ldquo;{example}&rdquo;
                    </button>
                  ))}
                </div>
              </div>

              {/* Network Policy Examples */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="cilium">Cilium</Badge>
                  <span className="text-xs text-muted">Network Policies</span>
                </div>
                <div className="space-y-2">
                  {networkExamplePrompts.map((example, index) => (
                    <button
                      key={`network-${index}`}
                      onClick={() => {
                        handleUseExample(example);
                        setPolicyType("CILIUM_NETWORK");
                      }}
                      className="w-full rounded-md border border-cilium/30 bg-cilium/5 p-3 text-left text-sm text-muted hover:border-cilium/50 hover:text-foreground transition-colors"
                      disabled={isGenerating}
                    >
                      &ldquo;{example}&rdquo;
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Output Section */}
        <div className="space-y-6">
          <Card className="h-full">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Generated Policy</CardTitle>
                {generatedPolicy && (
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={handleCopyToClipboard}>
                      <svg
                        className="mr-1 h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                        />
                      </svg>
                      Copy
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => setIsSaveModalOpen(true)}
                      disabled={!validationResult?.valid}
                      title={!validationResult?.valid ? "Fix validation errors before saving" : undefined}
                    >
                      <svg
                        className="mr-1 h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
                        />
                      </svg>
                      Save Policy
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {!generatedPolicy && !isGenerating && (
                <div className="flex h-96 items-center justify-center rounded-md border border-dashed border-card-border">
                  <div className="text-center">
                    <svg
                      className="mx-auto h-12 w-12 text-muted"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    <p className="mt-2 text-sm text-muted">
                      Your generated policy will appear here
                    </p>
                  </div>
                </div>
              )}

              {isGenerating && (
                <div className="flex h-96 items-center justify-center">
                  <div className="text-center">
                    <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    <p className="mt-4 text-sm text-muted">
                      Claude is generating your policy...
                    </p>
                  </div>
                </div>
              )}

              {generatedPolicy && (
                <div className="space-y-4">
                  {/* Policy Metadata */}
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="policyhub">{generatedPolicy.name}</Badge>
                    <Badge
                      variant={
                        generatedPolicy.type.startsWith("CILIUM")
                          ? "cilium"
                          : generatedPolicy.type === "TETRAGON"
                          ? "tetragon"
                          : "gateway"
                      }
                    >
                      {policyTypeOptions.find((p) => p.value === generatedPolicy.type)?.label}
                    </Badge>
                    {generatedPolicy.targetNamespaces.map((ns) => (
                      <Badge key={ns} variant="muted">
                        {ns}
                      </Badge>
                    ))}
                  </div>

                  {/* YAML Content with Syntax Highlighting */}
                  <div className="relative">
                    <pre className="max-h-[500px] overflow-auto rounded-md bg-background p-4 text-xs">
                      <code className="language-yaml">
                        <YamlHighlighter content={generatedPolicy.content} />
                      </code>
                    </pre>
                  </div>

                  {/* Validation Result */}
                  {validationResult && !validationResult.valid && (
                    <div className="rounded-md border border-danger/30 bg-danger/10 p-4">
                      <div className="flex items-start gap-3">
                        <svg className="h-5 w-5 text-danger flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <div>
                          <h4 className="font-semibold text-danger text-sm">Validation Errors</h4>
                          <ul className="mt-2 space-y-1 text-sm text-danger">
                            {validationResult.errors.map((err, i) => (
                              <li key={i} className="flex gap-2">
                                <span className="text-danger/60">-</span>
                                <span>
                                  {err.line && <span className="font-mono text-xs bg-danger/20 px-1 rounded mr-2">Line {err.line}</span>}
                                  {err.field && <span className="font-mono text-xs bg-danger/20 px-1 rounded mr-2">{err.field}</span>}
                                  {err.message}
                                </span>
                              </li>
                            ))}
                          </ul>
                          <p className="mt-3 text-xs text-muted">
                            Fix the errors above before saving. The AI may have generated invalid YAML.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {validationResult?.valid && (
                    <div className="rounded-md border border-success/30 bg-success/10 p-3">
                      <div className="flex items-center gap-2">
                        <svg className="h-5 w-5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-sm text-success font-medium">YAML is valid and ready to save</span>
                      </div>
                    </div>
                  )}

                  {/* Generation Info */}
                  <div className="flex items-center justify-between border-t border-card-border pt-3 text-xs text-muted">
                    <span>Generated by {generatedPolicy.generatedModel}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Save Modal */}
      <Modal
        isOpen={isSaveModalOpen}
        onClose={() => setIsSaveModalOpen(false)}
        title="Save Policy"
        description="Choose a cluster to save this policy to"
        size="md"
      >
        <div className="space-y-4">
          <Select
            label="Target Cluster"
            options={clusterOptions}
            placeholder="Select a cluster..."
            value={selectedClusterId}
            onChange={(e) => setSelectedClusterId(e.target.value)}
          />

          {generatedPolicy && (
            <div className="rounded-md border border-card-border bg-card-hover/50 p-3">
              <div className="text-sm">
                <p className="font-medium text-foreground">{generatedPolicy.name}</p>
                <p className="mt-1 text-muted line-clamp-2">{generatedPolicy.description}</p>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setIsSaveModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!selectedClusterId}
              isLoading={saveMutation.isPending}
            >
              Save Policy
            </Button>
          </div>

          {saveMutation.error && (
            <p className="text-sm text-danger">{saveMutation.error.message}</p>
          )}
        </div>
      </Modal>
    </AppShell>
  );
}

// Simple YAML syntax highlighter component
function YamlHighlighter({ content }: { content: string }) {
  const lines = content.split("\n");

  return (
    <>
      {lines.map((line, index) => (
        <div key={index} className="leading-relaxed">
          {highlightYamlLine(line)}
        </div>
      ))}
    </>
  );
}

function highlightYamlLine(line: string): React.ReactNode {
  // Comment
  if (line.trim().startsWith("#")) {
    return <span className="text-muted italic">{line}</span>;
  }

  // Empty line
  if (!line.trim()) {
    return <span>&nbsp;</span>;
  }

  // Key-value pair
  const keyValueMatch = line.match(/^(\s*)([a-zA-Z_][a-zA-Z0-9_-]*):(.*)$/);
  if (keyValueMatch) {
    const [, indent, key, value] = keyValueMatch;
    return (
      <>
        <span>{indent}</span>
        <span className="text-cilium">{key}</span>
        <span className="text-foreground">:</span>
        {value && highlightYamlValue(value)}
      </>
    );
  }

  // List item
  const listMatch = line.match(/^(\s*)-\s*(.*)$/);
  if (listMatch) {
    const indent = listMatch[1] ?? "";
    const value = listMatch[2] ?? "";
    // Check if it's a list item with a key
    const listKeyValue = value.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):(.*)$/);
    if (listKeyValue) {
      const key = listKeyValue[1] ?? "";
      const val = listKeyValue[2] ?? "";
      return (
        <>
          <span>{indent}</span>
          <span className="text-accent">-</span>
          <span> </span>
          <span className="text-cilium">{key}</span>
          <span className="text-foreground">:</span>
          {val && highlightYamlValue(val)}
        </>
      );
    }
    return (
      <>
        <span>{indent}</span>
        <span className="text-accent">-</span>
        <span> </span>
        {highlightYamlValue(value)}
      </>
    );
  }

  return <span className="text-foreground">{line}</span>;
}

function highlightYamlValue(value: string): React.ReactNode {
  const trimmed = value.trim();

  // String in quotes
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    return <span className="text-warning"> {value}</span>;
  }

  // Number
  if (/^\s*\d+$/.test(value)) {
    return <span className="text-tetragon"> {value}</span>;
  }

  // Boolean
  if (/^\s*(true|false)$/i.test(value)) {
    return <span className="text-tetragon"> {value}</span>;
  }

  // Null
  if (/^\s*(null|~)$/i.test(value)) {
    return <span className="text-muted"> {value}</span>;
  }

  // Regular value
  return <span className="text-gateway"> {value}</span>;
}

// Wrap in Suspense for useSearchParams
export default function GeneratePolicyPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    }>
      <GeneratePolicyPageContent />
    </Suspense>
  );
}
