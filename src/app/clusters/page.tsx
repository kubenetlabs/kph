"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "~/components/layout/app-shell";
import { Card, CardContent } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";
import Modal from "~/components/ui/modal";
import CreateClusterForm from "~/components/clusters/create-cluster-form";
import RegistrationTokens from "~/components/clusters/registration-tokens";
import { trpc } from "~/lib/trpc";

type TabType = "clusters" | "tokens";

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


interface ClusterFormData {
  name: string;
  description?: string;
  provider: "AWS" | "GCP" | "AZURE" | "ON_PREM" | "OTHER";
  region: string;
  environment: "PRODUCTION" | "STAGING" | "DEVELOPMENT" | "TESTING";
  endpoint: string;
  authToken: string;
  caCert?: string;
}

export default function ClustersPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>("clusters");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Fetch clusters from database
  const { data: clusters = [], isLoading, refetch } = trpc.cluster.list.useQuery();

  // Create cluster mutation
  const createClusterMutation = trpc.cluster.create.useMutation({
    onSuccess: async () => {
      await refetch();
      setIsModalOpen(false);
      setCreateError(null);
    },
    onError: (error) => {
      setCreateError(error.message);
    },
  });

  const handleViewCluster = (clusterId: string) => {
    router.push(`/clusters/${clusterId}`);
  };

  const handleEditCluster = (clusterId: string) => {
    router.push(`/clusters/${clusterId}?edit=true`);
  };

  const handleCreateCluster = async (data: ClusterFormData) => {
    setCreateError(null);
    createClusterMutation.mutate(data);
  };

  return (
    <AppShell>
      {/* Page Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Clusters</h1>
          <p className="mt-1 text-muted">
            Manage your Kubernetes clusters and their Policy Hub operators
          </p>
        </div>
        {activeTab === "clusters" && (
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => router.push("/clusters/install")}>
              <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Install Agent
            </Button>
            <Button onClick={() => setIsModalOpen(true)}>
              <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Cluster
            </Button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="mb-6 border-b border-border">
        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => setActiveTab("clusters")}
            className={`pb-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === "clusters"
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            Connected Clusters
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("tokens")}
            className={`pb-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === "tokens"
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            Registration Tokens
          </button>
        </div>
      </div>

      {/* Registration Tokens Tab */}
      {activeTab === "tokens" && <RegistrationTokens />}

      {/* Clusters Tab */}
      {activeTab === "clusters" && (
        <>
          {/* Filters */}
          <div className="mb-6 flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted">Filter by:</span>
              <Button variant="ghost" size="sm">
                All Providers
              </Button>
              <Button variant="ghost" size="sm">
                All Environments
              </Button>
              <Button variant="ghost" size="sm">
                All Statuses
              </Button>
            </div>
          </div>

      {/* Loading State */}
      {isLoading && (
        <Card className="py-12 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-accent border-t-transparent"></div>
          <p className="mt-4 text-muted">Loading clusters...</p>
        </Card>
      )}

      {/* Clusters Table */}
      {!isLoading && clusters.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b border-card-border">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                    Cluster
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                    Provider / Region
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                    Environment
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                    Nodes
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                    Operator
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {clusters.map((cluster) => {
                  const status = statusConfig[cluster.status as keyof typeof statusConfig];
                  const env = environmentConfig[cluster.environment as keyof typeof environmentConfig];
                  
                  return (
                    <tr key={cluster.id} className="hover:bg-card-hover transition-colors">
                      <td className="px-4 py-4">
                        <div>
                          <p className="font-medium text-foreground">{cluster.name}</p>
                          {cluster.description && (
                            <p className="text-sm text-muted">{cluster.description}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{cluster.provider}</span>
                          <span className="text-muted">•</span>
                          <span className="text-sm text-muted">{cluster.region}</span>
                        </div>
                        {cluster.kubernetesVersion && (
                          <p className="text-xs text-muted">K8s {cluster.kubernetesVersion}</p>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <Badge variant={env.variant}>{env.label}</Badge>
                      </td>
                      <td className="px-4 py-4">
                        <Badge variant={status.variant}>{status.label}</Badge>
                        {cluster.lastHeartbeat && (
                          <p className="mt-1 text-xs text-muted">
                            {new Date(cluster.lastHeartbeat).toLocaleTimeString()}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        {cluster.nodeCount !== null ? (
                          <>
                            <span className="text-foreground">{cluster.nodeCount}</span>
                            <span className="text-muted"> / </span>
                            <span className="text-sm text-muted">{cluster.namespaceCount} ns</span>
                          </>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        {cluster.operatorInstalled ? (
                          <div>
                            <Badge variant="policyhub">Installed</Badge>
                            <p className="mt-1 text-xs text-muted">v{cluster.operatorVersion}</p>
                          </div>
                        ) : (
                          <Badge variant="muted">Not Installed</Badge>
                        )}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewCluster(cluster.id)}
                          >
                            View
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEditCluster(cluster.id)}
                          >
                            Edit
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

          {/* Empty State */}
          {!isLoading && clusters.length === 0 && (
            <Card className="py-12 text-center">
              <div className="mx-auto h-12 w-12 rounded-full bg-card-hover p-3 text-muted">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <h3 className="mt-4 text-lg font-medium text-foreground">No clusters yet</h3>
              <p className="mt-2 text-sm text-muted">
                Get started by connecting your first Kubernetes cluster.
              </p>
              <Button className="mt-6" onClick={() => setIsModalOpen(true)}>
                <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Your First Cluster
              </Button>
            </Card>
          )}
        </>
      )}

      {/* Create Cluster Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Add New Cluster"
        description="Connect a Kubernetes cluster to Policy Hub for network policy management."
        size="lg"
      >
        <CreateClusterForm
          onSubmit={handleCreateCluster}
          onCancel={() => setIsModalOpen(false)}
          isLoading={createClusterMutation.isPending}
        />
      </Modal>
    </AppShell>
  );
}
