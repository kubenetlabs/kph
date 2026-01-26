import type { TourStep } from "./tour-provider";

/**
 * Dashboard tour - shown to new users after onboarding
 */
export const dashboardTourSteps: TourStep[] = [
  {
    id: "welcome",
    target: "[data-tour='dashboard-header']",
    title: "Welcome to Policy Hub!",
    content:
      "This is your dashboard - the central hub for monitoring your Kubernetes clusters and policies. Let's take a quick tour of the key features.",
    placement: "bottom",
  },
  {
    id: "sidebar-nav",
    target: "[data-tour='sidebar-nav']",
    title: "Navigation",
    content:
      "Use the sidebar to navigate between different sections: Clusters, Policies, Deployments, Simulation, and more.",
    placement: "right",
  },
  {
    id: "clusters",
    target: "[data-tour='nav-clusters']",
    title: "Clusters",
    content:
      "Connect and manage your Kubernetes clusters here. You can monitor cluster health, node counts, and operator status.",
    placement: "right",
  },
  {
    id: "policies",
    target: "[data-tour='nav-policies']",
    title: "Policies",
    content:
      "Create and manage Cilium network policies, Tetragon security policies, and Gateway API routes. Version control and deployment tracking included.",
    placement: "right",
  },
  {
    id: "simulation",
    target: "[data-tour='nav-simulation']",
    title: "Time-Travel Simulation",
    content:
      "Test your policies against historical network traffic before deploying. See exactly what would be allowed or blocked.",
    placement: "right",
  },
  {
    id: "topology",
    target: "[data-tour='nav-topology']",
    title: "Network Topology",
    content:
      "Visualize your cluster's network topology with an interactive graph showing workloads and their connections.",
    placement: "right",
  },
  {
    id: "marketplace",
    target: "[data-tour='nav-marketplace']",
    title: "Policy Marketplace",
    content:
      "Browse and install curated policy packs for common architectures and compliance frameworks like PCI-DSS and SOC2.",
    placement: "right",
  },
  {
    id: "command-palette",
    target: "[data-tour='command-palette-hint']",
    title: "Quick Navigation",
    content:
      "Press ⌘K (or Ctrl+K) anytime to open the command palette for quick navigation and actions.",
    placement: "top",
  },
  {
    id: "theme-toggle",
    target: "[data-tour='theme-toggle']",
    title: "Theme Settings",
    content:
      "Switch between light, dark, or system theme using these buttons. Your preference is saved automatically.",
    placement: "top",
  },
];

/**
 * Cluster installation tour - shown when user first visits cluster install page
 */
export const clusterInstallTourSteps: TourStep[] = [
  {
    id: "install-intro",
    target: "[data-tour='install-header']",
    title: "Connect Your First Cluster",
    content:
      "Follow these steps to install the Policy Hub operator on your Kubernetes cluster. The operator handles policy deployment and telemetry collection.",
    placement: "bottom",
  },
  {
    id: "helm-command",
    target: "[data-tour='helm-command']",
    title: "Helm Installation",
    content:
      "Copy this Helm command to install the operator. It includes your organization's authentication token.",
    placement: "bottom",
  },
];

/**
 * Policy creation tour
 */
export const policyCreationTourSteps: TourStep[] = [
  {
    id: "policy-types",
    target: "[data-tour='policy-type-select']",
    title: "Policy Types",
    content:
      "Choose from Cilium Network Policies, Clusterwide Policies, Tetragon Security Policies, or Gateway API routes.",
    placement: "bottom",
  },
  {
    id: "policy-editor",
    target: "[data-tour='policy-editor']",
    title: "YAML Editor",
    content:
      "Write your policy YAML here. The editor provides syntax highlighting and validation.",
    placement: "right",
  },
];

export const TOUR_IDS = {
  DASHBOARD: "dashboard-tour-v1",
  CLUSTER_INSTALL: "cluster-install-tour-v1",
  POLICY_CREATION: "policy-creation-tour-v1",
} as const;
