"use client";

import { useState } from "react";
import AppShell from "~/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";
import { trpc } from "~/lib/trpc";

export default function TeamSettingsPage() {
  const utils = trpc.useUtils();
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"ORG_ADMIN" | "CLUSTER_ADMIN" | "POLICY_EDITOR" | "VIEWER">("VIEWER");
  const [activeTab, setActiveTab] = useState<"members" | "invitations">("members");

  // Fetch team members (users in the organization)
  const { data: usersData } = trpc.admin.listUsers.useQuery(
    { limit: 100 },
    { enabled: false } // We'll use a different query for org members
  );

  // Fetch invitations
  const { data: invitationsData, isLoading: invitationsLoading } = trpc.invitation.list.useQuery({
    status: "all",
    limit: 50,
  });

  const createInvitation = trpc.invitation.create.useMutation({
    onSuccess: () => {
      setShowInviteForm(false);
      setInviteEmail("");
      setInviteRole("VIEWER");
      void utils.invitation.list.invalidate();
    },
  });

  const resendInvitation = trpc.invitation.resend.useMutation({
    onSuccess: () => {
      void utils.invitation.list.invalidate();
    },
  });

  const revokeInvitation = trpc.invitation.revoke.useMutation({
    onSuccess: () => {
      void utils.invitation.list.invalidate();
    },
  });

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    await createInvitation.mutateAsync({
      email: inviteEmail,
      role: inviteRole,
    });
  };

  const invitations = invitationsData?.invitations ?? [];
  const pendingInvitations = invitations.filter((i) => i.status === "pending");

  return (
    <AppShell>
      {/* Page Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Team</h1>
          <p className="mt-1 text-muted">
            Manage team members and invitations
          </p>
        </div>
        <Button onClick={() => setShowInviteForm(true)}>
          <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Invite Member
        </Button>
      </div>

      {/* Invite Form Modal */}
      {showInviteForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Invite Team Member</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleInvite} className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colleague@example.com"
                    required
                    className="w-full rounded-md border border-card-border bg-background px-3 py-2 text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    Role
                  </label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as typeof inviteRole)}
                    className="w-full rounded-md border border-card-border bg-background px-3 py-2 text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="VIEWER" className="bg-card text-foreground">Viewer - Read-only access</option>
                    <option value="POLICY_EDITOR" className="bg-card text-foreground">Policy Editor - Can create and edit policies</option>
                    <option value="CLUSTER_ADMIN" className="bg-card text-foreground">Cluster Admin - Can manage clusters</option>
                    <option value="ORG_ADMIN" className="bg-card text-foreground">Organization Admin - Full access</option>
                  </select>
                </div>
                {createInvitation.error && (
                  <p className="text-sm text-red-400">
                    {createInvitation.error.message}
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setShowInviteForm(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" isLoading={createInvitation.isPending}>
                    Send Invitation
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-6 flex gap-4 border-b border-card-border">
        <button
          onClick={() => setActiveTab("members")}
          className={`pb-3 text-sm font-medium transition-colors ${
            activeTab === "members"
              ? "border-b-2 border-primary text-primary"
              : "text-muted hover:text-foreground"
          }`}
        >
          Members
        </button>
        <button
          onClick={() => setActiveTab("invitations")}
          className={`pb-3 text-sm font-medium transition-colors ${
            activeTab === "invitations"
              ? "border-b-2 border-primary text-primary"
              : "text-muted hover:text-foreground"
          }`}
        >
          Pending Invitations
          {pendingInvitations.length > 0 && (
            <Badge variant="accent" className="ml-2">
              {pendingInvitations.length}
            </Badge>
          )}
        </button>
      </div>

      {/* Content */}
      {activeTab === "members" ? (
        <Card>
          <CardContent className="py-6">
            <p className="text-center text-muted">
              Team member management coming soon.
              <br />
              Use the Invitations tab to invite new members.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              {pendingInvitations.length} Pending Invitation{pendingInvitations.length !== 1 ? "s" : ""}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {invitationsLoading ? (
              <div className="py-4 text-center text-muted">Loading invitations...</div>
            ) : invitations.length === 0 ? (
              <div className="py-4 text-center text-muted">No invitations yet</div>
            ) : (
              <div className="divide-y divide-card-border">
                {invitations.map((invitation) => (
                  <div
                    key={invitation.id}
                    className="flex items-center justify-between py-4 first:pt-0 last:pb-0"
                  >
                    <div>
                      <p className="font-medium text-foreground">{invitation.email}</p>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                        <Badge variant="muted">{formatRole(invitation.role)}</Badge>
                        <span>•</span>
                        <span>
                          Invited by {invitation.invitedBy.name ?? invitation.invitedBy.email}
                        </span>
                        <span>•</span>
                        <span>
                          {invitation.status === "accepted"
                            ? `Accepted ${formatDate(invitation.acceptedAt!)}`
                            : invitation.status === "expired"
                              ? "Expired"
                              : `Expires ${formatDate(invitation.expiresAt)}`}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
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
                      {invitation.status === "pending" && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => resendInvitation.mutate({ invitationId: invitation.id })}
                            disabled={resendInvitation.isPending}
                          >
                            Resend
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (confirm("Are you sure you want to revoke this invitation?")) {
                                revokeInvitation.mutate({ invitationId: invitation.id });
                              }
                            }}
                            disabled={revokeInvitation.isPending}
                          >
                            Revoke
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </AppShell>
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
