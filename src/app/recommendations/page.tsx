"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import AppShell from "~/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import Badge from "~/components/ui/badge";
import Button from "~/components/ui/button";
import { trpc } from "~/lib/trpc";

type RecommendationType = "COVERAGE_GAP" | "UNUSED_POLICY" | "CONSOLIDATION";
type RecommendationSeverity = "CRITICAL" | "WARNING" | "INFO";

interface Recommendation {
  id: string;
  type: RecommendationType;
  severity: RecommendationSeverity;
  clusterId: string;
  clusterName: string;
  title: string;
  description: string;
  impact: number;
  suggestedAction: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

const typeLabels: Record<RecommendationType, string> = {
  COVERAGE_GAP: "Coverage Gap",
  UNUSED_POLICY: "Unused Policy",
  CONSOLIDATION: "Consolidation",
};

const severityConfig: Record<
  RecommendationSeverity,
  { variant: "danger" | "warning" | "accent"; label: string; icon: string }
> = {
  CRITICAL: { variant: "danger", label: "Critical", icon: "🔴" },
  WARNING: { variant: "warning", label: "Warning", icon: "🟡" },
  INFO: { variant: "accent", label: "Info", icon: "🔵" },
};

// Hook to manage dismissed recommendations in localStorage
function useDismissedRecommendations() {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    const stored = localStorage.getItem("dismissedRecommendations");
    if (stored) {
      try {
        setDismissed(new Set(JSON.parse(stored) as string[]));
      } catch {
        // Ignore invalid JSON
      }
    }
  }, []);

  const dismiss = (id: string) => {
    const newDismissed = new Set(dismissed);
    newDismissed.add(id);
    setDismissed(newDismissed);
    localStorage.setItem(
      "dismissedRecommendations",
      JSON.stringify([...newDismissed])
    );
  };

  const isDismissed = (id: string) => dismissed.has(id);

  const clearDismissed = () => {
    setDismissed(new Set());
    localStorage.removeItem("dismissedRecommendations");
  };

  return { dismiss, isDismissed, clearDismissed, dismissedCount: dismissed.size };
}

