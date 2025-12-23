import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "~/lib/db";
import {
  authenticateOperatorToken,
  unauthorized,
  requireScope,
} from "~/lib/api-auth";

// Validation schemas
const FlowSummarySchema = z.object({
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  nodeName: z.string(),
  srcNamespace: z.string(),
  dstNamespace: z.string(),
  srcPodName: z.string().optional(),
  dstPodName: z.string().optional(),
  dstPort: z.number().int(),
  protocol: z.string(),
  l7Type: z.string().optional(),
  totalFlows: z.number().int(),
  allowedFlows: z.number().int(),
  deniedFlows: z.number().int(),
  droppedFlows: z.number().int(),
  totalBytes: z.number().int(),
  totalPackets: z.number().int(),
  httpMethodCounts: z.record(z.string(), z.number()).optional(),
  httpStatusCounts: z.record(z.string(), z.number()).optional(),
  topHttpPaths: z.array(z.object({ path: z.string(), count: z.number() })).optional(),
  topDnsQueries: z.array(z.object({ query: z.string(), count: z.number() })).optional(),
});

const ProcessSummarySchema = z.object({
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  nodeName: z.string(),
  namespace: z.string(),
  podName: z.string().optional(),
  processName: z.string().optional(),
  execCount: z.number().int().optional(),
  totalExecs: z.number().int().optional(),
  uniqueBinaries: z.number().int().optional(),
  topBinaries: z.array(z.object({ binary: z.string(), count: z.number() })).optional(),
  totalSyscalls: z.number().int().optional(),
  syscallCounts: z.record(z.string(), z.number()).optional(),
  totalFileAccess: z.number().int().optional(),
  fileOpCounts: z.record(z.string(), z.number()).optional(),
  actionCounts: z.record(z.string(), z.number()).optional(),
});

const AggregatedTelemetrySchema = z.object({
  clusterId: z.string(),
  timestamp: z.string().datetime(),
  flowSummaries: z.array(FlowSummarySchema).optional(),
  processSummaries: z.array(ProcessSummarySchema).optional(),
});

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
    const parseResult = AggregatedTelemetrySchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parseResult.error.issues },
        { status: 400 }
      );
    }

    const data: z.infer<typeof AggregatedTelemetrySchema> = parseResult.data;

    // Verify cluster ID matches authenticated cluster
    if (data.clusterId !== auth.clusterId) {
      return NextResponse.json(
        { error: "Cluster ID mismatch" },
        { status: 403 }
      );
    }

    let flowSummariesCount = 0;
    let processSummariesCount = 0;

    // Store flow summaries
    if (data.flowSummaries && data.flowSummaries.length > 0) {
      const flowData = data.flowSummaries.map((summary) => ({
        clusterId: data.clusterId,
        timestamp: new Date(data.timestamp),
        windowStart: new Date(summary.windowStart),
        windowEnd: new Date(summary.windowEnd),
        nodeName: summary.nodeName,
        srcNamespace: summary.srcNamespace,
        dstNamespace: summary.dstNamespace,
        srcPodName: summary.srcPodName,
        dstPodName: summary.dstPodName,
        dstPort: summary.dstPort,
        protocol: summary.protocol,
        l7Type: summary.l7Type,
        totalFlows: BigInt(summary.totalFlows),
        allowedFlows: BigInt(summary.allowedFlows),
        deniedFlows: BigInt(summary.deniedFlows),
        droppedFlows: BigInt(summary.droppedFlows),
        totalBytes: BigInt(summary.totalBytes),
        totalPackets: BigInt(summary.totalPackets),
        httpMethodCounts: summary.httpMethodCounts,
        httpStatusCounts: summary.httpStatusCounts,
        topHttpPaths: summary.topHttpPaths,
        topDnsQueries: summary.topDnsQueries,
      }));

      // Batch insert flow summaries
      await db.flowSummary.createMany({
        data: flowData,
        skipDuplicates: true,
      });

      flowSummariesCount = flowData.length;
    }

    // Store process summaries
    if (data.processSummaries && data.processSummaries.length > 0) {
      const processData = data.processSummaries.map((summary) => ({
        clusterId: data.clusterId,
        timestamp: new Date(data.timestamp),
        windowStart: new Date(summary.windowStart),
        windowEnd: new Date(summary.windowEnd),
        nodeName: summary.nodeName,
        namespace: summary.namespace,
        podName: summary.podName ?? "",
        processName: summary.processName ?? "",
        execCount: summary.execCount ?? summary.totalExecs ?? 0,
        syscallCounts: summary.syscallCounts,
      }));

      await db.processSummary.createMany({
        data: processData,
        skipDuplicates: true,
      });

      processSummariesCount = processData.length;
    }

    // Update cluster's last telemetry timestamp
    await db.cluster.update({
      where: { id: data.clusterId },
      data: { lastTelemetryAt: new Date() },
    });

    return NextResponse.json({
      success: true,
      flowSummaries: flowSummariesCount,
      processSummaries: processSummariesCount,
    });
  } catch (error) {
    console.error("Error processing telemetry aggregates:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
