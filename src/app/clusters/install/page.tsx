"use client";

import { useState } from "react";
import { useOrganization } from "@clerk/nextjs";
import ClusterInstallWizard from "~/components/clusters/cluster-install-wizard";
import { trpc } from "~/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import Button from "~/components/ui/button";

const EXPIRY_OPTIONS = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 60, label: "60 days" },
  { value: 90, label: "90 days (Recommended)", recommended: true },
] as const;

export default function InstallTestPage() {
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [expiryDays, setExpiryDays] = useState<number>(90);
  const [showTokenConfig, setShowTokenConfig] = useState(false);
  const [agentToken, setAgentToken] = useState<string | null>(null);
  const { organization } = useOrganization();

  // Fetch clusters
  const { data: clustersData, isLoading: clustersLoading } = trpc.cluster.list.useQuery();

  // Create token mutation
  const createToken = trpc.token.create.useMutation({
    onSuccess: (data) => {
      setAgentToken(data.token);
      setShowTokenConfig(false);
    },
  });

  const clusters = clustersData ?? [];
  const selectedCluster = clusters.find((c) => c.id === selectedClusterId);

  const handleSelectCluster = (clusterId: string) => {
    setSelectedClusterId(clusterId);
    setShowTokenConfig(true);
  };

  const handleGenerateToken = () => {
    if (!selectedClusterId) return;
    createToken.mutate({
      name: `Agent token for ${selectedCluster?.name ?? "cluster"}`,
      type: "AGENT",
      clusterId: selectedClusterId,
      expiryDays,
    });
  };

  const handleBack = () => {
    setShowTokenConfig(false);
    setSelectedClusterId(null);
    setExpiryDays(90);
  };

  const serverUrl = typeof window !== "undefined" ? window.location.origin : "https://policy-hub-starter.vercel.app";

  if (clustersLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted">Loading clusters...</p>
      </div>
    );
  }

  // If cluster selected but token not yet generated, show token configuration
  if (showTokenConfig && selectedCluster && !agentToken) {
    return (
      <div className="container mx-auto max-w-2xl py-8">
        <Card>
          <CardHeader>
            <CardTitle>Configure Agent Token</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <p className="text-sm text-muted">
                Cluster: <span className="font-medium text-foreground">{selectedCluster.name}</span>
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Token Expiry
              </label>
              <p className="text-xs text-muted mb-3">
                Choose how long the agent token should remain valid. For security, agent tokens are capped at 90 days.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {EXPIRY_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setExpiryDays(option.value)}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      expiryDays === option.value
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-card-border hover:border-primary/50 hover:bg-card-hover"
                    }`}
                  >
                    <div className="font-medium text-sm">{option.label}</div>
                    {option.recommended && (
                      <div className="text-xs text-primary mt-0.5">Best for production</div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button variant="secondary" onClick={handleBack}>
                Back
              </Button>
              <Button
                onClick={handleGenerateToken}
                isLoading={createToken.isPending}
                className="flex-1"
              >
                Generate Token & Continue
              </Button>
            </div>

            {createToken.error && (
              <p className="text-sm text-red-400">Error: {createToken.error.message}</p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // If no cluster selected, show cluster selection
  if (!selectedClusterId || !selectedCluster) {
    return (
      <div className="container mx-auto max-w-2xl py-8">
        <Card>
          <CardHeader>
            <CardTitle>Test Cluster Installation Wizard</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted">
              Select a cluster to test the installation wizard, or create a new one first.
            </p>

            {clusters.length === 0 ? (
              <div className="rounded-lg border border-card-border p-8 text-center">
                <p className="text-muted">No clusters found.</p>
                <p className="mt-2 text-sm text-muted">
                  Go to <a href="/clusters" className="text-primary hover:underline">/clusters</a> to create one first.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {clusters.map((cluster) => (
                  <button
                    key={cluster.id}
                    onClick={() => handleSelectCluster(cluster.id)}
                    className="w-full rounded-lg border border-card-border p-4 text-left hover:border-primary hover:bg-card-hover"
                  >
                    <div className="font-medium text-foreground">{cluster.name}</div>
                    <div className="text-xs text-muted">
                      Status: {cluster.status} | ID: {cluster.id}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }


  // If no token yet (shouldn't reach here normally, but guard against it)
  if (!agentToken) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted">Preparing wizard...</p>
      </div>
    );
  }

  // Show the wizard
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <ClusterInstallWizard
        cluster={{
          id: selectedCluster.id,
          name: selectedCluster.name,
          organizationId: organization?.id ?? "unknown",
        }}
        agentToken={agentToken}
        serverUrl={serverUrl}
        onComplete={() => {
          alert("Installation complete! In production, this would redirect to the cluster page.");
          setSelectedClusterId(null);
          setAgentToken(null);
          setShowTokenConfig(false);
          setExpiryDays(90);
        }}
        onCancel={() => {
          setSelectedClusterId(null);
          setAgentToken(null);
          setShowTokenConfig(false);
          setExpiryDays(90);
        }}
      />
    </div>
  );
}
