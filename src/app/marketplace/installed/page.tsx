"use client";

import { useState } from "react";
import Link from "next/link";
import AppShell from "~/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";
import Modal from "~/components/ui/modal";
import { trpc } from "~/lib/trpc";

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

function CrownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z" />
    </svg>
  );
}

function ArrowLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
    </svg>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  );
}

function ServerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
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

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function AlertTriangleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  );
}

function MoreHorizontalIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
    </svg>
  );
}

interface Installation {
  id: string;
  pack: {
    id: string;
    slug: string;
    name: string;
    tier: string;
    category: string;
    version: string;
    iconUrl: string | null;
    policyCount: number;
  };
  installedAt: Date;
  installedBy: { id: string; name: string | null; email: string } | null;
  deployments: Array<{
    id: string;
    cluster: { id: string; name: string };
    status: string;
    deployedAt: Date | null;
  }>;
}

export default function InstalledPacksPage() {
  const [uninstallModalOpen, setUninstallModalOpen] = useState(false);
  const [selectedInstallation, setSelectedInstallation] = useState<{
    id: string;
    packName: string;
    hasDeployments: boolean;
  } | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const { data, isLoading, refetch } = trpc.marketplace.getInstallations.useQuery();
  const { data: subscription } = trpc.marketplace.getSubscription.useQuery();

  const uninstallMutation = trpc.marketplace.uninstallPack.useMutation({
    onSuccess: () => {
      setUninstallModalOpen(false);
      setSelectedInstallation(null);
      refetch();
    },
  });

  const handleUninstallClick = (installation: Installation) => {
    setSelectedInstallation({
      id: installation.id,
      packName: installation.pack.name,
      hasDeployments: installation.deployments.length > 0,
    });
    setUninstallModalOpen(true);
    setMenuOpen(null);
  };

  const handleUninstall = () => {
    if (!selectedInstallation) return;
    uninstallMutation.mutate({ installationId: selectedInstallation.id });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "DEPLOYED":
        return (
          <Badge variant="success">
            <CheckCircleIcon className="w-3 h-3 mr-1" />
            Deployed
          </Badge>
        );
      case "PENDING":
        return (
          <Badge variant="muted">
            <ClockIcon className="w-3 h-3 mr-1" />
            Pending
          </Badge>
        );
      case "FAILED":
        return (
          <Badge variant="danger">
            <AlertTriangleIcon className="w-3 h-3 mr-1" />
            Failed
          </Badge>
        );
      default:
        return <Badge variant="default">{status}</Badge>;
    }
  };

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link href="/marketplace">
            <Button variant="ghost" size="sm">
              <ArrowLeftIcon className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-foreground">Installed Packs</h1>
            <p className="text-muted">Manage policy packs installed in your organization</p>
          </div>
          <div className="flex items-center gap-2">
            {subscription?.tier === "ENTERPRISE" ? (
              <Badge variant="accent">
                <CrownIcon className="w-3 h-3 mr-1" />
                Enterprise
              </Badge>
            ) : (
              <Badge variant="muted">Free Tier</Badge>
            )}
          </div>
        </div>

        {/* Summary */}
        <Card>
          <CardContent className="flex items-center justify-between py-4">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
                <PackageIcon className="h-5 w-5 text-accent" />
              </div>
              <div>
                <p className="font-medium text-foreground">
                  {data?.installations.length ?? 0} Pack{data?.installations.length !== 1 ? "s" : ""} Installed
                </p>
                <p className="text-sm text-muted">
                  {subscription?.tier === "ENTERPRISE"
                    ? "Full access to all community and enterprise packs"
                    : "Access to community packs only"}
                </p>
              </div>
            </div>
            <Link href="/marketplace">
              <Button variant="secondary">Browse Marketplace</Button>
            </Link>
          </CardContent>
        </Card>

        {/* Installations list */}
        {isLoading ? (
          <Card>
            <CardContent className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </CardContent>
          </Card>
        ) : !data?.installations.length ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <PackageIcon className="h-12 w-12 text-muted mb-4" />
              <p className="text-lg font-medium text-foreground">No packs installed yet</p>
              <p className="text-muted mb-4">Install policy packs from the marketplace to get started</p>
              <Link href="/marketplace">
                <Button>Browse Marketplace</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {data.installations.map((installation) => (
              <Card key={installation.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
                        <PackageIcon className="h-5 w-5 text-accent" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-base">{installation.pack.name}</CardTitle>
                          <Badge variant={installation.pack.tier === "ENTERPRISE" ? "accent" : "muted"}>
                            {installation.pack.tier === "ENTERPRISE" && <CrownIcon className="w-3 h-3 mr-1" />}
                            {installation.pack.tier === "ENTERPRISE" ? "Enterprise" : "Community"}
                          </Badge>
                          <Badge variant="default">v{installation.pack.version}</Badge>
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-sm text-muted">
                          <span className="flex items-center gap-1">
                            <ShieldIcon className="h-3 w-3" />
                            {installation.pack.policyCount} policies
                          </span>
                          <span className="flex items-center gap-1">
                            <CalendarIcon className="h-3 w-3" />
                            Installed {new Date(installation.installedAt).toLocaleDateString()}
                          </span>
                          {installation.installedBy && (
                            <span className="flex items-center gap-1">
                              <UserIcon className="h-3 w-3" />
                              {installation.installedBy.name ?? installation.installedBy.email}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="relative">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setMenuOpen(menuOpen === installation.id ? null : installation.id)}
                      >
                        <MoreHorizontalIcon className="h-4 w-4" />
                      </Button>
                      {menuOpen === installation.id && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(null)} />
                          <div className="absolute right-0 mt-1 w-48 rounded-md border border-card-border bg-card shadow-lg z-20">
                            <Link
                              href={`/marketplace/${installation.pack.id}`}
                              className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-card-hover"
                              onClick={() => setMenuOpen(null)}
                            >
                              <EyeIcon className="h-4 w-4" />
                              View Details
                            </Link>
                            <Link
                              href={`/marketplace/${installation.pack.id}`}
                              className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-card-hover"
                              onClick={() => setMenuOpen(null)}
                            >
                              <ServerIcon className="h-4 w-4" />
                              Deploy to Cluster
                            </Link>
                            <div className="border-t border-card-border" />
                            <button
                              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-danger hover:bg-card-hover"
                              onClick={() => handleUninstallClick(installation)}
                            >
                              <TrashIcon className="h-4 w-4" />
                              Uninstall
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </CardHeader>
                {installation.deployments.length > 0 && (
                  <CardContent>
                    <p className="text-sm font-medium text-foreground mb-2">Deployments</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-card-border">
                            <th className="pb-2 text-left font-medium text-muted">Cluster</th>
                            <th className="pb-2 text-left font-medium text-muted">Status</th>
                            <th className="pb-2 text-left font-medium text-muted">Deployed At</th>
                          </tr>
                        </thead>
                        <tbody>
                          {installation.deployments.map((deployment) => (
                            <tr key={deployment.id} className="border-b border-card-border last:border-0">
                              <td className="py-2">
                                <div className="flex items-center gap-2 text-foreground">
                                  <ServerIcon className="h-4 w-4 text-muted" />
                                  {deployment.cluster.name}
                                </div>
                              </td>
                              <td className="py-2">{getStatusBadge(deployment.status)}</td>
                              <td className="py-2 text-muted">
                                {deployment.deployedAt ? new Date(deployment.deployedAt).toLocaleString() : "-"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        )}

        {/* Uninstall Modal */}
        <Modal
          isOpen={uninstallModalOpen}
          onClose={() => setUninstallModalOpen(false)}
          title={`Uninstall ${selectedInstallation?.packName ?? "Pack"}`}
          description={
            selectedInstallation?.hasDeployments
              ? "This pack has active deployments. Remove all cluster deployments before uninstalling."
              : "Are you sure you want to uninstall this pack? This action cannot be undone."
          }
        >
          <div className="space-y-4">
            {selectedInstallation?.hasDeployments && (
              <div className="flex items-center gap-3 p-3 rounded-lg border border-warning bg-warning/10">
                <AlertTriangleIcon className="h-5 w-5 text-warning" />
                <p className="text-sm text-foreground">
                  You must remove all cluster deployments before uninstalling this pack.
                </p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setUninstallModalOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={handleUninstall}
                disabled={selectedInstallation?.hasDeployments}
                isLoading={uninstallMutation.isPending}
              >
                Uninstall Pack
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </AppShell>
  );
}
