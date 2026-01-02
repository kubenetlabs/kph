"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

export type WorkloadNodeData = {
  label: string;
  namespace: string;
  kind: "Deployment" | "StatefulSet" | "DaemonSet" | "Pod";
  replicas?: number;
  policyCount?: number;
  hasGap?: boolean;
};

function WorkloadNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as WorkloadNodeData;

  return (
    <div
      className={`
        px-4 py-3 rounded-lg border-2 bg-card shadow-md min-w-[140px]
        ${selected ? "border-primary ring-2 ring-primary/20" : "border-border"}
        ${nodeData.hasGap ? "border-warning" : ""}
      `}
    >
      <Handle type="target" position={Position.Top} className="!bg-primary !w-2 !h-2" />

      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded bg-primary/10">
          <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground truncate">{nodeData.label}</div>
          <div className="text-xs text-muted truncate">{nodeData.namespace}</div>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2 text-xs text-muted">
        <span className="px-1.5 py-0.5 rounded bg-muted/50">{nodeData.kind}</span>
        {nodeData.replicas !== undefined && (
          <span>{nodeData.replicas} replicas</span>
        )}
      </div>

      {nodeData.policyCount !== undefined && nodeData.policyCount > 0 && (
        <div className="mt-1.5 flex items-center gap-1 text-xs text-primary">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <span>{nodeData.policyCount} policies</span>
        </div>
      )}

      {nodeData.hasGap && (
        <div className="mt-1.5 flex items-center gap-1 text-xs text-warning">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>Coverage gap</span>
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-primary !w-2 !h-2" />
    </div>
  );
}

export const WorkloadNode = memo(WorkloadNodeComponent);
