"use client";

import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";
import { trpc } from "~/lib/trpc";

export default function OrganizationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const organizationId = params.id as string;

  const { data: org, isLoading, error } = trpc.admin.getOrganization.useQuery({
    organizationId,
  });

  if (isLoading) {
    return (
      <div className="py-8 text-center text-muted">Loading organization...</div>
    );
  }

  if (error !== null || !org) {
    return (
      <div className="py-8 text-center">
        <p className="text-red-500">Organization not found</p>
        <Button
          variant="secondary"
          className="mt-4"
          onClick={() => router.push("/admin/organizations")}
        >
          Back to Organizations
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
            onClick={() => router.push("/admin/organizations")}
            className="rounded-md p-2 text-muted hover:bg-card hover:text-foreground"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{org.name}</h1>
            <p className="mt-1 text-muted">{org.slug}</p>
          </div>
        </div>
        <Badge variant="success">Active</Badge>
      </div>

      {/* Stats Cards */}
      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-foreground">{org.users.length}</p>
              <p className="text-sm text-muted">Users</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-foreground">{org.clusters.length}</p>
              <p className="text-sm text-muted">Clusters</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-foreground">{org._count.policies}</p>
              <p className="text-sm text-muted">Policies</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Users Section */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Users</CardTitle>
        </CardHeader>
        <CardContent>
          {org.users.length === 0 ? (
            <p className="text-muted">No users in this organization</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-card-border text-left text-sm text-muted">
                    <th className="pb-3 font-medium">Name</th>
                    <th className="pb-3 font-medium">Email</th>
                    <th className="pb-3 font-medium">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {org.users.map((user) => (
                    <tr key={user.id} className="border-b border-card-border last:border-0">
                      <td className="py-3 text-foreground">{user.name ?? "—"}</td>
                      <td className="py-3 text-foreground">{user.email}</td>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <Badge variant={user.newRole === "ORG_ADMIN" ? "warning" : "default"}>
                            {user.newRole}
                          </Badge>
                          {user.isSuperAdmin && (
                            <Badge variant="danger">Super Admin</Badge>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Clusters Section */}
      <Card>
        <CardHeader>
          <CardTitle>Clusters</CardTitle>
        </CardHeader>
        <CardContent>
          {org.clusters.length === 0 ? (
            <p className="text-muted">No clusters registered</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-card-border text-left text-sm text-muted">
                    <th className="pb-3 font-medium">Name</th>
                    <th className="pb-3 font-medium">Provider</th>
                    <th className="pb-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {org.clusters.map((cluster) => (
                    <tr key={cluster.id} className="border-b border-card-border last:border-0">
                      <td className="py-3 text-foreground">{cluster.name}</td>
                      <td className="py-3 text-foreground">{cluster.provider ?? "—"}</td>
                      <td className="py-3">
                        <Badge
                          variant={
                            cluster.status === "CONNECTED"
                              ? "success"
                              : cluster.status === "PENDING"
                                ? "warning"
                                : "danger"
                          }
                        >
                          {cluster.status}
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
