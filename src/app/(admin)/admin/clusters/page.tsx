"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";
import { trpc } from "~/lib/trpc";

const statusConfig = {
  CONNECTED: { variant: "success" as const, label: "Connected" },
  PENDING: { variant: "warning" as const, label: "Pending" },
  DEGRADED: { variant: "warning" as const, label: "Degraded" },
  DISCONNECTED: { variant: "danger" as const, label: "Disconnected" },
  ERROR: { variant: "danger" as const, label: "Error" },
};

export default function AdminClustersPage() {
  const [selectedOrg, setSelectedOrg] = useState<string | undefined>();

  const { data: clustersData, isLoading } = trpc.admin.listClusters.useQuery({
    organizationId: selectedOrg,
    limit: 100,
  });

  const { data: orgsData } = trpc.admin.listOrganizations.useQuery({ limit: 100 });

  const clusters = clustersData?.clusters ?? [];
  const organizations = orgsData?.organizations ?? [];

  return (
    <div>
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Clusters</h1>
        <p className="mt-1 text-muted">
          View and manage all clusters across the platform
        </p>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-center gap-4">
            <select
              value={selectedOrg ?? ""}
              onChange={(e) => setSelectedOrg(e.target.value || undefined)}
              className="rounded-md border border-card-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="" className="bg-card text-foreground">All Organizations</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id} className="bg-card text-foreground">
                  {org.name}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Clusters Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            {clusters.length} Cluster{clusters.length !== 1 ? "s" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-12 text-center text-muted">Loading clusters...</div>
          ) : clusters.length === 0 ? (
            <div className="py-12 text-center text-muted">No clusters found</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-card-border">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                    Cluster
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                    Organization
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                    Provider / Region
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                    Last Heartbeat
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {clusters.map((cluster) => {
                  const status = statusConfig[cluster.status as keyof typeof statusConfig] ?? {
                    variant: "muted" as const,
                    label: cluster.status,
                  };

                  return (
                    <tr key={cluster.id} className="hover:bg-card-hover transition-colors">
                      <td className="px-4 py-4">
                        <div>
                          <p className="font-medium text-foreground">{cluster.name}</p>
                          <p className="text-xs text-muted font-mono">{cluster.id}</p>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <p className="text-sm text-foreground">{cluster.organization?.name ?? "—"}</p>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-foreground">{cluster.provider}</span>
                          <span className="text-muted">•</span>
                          <span className="text-sm text-muted">{cluster.region}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </td>
                      <td className="px-4 py-4 text-sm text-muted">
                        {cluster.lastHeartbeat
                          ? new Date(cluster.lastHeartbeat).toLocaleString()
                          : "Never"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
