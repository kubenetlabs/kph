"use client";

import { useState } from "react";
import { z } from "zod";
import Button from "~/components/ui/button";
import Input from "~/components/ui/input";
import Select from "~/components/ui/select";

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
});

type CreateClusterFormData = z.infer<typeof createClusterSchema>;

interface FormErrors {
  name?: string;
  description?: string;
  provider?: string;
  region?: string;
  environment?: string;
  endpoint?: string;
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
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

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
  };

  const handleBlur = (field: keyof CreateClusterFormData) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    
    const error = validateField(field, formData[field]);
    setErrors((prev) => ({ ...prev, [field]: error }));
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
      });
      return;
    }

    onSubmit(result.data);
  };

  const selectedProvider = formData.provider as keyof typeof regionSuggestions;
  const suggestedRegions = selectedProvider ? regionSuggestions[selectedProvider] : [];

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
              After creating the cluster, you&apos;ll need to install the Policy Hub operator and configure authentication credentials.
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

