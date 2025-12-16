"use client";

import { useState } from "react";
import { z } from "zod";
import Button from "~/components/ui/button";
import Input from "~/components/ui/input";
import Select from "~/components/ui/select";
import { trpc } from "~/lib/trpc";

// Zod schema for cluster validation
const createClusterSchema = z.object({
  name: z
    .string()
    .min(1, "Cluster name is required")
    .max(63, "Cluster name must be 63 characters or less")
    .regex(
      /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/,
      "Cluster name must start and end with alphanumeric characters and can only contain lowercase letters, numbers, and hyphens"
    ),
  description: z
    .string()
    .max(500, "Description must be 500 characters or less")
    .optional(),
  provider: z.enum(["AWS", "GCP", "AZURE", "ON_PREM", "OTHER"], {
    errorMap: () => ({ message: "Please select a cloud provider" }),
  }),
  region: z
    .string()
    .min(1, "Region is required")
    .max(50, "Region must be 50 characters or less"),
  environment: z.enum(["PRODUCTION", "STAGING", "DEVELOPMENT", "TESTING"], {
    errorMap: () => ({ message: "Please select an environment" }),
  }),
  endpoint: z
    .string()
    .min(1, "Kubernetes API endpoint is required")
    .url("Please enter a valid URL (e.g., https://api.cluster.example.com)"),
  authToken: z
    .string()
    .min(1, "Service account token is required"),
  caCert: z
    .string()
    .optional(),
});

type CreateClusterFormData = z.infer<typeof createClusterSchema>;

interface FormErrors {
  name?: string;
  description?: string;
  provider?: string;
  region?: string;
  environment?: string;
  endpoint?: string;
  authToken?: string;
  caCert?: string;
}

interface ConnectionResult {
  success: boolean;
  kubernetesVersion?: string;
  nodeCount?: number;
  namespaceCount?: number;
  error?: string;
}

interface CreateClusterFormProps {
  onSubmit: (data: CreateClusterFormData) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

const providerOptions = [
  { value: "AWS", label: "Amazon Web Services (AWS)" },
  { value: "GCP", label: "Google Cloud Platform (GCP)" },
  { value: "AZURE", label: "Microsoft Azure" },
  { value: "ON_PREM", label: "On-Premises" },
  { value: "OTHER", label: "Other" },
];

const environmentOptions = [
  { value: "PRODUCTION", label: "Production" },
  { value: "STAGING", label: "Staging" },
  { value: "DEVELOPMENT", label: "Development" },
  { value: "TESTING", label: "Testing" },
];

const regionSuggestions: Record<string, string[]> = {
  AWS: ["us-east-1", "us-west-2", "eu-west-1", "eu-central-1", "ap-southeast-1"],
  GCP: ["us-central1", "us-east1", "europe-west1", "asia-east1"],
  AZURE: ["eastus", "westus2", "westeurope", "northeurope", "southeastasia"],
  ON_PREM: ["datacenter-1", "datacenter-2"],
  OTHER: [],
};

export default function CreateClusterForm({
  onSubmit,
  onCancel,
  isLoading = false,
}: CreateClusterFormProps) {
  const [formData, setFormData] = useState<Partial<CreateClusterFormData>>({
    name: "",
    description: "",
    provider: undefined,
    region: "",
    environment: undefined,
    endpoint: "",
    authToken: "",
    caCert: "",
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [showToken, setShowToken] = useState(false);
  const [connectionResult, setConnectionResult] = useState<ConnectionResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const testConnectionMutation = trpc.cluster.testConnection.useMutation();

  const validateField = (field: keyof CreateClusterFormData, value: unknown) => {
    const partialSchema = createClusterSchema.shape[field];
    const result = partialSchema.safeParse(value);

    if (!result.success) {
      return result.error.errors[0]?.message ?? "Invalid value";
    }
    return undefined;
  };

  const handleChange = (
    field: keyof CreateClusterFormData,
    value: string
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));

    // Clear error when user starts typing
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }

    // Clear connection result when connection params change
    if (field === "endpoint" || field === "authToken" || field === "caCert") {
      setConnectionResult(null);
    }
  };

