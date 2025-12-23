"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AppShell from "~/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";
import Modal from "~/components/ui/modal";
import PolicyForm from "~/components/policies/policy-form";
import { trpc } from "~/lib/trpc";

type PolicyType =
  | "CILIUM_NETWORK"
  | "CILIUM_CLUSTERWIDE"
  | "TETRAGON"
  | "GATEWAY_HTTPROUTE"
  | "GATEWAY_GRPCROUTE"
  | "GATEWAY_TCPROUTE";

type PolicyStatus =
  | "DRAFT"
  | "SIMULATING"
  | "PENDING"
  | "DEPLOYED"
  | "FAILED"
  | "ARCHIVED";

const typeConfig: Record<PolicyType, { variant: "cilium" | "tetragon" | "gateway"; label: string }> = {
  CILIUM_NETWORK: { variant: "cilium", label: "Cilium Network Policy" },
  CILIUM_CLUSTERWIDE: { variant: "cilium", label: "Cilium Clusterwide Network Policy" },
  TETRAGON: { variant: "tetragon", label: "Tetragon Tracing Policy" },
  GATEWAY_HTTPROUTE: { variant: "gateway", label: "Gateway HTTP Route" },
  GATEWAY_GRPCROUTE: { variant: "gateway", label: "Gateway gRPC Route" },
  GATEWAY_TCPROUTE: { variant: "gateway", label: "Gateway TCP Route" },
};

const statusConfig: Record<PolicyStatus, { variant: "muted" | "accent" | "warning" | "success" | "danger"; label: string }> = {
  DRAFT: { variant: "muted", label: "Draft" },
  SIMULATING: { variant: "accent", label: "Simulating" },
  PENDING: { variant: "warning", label: "Pending" },
  DEPLOYED: { variant: "success", label: "Deployed" },
  FAILED: { variant: "danger", label: "Failed" },
  ARCHIVED: { variant: "muted", label: "Archived" },
};

