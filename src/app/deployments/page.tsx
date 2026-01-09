"use client";

import { useState } from "react";
import AppShell from "~/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import Badge from "~/components/ui/badge";
import Button from "~/components/ui/button";
import { trpc } from "~/lib/trpc";

type DeploymentStatus = "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "ROLLED_BACK";

const statusConfig: Record<
  DeploymentStatus,
  { variant: "muted" | "accent" | "warning" | "success" | "danger"; label: string }
> = {
  PENDING: { variant: "warning", label: "Pending" },
  IN_PROGRESS: { variant: "accent", label: "In Progress" },
  SUCCEEDED: { variant: "success", label: "Succeeded" },
  FAILED: { variant: "danger", label: "Failed" },
  ROLLED_BACK: { variant: "muted", label: "Rolled Back" },
};

const policyTypeConfig: Record<string, { color: string; label: string }> = {
  CILIUM_NETWORK: { color: "bg-cilium", label: "Cilium" },
  CILIUM_CLUSTERWIDE: { color: "bg-cilium", label: "Cilium CW" },
  TETRAGON: { color: "bg-tetragon", label: "Tetragon" },
  GATEWAY_HTTPROUTE: { color: "bg-gateway", label: "HTTP Route" },
  GATEWAY_GRPCROUTE: { color: "bg-gateway", label: "gRPC Route" },
  GATEWAY_TCPROUTE: { color: "bg-gateway", label: "TCP Route" },
};

