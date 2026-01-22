"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";
import { trpc } from "~/lib/trpc";

const actionConfig: Record<string, { variant: "success" | "warning" | "danger" | "muted" | "accent"; label: string }> = {
  "user.login": { variant: "muted", label: "Login" },
  "user.logout": { variant: "muted", label: "Logout" },
  "member.invited": { variant: "accent", label: "Invite" },
  "member.joined": { variant: "success", label: "Joined" },
  "member.updated": { variant: "warning", label: "Updated" },
  "member.removed": { variant: "danger", label: "Removed" },
  "cluster.created": { variant: "success", label: "Created" },
  "cluster.connected": { variant: "success", label: "Connected" },
  "cluster.disconnected": { variant: "warning", label: "Disconnected" },
  "token.created": { variant: "accent", label: "Token Created" },
  "token.revoked": { variant: "danger", label: "Token Revoked" },
  "policy.created": { variant: "success", label: "Created" },
  "policy.deployed": { variant: "success", label: "Deployed" },
  "policy.rollback": { variant: "warning", label: "Rollback" },
  "org.created": { variant: "success", label: "Org Created" },
  "system.config.updated": { variant: "warning", label: "Config Updated" },
};

export default function AdminAuditPage() {
  const [selectedOrg, setSelectedOrg] = useState<string | undefined>();
  const [selectedAction, setSelectedAction] = useState<string | undefined>();

  const { data: logsData, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    trpc.admin.getAuditLogs.useInfiniteQuery(
      {
        limit: 50,
        organizationId: selectedOrg,
        action: selectedAction,
      },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      }
    );

  const { data: orgsData } = trpc.admin.listOrganizations.useQuery({ limit: 100 });

  const logs = logsData?.pages.flatMap((page) => page.logs) ?? [];
  const organizations = orgsData?.organizations ?? [];

  const uniqueActions = Array.from(
    new Set(logs.map((log) => log.action))
  ).sort();

  return (
    <div>
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Audit Logs</h1>
        <p className="mt-1 text-muted">
          View all platform activity and security events
        </p>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-center gap-4">
            <select
              value={selectedOrg ?? ""}
              onChange={(e) => setSelectedOrg(e.target.value || undefined)}
              className="rounded-md border border-card-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">All Organizations</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
            <select
              value={selectedAction ?? ""}
              onChange={(e) => setSelectedAction(e.target.value || undefined)}
              className="rounded-md border border-card-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">All Actions</option>
              {uniqueActions.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Audit Logs Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            {logs.length} Log{logs.length !== 1 ? "s" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-12 text-center text-muted">Loading audit logs...</div>
          ) : logs.length === 0 ? (
            <div className="py-12 text-center text-muted">No audit logs found</div>
          ) : (
            <>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-card-border">
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                      Timestamp
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                      Action
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                      User
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                      Organization
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                      Resource
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border">
                  {logs.map((log) => {
                    const actionInfo = actionConfig[log.action] ?? {
                      variant: "muted" as const,
                      label: log.action,
                    };

                    return (
                      <tr key={log.id} className="hover:bg-card-hover transition-colors">
                        <td className="px-4 py-4">
                          <div>
                            <p className="text-sm text-foreground">
                              {new Date(log.timestamp).toLocaleDateString()}
                            </p>
                            <p className="text-xs text-muted">
                              {new Date(log.timestamp).toLocaleTimeString()}
                            </p>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <Badge variant={actionInfo.variant}>{actionInfo.label}</Badge>
                        </td>
                        <td className="px-4 py-4">
                          <p className="text-sm text-foreground">
                            {log.user?.name ?? log.user?.email ?? "System"}
                          </p>
                          {log.user?.email && log.user.name && (
                            <p className="text-xs text-muted">{log.user.email}</p>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <p className="text-sm text-foreground">
                            {log.organization?.name ?? "—"}
                          </p>
                        </td>
                        <td className="px-4 py-4">
                          <p className="text-sm text-muted font-mono">
                            {log.resourceType ?? log.resource ?? "—"}
                          </p>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {hasNextPage && (
                <div className="border-t border-card-border p-4 text-center">
                  <Button
                    variant="secondary"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                  >
                    {isFetchingNextPage ? "Loading..." : "Load More"}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
