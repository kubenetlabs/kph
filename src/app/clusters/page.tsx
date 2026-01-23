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
import { Spinner } from "~/components/ui/spinner";
import { QueryErrorState } from "~/components/ui/error-state";
import { SortableHeader, useSortState, sortData } from "~/components/ui/sortable-header";
import { ExportButton } from "~/components/ui/export-button";
import { clusterExportColumns } from "~/lib/csv-export";
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

type Provider = "AWS" | "GCP" | "AZURE" | "ON_PREM" | "OTHER";
type Environment = "PRODUCTION" | "STAGING" | "DEVELOPMENT" | "TESTING";
type Status = "CONNECTED" | "PENDING" | "DEGRADED" | "DISCONNECTED" | "ERROR";

export default function ClustersPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>("clusters");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Filter state
  const [filterProvider, setFilterProvider] = useState<Provider | "">("");
  const [filterEnvironment, setFilterEnvironment] = useState<Environment | "">("");
  const [filterStatus, setFilterStatus] = useState<Status | "">("");
  const [searchQuery, setSearchQuery] = useState("");

  // Sort state for clusters table
  type ClusterSortColumn = "name" | "provider" | "environment" | "status" | "nodes";
  const { sortState, handleSort } = useSortState<ClusterSortColumn>("name");

  // Fetch clusters from database
  const { data: clusters = [], isLoading, isError, error, refetch } = trpc.cluster.list.useQuery();

  // Filter and sort clusters
  const filteredClusters = (() => {
    const result = clusters.filter((cluster) => {
      if (filterProvider && cluster.provider !== filterProvider) return false;
      if (filterEnvironment && cluster.environment !== filterEnvironment) return false;
      if (filterStatus && cluster.status !== filterStatus) return false;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesName = cluster.name.toLowerCase().includes(query);
        const matchesDescription = cluster.description?.toLowerCase().includes(query);
        const matchesRegion = cluster.region.toLowerCase().includes(query);
        if (!matchesName && !matchesDescription && !matchesRegion) return false;
      }
      return true;
    });

    // Apply sorting
    return sortData(result, sortState, {
      name: (c) => c.name,
      provider: (c) => c.provider,
      environment: (c) => c.environment,
      status: (c) => c.status,
      nodes: (c) => c.nodeCount,
    });
  })();

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
            <ExportButton
              data={filteredClusters.map((c) => ({
                ...c,
                lastHeartbeat: c.lastHeartbeat?.toISOString() ?? "",
                createdAt: c.createdAt?.toISOString() ?? "",
              }))}
              columns={clusterExportColumns}
              filename="clusters"
              disabled={filteredClusters.length === 0}
            />
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
              <span className="text-sm text-muted">Filter:</span>
              <select
                value={filterProvider}
                onChange={(e) => setFilterProvider(e.target.value as Provider | "")}
                className="rounded-md border border-card-border bg-card px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="" className="bg-card text-foreground">All Providers</option>
                <option value="AWS" className="bg-card text-foreground">AWS</option>
                <option value="GCP" className="bg-card text-foreground">GCP</option>
                <option value="AZURE" className="bg-card text-foreground">Azure</option>
                <option value="ON_PREM" className="bg-card text-foreground">On-Prem</option>
                <option value="OTHER" className="bg-card text-foreground">Other</option>
              </select>
              <select
                value={filterEnvironment}
                onChange={(e) => setFilterEnvironment(e.target.value as Environment | "")}
                className="rounded-md border border-card-border bg-card px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="" className="bg-card text-foreground">All Environments</option>
                <option value="PRODUCTION" className="bg-card text-foreground">Production</option>
                <option value="STAGING" className="bg-card text-foreground">Staging</option>
                <option value="DEVELOPMENT" className="bg-card text-foreground">Development</option>
                <option value="TESTING" className="bg-card text-foreground">Testing</option>
              </select>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as Status | "")}
                className="rounded-md border border-card-border bg-card px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="" className="bg-card text-foreground">All Statuses</option>
                <option value="CONNECTED" className="bg-card text-foreground">Connected</option>
                <option value="PENDING" className="bg-card text-foreground">Pending</option>
                <option value="DEGRADED" className="bg-card text-foreground">Degraded</option>
                <option value="DISCONNECTED" className="bg-card text-foreground">Disconnected</option>
                <option value="ERROR" className="bg-card text-foreground">Error</option>
              </select>
            </div>
            <div className="flex-1" />
            <div className="relative">
              <input
                type="text"
                placeholder="Search clusters..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-64 rounded-md border border-card-border bg-card px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

      {/* Loading State */}
      {isLoading && (
        <Card className="flex flex-col items-center py-12">
          <Spinner size="lg" variant="accent" />
          <p className="mt-4 text-muted">Loading clusters...</p>
        </Card>
      )}

      {/* Error State */}
      {!isLoading && isError && (
        <Card>
          <QueryErrorState error={error} refetch={() => refetch()} />
        </Card>
      )}

      {/* Clusters Table */}
      {!isLoading && !isError && filteredClusters.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b border-card-border">
                  <th className="px-4 py-3 text-left">
                    <SortableHeader
                      column="name"
                      label="Cluster"
                      currentSort={sortState}
                      onSort={handleSort}
                    />
                  </th>
                  <th className="px-4 py-3 text-left">
                    <SortableHeader
                      column="provider"
                      label="Provider / Region"
                      currentSort={sortState}
                      onSort={handleSort}
                    />
                  </th>
                  <th className="px-4 py-3 text-left">
                    <SortableHeader
                      column="environment"
                      label="Environment"
                      currentSort={sortState}
                      onSort={handleSort}
                    />
                  </th>
                  <th className="px-4 py-3 text-left">
                    <SortableHeader
                      column="status"
                      label="Status"
                      currentSort={sortState}
                      onSort={handleSort}
                    />
                  </th>
                  <th className="px-4 py-3 text-left">
                    <SortableHeader
                      column="nodes"
                      label="Nodes"
                      currentSort={sortState}
                      onSort={handleSort}
                    />
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
                {filteredClusters.map((cluster) => {
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

          {/* Empty State - No clusters at all */}
          {!isLoading && !isError && clusters.length === 0 && (
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

          {/* Empty State - No matches for filters */}
          {!isLoading && clusters.length > 0 && filteredClusters.length === 0 && (
            <Card className="py-12 text-center">
              <div className="mx-auto h-12 w-12 rounded-full bg-card-hover p-3 text-muted">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <h3 className="mt-4 text-lg font-medium text-foreground">No clusters found</h3>
              <p className="mt-2 text-sm text-muted">
                Try adjusting your filters or search query.
              </p>
              <Button
                variant="secondary"
                className="mt-6"
                onClick={() => {
                  setFilterProvider("");
                  setFilterEnvironment("");
                  setFilterStatus("");
                  setSearchQuery("");
                }}
              >
                Clear Filters
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
