import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "~/lib/db";
import {
  authenticateOperatorToken,
  unauthorized,
  requireScope,
} from "~/lib/api-auth";

const flowRecordSchema = z.object({
  timestamp: z.string().datetime(),
  srcNamespace: z.string(),
  srcPodName: z.string().optional(),
  srcPodLabels: z.record(z.string()).optional(),
  srcIP: z.string(),
  srcPort: z.number().int().optional(),
  dstNamespace: z.string(),
  dstPodName: z.string().optional(),
  dstPodLabels: z.record(z.string()).optional(),
  dstIP: z.string(),
  dstPort: z.number().int(),
  protocol: z.enum(["TCP", "UDP", "ICMP", "SCTP"]),
  l7Protocol: z.enum(["HTTP", "gRPC", "DNS", "Kafka"]).optional(),
  httpMethod: z.string().optional(),
  httpPath: z.string().optional(),
  httpStatus: z.number().int().optional(),
  verdict: z.enum(["ALLOWED", "DENIED", "AUDIT", "UNKNOWN"]),
  bytesTotal: z.number().int().nonnegative().optional(),
  packetsTotal: z.number().int().nonnegative().optional(),
});

const flowBatchSchema = z.object({
  flows: z.array(flowRecordSchema).min(1).max(1000),
});

/**
 * POST /api/operator/flows
 * Submit batch of flow records from the operator.
 */
export async function POST(request: NextRequest) {
  // Authenticate the operator
  const auth = await authenticateOperatorToken(
    request.headers.get("Authorization")
  );
  if (!auth) {
    return unauthorized();
  }

  // Check required scope
  const scopeError = requireScope(auth, "flow:write");
  if (scopeError) return scopeError;

  try {
    const body: unknown = await request.json();

    // Validate request body
    const validationResult = flowBatchSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: validationResult.error.errors.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          })),
        },
        { status: 400 }
      );
    }

    const { flows } = validationResult.data;

    // Transform flows for database insertion
    const flowData = flows.map((flow) => ({
      timestamp: new Date(flow.timestamp),
      srcNamespace: flow.srcNamespace,
      srcPodName: flow.srcPodName ?? null,
      srcPodLabels: flow.srcPodLabels ?? Prisma.JsonNull,
      srcIP: flow.srcIP,
      srcPort: flow.srcPort ?? null,
      dstNamespace: flow.dstNamespace,
      dstPodName: flow.dstPodName ?? null,
      dstPodLabels: flow.dstPodLabels ?? Prisma.JsonNull,
      dstIP: flow.dstIP,
      dstPort: flow.dstPort,
      protocol: flow.protocol,
      l7Protocol: flow.l7Protocol ?? null,
      httpMethod: flow.httpMethod ?? null,
      httpPath: flow.httpPath ?? null,
      httpStatus: flow.httpStatus ?? null,
      verdict: flow.verdict,
      bytesTotal: flow.bytesTotal ? BigInt(flow.bytesTotal) : null,
      packetsTotal: flow.packetsTotal ? BigInt(flow.packetsTotal) : null,
      clusterId: auth.clusterId,
    }));

    // Bulk insert flow records
    const result = await db.flowRecord.createMany({
      data: flowData,
      skipDuplicates: true,
    });

    // Create audit log entry for significant batches
    if (flows.length >= 100) {
      await db.auditLog.create({
        data: {
          action: "flows.ingested",
          resource: "FlowRecord",
          details: {
            count: result.count,
            timeRange: {
              start: flows[0]?.timestamp,
              end: flows[flows.length - 1]?.timestamp,
            },
          },
          organizationId: auth.organizationId,
        },
      });
    }

    return NextResponse.json({
      success: true,
      received: flows.length,
      inserted: result.count,
    });
  } catch (error) {
    console.error("Error ingesting flows:", error);

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
