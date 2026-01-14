"use client";

import { useState } from "react";
import Link from "next/link";
import AppShell from "~/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import Badge from "~/components/ui/badge";
import Button from "~/components/ui/button";
import { trpc } from "~/lib/trpc";

// Import Modal Component
function ImportModal({
  isOpen,
  onClose,
  clusterId,
  onImportComplete,
}: {
  isOpen: boolean;
  onClose: () => void;
  clusterId: string;
  onImportComplete: () => void;
}) {
  const [yamlInput, setYamlInput] = useState("");
  const [step, setStep] = useState<"input" | "preview">("input");
  const [importing, setImporting] = useState<string | null>(null);
  const [imported, setImported] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const parseYaml = trpc.policy.parseGatewayYaml.useMutation();
  const importResource = trpc.policy.importGatewayResource.useMutation();

  const handleParse = async () => {
    setError(null);
    try {
      await parseYaml.mutateAsync({ yamlContent: yamlInput });
      setStep("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse YAML");
    }
  };

  const handleImport = async (resource: {
    name: string;
    namespace: string;
    kind: string;
    policyType: string;
    yaml: string;
  }) => {
    setImporting(resource.name);
    setError(null);
    try {
      await importResource.mutateAsync({
        clusterId,
        name: resource.name,
        namespace: resource.namespace,
        policyType: resource.policyType,
        yamlContent: resource.yaml,
      });
      setImported((prev) => new Set([...prev, resource.name]));
      onImportComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to import");
    } finally {
      setImporting(null);
    }
  };

  const handleClose = () => {
    setYamlInput("");
    setStep("input");
    setImported(new Set());
    setError(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />
      <div className="relative bg-background border border-border rounded-lg shadow-lg w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            Import Gateway Routes from Cluster
          </h2>
          <button onClick={handleClose} className="text-muted hover:text-foreground">
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {step === "input" && (
            <div className="space-y-4">
              <div className="p-4 bg-card rounded-lg border border-border">
                <p className="text-sm text-foreground mb-2">
                  Run this command in your terminal to get your Gateway routes:
                </p>
                <code className="block p-2 bg-background rounded text-sm text-primary font-mono">
                  kubectl get httproutes,grpcroutes -A -o yaml
                </code>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Paste the YAML output here:
                </label>
                <textarea
                  value={yamlInput}
                  onChange={(e) => setYamlInput(e.target.value)}
                  className="w-full h-64 p-3 rounded-lg border border-border bg-background text-foreground font-mono text-sm resize-none"
                  placeholder="apiVersion: gateway.networking.k8s.io/v1&#10;kind: HTTPRoute&#10;..."
                />
              </div>

              {error && (
                <div className="p-3 bg-danger/10 border border-danger/30 rounded-lg text-sm text-danger">
                  {error}
                </div>
              )}
            </div>
          )}

          {step === "preview" && parseYaml.data && (
            <div className="space-y-4">
              {parseYaml.data.discovered.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-muted">No Gateway API routes found in the YAML</p>
                  <Button variant="secondary" className="mt-4" onClick={() => setStep("input")}>
                    Go Back
                  </Button>
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted">
                    Found {parseYaml.data.discovered.length} Gateway route(s). Select which to import:
                  </p>

                  <div className="space-y-3">
                    {parseYaml.data.discovered.map((resource) => (
                      <div
                        key={`${resource.namespace}/${resource.name}`}
                        className="p-4 border border-border rounded-lg"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <Badge variant="gateway">{resource.kind}</Badge>
                              <span className="font-medium text-foreground">
                                {resource.name}
                              </span>
                              <span className="text-sm text-muted">
                                ({resource.namespace})
                              </span>
                            </div>
                            {resource.hostnames.length > 0 && (
                              <p className="text-sm text-muted mt-1">
                                Hosts: {resource.hostnames.join(", ")}
                              </p>
                            )}
                          </div>
                          <div>
                            {imported.has(resource.name) ? (
                              <Badge variant="success">Imported</Badge>
                            ) : (
                              <Button
                                size="sm"
                                onClick={() => handleImport(resource)}
                                disabled={importing !== null}
                              >
                                {importing === resource.name ? "Importing..." : "Import"}
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {error && (
                    <div className="p-3 bg-danger/10 border border-danger/30 rounded-lg text-sm text-danger">
                      {error}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex justify-between">
          {step === "input" ? (
            <>
              <Button variant="secondary" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleParse} disabled={!yamlInput.trim() || parseYaml.isPending}>
                {parseYaml.isPending ? "Parsing..." : "Parse YAML"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setStep("input")}>
                Back
              </Button>
              <Button onClick={handleClose}>
                Done
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

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
  const [showImportModal, setShowImportModal] = useState(false);

  // Fetch clusters
  const { data: clusters } = trpc.cluster.list.useQuery();
  const clusterList = clusters ?? [];

  // Auto-select first cluster
  if (!selectedClusterId && clusterList.length > 0 && clusterList[0]) {
    setSelectedClusterId(clusterList[0].id);
  }

  // Fetch validation status (now uses the consolidated policy router)
  const { data, isLoading, refetch } = trpc.policy.getGatewayValidationStatus.useQuery(
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
          {/* Import button */}
          <Button variant="secondary" onClick={() => setShowImportModal(true)} disabled={!selectedClusterId}>
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
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
            Import from Cluster
          </Button>

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

      {/* Import Modal */}
      <ImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        clusterId={selectedClusterId}
        onImportComplete={() => refetch()}
      />
    </AppShell>
  );
}
