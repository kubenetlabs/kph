"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import AppShell from "~/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";
import Modal from "~/components/ui/modal";
import EditClusterForm, { type EditClusterFormData } from "~/components/clusters/edit-cluster-form";
import { trpc } from "~/lib/trpc";

const statusConfig = {
  CONNECTED: { variant: "success" as const, label: "Connected" },
  PENDING: { variant: "warning" as const, label: "Pending" },
  DEGRADED: { variant: "warning" as const, label: "Degraded" },
  DISCONNECTED: { variant: "danger" as const, label: "Disconnected" },
  ERROR: { variant: "danger" as const, label: "Error" },
};

const environmentConfig = {
  PRODUCTION: { variant: "danger" as const, label: "Production" },
  STAGING: { variant: "warning" as const, label: "Staging" },
  DEVELOPMENT: { variant: "accent" as const, label: "Development" },
  TESTING: { variant: "muted" as const, label: "Testing" },
};

export default function ClusterDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const clusterId = params.id as string;

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");

  const { data: cluster, isLoading, refetch } = trpc.cluster.getById.useQuery(
    { id: clusterId },
    { enabled: !!clusterId }
  );

  const updateMutation = trpc.cluster.update.useMutation({
    onSuccess: () => {
      void refetch();
      setIsEditModalOpen(false);
    },
  });

  const deleteMutation = trpc.cluster.delete.useMutation({
    onSuccess: () => {
      router.push("/clusters");
    },
  });

  // Open edit modal if ?edit=true in URL
  useEffect(() => {
    if (searchParams.get("edit") === "true" && cluster) {
      setIsEditModalOpen(true);
      // Remove query param from URL
      router.replace(`/clusters/${clusterId}`);
    }
  }, [searchParams, cluster, clusterId, router]);

  const handleEditSubmit = async (data: EditClusterFormData) => {
    await updateMutation.mutateAsync({
      id: clusterId,
      ...data,
    });
  };

  const handleDelete = async () => {
    await deleteMutation.mutateAsync({ id: clusterId });
  };

  const handleCloseDeleteModal = () => {
    setIsDeleteModalOpen(false);
    setDeleteConfirmName("");
  };

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-accent border-t-transparent"></div>
        </div>
      </AppShell>
    );
  }

  if (!cluster) {
    return (
      <AppShell>
        <div className="py-12 text-center">
          <h2 className="text-xl font-semibold text-foreground">Cluster not found</h2>
          <p className="mt-2 text-muted">The cluster you&apos;re looking for doesn&apos;t exist.</p>
          <Button className="mt-4" onClick={() => router.push("/clusters")}>
            Back to Clusters
          </Button>
        </div>
      </AppShell>
    );
  }

  const status = statusConfig[cluster.status as keyof typeof statusConfig];
  const env = environmentConfig[cluster.environment as keyof typeof environmentConfig];

  return (
    <AppShell>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => router.push("/clusters")}>
            <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">{cluster.name}</h1>
              <Badge variant={status?.variant}>{status?.label}</Badge>
              <Badge variant={env?.variant}>{env?.label}</Badge>
            </div>
            {cluster.description && (
              <p className="mt-1 text-muted">{cluster.description}</p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setIsEditModalOpen(true)}>
            <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Edit
          </Button>
          <Button variant="danger" onClick={() => setIsDeleteModalOpen(true)}>
            <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete
          </Button>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted">Provider</p>
            <p className="text-xl font-semibold text-foreground">{cluster.provider}</p>
            <p className="text-sm text-muted">{cluster.region}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted">Kubernetes Version</p>
            <p className="text-xl font-semibold text-foreground">
              {cluster.kubernetesVersion ?? "Unknown"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted">Nodes</p>
            <p className="text-xl font-semibold text-foreground">
              {cluster.nodeCount ?? "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted">Namespaces</p>
            <p className="text-xl font-semibold text-foreground">
              {cluster.namespaceCount ?? "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Operator Status */}
        <Card>
          <CardHeader>
            <CardTitle>Operator Status</CardTitle>
          </CardHeader>
          <CardContent>
            {cluster.operatorInstalled ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-muted">Status</span>
                  <Badge variant="policyhub">Installed</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">Version</span>
                  <span className="font-medium text-foreground">v{cluster.operatorVersion}</span>
                </div>
                {cluster.operatorId && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Operator ID</span>
                    <code className="rounded bg-card-hover px-2 py-1 text-xs">{cluster.operatorId}</code>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-muted">Last Heartbeat</span>
                  <span className="text-foreground">
                    {cluster.lastHeartbeat
                      ? new Date(cluster.lastHeartbeat).toLocaleString()
                      : "Never"}
                  </span>
                </div>
              </div>
            ) : (
              <div className="py-4 text-center">
                <Badge variant="muted">Not Installed</Badge>
                <p className="mt-4 text-sm text-muted">
                  Install the Policy Hub operator to enable policy synchronization.
                </p>
                <Button className="mt-4" variant="secondary">
                  View Installation Instructions
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Cluster Details */}
        <Card>
          <CardHeader>
            <CardTitle>Cluster Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-muted">Cluster ID</span>
                <code className="rounded bg-card-hover px-2 py-1 text-xs">{cluster.id}</code>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Environment</span>
                <Badge variant={env?.variant}>{env?.label}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Created</span>
                <span className="text-foreground">
                  {new Date(cluster.createdAt).toLocaleDateString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Policies Deployed</span>
                <span className="font-medium text-foreground">{cluster._count?.policies ?? 0}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Policies Section */}
      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Deployed Policies</CardTitle>
          <Button variant="secondary" size="sm" onClick={() => router.push("/policies")}>
            View All Policies
          </Button>
        </CardHeader>
        <CardContent>
          {cluster._count?.policies === 0 ? (
            <div className="py-8 text-center">
              <p className="text-muted">No policies deployed to this cluster yet.</p>
              <Button className="mt-4" onClick={() => router.push("/policies/new")}>
                Create Policy
              </Button>
            </div>
          ) : (
            <p className="text-muted">
              {cluster._count?.policies} policies are deployed to this cluster.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Edit Cluster Modal */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title="Edit Cluster"
        description="Update your cluster settings."
      >
        <EditClusterForm
          cluster={{
            id: cluster.id,
            name: cluster.name,
            description: cluster.description,
            environment: cluster.environment,
            provider: cluster.provider,
            region: cluster.region,
          }}
          onSubmit={handleEditSubmit}
          onCancel={() => setIsEditModalOpen(false)}
          isLoading={updateMutation.isPending}
        />
        {updateMutation.error && (
          <div className="mt-4 rounded-md border border-danger/30 bg-danger/10 p-3">
            <p className="text-sm text-danger">
              {updateMutation.error.message}
            </p>
          </div>
        )}
      </Modal>

      {/* Delete Cluster Confirmation Modal */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={handleCloseDeleteModal}
        title="Delete Cluster"
        description="This action cannot be undone."
      >
        <div className="space-y-4">
          <div className="rounded-md border border-danger/30 bg-danger/10 p-4">
            <div className="flex gap-3">
              <svg
                className="h-5 w-5 flex-shrink-0 text-danger"
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
                <p className="text-sm font-medium text-danger">Warning</p>
                <p className="mt-1 text-sm text-muted">
                  Deleting this cluster will:
                </p>
                <ul className="mt-2 list-inside list-disc text-sm text-muted">
                  <li>Remove all policies deployed to this cluster</li>
                  <li>Revoke all API tokens associated with this cluster</li>
                  <li>Delete all flow records from this cluster</li>
                  <li>Stop the operator from communicating with Policy Hub</li>
                </ul>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Type <span className="font-mono text-danger">{cluster.name}</span> to confirm
            </label>
            <input
              type="text"
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              placeholder={cluster.name}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-danger/50"
              autoComplete="off"
            />
          </div>

          {deleteMutation.error && (
            <div className="rounded-md border border-danger/30 bg-danger/10 p-3">
              <p className="text-sm text-danger">
                {deleteMutation.error.message}
              </p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={handleCloseDeleteModal}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleDelete}
              disabled={deleteConfirmName !== cluster.name || deleteMutation.isPending}
              isLoading={deleteMutation.isPending}
            >
              <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete Cluster
            </Button>
          </div>
        </div>
      </Modal>
    </AppShell>
  );
}
