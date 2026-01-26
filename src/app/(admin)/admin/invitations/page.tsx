"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";
import { trpc } from "~/lib/trpc";

type InvitationStatus = "pending" | "accepted" | "expired" | "all";

export default function AdminInvitationsPage() {
  const [statusFilter, setStatusFilter] = useState<InvitationStatus>("all");

  const { data, isLoading, error } = trpc.admin.listAllInvitations.useQuery({
    status: statusFilter,
    limit: 50,
  });

  const invitations = data?.invitations ?? [];

  // Count by status
  const { data: pendingData } = trpc.admin.listAllInvitations.useQuery({ status: "pending", limit: 1 });
  const { data: acceptedData } = trpc.admin.listAllInvitations.useQuery({ status: "accepted", limit: 1 });
  const { data: expiredData } = trpc.admin.listAllInvitations.useQuery({ status: "expired", limit: 1 });

  return (
    <div>
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">All Invitations</h1>
        <p className="mt-1 text-muted">
          View and manage invitations across all organizations
        </p>
      </div>

      {/* Stats Cards */}
      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card
          className={`cursor-pointer transition-colors ${statusFilter === "all" ? "ring-2 ring-primary" : "hover:bg-card-hover"}`}
          onClick={() => setStatusFilter("all")}
        >
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-foreground">
                {(pendingData?.invitations.length ?? 0) + (acceptedData?.invitations.length ?? 0) + (expiredData?.invitations.length ?? 0) > 0 ? "..." : invitations.length}
              </p>
              <p className="text-sm text-muted">All</p>
            </div>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-colors ${statusFilter === "pending" ? "ring-2 ring-primary" : "hover:bg-card-hover"}`}
          onClick={() => setStatusFilter("pending")}
        >
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-yellow-400">
                {pendingData?.invitations.length ?? "..."}
              </p>
              <p className="text-sm text-muted">Pending</p>
            </div>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-colors ${statusFilter === "accepted" ? "ring-2 ring-primary" : "hover:bg-card-hover"}`}
          onClick={() => setStatusFilter("accepted")}
        >
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-green-400">
                {acceptedData?.invitations.length ?? "..."}
              </p>
              <p className="text-sm text-muted">Accepted</p>
            </div>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-colors ${statusFilter === "expired" ? "ring-2 ring-primary" : "hover:bg-card-hover"}`}
          onClick={() => setStatusFilter("expired")}
        >
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-red-400">
                {expiredData?.invitations.length ?? "..."}
              </p>
              <p className="text-sm text-muted">Expired</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Invitations Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            {statusFilter === "all" ? "All" : statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)} Invitations
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-muted">Loading invitations...</div>
          ) : error ? (
            <div className="py-8 text-center text-red-400">
              Error loading invitations: {error.message}
            </div>
          ) : invitations.length === 0 ? (
            <div className="py-8 text-center text-muted">
              No {statusFilter === "all" ? "" : statusFilter} invitations found
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-card-border text-left text-sm text-muted">
                    <th className="pb-3 font-medium">Email</th>
                    <th className="pb-3 font-medium">Organization</th>
                    <th className="pb-3 font-medium">Role</th>
                    <th className="pb-3 font-medium">Invited By</th>
                    <th className="pb-3 font-medium">Status</th>
                    <th className="pb-3 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {invitations.map((invitation) => (
                    <tr
                      key={invitation.id}
                      className="border-b border-card-border last:border-0"
                    >
                      <td className="py-3 text-foreground">{invitation.email}</td>
                      <td className="py-3">
                        <div>
                          <span className="text-foreground">{invitation.organization.name}</span>
                          <span className="ml-2 text-xs text-muted">({invitation.organization.slug})</span>
                        </div>
                      </td>
                      <td className="py-3">
                        <Badge variant={invitation.role === "ORG_ADMIN" ? "warning" : "default"}>
                          {formatRole(invitation.role)}
                        </Badge>
                      </td>
                      <td className="py-3 text-muted">
                        {invitation.invitedBy.name ?? invitation.invitedBy.email}
                      </td>
                      <td className="py-3">
                        <Badge
                          variant={
                            invitation.status === "accepted"
                              ? "success"
                              : invitation.status === "expired"
                                ? "danger"
                                : "warning"
                          }
                        >
                          {invitation.status}
                        </Badge>
                      </td>
                      <td className="py-3 text-sm text-muted">
                        {invitation.status === "accepted" && invitation.acceptedAt
                          ? `Accepted ${formatDate(invitation.acceptedAt)}`
                          : invitation.status === "expired"
                            ? `Expired ${formatDate(invitation.expiresAt)}`
                            : `Expires ${formatDate(invitation.expiresAt)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data?.nextCursor && (
            <div className="mt-4 text-center">
              <Button variant="secondary" size="sm">
                Load More
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatRole(role: string): string {
  const roleMap: Record<string, string> = {
    ORG_ADMIN: "Org Admin",
    CLUSTER_ADMIN: "Cluster Admin",
    POLICY_EDITOR: "Policy Editor",
    VIEWER: "Viewer",
  };
  return roleMap[role] ?? role;
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
