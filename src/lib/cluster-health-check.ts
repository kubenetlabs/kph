/**
 * Cluster Health Check
 *
 * Detects clusters with stale heartbeats and marks them as ERROR.
 * Should be run periodically via cron (every 10 minutes recommended).
 */

import { db } from "~/lib/db";

const STALE_THRESHOLD_HOURS = 2;

export interface HealthCheckResult {
  staleClustersUpdated: number;
  checkedAt: Date;
  thresholdHours: number;
}

/**
 * Detects and marks clusters with stale heartbeats as ERROR.
 * A heartbeat is considered stale if it's older than STALE_THRESHOLD_HOURS.
 */
export async function detectStaleClusters(): Promise<HealthCheckResult> {
  const thresholdTime = new Date(
    Date.now() - STALE_THRESHOLD_HOURS * 60 * 60 * 1000
  );

  const result = await db.cluster.updateMany({
    where: {
      status: { in: ["CONNECTED", "DEGRADED"] },
      lastHeartbeat: { lt: thresholdTime },
    },
    data: { status: "ERROR" },
  });

  if (result.count > 0) {
    console.log(
      `[cluster-health-check] Marked ${result.count} cluster(s) as ERROR due to stale heartbeat (threshold: ${STALE_THRESHOLD_HOURS}h)`
    );

    // Create audit log entries for each stale cluster
    const staleClusters = await db.cluster.findMany({
      where: {
        status: "ERROR",
        lastHeartbeat: { lt: thresholdTime },
      },
      select: {
        id: true,
        name: true,
        organizationId: true,
        lastHeartbeat: true,
      },
    });

    // Batch create audit logs
    if (staleClusters.length > 0) {
      await db.auditLog.createMany({
        data: staleClusters.map((cluster) => ({
          action: "cluster.stale_heartbeat",
          resourceType: "Cluster",
          resourceId: cluster.id,
          organizationId: cluster.organizationId,
          details: {
            clusterName: cluster.name,
            lastHeartbeat: cluster.lastHeartbeat?.toISOString(),
            thresholdHours: STALE_THRESHOLD_HOURS,
          },
        })),
      });
    }
  }

  return {
    staleClustersUpdated: result.count,
    checkedAt: new Date(),
    thresholdHours: STALE_THRESHOLD_HOURS,
  };
}

/**
 * Gets clusters that are approaching the stale threshold (warning zone).
 * Useful for proactive notifications.
 */
export async function getWarningClusters() {
  const warningThreshold = new Date(
    Date.now() - (STALE_THRESHOLD_HOURS - 0.5) * 60 * 60 * 1000 // 30 min before stale
  );
  const staleThreshold = new Date(
    Date.now() - STALE_THRESHOLD_HOURS * 60 * 60 * 1000
  );

  return db.cluster.findMany({
    where: {
      status: { in: ["CONNECTED", "DEGRADED"] },
      lastHeartbeat: {
        lt: warningThreshold,
        gte: staleThreshold,
      },
    },
    select: {
      id: true,
      name: true,
      status: true,
      lastHeartbeat: true,
      organizationId: true,
    },
  });
}
