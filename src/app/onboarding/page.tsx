"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Input from "~/components/ui/input";
import { trpc } from "~/lib/trpc";

export default function OnboardingPage() {
  const router = useRouter();
  const { data: session, update: updateSession } = useSession();

  const [step, setStep] = useState<"welcome" | "create-org">("welcome");
  const [orgName, setOrgName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugError, setSlugError] = useState<string | null>(null);
  const [isCheckingSlug, setIsCheckingSlug] = useState(false);

  // Check onboarding status
  const { data: status, isLoading: isLoadingStatus } = trpc.onboarding.checkStatus.useQuery();

  // Mutations
  const createOrg = trpc.onboarding.createOrganization.useMutation({
    onSuccess: async () => {
      // Update the session to reflect the new organization
      await updateSession();
      router.push("/dashboard");
    },
  });

  // Slug suggestion query
  const { data: suggestedSlug, isFetching: isFetchingSlug } = trpc.onboarding.suggestSlug.useQuery(
    { name: orgName },
    { enabled: orgName.length >= 2 }
  );

  // Slug availability check
  const { data: slugAvailability } = trpc.onboarding.checkSlugAvailability.useQuery(
    { slug },
    { enabled: slug.length >= 2 }
  );

  // Auto-fill slug from suggestion
  useEffect(() => {
    if (suggestedSlug?.slug && !slug) {
      setSlug(suggestedSlug.slug);
    }
  }, [suggestedSlug, slug]);

  // Check slug availability
  useEffect(() => {
    if (slug.length < 2) {
      setSlugError(null);
      return;
    }

    if (slugAvailability && !slugAvailability.available) {
      setSlugError("This slug is already taken");
    } else {
      setSlugError(null);
    }
  }, [slugAvailability, slug]);

  // Redirect if already has org
  useEffect(() => {
    if (status && !status.needsOnboarding) {
      router.push("/dashboard");
    }
  }, [status, router]);

  const handleCreateOrg = async () => {
    if (!orgName || !slug) return;

    await createOrg.mutateAsync({
      name: orgName,
      slug: slug,
    });
  };

  const handleSlugChange = (value: string) => {
    // Clean the slug as user types
    const cleaned = value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .substring(0, 50);
    setSlug(cleaned);
  };

  if (isLoadingStatus) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-pulse text-muted">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-lg">
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

        {step === "welcome" && (
          <Card>
            <CardHeader className="text-center">
              <CardTitle>Welcome, {session?.user?.name || session?.user?.email}!</CardTitle>
              <CardDescription>
                Let's get you set up with your organization
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <div className="mb-6 space-y-4">
                <div className="rounded-lg bg-card-hover p-4">
                  <h4 className="font-medium text-foreground mb-2">What you'll be able to do:</h4>
                  <ul className="text-sm text-muted space-y-2 text-left">
                    <li className="flex items-start gap-2">
                      <svg className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span>Connect Kubernetes clusters and manage policies</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <svg className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span>Simulate policy changes before deployment</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <svg className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span>Validate enforcement and identify coverage gaps</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <svg className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span>Access curated policy packs from the marketplace</span>
                    </li>
                  </ul>
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex justify-center">
              <Button onClick={() => setStep("create-org")} size="lg">
                Create Organization
              </Button>
            </CardFooter>
          </Card>
        )}

        {step === "create-org" && (
          <Card>
            <CardHeader>
              <CardTitle>Create your organization</CardTitle>
              <CardDescription>
                This will be your workspace for managing clusters and policies
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                label="Organization name"
                placeholder="Acme Corporation"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                helperText="The display name for your organization"
              />

              <div>
                <Input
                  label="Organization slug"
                  placeholder="acme-corp"
                  value={slug}
                  onChange={(e) => handleSlugChange(e.target.value)}
                  error={!!slugError}
                  helperText={
                    slugError ||
                    "Used in URLs: policyhub.io/org/" + (slug || "your-slug")
                  }
                />
                {slug && !slugError && slugAvailability?.available && (
                  <p className="mt-1 text-xs text-primary">This slug is available</p>
                )}
              </div>

              {createOrg.error && (
                <div className="rounded-md bg-danger/10 border border-danger/20 p-3">
                  <p className="text-sm text-danger">
                    {createOrg.error.message || "Failed to create organization"}
                  </p>
                </div>
              )}
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep("welcome")}>
                Back
              </Button>
              <Button
                onClick={handleCreateOrg}
                disabled={
                  !orgName ||
                  !slug ||
                  !!slugError ||
                  createOrg.isPending
                }
                isLoading={createOrg.isPending}
              >
                Create Organization
              </Button>
            </CardFooter>
          </Card>
        )}
      </div>
    </div>
  );
}