  const handleBlur = (field: keyof CreateClusterFormData) => {
    setTouched((prev) => ({ ...prev, [field]: true }));

    const error = validateField(field, formData[field]);
    setErrors((prev) => ({ ...prev, [field]: error }));
  };

  const handleTestConnection = async () => {
    // Validate connection fields first
    const endpointError = validateField("endpoint", formData.endpoint);
    const tokenError = validateField("authToken", formData.authToken);

    if (endpointError !== undefined || tokenError !== undefined) {
      setErrors((prev) => ({
        ...prev,
        endpoint: endpointError,
        authToken: tokenError,
      }));
      setTouched((prev) => ({
        ...prev,
        endpoint: true,
        authToken: true,
      }));
      return;
    }

    setIsTesting(true);
    setConnectionResult(null);

    try {
      const result = await testConnectionMutation.mutateAsync({
        endpoint: formData.endpoint!,
        token: formData.authToken!,
        caCert: formData.caCert ? formData.caCert : undefined,
      });
      setConnectionResult(result);
    } catch (error) {
      setConnectionResult({
        success: false,
        error: error instanceof Error ? error.message : "Connection test failed",
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate all fields
    const result = createClusterSchema.safeParse(formData);

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
        provider: true,
        region: true,
        environment: true,
        endpoint: true,
        authToken: true,
        caCert: true,
      });
      return;
    }

    onSubmit(result.data);
  };

