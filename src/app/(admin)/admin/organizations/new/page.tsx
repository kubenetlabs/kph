"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import Button from "~/components/ui/button";
import { trpc } from "~/lib/trpc";

export default function NewOrganizationPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createOrgMutation = trpc.admin.createOrganization.useMutation({
    onSuccess: (org) => {
      router.push(`/admin/organizations`);
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Organization name is required");
      return;
    }

    if (!slug.trim()) {
      setError("Organization slug is required");
      return;
    }

    if (!/^[a-z0-9-]+$/.test(slug)) {
      setError("Slug must be lowercase alphanumeric with hyphens only");
      return;
    }

    createOrgMutation.mutate({ name: name.trim(), slug: slug.trim() });
  };

  const generateSlug = (value: string) => {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 63);
  };

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slug || slug === generateSlug(name)) {
      setSlug(generateSlug(value));
    }
  };

  return (
    <div>
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Create Organization</h1>
        <p className="mt-1 text-muted">
          Create a new organization for multi-tenant isolation
        </p>
      </div>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Organization Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                {error}
              </div>
            )}

            <div>
              <label
                htmlFor="name"
                className="mb-2 block text-sm font-medium text-foreground"
              >
                Organization Name
              </label>
              <input
                type="text"
                id="name"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Acme Corporation"
                className="w-full rounded-md border border-card-border bg-background px-3 py-2 text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                maxLength={100}
              />
              <p className="mt-1 text-xs text-muted">
                Display name for the organization
              </p>
            </div>

            <div>
              <label
                htmlFor="slug"
                className="mb-2 block text-sm font-medium text-foreground"
              >
                URL Slug
              </label>
              <input
                type="text"
                id="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="acme-corp"
                className="w-full rounded-md border border-card-border bg-background px-3 py-2 text-foreground font-mono placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                maxLength={63}
              />
              <p className="mt-1 text-xs text-muted">
                Unique identifier used in URLs (lowercase, alphanumeric, hyphens)
              </p>
            </div>

            <div className="flex items-center gap-3 pt-4">
              <Button
                type="submit"
                disabled={createOrgMutation.isPending || !name || !slug}
              >
                {createOrgMutation.isPending ? "Creating..." : "Create Organization"}
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
