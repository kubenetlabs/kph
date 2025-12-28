"use client";

import { useState } from "react";
import AppShell from "~/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";
import { trpc } from "~/lib/trpc";

function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toString();
}

function formatPercentage(value: number): string {
  return `${value.toFixed(1)}%`;
}

// Verdict breakdown visualization
function VerdictBreakdown({
  allowed,
  blocked,
  noPolicy,
}: {
  allowed: number;
  blocked: number;
  noPolicy: number;
}) {
  const total = allowed + blocked + noPolicy;
  if (total === 0) {
    return (
      <div className="text-center text-muted py-8">
        No validation data available
      </div>
    );
  }

  const allowedPct = (allowed / total) * 100;
  const blockedPct = (blocked / total) * 100;
  const noPolicyPct = (noPolicy / total) * 100;

  return (
    <div className="space-y-4">
      {/* Visual bar */}
      <div className="h-8 rounded-lg overflow-hidden flex">
        {allowedPct > 0 && (
          <div
            className="bg-success flex items-center justify-center text-white text-xs font-medium transition-all"
            style={{ width: `${allowedPct}%` }}
          >
            {allowedPct > 10 && formatPercentage(allowedPct)}
          </div>
        )}
        {blockedPct > 0 && (
          <div
            className="bg-danger flex items-center justify-center text-white text-xs font-medium transition-all"
            style={{ width: `${blockedPct}%` }}
          >
            {blockedPct > 10 && formatPercentage(blockedPct)}
          </div>
        )}
        {noPolicyPct > 0 && (
          <div
            className="bg-warning flex items-center justify-center text-background text-xs font-medium transition-all"
            style={{ width: `${noPolicyPct}%` }}
          >
            {noPolicyPct > 10 && formatPercentage(noPolicyPct)}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-success" />
          <span className="text-muted">Allowed:</span>
          <span className="font-medium text-foreground">{formatNumber(allowed)}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-danger" />
          <span className="text-muted">Blocked:</span>
          <span className="font-medium text-foreground">{formatNumber(blocked)}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-warning" />
          <span className="text-muted">No Policy:</span>
          <span className="font-medium text-foreground">{formatNumber(noPolicy)}</span>
        </div>
      </div>
    </div>
  );
}

// Coverage gaps table
function CoverageGapsTable({
  gaps,
}: {
  gaps: Array<{
    srcNamespace: string;
    srcPodName?: string;
    dstNamespace: string;
    dstPodName?: string;
    dstPort: number;
    count: number;
  }>;
}) {
  if (gaps.length === 0) {
    return (
      <div className="text-center text-muted py-8">
        No coverage gaps detected - all flows are governed by policies
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-card-border">
            <th className="text-left py-2 px-3 text-muted font-medium">Source</th>
            <th className="text-left py-2 px-3 text-muted font-medium">Destination</th>
            <th className="text-center py-2 px-3 text-muted font-medium">Port</th>
            <th className="text-right py-2 px-3 text-muted font-medium">Count</th>
          </tr>
        </thead>
        <tbody>
          {gaps.map((gap, idx) => (
            <tr key={idx} className="border-b border-card-border/50 hover:bg-card-hover">
              <td className="py-2 px-3">
                <div className="font-medium text-foreground">{gap.srcNamespace}</div>
                {gap.srcPodName && (
                  <div className="text-xs text-muted truncate max-w-[200px]">
                    {gap.srcPodName}
                  </div>
                )}
              </td>
              <td className="py-2 px-3">
                <div className="font-medium text-foreground">{gap.dstNamespace}</div>
                {gap.dstPodName && (
                  <div className="text-xs text-muted truncate max-w-[200px]">
                    {gap.dstPodName}
                  </div>
                )}
              </td>
              <td className="py-2 px-3 text-center">
                <Badge variant="muted">{gap.dstPort}</Badge>
              </td>
              <td className="py-2 px-3 text-right font-medium text-warning">
                {formatNumber(gap.count)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Blocked flows table
function BlockedFlowsTable({
  flows,
}: {
  flows: Array<{
    id: string;
    timestamp: string;
    srcNamespace: string;
    srcPodName?: string | null;
    dstNamespace: string;
    dstPodName?: string | null;
    dstPort: number;
    protocol: string;
    matchedPolicy?: string | null;
    reason?: string | null;
  }>;
}) {
  if (flows.length === 0) {
    return (
      <div className="text-center text-muted py-8">
        No blocked flows in this time period
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-card-border">
            <th className="text-left py-2 px-3 text-muted font-medium">Time</th>
            <th className="text-left py-2 px-3 text-muted font-medium">Source</th>
            <th className="text-left py-2 px-3 text-muted font-medium">Destination</th>
            <th className="text-center py-2 px-3 text-muted font-medium">Port</th>
            <th className="text-left py-2 px-3 text-muted font-medium">Policy</th>
          </tr>
        </thead>
        <tbody>
          {flows.map((flow) => (
            <tr key={flow.id} className="border-b border-card-border/50 hover:bg-card-hover">
              <td className="py-2 px-3 text-xs text-muted whitespace-nowrap">
                {new Date(flow.timestamp).toLocaleTimeString()}
              </td>
              <td className="py-2 px-3">
                <div className="font-medium text-foreground">{flow.srcNamespace}</div>
                {flow.srcPodName && (
                  <div className="text-xs text-muted truncate max-w-[150px]">
                    {flow.srcPodName}
                  </div>
                )}
              </td>
              <td className="py-2 px-3">
                <div className="font-medium text-foreground">{flow.dstNamespace}</div>
                {flow.dstPodName && (
                  <div className="text-xs text-muted truncate max-w-[150px]">
                    {flow.dstPodName}
                  </div>
                )}
              </td>
              <td className="py-2 px-3 text-center">
                <Badge variant="muted">
                  {flow.dstPort}/{flow.protocol}
                </Badge>
              </td>
              <td className="py-2 px-3">
                {flow.matchedPolicy ? (
                  <Badge variant="danger">{flow.matchedPolicy}</Badge>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ValidationDashboardPage() {
  const [selectedClusterId, setSelectedClusterId] = useState<string>("");
  const [timeRange, setTimeRange] = useState<number>(24);
  const [activeTab, setActiveTab] = useState<"overview" | "gaps" | "blocked">("overview");

  // Fetch clusters
  const { data: clusters } = trpc.cluster.list.useQuery();
  const clusterList = clusters ?? [];

  // Auto-select first cluster
  if (!selectedClusterId && clusterList.length > 0 && clusterList[0]) {
    setSelectedClusterId(clusterList[0].id);
  }

  // Fetch validation data
  const { data: summary, isLoading: summaryLoading } = trpc.validation.getSummary.useQuery(
    { clusterId: selectedClusterId, hours: timeRange },
    { enabled: !!selectedClusterId, refetchInterval: 30000 }
  );

  const { data: coverageGaps } = trpc.validation.getCoverageGaps.useQuery(
    { clusterId: selectedClusterId, hours: timeRange, limit: 20 },
    { enabled: !!selectedClusterId && activeTab === "gaps" }
  );

  const { data: blockedFlows } = trpc.validation.getBlockedFlows.useQuery(
    { clusterId: selectedClusterId, hours: timeRange, limit: 50 },
    { enabled: !!selectedClusterId && activeTab === "blocked" }
  );

  // Org-wide stats
  const { data: orgStats } = trpc.validation.getOrgStats.useQuery(
    { hours: timeRange },
    { refetchInterval: 60000 }
  );

  return (
    <AppShell>
      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Policy Validation</h1>
          <p className="mt-1 text-muted">
            Monitor how your policies are performing across clusters
          </p>
        </div>

        <div className="flex items-center gap-4">
          {/* Time range selector */}
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(Number(e.target.value))}
            className="rounded-md border border-card-border bg-background px-3 py-2 text-sm text-foreground"
          >
            <option value={1}>Last hour</option>
            <option value={6}>Last 6 hours</option>
            <option value={24}>Last 24 hours</option>
            <option value={72}>Last 3 days</option>
            <option value={168}>Last 7 days</option>
          </select>

          {/* Cluster selector */}
          <select
            value={selectedClusterId}
            onChange={(e) => setSelectedClusterId(e.target.value)}
            className="rounded-md border border-card-border bg-background px-3 py-2 text-sm text-foreground min-w-[200px]"
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

      {/* Organization-wide stats */}
      {orgStats && (
        <div className="mb-8 grid grid-cols-4 gap-4">
          <Card className="text-center">
            <CardContent className="py-4">
              <p className="text-2xl font-bold text-foreground">
                {formatNumber(orgStats.totals.allowed + orgStats.totals.blocked + orgStats.totals.noPolicy)}
              </p>
              <p className="text-sm text-muted">Total Flows Validated</p>
            </CardContent>
          </Card>
          <Card className="text-center">
            <CardContent className="py-4">
              <p className="text-2xl font-bold text-success">
                {formatNumber(orgStats.totals.allowed)}
              </p>
              <p className="text-sm text-muted">Allowed</p>
            </CardContent>
          </Card>
          <Card className="text-center">
            <CardContent className="py-4">
              <p className="text-2xl font-bold text-danger">
                {formatNumber(orgStats.totals.blocked)}
              </p>
              <p className="text-sm text-muted">Blocked</p>
            </CardContent>
          </Card>
          <Card className="text-center">
            <CardContent className="py-4">
              <p className="text-2xl font-bold text-warning">
                {formatNumber(orgStats.totals.noPolicy)}
              </p>
              <p className="text-sm text-muted">No Policy (Gaps)</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs */}
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
          onClick={() => setActiveTab("gaps")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "gaps"
              ? "border-primary text-foreground"
              : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          Coverage Gaps
          {summary && summary.totals.noPolicy > 0 && (
            <Badge variant="warning" className="ml-2">
              {formatNumber(summary.totals.noPolicy)}
            </Badge>
          )}
        </button>
        <button
          onClick={() => setActiveTab("blocked")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "blocked"
              ? "border-primary text-foreground"
              : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          Blocked Flows
        </button>
      </div>

      {/* Loading state */}
      {summaryLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}

      {/* No cluster selected */}
      {!selectedClusterId && !summaryLoading && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted">Select a cluster to view validation data</p>
          </CardContent>
        </Card>
      )}

      {/* Tab content */}
      {selectedClusterId && !summaryLoading && (
        <>
          {activeTab === "overview" && summary && (
            <div className="grid grid-cols-3 gap-6">
              {/* Main content */}
              <div className="col-span-2 space-y-6">
                {/* Verdict breakdown */}
                <Card>
                  <CardHeader>
                    <CardTitle>Verdict Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <VerdictBreakdown
                      allowed={summary.totals.allowed}
                      blocked={summary.totals.blocked}
                      noPolicy={summary.totals.noPolicy}
                    />
                  </CardContent>
                </Card>

                {/* Hourly breakdown - simple chart */}
                {summary.hourlyBreakdown.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Hourly Trend</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-end gap-1 h-32">
                        {summary.hourlyBreakdown.slice(-24).map((hour, idx) => {
                          const total = hour.allowed + hour.blocked + hour.noPolicy;
                          const maxTotal = Math.max(
                            ...summary.hourlyBreakdown.slice(-24).map(
                              (h) => h.allowed + h.blocked + h.noPolicy
                            )
                          );
                          const height = maxTotal > 0 ? (total / maxTotal) * 100 : 0;

                          return (
                            <div
                              key={idx}
                              className="flex-1 bg-primary/20 rounded-t hover:bg-primary/30 transition-colors"
                              style={{ height: `${height}%` }}
                              title={`${new Date(hour.hour).toLocaleString()}: ${formatNumber(total)} flows`}
                            />
                          );
                        })}
                      </div>
                      <div className="flex justify-between text-xs text-muted mt-2">
                        <span>
                          {summary.hourlyBreakdown.length > 0 && summary.hourlyBreakdown[0]
                            ? new Date(summary.hourlyBreakdown[0].hour).toLocaleDateString()
                            : ""}
                        </span>
                        <span>Now</span>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Sidebar */}
              <div className="space-y-6">
                {/* Coverage stats */}
                <Card>
                  <CardHeader>
                    <CardTitle>Coverage</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-muted">Policy Coverage</span>
                        <span className="font-medium text-foreground">
                          {formatPercentage(summary.coveragePercentage)}
                        </span>
                      </div>
                      <div className="h-2 bg-card-hover rounded-full overflow-hidden">
                        <div
                          className="h-full bg-success rounded-full transition-all"
                          style={{ width: `${summary.coveragePercentage}%` }}
                        />
                      </div>
                    </div>

                    <div className="pt-2 border-t border-card-border">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted">Total Flows</span>
                        <span className="font-medium text-foreground">
                          {formatNumber(summary.totalFlows)}
                        </span>
                      </div>
                    </div>

                    {summary.trend !== 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted">Trend</span>
                        <span
                          className={`font-medium ${
                            summary.trend > 0 ? "text-success" : "text-danger"
                          }`}
                        >
                          {summary.trend > 0 ? "+" : ""}
                          {formatPercentage(summary.trend)}
                        </span>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Cluster info */}
                <Card>
                  <CardHeader>
                    <CardTitle>Cluster</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="font-medium text-foreground">{summary.cluster.name}</p>
                    <p className="text-sm text-muted mt-1">
                      Last {timeRange} hours
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {activeTab === "gaps" && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Coverage Gaps</CardTitle>
                  <p className="text-sm text-muted">
                    Flows with no governing policy
                  </p>
                </div>
              </CardHeader>
              <CardContent>
                <CoverageGapsTable gaps={coverageGaps?.gaps ?? []} />
              </CardContent>
            </Card>
          )}

          {activeTab === "blocked" && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Blocked Flows</CardTitle>
                  <p className="text-sm text-muted">
                    Recent flows blocked by policy
                  </p>
                </div>
              </CardHeader>
              <CardContent>
                <BlockedFlowsTable flows={blockedFlows?.blockedFlows ?? []} />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </AppShell>
  );
}
