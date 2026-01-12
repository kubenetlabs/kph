import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";
import { createTRPCRouter, orgProtectedProcedure } from "../trpc";
import {
  findSimilarPolicies,
  generatePolicyForCoverageGap,
} from "~/lib/policy-parser";

// Use orgProtectedProcedure for all recommendation operations (requires organization)
const protectedProcedure = orgProtectedProcedure;

// Recommendation types
const RecommendationType = z.enum([
  "COVERAGE_GAP",
  "UNUSED_POLICY",
  "CONSOLIDATION",
]);
type RecommendationType = z.infer<typeof RecommendationType>;

const RecommendationSeverity = z.enum(["CRITICAL", "WARNING", "INFO"]);
type RecommendationSeverity = z.infer<typeof RecommendationSeverity>;

// Coverage gap from ValidationSummary
interface CoverageGap {
  srcNamespace: string;
  srcPodName?: string;
  dstNamespace: string;
  dstPodName?: string;
  dstPort: number;
  count: number;
}

// Recommendation interface
interface Recommendation {
  id: string;
  type: RecommendationType;
  severity: RecommendationSeverity;
  clusterId: string;
  clusterName: string;
  title: string;
  description: string;
  impact: number;
  suggestedAction: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/**
 * Determines severity based on flow count
 */
function getGapSeverity(count: number): RecommendationSeverity {
  if (count >= 1000) return "CRITICAL";
  if (count >= 100) return "WARNING";
  return "INFO";
}

/**
 * Determines severity for unused policy based on days deployed
 */
function getUnusedPolicySeverity(daysSinceDeployed: number): RecommendationSeverity {
  if (daysSinceDeployed >= 30) return "WARNING";
  return "INFO";
}

/**
 * Determines severity for consolidation based on similarity
 */
function getConsolidationSeverity(similarityPercent: number): RecommendationSeverity {
  if (similarityPercent >= 95) return "WARNING";
  return "INFO";
}

export const recommendationsRouter = createTRPCRouter({
  // Get all recommendations with filtering
  getAll: protectedProcedure
    .input(
      z.object({
        clusterId: z.string().optional(),
        type: RecommendationType.optional(),
        severity: RecommendationSeverity.optional(),
        hours: z.number().int().min(1).max(168).default(24), // Max 7 days
        limit: z.number().int().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const recommendations: Recommendation[] = [];

      // Get clusters for this organization
      const clusters = await ctx.db.cluster.findMany({
        where: {
          organizationId: ctx.organizationId,
          ...(input.clusterId && { id: input.clusterId }),
        },
        select: { id: true, name: true },
      });

      const clusterMap = new Map(clusters.map((c) => [c.id, c.name]));
      const clusterIds = clusters.map((c) => c.id);

      // Get coverage gap recommendations
      if (!input.type || input.type === "COVERAGE_GAP") {
        const gapRecs = await getCoverageGapRecommendations(
          ctx.db,
          clusterIds,
          clusterMap,
          input.hours
        );
        recommendations.push(...gapRecs);
      }

      // Get unused policy recommendations
      if (!input.type || input.type === "UNUSED_POLICY") {
        const unusedRecs = await getUnusedPolicyRecommendations(
          ctx.db,
          clusterIds,
          clusterMap,
          input.hours
        );
        recommendations.push(...unusedRecs);
      }

      // Get consolidation recommendations
      if (!input.type || input.type === "CONSOLIDATION") {
        const consolidationRecs = await getConsolidationRecommendations(
          ctx.db,
          clusterIds,
          clusterMap
        );
        recommendations.push(...consolidationRecs);
      }

      // Filter by severity if specified
      let filtered = recommendations;
      if (input.severity) {
        filtered = filtered.filter((r) => r.severity === input.severity);
      }

      // Sort by severity (CRITICAL first), then by impact
      const severityOrder: Record<RecommendationSeverity, number> = {
        CRITICAL: 0,
        WARNING: 1,
        INFO: 2,
      };

      filtered.sort((a, b) => {
        const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
        if (severityDiff !== 0) return severityDiff;
        return b.impact - a.impact;
      });

      return {
        recommendations: filtered.slice(0, input.limit),
        total: filtered.length,
      };
    }),

  // Get recommendation statistics
  getStats: protectedProcedure
    .input(
      z.object({
        clusterId: z.string().optional(),
        hours: z.number().int().min(1).max(168).default(24),
      })
    )
    .query(async ({ ctx, input }) => {
      // Get all recommendations to compute stats
      const clusters = await ctx.db.cluster.findMany({
        where: {
          organizationId: ctx.organizationId,
          ...(input.clusterId && { id: input.clusterId }),
        },
        select: { id: true, name: true },
      });

      const clusterMap = new Map(clusters.map((c) => [c.id, c.name]));
      const clusterIds = clusters.map((c) => c.id);

      const recommendations: Recommendation[] = [];

      // Get all recommendation types
      const gapRecs = await getCoverageGapRecommendations(
        ctx.db,
        clusterIds,
        clusterMap,
        input.hours
      );
      const unusedRecs = await getUnusedPolicyRecommendations(
        ctx.db,
        clusterIds,
        clusterMap,
        input.hours
      );
      const consolidationRecs = await getConsolidationRecommendations(
        ctx.db,
        clusterIds,
        clusterMap
      );

      recommendations.push(...gapRecs, ...unusedRecs, ...consolidationRecs);

      // Compute stats
      const byType = {
        COVERAGE_GAP: gapRecs.length,
        UNUSED_POLICY: unusedRecs.length,
        CONSOLIDATION: consolidationRecs.length,
      };

      const bySeverity = {
        CRITICAL: recommendations.filter((r) => r.severity === "CRITICAL").length,
        WARNING: recommendations.filter((r) => r.severity === "WARNING").length,
        INFO: recommendations.filter((r) => r.severity === "INFO").length,
      };

      return {
        total: recommendations.length,
        byType,
        bySeverity,
      };
    }),

  // Get generated policy content for a coverage gap
  getGeneratedPolicy: protectedProcedure
    .input(
      z.object({
        srcNamespace: z.string(),
        dstNamespace: z.string(),
        dstPort: z.number(),
      })
    )
    .query(({ input }) => {
      const content = generatePolicyForCoverageGap(
        input.srcNamespace,
        input.dstNamespace,
        input.dstPort
      );
      return { content };
    }),

  // Archive a policy (for unused policy recommendations)
  archivePolicy: protectedProcedure
    .input(z.object({ policyId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Verify policy belongs to organization
      const policy = await ctx.db.policy.findFirst({
        where: {
          id: input.policyId,
          organizationId: ctx.organizationId,
        },
      });

      if (!policy) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Policy not found",
        });
      }

      // Archive the policy
      await ctx.db.policy.update({
        where: { id: input.policyId },
        data: { status: "ARCHIVED" },
      });

      return { success: true };
    }),
});

