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

// Schema for Gateway API route validation result
const GatewayRouteValidationSchema = z.object({
  kind: z.string(),
  name: z.string(),
  namespace: z.string(),
  valid: z.boolean(),
  errors: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
  validatedAt: z.string().datetime(),
});

// Schema for Gateway API validation payload
const GatewayValidationSchema = z.object({
  timestamp: z.string().datetime(),
  totalRoutes: z.number().int().min(0),
  validRoutes: z.number().int().min(0),
  invalidRoutes: z.number().int().min(0),
  totalGateways: z.number().int().min(0),
  results: z.array(GatewayRouteValidationSchema).optional(),
});

// Schema for the full ingestion request
const ValidationIngestionSchema = z.object({
  summaries: z.array(ValidationSummarySchema).optional(),
  events: z.array(ValidationEventSchema).max(1000).optional(),
  gatewayValidation: GatewayValidationSchema.optional(),
});

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

    const { summaries, events, gatewayValidation } = parseResult.data;
    let summariesUpserted = 0;
    let eventsCreated = 0;
    let gatewayRoutesValidated = 0;

    // Upsert validation summaries
    if (summaries && summaries.length > 0) {
      for (const summary of summaries) {
        await db.validationSummary.upsert({
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
            coverageGaps: summary.coverageGaps ?? undefined,
            topBlocked: summary.topBlocked ?? undefined,
          },
          create: {
            clusterId: auth.clusterId,
            hour: new Date(summary.hour),
            allowedCount: summary.allowedCount,
            blockedCount: summary.blockedCount,
            noPolicyCount: summary.noPolicyCount,
            coverageGaps: summary.coverageGaps ?? undefined,
            topBlocked: summary.topBlocked ?? undefined,
          },
        });
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

    // Process Gateway API validation results
    if (gatewayValidation?.results) {
      for (const routeResult of gatewayValidation.results) {
        // Update the GatewayAPIPolicy with validation results
        // Find by name/namespace/kind in this cluster
        const gatewayPolicy = await db.gatewayAPIPolicy.findFirst({
          where: {
            cluster: { id: auth.clusterId },
            name: routeResult.name,
            namespace: routeResult.namespace,
            kind: routeResult.kind as "HTTPRoute" | "GRPCRoute" | "TCPRoute" | "TLSRoute" | "Gateway" | "ReferenceGrant",
          },
        });

        if (gatewayPolicy) {
          // Store validation results in annotations field
          const currentAnnotations = (gatewayPolicy.annotations as Record<string, unknown>) ?? {};
          await db.gatewayAPIPolicy.update({
            where: { id: gatewayPolicy.id },
            data: {
              annotations: {
                ...currentAnnotations,
                "policyhub.io/validation-valid": routeResult.valid.toString(),
                "policyhub.io/validation-errors": JSON.stringify(routeResult.errors ?? []),
                "policyhub.io/validation-warnings": JSON.stringify(routeResult.warnings ?? []),
                "policyhub.io/validation-timestamp": routeResult.validatedAt,
              },
            },
          });
          gatewayRoutesValidated++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      summariesUpserted,
      eventsCreated,
      gatewayRoutesValidated,
    });
  } catch (error) {
    console.error("Error processing validation data:", error);
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
