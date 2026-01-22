"use client";

import { useRouter } from "next/navigation";
import MetricCard from "~/components/dashboard/metric-card";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";
import { trpc } from "~/lib/trpc";

export default function AdminDashboardPage() {
  const router = useRouter();
  const { data: stats, isLoading } = trpc.admin.getDashboardStats.useQuery();

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-muted">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div>
      {/* Page Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground">Admin Dashboard</h1>
          <Badge variant="warning">SuperAdmin</Badge>
        </div>
        <p className="mt-1 text-muted">
          Platform-wide overview and management
        </p>
      </div>

      {/* Metrics Grid */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Total Users"
          value={stats?.users.total ?? 0}
          detail={`${stats?.users.active ?? 0} active (7 days)`}
          icon={
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          }
        />
        <MetricCard
          label="Organizations"
          value={stats?.organizations.total ?? 0}
          detail="Active tenants"
          icon={
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          }
        />
        <MetricCard
          label="Connected Clusters"
          value={stats?.clusters.connected ?? 0}
          detail={`${stats?.clusters.total ?? 0} total registered`}
          icon={
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          }
        />
        <MetricCard
          label="Deployed Policies"
          value={stats?.policies.deployed ?? 0}
          detail={`${stats?.policies.total ?? 0} total policies`}
          icon={
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          }
        />
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent Activity */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Recent Activity</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => router.push("/admin/audit")}>
              View all
            </Button>
          </CardHeader>
          <CardContent>
            {!stats?.recentActivity?.length ? (
              <div className="py-4 text-center text-muted">No recent activity</div>
            ) : (
              <div className="space-y-3">
                {stats.recentActivity.map((activity) => (
                  <div
                    key={activity.id}
                    className="flex items-start justify-between border-b border-card-border pb-3 last:border-0 last:pb-0"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {formatAction(activity.action)}
                      </p>
                      <p className="text-xs text-muted">
                        {activity.userEmail ?? "System"}{" "}
                        {activity.resourceType && (
                          <span className="text-muted-foreground">
                            on {activity.resourceType}
                          </span>
                        )}
                      </p>
                    </div>
                    <span className="text-xs text-muted">
                      {formatTimeAgo(activity.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="secondary"
                className="justify-start"
                onClick={() => router.push("/admin/users")}
              >
                <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
                Manage Users
              </Button>
              <Button
                variant="secondary"
                className="justify-start"
                onClick={() => router.push("/admin/organizations/new")}
              >
                <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Organization
              </Button>
              <Button
                variant="secondary"
                className="justify-start"
                onClick={() => router.push("/admin/clusters")}
              >
                <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                View Clusters
              </Button>
              <Button
                variant="secondary"
                className="justify-start"
                onClick={() => router.push("/admin/settings")}
              >
                <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                System Settings
              </Button>
            </div>

            {/* System Health */}
            <div className="mt-6">
              <h3 className="mb-3 text-sm font-medium text-muted">System Health</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">Database</span>
                  <Badge variant="success">Healthy</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">API</span>
                  <Badge variant="success">Operational</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">Auth (Clerk)</span>
                  <Badge variant="success">Connected</Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function formatAction(action: string): string {
  const actionMap: Record<string, string> = {
    "user.login": "User logged in",
    "user.logout": "User logged out",
    "member.invited": "User invited",
    "member.joined": "User joined organization",
    "member.updated": "Member role updated",
    "member.removed": "Member removed",
    "cluster.created": "Cluster registered",
    "cluster.connected": "Cluster connected",
    "cluster.disconnected": "Cluster disconnected",
    "token.created": "Token created",
    "token.revoked": "Token revoked",
    "policy.created": "Policy created",
    "policy.deployed": "Policy deployed",
    "policy.rollback": "Policy rolled back",
    "org.created": "Organization created",
    "system.config.updated": "System config updated",
  };

  return actionMap[action] ?? action.replace(/\./g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}
