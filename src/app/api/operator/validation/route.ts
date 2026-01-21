import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "~/lib/db";
import {
  authenticateOperatorToken,
  unauthorized,
  requireScope,
} from "~/lib/api-auth";

// Schema for coverage gap entries
const CoverageGapSchema = z.object({
  srcNamespace: z.string(),
  srcPodName: z.string().optional(),
  dstNamespace: z.string(),
  dstPodName: z.string().optional(),
  dstPort: z.number().int(),
  count: z.number().int(),
});

// Schema for blocked flow entries
const BlockedFlowSchema = z.object({
  srcNamespace: z.string(),
  srcPodName: z.string().optional(),
  dstNamespace: z.string(),
  dstPodName: z.string().optional(),
  dstPort: z.number().int().optional(),
  policy: z.string(),
  count: z.number().int(),
});

// Schema for validation summary ingestion
const ValidationSummarySchema = z.object({
  hour: z.string().datetime(),
  allowedCount: z.number().int().min(0),
  blockedCount: z.number().int().min(0),
  noPolicyCount: z.number().int().min(0),
  coverageGaps: z.array(CoverageGapSchema).optional(),
  topBlocked: z.array(BlockedFlowSchema).optional(),
});

// Schema for individual validation events
const ValidationEventSchema = z.object({
  timestamp: z.string().datetime(),
  verdict: z.enum(["ALLOWED", "BLOCKED", "NO_POLICY"]),
  srcNamespace: z.string(),
  srcPodName: z.string().optional(),
  srcLabels: z.record(z.string()).optional(),
  dstNamespace: z.string(),
  dstPodName: z.string().optional(),
  dstLabels: z.record(z.string()).optional(),
  dstPort: z.number().int(),
  protocol: z.string(),
  matchedPolicy: z.string().optional(),
  reason: z.string().optional(),
});

// Schema for the full ingestion request
const ValidationIngestionSchema = z.object({
  summaries: z.array(ValidationSummarySchema).optional(),
  events: z.array(ValidationEventSchema).max(1000).optional(),
});

// Types for merge operations
type CoverageGapType = z.infer<typeof CoverageGapSchema>;
type BlockedFlowType = z.infer<typeof BlockedFlowSchema>;

/**
 * Merge coverage gaps by combining entries with matching keys and summing counts.
 * Keeps top 20 by count.
 */
