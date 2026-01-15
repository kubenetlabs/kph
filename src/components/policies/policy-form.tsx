"use client";

import { useState, useEffect } from "react";
import { z } from "zod";
import Button from "~/components/ui/button";
import Input from "~/components/ui/input";
import Select from "~/components/ui/select";
import Textarea from "~/components/ui/textarea";
import { trpc } from "~/lib/trpc";

// Zod schema for policy validation
const policySchema = z.object({
  name: z
    .string()
    .min(1, "Policy name is required")
    .max(63, "Policy name must be 63 characters or less")
    .regex(
      /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/,
      "Policy name must start and end with alphanumeric characters and can only contain lowercase letters, numbers, and hyphens"
    ),
  description: z
    .string()
    .max(500, "Description must be 500 characters or less")
    .optional(),
  type: z.enum(
    [
      "CILIUM_NETWORK",
      "CILIUM_CLUSTERWIDE",
      "TETRAGON",
      "GATEWAY_HTTPROUTE",
      "GATEWAY_GRPCROUTE",
      "GATEWAY_TCPROUTE",
      "GATEWAY_TLSROUTE",
    ],
    {
      errorMap: () => ({ message: "Please select a policy type" }),
    }
  ),
  clusterId: z.string().min(1, "Please select a cluster"),
  content: z.string().min(1, "Policy content is required"),
  targetNamespaces: z.string().optional(),
});

type PolicyFormData = z.infer<typeof policySchema>;

interface FormErrors {
  name?: string;
  description?: string;
  type?: string;
  clusterId?: string;
  content?: string;
  targetNamespaces?: string;
}

