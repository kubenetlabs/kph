"use client";

import { useState } from "react";
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

// Type definitions for simulation results
interface NSImpact {
  namespace: string;
  totalFlows: number;
  allowedCount: number;
  deniedCount: number;
  wouldDeny: number;
  wouldAllow: number;
  noChange: number;
}

interface VerdictBreakdown {
  allowedToAllowed: number;
  allowedToDenied: number;
  deniedToAllowed: number;
  deniedToDenied: number;
  droppedToAllowed?: number;
  droppedToDenied?: number;
}

interface SimulatedFlow {
  srcNamespace: string;
  srcPodName?: string;
  dstNamespace: string;
  dstPodName?: string;
  dstPort: number;
  protocol: string;
  originalVerdict: string;
  simulatedVerdict: string;
  verdictChanged: boolean;
  matchedRule?: string;
  matchReason?: string;
}

interface SimulationResults {
  noChangeCount?: number;
  breakdownByNamespace?: Record<string, NSImpact>;
  breakdownByVerdict?: VerdictBreakdown;
  sampleFlows?: SimulatedFlow[];
  errors?: string[];
  durationNs?: number;
}

// Verdict Breakdown Component
function VerdictBreakdownCard({ breakdown }: { breakdown: VerdictBreakdown }) {
  const total =
    breakdown.allowedToAllowed +
    breakdown.allowedToDenied +
    breakdown.deniedToAllowed +
    breakdown.deniedToDenied +
    (breakdown.droppedToAllowed ?? 0) +
    (breakdown.droppedToDenied ?? 0);

  const items = [
    { label: "Allowed → Allowed", count: breakdown.allowedToAllowed, color: "bg-success", textColor: "text-success" },
    { label: "Allowed → Denied", count: breakdown.allowedToDenied, color: "bg-danger", textColor: "text-danger" },
    { label: "Denied → Allowed", count: breakdown.deniedToAllowed, color: "bg-warning", textColor: "text-warning" },
    { label: "Denied → Denied", count: breakdown.deniedToDenied, color: "bg-muted", textColor: "text-muted" },
  ];

  if (breakdown.droppedToAllowed) {
    items.push({ label: "Dropped → Allowed", count: breakdown.droppedToAllowed, color: "bg-warning", textColor: "text-warning" });
  }
  if (breakdown.droppedToDenied) {
    items.push({ label: "Dropped → Denied", count: breakdown.droppedToDenied, color: "bg-muted", textColor: "text-muted" });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Verdict Changes</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {items.map((item) => {
            const percentage = total > 0 ? (item.count / total) * 100 : 0;
            return (
              <div key={item.label}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-foreground">{item.label}</span>
                  <span className={item.textColor}>{formatNumber(item.count)} ({percentage.toFixed(1)}%)</span>
                </div>
                <div className="h-2 bg-card-hover rounded-full overflow-hidden">
                  <div
                    className={`h-full ${item.color} rounded-full transition-all`}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// Namespace Impact Table Component
function NamespaceImpactTable({ impacts }: { impacts: Record<string, NSImpact> }) {
  const namespaces = Object.values(impacts).sort((a, b) => b.totalFlows - a.totalFlows);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Impact by Namespace</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border">
                <th className="text-left py-2 px-3 text-muted font-medium">Namespace</th>
                <th className="text-right py-2 px-3 text-muted font-medium">Total</th>
                <th className="text-right py-2 px-3 text-muted font-medium">Allowed</th>
                <th className="text-right py-2 px-3 text-muted font-medium">Denied</th>
                <th className="text-right py-2 px-3 text-muted font-medium">Would Deny</th>
                <th className="text-right py-2 px-3 text-muted font-medium">Would Allow</th>
                <th className="text-right py-2 px-3 text-muted font-medium">No Change</th>
              </tr>
            </thead>
            <tbody>
              {namespaces.map((ns) => (
                <tr key={ns.namespace} className="border-b border-card-border/50 hover:bg-card-hover">
                  <td className="py-2 px-3 font-medium text-foreground">{ns.namespace}</td>
                  <td className="py-2 px-3 text-right text-foreground">{formatNumber(ns.totalFlows)}</td>
                  <td className="py-2 px-3 text-right text-success">{formatNumber(ns.allowedCount)}</td>
                  <td className="py-2 px-3 text-right text-danger">{formatNumber(ns.deniedCount)}</td>
                  <td className="py-2 px-3 text-right text-danger">{formatNumber(ns.wouldDeny)}</td>
                  <td className="py-2 px-3 text-right text-warning">{formatNumber(ns.wouldAllow)}</td>
                  <td className="py-2 px-3 text-right text-muted">{formatNumber(ns.noChange)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {namespaces.length === 0 && (
          <p className="text-center text-muted py-4">No namespace data available</p>
        )}
      </CardContent>
    </Card>
  );
}

// Export Button Component
function ExportButton({ simulationId, format }: { simulationId: string; format: "json" | "csv" }) {
  const { isLoading, refetch } = trpc.simulation.exportResults.useQuery(
    { id: simulationId, format },
    { enabled: false } // Don't auto-fetch, only on click
  );

  const handleExport = async () => {
    const result = await refetch();
    if (result.data) {
      const blob = new Blob([result.data.content], { type: result.data.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.data.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  return (
    <Button
      variant="secondary"
      className="w-full justify-start"
      onClick={handleExport}
      disabled={isLoading}
    >
      {isLoading ? (
        <>
          <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Exporting...
        </>
      ) : (
        <>
          <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export as {format.toUpperCase()}
        </>
      )}
    </Button>
  );
}

// Sample Flows Table Component
function SampleFlowsTable({ flows }: { flows: SimulatedFlow[] }) {
  const [filter, setFilter] = useState<"all" | "changed" | "denied">("all");

  const filteredFlows = flows.filter((flow) => {
    if (filter === "changed") return flow.verdictChanged;
    if (filter === "denied") return flow.simulatedVerdict === "DENIED";
    return true;
  });

  const getVerdictBadge = (verdict: string, isNew = false) => {
    const variant = verdict === "ALLOWED" ? "success" : verdict === "DENIED" ? "danger" : "muted";
    return (
      <Badge variant={variant} className={isNew ? "ring-2 ring-offset-1 ring-offset-background ring-primary/50" : ""}>
        {verdict}
      </Badge>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Sample Flows</CardTitle>
          <div className="flex gap-2">
            <button
              onClick={() => setFilter("all")}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                filter === "all"
                  ? "bg-primary text-primary-foreground"
                  : "bg-card-hover text-muted hover:text-foreground"
              }`}
            >
              All ({flows.length})
            </button>
            <button
              onClick={() => setFilter("changed")}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                filter === "changed"
                  ? "bg-warning text-background"
                  : "bg-card-hover text-muted hover:text-foreground"
              }`}
            >
              Changed ({flows.filter(f => f.verdictChanged).length})
            </button>
            <button
              onClick={() => setFilter("denied")}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                filter === "denied"
                  ? "bg-danger text-white"
                  : "bg-card-hover text-muted hover:text-foreground"
              }`}
            >
              Denied ({flows.filter(f => f.simulatedVerdict === "DENIED").length})
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border">
                <th className="text-left py-2 px-3 text-muted font-medium">Source</th>
                <th className="text-left py-2 px-3 text-muted font-medium">Destination</th>
                <th className="text-center py-2 px-3 text-muted font-medium">Port</th>
                <th className="text-center py-2 px-3 text-muted font-medium">Protocol</th>
                <th className="text-center py-2 px-3 text-muted font-medium">Before</th>
                <th className="text-center py-2 px-3 text-muted font-medium">After</th>
                <th className="text-left py-2 px-3 text-muted font-medium">Reason</th>
              </tr>
            </thead>
            <tbody>
              {filteredFlows.map((flow, idx) => (
                <tr
                  key={idx}
                  className={`border-b border-card-border/50 hover:bg-card-hover ${
                    flow.verdictChanged ? "bg-warning/5" : ""
                  }`}
                >
                  <td className="py-2 px-3">
                    <div className="font-medium text-foreground">{flow.srcNamespace}</div>
                    {flow.srcPodName && (
                      <div className="text-xs text-muted truncate max-w-[200px]">{flow.srcPodName}</div>
                    )}
                  </td>
                  <td className="py-2 px-3">
                    <div className="font-medium text-foreground">{flow.dstNamespace}</div>
                    {flow.dstPodName && (
                      <div className="text-xs text-muted truncate max-w-[200px]">{flow.dstPodName}</div>
                    )}
                  </td>
                  <td className="py-2 px-3 text-center text-foreground">{flow.dstPort}</td>
                  <td className="py-2 px-3 text-center">
                    <Badge variant="muted">{flow.protocol}</Badge>
                  </td>
                  <td className="py-2 px-3 text-center">
                    {getVerdictBadge(flow.originalVerdict)}
                  </td>
                  <td className="py-2 px-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {flow.verdictChanged && (
                        <svg className="w-4 h-4 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                      )}
                      {getVerdictBadge(flow.simulatedVerdict, flow.verdictChanged)}
                    </div>
                  </td>
                  <td className="py-2 px-3 text-xs text-muted max-w-[200px] truncate">
                    {flow.matchReason ?? flow.matchedRule ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredFlows.length === 0 && (
          <p className="text-center text-muted py-4">
            {filter === "all" ? "No sample flows available" : `No ${filter} flows found`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function SimulationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const simulationId = params.id as string;
  const [activeTab, setActiveTab] = useState<"overview" | "flows" | "policy">("overview");

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

  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- checking truthiness, not nullish
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
  const isCompleted = simulation.status === "COMPLETED";
  const canCancel = isPending || isRunning;

  // Parse results if available
  const results = simulation.results as SimulationResults | null;
  const hasResults = isCompleted && results;

  return (
    <AppShell>
      {/* Header */}
      <div className="mb-6">
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

      {/* Tabs for completed simulations */}
      {hasResults && (
        <div className="mb-6 flex gap-1 border-b border-card-border">
          <button
            onClick={() => setActiveTab("overview")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "overview"
                ? "border-primary text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab("flows")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "flows"
                ? "border-primary text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            Sample Flows
            {results.sampleFlows && (
              <span className="ml-1.5 text-xs text-muted">({results.sampleFlows.length})</span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("policy")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "policy"
                ? "border-primary text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            Policy
          </button>
        </div>
      )}

      {/* Running/Pending Status */}
      {(isPending || isRunning) && (
        <Card className="mb-6 border-accent/30 bg-accent/5">
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

      {/* Main content */}
      <div className="grid grid-cols-3 gap-6">
        {/* Left column - Results */}
        <div className="col-span-2 space-y-6">
          {/* Results Stats - Always visible */}
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

          {/* Tab Content */}
          {activeTab === "overview" && hasResults && (
            <>
              {/* Verdict Breakdown */}
              {results.breakdownByVerdict && (
                <VerdictBreakdownCard breakdown={results.breakdownByVerdict} />
              )}

              {/* Namespace Impact */}
              {results.breakdownByNamespace && Object.keys(results.breakdownByNamespace).length > 0 && (
                <NamespaceImpactTable impacts={results.breakdownByNamespace} />
              )}

              {/* Errors */}
              {results.errors && results.errors.length > 0 && (
                <Card className="border-danger/30">
                  <CardHeader>
                    <CardTitle className="text-danger">Errors</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {results.errors.map((err, idx) => (
                        <li key={idx} className="text-sm text-danger bg-danger/10 p-2 rounded">
                          {err}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {activeTab === "flows" && hasResults && results.sampleFlows && (
            <SampleFlowsTable flows={results.sampleFlows} />
          )}

          {activeTab === "policy" && simulation.policy?.content && (
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

          {/* Show policy for non-completed states */}
          {!hasResults && simulation.policy?.content && (
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

              {results?.durationNs && (
                <div>
                  <span className="text-xs text-muted">Duration</span>
                  <p className="mt-1 text-sm text-foreground">
                    {(results.durationNs / 1_000_000_000).toFixed(2)}s
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

          {/* Export */}
          {isCompleted && (
            <Card>
              <CardHeader>
                <CardTitle>Export</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <ExportButton simulationId={simulationId} format="json" />
                <ExportButton simulationId={simulationId} format="csv" />
              </CardContent>
            </Card>
          )}

          {/* Quick Stats for completed */}
          {hasResults && results.breakdownByVerdict && (
            <Card className="border-warning/30 bg-warning/5">
              <CardHeader>
                <CardTitle className="text-warning">Impact Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted">Would be blocked:</span>
                    <span className="font-medium text-danger">
                      {formatNumber(results.breakdownByVerdict.allowedToDenied)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Would be allowed:</span>
                    <span className="font-medium text-warning">
                      {formatNumber(results.breakdownByVerdict.deniedToAllowed)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">No change:</span>
                    <span className="font-medium text-muted">
                      {formatNumber(results.breakdownByVerdict.allowedToAllowed + results.breakdownByVerdict.deniedToDenied)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </AppShell>
  );
}