  const selectedProvider = formData.provider as keyof typeof regionSuggestions;
  const suggestedRegions = selectedProvider ? regionSuggestions[selectedProvider] ?? [] : [];

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Cluster Name */}
      <Input
        label="Cluster Name"
        placeholder="prod-us-east"
        value={formData.name}
        onChange={(e) => handleChange("name", e.target.value)}
        onBlur={() => handleBlur("name")}
        error={touched.name && !!errors.name}
        helperText={touched.name && errors.name ? errors.name : "A unique identifier for your cluster (lowercase, alphanumeric, hyphens)"}
        disabled={isLoading}
        autoFocus
      />

      {/* Description */}
      <Input
        label="Description"
        placeholder="Production workloads - US East region"
        value={formData.description}
        onChange={(e) => handleChange("description", e.target.value)}
        onBlur={() => handleBlur("description")}
        error={touched.description && !!errors.description}
        helperText={touched.description && errors.description ? errors.description : "Optional description for this cluster"}
        disabled={isLoading}
      />

      {/* Provider and Environment Row */}
      <div className="grid grid-cols-2 gap-4">
        <Select
          label="Cloud Provider"
          options={providerOptions}
          placeholder="Select provider..."
          value={formData.provider ?? ""}
          onChange={(e) => handleChange("provider", e.target.value)}
          onBlur={() => handleBlur("provider")}
          error={touched.provider && !!errors.provider}
          helperText={touched.provider && errors.provider ? errors.provider : undefined}
          disabled={isLoading}
        />

        <Select
          label="Environment"
          options={environmentOptions}
          placeholder="Select environment..."
          value={formData.environment ?? ""}
          onChange={(e) => handleChange("environment", e.target.value)}
          onBlur={() => handleBlur("environment")}
          error={touched.environment && !!errors.environment}
          helperText={touched.environment && errors.environment ? errors.environment : undefined}
          disabled={isLoading}
        />
      </div>

      {/* Region */}
      <div>
        <Input
          label="Region"
          placeholder={selectedProvider ? regionSuggestions[selectedProvider]?.[0] ?? "Enter region" : "Select a provider first"}
          value={formData.region}
          onChange={(e) => handleChange("region", e.target.value)}
          onBlur={() => handleBlur("region")}
          error={touched.region && !!errors.region}
          helperText={touched.region && errors.region ? errors.region : "The region where your cluster is deployed"}
          disabled={isLoading}
        />
        {suggestedRegions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {suggestedRegions.map((region) => (
              <button
                key={region}
                type="button"
                onClick={() => handleChange("region", region)}
                className="rounded-md bg-card-hover px-2 py-1 text-xs text-muted hover:bg-accent/20 hover:text-accent-light transition-colors"
              >
                {region}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Kubernetes API Endpoint */}
      <Input
        label="Kubernetes API Endpoint"
        placeholder="https://api.cluster.example.com:6443"
        value={formData.endpoint}
        onChange={(e) => handleChange("endpoint", e.target.value)}
        onBlur={() => handleBlur("endpoint")}
        error={touched.endpoint && !!errors.endpoint}
        helperText={touched.endpoint && errors.endpoint ? errors.endpoint : "The URL of your Kubernetes API server"}
        disabled={isLoading}
      />

      {/* Service Account Token */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">
          Service Account Token
        </label>
        <div className="relative">
          <textarea
            placeholder="eyJhbGciOiJSUzI1NiIsImtpZCI6..."
            value={formData.authToken}
            onChange={(e) => handleChange("authToken", e.target.value)}
            onBlur={() => handleBlur("authToken")}
            className={`w-full rounded-lg border bg-card px-3 py-2 text-sm text-foreground placeholder-muted focus:outline-none focus:ring-2 font-mono h-24 resize-none ${
              touched.authToken && errors.authToken
                ? "border-danger focus:ring-danger/50"
                : "border-border focus:ring-accent/50"
            }`}
            disabled={isLoading}
            style={{ WebkitTextSecurity: showToken ? "none" : "disc" } as React.CSSProperties}
          />
          <button
            type="button"
            onClick={() => setShowToken(!showToken)}
            className="absolute right-2 top-2 text-muted hover:text-foreground"
          >
            {showToken ? (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            )}
          </button>
        </div>
        <p className={`mt-1 text-xs ${touched.authToken && errors.authToken ? "text-danger" : "text-muted"}`}>
          {touched.authToken && errors.authToken
            ? errors.authToken
            : "The service account token for authenticating to the cluster"}
        </p>
      </div>

      {/* CA Certificate (Optional) */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">
          CA Certificate <span className="text-muted font-normal">(optional)</span>
        </label>
        <textarea
          placeholder="-----BEGIN CERTIFICATE-----&#10;MIIDXTCCAkWgAwIBAgIJAJC1HiIAZAiU..."
          value={formData.caCert}
          onChange={(e) => handleChange("caCert", e.target.value)}
          onBlur={() => handleBlur("caCert")}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-accent/50 font-mono h-24 resize-none"
          disabled={isLoading}
        />
        <p className="mt-1 text-xs text-muted">
          Base64-encoded CA certificate for clusters with self-signed certificates
        </p>
      </div>

      {/* Test Connection Button */}
      <div className="flex items-center gap-4">
        <Button
          type="button"
          variant="secondary"
          onClick={handleTestConnection}
          disabled={isLoading || isTesting || !formData.endpoint || !formData.authToken}
          isLoading={isTesting}
        >
          <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          Test Connection
        </Button>

        {/* Connection Result */}
        {connectionResult && (
          <div className={`flex items-center gap-2 text-sm ${connectionResult.success ? "text-success" : "text-danger"}`}>
            {connectionResult.success ? (
              <>
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>
                  Connected - K8s {connectionResult.kubernetesVersion}
                  {connectionResult.nodeCount !== undefined && ` | ${connectionResult.nodeCount} nodes`}
                  {connectionResult.namespaceCount !== undefined && ` | ${connectionResult.namespaceCount} namespaces`}
                </span>
              </>
            ) : (
              <>
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{connectionResult.error}</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Security Notice */}
      <div className="rounded-md border border-warning/30 bg-warning/10 p-3">
        <div className="flex gap-2">
          <svg
            className="h-5 w-5 flex-shrink-0 text-warning"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <div>
            <p className="text-sm font-medium text-warning">Security Note</p>
            <p className="mt-1 text-xs text-muted">
              Your service account token is encrypted before storage. After creating the cluster, you&apos;ll receive an API token to install the Policy Hub operator.
            </p>
          </div>
        </div>
      </div>

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
              d="M12 4v16m8-8H4"
            />
          </svg>
          Create Cluster
        </Button>
      </div>
    </form>
  );
}
