import { z } from "zod";
import { Prisma } from "@prisma/client";
import { createTRPCRouter, orgProtectedProcedure } from "../trpc";

/**
 * Schema for aggregated flow data from raw SQL query
 * Used to validate and type the GROUP BY results
 */
const AggregatedFlowSchema = z.object({
  srcNamespace: z.string().nullable(),
  srcPodName: z.string().nullable(),
  dstNamespace: z.string().nullable(),
  dstPodName: z.string().nullable(),
  dstPort: z.number(),
  protocol: z.string(),
  total_flows: z.bigint(),
  allowed_flows: z.bigint(),
  denied_flows: z.bigint(),
  dropped_flows: z.bigint(),
});

type AggregatedFlow = z.infer<typeof AggregatedFlowSchema>;

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

      // Build namespace filter SQL fragment for raw query
      const namespaceFilterSql = input.filters?.namespaces?.length
        ? Prisma.sql`AND ("srcNamespace" = ANY(${input.filters.namespaces}) OR "dstNamespace" = ANY(${input.filters.namespaces}))`
        : Prisma.empty;

      // Single aggregated query - much faster than fetching 700 raw records
      // Database does the GROUP BY, reducing data transfer and JS processing
      const aggregatedFlows = await ctx.db.$queryRaw<AggregatedFlow[]>`
        SELECT
          "srcNamespace",
          "srcPodName",
          "dstNamespace",
          "dstPodName",
          "dstPort",
          "protocol",
          SUM("totalFlows")::bigint as total_flows,
          SUM("allowedFlows")::bigint as allowed_flows,
          SUM("deniedFlows")::bigint as denied_flows,
          COALESCE(SUM("droppedFlows"), 0)::bigint as dropped_flows
        FROM "flow_summaries"
        WHERE "clusterId" = ${input.clusterId}
          AND ("timestamp" >= ${since} OR "windowStart" >= ${since})
          ${namespaceFilterSql}
        GROUP BY "srcNamespace", "srcPodName", "dstNamespace", "dstPodName", "dstPort", "protocol"
      `;

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

      // Process pre-aggregated flows from database
      // Data is already grouped by src/dst/port/protocol, so we just need to track endpoints/namespaces
      // Note: "deniedFlows" combines both deniedFlows and droppedFlows since Hubble uses DROPPED for policy blocks
      const flowAggregates: Array<{
        srcId: string;
        dstId: string;
        totalFlows: bigint;
        allowedFlows: bigint;
        deniedFlows: bigint;
        port: number;
        protocol: string;
      }> = [];

      for (const flow of aggregatedFlows) {
        // Track source endpoint
        const srcIsExternal = !flow.srcNamespace || flow.srcNamespace === "" || flow.srcNamespace === "external";
        const srcId = srcIsExternal
          ? "external-world"
          : `${flow.srcNamespace}/${flow.srcPodName ?? "unknown"}`;

        if (!endpoints.has(srcId)) {
          endpoints.set(srcId, {
            namespace: flow.srcNamespace ?? "external",
            podName: flow.srcPodName,
            flowCount: 0,
            isExternal: srcIsExternal,
          });
        }
        const srcEndpoint = endpoints.get(srcId)!;
        srcEndpoint.flowCount += Number(flow.total_flows);

        // Track destination endpoint
        const dstIsExternal = !flow.dstNamespace || flow.dstNamespace === "" || flow.dstNamespace === "external";
        const dstId = dstIsExternal
          ? "external-world"
          : `${flow.dstNamespace}/${flow.dstPodName ?? "unknown"}`;

        if (!endpoints.has(dstId)) {
          endpoints.set(dstId, {
            namespace: flow.dstNamespace ?? "external",
            podName: flow.dstPodName,
            flowCount: 0,
            isExternal: dstIsExternal,
          });
        }
        const dstEndpoint = endpoints.get(dstId)!;
        dstEndpoint.flowCount += Number(flow.total_flows);

        // Track namespaces
        if (!srcIsExternal && flow.srcNamespace) {
          if (!namespaces.has(flow.srcNamespace)) {
            namespaces.set(flow.srcNamespace, { workloadCount: 0, flowCount: 0 });
          }
          namespaces.get(flow.srcNamespace)!.flowCount += Number(flow.total_flows);
        }
        if (!dstIsExternal && flow.dstNamespace) {
          if (!namespaces.has(flow.dstNamespace)) {
            namespaces.set(flow.dstNamespace, { workloadCount: 0, flowCount: 0 });
          }
          namespaces.get(flow.dstNamespace)!.flowCount += Number(flow.total_flows);
        }

        // Add to flow aggregates (already aggregated by database GROUP BY)
        // Combine deniedFlows + droppedFlows since Hubble uses DROPPED for policy blocks
        flowAggregates.push({
          srcId,
          dstId,
          totalFlows: flow.total_flows,
          allowedFlows: flow.allowed_flows,
          deniedFlows: flow.denied_flows + flow.dropped_flows,
          port: flow.dstPort,
          protocol: flow.protocol,
        });
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
      // Create separate edges for allowed and denied traffic when both exist
      for (const agg of flowAggregates) {
        // Skip self-loops
        if (agg.srcId === agg.dstId) continue;

        const hasAllowed = agg.allowedFlows > BigInt(0);
        const hasDenied = agg.deniedFlows > BigInt(0);

        // Create allowed edge if there are allowed flows
        if (hasAllowed) {
          const verdict = "allowed";
          if (!input.filters?.verdict || input.filters.verdict === "all" || input.filters.verdict === verdict) {
            edges.push({
              id: `edge-${agg.srcId}-${agg.dstId}-${agg.port}-allowed`,
              source: agg.srcId,
              target: agg.dstId,
              type: "flow",
              data: {
                verdict,
                flowCount: Number(agg.allowedFlows),
                allowedCount: Number(agg.allowedFlows),
                deniedCount: 0,
                protocol: agg.protocol,
                port: agg.port,
              },
            });
          }
        }

        // Create denied edge if there are denied/dropped flows
        if (hasDenied) {
          const verdict = "denied";
          if (!input.filters?.verdict || input.filters.verdict === "all" || input.filters.verdict === verdict) {
            edges.push({
              id: `edge-${agg.srcId}-${agg.dstId}-${agg.port}-denied`,
              source: agg.srcId,
              target: agg.dstId,
              type: "flow",
              data: {
                verdict,
                flowCount: Number(agg.deniedFlows),
                allowedCount: 0,
                deniedCount: Number(agg.deniedFlows),
                protocol: agg.protocol,
                port: agg.port,
              },
            });
          }
        }

        // If neither allowed nor denied, it's no-policy (shouldn't happen often)
        if (!hasAllowed && !hasDenied) {
          const verdict = "no-policy";
          if (!input.filters?.verdict || input.filters.verdict === "all" || input.filters.verdict === verdict) {
            edges.push({
              id: `edge-${agg.srcId}-${agg.dstId}-${agg.port}`,
              source: agg.srcId,
              target: agg.dstId,
              type: "flow",
              data: {
                verdict,
                flowCount: Number(agg.totalFlows),
                allowedCount: 0,
                deniedCount: 0,
                protocol: agg.protocol,
                port: agg.port,
              },
            });
          }
        }
      }

      // Calculate summary stats
      const allowedFlows = edges.filter((e) => e.data.verdict === "allowed").length;
      const deniedFlows = edges.filter((e) => e.data.verdict === "denied").length;
      const unprotectedFlows = edges.filter((e) => e.data.verdict === "no-policy").length;

      return {
        nodes,
        edges,
        namespaces: Array.from(namespaces.keys()).sort(), // Derived from flow data
        summary: {
          totalNodes: nodes.length,
          totalEdges: edges.length,
          allowedFlows,
          deniedFlows,
          unprotectedFlows,
          policyCount: 0, // Would need to join with policies
          dataAge: aggregatedFlows.length > 0 ? 0 : null, // Data is fresh from query
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
          OR: [
            { timestamp: { gte: since } },
            { windowStart: { gte: since } },
          ],
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

  /**
   * Get recent process events (Tetragon telemetry) for runtime security visibility
   * Uses processValidationEvent table which receives data from the collector
   */
  getProcessEvents: orgProtectedProcedure
    .input(
      z.object({
        clusterId: z.string(),
        timeRange: z.enum(["5m", "15m", "1h", "24h"]).default("1h"),
        namespace: z.string().optional(),
        suspicious: z.boolean().optional(), // Filter to only suspicious events
      })
    )
    .query(async ({ ctx, input }) => {
      const timeRangeMinutes = {
        "5m": 5,
        "15m": 15,
        "1h": 60,
        "24h": 1440,
      }[input.timeRange];

      const since = new Date(Date.now() - timeRangeMinutes * 60 * 1000);

      // Suspicious binary patterns for ILIKE ANY query
      // Uses pattern matching: %/sh matches paths ending in /sh (e.g., /bin/sh)
      const suspiciousBinaryPatterns = [
        '%/sh', '%/bash', '%/zsh', '%/dash', '%/ash',      // Shells
        '%/curl', '%/wget', '%/nc', '%/netcat', '%/ncat',  // Network tools
        '%/python', '%/python3', '%/perl', '%/ruby',       // Scripting languages
        '%/chmod', '%/chown', '%/base64', '%/xxd',         // System tools
        '%/nmap', '%/masscan',                              // Scanning tools
        '%/cat', '%/head', '%/tail', '%/less', '%/more',   // File readers
      ];

      // Suspicious binaries list for client-side categorization
      const suspiciousBinaries = [
        "sh", "bash", "zsh", "dash", "ash",
        "curl", "wget", "nc", "netcat", "ncat",
        "python", "python3", "perl", "ruby",
        "chmod", "chown", "base64", "xxd",
        "nmap", "masscan",
        "cat", "head", "tail", "less", "more",
      ];

      // Build namespace filter SQL fragment
      const namespaceFilterSql = input.namespace
        ? Prisma.sql`AND "namespace" = ${input.namespace}`
        : Prisma.empty;

      // Query processValidationEvent table
      // Use raw SQL with ILIKE ANY for suspicious filter (much faster than 21 OR conditions)
      // Use Prisma findMany for non-suspicious (simpler, type-safe)
      type ProcessValidationEventRow = {
        id: string;
        timestamp: Date;
        namespace: string;
        podName: string | null;
        binary: string;
        arguments: string | null;
        verdict: string;
      };

      const processEvents: ProcessValidationEventRow[] = input.suspicious
        ? await ctx.db.$queryRaw<ProcessValidationEventRow[]>`
            SELECT "id", "timestamp", "namespace", "podName", "binary", "arguments", "verdict"
            FROM "process_validation_events"
            WHERE "clusterId" = ${input.clusterId}
              AND "timestamp" >= ${since}
              ${namespaceFilterSql}
              AND "binary" ILIKE ANY(${suspiciousBinaryPatterns})
            ORDER BY "timestamp" DESC
            LIMIT 200
          `
        : await ctx.db.processValidationEvent.findMany({
            where: {
              clusterId: input.clusterId,
              timestamp: { gte: since },
              ...(input.namespace ? { namespace: input.namespace } : {}),
            },
            select: {
              id: true,
              timestamp: true,
              namespace: true,
              podName: true,
              binary: true,
              arguments: true,
              verdict: true,
            },
            orderBy: { timestamp: "desc" },
            take: 200,
          });

      // Aggregate and categorize events
      interface ProcessEvent {
        id: string;
        timestamp: Date;
        namespace: string;
        podName: string;
        processName: string;
        fullPath: string;
        execCount: number;
        isSuspicious: boolean;
        category: "shell" | "network_tool" | "scripting" | "system" | "file_reader" | "normal";
        arguments: string | null;
        verdict: string;
      }

      const events: ProcessEvent[] = processEvents.map((pe) => {
        // Extract basename from full path (e.g., /bin/sh -> sh)
        const fullPath = pe.binary.toLowerCase();
        const processName = fullPath.split("/").pop() ?? fullPath;
        let category: ProcessEvent["category"] = "normal";
        let isSuspicious = false;

        // Categorize the process
        if (["sh", "bash", "zsh", "dash", "ash"].includes(processName)) {
          category = "shell";
          isSuspicious = true;
        } else if (["curl", "wget", "nc", "netcat", "ncat"].includes(processName)) {
          category = "network_tool";
          isSuspicious = true;
        } else if (["python", "python3", "perl", "ruby"].includes(processName)) {
          category = "scripting";
          isSuspicious = true;
        } else if (["chmod", "chown", "base64", "xxd"].includes(processName)) {
          category = "system";
          isSuspicious = true;
        } else if (["cat", "head", "tail", "less", "more"].includes(processName)) {
          // File readers are suspicious in containers - they're often used to
          // read sensitive files like /etc/shadow or service account tokens
          category = "file_reader";
          isSuspicious = true;
        } else if (suspiciousBinaries.includes(processName)) {
          isSuspicious = true;
        }

        return {
          id: pe.id,
          timestamp: pe.timestamp,
          namespace: pe.namespace,
          podName: pe.podName ?? "unknown",
          processName: processName, // Return basename for display
          fullPath: pe.binary, // Keep full path available
          execCount: 1, // Each event is one execution
          isSuspicious,
          category,
          arguments: pe.arguments,
          verdict: pe.verdict,
        };
      });

      // Summary stats (no post-filter needed - DB handles suspicious filter via ILIKE ANY)
      const summary = {
        totalEvents: events.length,
        suspiciousEvents: events.filter((e) => e.isSuspicious).length,
        shellExecutions: events.filter((e) => e.category === "shell").length,
        networkTools: events.filter((e) => e.category === "network_tool").length,
        scriptingLanguages: events.filter((e) => e.category === "scripting").length,
        fileReaders: events.filter((e) => e.category === "file_reader").length,
        uniqueNamespaces: [...new Set(events.map((e) => e.namespace))].length,
        uniquePods: [...new Set(events.map((e) => `${e.namespace}/${e.podName}`))].length,
      };

      // Group by namespace/pod for display
      const groupedByPod = new Map<string, ProcessEvent[]>();
      for (const event of events) {
        const key = `${event.namespace}/${event.podName}`;
        if (!groupedByPod.has(key)) {
          groupedByPod.set(key, []);
        }
        groupedByPod.get(key)!.push(event);
      }

      const podGroups = Array.from(groupedByPod.entries()).map(([key, events]) => ({
        key,
        namespace: events[0]?.namespace ?? "",
        podName: events[0]?.podName ?? "",
        events,
        suspiciousCount: events.filter((e) => e.isSuspicious).length,
        totalExecs: events.reduce((sum, e) => sum + e.execCount, 0),
      }));

      // Sort by suspicious count descending
      podGroups.sort((a, b) => b.suspiciousCount - a.suspiciousCount);

      return {
        events: events.slice(0, 100), // Return top 100 events
        podGroups: podGroups.slice(0, 20), // Return top 20 pods
        summary,
      };
    }),
});
