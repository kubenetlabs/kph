"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";
import { trpc } from "~/lib/trpc";

export default function AdminOrganizationsPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const { data: orgsData, isLoading } = trpc.admin.listOrganizations.useQuery({
    search: search || undefined,
    limit: 50,
  });

  const organizations = orgsData?.organizations ?? [];

  return (
    <div>
      {/* Page Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Organizations</h1>
          <p className="mt-1 text-muted">
            Manage all organizations and tenants
          </p>
        </div>
        <Button onClick={() => router.push("/admin/organizations/new")}>
          <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Organization
        </Button>
      </div>

      {/* Search */}
      <Card className="mb-6">
        <CardContent className="pt-4">
          <input
            type="text"
            placeholder="Search organizations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-md rounded-md border border-card-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </CardContent>
      </Card>

      {/* Organizations Grid */}
      {isLoading ? (
        <div className="py-8 text-center text-muted">Loading organizations...</div>
      ) : organizations.length === 0 ? (
        <Card className="py-8 text-center">
          <p className="text-muted">No organizations found</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {organizations.map((org) => (
            <Card
              key={org.id}
              hover
              onClick={() => router.push(`/admin/organizations/${org.id}`)}
              className="cursor-pointer"
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base">{org.name}</CardTitle>
                    <p className="text-xs text-muted">{org.slug}</p>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/20 text-lg font-bold text-primary">
                    {org.name.charAt(0).toUpperCase()}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-2xl font-bold text-foreground">
                      {org._count.users}
                    </p>
                    <p className="text-xs text-muted">Users</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-foreground">
                      {org._count.clusters}
                    </p>
                    <p className="text-xs text-muted">Clusters</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-foreground">
                      {org._count.policies}
                    </p>
                    <p className="text-xs text-muted">Policies</p>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between text-xs text-muted">
                  <span>Created {formatDate(org.createdAt)}</span>
                  <Badge variant="success">Active</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
