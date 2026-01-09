"use client";

import { useState } from "react";
import Link from "next/link";
import AppShell from "~/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import Badge from "~/components/ui/badge";
import Button from "~/components/ui/button";
import { trpc } from "~/lib/trpc";

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, "success" | "danger" | "warning" | "muted"> = {
    DEPLOYED: "success",
    PENDING: "warning",
    FAILED: "danger",
    DRAFT: "muted",
    ARCHIVED: "muted",
  };
  return <Badge variant={variants[status] ?? "muted"}>{status}</Badge>;
}

function ValidationBadge({ valid }: { valid: boolean | null }) {
  if (valid === null) {
    return <Badge variant="muted">Pending</Badge>;
  }
  return valid ? (
    <Badge variant="success">Valid</Badge>
  ) : (
    <Badge variant="danger">Invalid</Badge>
  );
}

function KindIcon({ kind }: { kind: string }) {
  const icons: Record<string, string> = {
    HTTPRoute: "H",
    GRPCRoute: "G",
    TCPRoute: "T",
    TLSRoute: "S",
    Gateway: "GW",
    ReferenceGrant: "R",
  };
  return (
    <span className="inline-flex items-center justify-center w-8 h-8 rounded bg-primary/10 text-primary text-xs font-bold">
      {icons[kind] ?? kind[0]}
    </span>
  );
}

export default function GatewayAPIStatusPage() {
  const [selectedClusterId, setSelectedClusterId] = useState<string>("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Fetch clusters
  const { data: clusters } = trpc.cluster.list.useQuery();
  const clusterList = clusters ?? [];

  // Auto-select first cluster
  if (!selectedClusterId && clusterList.length > 0 && clusterList[0]) {
    setSelectedClusterId(clusterList[0].id);
  }

  // Fetch validation status
  const { data, isLoading, refetch } = trpc.gatewayApi.getValidationStatus.useQuery(
    { clusterId: selectedClusterId },
    { enabled: !!selectedClusterId, refetchInterval: 30000 }
  );

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <AppShell>
      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Gateway API Status</h1>
          <p className="mt-1 text-muted">
            Validation status for HTTPRoutes, GRPCRoutes, TCPRoutes, and TLSRoutes
          </p>
        </div>

        <div className="flex items-center gap-4">
          {/* Create button */}
          <Link href="/policies/new">
            <Button>
              <svg
                className="mr-2 h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              Create Gateway Route
            </Button>
          </Link>

          {/* Refresh button */}
          <button
            onClick={() => refetch()}
            className="rounded-md border border-card-border bg-background px-3 py-2 text-sm text-foreground hover:bg-card-hover"
          >
            Refresh
          </button>

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

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}

      {/* No cluster selected */}
      {!selectedClusterId && !isLoading && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted">Select a cluster to view Gateway API status</p>
          </CardContent>
        </Card>
      )}

      {/* Content */}
      {data && !isLoading && (
        <>
          {/* Summary cards */}
          <div className="mb-8 grid grid-cols-5 gap-4">
            <Card className="text-center">
              <CardContent className="py-4">
                <p className="text-2xl font-bold text-foreground">{data.summary.total}</p>
                <p className="text-sm text-muted">Total Resources</p>
              </CardContent>
            </Card>
            <Card className="text-center">
              <CardContent className="py-4">
                <p className="text-2xl font-bold text-success">{data.summary.valid}</p>
                <p className="text-sm text-muted">Valid</p>
              </CardContent>
            </Card>
            <Card className="text-center">
              <CardContent className="py-4">
                <p className="text-2xl font-bold text-danger">{data.summary.invalid}</p>
                <p className="text-sm text-muted">Invalid</p>
              </CardContent>
            </Card>
            <Card className="text-center">
              <CardContent className="py-4">
                <p className="text-2xl font-bold text-warning">{data.summary.pending}</p>
                <p className="text-sm text-muted">Pending Validation</p>
              </CardContent>
            </Card>
            <Card className="text-center">
              <CardContent className="py-4">
                <p className="text-2xl font-bold text-foreground">{data.summary.validated}</p>
                <p className="text-sm text-muted">Validated</p>
              </CardContent>
            </Card>
          </div>

          {/* Resources list */}
          <Card>
            <CardHeader>
              <CardTitle>Gateway API Resources</CardTitle>
            </CardHeader>
            <CardContent>
              {data.resources.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-muted mb-4">
                    No Gateway API resources found in this cluster
                  </p>
                  <Link href="/policies/new">
                    <Button variant="secondary">
                      Create your first Gateway Route
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-2">
                  {data.resources.map((resource) => (
                    <div
                      key={resource.id}
                      className="border border-card-border rounded-lg overflow-hidden"
                    >
                      {/* Resource header */}
                      <button
                        onClick={() => toggleExpand(resource.id)}
                        className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-card-hover transition-colors"
                      >
                        <KindIcon kind={resource.kind} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground truncate">
                              {resource.name}
                            </span>
                            <span className="text-muted text-sm">
                              {resource.namespace}
                            </span>
                          </div>
                          <div className="text-xs text-muted mt-0.5">
                            {resource.kind}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <StatusBadge status={resource.deploymentStatus} />
                          <ValidationBadge valid={resource.validation?.valid ?? null} />
                          <span className="text-muted">
                            {expandedId === resource.id ? "▲" : "▼"}
                          </span>
                        </div>
                      </button>

                      {/* Expanded details */}
                      {expandedId === resource.id && (
                        <div className="border-t border-card-border px-4 py-3 bg-card-hover/50">
                          {resource.validation ? (
                            <div className="space-y-3">
                              <div className="flex items-center gap-4 text-sm">
                                <span className="text-muted">Last validated:</span>
                                <span className="text-foreground">
                                  {new Date(resource.validation.validatedAt).toLocaleString()}
                                </span>
                              </div>

                              {resource.validation.errors.length > 0 && (
                                <div>
                                  <p className="text-sm font-medium text-danger mb-1">
                                    Errors ({resource.validation.errors.length})
                                  </p>
                                  <ul className="text-sm text-foreground space-y-1">
                                    {resource.validation.errors.map((error, idx) => (
                                      <li key={idx} className="flex items-start gap-2">
                                        <span className="text-danger">×</span>
                                        <span>{error}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {resource.validation.warnings.length > 0 && (
                                <div>
                                  <p className="text-sm font-medium text-warning mb-1">
                                    Warnings ({resource.validation.warnings.length})
                                  </p>
                                  <ul className="text-sm text-foreground space-y-1">
                                    {resource.validation.warnings.map((warning, idx) => (
                                      <li key={idx} className="flex items-start gap-2">
                                        <span className="text-warning">!</span>
                                        <span>{warning}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {resource.validation.valid &&
                                resource.validation.errors.length === 0 &&
                                resource.validation.warnings.length === 0 && (
                                  <p className="text-sm text-success">
                                    All validation checks passed
                                  </p>
                                )}
                            </div>
                          ) : (
                            <p className="text-sm text-muted">
                              Validation pending. The operator will validate this resource shortly.
                            </p>
                          )}

                          {resource.syncedAt && (
                            <div className="mt-3 pt-3 border-t border-card-border text-sm text-muted">
                              Synced to cluster: {new Date(resource.syncedAt).toLocaleString()}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </AppShell>
  );
}
