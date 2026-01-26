"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AppShell from "~/components/layout/app-shell";
import MetricCard from "~/components/dashboard/metric-card";
import ClusterCard from "~/components/dashboard/cluster-card";
import { Card, CardContent } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";
import { trpc } from "~/lib/trpc";
import { useTour, dashboardTourSteps, TOUR_IDS } from "~/components/guided-tour";

export default function DashboardPage() {
  const router = useRouter();
  const { startTour, hasCompletedTour, markTourComplete, isActive } = useTour();

  // Fetch real data from tRPC
  const { data: clusters } = trpc.cluster.list.useQuery();
  const { data: policyStats } = trpc.policy.getStats.useQuery();
  const { data: simStats } = trpc.simulation.getStats.useQuery();
  const { data: recentPolicies } = trpc.policy.list.useQuery({ limit: 3 });

  const clusterList = clusters ?? [];
  const policies = recentPolicies?.policies ?? [];

  // Calculate cluster stats
  const connectedCount = clusterList.filter(c => c.status === "CONNECTED").length;
  const pendingCount = clusterList.filter(c => c.status === "PENDING").length;

  // Auto-start tour for new users
  useEffect(() => {
    const tourId = TOUR_IDS.DASHBOARD;
    if (!hasCompletedTour(tourId) && !isActive) {
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => {
        startTour(dashboardTourSteps);
        markTourComplete(tourId);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [hasCompletedTour, isActive, startTour, markTourComplete]);

  const handleStartTour = () => {
    startTour(dashboardTourSteps);
  };

  return (
    <AppShell>
      {/* Page Header */}
      <div className="mb-8 flex items-start justify-between" data-tour="dashboard-header">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="mt-1 text-muted">
            Overview of your Kubernetes policy infrastructure
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={handleStartTour}>
          <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Take a Tour
        </Button>
      </div>

      {/* Metrics Grid */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Active Clusters"
          value={clusterList.length}
          detail={`${connectedCount} connected, ${pendingCount} pending`}
          icon={
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          }
        />
        <MetricCard
          label="Total Policies"
          value={policyStats?.total ?? 0}
          detail={`${policyStats?.deployed ?? 0} deployed, ${policyStats?.drafts ?? 0} draft`}
          icon={
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          }
        />
        <MetricCard
          label="Simulations Run"
          value={simStats?.total ?? 0}
          detail={`${simStats?.running ?? 0} running`}
          icon={
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <MetricCard
          label="Simulation Flows Analyzed"
          value={formatNumber(simStats?.flowsAnalyzed ?? 0)}
          detail="Total analyzed"
          icon={
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          }
        />
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Clusters */}
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Clusters</h2>
            <Button variant="ghost" size="sm" onClick={() => router.push("/clusters")}>
              View all →
            </Button>
          </div>
          <div className="space-y-4">
            {clusterList.length === 0 ? (
              <Card className="py-8 text-center">
                <p className="text-muted">No clusters yet. Add your first cluster to get started.</p>
              </Card>
            ) : (
              clusterList.slice(0, 3).map((cluster) => (
                <ClusterCard
                  key={cluster.id}
                  name={cluster.name}
                  provider={cluster.provider}
                  region={cluster.region}
                  status={cluster.status}
                  nodeCount={cluster.nodeCount ?? 0}
                  policyCount={cluster._count?.policies ?? 0}
                  lastHeartbeat={cluster.lastHeartbeat}
                />
              ))
            )}
          </div>
        </div>

        {/* Recent Policies */}
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Recent Policies</h2>
            <Button variant="ghost" size="sm" onClick={() => router.push("/policies")}>
              View all →
            </Button>
          </div>
          <Card>
            <CardContent>
              {policies.length === 0 ? (
                <div className="py-4 text-center">
                  <p className="text-muted">No policies yet.</p>
                </div>
              ) : (
                <div className="divide-y divide-card-border">
                  {policies.map((policy) => (
                    <div
                      key={policy.id}
                      className="flex cursor-pointer items-center justify-between py-3 first:pt-0 last:pb-0 hover:bg-card-hover"
                      onClick={() => router.push(`/policies/${policy.id}`)}
                    >
                      <div>
                        <p className="font-medium text-foreground">{policy.name}</p>
                        <div className="mt-1 flex items-center gap-2">
                          <Badge
                            variant={
                              policy.type.startsWith("CILIUM")
                                ? "cilium"
                                : policy.type === "TETRAGON"
                                ? "tetragon"
                                : "gateway"
                            }
                          >
                            {policy.type.replace("_", " ")}
                          </Badge>
                          <span className="text-xs text-muted">{policy.cluster?.name}</span>
                        </div>
                      </div>
                      <Badge
                        variant={
                          policy.status === "DEPLOYED"
                            ? "success"
                            : policy.status === "SIMULATING"
                            ? "accent"
                            : "muted"
                        }
                      >
                        {policy.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <div className="mt-6">
            <h3 className="mb-3 text-sm font-medium text-muted">Quick Actions</h3>
            <div className="grid grid-cols-2 gap-3">
              <Button variant="secondary" className="justify-start" onClick={() => router.push("/clusters/new")}>
                <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Cluster
              </Button>
              <Button variant="secondary" className="justify-start" onClick={() => router.push("/policies/new")}>
                <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Policy
              </Button>
              <Button variant="secondary" className="justify-start" onClick={() => router.push("/simulation")}>
                <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Run Simulation
              </Button>
              <Button variant="secondary" className="justify-start" onClick={() => router.push("/policies/generate")}>
                <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                Generate Policy
              </Button>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toString();
}
