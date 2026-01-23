"use client";

import { useState } from "react";
import AppShell from "~/components/layout/app-shell";
import { Card } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";
import Modal from "~/components/ui/modal";
import PolicyForm from "~/components/policies/policy-form";
import { Spinner } from "~/components/ui/spinner";
import { Pagination } from "~/components/ui/pagination";
import { QueryErrorState } from "~/components/ui/error-state";
import { trpc } from "~/lib/trpc";

type PolicyType =
  | "CILIUM_NETWORK"
  | "CILIUM_CLUSTERWIDE"
  | "TETRAGON"
  | "GATEWAY_HTTPROUTE"
  | "GATEWAY_GRPCROUTE"
  | "GATEWAY_TCPROUTE"
  | "GATEWAY_TLSROUTE";

type PolicyStatus =
  | "DRAFT"
  | "SIMULATING"
  | "PENDING"
  | "DEPLOYED"
  | "FAILED"
  | "ARCHIVED";

const typeConfig: Record<PolicyType, { variant: "cilium" | "tetragon" | "gateway"; label: string }> = {
  CILIUM_NETWORK: { variant: "cilium", label: "Cilium Network" },
  CILIUM_CLUSTERWIDE: { variant: "cilium", label: "Cilium Clusterwide" },
  TETRAGON: { variant: "tetragon", label: "Tetragon" },
  GATEWAY_HTTPROUTE: { variant: "gateway", label: "Gateway HTTP" },
  GATEWAY_GRPCROUTE: { variant: "gateway", label: "Gateway gRPC" },
  GATEWAY_TCPROUTE: { variant: "gateway", label: "Gateway TCP" },
  GATEWAY_TLSROUTE: { variant: "gateway", label: "Gateway TLS" },
};

const statusConfig: Record<PolicyStatus, { variant: "muted" | "accent" | "warning" | "success" | "danger"; label: string }> = {
  DRAFT: { variant: "muted", label: "Draft" },
  SIMULATING: { variant: "accent", label: "Simulating" },
  PENDING: { variant: "warning", label: "Pending" },
  DEPLOYED: { variant: "success", label: "Deployed" },
  FAILED: { variant: "danger", label: "Failed" },
  ARCHIVED: { variant: "muted", label: "Archived" },
};

const PAGE_SIZE = 12;

