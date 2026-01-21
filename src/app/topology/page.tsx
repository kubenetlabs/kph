"use client";

import { useState, useMemo } from "react";
import AppShell from "~/components/layout/app-shell";
import { TopologyMap, DetailPanel, ProcessEventsPanel } from "~/components/topology";
import { useTopologyStore } from "~/stores/topology-store";
import { trpc } from "~/lib/trpc";
import { Card, CardContent } from "~/components/ui/card";
import Badge from "~/components/ui/badge";

export default function TopologyPage() {
  const [selectedClusterId, setSelectedClusterId] = useState<string>("");
  const { mode, setMode, filters, setFilters } = useTopologyStore();

  // Fetch clusters
  const { data: clusters } = trpc.cluster.list.useQuery();
  const clusterList = clusters ?? [];

  // Auto-select first cluster
  if (!selectedClusterId && clusterList.length > 0 && clusterList[0]) {
    setSelectedClusterId(clusterList[0].id);
  }

  // Fetch topology data
  // OPTIMIZATION: Added staleTime to prevent unnecessary refetches
  const { data: topologyData, isLoading, isFetching } = trpc.topology.getGraph.useQuery(
    {
      clusterId: selectedClusterId,
      mode: mode === "simulation" ? "simulation" : "live",
      filters: {
        namespaces: filters.namespaces.length > 0 ? filters.namespaces : undefined,
        verdict: filters.verdict !== "all" ? filters.verdict : undefined,
        timeRange: filters.timeRange,
      },
    },
    {
      enabled: !!selectedClusterId,
      refetchInterval: mode === "live" ? 30000 : undefined,
      staleTime: 10000, // Consider data fresh for 10s - prevents refetch on filter changes
    }
  );


  // Fetch namespaces separately for complete coverage (24h window + policies)
  const { data: namespacesData, isLoading: namespacesLoading } = trpc.topology.getNamespaces.useQuery(
    { clusterId: selectedClusterId },
    { enabled: !!selectedClusterId, staleTime: 60000 } // Cache for 1 min
  );
  const namespaces = namespacesData ?? [];

  // Convert topology data to React Flow format
  const nodes = useMemo(() => {
    return topologyData?.nodes ?? [];
  }, [topologyData]);

  const edges = useMemo(() => {
    return topologyData?.edges ?? [];
  }, [topologyData]);

  return (
    <AppShell>
      <div className="flex flex-col" style={{ minHeight: 'calc(100vh - 120px)' }}>
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Topology & Telemetry</h1>
            <p className="mt-1 text-muted">
              Visualize network policies, traffic flows, and runtime security events
            </p>
          </div>

          <div className="flex items-center gap-4">
            {/* Mode selector */}
            <div className="flex rounded-lg border border-border overflow-hidden">
              <button
                onClick={() => setMode("live")}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  mode === "live"
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted hover:text-foreground"
                }`}
              >
                Live
              </button>
              <button
                onClick={() => setMode("simulation")}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  mode === "simulation"
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted hover:text-foreground"
                }`}
              >
                Simulation
              </button>
            </div>

            {/* Cluster selector */}
            <select
              value={selectedClusterId}
              onChange={(e) => setSelectedClusterId(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground min-w-[200px]"
            >
              {clusterList.length === 0 ? (
                <option value="">No clusters</option>
              ) : (
                clusterList.map((cluster) => (
                  <option key={cluster.id} value={cluster.id}>
                    {cluster.name}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        {/* Filters bar */}
        <div className="mb-4 flex items-center gap-4 p-3 bg-card rounded-lg border border-border">
          {/* Verdict filter */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">Verdict:</span>
            <select
              value={filters.verdict}
              onChange={(e) => setFilters({ verdict: e.target.value as typeof filters.verdict })}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
            >
              <option value="all">All</option>
              <option value="allowed">Allowed</option>
              <option value="denied">Denied</option>
              <option value="no-policy">No Policy</option>
            </select>
          </div>

          {/* Time range filter */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">Time:</span>
            <select
              value={filters.timeRange}
              onChange={(e) => setFilters({ timeRange: e.target.value as typeof filters.timeRange })}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
            >
              <option value="5m">5 min</option>
              <option value="15m">15 min</option>
              <option value="1h">1 hour</option>
              <option value="24h">24 hours</option>
            </select>
          </div>

          {/* Namespace filter */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">Namespace:</span>
            <select
              value={filters.namespaces[0] ?? ""}
              onChange={(e) =>
                setFilters({
                  namespaces: e.target.value ? [e.target.value] : [],
                })
              }
              className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
              disabled={namespacesLoading}
            >
              <option value="">{namespacesLoading ? "Loading..." : "All namespaces"}</option>
              {namespaces.map((ns) => (
                <option key={ns} value={ns}>
                  {ns}
                </option>
              ))}
            </select>
          </div>

          {/* Summary stats */}
          {topologyData && (
            <div className="ml-auto flex items-center gap-3 text-sm">
              <span className="text-muted">
                {topologyData.summary.totalNodes} nodes
              </span>
              <span className="text-muted">
                {topologyData.summary.totalEdges} flows
              </span>
              <span className="text-green-500">
                {topologyData.summary.allowedFlows} allowed
              </span>
              {topologyData.summary.deniedFlows > 0 && (
                <Badge variant="danger">
                  {topologyData.summary.deniedFlows} denied
                </Badge>
              )}
              {topologyData.summary.unprotectedFlows > 0 && (
                <Badge variant="warning">
                  {topologyData.summary.unprotectedFlows} gaps
                </Badge>
              )}
            </div>
          )}
        </div>

        {/* Map area */}
        <div className="h-[500px] relative rounded-lg border border-border overflow-hidden">
          {/* Only show blocking spinner on initial load (no data yet) */}
          {isLoading && !topologyData && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-20">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          )}
          {/* Subtle indicator during background refresh (has data, fetching new) */}
          {isFetching && topologyData && (
            <div className="absolute top-2 right-2 z-20 flex items-center gap-2 rounded bg-background/90 px-2 py-1 text-xs text-muted border border-border">
              <div className="h-3 w-3 animate-spin rounded-full border border-primary border-t-transparent" />
              Updating...
            </div>
          )}

          {!selectedClusterId && !isLoading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Card>
                <CardContent className="py-8 text-center">
                  <p className="text-muted">Select a cluster to view topology</p>
                </CardContent>
              </Card>
            </div>
          )}

          {selectedClusterId && !isLoading && nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Card>
                <CardContent className="py-8 text-center">
                  <p className="text-muted mb-4">No topology data available</p>
                  <p className="text-sm text-muted">
                    Deploy some policies to see the topology visualization
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          {selectedClusterId && nodes.length > 0 && (
            <TopologyMap initialNodes={nodes} initialEdges={edges} />
          )}

          {/* Detail panel */}
          <DetailPanel />
        </div>

        {/* Legend */}
        <div className="mt-4 flex items-center gap-6 text-sm text-muted">
          <div className="flex items-center gap-2">
            <div className="w-4 h-0.5 bg-green-500" />
            <span>Allowed</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-0.5 bg-red-500 border-dashed border-t-2 border-red-500" style={{ borderStyle: 'dashed' }} />
            <span>Denied</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-0.5 bg-amber-500" style={{ borderStyle: 'dotted' }} />
            <span>No Policy</span>
          </div>
        </div>

        {/* Runtime Security Events Panel */}
        {selectedClusterId && (
          <ProcessEventsPanel
            clusterId={selectedClusterId}
            timeRange={filters.timeRange}
          />
        )}
      </div>
    </AppShell>
  );
}
