"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import Button from "~/components/ui/button";
import { trpc } from "~/lib/trpc";

const roleDescriptions: Record<string, string> = {
  ORG_ADMIN: "Full access to organization resources and user management",
  CLUSTER_ADMIN: "Manage clusters and their configurations",
  POLICY_EDITOR: "Create and edit policies, cannot manage clusters",
  VIEWER: "Read-only access to all organization resources",
};

export default function InviteUserPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [role, setRole] = useState<"ORG_ADMIN" | "CLUSTER_ADMIN" | "POLICY_EDITOR" | "VIEWER">("VIEWER");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { data: orgsData } = trpc.admin.listOrganizations.useQuery({ limit: 100 });
  const organizations = orgsData?.organizations ?? [];

  const inviteMutation = trpc.admin.inviteUser.useMutation({
    onSuccess: (data) => {
      setSuccess(`Invitation sent to ${data.email} for ${data.organization.name}`);
      setEmail("");
      setError(null);
    },
    onError: (err) => {
      setError(err.message);
      setSuccess(null);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!email.trim()) {
      setError("Email address is required");
      return;
    }

    if (!organizationId) {
      setError("Please select an organization");
      return;
    }

    inviteMutation.mutate({
      email: email.trim().toLowerCase(),
      organizationId,
      role,
    });
  };

  return (
    <div>
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Invite User</h1>
        <p className="mt-1 text-muted">
          Send an invitation to join an organization
        </p>
      </div>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Invitation Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                {error}
              </div>
            )}

            {success && (
              <div className="rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success">
                {success}
              </div>
            )}

            <div>
              <label
                htmlFor="email"
                className="mb-2 block text-sm font-medium text-foreground"
              >
                Email Address
              </label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
                className="w-full rounded-md border border-card-border bg-background px-3 py-2 text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="mt-1 text-xs text-muted">
                The user will receive an invitation email
              </p>
            </div>

            <div>
              <label
                htmlFor="organization"
                className="mb-2 block text-sm font-medium text-foreground"
              >
                Organization
              </label>
              <select
                id="organization"
                value={organizationId}
                onChange={(e) => setOrganizationId(e.target.value)}
                className="w-full rounded-md border border-card-border bg-background px-3 py-2 text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="" className="bg-card text-foreground">Select an organization...</option>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id} className="bg-card text-foreground">
                    {org.name} ({org.slug})
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted">
                The organization the user will be invited to join
              </p>
            </div>

            <div>
              <label
                htmlFor="role"
                className="mb-2 block text-sm font-medium text-foreground"
              >
                Role
              </label>
              <select
                id="role"
                value={role}
                onChange={(e) => setRole(e.target.value as typeof role)}
                className="w-full rounded-md border border-card-border bg-background px-3 py-2 text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="VIEWER" className="bg-card text-foreground">Viewer</option>
                <option value="POLICY_EDITOR" className="bg-card text-foreground">Policy Editor</option>
                <option value="CLUSTER_ADMIN" className="bg-card text-foreground">Cluster Admin</option>
                <option value="ORG_ADMIN" className="bg-card text-foreground">Organization Admin</option>
              </select>
              <p className="mt-1 text-xs text-muted">
                {roleDescriptions[role]}
              </p>
            </div>

            <div className="flex items-center gap-3 pt-4">
              <Button
                type="submit"
                disabled={inviteMutation.isPending || !email || !organizationId}
              >
                {inviteMutation.isPending ? "Sending..." : "Send Invitation"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => router.back()}
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