export default function PoliciesPage() {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [filterType, setFilterType] = useState<PolicyType | "">("");
  const [filterStatus, setFilterStatus] = useState<PolicyStatus | "">("");

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  // Pagination state - store cursors for each page to enable going back
  const [page, setPage] = useState(1);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);

  const utils = trpc.useUtils();

  // Get the cursor for the current page
  const currentCursor = cursors[page - 1];

  // Fetch policies with filters and pagination
  const { data, isLoading, error, refetch } = trpc.policy.list.useQuery({
    ...(filterType && { type: filterType }),
    ...(filterStatus && { status: filterStatus }),
    ...(searchQuery && { search: searchQuery }),
    limit: PAGE_SIZE,
    cursor: currentCursor,
  });

  // Reset pagination when filters change
  const handleFilterChange = <T,>(setter: React.Dispatch<React.SetStateAction<T>>, value: T) => {
    setter(value);
    setPage(1);
    setCursors([undefined]);
  };

  // Fetch stats
  const { data: stats } = trpc.policy.getStats.useQuery();

  // Create mutation
  const createMutation = trpc.policy.create.useMutation({
    onSuccess: () => {
      void utils.policy.list.invalidate();
      void utils.policy.getStats.invalidate();
      setIsCreateModalOpen(false);
    },
  });

  // Delete mutation
  const deleteMutation = trpc.policy.delete.useMutation({
    onSuccess: () => {
      void utils.policy.list.invalidate();
      void utils.policy.getStats.invalidate();
    },
  });

  // Deploy mutation
  const deployMutation = trpc.policy.deploy.useMutation({
    onSuccess: () => {
      void utils.policy.list.invalidate();
      void utils.policy.getStats.invalidate();
    },
  });

  // Archive mutation
  const archiveMutation = trpc.policy.archive.useMutation({
    onSuccess: () => {
      void utils.policy.list.invalidate();
      void utils.policy.getStats.invalidate();
    },
  });

  const policies = data?.policies ?? [];
  const hasNextPage = !!data?.nextCursor;
  const hasPrevPage = page > 1;

  // Handle page navigation
  const handlePageChange = (newPage: number) => {
    if (newPage > page && data?.nextCursor) {
      // Going forward - store the next cursor
      setCursors((prev) => {
        const updated = [...prev];
        updated[newPage - 1] = data.nextCursor;
        return updated;
      });
    }
    setPage(newPage);
  };

  const handleCreatePolicy = (formData: {
    name: string;
    description?: string;
    type: PolicyType;
    clusterId: string;
    content: string;
    targetNamespaces: string[];
  }) => {
    createMutation.mutate(formData);
  };

  const handleDelete = (id: string, name: string) => {
    if (confirm(`Are you sure you want to delete "${name}"? This action cannot be undone.`)) {
      deleteMutation.mutate({ id });
    }
  };

  const handleDeploy = (id: string) => {
    deployMutation.mutate({ id });
  };

  const handleArchive = (id: string) => {
    archiveMutation.mutate({ id });
  };

  // Bulk selection handlers
  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === policies.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(policies.map((p) => p.id)));
    }
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  // Bulk actions
  const handleBulkDeploy = async () => {
    const deployablePolicies = policies.filter(
      (p) => selectedIds.has(p.id) && p.status === "DRAFT"
    );
    for (const policy of deployablePolicies) {
      await deployMutation.mutateAsync({ id: policy.id });
    }
    clearSelection();
  };

  const handleBulkArchive = async () => {
    const archivablePolicies = policies.filter(
      (p) => selectedIds.has(p.id) && p.status === "DEPLOYED"
    );
    for (const policy of archivablePolicies) {
      await archiveMutation.mutateAsync({ id: policy.id });
    }
    clearSelection();
  };

  const handleBulkDelete = async () => {
    const deletablePolicies = policies.filter(
      (p) => selectedIds.has(p.id) && p.status !== "DEPLOYED"
    );
    if (
      !confirm(
        `Are you sure you want to delete ${deletablePolicies.length} policies? This action cannot be undone.`
      )
    ) {
      return;
    }
    for (const policy of deletablePolicies) {
      await deleteMutation.mutateAsync({ id: policy.id });
    }
    clearSelection();
  };

  // Get counts for bulk action eligibility
  const selectedPolicies = policies.filter((p) => selectedIds.has(p.id));
  const deployableCount = selectedPolicies.filter((p) => p.status === "DRAFT").length;
  const archivableCount = selectedPolicies.filter((p) => p.status === "DEPLOYED").length;
  const deletableCount = selectedPolicies.filter((p) => p.status !== "DEPLOYED").length;

  return (
    <AppShell>
      {/* Page Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Policies</h1>
          <p className="mt-1 text-muted">
            Create and manage network, runtime, and ingress policies
          </p>
        </div>
        <div className="flex gap-3">
          <a href="/policies/generate">
            <Button variant="secondary">
              <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Generate with AI
            </Button>
          </a>
          <Button onClick={() => setIsCreateModalOpen(true)}>
            <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Policy
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-4 gap-4">
        <Card className="text-center">
          <p className="text-2xl font-bold text-foreground">{stats?.total ?? 0}</p>
          <p className="text-sm text-muted">Total Policies</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-success">{stats?.deployed ?? 0}</p>
          <p className="text-sm text-muted">Deployed</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-accent-light">{stats?.simulating ?? 0}</p>
          <p className="text-sm text-muted">Simulating</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-muted">{stats?.drafts ?? 0}</p>
          <p className="text-sm text-muted">Drafts</p>
        </Card>
      </div>

      {/* Filters */}
      <div className="mb-6 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">Filter:</span>
          <select
            value={filterType}
            onChange={(e) => handleFilterChange(setFilterType, e.target.value as PolicyType | "")}
            className="rounded-md border border-card-border bg-card px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="" className="bg-card text-foreground">All Types</option>
            {Object.entries(typeConfig).map(([value, { label }]) => (
              <option key={value} value={value} className="bg-card text-foreground">
                {label}
              </option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => handleFilterChange(setFilterStatus, e.target.value as PolicyStatus | "")}
            className="rounded-md border border-card-border bg-card px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="" className="bg-card text-foreground">All Statuses</option>
            {Object.entries(statusConfig).map(([value, { label }]) => (
              <option key={value} value={value} className="bg-card text-foreground">
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1" />
        <div className="relative">
          <input
            type="text"
            placeholder="Search policies..."
            value={searchQuery}
            onChange={(e) => handleFilterChange(setSearchQuery, e.target.value)}
            className="w-64 rounded-md border border-card-border bg-card px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {selectedIds.size > 0 && (
        <div className="mb-6 flex items-center gap-4 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={selectedIds.size === policies.length}
              onChange={selectAll}
              className="h-4 w-4 rounded border-card-border text-primary focus:ring-primary"
              aria-label="Select all policies"
            />
            <span className="text-sm font-medium text-foreground">
              {selectedIds.size} selected
            </span>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            {deployableCount > 0 && (
              <Button
                variant="primary"
                size="sm"
                onClick={handleBulkDeploy}
                disabled={deployMutation.isPending}
              >
                Deploy ({deployableCount})
              </Button>
            )}
            {archivableCount > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleBulkArchive}
                disabled={archiveMutation.isPending}
              >
                Archive ({archivableCount})
              </Button>
            )}
            {deletableCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBulkDelete}
                disabled={deleteMutation.isPending}
                className="text-danger hover:text-danger"
              >
                Delete ({deletableCount})
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={clearSelection}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Spinner size="lg" />
        </div>
      )}

      {/* Error State */}
      {error && (
        <Card>
          <QueryErrorState error={error} refetch={() => refetch()} />
        </Card>
      )}

      {/* Empty State */}
      {!isLoading && !error && policies.length === 0 && (
        <div className="rounded-lg border border-card-border bg-card p-12 text-center">
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
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <h3 className="mt-4 text-lg font-semibold text-foreground">No policies found</h3>
          <p className="mt-2 text-sm text-muted">
            {searchQuery || filterType || filterStatus
              ? "Try adjusting your filters"
              : "Get started by creating your first policy"}
          </p>
          {!searchQuery && !filterType && !filterStatus && (
            <Button className="mt-4" onClick={() => setIsCreateModalOpen(true)}>
              Create Policy
            </Button>
          )}
        </div>
      )}

      {/* Policies Grid */}
      {!isLoading && !error && policies.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {policies.map((policy) => {
              const type = typeConfig[policy.type as PolicyType];
              const status = statusConfig[policy.status as PolicyStatus];

              const isSelected = selectedIds.has(policy.id);

              return (
                <Card key={policy.id} hover className={`relative ${isSelected ? "ring-2 ring-primary" : ""}`}>
                  {/* Selection checkbox */}
                  <div className="absolute right-4 top-4 z-10">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelection(policy.id)}
                      className="h-4 w-4 rounded border-card-border text-primary focus:ring-primary"
                      aria-label={`Select ${policy.name}`}
                    />
                  </div>

                  {/* Type indicator */}
                  <div
                    className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-lg ${
                      policy.type.startsWith("CILIUM")
                        ? "bg-cilium"
                        : policy.type === "TETRAGON"
                        ? "bg-tetragon"
                        : "bg-gateway"
                    }`}
                  />

                  <div className="pl-2">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-foreground truncate">
                          {policy.name}
                        </h3>
                        <p className="mt-1 text-sm text-muted line-clamp-2">
                          {policy.description ?? "No description"}
                        </p>
                      </div>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Badge variant={type.variant}>{type.label}</Badge>
                      {policy.targetNamespaces.length > 0 && (
                        <Badge variant="muted">
                          {policy.targetNamespaces.length} namespace
                          {policy.targetNamespaces.length > 1 ? "s" : ""}
                        </Badge>
                      )}
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t border-card-border pt-3">
                      <div className="text-xs text-muted">
                        <span className="text-foreground">{policy.cluster.name}</span>
                        {policy.deployedAt && (
                          <>
                            <span className="mx-1">•</span>
                            <span>
                              Deployed{" "}
                              {new Date(policy.deployedAt).toLocaleDateString()}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="flex gap-1">
                        {policy.status === "DRAFT" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeploy(policy.id)}
                            disabled={deployMutation.isPending}
                          >
                            Deploy
                          </Button>
                        )}
                        {policy.status === "DEPLOYED" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleArchive(policy.id)}
                            disabled={archiveMutation.isPending}
                          >
                            Archive
                          </Button>
                        )}
                        {policy.status !== "DEPLOYED" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(policy.id, policy.name)}
                            disabled={deleteMutation.isPending}
                            className="text-danger hover:text-danger"
                          >
                            Delete
                          </Button>
                        )}
                        <a href={`/policies/${policy.id}`}>
                          <Button variant="ghost" size="sm">
                            View →
                          </Button>
                        </a>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Pagination */}
          {(hasNextPage || hasPrevPage) && (
            <div className="mt-6 rounded-lg border border-card-border bg-card">
              <Pagination
                page={page}
                hasNextPage={hasNextPage}
                hasPrevPage={hasPrevPage}
                onPageChange={handlePageChange}
                pageSize={PAGE_SIZE}
              />
            </div>
          )}
        </>
      )}

      {/* Create Policy Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Create New Policy"
        description="Define a new network, runtime, or ingress policy"
        size="2xl"
      >
        <PolicyForm
          mode="create"
          onSubmit={handleCreatePolicy}
          onCancel={() => setIsCreateModalOpen(false)}
          isLoading={createMutation.isPending}
        />
        {createMutation.error && (
          <p className="mt-4 text-sm text-danger">
            {createMutation.error.message}
          </p>
        )}
      </Modal>
    </AppShell>
  );
}
