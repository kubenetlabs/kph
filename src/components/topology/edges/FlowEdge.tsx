"use client";

import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";

export type FlowEdgeData = {
  verdict: "allowed" | "denied" | "no-policy";
  flowCount?: number;
  protocol?: string;
  port?: number;
  policyName?: string;
};

function FlowEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const edgeData = data as FlowEdgeData | undefined;
  const verdict = edgeData?.verdict ?? "no-policy";

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const getEdgeStyle = () => {
    switch (verdict) {
      case "allowed":
        return {
          stroke: "#22c55e", // green
          strokeWidth: selected ? 3 : 2,
          strokeDasharray: "none",
        };
      case "denied":
        return {
          stroke: "#ef4444", // red
          strokeWidth: selected ? 3 : 2,
          strokeDasharray: "5,5",
        };
      case "no-policy":
        return {
          stroke: "#f59e0b", // amber
          strokeWidth: selected ? 3 : 2,
          strokeDasharray: "2,4",
        };
    }
  };

  const getVerdictLabel = () => {
    switch (verdict) {
      case "allowed":
        return "ALLOWED";
      case "denied":
        return "DENIED";
      case "no-policy":
        return "NO POLICY";
    }
  };

  const getVerdictColor = () => {
    switch (verdict) {
      case "allowed":
        return "bg-green-500/10 text-green-500 border-green-500/20";
      case "denied":
        return "bg-red-500/10 text-red-500 border-red-500/20";
      case "no-policy":
        return "bg-amber-500/10 text-amber-500 border-amber-500/20";
    }
  };

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={getEdgeStyle()} />
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: "all",
          }}
          className="nodrag nopan"
        >
          <div
            className={`
              px-2 py-1 rounded text-xs font-medium border
              ${getVerdictColor()}
              ${selected ? "ring-2 ring-primary/20" : ""}
            `}
          >
            <div className="flex items-center gap-1.5">
              <span>{getVerdictLabel()}</span>
              {edgeData?.flowCount !== undefined && (
                <span className="opacity-70">({edgeData.flowCount})</span>
              )}
            </div>
            {edgeData?.port && (
              <div className="text-[10px] opacity-70 mt-0.5">
                {edgeData.protocol ?? "TCP"}:{edgeData.port}
              </div>
            )}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const FlowEdge = memo(FlowEdgeComponent);
