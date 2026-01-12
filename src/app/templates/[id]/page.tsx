"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import AppShell from "~/components/layout/app-shell";
import { Card, CardHeader, CardTitle, CardContent } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";
import Modal from "~/components/ui/modal";
import { trpc } from "~/lib/trpc";

type PolicyType =
  | "CILIUM_NETWORK"
  | "CILIUM_CLUSTERWIDE"
  | "TETRAGON"
  | "GATEWAY_HTTPROUTE"
  | "GATEWAY_GRPCROUTE"
  | "GATEWAY_TCPROUTE"
  | "GATEWAY_TLSROUTE";

type SyncStatus = "SYNCED" | "OUT_OF_DATE" | "NOT_SYNCED";

const typeConfig: Record<PolicyType, { variant: "cilium" | "tetragon" | "gateway"; label: string }> = {
  CILIUM_NETWORK: { variant: "cilium", label: "Cilium Network" },
  CILIUM_CLUSTERWIDE: { variant: "cilium", label: "Cilium Clusterwide" },
  TETRAGON: { variant: "tetragon", label: "Tetragon" },
  GATEWAY_HTTPROUTE: { variant: "gateway", label: "Gateway HTTP" },
  GATEWAY_GRPCROUTE: { variant: "gateway", label: "Gateway gRPC" },
  GATEWAY_TCPROUTE: { variant: "gateway", label: "Gateway TCP" },
  GATEWAY_TLSROUTE: { variant: "gateway", label: "Gateway TLS" },
};

const syncStatusConfig: Record<SyncStatus, { variant: "success" | "warning" | "muted"; label: string }> = {
  SYNCED: { variant: "success", label: "Synced" },
  OUT_OF_DATE: { variant: "warning", label: "Out of Date" },
  NOT_SYNCED: { variant: "muted", label: "Not Synced" },
};

