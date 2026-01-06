"use client";

import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";

export type GatewayEdgeData = {
  routeType: "HTTPRoute" | "GRPCRoute" | "TCPRoute" | "TLSRoute";
  routeName?: string;
  hostnames?: string[];
  pathMatch?: string;
  weight?: number;
};

function GatewayEdgeComponent({
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
  const edgeData = data as GatewayEdgeData | undefined;
  const routeType = edgeData?.routeType ?? "HTTPRoute";

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const getEdgeStyle = () => {
    const baseStyle = {
      strokeWidth: selected ? 3 : 2,
      strokeDasharray: "none",
    };

    switch (routeType) {
      case "HTTPRoute":
        return { ...baseStyle, stroke: "#3b82f6" }; // blue
      case "GRPCRoute":
        return { ...baseStyle, stroke: "#8b5cf6" }; // purple
      case "TCPRoute":
        return { ...baseStyle, stroke: "#06b6d4" }; // cyan
      case "TLSRoute":
        return { ...baseStyle, stroke: "#14b8a6" }; // teal
      default:
        return { ...baseStyle, stroke: "#3b82f6" };
    }
  };

  const getRouteColor = () => {
    switch (routeType) {
      case "HTTPRoute":
        return "bg-blue-500/10 text-blue-500 border-blue-500/20";
      case "GRPCRoute":
        return "bg-purple-500/10 text-purple-500 border-purple-500/20";
      case "TCPRoute":
        return "bg-cyan-500/10 text-cyan-500 border-cyan-500/20";
      case "TLSRoute":
        return "bg-teal-500/10 text-teal-500 border-teal-500/20";
      default:
        return "bg-blue-500/10 text-blue-500 border-blue-500/20";
    }
  };

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={getEdgeStyle()} markerEnd="url(#gateway-arrow)" />
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
              ${getRouteColor()}
              ${selected ? "ring-2 ring-primary/20" : ""}
            `}
          >
            <div className="flex items-center gap-1.5">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              </svg>
              <span>{routeType}</span>
            </div>
            {edgeData?.pathMatch && (
              <div className="text-[10px] opacity-70 mt-0.5 truncate max-w-[120px]">
                {edgeData.pathMatch}
              </div>
            )}
            {edgeData?.weight !== undefined && edgeData.weight !== 100 && (
              <div className="text-[10px] opacity-70 mt-0.5">
                weight: {edgeData.weight}%
              </div>
            )}
          </div>
        </div>
      </EdgeLabelRenderer>
      <svg style={{ position: "absolute", width: 0, height: 0 }}>
        <defs>
          <marker
            id="gateway-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerUnits="strokeWidth"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={getEdgeStyle().stroke} />
          </marker>
        </defs>
      </svg>
    </>
  );
}

export const GatewayEdge = memo(GatewayEdgeComponent);
