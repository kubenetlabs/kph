import { NextResponse } from "next/server";
import { db } from "~/lib/db";

// Debug endpoint to check process summaries in database
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Get all clusters
    const clusters = await db.cluster.findMany({
      select: { id: true, name: true },
    });

    // Get all policies with their types
    const policies = await db.policy.findMany({
      select: { id: true, name: true, type: true },
      orderBy: { name: "asc" },
    });

    // Get latest 20 process summaries
    const processSummaries = await db.processSummary.findMany({
      orderBy: { timestamp: "desc" },
      take: 20,
      select: {
        id: true,
        clusterId: true,
        timestamp: true,
        windowStart: true,
        windowEnd: true,
        namespace: true,
        podName: true,
        processName: true,
        execCount: true,
      },
    });

    // Get count by cluster
    const countByCluster = await db.processSummary.groupBy({
      by: ["clusterId"],
      _count: { id: true },
    });

    // Search for suspicious processes (shell, curl, etc.)
    const suspiciousProcesses = await db.processSummary.findMany({
      where: {
        OR: [
          { processName: { contains: "/sh" } },
          { processName: { contains: "/bash" } },
          { processName: { contains: "/curl" } },
          { processName: { contains: "/wget" } },
          { processName: { contains: "/python" } },
        ],
      },
      orderBy: { timestamp: "desc" },
      take: 50,
      select: {
        id: true,
        clusterId: true,
        timestamp: true,
        namespace: true,
        podName: true,
        processName: true,
        execCount: true,
      },
    });

    return NextResponse.json({
      clusters,
      policies,
      countByCluster,
      suspiciousCount: suspiciousProcesses.length,
      suspiciousProcesses: suspiciousProcesses.map((ps) => ({
        ...ps,
        timestamp: ps.timestamp.toISOString(),
      })),
      latestSummaries: processSummaries.map((ps) => ({
        ...ps,
        timestamp: ps.timestamp.toISOString(),
        windowStart: ps.windowStart.toISOString(),
        windowEnd: ps.windowEnd.toISOString(),
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
