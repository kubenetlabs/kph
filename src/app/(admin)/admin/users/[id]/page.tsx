"use client";

import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";
import { trpc } from "~/lib/trpc";

export default function UserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const userId = params.id as string;

  const { data: user, isLoading, error } = trpc.admin.getUser.useQuery({
    userId,
  });

  if (isLoading) {
    return (
      <div className="py-8 text-center text-muted">Loading user...</div>
    );
  }

  if (error !== null || !user) {
    return (
      <div className="py-8 text-center">
        <p className="text-danger">User not found</p>
        <Button
          variant="secondary"
          className="mt-4"
          onClick={() => router.push("/admin/users")}
        >
          Back to Users
        </Button>
      </div>
    );
  }

  return (
    <div>
      {/* Page Header */}
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/admin/users")}
            className="rounded-md p-2 text-muted hover:bg-card hover:text-foreground"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{user.name ?? user.email}</h1>
            <p className="mt-1 text-muted">{user.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={user.newRole === "ORG_ADMIN" ? "warning" : "default"}>
            {formatRole(user.newRole)}
          </Badge>
          {user.isSuperAdmin && (
            <Badge variant="danger">Super Admin</Badge>
          )}
        </div>
      </div>

      {/* User Info */}
      <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>User Information</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-4">
              <div>
                <dt className="text-sm text-muted">Name</dt>
                <dd className="text-foreground">{user.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Email</dt>
                <dd className="text-foreground">{user.email}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Role</dt>
                <dd className="text-foreground">{formatRole(user.newRole)}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">User ID</dt>
                <dd className="font-mono text-sm text-foreground">{user.id}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Organization</CardTitle>
          </CardHeader>
          <CardContent>
            {user.organization ? (
              <dl className="space-y-4">
                <div>
                  <dt className="text-sm text-muted">Name</dt>
                  <dd className="text-foreground">{user.organization.name}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted">Slug</dt>
                  <dd className="font-mono text-sm text-foreground">{user.organization.slug}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted">Organization ID</dt>
                  <dd className="font-mono text-sm text-foreground">{user.organization.id}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-muted">No organization assigned</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Cluster Assignments */}
      <Card>
        <CardHeader>
          <CardTitle>Cluster Assignments</CardTitle>
        </CardHeader>
        <CardContent>
          {user.clusterAssignments.length === 0 ? (
            <p className="text-muted">No cluster assignments</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-card-border text-left text-sm text-muted">
                    <th className="pb-3 font-medium">Cluster</th>
                    <th className="pb-3 font-medium">Role</th>
                    <th className="pb-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {user.clusterAssignments.map((assignment) => (
                    <tr key={assignment.id} className="border-b border-card-border last:border-0">
                      <td className="py-3 text-foreground">{assignment.cluster.name}</td>
                      <td className="py-3">
                        <Badge variant="default">{assignment.role}</Badge>
                      </td>
                      <td className="py-3">
                        <Badge
                          variant={
                            assignment.cluster.status === "CONNECTED"
                              ? "success"
                              : assignment.cluster.status === "PENDING"
                                ? "warning"
                                : "danger"
                          }
                        >
                          {assignment.cluster.status}
                        </Badge>
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
