import { z } from "zod";
import { createTRPCRouter, orgProtectedProcedure } from "../trpc";

/**
 * Topology router
 * Provides data for the policy topology visualization using real flow data
 */
export const topologyRouter = createTRPCRouter({
  /**
   * Get topology graph data for a cluster
   */
  getGraph: orgProtectedProcedure
    .input(
      z.object({
        clusterId: z.string(),
        mode: z.enum(["live", "simulation"]).default("live"),
        filters: z
          .object({
            namespaces: z.array(z.string()).optional(),
            verdict: z.enum(["all", "allowed", "denied", "no-policy"]).optional(),
            timeRange: z.enum(["5m", "15m", "1h", "24h"]).optional(),
          })
          .optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Calculate time range
      const timeRangeMinutes = {
        "5m": 5,
        "15m": 15,
        "1h": 60,
        "24h": 1440,
      }[input.filters?.timeRange ?? "1h"];

      const since = new Date(Date.now() - timeRangeMinutes * 60 * 1000);

      // Query flow summaries for this cluster
      // Run two queries in parallel: one for recent flows, one for dropped/denied flows
      // This ensures policy-blocked traffic is visible even with high flow volumes
      const baseWhere = {
        clusterId: input.clusterId,
        timestamp: { gte: since },
        ...(input.filters?.namespaces?.length ? {
          OR: [
            { srcNamespace: { in: input.filters.namespaces } },
            { dstNamespace: { in: input.filters.namespaces } },
          ],
        } : {}),
      };

      const [recentFlows, policyBlockedFlows] = await Promise.all([
        ctx.db.flowSummary.findMany({
          where: baseWhere,
          orderBy: { timestamp: "desc" },
          take: 2000,
        }),
        // Ensure dropped/denied flows are always included
        ctx.db.flowSummary.findMany({
          where: {
            ...baseWhere,
            OR: [
              { droppedFlows: { gt: 0 } },
              { deniedFlows: { gt: 0 } },
            ],
          },
          orderBy: { timestamp: "desc" },
          take: 500,
        }),
      ]);

      // Merge and deduplicate by id
      const flowMap = new Map<string, typeof recentFlows[0]>();
      for (const flow of [...recentFlows, ...policyBlockedFlows]) {
        flowMap.set(flow.id, flow);
      }
      const flowSummaries = Array.from(flowMap.values());

      // Build nodes and edges from flow data
      const nodes: Array<{
        id: string;
        type: string;
        position: { x: number; y: number };
        data: Record<string, unknown>;
      }> = [];
      const edges: Array<{
        id: string;
        source: string;
        target: string;
        type: string;
        data: Record<string, unknown>;
      }> = [];

      // Track unique endpoints and namespaces
      const namespaces = new Map<string, { workloadCount: number; flowCount: number }>();
      const endpoints = new Map<string, {
        namespace: string;
        podName: string | null;
        flowCount: number;
        isExternal: boolean;
      }>();

      // Aggregate flows between endpoints
      // Note: "deniedFlows" in the aggregate combines both deniedFlows and droppedFlows
      // from the database, as Hubble marks policy-blocked traffic as DROPPED
      const flowAggregates = new Map<string, {
        srcId: string;
        dstId: string;
        totalFlows: bigint;
        allowedFlows: bigint;
        deniedFlows: bigint;
        port: number;
        protocol: string;
      }>();

      // Process flow summaries
      for (const flow of flowSummaries) {
        // Track source endpoint
        const srcIsExternal = !flow.srcNamespace || flow.srcNamespace === "" || flow.srcNamespace === "external";
        const srcId = srcIsExternal
          ? "external-world"
          : `${flow.srcNamespace}/${flow.srcPodName ?? "unknown"}`;

        if (!endpoints.has(srcId)) {
          endpoints.set(srcId, {
            namespace: flow.srcNamespace || "external",
            podName: flow.srcPodName,
            flowCount: 0,
            isExternal: srcIsExternal,
          });
        }
        const srcEndpoint = endpoints.get(srcId)!;
        srcEndpoint.flowCount += Number(flow.totalFlows);

        // Track destination endpoint
        const dstIsExternal = !flow.dstNamespace || flow.dstNamespace === "" || flow.dstNamespace === "external";
        const dstId = dstIsExternal
          ? "external-world"
          : `${flow.dstNamespace}/${flow.dstPodName ?? "unknown"}`;

        if (!endpoints.has(dstId)) {
          endpoints.set(dstId, {
            namespace: flow.dstNamespace || "external",
            podName: flow.dstPodName,
            flowCount: 0,
            isExternal: dstIsExternal,
          });
        }
        const dstEndpoint = endpoints.get(dstId)!;
        dstEndpoint.flowCount += Number(flow.totalFlows);

        // Track namespaces
        if (!srcIsExternal) {
          if (!namespaces.has(flow.srcNamespace)) {
            namespaces.set(flow.srcNamespace, { workloadCount: 0, flowCount: 0 });
          }
          namespaces.get(flow.srcNamespace)!.flowCount += Number(flow.totalFlows);
        }
        if (!dstIsExternal) {
          if (!namespaces.has(flow.dstNamespace)) {
            namespaces.set(flow.dstNamespace, { workloadCount: 0, flowCount: 0 });
          }
          namespaces.get(flow.dstNamespace)!.flowCount += Number(flow.totalFlows);
        }

        // Aggregate flows between this source and destination
        const edgeKey = `${srcId}->${dstId}:${flow.dstPort}`;
        if (!flowAggregates.has(edgeKey)) {
          flowAggregates.set(edgeKey, {
            srcId,
            dstId,
            totalFlows: BigInt(0),
            allowedFlows: BigInt(0),
            deniedFlows: BigInt(0),
            port: flow.dstPort,
            protocol: flow.protocol,
          });
        }
        const agg = flowAggregates.get(edgeKey)!;
        agg.totalFlows += flow.totalFlows;
        agg.allowedFlows += flow.allowedFlows;
        // Combine deniedFlows + droppedFlows since Hubble uses DROPPED for policy blocks
        agg.deniedFlows += flow.deniedFlows + (flow.droppedFlows ?? BigInt(0));
      }

      // Count workloads per namespace
      for (const [, endpoint] of endpoints) {
        if (!endpoint.isExternal && namespaces.has(endpoint.namespace)) {
          namespaces.get(endpoint.namespace)!.workloadCount++;
        }
      }

      // Generate namespace nodes with layout
      let nsY = 0;
      const nsPositions = new Map<string, { x: number; y: number }>();

      for (const [ns, data] of namespaces) {
        const position = { x: 100, y: nsY };
        nsPositions.set(ns, position);

        nodes.push({
          id: `ns-${ns}`,
          type: "namespace",
          position,
          data: {
            label: ns,
            workloadCount: data.workloadCount,
            flowCount: data.flowCount,
          },
        });
        nsY += 300;
      }

      // Generate workload nodes within their namespaces
      const workloadPositions = new Map<string, { x: number; y: number }>();
      const nsWorkloadIndex = new Map<string, number>();

      for (const [id, endpoint] of endpoints) {
        if (endpoint.isExternal) continue;

        const nsPos = nsPositions.get(endpoint.namespace) ?? { x: 100, y: 0 };
        const workloadIdx = nsWorkloadIndex.get(endpoint.namespace) ?? 0;
        nsWorkloadIndex.set(endpoint.namespace, workloadIdx + 1);

        const position = {
          x: nsPos.x + 50 + (workloadIdx % 4) * 180,
          y: nsPos.y + 80 + Math.floor(workloadIdx / 4) * 100,
        };
        workloadPositions.set(id, position);

        // Extract pod name for display
        const displayName = endpoint.podName ?? id.split("/")[1] ?? "unknown";

        nodes.push({
          id,
          type: "workload",
          position,
          data: {
            label: displayName.length > 25 ? displayName.substring(0, 22) + "..." : displayName,
            fullLabel: displayName,
            namespace: endpoint.namespace,
            kind: "Pod",
            flowCount: endpoint.flowCount,
          },
        });
      }

      // Add external node if needed
      const hasExternal = endpoints.has("external-world");
      if (hasExternal) {
        nodes.push({
          id: "external-world",
          type: "external",
          position: { x: 400, y: -80 },
          data: {
            label: "External",
            type: "world",
            flowCount: endpoints.get("external-world")?.flowCount ?? 0,
          },
        });
        workloadPositions.set("external-world", { x: 400, y: -80 });
      }

      // Generate edges from flow aggregates
      for (const [, agg] of flowAggregates) {
        // Skip self-loops
        if (agg.srcId === agg.dstId) continue;

        // Determine verdict based on flow counts
        let verdict: "allowed" | "denied" | "no-policy" = "allowed";
        if (agg.deniedFlows > BigInt(0) && agg.allowedFlows === BigInt(0)) {
          verdict = "denied";
        } else if (agg.deniedFlows > BigInt(0)) {
          // Mixed - some allowed, some denied
          verdict = Number(agg.deniedFlows) > Number(agg.allowedFlows) ? "denied" : "allowed";
        }

        // Apply verdict filter
        if (input.filters?.verdict && input.filters.verdict !== "all") {
          if (input.filters.verdict !== verdict) continue;
        }

        edges.push({
          id: `edge-${agg.srcId}-${agg.dstId}-${agg.port}`,
          source: agg.srcId,
          target: agg.dstId,
          type: "flow",
          data: {
            verdict,
            flowCount: Number(agg.totalFlows),
            allowedCount: Number(agg.allowedFlows),
            deniedCount: Number(agg.deniedFlows),
            protocol: agg.protocol,
            port: agg.port,
          },
        });
      }

      // Calculate summary stats
      const allowedFlows = edges.filter((e) => e.data.verdict === "allowed").length;
      const deniedFlows = edges.filter((e) => e.data.verdict === "denied").length;
      const unprotectedFlows = edges.filter((e) => e.data.verdict === "no-policy").length;

      // Debug: log query results
      console.log("[topology] Query results:", {
        recentFlowsCount: recentFlows.length,
        policyBlockedFlowsCount: policyBlockedFlows.length,
        mergedFlowsCount: flowSummaries.length,
        edgesCount: edges.length,
        deniedEdgesCount: deniedFlows,
        droppedFlowsInData: policyBlockedFlows.filter(f => f.droppedFlows > 0n).length,
      });

      return {
        nodes,
        edges,
        summary: {
          totalNodes: nodes.length,
          totalEdges: edges.length,
          allowedFlows,
          deniedFlows,
          unprotectedFlows,
          policyCount: 0, // Would need to join with policies
          dataAge: flowSummaries[0]
            ? Math.floor((Date.now() - flowSummaries[0].timestamp.getTime()) / 1000)
            : null,
        },
      };
    }),

  /**
   * Get available namespaces for filtering (from flow data)
   */
  getNamespaces: orgProtectedProcedure
    .input(z.object({ clusterId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Get unique namespaces from recent flow summaries
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // Last 24 hours

      const flows = await ctx.db.flowSummary.findMany({
        where: {
          clusterId: input.clusterId,
          timestamp: { gte: since },
        },
        select: {
          srcNamespace: true,
          dstNamespace: true,
        },
        distinct: ["srcNamespace", "dstNamespace"],
      });

      const namespaces = new Set<string>();
      for (const flow of flows) {
        if (flow.srcNamespace && flow.srcNamespace !== "external") {
          namespaces.add(flow.srcNamespace);
        }
        if (flow.dstNamespace && flow.dstNamespace !== "external") {
          namespaces.add(flow.dstNamespace);
        }
      }

      // Also get namespaces from policies as fallback
      const policies = await ctx.db.policy.findMany({
        where: {
          organizationId: ctx.organizationId,
          clusterId: input.clusterId,
        },
        select: {
          content: true,
        },
      });

      for (const policy of policies) {
        const nsMatch = policy.content.match(/namespace:\s*(\S+)/);
        if (nsMatch?.[1]) {
          namespaces.add(nsMatch[1]);
        }
      }

      return Array.from(namespaces).sort();
    }),
});
