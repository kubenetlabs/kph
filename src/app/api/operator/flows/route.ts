import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "~/lib/db";
import {
  authenticateOperatorToken,
  unauthorized,
  requireScope,
} from "~/lib/api-auth";

// Schema for flow query parameters
const flowQuerySchema = z.object({
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  namespaces: z.array(z.string()).optional(),
  srcNamespace: z.string().optional(),
  dstNamespace: z.string().optional(),
  verdict: z.enum(["ALLOWED", "DENIED", "AUDIT", "UNKNOWN"]).optional(),
  limit: z.coerce.number().int().min(1).max(10000).default(1000),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * GET /api/operator/flows
 * Query flow records for on-demand simulation.
 * Supports filtering by time range, namespaces, and verdict.
 */
export async function GET(request: NextRequest) {
  // Authenticate the operator
  const auth = await authenticateOperatorToken(
    request.headers.get("Authorization")
  );
  if (!auth) {
    return unauthorized();
  }

  // Check required scope - simulation:read allows querying flows for simulation
  const scopeError = requireScope(auth, "simulation:read");
  if (scopeError) return scopeError;

  try {
    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const queryParams = {
      startTime: searchParams.get("startTime"),
      endTime: searchParams.get("endTime"),
      namespaces: searchParams.get("namespaces")?.split(",").filter(Boolean),
      srcNamespace: searchParams.get("srcNamespace"),
      dstNamespace: searchParams.get("dstNamespace"),
      verdict: searchParams.get("verdict"),
      limit: searchParams.get("limit") ?? "1000",
      offset: searchParams.get("offset") ?? "0",
    };

    // Validate query parameters
    const validationResult = flowQuerySchema.safeParse(queryParams);
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: "Invalid query parameters",
          details: validationResult.error.errors.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          })),
        },
        { status: 400 }
      );
    }

    const { startTime, endTime, namespaces, srcNamespace, dstNamespace, verdict, limit, offset } =
      validationResult.data;

    // Build WHERE clause
    const where: Prisma.FlowRecordWhereInput = {
      clusterId: auth.clusterId,
      timestamp: {
        gte: new Date(startTime),
        lte: new Date(endTime),
      },
    };

    // Add namespace filters
    if (namespaces && namespaces.length > 0) {
      where.OR = [
        { srcNamespace: { in: namespaces } },
        { dstNamespace: { in: namespaces } },
      ];
    }
    if (srcNamespace) {
      where.srcNamespace = srcNamespace;
    }
    if (dstNamespace) {
      where.dstNamespace = dstNamespace;
    }
    if (verdict) {
      where.verdict = verdict;
    }

    // Query flows with count
    const [flows, totalCount] = await Promise.all([
      db.flowRecord.findMany({
        where,
        orderBy: { timestamp: "asc" },
        take: limit,
        skip: offset,
        select: {
          id: true,
          timestamp: true,
          srcNamespace: true,
          srcPodName: true,
          srcPodLabels: true,
          srcIP: true,
          srcPort: true,
          dstNamespace: true,
          dstPodName: true,
          dstPodLabels: true,
          dstIP: true,
          dstPort: true,
          protocol: true,
          l7Protocol: true,
          httpMethod: true,
          httpPath: true,
          httpStatus: true,
          verdict: true,
          bytesTotal: true,
          packetsTotal: true,
        },
      }),
      db.flowRecord.count({ where }),
    ]);

    // Transform BigInt values to numbers for JSON serialization
    const transformedFlows = flows.map((flow) => ({
      ...flow,
      timestamp: flow.timestamp.toISOString(),
      bytesTotal: flow.bytesTotal ? Number(flow.bytesTotal) : null,
      packetsTotal: flow.packetsTotal ? Number(flow.packetsTotal) : null,
    }));

    return NextResponse.json({
      success: true,
      flows: transformedFlows,
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: offset + flows.length < totalCount,
      },
    });
  } catch (error) {
    console.error("Error querying flows:", error);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

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
