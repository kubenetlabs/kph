"use client";

import { useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Node,
  type Edge,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { WorkloadNode } from "./nodes/WorkloadNode";
import { NamespaceNode } from "./nodes/NamespaceNode";
import { ExternalNode } from "./nodes/ExternalNode";
import { GatewayNode } from "./nodes/GatewayNode";
import { FlowEdge } from "./edges/FlowEdge";
import { GatewayEdge } from "./edges/GatewayEdge";
import { useTopologyStore } from "~/stores/topology-store";

// Register custom node types
const nodeTypes = {
  workload: WorkloadNode,
  namespace: NamespaceNode,
  external: ExternalNode,
  gateway: GatewayNode,
};

// Register custom edge types
const edgeTypes = {
  flow: FlowEdge,
  gateway: GatewayEdge,
};

export type TopologyMapProps = {
  initialNodes?: Node[];
  initialEdges?: Edge[];
  onNodeClick?: (nodeId: string) => void;
  onEdgeClick?: (edgeId: string) => void;
};

export function TopologyMap({
  initialNodes = [],
  initialEdges = [],
  onNodeClick,
  onEdgeClick,
}: TopologyMapProps) {
  const { setSelectedNode, setSelectedEdge, selectedNodeId, selectedEdgeId } = useTopologyStore();

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setSelectedNode(node.id);
      onNodeClick?.(node.id);
    },
    [setSelectedNode, onNodeClick]
  );

  const handleEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      setSelectedEdge(edge.id);
      onEdgeClick?.(edge.id);
    },
    [setSelectedEdge, onEdgeClick]
  );

  const handlePaneClick = useCallback(() => {
    setSelectedNode(null);
    setSelectedEdge(null);
  }, [setSelectedNode, setSelectedEdge]);

  // Apply selection styles
  const styledNodes = useMemo(() => {
    return nodes.map((node) => ({
      ...node,
      selected: node.id === selectedNodeId,
    }));
  }, [nodes, selectedNodeId]);

  const styledEdges = useMemo(() => {
    return edges.map((edge) => ({
      ...edge,
      selected: edge.id === selectedEdgeId,
    }));
  }, [edges, selectedEdgeId]);

  return (
    <div className="w-full h-full bg-background">
      <ReactFlow
        nodes={styledNodes}
        edges={styledEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        className="bg-background"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#333" />
        <Controls className="!bg-card !border-border !shadow-lg [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-muted" />
        <MiniMap
          className="!bg-card !border-border"
          nodeColor={(node) => {
            switch (node.type) {
              case "workload":
                return "#3b82f6";
              case "namespace":
                return "#6b7280";
              case "external":
                return "#8b5cf6";
              case "gateway":
                return "#0ea5e9";
              default:
                return "#6b7280";
            }
          }}
        />
      </ReactFlow>
    </div>
  );
}
