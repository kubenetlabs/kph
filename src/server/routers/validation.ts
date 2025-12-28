import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
import { createTRPCRouter, protectedProcedure } from "../trpc";

// Type definitions for JSON fields
interface CoverageGap {
  srcNamespace: string;
  srcPodName?: string;
  dstNamespace: string;
  dstPodName?: string;
  dstPort: number;
  count: number;
}

export const validationRouter = createTRPCRouter({
  // Get validation summary for a cluster
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
      const summaries = await ctx.db.validationSummary.findMany({
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

      const totalFlows = totals.allowed + totals.blocked + totals.noPolicy;

      // Get coverage percentage
      const coveragePercentage =
        totalFlows > 0
          ? ((totals.allowed + totals.blocked) / totalFlows) * 100
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
        totalFlows,
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

  // Get coverage gaps (flows with NO_POLICY verdict)
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
      const summaries = await ctx.db.validationSummary.findMany({
        where: {
          clusterId: input.clusterId,
          hour: { gte: startTime },
          coverageGaps: { not: Prisma.JsonNull },
        },
        orderBy: { hour: "desc" },
        take: 10,
      });

      console.log(`[getCoverageGaps] Found ${summaries.length} summaries for cluster ${input.clusterId}`);

      // Aggregate coverage gaps from all summaries
      const gapMap = new Map<string, CoverageGap>();

      for (const summary of summaries) {
        const gaps = summary.coverageGaps as CoverageGap[] | null;
        if (!gaps) continue;

        for (const gap of gaps) {
          const key = `${gap.srcNamespace}/${gap.srcPodName ?? "*"}:${gap.dstNamespace}/${gap.dstPodName ?? "*"}:${gap.dstPort}`;
          const existing = gapMap.get(key);
          if (existing) {
            existing.count += gap.count;
          } else {
            gapMap.set(key, { ...gap });
          }
        }
      }

      // Sort by count and return top N
      const sortedGaps = Array.from(gapMap.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, input.limit);

      return {
        cluster: { id: cluster.id, name: cluster.name },
        gaps: sortedGaps,
        totalGaps: gapMap.size,
      };
    }),

  // Get recent blocked flows
  getBlockedFlows: protectedProcedure
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

      // Get recent BLOCKED events
      const events = await ctx.db.validationEvent.findMany({
        where: {
          clusterId: input.clusterId,
          timestamp: { gte: startTime },
          verdict: "BLOCKED",
        },
        orderBy: { timestamp: "desc" },
        take: input.limit,
      });

      return {
        cluster: { id: cluster.id, name: cluster.name },
        blockedFlows: events.map((e) => ({
          id: e.id,
          timestamp: e.timestamp.toISOString(),
          srcNamespace: e.srcNamespace,
          srcPodName: e.srcPodName,
          dstNamespace: e.dstNamespace,
          dstPodName: e.dstPodName,
          dstPort: e.dstPort,
          protocol: e.protocol,
          matchedPolicy: e.matchedPolicy,
          reason: e.reason,
        })),
      };
    }),

  // Get recent validation events (all verdicts)
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

      const events = await ctx.db.validationEvent.findMany({
        where: {
          clusterId: input.clusterId,
          ...(input.verdict && { verdict: input.verdict }),
        },
        orderBy: { timestamp: "desc" },
        take: input.limit,
      });

      return {
        cluster: { id: cluster.id, name: cluster.name },
        events: events.map((e) => ({
          id: e.id,
          timestamp: e.timestamp.toISOString(),
          verdict: e.verdict,
          srcNamespace: e.srcNamespace,
          srcPodName: e.srcPodName,
          dstNamespace: e.dstNamespace,
          dstPodName: e.dstPodName,
          dstPort: e.dstPort,
          protocol: e.protocol,
          matchedPolicy: e.matchedPolicy,
          reason: e.reason,
        })),
      };
    }),

  // Get validation stats across all clusters
  getOrgStats: protectedProcedure
    .input(
      z.object({
        hours: z.number().int().min(1).max(168).default(24),
      })
    )
    .query(async ({ ctx, input }) => {
      const startTime = new Date();
      startTime.setHours(startTime.getHours() - input.hours);

      // Get clusters for this organization
      const clusters = await ctx.db.cluster.findMany({
        where: { organizationId: ctx.organizationId },
        select: { id: true, name: true },
      });

      const clusterIds = clusters.map((c) => c.id);

      // Get aggregated stats
      const summaries = await ctx.db.validationSummary.groupBy({
        by: ["clusterId"],
        where: {
          clusterId: { in: clusterIds },
          hour: { gte: startTime },
        },
        _sum: {
          allowedCount: true,
          blockedCount: true,
          noPolicyCount: true,
        },
      });

      // Map cluster names
      const clusterMap = new Map(clusters.map((c) => [c.id, c.name]));

      const perCluster = summaries.map((s) => ({
        clusterId: s.clusterId,
        clusterName: clusterMap.get(s.clusterId) ?? "Unknown",
        allowed: s._sum.allowedCount ?? 0,
        blocked: s._sum.blockedCount ?? 0,
        noPolicy: s._sum.noPolicyCount ?? 0,
      }));

      const totals = perCluster.reduce(
        (acc, c) => ({
          allowed: acc.allowed + c.allowed,
          blocked: acc.blocked + c.blocked,
          noPolicy: acc.noPolicy + c.noPolicy,
        }),
        { allowed: 0, blocked: 0, noPolicy: 0 }
      );

      return {
        period: { hours: input.hours, startTime: startTime.toISOString() },
        totals,
        perCluster,
        clusterCount: clusters.length,
      };
    }),
});
