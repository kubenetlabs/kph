import { type NextRequest, NextResponse } from "next/server";
import { detectStaleClusters } from "~/lib/cluster-health-check";

/**
 * GET /api/cron/cluster-health
 *
 * Cron endpoint to detect and mark stale clusters.
 * Should be called every 10 minutes via Vercel Cron or external scheduler.
 *
 * Security: Protected by CRON_SECRET environment variable.
 */
export async function GET(request: NextRequest) {
  // Verify cron secret to prevent unauthorized access
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await detectStaleClusters();

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("[cron/cluster-health] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
