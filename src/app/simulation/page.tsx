import AppShell from "~/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";

// Mock data
const simulations = [
  {
    id: "1",
    name: "API Network Policy Test",
    description: "Testing new network restrictions for API namespace",
    status: "COMPLETED",
    policy: "api-network-policy",
    cluster: "prod-us-east",
    startTime: new Date("2024-03-01"),
    endTime: new Date("2024-03-14"),
    flowsAnalyzed: 1247832,
    flowsAllowed: 1198654,
    flowsDenied: 49178,
    flowsChanged: 12453,
    completedAt: new Date("2024-03-14T16:30:00"),
  },
  {
    id: "2",
    name: "Database Isolation Verification",
    description: "Verify database pods are properly isolated",
    status: "RUNNING",
    policy: "database-isolation",
    cluster: "prod-us-east",
    startTime: new Date("2024-03-10"),
    endTime: new Date("2024-03-14"),
    flowsAnalyzed: 523000,
    flowsAllowed: null,
    flowsDenied: null,
    flowsChanged: null,
    completedAt: null,
  },
  {
    id: "3",
    name: "Frontend Routing Test",
    description: "Test new HTTPRoute configuration",
    status: "COMPLETED",
    policy: "frontend-ingress",
    cluster: "staging-us-west",
    startTime: new Date("2024-02-15"),
    endTime: new Date("2024-03-01"),
    flowsAnalyzed: 89432,
    flowsAllowed: 89432,
    flowsDenied: 0,
    flowsChanged: 0,
    completedAt: new Date("2024-03-01T09:15:00"),
  },
];

const statusConfig = {
  PENDING: { variant: "muted" as const, label: "Pending" },
  RUNNING: { variant: "accent" as const, label: "Running" },
  COMPLETED: { variant: "success" as const, label: "Completed" },
  FAILED: { variant: "danger" as const, label: "Failed" },
  CANCELLED: { variant: "muted" as const, label: "Cancelled" },
};

function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toString();
}

export default function SimulationPage() {
  return (
    <AppShell>
      {/* Page Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Time-Travel Simulation</h1>
          <p className="mt-1 text-muted">
            Replay historical traffic against policies before deployment
          </p>
        </div>
        <Button>
          <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          New Simulation
        </Button>
      </div>

      {/* How It Works */}
      <Card className="mb-8 border-accent/30 bg-accent/5">
        <CardContent className="py-4">
          <div className="flex items-start gap-4">
            <div className="rounded-lg bg-accent/20 p-2">
              <svg className="h-6 w-6 text-accent-light" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-foreground">How Time-Travel Simulation Works</h3>
              <p className="mt-1 text-sm text-muted">
                Policy Hub captures all network flows in your clusters using eBPF. When you create or modify a policy, 
                you can replay 30-90 days of historical traffic to see exactly which connections would be allowed or 
                denied—before deploying to production. No more policy surprises.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="mb-8 grid grid-cols-4 gap-4">
        <Card className="text-center">
          <p className="text-2xl font-bold text-foreground">{simulations.length}</p>
          <p className="text-sm text-muted">Total Simulations</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-accent-light">
            {simulations.filter(s => s.status === "RUNNING").length}
          </p>
          <p className="text-sm text-muted">Running</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-primary">
            {formatNumber(simulations.reduce((sum, s) => sum + s.flowsAnalyzed, 0))}
          </p>
          <p className="text-sm text-muted">Flows Analyzed</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-warning">
            {formatNumber(simulations.filter(s => s.flowsChanged).reduce((sum, s) => sum + (s.flowsChanged ?? 0), 0))}
          </p>
          <p className="text-sm text-muted">Impacts Found</p>
        </Card>
      </div>

      {/* Simulations List */}
      <div className="space-y-4">
        {simulations.map((sim) => {
          const status = statusConfig[sim.status as keyof typeof statusConfig];
          const isRunning = sim.status === "RUNNING";

          return (
            <Card key={sim.id} hover>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="font-semibold text-foreground">{sim.name}</h3>
                    <Badge variant={status.variant}>
                      {isRunning && (
                        <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-accent-light" />
                      )}
                      {status.label}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted">{sim.description}</p>

                  <div className="mt-4 flex items-center gap-6 text-sm">
                    <div>
                      <span className="text-muted">Policy:</span>{" "}
                      <span className="text-foreground">{sim.policy}</span>
                    </div>
                    <div>
                      <span className="text-muted">Cluster:</span>{" "}
                      <span className="text-foreground">{sim.cluster}</span>
                    </div>
                    <div>
                      <span className="text-muted">Time Range:</span>{" "}
                      <span className="text-foreground">
                        {sim.startTime.toLocaleDateString()} - {sim.endTime.toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Results */}
                <div className="ml-8 grid grid-cols-4 gap-6 text-center">
                  <div>
                    <p className="text-lg font-semibold text-foreground">
                      {formatNumber(sim.flowsAnalyzed)}
                    </p>
                    <p className="text-xs text-muted">Flows</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-success">
                      {sim.flowsAllowed !== null ? formatNumber(sim.flowsAllowed) : "—"}
                    </p>
                    <p className="text-xs text-muted">Allowed</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-danger">
                      {sim.flowsDenied !== null ? formatNumber(sim.flowsDenied) : "—"}
                    </p>
                    <p className="text-xs text-muted">Denied</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-warning">
                      {sim.flowsChanged !== null ? formatNumber(sim.flowsChanged) : "—"}
                    </p>
                    <p className="text-xs text-muted">Changed</p>
                  </div>
                </div>
              </div>

              {/* Progress bar for running simulations */}
              {isRunning && (
                <div className="mt-4 border-t border-card-border pt-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted">Processing flows...</span>
                    <span className="text-foreground">~42% complete</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-card-hover">
                    <div className="h-full w-[42%] rounded-full bg-accent" />
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="mt-4 flex items-center justify-between border-t border-card-border pt-4">
                <p className="text-xs text-muted">
                  {sim.completedAt
                    ? `Completed ${sim.completedAt.toLocaleString()}`
                    : `Started ${sim.startTime.toLocaleDateString()}`}
                </p>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm">
                    View Details
                  </Button>
                  {sim.status === "COMPLETED" && (
                    <Button variant="secondary" size="sm">
                      Deploy Policy
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}
