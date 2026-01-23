"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";
import { trpc } from "~/lib/trpc";

export default function AdminUsersPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [selectedOrg, setSelectedOrg] = useState<string | undefined>();

  const { data: usersData, isLoading } = trpc.admin.listUsers.useQuery({
    search: search || undefined,
    organizationId: selectedOrg,
    limit: 50,
  });

  const { data: orgsData } = trpc.admin.listOrganizations.useQuery({ limit: 100 });

  const users = usersData?.users ?? [];
  const organizations = orgsData?.organizations ?? [];

  return (
    <div>
      {/* Page Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Users</h1>
          <p className="mt-1 text-muted">
            Manage all users across the platform
          </p>
        </div>
        <Button onClick={() => router.push("/admin/users/invite")}>
          <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Invite User
        </Button>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[200px]">
              <input
                type="text"
                placeholder="Search by name or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md border border-card-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <select
              value={selectedOrg ?? ""}
              onChange={(e) => setSelectedOrg(e.target.value || undefined)}
              className="rounded-md border border-card-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="" className="bg-card text-foreground">All Organizations</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id} className="bg-card text-foreground">
                  {org.name}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            {users.length} User{users.length !== 1 ? "s" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-muted">Loading users...</div>
          ) : users.length === 0 ? (
            <div className="py-8 text-center text-muted">No users found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-card-border text-left">
                    <th className="pb-3 text-xs font-medium uppercase tracking-wider text-muted">
                      User
                    </th>
                    <th className="pb-3 text-xs font-medium uppercase tracking-wider text-muted">
                      Organization
                    </th>
                    <th className="pb-3 text-xs font-medium uppercase tracking-wider text-muted">
                      Role
                    </th>
                    <th className="pb-3 text-xs font-medium uppercase tracking-wider text-muted">
                      Status
                    </th>
                    <th className="pb-3 text-xs font-medium uppercase tracking-wider text-muted">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border">
                  {users.map((user) => (
                    <tr key={user.id} className="hover:bg-card-hover">
                      <td className="py-4">
                        <div className="flex items-center gap-3">
                          {user.image ? (
                            <img
                              src={user.image}
                              alt={user.name ?? "User"}
                              className="h-8 w-8 rounded-full"
                            />
                          ) : (
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-sm font-medium text-primary">
                              {(user.name ?? user.email).charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <p className="font-medium text-foreground">
                              {user.name ?? "Unnamed"}
                            </p>
                            <p className="text-xs text-muted">{user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-4">
                        {user.organization ? (
                          <span className="text-sm text-foreground">
                            {user.organization.name}
                          </span>
                        ) : (
                          <span className="text-sm text-muted">No organization</span>
                        )}
                      </td>
                      <td className="py-4">
                        <div className="flex flex-wrap gap-1">
                          {user.isSuperAdmin && (
                            <Badge variant="warning">SuperAdmin</Badge>
                          )}
                          <Badge variant="muted">
                            {formatRole(user.newRole)}
                          </Badge>
                        </div>
                      </td>
                      <td className="py-4">
                        <Badge variant="success">Active</Badge>
                      </td>
                      <td className="py-4">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => router.push(`/admin/users/${user.id}`)}
                        >
                          View
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
