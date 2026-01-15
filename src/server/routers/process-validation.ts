import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
import { createTRPCRouter, orgProtectedProcedure } from "../trpc";

// Use orgProtectedProcedure for all process validation operations (requires organization)
const protectedProcedure = orgProtectedProcedure;

// Type definitions for JSON fields
interface BlockedProcess {
  namespace: string;
  podName?: string;
  binary: string;
  policy: string;
  count: number;
}

interface ProcessCoverageGap {
  namespace: string;
  podName?: string;
  binary: string;
  count: number;
}

export const processValidationRouter = createTRPCRouter({
  // Get process validation summary for a cluster
  getSummary: protectedProcedure
    .input(
      z.object({
        clusterId: z.string(),
        startTime: z.date().optional(),
        endTime: z.date().optional(),
        hours: z.number().int().min(1).max(168).default(24), // Max 7 days
      })
    )
    .query(async ({ ctx, input }) => {
      // Verify cluster belongs to organization
      const cluster = await ctx.db.cluster.findFirst({
        where: {
          id: input.clusterId,
          organizationId: ctx.organizationId,
        },
      });

      if (!cluster) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Cluster not found",
        });
      }

      // Calculate time range
      const endTime = input.endTime ?? new Date();
      const startTime =
        input.startTime ??
        new Date(endTime.getTime() - input.hours * 60 * 60 * 1000);

      // Get hourly summaries
      const summaries = await ctx.db.processValidationSummary.findMany({
        where: {
          clusterId: input.clusterId,
          hour: {
            gte: startTime,
            lte: endTime,
          },
        },
        orderBy: { hour: "asc" },
      });

      // Calculate totals
      const totals = summaries.reduce(
        (acc, s) => ({
          allowed: acc.allowed + s.allowedCount,
          blocked: acc.blocked + s.blockedCount,
          noPolicy: acc.noPolicy + s.noPolicyCount,
        }),
        { allowed: 0, blocked: 0, noPolicy: 0 }
      );

      const totalProcesses = totals.allowed + totals.blocked + totals.noPolicy;

      // Get coverage percentage (processes covered by policy)
      const coveragePercentage =
        totalProcesses > 0
          ? ((totals.allowed + totals.blocked) / totalProcesses) * 100
          : 100;

      // Calculate trend (compare first half to second half)
      const midpoint = Math.floor(summaries.length / 2);
      const firstHalf = summaries.slice(0, midpoint);
      const secondHalf = summaries.slice(midpoint);

      const firstHalfTotal = firstHalf.reduce(
        (acc, s) => acc + s.allowedCount + s.blockedCount + s.noPolicyCount,
        0
      );
      const secondHalfTotal = secondHalf.reduce(
        (acc, s) => acc + s.allowedCount + s.blockedCount + s.noPolicyCount,
        0
      );

      const trend =
        firstHalfTotal > 0
          ? ((secondHalfTotal - firstHalfTotal) / firstHalfTotal) * 100
          : 0;

      return {
        cluster: {
          id: cluster.id,
          name: cluster.name,
        },
        period: {
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          hours: input.hours,
        },
        totals,
        totalProcesses,
        coveragePercentage,
        trend,
        hourlyBreakdown: summaries.map((s) => ({
          hour: s.hour.toISOString(),
          allowed: s.allowedCount,
          blocked: s.blockedCount,
          noPolicy: s.noPolicyCount,
        })),
      };
    }),

  // Get coverage gaps (processes with NO_POLICY verdict)
  getCoverageGaps: protectedProcedure
    .input(
      z.object({
        clusterId: z.string(),
        hours: z.number().int().min(1).max(168).default(24),
        limit: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      // Verify cluster belongs to organization
      const cluster = await ctx.db.cluster.findFirst({
        where: {
          id: input.clusterId,
          organizationId: ctx.organizationId,
        },
      });

      if (!cluster) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Cluster not found",
        });
      }

      const startTime = new Date();
      startTime.setHours(startTime.getHours() - input.hours);

      // Get recent summaries with coverage gaps
      const summaries = await ctx.db.processValidationSummary.findMany({
        where: {
          clusterId: input.clusterId,
          hour: { gte: startTime },
          coverageGaps: { not: Prisma.JsonNull },
        },
        orderBy: { hour: "desc" },
        take: 10,
      });

      // Aggregate coverage gaps across summaries
      const gapMap = new Map<string, ProcessCoverageGap>();
      for (const summary of summaries) {
        const gaps = summary.coverageGaps as ProcessCoverageGap[] | null;
        if (!gaps) continue;

        for (const gap of gaps) {
          const key = `${gap.namespace}|${gap.podName ?? ""}|${gap.binary}`;
          const existing = gapMap.get(key);
          if (existing) {
            existing.count += gap.count;
          } else {
            gapMap.set(key, { ...gap });
          }
        }
      }

      // Sort by count and limit
      const sortedGaps = Array.from(gapMap.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, input.limit);

      return {
        cluster: {
          id: cluster.id,
          name: cluster.name,
        },
        gaps: sortedGaps,
        totalGaps: gapMap.size,
      };
    }),

  // Get blocked processes
  getBlockedProcesses: protectedProcedure
    .input(
      z.object({
        clusterId: z.string(),
        hours: z.number().int().min(1).max(168).default(24),
        limit: z.number().int().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      // Verify cluster belongs to organization
      const cluster = await ctx.db.cluster.findFirst({
        where: {
          id: input.clusterId,
          organizationId: ctx.organizationId,
        },
      });

      if (!cluster) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Cluster not found",
        });
      }

      const startTime = new Date();
      startTime.setHours(startTime.getHours() - input.hours);

      // Get recent blocked events
      const blockedEvents = await ctx.db.processValidationEvent.findMany({
        where: {
          clusterId: input.clusterId,
          timestamp: { gte: startTime },
          verdict: "BLOCKED",
        },
        orderBy: { timestamp: "desc" },
        take: input.limit,
      });

      return {
        cluster: {
          id: cluster.id,
          name: cluster.name,
        },
        blockedProcesses: blockedEvents.map((e) => ({
          id: e.id,
          timestamp: e.timestamp.toISOString(),
          namespace: e.namespace,
          podName: e.podName,
          binary: e.binary,
          arguments: e.arguments,
          syscall: e.syscall,
          matchedPolicy: e.matchedPolicy,
          action: e.action,
          reason: e.reason,
        })),
      };
    }),

  // Get recent process validation events
  getRecentEvents: protectedProcedure
    .input(
      z.object({
        clusterId: z.string(),
        verdict: z.enum(["ALLOWED", "BLOCKED", "NO_POLICY"]).optional(),
        limit: z.number().int().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      // Verify cluster belongs to organization
      const cluster = await ctx.db.cluster.findFirst({
        where: {
          id: input.clusterId,
          organizationId: ctx.organizationId,
        },
      });

      if (!cluster) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Cluster not found",
        });
      }

      // Get recent events
      const events = await ctx.db.processValidationEvent.findMany({
        where: {
          clusterId: input.clusterId,
          ...(input.verdict && { verdict: input.verdict }),
        },
        orderBy: { timestamp: "desc" },
        take: input.limit,
      });

      return {
        cluster: {
          id: cluster.id,
          name: cluster.name,
        },
        events: events.map((e) => ({
          id: e.id,
          timestamp: e.timestamp.toISOString(),
          verdict: e.verdict,
          namespace: e.namespace,
          podName: e.podName,
          nodeName: e.nodeName,
          binary: e.binary,
          arguments: e.arguments,
          parentBinary: e.parentBinary,
          syscall: e.syscall,
          filePath: e.filePath,
          matchedPolicy: e.matchedPolicy,
          action: e.action,
          reason: e.reason,
        })),
      };
    }),

  // Get org-wide process validation stats
  getOrgStats: protectedProcedure
    .input(
      z.object({
        hours: z.number().int().min(1).max(168).default(24),
      })
    )
    .query(async ({ ctx, input }) => {
      const startTime = new Date();
      startTime.setHours(startTime.getHours() - input.hours);

      // Get all clusters for the organization
      const clusters = await ctx.db.cluster.findMany({
        where: { organizationId: ctx.organizationId },
        select: { id: true, name: true },
      });

      // Get summaries for all clusters
      const summaries = await ctx.db.processValidationSummary.findMany({
        where: {
          clusterId: { in: clusters.map((c) => c.id) },
          hour: { gte: startTime },
        },
      });

      // Aggregate by cluster
      const clusterTotals = new Map<
        string,
        { allowed: number; blocked: number; noPolicy: number }
      >();

      for (const summary of summaries) {
        const existing = clusterTotals.get(summary.clusterId) ?? {
          allowed: 0,
          blocked: 0,
          noPolicy: 0,
        };
        existing.allowed += summary.allowedCount;
        existing.blocked += summary.blockedCount;
        existing.noPolicy += summary.noPolicyCount;
        clusterTotals.set(summary.clusterId, existing);
      }

      // Calculate org-wide totals
      const totals = { allowed: 0, blocked: 0, noPolicy: 0 };
      for (const [, stats] of clusterTotals) {
        totals.allowed += stats.allowed;
        totals.blocked += stats.blocked;
        totals.noPolicy += stats.noPolicy;
      }

      // Build per-cluster breakdown
      const perCluster = clusters.map((cluster) => {
        const stats = clusterTotals.get(cluster.id) ?? {
          allowed: 0,
          blocked: 0,
          noPolicy: 0,
        };
        return {
          clusterId: cluster.id,
          clusterName: cluster.name,
          ...stats,
        };
      });

      return {
        period: {
          hours: input.hours,
          startTime: startTime.toISOString(),
        },
        totals,
        perCluster,
        clusterCount: clusters.length,
      };
    }),

  // Get top blocked binaries across the cluster
  getTopBlockedBinaries: protectedProcedure
    .input(
      z.object({
        clusterId: z.string(),
        hours: z.number().int().min(1).max(168).default(24),
        limit: z.number().int().min(1).max(50).default(10),
      })
    )
    .query(async ({ ctx, input }) => {
      // Verify cluster belongs to organization
      const cluster = await ctx.db.cluster.findFirst({
        where: {
          id: input.clusterId,
          organizationId: ctx.organizationId,
        },
      });

      if (!cluster) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Cluster not found",
        });
      }

      const startTime = new Date();
      startTime.setHours(startTime.getHours() - input.hours);

      // Get recent summaries with topBlocked data
      const summaries = await ctx.db.processValidationSummary.findMany({
        where: {
          clusterId: input.clusterId,
          hour: { gte: startTime },
          topBlocked: { not: Prisma.JsonNull },
        },
        orderBy: { hour: "desc" },
      });

      // Aggregate blocked binaries
      const binaryMap = new Map<string, BlockedProcess>();
      for (const summary of summaries) {
        const blocked = summary.topBlocked as BlockedProcess[] | null;
        if (!blocked) continue;

        for (const item of blocked) {
          const key = `${item.namespace}|${item.binary}|${item.policy}`;
          const existing = binaryMap.get(key);
          if (existing) {
            existing.count += item.count;
          } else {
            binaryMap.set(key, { ...item });
          }
        }
      }

      // Sort by count and limit
      const topBlocked = Array.from(binaryMap.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, input.limit);

      return {
        cluster: {
          id: cluster.id,
          name: cluster.name,
        },
        topBlocked,
      };
    }),
});