export default function TemplateDetailPage() {
  const params = useParams();
  const router = useRouter();
  const templateId = params.id as string;

  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [selectedClusters, setSelectedClusters] = useState<string[]>([]);
  const [deployAfterSync, setDeployAfterSync] = useState(false);

  const utils = trpc.useUtils();

  // Fetch template details
  const { data: template, isLoading, error } = trpc.template.getById.useQuery(
    { id: templateId },
    { enabled: !!templateId }
  );

  // Sync mutation
  const syncMutation = trpc.template.sync.useMutation({
    onSuccess: () => {
      void utils.template.getById.invalidate({ id: templateId });
      setIsSyncModalOpen(false);
      setSelectedClusters([]);
    },
  });

  // Delete mutation
  const deleteMutation = trpc.template.delete.useMutation({
    onSuccess: () => {
      router.push("/templates");
    },
  });

  const handleSync = () => {
    if (selectedClusters.length === 0) return;
    syncMutation.mutate({
      templateId,
      clusterIds: selectedClusters,
      deployAfterSync,
    });
  };

  const handleDelete = () => {
    if (confirm(`Are you sure you want to delete "${template?.name}"? Linked policies will become standalone.`)) {
      deleteMutation.mutate({ id: templateId });
    }
  };

  const toggleCluster = (clusterId: string) => {
    setSelectedClusters((prev) =>
      prev.includes(clusterId)
        ? prev.filter((id) => id !== clusterId)
        : [...prev, clusterId]
    );
  };

  const selectAllClusters = () => {
    if (template?.syncStatus) {
      setSelectedClusters(template.syncStatus.map((s) => s.cluster.id));
    }
  };

  const selectOutOfDateClusters = () => {
    if (template?.syncStatus) {
      setSelectedClusters(
        template.syncStatus
          .filter((s) => s.status === "OUT_OF_DATE")
          .map((s) => s.cluster.id)
      );
    }
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

  if (error || !template) {
    return (
      <AppShell>
        <div className="rounded-md border border-danger/30 bg-danger/10 p-4">
          <p className="text-sm text-danger">
            {error?.message ?? "Template not found"}
          </p>
        </div>
      </AppShell>
    );
  }

  const type = typeConfig[template.type as PolicyType];
  const syncedCount = template.syncStatus.filter((s) => s.status === "SYNCED").length;
  const outOfDateCount = template.syncStatus.filter((s) => s.status === "OUT_OF_DATE").length;
  const notSyncedCount = template.syncStatus.filter((s) => s.status === "NOT_SYNCED").length;

  return (
    <AppShell>
      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/templates" className="text-muted hover:text-foreground">
              Templates
            </Link>
            <span className="text-muted">/</span>
            <h1 className="text-2xl font-bold text-foreground">{template.name}</h1>
            <Badge variant="muted">v{template.currentVersion}</Badge>
          </div>
          <p className="mt-2 text-muted">
            {template.description ?? "No description"}
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={handleDelete} disabled={deleteMutation.isPending}>
            Delete
          </Button>
          <Button onClick={() => setIsSyncModalOpen(true)}>
            Sync to Clusters
          </Button>
        </div>
      </div>

      {/* Info Cards */}
      <div className="mb-6 grid grid-cols-4 gap-4">
        <Card className="text-center">
          <CardContent className="py-4">
            <Badge variant={type.variant} className="mb-2">{type.label}</Badge>
            <p className="text-sm text-muted">Policy Type</p>
          </CardContent>
        </Card>
        <Card className="text-center">
          <CardContent className="py-4">
            <p className="text-2xl font-bold text-success">{syncedCount}</p>
            <p className="text-sm text-muted">Clusters Synced</p>
          </CardContent>
        </Card>
        <Card className="text-center">
          <CardContent className="py-4">
            <p className="text-2xl font-bold text-warning">{outOfDateCount}</p>
            <p className="text-sm text-muted">Out of Date</p>
          </CardContent>
        </Card>
        <Card className="text-center">
          <CardContent className="py-4">
            <p className="text-2xl font-bold text-muted">{notSyncedCount}</p>
            <p className="text-sm text-muted">Not Synced</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Sync Status Table */}
        <div className="col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Cluster Sync Status</CardTitle>
            </CardHeader>
            <CardContent>
              {template.syncStatus.length === 0 ? (
                <p className="text-center text-muted py-8">
                  No clusters available. Add clusters first.
                </p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-card-border text-left text-sm text-muted">
                      <th className="pb-3 font-medium">Cluster</th>
                      <th className="pb-3 font-medium">Environment</th>
                      <th className="pb-3 font-medium">Sync Status</th>
                      <th className="pb-3 font-medium">Version</th>
                      <th className="pb-3 font-medium">Policy Status</th>
                      <th className="pb-3 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {template.syncStatus.map((item) => {
                      const status = syncStatusConfig[item.status as SyncStatus];
                      return (
                        <tr key={item.cluster.id} className="border-b border-card-border last:border-0">
                          <td className="py-3 font-medium text-foreground">
                            {item.cluster.name}
                          </td>
                          <td className="py-3 text-sm text-muted">
                            {item.cluster.environment}
                          </td>
                          <td className="py-3">
                            <Badge variant={status.variant}>{status.label}</Badge>
                          </td>
                          <td className="py-3 text-sm">
                            {item.syncedVersion ? (
                              <span className={item.syncedVersion < template.currentVersion ? "text-warning" : "text-foreground"}>
                                v{item.syncedVersion}
                                {item.syncedVersion < template.currentVersion && (
                                  <span className="text-muted"> / v{template.currentVersion}</span>
                                )}
                              </span>
                            ) : (
                              <span className="text-muted">-</span>
                            )}
                          </td>
                          <td className="py-3">
                            {item.policyStatus ? (
                              <Badge
                                variant={
                                  item.policyStatus === "DEPLOYED" ? "success" :
                                  item.policyStatus === "FAILED" ? "danger" :
                                  item.policyStatus === "PENDING" ? "warning" : "muted"
                                }
                              >
                                {item.policyStatus}
                              </Badge>
                            ) : (
                              <span className="text-muted">-</span>
                            )}
                          </td>
                          <td className="py-3 text-right">
                            {item.policyId && (
                              <Link href={`/policies/${item.policyId}`}>
                                <Button variant="ghost" size="sm">View</Button>
                              </Link>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          {/* Sync History */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Recent Sync Operations</CardTitle>
            </CardHeader>
            <CardContent>
              {template.syncOperations.length === 0 ? (
                <p className="text-center text-muted py-8">
                  No sync operations yet
                </p>
              ) : (
                <div className="space-y-3">
                  {template.syncOperations.map((op) => (
                    <div
                      key={op.id}
                      className="flex items-center justify-between border-b border-card-border pb-3 last:border-0"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={
                              op.status === "COMPLETED" ? "success" :
                              op.status === "COMPLETED_WITH_ERRORS" ? "warning" :
                              op.status === "FAILED" ? "danger" : "muted"
                            }
                          >
                            {op.status.replace(/_/g, " ")}
                          </Badge>
                          <span className="text-sm text-muted">
                            v{op.templateVersion}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted">
                          {op.policiesCreated} created, {op.policiesUpdated} updated, {op.policiesFailed} failed
                        </p>
                      </div>
                      <div className="text-right text-xs text-muted">
                        <p>{op.triggeredBy.name ?? op.triggeredBy.email}</p>
                        <p>{new Date(op.createdAt).toLocaleString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Template Content */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle>Template Content</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-96 overflow-auto rounded-md bg-background p-3 text-xs text-foreground">
                {template.content}
              </pre>
            </CardContent>
          </Card>

          {/* Version History */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Version History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {template.versions.map((version) => (
                  <div
                    key={version.id}
                    className="flex items-center justify-between border-b border-card-border pb-2 last:border-0"
                  >
                    <div>
                      <span className="font-medium text-foreground">v{version.version}</span>
                      {version.version === template.currentVersion && (
                        <Badge variant="accent" className="ml-2">Current</Badge>
                      )}
                      <p className="text-xs text-muted">{version.changelog}</p>
                    </div>
                    <span className="text-xs text-muted">
                      {new Date(version.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Sync Modal */}
      <Modal
        isOpen={isSyncModalOpen}
        onClose={() => setIsSyncModalOpen(false)}
        title="Sync Template to Clusters"
        description={`Select clusters to sync "${template.name}" v${template.currentVersion}`}
      >
        <div className="space-y-4">
          {/* Quick select buttons */}
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={selectAllClusters}>
              Select All
            </Button>
            {outOfDateCount > 0 && (
              <Button variant="secondary" size="sm" onClick={selectOutOfDateClusters}>
                Select Out of Date ({outOfDateCount})
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => setSelectedClusters([])}>
              Clear
            </Button>
          </div>

          {/* Cluster list */}
          <div className="max-h-64 overflow-auto space-y-2">
            {template.syncStatus.map((item) => {
              const status = syncStatusConfig[item.status as SyncStatus];
              const isSelected = selectedClusters.includes(item.cluster.id);

              return (
                <label
                  key={item.cluster.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    isSelected
                      ? "border-primary bg-primary/10"
                      : "border-card-border hover:border-primary/50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleCluster(item.cluster.id)}
                    className="rounded border-card-border"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{item.cluster.name}</span>
                      <Badge variant={status.variant} className="text-xs">{status.label}</Badge>
                    </div>
                    <span className="text-xs text-muted">{item.cluster.environment}</span>
                  </div>
                  {item.syncedVersion && (
                    <span className="text-xs text-muted">
                      v{item.syncedVersion}
                    </span>
                  )}
                </label>
              );
            })}
          </div>

          {/* Deploy option */}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={deployAfterSync}
              onChange={(e) => setDeployAfterSync(e.target.checked)}
              className="rounded border-card-border"
            />
            <span className="text-sm text-foreground">Deploy policies after sync</span>
          </label>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-card-border">
            <Button variant="secondary" onClick={() => setIsSyncModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSync}
              disabled={selectedClusters.length === 0 || syncMutation.isPending}
            >
              {syncMutation.isPending ? "Syncing..." : `Sync to ${selectedClusters.length} Cluster${selectedClusters.length !== 1 ? "s" : ""}`}
            </Button>
          </div>

          {syncMutation.error && (
            <p className="text-sm text-danger mt-2">
              {syncMutation.error.message}
            </p>
          )}
        </div>
      </Modal>
    </AppShell>
  );
}
