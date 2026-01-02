"use client";

import { useTopologyStore } from "~/stores/topology-store";
import Button from "~/components/ui/button";

export function DetailPanel() {
  const { selectedNodeId, selectedEdgeId, detailPanelOpen, setDetailPanelOpen } = useTopologyStore();

  if (!detailPanelOpen) return null;

  return (
    <div className="absolute right-0 top-0 bottom-0 w-80 bg-card border-l border-border shadow-xl z-10 overflow-y-auto">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h3 className="font-semibold text-foreground">
          {selectedNodeId ? "Node Details" : selectedEdgeId ? "Flow Details" : "Details"}
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDetailPanelOpen(false)}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </Button>
      </div>

      <div className="p-4">
        {selectedNodeId && (
          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted uppercase tracking-wide">Node ID</label>
              <p className="text-sm text-foreground font-mono">{selectedNodeId}</p>
            </div>

            <div>
              <label className="text-xs text-muted uppercase tracking-wide">Actions</label>
              <div className="mt-2 space-y-2">
                <Button variant="outline" size="sm" className="w-full justify-start">
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  View Policies
                </Button>
                <Button variant="outline" size="sm" className="w-full justify-start">
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  View Flows
                </Button>
              </div>
            </div>
          </div>
        )}

        {selectedEdgeId && (
          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted uppercase tracking-wide">Flow ID</label>
              <p className="text-sm text-foreground font-mono">{selectedEdgeId}</p>
            </div>

            <div>
              <label className="text-xs text-muted uppercase tracking-wide">Actions</label>
              <div className="mt-2 space-y-2">
                <Button variant="outline" size="sm" className="w-full justify-start">
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  View Policy
                </Button>
                <Button variant="outline" size="sm" className="w-full justify-start">
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  Create Policy
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
