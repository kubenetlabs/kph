"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "~/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";
import Select from "~/components/ui/select";
import Textarea from "~/components/ui/textarea";
import Input from "~/components/ui/input";
import Modal from "~/components/ui/modal";
import { trpc } from "~/lib/trpc";

type PolicyType =
  | "CILIUM_NETWORK"
  | "CILIUM_CLUSTERWIDE"
  | "TETRAGON"
  | "GATEWAY_HTTPROUTE"
  | "GATEWAY_GRPCROUTE"
  | "GATEWAY_TCPROUTE";

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

const examplePrompts = [
  "Allow frontend pods to communicate with the API service on port 8080",
  "Block all egress traffic except DNS queries to kube-system",
  "Allow ingress from the internet on ports 80 and 443 for pods with label app=web",
  "Monitor all exec syscalls in the production namespace",
  "Route HTTP traffic from api.example.com to the api-gateway service",
  "Allow database pods to only receive connections from backend services on port 5432",
];

export default function GeneratePolicyPage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [policyType, setPolicyType] = useState<PolicyType>("CILIUM_NETWORK");
  const [targetNamespace, setTargetNamespace] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedPolicy, setGeneratedPolicy] = useState<GeneratedPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [selectedClusterId, setSelectedClusterId] = useState("");

  const utils = trpc.useUtils();

  // Fetch clusters for save modal
  const { data: clusters } = trpc.cluster.list.useQuery();

  // Save mutation
  const saveMutation = trpc.policy.create.useMutation({
    onSuccess: (data) => {
      utils.policy.list.invalidate();
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

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? data.error ?? "Failed to generate policy");
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
      navigator.clipboard.writeText(generatedPolicy.content);
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
              <CardTitle>Policy Description</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                label="What should this policy do?"
                placeholder="E.g., Allow frontend pods to communicate with the API service on port 8080, but block all other egress traffic except DNS..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
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
            <CardContent>
              <div className="space-y-2">
                {examplePrompts.map((example, index) => (
                  <button
                    key={index}
                    onClick={() => handleUseExample(example)}
                    className="w-full rounded-md border border-card-border bg-card-hover/50 p-3 text-left text-sm text-muted hover:border-primary/50 hover:text-foreground transition-colors"
                    disabled={isGenerating}
                  >
                    &ldquo;{example}&rdquo;
                  </button>
                ))}
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
                    <Button size="sm" onClick={() => setIsSaveModalOpen(true)}>
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
