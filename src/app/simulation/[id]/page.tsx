"use client";

import { useParams, useRouter } from "next/navigation";
import AppShell from "~/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";
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

export default function SimulationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const simulationId = params.id as string;

  const { data: simulation, isLoading, error } = trpc.simulation.getById.useQuery(
    { id: simulationId },
    { enabled: !!simulationId, refetchInterval: 5000 }
  );

  const cancelMutation = trpc.simulation.cancel.useMutation({
    onSuccess: () => {
      router.push("/simulation");
    },
  });

  const deleteMutation = trpc.simulation.delete.useMutation({
    onSuccess: () => {
      router.push("/simulation");
    },
  });

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </AppShell>
    );
  }

  if (error || !simulation) {
    return (
      <AppShell>
        <div className="rounded-md border border-danger/30 bg-danger/10 p-4">
          <p className="text-sm text-danger">
            {error?.message ?? "Simulation not found"}
          </p>
          <Button
            variant="ghost"
            className="mt-4"
            onClick={() => router.push("/simulation")}
          >
            ← Back to Simulations
          </Button>
        </div>
      </AppShell>
    );
  }

  const status = statusConfig[simulation.status as SimulationStatus] ?? statusConfig.PENDING;
  const isRunning = simulation.status === "RUNNING";
  const isPending = simulation.status === "PENDING";
  const canCancel = isPending || isRunning;

  return (
    <AppShell>
      {/* Header */}
      <div className="mb-8">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/simulation")}
          className="mb-4"
        >
          ← Back to Simulations
        </Button>

        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">{simulation.name}</h1>
              <Badge variant={status.variant}>
                {(isPending || isRunning) && (
                  <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-current" />
                )}
                {status.label}
              </Badge>
            </div>
            <p className="mt-2 text-muted">
              {simulation.description ?? "No description provided"}
            </p>
          </div>

          <div className="flex gap-2">
            {canCancel && (
              <Button
                variant="secondary"
                onClick={() => cancelMutation.mutate({ id: simulationId })}
                disabled={cancelMutation.isPending}
              >
                {cancelMutation.isPending ? "Cancelling..." : "Cancel Simulation"}
              </Button>
            )}
            {!canCancel && (
              <Button
                variant="danger"
                onClick={() => deleteMutation.mutate({ id: simulationId })}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="grid grid-cols-3 gap-6">
        {/* Left column - Results */}
        <div className="col-span-2 space-y-6">
          {/* Status Card */}
          {(isPending || isRunning) && (
            <Card className="border-accent/30 bg-accent/5">
              <CardContent className="py-4">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 animate-spin rounded-full border-4 border-accent border-t-transparent" />
                  <div>
                    <h3 className="font-semibold text-foreground">
                      {isPending ? "Waiting for Processing" : "Simulation Running"}
                    </h3>
                    <p className="text-sm text-muted">
                      {isPending
                        ? "This simulation is queued and waiting for the cluster operator to process it."
                        : "The cluster operator is analyzing historical network flows against your policy."}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Results Stats */}
          <div className="grid grid-cols-4 gap-4">
            <Card className="text-center">
              <CardContent className="py-4">
                <p className="text-2xl font-bold text-foreground">
                  {formatNumber(simulation.flowsAnalyzed ?? 0)}
                </p>
                <p className="text-sm text-muted">Flows Analyzed</p>
              </CardContent>
            </Card>
            <Card className="text-center">
              <CardContent className="py-4">
                <p className="text-2xl font-bold text-success">
                  {simulation.flowsAllowed !== null ? formatNumber(simulation.flowsAllowed) : "—"}
                </p>
                <p className="text-sm text-muted">Allowed</p>
              </CardContent>
            </Card>
            <Card className="text-center">
              <CardContent className="py-4">
                <p className="text-2xl font-bold text-danger">
                  {simulation.flowsDenied !== null ? formatNumber(simulation.flowsDenied) : "—"}
                </p>
                <p className="text-sm text-muted">Denied</p>
              </CardContent>
            </Card>
            <Card className="text-center">
              <CardContent className="py-4">
                <p className="text-2xl font-bold text-warning">
                  {simulation.flowsChanged !== null ? formatNumber(simulation.flowsChanged) : "—"}
                </p>
                <p className="text-sm text-muted">Would Change</p>
              </CardContent>
            </Card>
          </div>

          {/* Policy Content */}
          {simulation.policy?.content && (
            <Card>
              <CardHeader>
                <CardTitle>Policy Being Tested</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="overflow-auto rounded-md bg-background p-4 text-xs text-foreground">
                  <code>{simulation.policy.content}</code>
                </pre>
              </CardContent>
            </Card>
          )}

          {/* Detailed Results */}
          {simulation.results && (
            <Card>
              <CardHeader>
                <CardTitle>Detailed Results</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="overflow-auto rounded-md bg-background p-4 text-xs text-foreground">
                  <code>{JSON.stringify(simulation.results, null, 2)}</code>
                </pre>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column - Details */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <span className="text-xs text-muted">Policy</span>
                <p className="mt-1 font-medium text-foreground">
                  {simulation.policy?.name ?? "Unknown"}
                </p>
                {simulation.policy?.type && (
                  <Badge variant="muted" className="mt-1">
                    {simulation.policy.type.replace("_", " ")}
                  </Badge>
                )}
              </div>

              <div>
                <span className="text-xs text-muted">Cluster</span>
                <p className="mt-1 font-medium text-foreground">
                  {simulation.cluster?.name ?? "Unknown"}
                </p>
                {simulation.cluster?.provider && simulation.cluster?.region && (
                  <p className="text-sm text-muted">
                    {simulation.cluster.provider} • {simulation.cluster.region}
                  </p>
                )}
              </div>

              <div>
                <span className="text-xs text-muted">Time Range</span>
                <p className="mt-1 text-sm text-foreground">
                  {new Date(simulation.startTime).toLocaleDateString()} -{" "}
                  {new Date(simulation.endTime).toLocaleDateString()}
                </p>
              </div>

              <div>
                <span className="text-xs text-muted">Started By</span>
                <p className="mt-1 text-sm text-foreground">
                  {simulation.runner?.name ?? simulation.runner?.email ?? "Unknown"}
                </p>
              </div>

              <div>
                <span className="text-xs text-muted">Created</span>
                <p className="mt-1 text-sm text-foreground">
                  {new Date(simulation.createdAt).toLocaleString()}
                </p>
              </div>

              {simulation.completedAt && (
                <div>
                  <span className="text-xs text-muted">Completed</span>
                  <p className="mt-1 text-sm text-foreground">
                    {new Date(simulation.completedAt).toLocaleString()}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {simulation.policy?.id && (
                <Button
                  variant="secondary"
                  className="w-full justify-start"
                  onClick={() => router.push(`/policies/${simulation.policy?.id}`)}
                >
                  View Policy
                </Button>
              )}
              {simulation.cluster?.id && (
                <Button
                  variant="secondary"
                  className="w-full justify-start"
                  onClick={() => router.push(`/clusters/${simulation.cluster?.id}`)}
                >
                  View Cluster
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
