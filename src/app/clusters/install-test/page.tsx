"use client";

import { useState } from "react";
import { useOrganization } from "@clerk/nextjs";
import ClusterInstallWizard from "~/components/clusters/cluster-install-wizard";
import { trpc } from "~/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

export default function InstallTestPage() {
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [agentToken, setAgentToken] = useState<string | null>(null);
  const { organization } = useOrganization();

  // Fetch clusters
  const { data: clustersData, isLoading: clustersLoading } = trpc.cluster.list.useQuery();

  // Create token mutation
  const createToken = trpc.token.create.useMutation({
    onSuccess: (data) => {
      setAgentToken(data.token);
    },
  });

  const clusters = clustersData ?? [];
  const selectedCluster = clusters.find((c) => c.id === selectedClusterId);

  const handleSelectCluster = async (clusterId: string) => {
    setSelectedClusterId(clusterId);
    // Create an agent token for this cluster
    createToken.mutate({
      name: `Install wizard test token`,
      type: "AGENT",
      clusterId,
      expiryDays: 1, // Short expiry for testing
    });
  };

  const serverUrl = typeof window !== "undefined" ? window.location.origin : "https://policy-hub-starter.vercel.app";

  if (clustersLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted">Loading clusters...</p>
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

  // If waiting for token
  if (!agentToken) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted">
          {createToken.isPending ? "Generating agent token..." : "Preparing wizard..."}
        </p>
        {createToken.error && (
          <p className="text-red-400">Error: {createToken.error.message}</p>
        )}
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
        }}
        onCancel={() => {
          setSelectedClusterId(null);
          setAgentToken(null);
        }}
      />
    </div>
  );
}
