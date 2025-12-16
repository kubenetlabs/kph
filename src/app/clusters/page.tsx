"use client";

import { useState } from "react";
import AppShell from "~/components/layout/app-shell";
import { Card, CardContent } from "~/components/ui/card";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";
import Modal from "~/components/ui/modal";
import CreateClusterForm from "~/components/clusters/create-cluster-form";

// Mock data - replace with database query
const initialClusters = [
  {
    id: "1",
    name: "prod-us-east",
    description: "Production workloads - US East region",
    provider: "AWS",
    region: "us-east-1",
    environment: "PRODUCTION",
    status: "CONNECTED",
    kubernetesVersion: "1.28.3",
    nodeCount: 12,
    namespaceCount: 24,
    operatorInstalled: true,
    operatorVersion: "0.1.0",
    lastHeartbeat: new Date(),
    createdAt: new Date("2024-01-15"),
  },
  {
    id: "2",
    name: "staging-us-west",
    description: "Staging environment for pre-production testing",
    provider: "AWS",
    region: "us-west-2",
    environment: "STAGING",
    status: "CONNECTED",
    kubernetesVersion: "1.28.3",
    nodeCount: 4,
    namespaceCount: 12,
    operatorInstalled: true,
    operatorVersion: "0.1.0",
    lastHeartbeat: new Date(),
    createdAt: new Date("2024-02-01"),
  },
  {
    id: "3",
    name: "dev-azure",
    description: "Development cluster on Azure",
    provider: "AZURE",
    region: "eastus2",
    environment: "DEVELOPMENT",
    status: "PENDING",
    kubernetesVersion: "1.27.8",
    nodeCount: 3,
    namespaceCount: 8,
    operatorInstalled: false,
    operatorVersion: null,
    lastHeartbeat: null,
    createdAt: new Date("2024-03-10"),
  },
];

const statusConfig = {
  CONNECTED: { variant: "success" as const, label: "Connected" },
  PENDING: { variant: "warning" as const, label: "Pending" },
  DEGRADED: { variant: "warning" as const, label: "Degraded" },
  DISCONNECTED: { variant: "danger" as const, label: "Disconnected" },
  ERROR: { variant: "danger" as const, label: "Error" },
};

const environmentConfig = {
  PRODUCTION: { variant: "danger" as const, label: "Production" },
  STAGING: { variant: "warning" as const, label: "Staging" },
  DEVELOPMENT: { variant: "accent" as const, label: "Development" },
  TESTING: { variant: "muted" as const, label: "Testing" },
};

interface Cluster {
  id: string;
  name: string;
  description: string;
  provider: string;
  region: string;
  environment: string;
  status: string;
  kubernetesVersion: string | null;
  nodeCount: number | null;
  namespaceCount: number | null;
  operatorInstalled: boolean;
  operatorVersion: string | null;
  lastHeartbeat: Date | null;
  createdAt: Date;
}

interface ClusterFormData {
  name: string;
  description?: string;
  provider: "AWS" | "GCP" | "AZURE" | "ON_PREM" | "OTHER";
  region: string;
  environment: "PRODUCTION" | "STAGING" | "DEVELOPMENT" | "TESTING";
  endpoint: string;
}

export default function ClustersPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [clusters, setClusters] = useState<Cluster[]>(initialClusters);

  const handleCreateCluster = async (data: ClusterFormData) => {
    setIsSubmitting(true);

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Add new cluster to the list (in real app, this would come from the API response)
    const newCluster: Cluster = {
      id: String(Date.now()),
      name: data.name,
      description: data.description ?? "",
      provider: data.provider,
      region: data.region,
      environment: data.environment,
      status: "PENDING",
      kubernetesVersion: null,
      nodeCount: null,
      namespaceCount: null,
      operatorInstalled: false,
      operatorVersion: null,
      lastHeartbeat: null,
      createdAt: new Date(),
    };

    setClusters((prev) => [newCluster, ...prev]);
    setIsSubmitting(false);
    setIsModalOpen(false);
  };

  return (
    <AppShell>
      {/* Page Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Clusters</h1>
          <p className="mt-1 text-muted">
            Manage your Kubernetes clusters and their Policy Hub operators
          </p>
        </div>
        <Button onClick={() => setIsModalOpen(true)}>
          <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Cluster
        </Button>
      </div>

      {/* Filters */}
      <div className="mb-6 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">Filter by:</span>
          <Button variant="ghost" size="sm">
            All Providers
          </Button>
          <Button variant="ghost" size="sm">
            All Environments
          </Button>
          <Button variant="ghost" size="sm">
            All Statuses
          </Button>
        </div>
      </div>

      {/* Clusters Table */}
      {clusters.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <table className="w-full">
              <thead>
                <tr className="border-b border-card-border">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                    Cluster
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                    Provider / Region
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                    Environment
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                    Nodes
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                    Operator
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {clusters.map((cluster) => {
                  const status = statusConfig[cluster.status as keyof typeof statusConfig];
                  const env = environmentConfig[cluster.environment as keyof typeof environmentConfig];
                  
                  return (
                    <tr key={cluster.id} className="hover:bg-card-hover transition-colors">
                      <td className="px-4 py-4">
                        <div>
                          <p className="font-medium text-foreground">{cluster.name}</p>
                          <p className="text-sm text-muted">{cluster.description}</p>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{cluster.provider}</span>
                          <span className="text-muted">•</span>
                          <span className="text-sm text-muted">{cluster.region}</span>
                        </div>
                        {cluster.kubernetesVersion && (
                          <p className="text-xs text-muted">K8s {cluster.kubernetesVersion}</p>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <Badge variant={env.variant}>{env.label}</Badge>
                      </td>
                      <td className="px-4 py-4">
                        <Badge variant={status.variant}>{status.label}</Badge>
                        {cluster.lastHeartbeat && (
                          <p className="mt-1 text-xs text-muted">
                            {new Date(cluster.lastHeartbeat).toLocaleTimeString()}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        {cluster.nodeCount !== null ? (
                          <>
                            <span className="text-foreground">{cluster.nodeCount}</span>
                            <span className="text-muted"> / </span>
                            <span className="text-sm text-muted">{cluster.namespaceCount} ns</span>
                          </>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        {cluster.operatorInstalled ? (
                          <div>
                            <Badge variant="policyhub">Installed</Badge>
                            <p className="mt-1 text-xs text-muted">v{cluster.operatorVersion}</p>
                          </div>
                        ) : (
                          <Badge variant="muted">Not Installed</Badge>
                        )}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="ghost" size="sm">
                            View
                          </Button>
                          <Button variant="ghost" size="sm">
                            Edit
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {clusters.length === 0 && (
        <Card className="py-12 text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-card-hover p-3 text-muted">
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <h3 className="mt-4 text-lg font-medium text-foreground">No clusters yet</h3>
          <p className="mt-2 text-sm text-muted">
            Get started by connecting your first Kubernetes cluster.
          </p>
          <Button className="mt-6" onClick={() => setIsModalOpen(true)}>
            <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Your First Cluster
          </Button>
        </Card>
      )}

      {/* Create Cluster Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Add New Cluster"
        description="Connect a Kubernetes cluster to Policy Hub for network policy management."
        size="lg"
      >
        <CreateClusterForm
          onSubmit={handleCreateCluster}
          onCancel={() => setIsModalOpen(false)}
          isLoading={isSubmitting}
        />
      </Modal>
    </AppShell>
  );
}
