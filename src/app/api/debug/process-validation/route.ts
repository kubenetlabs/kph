import { NextResponse } from "next/server";
import { db } from "~/lib/db";

// Debug endpoint to check process validation data in database
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Get all ProcessValidationSummary records
    const summaries = await db.processValidationSummary.findMany({
      orderBy: { hour: "desc" },
      take: 50,
    });

    // Get all ProcessValidationEvent records (recent)
    const events = await db.processValidationEvent.findMany({
      orderBy: { timestamp: "desc" },
      take: 50,
    });

    // Get totals
    const totals = await db.processValidationSummary.aggregate({
      _sum: {
        allowedCount: true,
        blockedCount: true,
        noPolicyCount: true,
      },
    });

    // Get blocked events specifically
    const blockedEvents = await db.processValidationEvent.findMany({
      where: { verdict: "BLOCKED" },
      orderBy: { timestamp: "desc" },
      take: 20,
    });

    return NextResponse.json({
      summaryCount: summaries.length,
      eventCount: events.length,
      totals: totals._sum,
      blockedEventCount: blockedEvents.length,
      summaries: summaries.map((s) => ({
        id: s.id,
        clusterId: s.clusterId,
        hour: s.hour.toISOString(),
        allowedCount: s.allowedCount,
        blockedCount: s.blockedCount,
        noPolicyCount: s.noPolicyCount,
        topBlocked: s.topBlocked,
        coverageGaps: s.coverageGaps,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
      blockedEvents: blockedEvents.map((e) => ({
        id: e.id,
        clusterId: e.clusterId,
        timestamp: e.timestamp.toISOString(),
        verdict: e.verdict,
        namespace: e.namespace,
        podName: e.podName,
        binary: e.binary,
        matchedPolicy: e.matchedPolicy,
        action: e.action,
      })),
      recentEvents: events.slice(0, 10).map((e) => ({
        id: e.id,
        timestamp: e.timestamp.toISOString(),
        verdict: e.verdict,
        binary: e.binary,
        matchedPolicy: e.matchedPolicy,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
