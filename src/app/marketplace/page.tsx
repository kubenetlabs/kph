"use client";

import { useState } from "react";
import Link from "next/link";
import AppShell from "~/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";
import Input from "~/components/ui/input";
import Select from "~/components/ui/select";
import { trpc } from "~/lib/trpc";

type Category = "COMPLIANCE" | "WORKLOAD" | "SECURITY" | "";
type Tier = "COMMUNITY" | "ENTERPRISE" | "";

// Icons as inline SVGs
function PackageIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  );
}

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function CrownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  );
}

const categoryOptions = [
  { value: "", label: "All Categories" },
  { value: "COMPLIANCE", label: "Compliance" },
  { value: "WORKLOAD", label: "Workload" },
  { value: "SECURITY", label: "Security" },
];

const tierOptions = [
  { value: "", label: "All Tiers" },
  { value: "COMMUNITY", label: "Community (Free)" },
  { value: "ENTERPRISE", label: "Enterprise" },
];

export default function MarketplacePage() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<Category>("");
  const [tier, setTier] = useState<Tier>("");
  const [activeTab, setActiveTab] = useState<"all" | "community" | "enterprise">("all");

  const { data, isLoading } = trpc.marketplace.listPacks.useQuery({
    search: search || undefined,
    category: category || undefined,
    tier: tier || undefined,
  });

  const { data: subscription } = trpc.marketplace.getSubscription.useQuery();

  const clearFilters = () => {
    setSearch("");
    setCategory("");
    setTier("");
  };

  const hasFilters = search || category || tier;

  const getFilteredPacks = () => {
    if (!data?.packs) return [];
    if (activeTab === "community") return data.packs.filter((p) => p.tier === "COMMUNITY");
    if (activeTab === "enterprise") return data.packs.filter((p) => p.tier === "ENTERPRISE");
    return data.packs;
  };

  const filteredPacks = getFilteredPacks();

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Policy Marketplace</h1>
            <p className="text-muted mt-1">
              Pre-built policy packs for common workloads and compliance frameworks
            </p>
          </div>
          <div className="flex items-center gap-3">
            {subscription?.tier === "ENTERPRISE" ? (
              <Badge variant="accent">
                <CrownIcon className="w-3 h-3 mr-1" />
                Enterprise
              </Badge>
            ) : (
              <Link href="/settings/subscription">
                <Button variant="secondary">
                  <CrownIcon className="w-4 h-4 mr-2" />
                  Upgrade to Enterprise
                </Button>
              </Link>
            )}
            <Link href="/marketplace/admin">
              <Button variant="secondary">
                <PlusIcon className="w-4 h-4 mr-2" />
                Create Pack
              </Button>
            </Link>
            <Link href="/marketplace/installed">
              <Button variant="secondary">
                <PackageIcon className="w-4 h-4 mr-2" />
                Installed Packs
              </Button>
            </Link>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-end gap-4">
              <div className="flex-1">
                <div className="relative">
                  <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                  <Input
                    placeholder="Search packs..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              <div className="w-44">
                <Select
                  options={categoryOptions}
                  value={category}
                  onChange={(e) => setCategory(e.target.value as Category)}
                />
              </div>
              <div className="w-44">
                <Select
                  options={tierOptions}
                  value={tier}
                  onChange={(e) => setTier(e.target.value as Tier)}
                />
              </div>
              {hasFilters && (
                <Button variant="ghost" onClick={clearFilters}>
                  Clear Filters
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-card-border">
          <button
            onClick={() => setActiveTab("all")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === "all"
                ? "border-primary text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            All Packs
          </button>
          <button
            onClick={() => setActiveTab("community")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === "community"
                ? "border-primary text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            Community
          </button>
          <button
            onClick={() => setActiveTab("enterprise")}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === "enterprise"
                ? "border-primary text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            Enterprise
          </button>
        </div>

        {/* Pack Grid */}
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardHeader>
                  <div className="h-6 w-3/4 bg-card-hover rounded" />
                  <div className="h-4 w-full bg-card-hover rounded mt-2" />
                </CardHeader>
                <CardContent>
                  <div className="h-20 bg-card-hover rounded" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredPacks.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <PackageIcon className="h-12 w-12 text-muted mb-4" />
              <p className="text-lg font-medium text-foreground">No policy packs found</p>
              <p className="text-muted">Try adjusting your filters</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredPacks.map((pack) => (
              <PackCard key={pack.id} pack={pack} hasEnterprise={data?.hasEnterprise} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

interface Pack {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  tier: string;
  category: string;
  complianceFramework: string | null;
  version: string;
  iconUrl: string | null;
  tags: string[];
  policyCount: number;
  installCount: number;
  isInstalled: boolean;
  isAccessible: boolean;
}

function PackCard({ pack }: { pack: Pack; hasEnterprise?: boolean }) {
  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "COMPLIANCE":
        return <ShieldIcon className="h-5 w-5 text-accent" />;
      case "SECURITY":
        return <LockIcon className="h-5 w-5 text-accent" />;
      default:
        return <PackageIcon className="h-5 w-5 text-accent" />;
    }
  };

  return (
    <Card className={!pack.isAccessible ? "opacity-75" : ""}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
              {getCategoryIcon(pack.category)}
            </div>
            <div>
              <CardTitle className="text-base">{pack.name}</CardTitle>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant={pack.tier === "ENTERPRISE" ? "accent" : "muted"}>
                  {pack.tier === "ENTERPRISE" && <CrownIcon className="w-3 h-3 mr-1" />}
                  {pack.tier === "ENTERPRISE" ? "Enterprise" : "Community"}
                </Badge>
                {pack.complianceFramework && (
                  <Badge variant="default">{pack.complianceFramework}</Badge>
                )}
              </div>
            </div>
          </div>
          {pack.isInstalled && (
            <Badge variant="success">
              <CheckCircleIcon className="w-3 h-3 mr-1" />
              Installed
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted line-clamp-2 mb-4">{pack.description}</p>
        <div className="flex items-center gap-4 text-sm text-muted mb-4">
          <span className="flex items-center gap-1">
            <ShieldIcon className="h-4 w-4" />
            {pack.policyCount} policies
          </span>
          <span className="flex items-center gap-1">
            <DownloadIcon className="h-4 w-4" />
            {pack.installCount} installs
          </span>
        </div>
        {pack.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-4">
            {pack.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="default">
                {tag}
              </Badge>
            ))}
            {pack.tags.length > 3 && <Badge variant="default">+{pack.tags.length - 3}</Badge>}
          </div>
        )}
        <Link href={`/marketplace/${pack.id}`} className="block">
          <Button
            className="w-full"
            variant={pack.isAccessible ? "primary" : "secondary"}
          >
            {!pack.isAccessible ? (
              <>
                <LockIcon className="h-4 w-4 mr-2" />
                Requires Enterprise
              </>
            ) : pack.isInstalled ? (
              "View Details"
            ) : (
              "View & Install"
            )}
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
