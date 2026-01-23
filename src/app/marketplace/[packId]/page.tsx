"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import AppShell from "~/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";
import Modal from "~/components/ui/modal";
import Select from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
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

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
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

function FileCodeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
    </svg>
  );
}

export default function PackDetailsPage() {
  const params = useParams();
  const packId = params.packId as string;

  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [deployModalOpen, setDeployModalOpen] = useState(false);
  const [selectedClusterId, setSelectedClusterId] = useState("");
  const [activeTab, setActiveTab] = useState<"list" | "yaml">("list");

  const { data, isLoading, refetch } = trpc.marketplace.getPackDetails.useQuery({ packId });
  const { data: clusters } = trpc.cluster.list.useQuery();

  const installMutation = trpc.marketplace.installPack.useMutation({
    onSuccess: () => {
      setInstallModalOpen(false);
      void refetch();
    },
  });

  const deployMutation = trpc.marketplace.deployToCluster.useMutation({
    onSuccess: () => {
      setDeployModalOpen(false);
      void refetch();
    },
  });

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <Spinner size="lg" />
        </div>
      </AppShell>
    );
  }

  if (!data) {
    return (
      <AppShell>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <PackageIcon className="h-12 w-12 text-muted mb-4" />
            <p className="text-lg font-medium text-foreground">Pack not found</p>
            <Link href="/marketplace">
              <Button variant="secondary" className="mt-4">
                Back to Marketplace
              </Button>
            </Link>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const { pack, policies, installation, isAccessible } = data;

  const handleInstall = () => {
    installMutation.mutate({ packId });
  };

  const handleDeploy = () => {
    if (!installation || !selectedClusterId) return;
    deployMutation.mutate({
      installationId: installation.id,
      clusterId: selectedClusterId,
    });
  };

  const clusterOptions = clusters?.map((c) => {
    const isDeployed = installation?.deployments.some((d) => d.cluster.id === c.id);
    return {
      value: c.id,
      label: isDeployed ? `${c.name} (already deployed)` : c.name,
    };
  }) ?? [];

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
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-accent/10">
                <PackageIcon className="h-6 w-6 text-accent" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">{pack.name}</h1>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant={pack.tier === "ENTERPRISE" ? "accent" : "muted"}>
                    {pack.tier === "ENTERPRISE" && <CrownIcon className="w-3 h-3 mr-1" />}
                    {pack.tier === "ENTERPRISE" ? "Enterprise" : "Community"}
                  </Badge>
                  <Badge variant="default">{pack.category}</Badge>
                  {pack.complianceFramework && (
                    <Badge variant="default">{pack.complianceFramework}</Badge>
                  )}
                  <span className="text-sm text-muted">v{pack.version}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isAccessible ? (
              <Link href="/settings/subscription">
                <Button>
                  <CrownIcon className="h-4 w-4 mr-2" />
                  Upgrade to Access
                </Button>
              </Link>
            ) : installation ? (
              <Button onClick={() => setDeployModalOpen(true)}>
                <ServerIcon className="h-4 w-4 mr-2" />
                Deploy to Cluster
              </Button>
            ) : (
              <Button onClick={() => setInstallModalOpen(true)}>
                <DownloadIcon className="h-4 w-4 mr-2" />
                Install Pack
              </Button>
            )}
          </div>
        </div>

        {/* Access warning */}
        {!isAccessible && (
          <Card className="border-warning">
            <CardContent className="flex items-center gap-4 py-4">
              <LockIcon className="h-8 w-8 text-warning" />
              <div>
                <p className="font-medium text-foreground">Enterprise Subscription Required</p>
                <p className="text-sm text-muted">
                  This pack requires an Enterprise subscription to access auditor-certified compliance policies.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Installation status */}
        {installation && (
          <Card className="border-success">
            <CardContent className="flex items-center justify-between py-4">
              <div className="flex items-center gap-4">
                <CheckCircleIcon className="h-8 w-8 text-success" />
                <div>
                  <p className="font-medium text-foreground">Installed</p>
                  <p className="text-sm text-muted">
                    Installed by {installation.installedBy?.name ?? installation.installedBy?.email} on{" "}
                    {new Date(installation.installedAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              {installation.deployments.length > 0 && (
                <div className="text-right">
                  <p className="text-sm font-medium text-foreground">
                    Deployed to {installation.deployments.length} cluster(s)
                  </p>
                  <div className="flex gap-1 mt-1 justify-end">
                    {installation.deployments.map((d) => (
                      <Badge key={d.id} variant="muted">
                        {d.cluster.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Main content */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left column - Pack info */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">About</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted">{pack.description}</p>

                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2 text-muted">
                    <ShieldIcon className="h-4 w-4" />
                    <span>{policies.length} policies</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted">
                    <DownloadIcon className="h-4 w-4" />
                    <span>{pack.installCount} installations</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted">
                    <CalendarIcon className="h-4 w-4" />
                    <span>Updated {new Date(pack.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>

                {pack.tags && pack.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {pack.tags.map((tag: string) => (
                      <Badge key={tag} variant="default">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}

                {pack.docsUrl && (
                  <a
                    href={pack.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-accent hover:underline"
                  >
                    <ExternalLinkIcon className="h-4 w-4" />
                    View Documentation
                  </a>
                )}
              </CardContent>
            </Card>

            {/* Enterprise certification */}
            {pack.tier === "ENTERPRISE" && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Certification</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted">
                  {pack.auditorName && (
                    <div className="flex items-center gap-2">
                      <UserIcon className="h-4 w-4" />
                      <span>Audited by {pack.auditorName}</span>
                    </div>
                  )}
                  {pack.certificationDate && (
                    <div className="flex items-center gap-2">
                      <CalendarIcon className="h-4 w-4" />
                      <span>Certified {new Date(pack.certificationDate).toLocaleDateString()}</span>
                    </div>
                  )}
                  {pack.complianceFramework && (
                    <div className="flex items-center gap-2">
                      <ShieldIcon className="h-4 w-4" />
                      <span>{pack.complianceFramework} Controls</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right column - Policies */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Included Policies</CardTitle>
                  <p className="text-sm text-muted">
                    {isAccessible ? "Full policy YAML available" : "Upgrade to view full policy definitions"}
                  </p>
                </div>
              </CardHeader>
              <CardContent>
                {/* Tabs */}
                <div className="flex gap-1 border-b border-card-border mb-4">
                  <button
                    onClick={() => setActiveTab("list")}
                    className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                      activeTab === "list"
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted hover:text-foreground"
                    }`}
                  >
                    List
                  </button>
                  <button
                    onClick={() => isAccessible && setActiveTab("yaml")}
                    disabled={!isAccessible}
                    className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                      activeTab === "yaml"
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted hover:text-foreground"
                    } ${!isAccessible ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    YAML
                  </button>
                </div>

                {activeTab === "list" ? (
                  <div className="space-y-3">
                    {policies.map((policy, index) => (
                      <div key={policy.id} className="flex items-start gap-3 p-3 rounded-lg border border-card-border">
                        <div className="flex h-8 w-8 items-center justify-center rounded bg-card-hover text-sm font-medium text-muted">
                          {index + 1}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-foreground">{policy.name}</p>
                            <Badge variant="default">{policy.policyType}</Badge>
                          </div>
                          <p className="text-sm text-muted mt-1">{policy.description}</p>
                          {policy.controlIds && Array.isArray(policy.controlIds) && policy.controlIds.length > 0 && (
                            <div className="flex gap-1 mt-2">
                              {(policy.controlIds as string[]).map((id) => (
                                <Badge key={id} variant="muted">
                                  {id}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                        {!isAccessible && <LockIcon className="h-4 w-4 text-muted" />}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-6">
                    {policies.map((policy) => (
                      <div key={policy.id}>
                        <div className="flex items-center gap-2 mb-2">
                          <FileCodeIcon className="h-4 w-4 text-muted" />
                          <span className="font-medium text-foreground">{policy.name}</span>
                        </div>
                        {policy.yamlContent ? (
                          <pre className="bg-card-hover p-4 rounded-lg overflow-x-auto text-sm text-foreground font-mono">
                            {policy.yamlContent}
                          </pre>
                        ) : (
                          <div className="bg-card-hover p-4 rounded-lg text-center text-muted">
                            <LockIcon className="h-6 w-6 mx-auto mb-2" />
                            <p>YAML content requires Enterprise subscription</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Install Modal */}
        <Modal
          isOpen={installModalOpen}
          onClose={() => setInstallModalOpen(false)}
          title={`Install ${pack.name}`}
          description="This will add the policy pack to your organization. You can then deploy it to any of your clusters."
        >
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-lg border border-card-border">
              <PackageIcon className="h-8 w-8 text-accent" />
              <div>
                <p className="font-medium text-foreground">{pack.name}</p>
                <p className="text-sm text-muted">
                  {policies.length} policies &middot; v{pack.version}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setInstallModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleInstall} isLoading={installMutation.isPending}>
                Install Pack
              </Button>
            </div>
          </div>
        </Modal>

        {/* Deploy Modal */}
        <Modal
          isOpen={deployModalOpen}
          onClose={() => setDeployModalOpen(false)}
          title="Deploy to Cluster"
          description={`Deploy all ${policies.length} policies from this pack to a cluster.`}
        >
          <div className="space-y-4">
            <Select
              label="Select Cluster"
              options={clusterOptions}
              value={selectedClusterId}
              onChange={(e) => setSelectedClusterId(e.target.value)}
              placeholder="Choose a cluster"
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeployModalOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleDeploy}
                disabled={!selectedClusterId || installation?.deployments.some((d) => d.cluster.id === selectedClusterId)}
                isLoading={deployMutation.isPending}
              >
                Deploy Pack
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </AppShell>
  );
}