/**
 * Get coverage gap recommendations from ValidationSummary
 */
async function getCoverageGapRecommendations(
  db: PrismaClient,
  clusterIds: string[],
  clusterMap: Map<string, string>,
  hours: number
): Promise<Recommendation[]> {
  const recommendations: Recommendation[] = [];
  const startTime = new Date();
  startTime.setHours(startTime.getHours() - hours);

  // Get validation summaries with coverage gaps
  const summaries = await db.validationSummary.findMany({
    where: {
      clusterId: { in: clusterIds },
      hour: { gte: startTime },
    },
    orderBy: { hour: "desc" },
  });

  // Aggregate coverage gaps by cluster
  const gapsByCluster = new Map<string, Map<string, CoverageGap>>();

  for (const summary of summaries) {
    const gaps = summary.coverageGaps as CoverageGap[] | null;
    if (!gaps) continue;

    let clusterGaps = gapsByCluster.get(summary.clusterId);
    if (!clusterGaps) {
      clusterGaps = new Map();
      gapsByCluster.set(summary.clusterId, clusterGaps);
    }

    for (const gap of gaps) {
      const key = `${gap.srcNamespace}/${gap.srcPodName ?? "*"}:${gap.dstNamespace}/${gap.dstPodName ?? "*"}:${gap.dstPort}`;
      const existing = clusterGaps.get(key);
      if (existing) {
        existing.count += gap.count;
      } else {
        clusterGaps.set(key, { ...gap });
      }
    }
  }

  // Convert to recommendations
  for (const [clusterId, gaps] of gapsByCluster) {
    const clusterName = clusterMap.get(clusterId) ?? "Unknown";

    for (const [, gap] of gaps) {
      const severity = getGapSeverity(gap.count);
      const srcDisplay = gap.srcPodName
        ? `${gap.srcNamespace}/${gap.srcPodName}`
        : gap.srcNamespace;
      const dstDisplay = gap.dstPodName
        ? `${gap.dstNamespace}/${gap.dstPodName}`
        : gap.dstNamespace;

      recommendations.push({
        id: `coverage-gap-${clusterId}-${gap.srcNamespace}-${gap.dstNamespace}-${gap.dstPort}`,
        type: "COVERAGE_GAP",
        severity,
        clusterId,
        clusterName,
        title: `Missing policy for ${srcDisplay} → ${dstDisplay}:${gap.dstPort}`,
        description: `${gap.count.toLocaleString()} flows observed without any governing policy in the last ${hours} hours`,
        impact: gap.count,
        suggestedAction: "Create network policy",
        metadata: {
          srcNamespace: gap.srcNamespace,
          srcPodName: gap.srcPodName,
          dstNamespace: gap.dstNamespace,
          dstPodName: gap.dstPodName,
          dstPort: gap.dstPort,
          flowCount: gap.count,
        },
        createdAt: new Date().toISOString(),
      });
    }
  }

  return recommendations;
}

/**
 * Get unused policy recommendations by analyzing ValidationEvent
 */
