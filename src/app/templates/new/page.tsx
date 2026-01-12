"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AppShell from "~/components/layout/app-shell";
import { Card, CardHeader, CardTitle, CardContent } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Input from "~/components/ui/input";
import Select from "~/components/ui/select";
import Textarea from "~/components/ui/textarea";
import { trpc } from "~/lib/trpc";

type PolicyType =
  | "CILIUM_NETWORK"
  | "CILIUM_CLUSTERWIDE"
  | "TETRAGON"
  | "GATEWAY_HTTPROUTE"
  | "GATEWAY_GRPCROUTE"
  | "GATEWAY_TCPROUTE"
  | "GATEWAY_TLSROUTE";

const policyTypeOptions = [
  { value: "CILIUM_NETWORK", label: "Cilium Network Policy" },
  { value: "CILIUM_CLUSTERWIDE", label: "Cilium Clusterwide Network Policy" },
  { value: "TETRAGON", label: "Tetragon Tracing Policy" },
  { value: "GATEWAY_HTTPROUTE", label: "Gateway HTTP Route" },
  { value: "GATEWAY_GRPCROUTE", label: "Gateway gRPC Route" },
  { value: "GATEWAY_TCPROUTE", label: "Gateway TCP Route" },
  { value: "GATEWAY_TLSROUTE", label: "Gateway TLS Route" },
];

const policyTemplates: Record<string, string> = {
  CILIUM_NETWORK: `apiVersion: "cilium.io/v2"
kind: CiliumNetworkPolicy
metadata:
  name: "template-name"
  namespace: "default"
spec:
  endpointSelector:
    matchLabels:
      app: my-app
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: frontend
      toPorts:
        - ports:
            - port: "80"
              protocol: TCP`,
  CILIUM_CLUSTERWIDE: `apiVersion: "cilium.io/v2"
kind: CiliumClusterwideNetworkPolicy
metadata:
  name: "template-name"
spec:
  endpointSelector:
    matchLabels:
      app: my-app
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: frontend`,
  TETRAGON: `apiVersion: cilium.io/v1alpha1
kind: TracingPolicy
metadata:
  name: "template-name"
spec:
  kprobes:
    - call: "sys_execve"
      syscall: true
      args:
        - index: 0
          type: "string"
      selectors:
        - matchNamespaces:
            - namespace: default
              operator: In`,
  GATEWAY_HTTPROUTE: `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: "template-name"
  namespace: "default"
spec:
  parentRefs:
    - name: my-gateway
  hostnames:
    - "example.com"
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /api
      backendRefs:
        - name: api-service
          port: 80`,
  GATEWAY_GRPCROUTE: `apiVersion: gateway.networking.k8s.io/v1
kind: GRPCRoute
metadata:
  name: "template-name"
  namespace: "default"
spec:
  parentRefs:
    - name: my-gateway
  hostnames:
    - "grpc.example.com"
  rules:
    - matches:
        - method:
            service: myservice.MyService
      backendRefs:
        - name: grpc-service
          port: 50051`,
  GATEWAY_TCPROUTE: `apiVersion: gateway.networking.k8s.io/v1alpha2
kind: TCPRoute
metadata:
  name: "template-name"
  namespace: "default"
spec:
  parentRefs:
    - name: my-gateway
  rules:
    - backendRefs:
        - name: tcp-service
          port: 9000`,
  GATEWAY_TLSROUTE: `apiVersion: gateway.networking.k8s.io/v1alpha2
kind: TLSRoute
metadata:
  name: "template-name"
  namespace: "default"
spec:
  parentRefs:
    - name: my-gateway
  hostnames:
    - "secure.example.com"
  rules:
    - backendRefs:
        - name: tls-service
          port: 443`,
};

export default function NewTemplatePage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<PolicyType>("CILIUM_NETWORK");
  const [content, setContent] = useState<string>(policyTemplates.CILIUM_NETWORK ?? "");
  const [namespaces, setNamespaces] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const createMutation = trpc.template.create.useMutation({
    onSuccess: (data) => {
      router.push(`/templates/${data.id}`);
    },
  });

  const handleTypeChange = (newType: string) => {
    const currentTemplate = policyTemplates[type] ?? "";
    setType(newType as PolicyType);
    // Update content template if user hasn't modified it much
    if (content === currentTemplate || content.length < 50) {
      setContent(policyTemplates[newType] ?? "");
    }
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!name) {
      newErrors.name = "Template name is required";
    } else if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(name)) {
      newErrors.name = "Name must start/end with alphanumeric and contain only lowercase letters, numbers, and hyphens";
    } else if (name.length > 63) {
      newErrors.name = "Name must be 63 characters or less";
    }

    if (!content) {
      newErrors.content = "Template content is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const targetNamespaces = namespaces
      .split(",")
      .map((ns) => ns.trim())
      .filter((ns) => ns.length > 0);

    createMutation.mutate({
      name,
      description: description || undefined,
      type,
      content,
      defaultTargetNamespaces: targetNamespaces,
    });
  };

  return (
    <AppShell>
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Link href="/templates" className="text-muted hover:text-foreground">
            Templates
          </Link>
          <span className="text-muted">/</span>
          <h1 className="text-2xl font-bold text-foreground">New Template</h1>
        </div>
        <p className="text-muted">
          Create a reusable policy template to sync across multiple clusters
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-3 gap-6">
          {/* Main form */}
          <div className="col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Template Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  label="Template Name"
                  placeholder="my-network-policy"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  error={!!errors.name}
                  helperText={errors.name}
                  required
                />

                <Textarea
                  label="Description"
                  placeholder="Describe what this policy does..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />

                <Select
                  label="Policy Type"
                  value={type}
                  onChange={(e) => handleTypeChange(e.target.value)}
                  options={policyTypeOptions}
                  required
                />

                <Input
                  label="Default Target Namespaces"
                  placeholder="default, production (comma-separated)"
                  value={namespaces}
                  onChange={(e) => setNamespaces(e.target.value)}
                  helperText="Leave empty to target all namespaces. Can be overridden per-cluster."
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Policy Content (YAML)</CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={20}
                  className="font-mono text-sm"
                  error={!!errors.content}
                  helperText={errors.content}
                  required
                />
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Creating..." : "Create Template"}
                </Button>
                <Link href="/templates">
                  <Button type="button" variant="secondary" className="w-full">
                    Cancel
                  </Button>
                </Link>
              </CardContent>
            </Card>

            {createMutation.error && (
              <Card className="border-danger/30 bg-danger/10">
                <CardContent className="py-4">
                  <p className="text-sm text-danger">
                    {createMutation.error.message}
                  </p>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>About Templates</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted space-y-2">
                <p>
                  Templates are org-level policy definitions that can be synced
                  to multiple clusters.
                </p>
                <p>
                  When you sync a template to a cluster, it creates a Policy
                  record with independent status tracking.
                </p>
                <p>
                  Template changes don't auto-propagate - you must manually
                  sync to update cluster policies.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </form>
    </AppShell>
  );
}