interface PolicyFormProps {
  initialData?: {
    id?: string;
    name: string;
    description?: string | null;
    type: string;
    clusterId: string;
    content: string;
    targetNamespaces: string[];
  };
  onSubmit: (data: {
    name: string;
    description?: string;
    type: "CILIUM_NETWORK" | "CILIUM_CLUSTERWIDE" | "TETRAGON" | "GATEWAY_HTTPROUTE" | "GATEWAY_GRPCROUTE" | "GATEWAY_TCPROUTE" | "GATEWAY_TLSROUTE";
    clusterId: string;
    content: string;
    targetNamespaces: string[];
  }) => void;
  onCancel: () => void;
  isLoading?: boolean;
  mode: "create" | "edit";
}

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
  name: "policy-name"
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
  name: "policy-name"
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
  name: "policy-name"
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
  name: "policy-name"
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
  GATEWAY_GRPCROUTE: `apiVersion: gateway.networking.k8s.io/v1alpha2
kind: GRPCRoute
metadata:
  name: "policy-name"
  namespace: "default"
spec:
  parentRefs:
    - name: my-gateway
  hostnames:
    - "grpc.example.com"
  rules:
    - matches:
        - method:
            service: myservice
      backendRefs:
        - name: grpc-service
          port: 9090`,
  GATEWAY_TCPROUTE: `apiVersion: gateway.networking.k8s.io/v1alpha2
kind: TCPRoute
metadata:
  name: "policy-name"
  namespace: "default"
spec:
  parentRefs:
    - name: my-gateway
  rules:
    - backendRefs:
        - name: tcp-service
          port: 5432`,
  GATEWAY_TLSROUTE: `apiVersion: gateway.networking.k8s.io/v1alpha2
kind: TLSRoute
metadata:
  name: "policy-name"
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

export default function PolicyForm({
  initialData,
  onSubmit,
  onCancel,
  isLoading = false,
  mode,
}: PolicyFormProps) {
  const [formData, setFormData] = useState<Partial<PolicyFormData>>({
    name: initialData?.name ?? "",
    description: initialData?.description ?? "",
    type: initialData?.type as PolicyFormData["type"] | undefined,
    clusterId: initialData?.clusterId ?? "",
    content: initialData?.content ?? "",
    targetNamespaces: initialData?.targetNamespaces?.join(", ") ?? "",
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Fetch clusters for dropdown
  const { data: clusters, isLoading: clustersLoading } = trpc.cluster.list.useQuery();

  const clusterOptions = clusters?.map((c) => ({
    value: c.id,
    label: `${c.name} (${c.environment})`,
  })) ?? [];

  const validateField = (field: keyof PolicyFormData, value: unknown) => {
    const partialSchema = policySchema.shape[field];
    const result = partialSchema.safeParse(value);

    if (!result.success) {
      return result.error.errors[0]?.message ?? "Invalid value";
    }
    return undefined;
  };

  const handleChange = (field: keyof PolicyFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));

    // Clear error when user starts typing
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const handleBlur = (field: keyof PolicyFormData) => {
    setTouched((prev) => ({ ...prev, [field]: true }));

    const error = validateField(field, formData[field]);
    setErrors((prev) => ({ ...prev, [field]: error }));
  };

  // Auto-populate template when type changes
  useEffect(() => {
    if (mode === "create" && formData.type && !formData.content) {
      const template = policyTemplates[formData.type];
      if (template) {
        setFormData((prev) => ({ ...prev, content: template }));
      }
    }
  }, [formData.type, formData.content, mode]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate all fields
    const result = policySchema.safeParse(formData);

    if (!result.success) {
      const fieldErrors: FormErrors = {};
      result.error.errors.forEach((err) => {
        const field = err.path[0] as keyof FormErrors;
        if (!fieldErrors[field]) {
          fieldErrors[field] = err.message;
        }
      });
      setErrors(fieldErrors);
      setTouched({
        name: true,
        description: true,
        type: true,
        clusterId: true,
        content: true,
        targetNamespaces: true,
      });
      return;
    }

    // Parse target namespaces from comma-separated string
    const targetNamespaces = result.data.targetNamespaces
      ? result.data.targetNamespaces
          .split(",")
          .map((ns) => ns.trim())
          .filter((ns) => ns.length > 0)
      : [];

    onSubmit({
      name: result.data.name,
      description: result.data.description,
      type: result.data.type,
      clusterId: result.data.clusterId,
      content: result.data.content,
      targetNamespaces,
    });
  };

  const hasErrors = Object.values(errors).some((e) => e !== undefined);

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Validation Error Summary */}
      {hasErrors && (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-3">
          <p className="text-sm font-medium text-danger">Please fix the following errors:</p>
          <ul className="mt-1 list-disc list-inside text-sm text-danger">
            {Object.entries(errors).map(([field, error]) =>
              error ? <li key={field}>{error}</li> : null
            )}
          </ul>
        </div>
      )}

      {/* Policy Name */}
      <Input
        label="Policy Name"
        placeholder="my-network-policy"
        value={formData.name}
        onChange={(e) => handleChange("name", e.target.value)}
        onBlur={() => handleBlur("name")}
        error={touched.name && !!errors.name}
        helperText={
          touched.name && errors.name
            ? errors.name
            : "A unique identifier (lowercase, alphanumeric, hyphens)"
        }
        disabled={isLoading}
        autoFocus
      />

      {/* Description */}
      <Input
        label="Description"
        placeholder="Brief description of what this policy does"
        value={formData.description}
        onChange={(e) => handleChange("description", e.target.value)}
        onBlur={() => handleBlur("description")}
        error={touched.description && !!errors.description}
        helperText={
          touched.description && errors.description
            ? errors.description
            : "Optional description for documentation"
        }
        disabled={isLoading}
      />

      {/* Type and Cluster Row */}
      <div className="grid grid-cols-2 gap-4">
        <Select
          label="Policy Type"
          options={policyTypeOptions}
          placeholder="Select type..."
          value={formData.type ?? ""}
          onChange={(e) => handleChange("type", e.target.value)}
          onBlur={() => handleBlur("type")}
          error={touched.type && !!errors.type}
          helperText={touched.type && errors.type ? errors.type : undefined}
          disabled={isLoading}
        />

        <Select
          label="Target Cluster"
          options={clusterOptions}
          placeholder={clustersLoading ? "Loading clusters..." : "Select cluster..."}
          value={formData.clusterId ?? ""}
          onChange={(e) => handleChange("clusterId", e.target.value)}
          onBlur={() => handleBlur("clusterId")}
          error={touched.clusterId && !!errors.clusterId}
          helperText={
            touched.clusterId && errors.clusterId ? errors.clusterId : undefined
          }
          disabled={isLoading || clustersLoading}
        />
      </div>

      {/* Target Namespaces */}
      <Input
        label="Target Namespaces"
        placeholder="default, frontend, api"
        value={formData.targetNamespaces}
        onChange={(e) => handleChange("targetNamespaces", e.target.value)}
        onBlur={() => handleBlur("targetNamespaces")}
        error={touched.targetNamespaces && !!errors.targetNamespaces}
        helperText="Comma-separated list of namespaces (leave empty for all)"
        disabled={isLoading}
      />

      {/* Policy Content */}
      <Textarea
        label="Policy Content (YAML)"
        placeholder="Paste your policy YAML here..."
        value={formData.content}
        onChange={(e) => handleChange("content", e.target.value)}
        onBlur={() => handleBlur("content")}
        error={touched.content && !!errors.content}
        helperText={
          touched.content && errors.content
            ? errors.content
            : "The full policy definition in YAML format"
        }
        disabled={isLoading}
        rows={12}
        className="font-mono text-xs"
      />

      {/* Form Actions */}
      <div className="flex justify-end gap-3 pt-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={isLoading}
        >
          Cancel
        </Button>
        <Button type="submit" isLoading={isLoading}>
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
              d={mode === "create" ? "M12 4v16m8-8H4" : "M5 13l4 4L19 7"}
            />
          </svg>
          {mode === "create" ? "Create Policy" : "Save Changes"}
        </Button>
      </div>
    </form>
  );
}