function mergeCoverageGaps(
  existing: CoverageGapType[],
  incoming: CoverageGapType[]
): CoverageGapType[] {
  const map = new Map<string, CoverageGapType>();

  // Add existing gaps
  for (const gap of existing) {
    const key = `${gap.srcNamespace}/${gap.srcPodName ?? ""}/${gap.dstNamespace}/${gap.dstPodName ?? ""}/${gap.dstPort}`;
    map.set(key, { ...gap });
  }

  // Merge incoming gaps
  for (const gap of incoming) {
    const key = `${gap.srcNamespace}/${gap.srcPodName ?? ""}/${gap.dstNamespace}/${gap.dstPodName ?? ""}/${gap.dstPort}`;
    const existingGap = map.get(key);
    if (existingGap) {
      existingGap.count += gap.count;
    } else {
      map.set(key, { ...gap });
    }
  }

  // Sort by count descending and take top 20
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

/**
 * Merge blocked flows by combining entries with matching keys and summing counts.
 * Keeps top 20 by count.
 */
function mergeTopBlocked(
  existing: BlockedFlowType[],
  incoming: BlockedFlowType[]
): BlockedFlowType[] {
  const map = new Map<string, BlockedFlowType>();

  // Add existing blocked flows
  for (const flow of existing) {
    const key = `${flow.srcNamespace}/${flow.srcPodName ?? ""}/${flow.dstNamespace}/${flow.policy}`;
    map.set(key, { ...flow });
  }

  // Merge incoming blocked flows
  for (const flow of incoming) {
    const key = `${flow.srcNamespace}/${flow.srcPodName ?? ""}/${flow.dstNamespace}/${flow.policy}`;
    const existingFlow = map.get(key);
    if (existingFlow) {
      existingFlow.count += flow.count;
    } else {
      map.set(key, { ...flow });
    }
  }

  // Sort by count descending and take top 20
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

/**
 * POST /api/operator/validation
 * Receives validation summaries and events from cluster collectors
 */
export async function POST(request: NextRequest) {
  try {
    // Authenticate operator token
    const auth = await authenticateOperatorToken(
      request.headers.get("Authorization")
    );
    if (!auth) {
      return unauthorized();
    }

    // Check required scope
    const scopeError = requireScope(auth, "telemetry:write");
    if (scopeError) {
      return scopeError;
    }

    // Parse and validate request body
    const body: unknown = await request.json();
    const parseResult = ValidationIngestionSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request body",
          details: parseResult.error.issues,
        },
        { status: 400 }
      );
    }

    const { summaries, events } = parseResult.data;
    let summariesUpserted = 0;
    let eventsCreated = 0;

    // Upsert validation summaries with proper JSON merging
    if (summaries && summaries.length > 0) {
      for (const summary of summaries) {
        // First check if record exists to properly merge JSON arrays
        const existing = await db.validationSummary.findUnique({
          where: {
            clusterId_hour: {
              clusterId: auth.clusterId,
              hour: new Date(summary.hour),
            },
          },
        });

        if (existing) {
          // Merge coverage gaps and top blocked instead of overwriting
          const existingGaps = (existing.coverageGaps as CoverageGapType[] | null) ?? [];
          const existingBlocked = (existing.topBlocked as BlockedFlowType[] | null) ?? [];

          const mergedGaps = summary.coverageGaps
            ? mergeCoverageGaps(existingGaps, summary.coverageGaps)
            : existingGaps;
          const mergedBlocked = summary.topBlocked
            ? mergeTopBlocked(existingBlocked, summary.topBlocked)
            : existingBlocked;

          await db.validationSummary.update({
            where: {
              clusterId_hour: {
                clusterId: auth.clusterId,
                hour: new Date(summary.hour),
              },
            },
            data: {
              allowedCount: { increment: summary.allowedCount },
              blockedCount: { increment: summary.blockedCount },
              noPolicyCount: { increment: summary.noPolicyCount },
              coverageGaps: mergedGaps.length > 0 ? mergedGaps : undefined,
              topBlocked: mergedBlocked.length > 0 ? mergedBlocked : undefined,
            },
          });
        } else {
          // Create new record
          await db.validationSummary.create({
            data: {
              clusterId: auth.clusterId,
              hour: new Date(summary.hour),
              allowedCount: summary.allowedCount,
              blockedCount: summary.blockedCount,
              noPolicyCount: summary.noPolicyCount,
              coverageGaps: summary.coverageGaps ?? undefined,
              topBlocked: summary.topBlocked ?? undefined,
            },
          });
        }
        summariesUpserted++;
      }
    }

    // Create validation events (batch insert)
    if (events && events.length > 0) {
      const eventRecords = events.map((event) => ({
        clusterId: auth.clusterId,
        timestamp: new Date(event.timestamp),
        verdict: event.verdict,
        srcNamespace: event.srcNamespace,
        srcPodName: event.srcPodName,
        srcLabels: event.srcLabels ?? undefined,
        dstNamespace: event.dstNamespace,
        dstPodName: event.dstPodName,
        dstLabels: event.dstLabels ?? undefined,
        dstPort: event.dstPort,
        protocol: event.protocol,
        matchedPolicy: event.matchedPolicy,
        reason: event.reason,
      }));

      const result = await db.validationEvent.createMany({
        data: eventRecords,
        skipDuplicates: true,
      });
      eventsCreated = result.count;
    }

    return NextResponse.json({
      success: true,
      summariesUpserted,
      eventsCreated,
    });
  } catch (error) {
    console.error("[Validation API] Error processing validation data:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/operator/validation/summary
 * Returns validation summary for the cluster
 */
export async function GET(request: NextRequest) {
  try {
    // Authenticate operator token
    const auth = await authenticateOperatorToken(
      request.headers.get("Authorization")
    );
    if (!auth) {
      return unauthorized();
    }

    const scopeError = requireScope(auth, "telemetry:write");
    if (scopeError) {
      return scopeError;
    }

    const { searchParams } = new URL(request.url);
    const hours = parseInt(searchParams.get("hours") ?? "24", 10);

    const startTime = new Date();
    startTime.setHours(startTime.getHours() - hours);

    // Get aggregated summaries
    const summaries = await db.validationSummary.findMany({
      where: {
        clusterId: auth.clusterId,
        hour: { gte: startTime },
      },
      orderBy: { hour: "desc" },
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

    return NextResponse.json({
      success: true,
      clusterId: auth.clusterId,
      period: { hours, startTime: startTime.toISOString() },
      totals,
      hourlyBreakdown: summaries.map((s) => ({
        hour: s.hour.toISOString(),
        allowed: s.allowedCount,
        blocked: s.blockedCount,
        noPolicy: s.noPolicyCount,
      })),
    });
  } catch (error) {
    console.error("Error fetching validation summary:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
