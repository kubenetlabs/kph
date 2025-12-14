import AppShell from "~/components/layout/app-shell";
import MetricCard from "~/components/dashboard/metric-card";
import ClusterCard from "~/components/dashboard/cluster-card";
import { Card, CardHeader, CardTitle, CardContent } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";

// Mock data - replace with real data from database
const mockClusters = [
  {
    id: "1",
    name: "prod-us-east",
    provider: "AWS" as const,
    region: "us-east-1",
    status: "CONNECTED" as const,
    nodeCount: 12,
    policyCount: 24,
    lastHeartbeat: new Date(),
  },
  {
    id: "2",
    name: "staging-us-west",
    provider: "AWS" as const,
    region: "us-west-2",
    status: "CONNECTED" as const,
    nodeCount: 4,
    policyCount: 18,
    lastHeartbeat: new Date(),
  },
  {
    id: "3",
    name: "dev-azure",
    provider: "AZURE" as const,
    region: "eastus2",
    status: "PENDING" as const,
    nodeCount: 3,
    policyCount: 5,
    lastHeartbeat: null,
  },
];

const mockRecentPolicies = [
  { id: "1", name: "frontend-ingress", type: "GATEWAY_HTTPROUTE", status: "DEPLOYED", cluster: "prod-us-east" },
  { id: "2", name: "api-network-policy", type: "CILIUM_NETWORK", status: "SIMULATING", cluster: "prod-us-east" },
  { id: "3", name: "runtime-exec-audit", type: "TETRAGON", status: "DRAFT", cluster: "staging-us-west" },
];

export default function DashboardPage() {
  return (
    <AppShell>
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="mt-1 text-muted">
          Overview of your Kubernetes policy infrastructure
        </p>
      </div>

      {/* Metrics Grid */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Active Clusters"
          value={3}
          detail="2 connected, 1 pending"
          icon={
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          }
        />
        <MetricCard
          label="Total Policies"
          value={47}
          detail="32 deployed, 15 draft"
          trend={{ value: 12, isPositive: true }}
          icon={
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          }
        />
        <MetricCard
          label="Simulations Run"
          value={128}
          detail="This month"
          trend={{ value: 8, isPositive: true }}
          icon={
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <MetricCard
          label="Flows Analyzed"
          value="2.4M"
          detail="Last 30 days"
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
            <Button variant="ghost" size="sm">
              View all →
            </Button>
          </div>
          <div className="space-y-4">
            {mockClusters.map((cluster) => (
              <ClusterCard
                key={cluster.id}
                name={cluster.name}
                provider={cluster.provider}
                region={cluster.region}
                status={cluster.status}
                nodeCount={cluster.nodeCount}
                policyCount={cluster.policyCount}
                lastHeartbeat={cluster.lastHeartbeat}
              />
            ))}
          </div>
        </div>

        {/* Recent Policies */}
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Recent Policies</h2>
            <Button variant="ghost" size="sm">
              View all →
            </Button>
          </div>
          <Card>
            <CardContent>
              <div className="divide-y divide-card-border">
                {mockRecentPolicies.map((policy) => (
                  <div key={policy.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
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
                        <span className="text-xs text-muted">{policy.cluster}</span>
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
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <div className="mt-6">
            <h3 className="mb-3 text-sm font-medium text-muted">Quick Actions</h3>
            <div className="grid grid-cols-2 gap-3">
              <Button variant="secondary" className="justify-start">
                <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Cluster
              </Button>
              <Button variant="secondary" className="justify-start">
                <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Policy
              </Button>
              <Button variant="secondary" className="justify-start">
                <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Run Simulation
              </Button>
              <Button variant="secondary" className="justify-start">
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
