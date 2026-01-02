"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "~/components/ui/card";
import Button from "~/components/ui/button";

export default function AuthErrorPage() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  const getErrorDetails = (error: string | null) => {
    switch (error) {
      case "Configuration":
        return {
          title: "Server Configuration Error",
          description: "There is a problem with the server configuration.",
          suggestion: "Please contact the administrator.",
        };
      case "AccessDenied":
        return {
          title: "Access Denied",
          description: "You do not have permission to sign in.",
          suggestion: "Please contact your organization administrator.",
        };
      case "Verification":
        return {
          title: "Verification Failed",
          description: "The sign in link is no longer valid.",
          suggestion: "It may have been used already or it may have expired. Please request a new link.",
        };
      case "OAuthSignin":
      case "OAuthCallback":
      case "OAuthCreateAccount":
        return {
          title: "OAuth Error",
          description: "There was a problem signing in with the OAuth provider.",
          suggestion: "Please try again or use a different sign in method.",
        };
      case "OAuthAccountNotLinked":
        return {
          title: "Account Already Exists",
          description: "This email is already associated with a different sign in method.",
          suggestion: "Please sign in using your original method.",
        };
      case "EmailCreateAccount":
        return {
          title: "Account Creation Failed",
          description: "There was a problem creating your account.",
          suggestion: "Please try again or contact support.",
        };
      case "Callback":
        return {
          title: "Callback Error",
          description: "There was a problem during the authentication callback.",
          suggestion: "Please try signing in again.",
        };
      case "SessionRequired":
        return {
          title: "Session Required",
          description: "You need to be signed in to access this page.",
          suggestion: "Please sign in to continue.",
        };
      default:
        return {
          title: "Authentication Error",
          description: "An unexpected error occurred during authentication.",
          suggestion: "Please try again or contact support if the problem persists.",
        };
    }
  };

  const errorDetails = getErrorDetails(error);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        {/* Logo/Branding */}
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-primary">
            <svg
              className="h-6 w-6 text-primary-foreground"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-foreground">Kubernetes Policy Hub</h1>
        </div>

        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-danger/10">
              <svg
                className="h-8 w-8 text-danger"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <CardTitle>{errorDetails.title}</CardTitle>
            <CardDescription>{errorDetails.description}</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm text-muted mb-6">{errorDetails.suggestion}</p>

            {error && (
              <div className="mb-6 rounded-lg bg-card-hover p-3">
                <p className="text-xs text-muted">
                  Error code: <code className="font-mono text-foreground">{error}</code>
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Link href="/auth/signin">
                <Button className="w-full">Try Again</Button>
              </Link>
              <Link href="/">
                <Button variant="ghost" className="w-full">
                  Back to Home
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