function formatTimeAgo(date: Date | string): string {
  const now = new Date();
  const then = new Date(date);
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function DeploymentsPage() {
  const [filterStatus, setFilterStatus] = useState<DeploymentStatus | "">("");
  const [selectedClusterId, setSelectedClusterId] = useState<string>("");

  // Fetch clusters for filter
  const { data: clusters } = trpc.cluster.list.useQuery();

  // Fetch deployment stats
  const { data: stats, isLoading: statsLoading } = trpc.deployment.getStats.useQuery(undefined, {
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  // Fetch deployments
  const {
    data: deploymentsData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = trpc.deployment.listAll.useInfiniteQuery(
    {
      ...(filterStatus && { status: filterStatus }),
      ...(selectedClusterId && { clusterId: selectedClusterId }),
      limit: 20,
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      refetchInterval: 5000, // Refresh every 5 seconds
    }
  );

  const deployments = deploymentsData?.pages.flatMap((page) => page.deployments) ?? [];

  return (
    <AppShell>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Deployments</h1>
        <p className="mt-1 text-muted">
          Track and monitor policy deployments across all clusters
        </p>
      </div>

      {/* Stats Cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
        <Card className="text-center">
          <CardContent className="py-4">
            <p className="text-2xl font-bold text-foreground">{stats?.total ?? 0}</p>
            <p className="text-xs text-muted">Total</p>
          </CardContent>
        </Card>
        <Card className="text-center">
          <CardContent className="py-4">
            <p className="text-2xl font-bold text-success">{stats?.succeeded ?? 0}</p>
            <p className="text-xs text-muted">Succeeded</p>
          </CardContent>
        </Card>
        <Card className="text-center">
          <CardContent className="py-4">
            <p className="text-2xl font-bold text-danger">{stats?.failed ?? 0}</p>
            <p className="text-xs text-muted">Failed</p>
          </CardContent>
        </Card>
        <Card className="text-center">
          <CardContent className="py-4">
            <p className="text-2xl font-bold text-warning">{stats?.pending ?? 0}</p>
            <p className="text-xs text-muted">Pending</p>
          </CardContent>
        </Card>
        <Card className="text-center">
          <CardContent className="py-4">
            <p className="text-2xl font-bold text-accent">{stats?.inProgress ?? 0}</p>
            <p className="text-xs text-muted">In Progress</p>
          </CardContent>
        </Card>
        <Card className="text-center">
          <CardContent className="py-4">
            <p className="text-2xl font-bold text-foreground">{stats?.recentActivity ?? 0}</p>
            <p className="text-xs text-muted">Last 24h</p>
          </CardContent>
        </Card>
        <Card className="text-center">
          <CardContent className="py-4">
            <p className="text-2xl font-bold text-foreground">{stats?.successRate ?? 0}%</p>
            <p className="text-xs text-muted">Success Rate</p>
          </CardContent>
        </Card>
      </div>

      {/* Active Deployments Alert */}
      {stats && stats.activeDeployments.length > 0 && (
        <Card className="mb-6 border-accent/30 bg-accent/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
              Active Deployments
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {stats.activeDeployments.map((deployment) => (
                <div
                  key={deployment.id}
                  className="flex items-center justify-between rounded-md bg-background/50 px-3 py-2"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                    <span className="font-medium text-foreground">{deployment.policy.name}</span>
                    <span className="text-sm text-muted">{deployment.cluster.name}</span>
                  </div>
                  <Badge variant={deployment.status === "PENDING" ? "warning" : "accent"}>
                    {deployment.status === "PENDING" ? "Queued" : "Deploying"}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="mb-6 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">Filter:</span>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as DeploymentStatus | "")}
            className="rounded-md border border-card-border bg-card px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">All Statuses</option>
            {Object.entries(statusConfig).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={selectedClusterId}
            onChange={(e) => setSelectedClusterId(e.target.value)}
            className="rounded-md border border-card-border bg-card px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">All Clusters</option>
            {clusters?.map((cluster) => (
              <option key={cluster.id} value={cluster.id}>
                {cluster.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}

      {/* Empty State */}
      {!isLoading && deployments.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <svg
              className="mx-auto h-12 w-12 text-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <h3 className="mt-4 text-lg font-semibold text-foreground">No deployments found</h3>
            <p className="mt-2 text-sm text-muted">
              {filterStatus || selectedClusterId
                ? "Try adjusting your filters"
                : "Deploy your first policy to see deployment history here"}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Deployments Table */}
      {!isLoading && deployments.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <table className="w-full">
              <thead className="border-b border-card-border bg-card-hover/30">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted">
                    Policy
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted">
                    Version
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted">
                    Cluster
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted">
                    Deployed By
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted">
                    Time
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase text-muted">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {deployments.map((deployment) => {
                  const status = statusConfig[deployment.status as DeploymentStatus];
                  const policyType = policyTypeConfig[deployment.policy.type] ?? {
                    color: "bg-muted",
                    label: deployment.policy.type,
                  };

                  return (
                    <tr key={deployment.id} className="hover:bg-card-hover/50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className={`h-2 w-2 rounded-full ${policyType.color}`} />
                          <a
                            href={`/policies/${deployment.policy.id}`}
                            className="font-medium text-foreground hover:text-primary"
                          >
                            {deployment.policy.name}
                          </a>
                        </div>
                        <span className="text-xs text-muted">{policyType.label}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-foreground">v{deployment.version.version}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-foreground">{deployment.cluster.name}</span>
                        <span className="ml-1 text-xs text-muted">({deployment.cluster.provider})</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {(deployment.status === "PENDING" || deployment.status === "IN_PROGRESS") && (
                            <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                          )}
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-foreground">
                          {deployment.deployedBy.name ?? deployment.deployedBy.email}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-muted">
                          {formatTimeAgo(deployment.requestedAt)}
                        </span>
                        {deployment.completedAt && (
                          <span className="block text-xs text-muted">
                            Completed {formatTimeAgo(deployment.completedAt)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <a href={`/policies/${deployment.policy.id}`}>
                          <Button variant="ghost" size="sm">
                            View
                          </Button>
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Load More */}
      {hasNextPage && (
        <div className="mt-6 flex justify-center">
          <Button
            variant="secondary"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? "Loading..." : "Load More"}
          </Button>
        </div>
      )}
    </AppShell>
  );
}
