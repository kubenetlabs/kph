"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

export type ExternalNodeData = {
  label: string;
  type: "cidr" | "fqdn" | "world";
  value?: string; // CIDR block or domain
};

function ExternalNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as ExternalNodeData;

  const getIcon = () => {
    switch (nodeData.type) {
      case "cidr":
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
          </svg>
        );
      case "fqdn":
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case "world":
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
    }
  };

  return (
    <div
      className={`
        px-4 py-3 rounded-full border-2 bg-card shadow-md
        ${selected ? "border-primary ring-2 ring-primary/20" : "border-border"}
      `}
    >
      <Handle type="target" position={Position.Top} className="!bg-primary !w-2 !h-2" />

      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-full bg-muted text-muted-foreground">
          {getIcon()}
        </div>
        <div>
          <div className="text-sm font-medium text-foreground">{nodeData.label}</div>
          {nodeData.value && (
            <div className="text-xs text-muted">{nodeData.value}</div>
          )}
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-primary !w-2 !h-2" />
    </div>
  );
}

export const ExternalNode = memo(ExternalNodeComponent);
