"use client";

import { signIn, getProviders } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Input from "~/components/ui/input";

type Providers = Awaited<ReturnType<typeof getProviders>>;

export default function SignInPage() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";
  const error = searchParams.get("error");

  const [providers, setProviders] = useState<Providers>(null);
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  useEffect(() => {
    getProviders().then(setProviders);
  }, []);

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await signIn("email", { email, callbackUrl });
      setEmailSent(true);
    } catch (err) {
      console.error("Sign in error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOAuthSignIn = async (providerId: string) => {
    setIsLoading(true);
    await signIn(providerId, { callbackUrl });
  };

  const getErrorMessage = (error: string | null) => {
    switch (error) {
      case "OAuthSignin":
        return "Error starting OAuth sign in.";
      case "OAuthCallback":
        return "Error during OAuth callback.";
      case "OAuthCreateAccount":
        return "Could not create OAuth account.";
      case "EmailCreateAccount":
        return "Could not create email account.";
      case "Callback":
        return "Error during callback.";
      case "OAuthAccountNotLinked":
        return "Email already in use with different provider.";
      case "EmailSignin":
        return "Error sending verification email.";
      case "CredentialsSignin":
        return "Invalid credentials.";
      case "SessionRequired":
        return "Please sign in to continue.";
      default:
        return error ? "An error occurred during sign in." : null;
    }
  };

  const errorMessage = getErrorMessage(error);

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
          <p className="mt-2 text-muted">Unified policy management for cloud-native infrastructure</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sign in to your account</CardTitle>
            <CardDescription>
              Choose your preferred sign in method
            </CardDescription>
          </CardHeader>
          <CardContent>
            {errorMessage && (
              <div className="mb-4 rounded-md bg-danger/10 border border-danger/20 p-3">
                <p className="text-sm text-danger">{errorMessage}</p>
              </div>
            )}

            {emailSent ? (
              <div className="text-center py-4">
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <svg className="h-6 w-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-foreground">Check your email</h3>
                <p className="mt-2 text-sm text-muted">
                  We sent a sign in link to <span className="font-medium text-foreground">{email}</span>
                </p>
                <Button
                  variant="ghost"
                  className="mt-4"
                  onClick={() => setEmailSent(false)}
                >
                  Use a different email
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Email Sign In */}
                {providers?.email && (
                  <form onSubmit={handleEmailSignIn} className="space-y-3">
                    <Input
                      type="email"
                      label="Email address"
                      placeholder="you@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                    />
                    <Button type="submit" className="w-full" isLoading={isLoading}>
                      Continue with Email
                    </Button>
                  </form>
                )}

                {/* Divider */}
                {providers?.email && (providers?.google || providers?.github) && (
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-card-border" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-card px-2 text-muted">Or continue with</span>
                    </div>
                  </div>
                )}

                {/* OAuth Providers */}
                <div className="space-y-2">
                  {providers?.google && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full"
                      onClick={() => handleOAuthSignIn("google")}
                      disabled={isLoading}
                    >
                      <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                        <path
                          fill="currentColor"
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        />
                        <path
                          fill="currentColor"
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        />
                        <path
                          fill="currentColor"
                          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        />
                        <path
                          fill="currentColor"
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        />
                      </svg>
                      Continue with Google
                    </Button>
                  )}

                  {providers?.github && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full"
                      onClick={() => handleOAuthSignIn("github")}
                      disabled={isLoading}
                    >
                      <svg className="mr-2 h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                      </svg>
                      Continue with GitHub
                    </Button>
                  )}
                </div>

                {/* No providers configured message */}
                {!providers?.email && !providers?.google && !providers?.github && (
                  <div className="text-center py-4">
                    <p className="text-sm text-muted">
                      No authentication providers configured.
                    </p>
                    <p className="text-xs text-muted mt-1">
                      Please configure OAuth or Email providers in your environment.
                    </p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-muted">
          By signing in, you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  );
}
