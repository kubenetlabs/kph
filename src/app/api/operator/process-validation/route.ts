import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "~/lib/db";
import {
  authenticateOperatorToken,
  unauthorized,
  requireScope,
} from "~/lib/api-auth";

// Schema for blocked process entries
const BlockedProcessSchema = z.object({
  namespace: z.string(),
  podName: z.string().optional(),
  binary: z.string(),
  policy: z.string(),
  count: z.number().int(),
});

// Schema for coverage gap entries (processes with no policy)
const ProcessCoverageGapSchema = z.object({
  namespace: z.string(),
  podName: z.string().optional(),
  binary: z.string(),
  count: z.number().int(),
});

// Schema for process validation summary ingestion
const ProcessValidationSummarySchema = z.object({
  hour: z.string().datetime(),
  allowedCount: z.number().int().min(0),
  blockedCount: z.number().int().min(0),
  noPolicyCount: z.number().int().min(0),
  topBlocked: z.array(BlockedProcessSchema).optional(),
  coverageGaps: z.array(ProcessCoverageGapSchema).optional(),
});

// Schema for individual process validation events
const ProcessValidationEventSchema = z.object({
  timestamp: z.string().datetime(),
  verdict: z.enum(["ALLOWED", "BLOCKED", "NO_POLICY"]),
  namespace: z.string(),
  podName: z.string().optional(),
  nodeName: z.string().optional(),
  binary: z.string(),
  arguments: z.string().optional(),
  parentBinary: z.string().optional(),
  syscall: z.string().optional(),
  filePath: z.string().optional(),
  matchedPolicy: z.string().optional(),
  action: z.string().optional(),
  reason: z.string().optional(),
});

// Schema for the full ingestion request
const ProcessValidationIngestionSchema = z.object({
  summaries: z.array(ProcessValidationSummarySchema).optional(),
  events: z.array(ProcessValidationEventSchema).max(1000).optional(),
});

/**
 * POST /api/operator/process-validation
 * Receives process validation summaries and events from cluster collectors (Tetragon data)
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
    const parseResult = ProcessValidationIngestionSchema.safeParse(body);

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

    // Upsert process validation summaries
    if (summaries && summaries.length > 0) {
      for (const summary of summaries) {
        await db.processValidationSummary.upsert({
          where: {
            clusterId_hour: {
              clusterId: auth.clusterId,
              hour: new Date(summary.hour),
            },
          },
          update: {
            allowedCount: { increment: summary.allowedCount },
            blockedCount: { increment: summary.blockedCount },
            noPolicyCount: { increment: summary.noPolicyCount },
            topBlocked: summary.topBlocked ?? undefined,
            coverageGaps: summary.coverageGaps ?? undefined,
          },
          create: {
            clusterId: auth.clusterId,
            hour: new Date(summary.hour),
            allowedCount: summary.allowedCount,
            blockedCount: summary.blockedCount,
            noPolicyCount: summary.noPolicyCount,
            topBlocked: summary.topBlocked ?? undefined,
            coverageGaps: summary.coverageGaps ?? undefined,
          },
        });
        summariesUpserted++;
      }
    }

    // Create process validation events (batch insert)
    if (events && events.length > 0) {
      const eventRecords = events.map((event) => ({
        clusterId: auth.clusterId,
        timestamp: new Date(event.timestamp),
        verdict: event.verdict,
        namespace: event.namespace,
        podName: event.podName,
        nodeName: event.nodeName,
        binary: event.binary,
        arguments: event.arguments,
        parentBinary: event.parentBinary,
        syscall: event.syscall,
        filePath: event.filePath,
        matchedPolicy: event.matchedPolicy,
        action: event.action,
        reason: event.reason,
      }));

      const result = await db.processValidationEvent.createMany({
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
    console.error("Error processing process validation data:", error);
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
 * GET /api/operator/process-validation
 * Returns process validation summary for the cluster
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
    const summaries = await db.processValidationSummary.findMany({
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
    console.error("Error fetching process validation summary:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
