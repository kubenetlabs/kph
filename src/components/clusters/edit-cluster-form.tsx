"use client";

import { useState } from "react";
import { z } from "zod";
import Button from "~/components/ui/button";
import Input from "~/components/ui/input";
import Select from "~/components/ui/select";

const editClusterSchema = z.object({
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
  environment: z.enum(["PRODUCTION", "STAGING", "DEVELOPMENT", "TESTING"], {
    errorMap: () => ({ message: "Please select an environment" }),
  }),
});

export type EditClusterFormData = z.infer<typeof editClusterSchema>;

interface FormErrors {
  name?: string;
  description?: string;
  environment?: string;
}

interface ClusterData {
  id: string;
  name: string;
  description: string | null;
  environment: string;
  provider: string;
  region: string;
}

interface EditClusterFormProps {
  cluster: ClusterData;
  onSubmit: (data: EditClusterFormData) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

const environmentOptions = [
  { value: "PRODUCTION", label: "Production" },
  { value: "STAGING", label: "Staging" },
  { value: "DEVELOPMENT", label: "Development" },
  { value: "TESTING", label: "Testing" },
];

export default function EditClusterForm({
  cluster,
  onSubmit,
  onCancel,
  isLoading = false,
}: EditClusterFormProps) {
  const [formData, setFormData] = useState<EditClusterFormData>({
    name: cluster.name,
    description: cluster.description ?? "",
    environment: cluster.environment as EditClusterFormData["environment"],
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const validateField = (field: keyof EditClusterFormData, value: unknown) => {
    const partialSchema = editClusterSchema.shape[field];
    const result = partialSchema.safeParse(value);

    if (!result.success) {
      return result.error.errors[0]?.message ?? "Invalid value";
    }
    return undefined;
  };

  const handleChange = (field: keyof EditClusterFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));

    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const handleBlur = (field: keyof EditClusterFormData) => {
    setTouched((prev) => ({ ...prev, [field]: true }));

    const error = validateField(field, formData[field]);
    setErrors((prev) => ({ ...prev, [field]: error }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const result = editClusterSchema.safeParse(formData);

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
        environment: true,
      });
      return;
    }

    onSubmit(result.data);
  };

  const hasChanges =
    formData.name !== cluster.name ||
    formData.description !== (cluster.description ?? "") ||
    formData.environment !== cluster.environment;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Read-only info */}
      <div className="rounded-lg border border-border bg-card-hover p-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted">Provider</p>
            <p className="font-medium text-foreground">{cluster.provider}</p>
          </div>
          <div>
            <p className="text-muted">Region</p>
            <p className="font-medium text-foreground">{cluster.region}</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted">
          Provider and region cannot be changed after cluster creation.
        </p>
      </div>

      {/* Cluster Name */}
      <Input
        label="Cluster Name"
        placeholder="prod-us-east"
        value={formData.name}
        onChange={(e) => handleChange("name", e.target.value)}
        onBlur={() => handleBlur("name")}
        error={touched.name && !!errors.name}
        helperText={
          touched.name && errors.name
            ? errors.name
            : "A unique identifier for your cluster"
        }
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
        helperText={
          touched.description && errors.description
            ? errors.description
            : "Optional description for this cluster"
        }
        disabled={isLoading}
      />

      {/* Environment */}
      <Select
        label="Environment"
        options={environmentOptions}
        placeholder="Select environment..."
        value={formData.environment}
        onChange={(e) => handleChange("environment", e.target.value)}
        onBlur={() => handleBlur("environment")}
        error={touched.environment && !!errors.environment}
        helperText={
          touched.environment && errors.environment
            ? errors.environment
            : undefined
        }
        disabled={isLoading}
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
        <Button type="submit" isLoading={isLoading} disabled={!hasChanges}>
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
              d="M5 13l4 4L19 7"
            />
          </svg>
          Save Changes
        </Button>
      </div>
    </form>
  );
}