async function getUnusedPolicyRecommendations(
  db: PrismaClient,
  clusterIds: string[],
  clusterMap: Map<string, string>,
  hours: number
): Promise<Recommendation[]> {
  const recommendations: Recommendation[] = [];
  const startTime = new Date();
  startTime.setHours(startTime.getHours() - hours);

  // Get all deployed policies for these clusters
  const policies = await db.policy.findMany({
    where: {
      clusterId: { in: clusterIds },
      status: "DEPLOYED",
    },
    select: {
      id: true,
      name: true,
      clusterId: true,
      deployedAt: true,
      createdAt: true,
    },
  });

  if (policies.length === 0) return recommendations;

  // Get policies that have matched flows recently
  const matchedPolicies = await db.validationEvent.groupBy({
    by: ["clusterId", "matchedPolicy"],
    where: {
      clusterId: { in: clusterIds },
      timestamp: { gte: startTime },
      matchedPolicy: { not: null },
    },
  });

  // Create a set of matched policy names per cluster
  const matchedByCluster = new Map<string, Set<string>>();
  for (const match of matchedPolicies) {
    if (!match.matchedPolicy) continue;
    let matched = matchedByCluster.get(match.clusterId);
    if (!matched) {
      matched = new Set();
      matchedByCluster.set(match.clusterId, matched);
    }
    matched.add(match.matchedPolicy);
  }

  // Find unused policies
  const now = new Date();
  for (const policy of policies) {
    const matched = matchedByCluster.get(policy.clusterId);
    const isUsed = matched?.has(policy.name) ?? false;

    if (!isUsed) {
      const deployedAt = policy.deployedAt ?? policy.createdAt;
      const daysSinceDeployed = Math.floor(
        (now.getTime() - deployedAt.getTime()) / (1000 * 60 * 60 * 24)
      );
      const severity = getUnusedPolicySeverity(daysSinceDeployed);
      const clusterName = clusterMap.get(policy.clusterId) ?? "Unknown";

      recommendations.push({
        id: `unused-policy-${policy.id}`,
        type: "UNUSED_POLICY",
        severity,
        clusterId: policy.clusterId,
        clusterName,
        title: `Policy "${policy.name}" is unused`,
        description: `No flows matched this policy in the last ${hours} hours. Policy deployed ${daysSinceDeployed} days ago.`,
        impact: daysSinceDeployed,
        suggestedAction: "Review and consider archiving",
        metadata: {
          policyId: policy.id,
          policyName: policy.name,
          daysSinceDeployed,
          deployedAt: deployedAt.toISOString(),
        },
        createdAt: new Date().toISOString(),
      });
    }
  }

  return recommendations;
}

/**
 * Get consolidation recommendations by analyzing policy similarity
 */
async function getConsolidationRecommendations(
  db: PrismaClient,
  clusterIds: string[],
  clusterMap: Map<string, string>
): Promise<Recommendation[]> {
  const recommendations: Recommendation[] = [];

  // Get all Cilium policies for these clusters
  const policies = await db.policy.findMany({
    where: {
      clusterId: { in: clusterIds },
      type: { in: ["CILIUM_NETWORK", "CILIUM_CLUSTERWIDE"] },
      status: { not: "ARCHIVED" },
    },
    select: {
      id: true,
      name: true,
      content: true,
      type: true,
      clusterId: true,
    },
  });

  // Group by cluster for comparison
  const policiesByCluster = new Map<
    string,
    Array<{ id: string; name: string; content: string; type: string }>
  >();

  for (const policy of policies) {
    let clusterPolicies = policiesByCluster.get(policy.clusterId);
    if (!clusterPolicies) {
      clusterPolicies = [];
      policiesByCluster.set(policy.clusterId, clusterPolicies);
    }
    clusterPolicies.push(policy);
  }

  // Find similar policies within each cluster
  for (const [clusterId, clusterPolicies] of policiesByCluster) {
    if (clusterPolicies.length < 2) continue;

    const similarPairs = findSimilarPolicies(clusterPolicies, 80);
    const clusterName = clusterMap.get(clusterId) ?? "Unknown";

    for (const pair of similarPairs) {
      const severity = getConsolidationSeverity(pair.similarity.similarityPercent);

      recommendations.push({
        id: `consolidation-${pair.policyA.id}-${pair.policyB.id}`,
        type: "CONSOLIDATION",
        severity,
        clusterId,
        clusterName,
        title: `Policies "${pair.policyA.name}" and "${pair.policyB.name}" overlap ${pair.similarity.similarityPercent}%`,
        description: `These policies target similar workloads and could potentially be merged. Shared labels: ${pair.similarity.sharedLabels.join(", ") || "none"}`,
        impact: pair.similarity.similarityPercent,
        suggestedAction: "Review and consider merging",
        metadata: {
          policyAId: pair.policyA.id,
          policyAName: pair.policyA.name,
          policyBId: pair.policyB.id,
          policyBName: pair.policyB.name,
          similarityPercent: pair.similarity.similarityPercent,
          sharedLabels: pair.similarity.sharedLabels,
          uniqueToA: pair.similarity.uniqueToA,
          uniqueToB: pair.similarity.uniqueToB,
        },
        createdAt: new Date().toISOString(),
      });
    }
  }

  return recommendations;
}
