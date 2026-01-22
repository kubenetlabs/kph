"use client";

import { useParams, useRouter } from "next/navigation";
import { useUser, SignInButton, SignUpButton } from "@clerk/nextjs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";
import { trpc } from "~/lib/trpc";

export default function InvitationPage() {
  const params = useParams();
  const router = useRouter();
  const { isSignedIn, isLoaded: userLoaded } = useUser();

  const invitationId = params.id as string;

  const { data: invitation, isLoading, error } = trpc.invitation.getById.useQuery(
    { id: invitationId },
    { enabled: !!invitationId }
  );

  const acceptMutation = trpc.invitation.accept.useMutation({
    onSuccess: (data) => {
      // Redirect to dashboard after accepting
      router.push("/dashboard");
    },
  });

  const handleAccept = async () => {
    await acceptMutation.mutateAsync({ invitationId });
  };

  // Loading state
  if (isLoading || !userLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="py-8 text-center">
            <div className="animate-pulse text-muted">Loading invitation...</div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-center text-red-400">Invitation Not Found</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-muted">
              This invitation may have been revoked or doesn&apos;t exist.
            </p>
            <Button
              className="mt-4"
              variant="secondary"
              onClick={() => router.push("/")}
            >
              Go to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Invalid or expired invitation
  if (!invitation || invitation.status !== "pending") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-center">
              {invitation?.status === "accepted"
                ? "Invitation Already Accepted"
                : invitation?.status === "expired"
                  ? "Invitation Expired"
                  : "Invalid Invitation"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-muted">
              {invitation?.status === "accepted"
                ? "This invitation has already been used."
                : invitation?.status === "expired"
                  ? "This invitation has expired. Please contact your organization administrator for a new invitation."
                  : "This invitation is no longer valid."}
            </p>
            <Button
              className="mt-4"
              variant="secondary"
              onClick={() => router.push(isSignedIn ? "/dashboard" : "/")}
            >
              {isSignedIn ? "Go to Dashboard" : "Go to Home"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/20">
            <svg
              className="h-8 w-8 text-primary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
          </div>
          <CardTitle>You&apos;ve Been Invited!</CardTitle>
          <CardDescription>
            {invitation.invitedBy.name ?? invitation.invitedBy.email} has invited you to join
          </CardDescription>
        </CardHeader>

        <CardContent>
          {/* Organization Info */}
          <div className="mb-6 rounded-lg bg-card-hover p-4 text-center">
            <div className="text-2xl font-bold text-foreground">
              {invitation.organization.name}
            </div>
            <div className="mt-1 text-sm text-muted">
              Organization
            </div>
          </div>

          {/* Role Badge */}
          <div className="mb-6 text-center">
            <span className="text-sm text-muted">You&apos;ll join as: </span>
            <Badge variant="accent" className="ml-2">
              {formatRole(invitation.role)}
            </Badge>
          </div>

          {/* Expiry Info */}
          <div className="mb-6 text-center text-xs text-muted">
            This invitation expires on{" "}
            {new Date(invitation.expiresAt).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </div>

          {/* Actions */}
          {isSignedIn ? (
            <div className="space-y-3">
              <Button
                className="w-full"
                onClick={handleAccept}
                isLoading={acceptMutation.isPending}
              >
                Accept Invitation
              </Button>
              {acceptMutation.error && (
                <p className="text-center text-sm text-red-400">
                  {acceptMutation.error.message}
                </p>
              )}
              <Button
                className="w-full"
                variant="ghost"
                onClick={() => router.push("/dashboard")}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="mb-4 text-center text-sm text-muted">
                Sign in or create an account to accept this invitation.
              </p>
              <SignInButton mode="modal">
                <Button className="w-full">Sign In</Button>
              </SignInButton>
              <SignUpButton mode="modal">
                <Button className="w-full" variant="secondary">
                  Create Account
                </Button>
              </SignUpButton>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatRole(role: string): string {
  const roleMap: Record<string, string> = {
    ORG_ADMIN: "Organization Admin",
    CLUSTER_ADMIN: "Cluster Admin",
    POLICY_EDITOR: "Policy Editor",
    VIEWER: "Viewer",
  };
  return roleMap[role] ?? role;
}
