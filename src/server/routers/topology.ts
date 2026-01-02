import { z } from "zod";
import { createTRPCRouter, orgProtectedProcedure } from "../trpc";

/**
 * Topology router
 * Provides data for the policy topology visualization
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
      // Get policies for this cluster
      const policies = await ctx.db.policy.findMany({
        where: {
          organizationId: ctx.organizationId,
          deployments: {
            some: {
              clusterId: input.clusterId,
            },
          },
        },
        include: {
          deployments: {
            where: { clusterId: input.clusterId },
          },
        },
      });

      // For now, generate sample topology based on policies
      // In production, this would come from the validation agent
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

      // Create namespace nodes and workload nodes from policies
      const namespaces = new Set<string>();
      const workloads = new Map<string, { namespace: string; labels: Record<string, string> }>();

      for (const policy of policies) {
        // Parse policy YAML to extract endpoints
        try {
          const yaml = policy.yamlContent;
          // Extract namespace from metadata
          const nsMatch = yaml.match(/namespace:\s*(\S+)/);
          const ns = nsMatch?.[1] ?? "default";
          namespaces.add(ns);

          // Create a workload node for the policy target
          const workloadId = `workload-${policy.name}`;
          workloads.set(workloadId, {
            namespace: ns,
            labels: {},
          });
        } catch (e) {
          // Skip invalid policies
        }
      }

      // Generate node positions
      let yOffset = 0;
      for (const ns of namespaces) {
        // Add namespace node
        nodes.push({
          id: `ns-${ns}`,
          type: "namespace",
          position: { x: 0, y: yOffset },
          data: {
            label: ns,
            workloadCount: Array.from(workloads.values()).filter((w) => w.namespace === ns).length,
            policyCount: policies.filter((p) => p.yamlContent.includes(`namespace: ${ns}`)).length,
          },
        });

        // Add workload nodes within this namespace
        let xOffset = 50;
        for (const [workloadId, workload] of workloads) {
          if (workload.namespace === ns) {
            nodes.push({
              id: workloadId,
              type: "workload",
              position: { x: xOffset, y: yOffset + 80 },
              data: {
                label: workloadId.replace("workload-", ""),
                namespace: ns,
                kind: "Deployment",
                policyCount: 1,
              },
            });
            xOffset += 200;
          }
        }

        yOffset += 250;
      }

      // Add external world node if there are any policies
      if (policies.length > 0) {
        nodes.push({
          id: "external-world",
          type: "external",
          position: { x: 300, y: -100 },
          data: {
            label: "External",
            type: "world",
          },
        });

        // Add edges from external to workloads
        for (const [workloadId] of workloads) {
          edges.push({
            id: `edge-external-${workloadId}`,
            source: "external-world",
            target: workloadId,
            type: "flow",
            data: {
              verdict: "allowed",
              flowCount: Math.floor(Math.random() * 100) + 10,
              protocol: "TCP",
              port: 443,
            },
          });
        }
      }

      return {
        nodes,
        edges,
        summary: {
          totalNodes: nodes.length,
          totalEdges: edges.length,
          allowedFlows: edges.filter((e) => e.data.verdict === "allowed").length,
          deniedFlows: edges.filter((e) => e.data.verdict === "denied").length,
          unprotectedFlows: edges.filter((e) => e.data.verdict === "no-policy").length,
          policyCount: policies.length,
        },
      };
    }),

  /**
   * Get available namespaces for filtering
   */
  getNamespaces: orgProtectedProcedure
    .input(z.object({ clusterId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Get unique namespaces from policies
      const policies = await ctx.db.policy.findMany({
        where: {
          organizationId: ctx.organizationId,
          deployments: {
            some: {
              clusterId: input.clusterId,
            },
          },
        },
        select: {
          yamlContent: true,
        },
      });

      const namespaces = new Set<string>();
      for (const policy of policies) {
        const nsMatch = policy.yamlContent.match(/namespace:\s*(\S+)/);
        if (nsMatch?.[1]) {
          namespaces.add(nsMatch[1]);
        }
      }

      return Array.from(namespaces).sort();
    }),
});
