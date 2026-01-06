"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

export type GatewayNodeData = {
  label: string;
  namespace: string;
  kind: "Gateway" | "HTTPRoute" | "GRPCRoute" | "TCPRoute" | "TLSRoute";
  listeners?: { port: number; protocol: string }[];
  hostnames?: string[];
  routeCount?: number;
};

function GatewayNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as GatewayNodeData;
  const isGateway = nodeData.kind === "Gateway";

  return (
    <div
      className={`
        px-4 py-3 rounded-lg border-2 bg-card shadow-md min-w-[160px]
        ${selected ? "border-blue-500 ring-2 ring-blue-500/20" : "border-border"}
      `}
    >
      <Handle type="target" position={Position.Top} className="!bg-blue-500 !w-2 !h-2" />

      <div className="flex items-center gap-2">
        <div className={`p-1.5 rounded ${isGateway ? "bg-blue-500/10" : "bg-cyan-500/10"}`}>
          {isGateway ? (
            <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-cyan-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground truncate">{nodeData.label}</div>
          <div className="text-xs text-muted truncate">{nodeData.namespace}</div>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2 text-xs text-muted">
        <span className={`px-1.5 py-0.5 rounded ${isGateway ? "bg-blue-500/10 text-blue-400" : "bg-cyan-500/10 text-cyan-400"}`}>
          {nodeData.kind}
        </span>
      </div>

      {isGateway && nodeData.listeners && nodeData.listeners.length > 0 && (
        <div className="mt-2 space-y-1">
          {nodeData.listeners.slice(0, 3).map((listener, i) => (
            <div key={i} className="text-xs text-muted flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              <span>{listener.protocol}:{listener.port}</span>
            </div>
          ))}
          {nodeData.listeners.length > 3 && (
            <div className="text-xs text-muted">+{nodeData.listeners.length - 3} more</div>
          )}
        </div>
      )}

      {!isGateway && nodeData.hostnames && nodeData.hostnames.length > 0 && (
        <div className="mt-2 space-y-1">
          {nodeData.hostnames.slice(0, 2).map((hostname, i) => (
            <div key={i} className="text-xs text-muted truncate flex items-center gap-1">
              <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
              </svg>
              <span className="truncate">{hostname}</span>
            </div>
          ))}
          {nodeData.hostnames.length > 2 && (
            <div className="text-xs text-muted">+{nodeData.hostnames.length - 2} more</div>
          )}
        </div>
      )}

      {isGateway && nodeData.routeCount !== undefined && nodeData.routeCount > 0 && (
        <div className="mt-1.5 flex items-center gap-1 text-xs text-blue-400">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
          <span>{nodeData.routeCount} routes</span>
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-blue-500 !w-2 !h-2" />
    </div>
  );
}

export const GatewayNode = memo(GatewayNodeComponent);
