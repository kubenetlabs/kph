"use client";

import { useRouter } from "next/navigation";
import { useTopologyStore } from "~/stores/topology-store";
import Button from "~/components/ui/button";
import Badge from "~/components/ui/badge";

export function DetailPanel() {
  const router = useRouter();
  const { selectedNodeId, selectedEdgeId, selectedEdgeData, detailPanelOpen, setDetailPanelOpen } = useTopologyStore();

  // Helper to navigate to policy creation with pre-filled data
  const navigateToCreatePolicy = (policyAction: "allow" | "deny") => {
    if (!selectedEdgeData) return;

    const srcParts = selectedEdgeData.source.split("/");
    const dstParts = selectedEdgeData.target.split("/");

    const srcNamespace = srcParts[0] ?? "";
    const srcPod = srcParts[1] ?? "";
    const dstNamespace = dstParts[0] ?? "";
    const dstPod = dstParts[1] ?? "";
    const port = selectedEdgeData.data.port;
    const protocol = selectedEdgeData.data.protocol.toLowerCase();

    const params = new URLSearchParams({
      action: "create",
      policyAction,
      srcNamespace,
      srcPod,
      dstNamespace,
      dstPod,
      port: port.toString(),
      protocol,
    });
    router.push(`/policies?${params.toString()}`);
  };

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
                <Button variant="secondary" size="sm" className="w-full justify-start">
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  View Policies
                </Button>
                <Button variant="secondary" size="sm" className="w-full justify-start">
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  View Flows
                </Button>
              </div>
            </div>
          </div>
        )}

        {selectedEdgeId && selectedEdgeData && (
          <div className="space-y-4">
            {/* Flow Summary */}
            <div>
              <label className="text-xs text-muted uppercase tracking-wide">Traffic Flow</label>
              <div className="mt-1 space-y-1">
                <p className="text-sm text-foreground font-mono break-all">
                  {selectedEdgeData.source}
                </p>
                <p className="text-xs text-muted text-center">↓</p>
                <p className="text-sm text-foreground font-mono break-all">
                  {selectedEdgeData.target}
                </p>
              </div>
            </div>

            {/* Verdict */}
            <div>
              <label className="text-xs text-muted uppercase tracking-wide">Verdict</label>
              <div className="mt-1">
                <Badge
                  variant={
                    selectedEdgeData.data.verdict === "allowed" ? "success" :
                    selectedEdgeData.data.verdict === "denied" ? "danger" : "warning"
                  }
                >
                  {selectedEdgeData.data.verdict}
                </Badge>
              </div>
            </div>

            {/* Protocol & Port */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted uppercase tracking-wide">Protocol</label>
                <p className="text-sm text-foreground">{selectedEdgeData.data.protocol}</p>
              </div>
              <div>
                <label className="text-xs text-muted uppercase tracking-wide">Port</label>
                <p className="text-sm text-foreground">{selectedEdgeData.data.port}</p>
              </div>
            </div>

            {/* Flow Count */}
            <div>
              <label className="text-xs text-muted uppercase tracking-wide">Flow Count</label>
              <p className="text-sm text-foreground">{selectedEdgeData.data.flowCount.toLocaleString()}</p>
            </div>

            {/* Actions */}
            <div>
              <label className="text-xs text-muted uppercase tracking-wide">Actions</label>
              <div className="mt-2 space-y-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => {
                    // Navigate to policies page filtered by the destination namespace
                    const dstParts = selectedEdgeData.target.split("/");
                    const dstNamespace = dstParts[0] ?? "";
                    if (dstNamespace && dstNamespace !== "external-world") {
                      router.push(`/policies?namespace=${encodeURIComponent(dstNamespace)}`);
                    } else {
                      router.push("/policies");
                    }
                  }}
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  View Policies
                </Button>
              </div>
            </div>

            {/* Create Policy Actions */}
            <div>
              <label className="text-xs text-muted uppercase tracking-wide">Create Policy</label>
              <p className="text-xs text-muted mt-1 mb-2">
                {selectedEdgeData.data.verdict === "denied"
                  ? "This traffic is currently blocked. Create a policy to allow or explicitly deny it."
                  : selectedEdgeData.data.verdict === "allowed"
                  ? "This traffic is currently allowed. Create a policy to block or explicitly allow it."
                  : "No policy covers this traffic. Create one to control this flow."}
              </p>
              <div className="mt-2 space-y-2">
                <Button
                  variant="primary"
                  size="sm"
                  className="w-full justify-start bg-green-600 hover:bg-green-700"
                  onClick={() => {
                    navigateToCreatePolicy("allow");
                  }}
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Allow This Traffic
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  className="w-full justify-start bg-red-600 hover:bg-red-700"
                  onClick={() => {
                    navigateToCreatePolicy("deny");
                  }}
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                  Block This Traffic
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Fallback when edge is selected but no data available */}
        {selectedEdgeId && !selectedEdgeData && (
          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted uppercase tracking-wide">Flow ID</label>
              <p className="text-sm text-foreground font-mono break-all">{selectedEdgeId}</p>
            </div>
            <p className="text-sm text-muted">Select a flow line to see details.</p>
          </div>
        )}
      </div>
    </div>
  );
}