export default function PolicyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const policyId = params.id as string;

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isSimulationModalOpen, setIsSimulationModalOpen] = useState(false);
  const [simulationDays, setSimulationDays] = useState(7);

  const utils = trpc.useUtils();

  // Fetch policy details
  const { data: policy, isLoading, error } = trpc.policy.getById.useQuery(
    { id: policyId },
    { enabled: !!policyId }
  );

  // Update mutation
  const updateMutation = trpc.policy.update.useMutation({
    onSuccess: () => {
      void utils.policy.getById.invalidate({ id: policyId });
      void utils.policy.list.invalidate();
      setIsEditModalOpen(false);
    },
  });

  // Delete mutation
  const deleteMutation = trpc.policy.delete.useMutation({
    onSuccess: () => {
      router.push("/policies");
    },
  });

  // Deploy mutation
  const deployMutation = trpc.policy.deploy.useMutation({
    onSuccess: () => {
      void utils.policy.getById.invalidate({ id: policyId });
      void utils.policy.list.invalidate();
    },
  });

  // Archive mutation
  const archiveMutation = trpc.policy.archive.useMutation({
    onSuccess: () => {
      void utils.policy.getById.invalidate({ id: policyId });
      void utils.policy.list.invalidate();
    },
  });

  const handleUpdate = (formData: {
    name: string;
    description?: string;
    type: PolicyType;
    clusterId: string;
    content: string;
    targetNamespaces: string[];
  }) => {
    updateMutation.mutate({
      id: policyId,
      name: formData.name,
      description: formData.description,
      type: formData.type,
      content: formData.content,
      targetNamespaces: formData.targetNamespaces,
    });
  };

  const handleDelete = () => {
    deleteMutation.mutate({ id: policyId });
  };

  const handleDeploy = () => {
    deployMutation.mutate({ id: policyId });
  };

  const handleArchive = () => {
    archiveMutation.mutate({ id: policyId });
  };

  const handleRunSimulation = async () => {
    setIsSimulationModalOpen(true);
  };

  const handleStartSimulation = async () => {
    try {
      const response = await fetch("/api/operator/simulation/pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policyId: policy?.id,
          clusterId: policy?.clusterId,
          daysToAnalyze: simulationDays,
        }),
      });
      if (response.ok) {
        setIsSimulationModalOpen(false);
        void utils.policy.getById.invalidate({ id: policyId });
        router.push("/simulation");
      }
    } catch (error) {
      console.error("Failed to start simulation:", error);
    }
  };

  const handleExportYAML = () => {
    if (!policy) return;
    const blob = new Blob([policy.content], { type: "application/x-yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${policy.name.toLowerCase().replace(/\s+/g, "-")}.yaml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleClonePolicy = () => {
    if (!policy) return;
    router.push(`/policies/new?cloneFrom=${policy.id}`);
  };

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </AppShell>
    );
  }

  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- checking truthiness, not nullish
  if (error || !policy) {
    return (
      <AppShell>
        <div className="rounded-md border border-danger/30 bg-danger/10 p-4">
          <p className="text-sm text-danger">
            {error?.message ?? "Policy not found"}
          </p>
          <Button
            variant="ghost"
            className="mt-4"
            onClick={() => router.push("/policies")}
          >
            ← Back to Policies
          </Button>
        </div>
      </AppShell>
    );
  }

  const type = typeConfig[policy.type as PolicyType];
  const status = statusConfig[policy.status as PolicyStatus];

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

        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">{policy.name}</h1>
              <Badge variant={status.variant}>{status.label}</Badge>
            </div>
            <p className="mt-2 text-muted">
              {policy.description ?? "No description provided"}
            </p>
          </div>

          <div className="flex gap-2">
            {policy.status === "DRAFT" && (
              <Button
                variant="secondary"
                onClick={handleDeploy}
                disabled={deployMutation.isPending}
              >
                {deployMutation.isPending ? "Deploying..." : "Deploy Policy"}
              </Button>
            )}
            {policy.status === "DEPLOYED" && (
              <Button
                variant="secondary"
                onClick={handleArchive}
                disabled={archiveMutation.isPending}
              >
                {archiveMutation.isPending ? "Archiving..." : "Archive Policy"}
              </Button>
            )}
            <Button onClick={() => setIsEditModalOpen(true)}>Edit Policy</Button>
            {policy.status !== "DEPLOYED" && (
              <Button
                variant="danger"
                onClick={() => setIsDeleteConfirmOpen(true)}
              >
                Delete
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="grid grid-cols-3 gap-6">
        {/* Policy Content */}
        <div className="col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Policy Definition</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="overflow-auto rounded-md bg-background p-4 text-xs text-foreground">
                <code>{policy.content}</code>
              </pre>
            </CardContent>
          </Card>

          {/* Version History */}
          {policy.versions && policy.versions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Version History</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {policy.versions.map((version) => (
                    <div
                      key={version.id}
                      className="flex items-center justify-between rounded-md border border-card-border p-3"
                    >
                      <div>
                        <span className="font-medium text-foreground">
                          Version {version.version}
                        </span>
                        {version.changelog && (
                          <p className="mt-1 text-sm text-muted">
                            {version.changelog}
                          </p>
                        )}
                      </div>
                      <span className="text-xs text-muted">
                        {new Date(version.createdAt).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recent Simulations */}
          {policy.simulations && policy.simulations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Recent Simulations</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {policy.simulations.map((sim) => (
                    <div
                      key={sim.id}
                      className="flex items-center justify-between rounded-md border border-card-border p-3"
                    >
                      <div>
                        <span className="font-medium text-foreground">
                          {sim.name}
                        </span>
                        <div className="mt-1 flex gap-4 text-sm text-muted">
                          <span>{sim.flowsAnalyzed ?? 0} flows analyzed</span>
                          <span className="text-success">
                            {sim.flowsAllowed ?? 0} allowed
                          </span>
                          <span className="text-danger">
                            {sim.flowsDenied ?? 0} denied
                          </span>
                        </div>
                      </div>
                      <Badge
                        variant={
                          sim.status === "COMPLETED"
                            ? "success"
                            : sim.status === "RUNNING"
                            ? "accent"
                            : sim.status === "FAILED"
                            ? "danger"
                            : "muted"
                        }
                      >
                        {sim.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Policy Info */}
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <span className="text-xs text-muted">Type</span>
                <div className="mt-1">
                  <Badge variant={type.variant}>{type.label}</Badge>
                </div>
              </div>

              <div>
                <span className="text-xs text-muted">Cluster</span>
                <p className="mt-1 font-medium text-foreground">
                  {policy.cluster.name}
                </p>
                <p className="text-sm text-muted">
                  {policy.cluster.provider} • {policy.cluster.region}
                </p>
              </div>

              <div>
                <span className="text-xs text-muted">Target Namespaces</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {policy.targetNamespaces.length > 0 ? (
                    policy.targetNamespaces.map((ns) => (
                      <Badge key={ns} variant="muted">
                        {ns}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm text-muted">All namespaces</span>
                  )}
                </div>
              </div>

              <div>
                <span className="text-xs text-muted">Created By</span>
                <p className="mt-1 text-sm text-foreground">
                  {policy.createdBy.name ?? policy.createdBy.email}
                </p>
              </div>

              <div>
                <span className="text-xs text-muted">Created</span>
                <p className="mt-1 text-sm text-foreground">
                  {new Date(policy.createdAt).toLocaleString()}
                </p>
              </div>

              {policy.deployedAt && (
                <div>
                  <span className="text-xs text-muted">Deployed</span>
                  <p className="mt-1 text-sm text-foreground">
                    {new Date(policy.deployedAt).toLocaleString()}
                  </p>
                  {policy.deployedVersion && (
                    <p className="text-xs text-muted">
                      Version {policy.deployedVersion}
                    </p>
                  )}
                </div>
              )}

              {policy.generatedFrom && (
                <div>
                  <span className="text-xs text-muted">Generated From</span>
                  <p className="mt-1 text-sm italic text-muted">
                    &quot;{policy.generatedFrom}&quot;
                  </p>
                  {policy.generatedModel && (
                    <p className="text-xs text-muted">
                      Model: {policy.generatedModel}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="secondary" className="w-full justify-start" onClick={handleRunSimulation}>
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
                    d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
                Run Simulation
              </Button>
              <Button variant="secondary" className="w-full justify-start" onClick={handleClonePolicy}>
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
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                Clone Policy
              </Button>
              <Button variant="secondary" className="w-full justify-start" onClick={handleExportYAML}>
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
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                Export YAML
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Edit Modal */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title="Edit Policy"
        description="Update the policy configuration"
        size="2xl"
      >
        <PolicyForm
          mode="edit"
          initialData={{
            id: policy.id,
            name: policy.name,
            description: policy.description,
            type: policy.type,
            clusterId: policy.clusterId,
            content: policy.content,
            targetNamespaces: policy.targetNamespaces,
          }}
          onSubmit={handleUpdate}
          onCancel={() => setIsEditModalOpen(false)}
          isLoading={updateMutation.isPending}
        />
        {updateMutation.error && (
          <p className="mt-4 text-sm text-danger">
            {updateMutation.error.message}
          </p>
        )}
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={isDeleteConfirmOpen}
        onClose={() => setIsDeleteConfirmOpen(false)}
        title="Delete Policy"
        description="This action cannot be undone"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Are you sure you want to delete <strong>{policy.name}</strong>? This
            will permanently remove the policy and all its version history.
          </p>
          <div className="flex justify-end gap-3">
            <Button
              variant="ghost"
              onClick={() => setIsDeleteConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleDelete}
              isLoading={deleteMutation.isPending}
            >
              Delete Policy
            </Button>
          </div>
          {deleteMutation.error && (
            <p className="text-sm text-danger">
              {deleteMutation.error.message}
            </p>
          )}
        </div>
      </Modal>

      {/* Simulation Modal */}
      <Modal
        isOpen={isSimulationModalOpen}
        onClose={() => setIsSimulationModalOpen(false)}
        title="Run Policy Simulation"
        description="Test this policy against historical network traffic"
        size="sm"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Days of traffic to analyze
            </label>
            <select
              value={simulationDays}
              onChange={(e) => setSimulationDays(Number(e.target.value))}
              className="w-full rounded-md border border-card-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value={1}>Last 24 hours</option>
              <option value={3}>Last 3 days</option>
              <option value={7}>Last 7 days</option>
            </select>
          </div>
          <div className="rounded-md bg-accent/10 p-3">
            <p className="text-sm text-muted">
              The simulation will replay historical network flows against this policy
              to show what would be allowed or denied if deployed.
            </p>
          </div>
          <div className="flex justify-end gap-3">
            <Button
              variant="ghost"
              onClick={() => setIsSimulationModalOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleStartSimulation}>
              Start Simulation
            </Button>
          </div>
        </div>
      </Modal>
    </AppShell>
  );
}
