"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "~/components/layout/app-shell";
import { Card, CardContent } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";
import Modal from "~/components/ui/modal";
import { trpc } from "~/lib/trpc";

type SimulationStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

const statusConfig: Record<SimulationStatus, { variant: "muted" | "accent" | "success" | "danger"; label: string }> = {
  PENDING: { variant: "muted", label: "Pending" },
  RUNNING: { variant: "accent", label: "Running" },
  COMPLETED: { variant: "success", label: "Completed" },
  FAILED: { variant: "danger", label: "Failed" },
  CANCELLED: { variant: "muted", label: "Cancelled" },
};

function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toString();
}

export default function SimulationPage() {
  const router = useRouter();
  const [isNewSimModalOpen, setIsNewSimModalOpen] = useState(false);
  const [selectedPolicyId, setSelectedPolicyId] = useState("");
  const [selectedClusterId, setSelectedClusterId] = useState("");
  const [simulationDays, setSimulationDays] = useState(7);

  // Fetch simulations
  const { data: simulations, isLoading } = trpc.simulation.list.useQuery(
    undefined,
    { refetchInterval: 5000 } // Poll every 5 seconds for running simulations
  );

  // Fetch policies for the dropdown
  const { data: policiesData } = trpc.policy.list.useQuery({ limit: 100 });

  // Fetch clusters for the dropdown
  const { data: clustersData } = trpc.cluster.list.useQuery();

  // Create simulation mutation
  const createSimulation = trpc.simulation.create.useMutation({
    onSuccess: () => {
      setIsNewSimModalOpen(false);
      setSelectedPolicyId("");
      setSelectedClusterId("");
    },
  });

  const handleNewSimulation = () => {
    if (!selectedPolicyId || !selectedClusterId) return;
    createSimulation.mutate({
      policyId: selectedPolicyId,
      clusterId: selectedClusterId,
      daysToAnalyze: simulationDays,
    });
  };

  const policies = policiesData?.policies ?? [];
  const clusters = clustersData ?? [];
  const simulationList = simulations?.simulations ?? [];

  // Calculate stats
  const totalSimulations = simulationList.length;
  const runningCount = simulationList.filter(s => s.status === "RUNNING").length;
  const totalFlows = simulationList.reduce((sum, s) => sum + (s.flowsAnalyzed ?? 0), 0);
  const totalImpacts = simulationList.reduce((sum, s) => {
    const wouldDeny = s.flowsDenied ?? 0;
    return sum + wouldDeny;
  }, 0);

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
        <Button onClick={() => setIsNewSimModalOpen(true)}>
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
          <p className="text-2xl font-bold text-foreground">{totalSimulations}</p>
          <p className="text-sm text-muted">Total Simulations</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-accent-light">{runningCount}</p>
          <p className="text-sm text-muted">Running</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-primary">{formatNumber(totalFlows)}</p>
          <p className="text-sm text-muted">Flows Analyzed</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-warning">{formatNumber(totalImpacts)}</p>
          <p className="text-sm text-muted">Impacts Found</p>
        </Card>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}

      {/* Empty State */}
      {!isLoading && simulationList.length === 0 && (
        <Card className="py-12 text-center">
          <svg className="mx-auto h-12 w-12 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 className="mt-4 text-lg font-semibold text-foreground">No simulations yet</h3>
          <p className="mt-2 text-sm text-muted">
            Create a simulation to test your policies against historical traffic.
          </p>
          <Button className="mt-4" onClick={() => setIsNewSimModalOpen(true)}>
            Create Your First Simulation
          </Button>
        </Card>
      )}

      {/* Simulations List */}
      {!isLoading && simulationList.length > 0 && (
        <div className="space-y-4">
          {simulationList.map((sim) => {
            const status = statusConfig[sim.status as SimulationStatus] ?? statusConfig.PENDING;
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
                    <p className="mt-1 text-sm text-muted">{sim.description ?? "No description"}</p>

                    <div className="mt-4 flex items-center gap-6 text-sm">
                      <div>
                        <span className="text-muted">Policy:</span>{" "}
                        <span className="text-foreground">{sim.policy?.name ?? "Unknown"}</span>
                      </div>
                      <div>
                        <span className="text-muted">Cluster:</span>{" "}
                        <span className="text-foreground">{sim.cluster?.name ?? "Unknown"}</span>
                      </div>
                      <div>
                        <span className="text-muted">Time Range:</span>{" "}
                        <span className="text-foreground">
                          {new Date(sim.startTime).toLocaleDateString()} - {new Date(sim.endTime).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Results */}
                  <div className="ml-8 grid grid-cols-4 gap-6 text-center">
                    <div>
                      <p className="text-lg font-semibold text-foreground">
                        {formatNumber(sim.flowsAnalyzed ?? 0)}
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
                      <span className="text-foreground">In progress</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-card-hover">
                      <div className="h-full w-[50%] animate-pulse rounded-full bg-accent" />
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="mt-4 flex items-center justify-between border-t border-card-border pt-4">
                  <p className="text-xs text-muted">
                    {sim.completedAt
                      ? `Completed ${new Date(sim.completedAt).toLocaleString()}`
                      : `Started ${new Date(sim.createdAt).toLocaleDateString()}`}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => router.push(`/simulation/${sim.id}`)}
                    >
                      View Details
                    </Button>
                    {sim.status === "COMPLETED" && sim.policyId && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => router.push(`/policies/${sim.policyId}`)}
                      >
                        View Policy
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* New Simulation Modal */}
      <Modal
        isOpen={isNewSimModalOpen}
        onClose={() => setIsNewSimModalOpen(false)}
        title="New Simulation"
        description="Test a policy against historical network traffic"
        size="lg"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Select Policy
            </label>
            <select
              value={selectedPolicyId}
              onChange={(e) => setSelectedPolicyId(e.target.value)}
              className="w-full rounded-md border border-card-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">Choose a policy...</option>
              {policies.map((policy) => (
                <option key={policy.id} value={policy.id}>
                  {policy.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Select Cluster
            </label>
            <select
              value={selectedClusterId}
              onChange={(e) => setSelectedClusterId(e.target.value)}
              className="w-full rounded-md border border-card-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">Choose a cluster...</option>
              {clusters.map((cluster) => (
                <option key={cluster.id} value={cluster.id}>
                  {cluster.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Days of traffic to analyze
            </label>
            <select
              value={simulationDays}
              onChange={(e) => setSimulationDays(Number(e.target.value))}
              className="w-full rounded-md border border-card-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value={1}>Last 24 hours</option>
              <option value={3}>Last 3 days</option>
              <option value={7}>Last 7 days</option>
            </select>
          </div>

          <div className="rounded-md bg-accent/10 p-3">
            <p className="text-sm text-muted">
              The simulation will replay historical network flows against the selected policy
              to show what would be allowed or denied if deployed.
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button
              variant="ghost"
              onClick={() => setIsNewSimModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleNewSimulation}
              disabled={!selectedPolicyId || !selectedClusterId || createSimulation.isPending}
              isLoading={createSimulation.isPending}
            >
              Start Simulation
            </Button>
          </div>
          {createSimulation.error && (
            <p className="mt-2 text-sm text-danger">
              {createSimulation.error.message}
            </p>
          )}
        </div>
      </Modal>
    </AppShell>
  );
}
