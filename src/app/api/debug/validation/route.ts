import { type NextRequest, NextResponse } from "next/server";
import { db } from "~/lib/db";

/**
 * GET /api/debug/validation
 * Debug endpoint to show all validation data for a cluster.
 * Query params:
 *   - clusterId (required): The cluster ID to query
 *   - hours (optional): Number of hours to look back (default: 168 = 1 week)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clusterId = searchParams.get("clusterId");
  const hours = parseInt(searchParams.get("hours") ?? "168", 10);

  if (!clusterId) {
    return NextResponse.json(
      { error: "clusterId query parameter is required" },
      { status: 400 }
    );
  }

  const startTime = new Date();
  startTime.setHours(startTime.getHours() - hours);

  try {
    // Get all validation summaries for this cluster
    const summaries = await db.validationSummary.findMany({
      where: {
        clusterId,
        hour: { gte: startTime },
      },
      orderBy: { hour: "desc" },
    });

    // Get recent validation events
    const events = await db.validationEvent.findMany({
      where: {
        clusterId,
        timestamp: { gte: startTime },
      },
      orderBy: { timestamp: "desc" },
      take: 100,
    });

    // Get cluster info
    const cluster = await db.cluster.findUnique({
      where: { id: clusterId },
      select: { id: true, name: true, organizationId: true },
    });

    const now = new Date();

    return NextResponse.json({
      debug: {
        queryTime: now.toISOString(),
        startTime: startTime.toISOString(),
        hours,
        clusterId,
      },
      cluster,
      summaries: summaries.map(s => ({
        id: s.id,
        hour: s.hour.toISOString(),
        hourLocal: s.hour.toLocaleString(),
        allowed: s.allowedCount,
        blocked: s.blockedCount,
        noPolicy: s.noPolicyCount,
        topBlocked: s.topBlocked,
        coverageGaps: s.coverageGaps,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
      summaryCount: summaries.length,
      totals: summaries.reduce(
        (acc, s) => ({
          allowed: acc.allowed + s.allowedCount,
          blocked: acc.blocked + s.blockedCount,
          noPolicy: acc.noPolicy + s.noPolicyCount,
        }),
        { allowed: 0, blocked: 0, noPolicy: 0 }
      ),
      recentEvents: events.map(e => ({
        id: e.id,
        timestamp: e.timestamp.toISOString(),
        verdict: e.verdict,
        srcNamespace: e.srcNamespace,
        dstNamespace: e.dstNamespace,
        dstPort: e.dstPort,
        matchedPolicy: e.matchedPolicy,
      })),
      eventCount: events.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}
