"use client";

import { useState } from "react";
import Link from "next/link";
import AppShell from "~/components/layout/app-shell";
import { Card } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";
import { trpc } from "~/lib/trpc";

type PolicyType =
  | "CILIUM_NETWORK"
  | "CILIUM_CLUSTERWIDE"
  | "TETRAGON"
  | "GATEWAY_HTTPROUTE"
  | "GATEWAY_GRPCROUTE"
  | "GATEWAY_TCPROUTE"
  | "GATEWAY_TLSROUTE";

const typeConfig: Record<PolicyType, { variant: "cilium" | "tetragon" | "gateway"; label: string }> = {
  CILIUM_NETWORK: { variant: "cilium", label: "Cilium Network" },
  CILIUM_CLUSTERWIDE: { variant: "cilium", label: "Cilium Clusterwide" },
  TETRAGON: { variant: "tetragon", label: "Tetragon" },
  GATEWAY_HTTPROUTE: { variant: "gateway", label: "Gateway HTTP" },
  GATEWAY_GRPCROUTE: { variant: "gateway", label: "Gateway gRPC" },
  GATEWAY_TCPROUTE: { variant: "gateway", label: "Gateway TCP" },
  GATEWAY_TLSROUTE: { variant: "gateway", label: "Gateway TLS" },
};

export default function TemplatesPage() {
  const [filterType, setFilterType] = useState<PolicyType | "">("");
  const [searchQuery, setSearchQuery] = useState("");

  const utils = trpc.useUtils();

  // Fetch templates with filters
  const { data, isLoading, error } = trpc.template.list.useQuery({
    ...(filterType && { type: filterType }),
    ...(searchQuery && { search: searchQuery }),
  });

  // Fetch stats
  const { data: stats } = trpc.template.getStats.useQuery();

  // Delete mutation
  const deleteMutation = trpc.template.delete.useMutation({
    onSuccess: () => {
      void utils.template.list.invalidate();
      void utils.template.getStats.invalidate();
    },
  });

  const templates = data?.templates ?? [];

  const handleDelete = (id: string, name: string) => {
    if (confirm(`Are you sure you want to delete "${name}"? Linked policies will become standalone.`)) {
      deleteMutation.mutate({ id });
    }
  };

  return (
    <AppShell>
      {/* Page Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Policy Templates</h1>
          <p className="mt-1 text-muted">
            Create reusable templates and sync them across multiple clusters
          </p>
        </div>
        <Link href="/templates/new">
          <Button>
            <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Template
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-4 gap-4">
        <Card className="text-center">
          <p className="text-2xl font-bold text-foreground">{stats?.total ?? 0}</p>
          <p className="text-sm text-muted">Total Templates</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-primary">{stats?.linkedPolicies ?? 0}</p>
          <p className="text-sm text-muted">Linked Policies</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-accent-light">{stats?.recentSyncs ?? 0}</p>
          <p className="text-sm text-muted">Syncs (24h)</p>
        </Card>
        <Card className="text-center">
          <p className="text-2xl font-bold text-muted">
            {Object.keys(stats?.byType ?? {}).length}
          </p>
          <p className="text-sm text-muted">Policy Types</p>
        </Card>
      </div>

      {/* Filters */}
      <div className="mb-6 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">Filter:</span>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as PolicyType | "")}
            className="rounded-md border border-card-border bg-card px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">All Types</option>
            {Object.entries(typeConfig).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1" />
        <div className="relative">
          <input
            type="text"
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-64 rounded-md border border-card-border bg-card px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-4">
          <p className="text-sm text-danger">
            Failed to load templates: {error.message}
          </p>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && templates.length === 0 && (
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
              d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"
            />
          </svg>
          <h3 className="mt-4 text-lg font-semibold text-foreground">No templates found</h3>
          <p className="mt-2 text-sm text-muted">
            {searchQuery || filterType
              ? "Try adjusting your filters"
              : "Create a template to sync policies across multiple clusters"}
          </p>
          {!searchQuery && !filterType && (
            <Link href="/templates/new">
              <Button className="mt-4">Create Template</Button>
            </Link>
          )}
        </div>
      )}

      {/* Templates Grid */}
      {!isLoading && !error && templates.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => {
            const type = typeConfig[template.type as PolicyType];

            return (
              <Card key={template.id} hover className="relative">
                {/* Type indicator */}
                <div
                  className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-lg ${
                    template.type.startsWith("CILIUM")
                      ? "bg-cilium"
                      : template.type === "TETRAGON"
                      ? "bg-tetragon"
                      : "bg-gateway"
                  }`}
                />

                <div className="pl-2">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-foreground truncate">
                        {template.name}
                      </h3>
                      <p className="mt-1 text-sm text-muted line-clamp-2">
                        {template.description ?? "No description"}
                      </p>
                    </div>
                    <Badge variant="muted">v{template.currentVersion}</Badge>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge variant={type.variant}>{type.label}</Badge>
                    <Badge variant="accent">
                      {template._count.policies} cluster{template._count.policies !== 1 ? "s" : ""}
                    </Badge>
                    {template._count.syncOperations > 0 && (
                      <Badge variant="muted">
                        {template._count.syncOperations} sync{template._count.syncOperations !== 1 ? "s" : ""}
                      </Badge>
                    )}
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-card-border pt-3">
                    <div className="text-xs text-muted">
                      <span>Created by {template.createdBy.name ?? template.createdBy.email}</span>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(template.id, template.name)}
                        disabled={deleteMutation.isPending}
                        className="text-danger hover:text-danger"
                      >
                        Delete
                      </Button>
                      <Link href={`/templates/${template.id}`}>
                        <Button variant="ghost" size="sm">
                          View
                        </Button>
                      </Link>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
