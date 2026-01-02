import { create } from "zustand";
import { type Node, type Edge } from "@xyflow/react";

export type TopologyMode = "live" | "simulation" | "diff";

export type TopologyFilters = {
  namespaces: string[];
  verdict: "all" | "allowed" | "denied" | "no-policy";
  timeRange: "5m" | "15m" | "1h" | "24h";
  search: string;
  layers: {
    ciliumNetworkPolicy: boolean;
    gatewayAPI: boolean;
  };
};

export type TopologyState = {
  // Current mode
  mode: TopologyMode;
  setMode: (mode: TopologyMode) => void;

  // Selected elements
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  setSelectedNode: (nodeId: string | null) => void;
  setSelectedEdge: (edgeId: string | null) => void;

  // Filters
  filters: TopologyFilters;
  setFilters: (filters: Partial<TopologyFilters>) => void;
  resetFilters: () => void;

  // Detail panel
  detailPanelOpen: boolean;
  setDetailPanelOpen: (open: boolean) => void;
};

const defaultFilters: TopologyFilters = {
  namespaces: [],
  verdict: "all",
  timeRange: "1h",
  search: "",
  layers: {
    ciliumNetworkPolicy: true,
    gatewayAPI: true,
  },
};

export const useTopologyStore = create<TopologyState>((set) => ({
  // Mode
  mode: "live",
  setMode: (mode) => set({ mode }),

  // Selected elements
  selectedNodeId: null,
  selectedEdgeId: null,
  setSelectedNode: (nodeId) => set({ selectedNodeId: nodeId, selectedEdgeId: null, detailPanelOpen: !!nodeId }),
  setSelectedEdge: (edgeId) => set({ selectedEdgeId: edgeId, selectedNodeId: null, detailPanelOpen: !!edgeId }),

  // Filters
  filters: defaultFilters,
  setFilters: (filters) => set((state) => ({ filters: { ...state.filters, ...filters } })),
  resetFilters: () => set({ filters: defaultFilters }),

  // Detail panel
  detailPanelOpen: false,
  setDetailPanelOpen: (open) => set({ detailPanelOpen: open }),
}));
