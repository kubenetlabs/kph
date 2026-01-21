import { z } from "zod";
import { Prisma } from "@prisma/client";
import { createTRPCRouter, orgProtectedProcedure } from "../trpc";

/**
 * Suspicious binary patterns for security monitoring
 * These patterns match common attack tools and shells
 * Used with PostgreSQL ILIKE ANY for efficient pattern matching
 */
const SUSPICIOUS_BINARY_PATTERNS_SQL = Prisma.raw(`ARRAY[
  '%/sh', '%/bash', '%/zsh', '%/dash', '%/ash',
  '%/curl', '%/wget', '%/nc', '%/netcat', '%/ncat',
  '%/python', '%/python3', '%/perl', '%/ruby',
  '%/chmod', '%/chown', '%/base64', '%/nmap',
  '%/cat', '%/head', '%/tail', '%/less', '%/more'
]`);

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
      // Use OR to match either timestamp or windowStart for compatibility
      const timeFilter = {
        OR: [
          { timestamp: { gte: since } },
          { windowStart: { gte: since } },
        ],
      };

      const namespaceFilter = input.filters?.namespaces?.length ? {
        OR: [
          { srcNamespace: { in: input.filters.namespaces } },
          { dstNamespace: { in: input.filters.namespaces } },
        ],
      } : {};

      const baseWhere = {
        clusterId: input.clusterId,
        AND: [
          timeFilter,
          ...(Object.keys(namespaceFilter).length > 0 ? [namespaceFilter] : []),
        ],
      };

      // OPTIMIZATION: Use groupBy to aggregate at database level
      // This reduces data transfer from ~700 records to ~50-100 aggregated rows
      // Much faster with Neon's network latency
      const aggregatedFlows = await ctx.db.flowSummary.groupBy({
        by: ['srcNamespace', 'srcPodName', 'dstNamespace', 'dstPodName', 'dstPort', 'protocol'],
        where: baseWhere,
        _sum: {
          totalFlows: true,
          allowedFlows: true,
          deniedFlows: true,
          droppedFlows: true,
        },
      });

      // Convert groupBy results to the format expected by the rest of the code
      const flowSummaries = aggregatedFlows.map(agg => ({
        srcNamespace: agg.srcNamespace,
        srcPodName: agg.srcPodName,
        dstNamespace: agg.dstNamespace,
        dstPodName: agg.dstPodName,
        dstPort: agg.dstPort,
        protocol: agg.protocol,
        totalFlows: agg._sum.totalFlows ?? BigInt(0),
        allowedFlows: agg._sum.allowedFlows ?? BigInt(0),
        deniedFlows: agg._sum.deniedFlows ?? BigInt(0),
        droppedFlows: agg._sum.droppedFlows ?? BigInt(0),
      }));

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
      // Create separate edges for allowed and denied traffic when both exist
      for (const [, agg] of flowAggregates) {
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
          dataAge: flowSummaries.length > 0 ? 0 : null, // Data is fresh from aggregated query
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

      // Suspicious binaries that might indicate attacks (for client-side categorization)
      const suspiciousBinaries = [
        "sh", "bash", "zsh", "dash", "ash", // Shells
        "curl", "wget", "nc", "netcat", "ncat", // Network tools
        "python", "python3", "perl", "ruby", // Scripting languages
        "chmod", "chown", // Permission changes
        "base64", "xxd", // Encoding tools
        "nmap", "masscan", // Scanning tools
        "cat", "head", "tail", "less", "more", // File readers (suspicious when accessing sensitive files)
      ];

      // Type for raw query results matching ProcessValidationEvent schema
      interface ProcessValidationEventRow {
        id: string;
        clusterId: string;
        timestamp: Date;
        verdict: string;
        namespace: string;
        podName: string | null;
        nodeName: string | null;
        binary: string;
        arguments: string | null;
        parentBinary: string | null;
        syscall: string | null;
        filePath: string | null;
        createdAt: Date;
      }

      // Query processValidationEvent table (populated by collector via /api/operator/process-validation)
      // OPTIMIZATION: When filtering for suspicious binaries, use raw SQL with ILIKE ANY
      // This replaces 21 separate OR conditions with a single optimized pattern match
      let processEvents: ProcessValidationEventRow[];

      if (input.suspicious) {
        // Use PostgreSQL ILIKE ANY for efficient pattern matching (~50% faster)
        if (input.namespace) {
          processEvents = await ctx.db.$queryRaw<ProcessValidationEventRow[]>`
            SELECT id, "clusterId", timestamp, verdict, namespace, "podName", "nodeName",
                   binary, arguments, "parentBinary", syscall, "filePath", "createdAt"
            FROM process_validation_events
            WHERE "clusterId" = ${input.clusterId}
              AND timestamp >= ${since}
              AND namespace = ${input.namespace}
              AND binary ILIKE ANY(${SUSPICIOUS_BINARY_PATTERNS_SQL})
            ORDER BY timestamp DESC
            LIMIT 200
          `;
        } else {
          processEvents = await ctx.db.$queryRaw<ProcessValidationEventRow[]>`
            SELECT id, "clusterId", timestamp, verdict, namespace, "podName", "nodeName",
                   binary, arguments, "parentBinary", syscall, "filePath", "createdAt"
            FROM process_validation_events
            WHERE "clusterId" = ${input.clusterId}
              AND timestamp >= ${since}
              AND binary ILIKE ANY(${SUSPICIOUS_BINARY_PATTERNS_SQL})
            ORDER BY timestamp DESC
            LIMIT 200
          `;
        }
      } else {
        // Non-suspicious query: use standard Prisma with explicit select
        const result = await ctx.db.processValidationEvent.findMany({
          where: {
            clusterId: input.clusterId,
            timestamp: { gte: since },
            ...(input.namespace ? { namespace: input.namespace } : {}),
          },
          select: {
            id: true,
            clusterId: true,
            timestamp: true,
            verdict: true,
            namespace: true,
            podName: true,
            nodeName: true,
            binary: true,
            arguments: true,
            parentBinary: true,
            syscall: true,
            filePath: true,
            createdAt: true,
          },
          orderBy: { timestamp: "desc" },
          take: 200,
        });
        processEvents = result;
      }

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

      // Filter to suspicious only if requested (already filtered at DB level, but double-check)
      const filteredEvents = input.suspicious
        ? events.filter((e) => e.isSuspicious)
        : events;

      // Summary stats
      const summary = {
        totalEvents: filteredEvents.length,
        suspiciousEvents: filteredEvents.filter((e) => e.isSuspicious).length,
        shellExecutions: filteredEvents.filter((e) => e.category === "shell").length,
        networkTools: filteredEvents.filter((e) => e.category === "network_tool").length,
        scriptingLanguages: filteredEvents.filter((e) => e.category === "scripting").length,
        fileReaders: filteredEvents.filter((e) => e.category === "file_reader").length,
        uniqueNamespaces: [...new Set(filteredEvents.map((e) => e.namespace))].length,
        uniquePods: [...new Set(filteredEvents.map((e) => `${e.namespace}/${e.podName}`))].length,
      };

      // Group by namespace/pod for display
      const groupedByPod = new Map<string, ProcessEvent[]>();
      for (const event of filteredEvents) {
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
        events: filteredEvents.slice(0, 100), // Return top 100 events
        podGroups: podGroups.slice(0, 20), // Return top 20 pods
        summary,
      };
    }),
});
