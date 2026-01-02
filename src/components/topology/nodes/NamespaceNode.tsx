"use client";

import { memo } from "react";
import { type NodeProps } from "@xyflow/react";

export type NamespaceNodeData = {
  label: string;
  workloadCount?: number;
  policyCount?: number;
};

function NamespaceNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as NamespaceNodeData;

  return (
    <div
      className={`
        px-4 py-2 rounded-xl border-2 border-dashed bg-muted/20 min-w-[200px] min-h-[100px]
        ${selected ? "border-primary" : "border-border"}
      `}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="p-1 rounded bg-muted">
          <svg className="w-3 h-3 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        </div>
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {nodeData.label}
        </span>
      </div>

      {(nodeData.workloadCount !== undefined || nodeData.policyCount !== undefined) && (
        <div className="flex gap-3 text-xs text-muted">
          {nodeData.workloadCount !== undefined && (
            <span>{nodeData.workloadCount} workloads</span>
          )}
          {nodeData.policyCount !== undefined && (
            <span>{nodeData.policyCount} policies</span>
          )}
        </div>
      )}
    </div>
  );
}

export const NamespaceNode = memo(NamespaceNodeComponent);