// Recommendation card component
function RecommendationCard({
  recommendation,
  onDismiss,
  onArchive,
}: {
  recommendation: Recommendation;
  onDismiss: () => void;
  onArchive?: () => void;
}) {
  const severity = severityConfig[recommendation.severity];
  const utils = trpc.useUtils();

  // Archive mutation for unused policies
  const archiveMutation = trpc.recommendations.archivePolicy.useMutation({
    onSuccess: () => {
      void utils.recommendations.getAll.invalidate();
      void utils.recommendations.getStats.invalidate();
    },
  });

  const handleArchive = () => {
    if (!recommendation.metadata.policyId) return;
    if (
      confirm(
        `Archive policy "${recommendation.metadata.policyName as string}"? This will mark it as inactive.`
      )
    ) {
      archiveMutation.mutate({ policyId: recommendation.metadata.policyId as string });
      if (onArchive) onArchive();
    }
  };

  return (
    <Card className="relative overflow-hidden">
      {/* Severity indicator bar */}
      <div
        className={`absolute left-0 top-0 bottom-0 w-1 ${
          recommendation.severity === "CRITICAL"
            ? "bg-danger"
            : recommendation.severity === "WARNING"
            ? "bg-warning"
            : "bg-accent-light"
        }`}
      />

      <CardContent className="py-4 pl-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {/* Header with severity and type badges */}
            <div className="flex items-center gap-2 mb-2">
              <Badge variant={severity.variant}>{severity.label}</Badge>
              <Badge variant="muted">{typeLabels[recommendation.type]}</Badge>
              <span className="text-xs text-muted">
                {recommendation.clusterName}
              </span>
            </div>

            {/* Title */}
            <h3 className="font-semibold text-foreground mb-1">
              {recommendation.title}
            </h3>

            {/* Description */}
            <p className="text-sm text-muted">{recommendation.description}</p>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 shrink-0">
            {recommendation.type === "COVERAGE_GAP" && (
              <Link
                href={`/policies/new?clusterId=${recommendation.clusterId}&prefill=coverage-gap&src=${encodeURIComponent(String(recommendation.metadata.srcNamespace))}&dst=${encodeURIComponent(String(recommendation.metadata.dstNamespace))}&port=${String(recommendation.metadata.dstPort)}`}
              >
                <Button size="sm">Create Policy</Button>
              </Link>
            )}

            {recommendation.type === "UNUSED_POLICY" && (
              <>
                <Link
                  href={`/policies/${recommendation.metadata.policyId as string}`}
                >
                  <Button size="sm" variant="secondary">
                    View Policy
                  </Button>
                </Link>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleArchive}
                  disabled={archiveMutation.isPending}
                >
                  {archiveMutation.isPending ? "Archiving..." : "Archive"}
                </Button>
              </>
            )}

            {recommendation.type === "CONSOLIDATION" && (
              <div className="flex gap-2">
                <Link
                  href={`/policies/${recommendation.metadata.policyAId as string}`}
                >
                  <Button size="sm" variant="secondary">
                    View A
                  </Button>
                </Link>
                <Link
                  href={`/policies/${recommendation.metadata.policyBId as string}`}
                >
                  <Button size="sm" variant="secondary">
                    View B
                  </Button>
                </Link>
              </div>
            )}

            <Button size="sm" variant="ghost" onClick={onDismiss}>
              Dismiss
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function RecommendationsPage() {
  const [selectedClusterId, setSelectedClusterId] = useState<string>("");
  const [selectedType, setSelectedType] = useState<RecommendationType | "">("");
  const [timeRange, setTimeRange] = useState<number>(24);

  const { dismiss, isDismissed, clearDismissed, dismissedCount } =
    useDismissedRecommendations();

  // Fetch clusters
  const { data: clusters } = trpc.cluster.list.useQuery();
  const clusterList = clusters ?? [];

  // Fetch recommendations
  const { data: recommendationsData, isLoading } =
    trpc.recommendations.getAll.useQuery(
      {
        clusterId: selectedClusterId || undefined,
        type: selectedType || undefined,
        hours: timeRange,
        limit: 100,
      },
      { refetchInterval: 60000 }
    );

  // Fetch stats
  const { data: stats } = trpc.recommendations.getStats.useQuery(
    {
      clusterId: selectedClusterId || undefined,
      hours: timeRange,
    },
    { refetchInterval: 60000 }
  );

  // Filter out dismissed recommendations
  const recommendations = (recommendationsData?.recommendations ?? []).filter(
    (r) => !isDismissed(r.id)
  );

  const visibleCount = recommendations.length;

  return (
    <AppShell>
      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Recommendations</h1>
          <p className="mt-1 text-muted">
            Traffic-informed suggestions to improve your policy coverage
          </p>
        </div>

        <div className="flex items-center gap-4">
          {/* Time range selector */}
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(Number(e.target.value))}
            className="rounded-md border border-card-border bg-background px-3 py-2 text-sm text-foreground"
          >
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
            <option value="">All Clusters</option>
            {clusterList.map((cluster) => (
              <option key={cluster.id} value={cluster.id}>
                {cluster.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="mb-8 grid grid-cols-4 gap-4">
          <Card className="text-center">
            <CardContent className="py-4">
              <p className="text-2xl font-bold text-foreground">{stats.total}</p>
              <p className="text-sm text-muted">Total Recommendations</p>
            </CardContent>
          </Card>
          <Card className="text-center">
            <CardContent className="py-4">
              <p className="text-2xl font-bold text-danger">
                {stats.bySeverity.CRITICAL}
              </p>
              <p className="text-sm text-muted">Critical</p>
            </CardContent>
          </Card>
          <Card className="text-center">
            <CardContent className="py-4">
              <p className="text-2xl font-bold text-warning">
                {stats.bySeverity.WARNING}
              </p>
              <p className="text-sm text-muted">Warning</p>
            </CardContent>
          </Card>
          <Card className="text-center">
            <CardContent className="py-4">
              <p className="text-2xl font-bold text-accent-light">
                {stats.bySeverity.INFO}
              </p>
              <p className="text-sm text-muted">Info</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Type filter tabs */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex gap-1 border-b border-card-border">
          <button
            onClick={() => setSelectedType("")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              selectedType === ""
                ? "border-primary text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            All
            {stats && (
              <Badge variant="muted" className="ml-2">
                {stats.total}
              </Badge>
            )}
          </button>
          <button
            onClick={() => setSelectedType("COVERAGE_GAP")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              selectedType === "COVERAGE_GAP"
                ? "border-primary text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            Coverage Gaps
            {stats && stats.byType.COVERAGE_GAP > 0 && (
              <Badge variant="warning" className="ml-2">
                {stats.byType.COVERAGE_GAP}
              </Badge>
            )}
          </button>
          <button
            onClick={() => setSelectedType("UNUSED_POLICY")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              selectedType === "UNUSED_POLICY"
                ? "border-primary text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            Unused Policies
            {stats && stats.byType.UNUSED_POLICY > 0 && (
              <Badge variant="muted" className="ml-2">
                {stats.byType.UNUSED_POLICY}
              </Badge>
            )}
          </button>
          <button
            onClick={() => setSelectedType("CONSOLIDATION")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              selectedType === "CONSOLIDATION"
                ? "border-primary text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            Consolidation
            {stats && stats.byType.CONSOLIDATION > 0 && (
              <Badge variant="accent" className="ml-2">
                {stats.byType.CONSOLIDATION}
              </Badge>
            )}
          </button>
        </div>

        {dismissedCount > 0 && (
          <Button variant="ghost" size="sm" onClick={clearDismissed}>
            Show {dismissedCount} dismissed
          </Button>
        )}
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && visibleCount === 0 && (
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
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <h3 className="mt-4 text-lg font-semibold text-foreground">
              No recommendations
            </h3>
            <p className="mt-2 text-sm text-muted">
              {dismissedCount > 0
                ? `All ${dismissedCount} recommendations have been dismissed.`
                : "Your policies are well-optimized! No issues detected."}
            </p>
            {dismissedCount > 0 && (
              <Button
                variant="secondary"
                className="mt-4"
                onClick={clearDismissed}
              >
                Show dismissed recommendations
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Recommendations list */}
      {!isLoading && visibleCount > 0 && (
        <div className="space-y-4">
          {recommendations.map((rec) => (
            <RecommendationCard
              key={rec.id}
              recommendation={rec}
              onDismiss={() => dismiss(rec.id)}
            />
          ))}
        </div>
      )}

      {/* Info card */}
      {!isLoading && (
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>About Recommendations</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted space-y-2">
            <p>
              <strong className="text-foreground">Coverage Gaps:</strong> Flows
              observed without any governing policy. Creating policies for these
              gaps improves your security posture.
            </p>
            <p>
              <strong className="text-foreground">Unused Policies:</strong>{" "}
              Deployed policies that have not matched any flows recently.
              Consider archiving to reduce clutter.
            </p>
            <p>
              <strong className="text-foreground">Consolidation:</strong>{" "}
              Policies with similar selectors that could potentially be merged
              for easier management.
            </p>
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}
