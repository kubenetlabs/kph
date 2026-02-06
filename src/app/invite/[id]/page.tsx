"use client";

import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";
import { trpc } from "~/lib/trpc";
import { useAuthProvider } from "~/providers/auth-provider";

import type { ReactNode, ComponentType } from "react";

// Types for Clerk hooks and components
type UseUserResult = { isSignedIn: boolean; isLoaded: boolean };
type UseUserHook = () => UseUserResult;
type ClerkButtonProps = { mode?: string; children: ReactNode };
type ClerkButtonComponent = ComponentType<ClerkButtonProps>;

interface ClerkModule {
  useUser: UseUserHook;
  SignInButton: ClerkButtonComponent;
  SignUpButton: ClerkButtonComponent;
}

// Conditionally import Clerk hooks
const useClerkAuth = () => {
  const authProvider = useAuthProvider();

  if (authProvider === "clerk") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const clerk = require("@clerk/nextjs") as ClerkModule;
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const { isSignedIn, isLoaded } = clerk.useUser();
      return {
        isSignedIn,
        isLoaded,
        SignInButton: clerk.SignInButton,
        SignUpButton: clerk.SignUpButton,
        isClerk: true,
      };
    } catch {
      return { isSignedIn: true, isLoaded: true, isClerk: false, SignInButton: null, SignUpButton: null };
    }
  }

  // In no-auth mode, user is always signed in
  return {
    isSignedIn: true,
    isLoaded: true,
    SignInButton: null,
    SignUpButton: null,
    isClerk: false,
  };
};

export default function InvitationPage() {
  const params = useParams();
  const router = useRouter();
  const authProvider = useAuthProvider();
  const { isSignedIn, isLoaded: userLoaded, SignInButton, SignUpButton, isClerk } = useClerkAuth();

  const invitationId = params.id as string;

  const { data: invitation, isLoading, error } = trpc.invitation.getById.useQuery(
    { id: invitationId },
    { enabled: !!invitationId }
  );

  const acceptMutation = trpc.invitation.accept.useMutation({
    onSuccess: () => {
      // Redirect to dashboard after accepting
      router.push("/dashboard");
    },
  });

  const handleAccept = async () => {
    await acceptMutation.mutateAsync({ invitationId });
  };

  // In no-auth mode, invitations aren't really supported
  if (authProvider === "none") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-center">Invitations Disabled</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-muted">
              Team invitations are not available in anonymous mode.
              The system is configured for single-user access.
            </p>
            <Button
              className="mt-4"
              variant="secondary"
              onClick={() => router.push("/dashboard")}
            >
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

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
          ) : isClerk && SignInButton && SignUpButton ? (
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
          ) : (
            <div className="space-y-3">
              <p className="mb-4 text-center text-sm text-muted">
                Please sign in to accept this invitation.
              </p>
              <Button
                className="w-full"
                onClick={() => router.push("/sign-in")}
              >
                Sign In
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
    ORG_ADMIN: "Organization Admin",
    CLUSTER_ADMIN: "Cluster Admin",
    POLICY_EDITOR: "Policy Editor",
    VIEWER: "Viewer",
  };
  return roleMap[role] ?? role;
}
