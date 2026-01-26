import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "~/lib/db";
import {
  authenticateOperatorToken,
  unauthorized,
  requireScope,
} from "~/lib/api-auth";

// This route uses request.headers, so it must be dynamic
export const dynamic = "force-dynamic";

// Response type for pending simulations
interface PendingSimulation {
  simulationId: string;
  policyContent: string;
  policyType: string;
  startTime: string;
  endTime: string;
  namespaces?: string[];
  includeDetails?: boolean;
  maxDetails?: number;
  requestedAt: string;
}

// Aggregation deadline - how long to wait for all nodes (5 minutes)
const AGGREGATION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * GET /api/operator/simulation/pending
 * Returns pending simulations for the authenticated cluster.
 *
 * Multi-node aggregation:
 * - Each collector node polls this endpoint
 * - Simulations are returned to collectors that haven't processed them yet
 * - Node identification via X-Node-Name header
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

    // Check required scope
    const scopeError = requireScope(auth, "simulation:read");
    if (scopeError) {
      return scopeError;
    }

    // Get the node name from header (sent by collector)
    const nodeName = request.headers.get("X-Node-Name") ?? "unknown";

    // Fetch simulations that this node hasn't processed yet
    // Include PENDING and RUNNING (for multi-node aggregation)
    const pendingSimulations = await db.simulation.findMany({
      where: {
        clusterId: auth.clusterId,
        status: { in: ["PENDING", "RUNNING"] },
      },
      orderBy: {
        createdAt: "asc",
      },
      take: 10,
      include: {
        policy: {
          select: {
            content: true,
            type: true,
            targetNamespaces: true,
          },
        },
        cluster: {
          select: {
            nodeCount: true,
          },
        },
      },
    });

    // Filter to simulations this node hasn't processed
    const simulationsForThisNode = pendingSimulations.filter((sim) => {
      const processedNodes = (sim.processedNodes as string[] | null) ?? [];
      return !processedNodes.includes(nodeName);
    });

    // Transform to API response format
    const simulations: PendingSimulation[] = simulationsForThisNode.map((sim) => ({
      simulationId: sim.id,
      policyContent: sim.policy.content,
      policyType: sim.policy.type,
      startTime: sim.startTime.toISOString(),
      endTime: sim.endTime.toISOString(),
      namespaces: (sim.policy.targetNamespaces?.length ?? 0) > 0
        ? sim.policy.targetNamespaces
        : undefined,
      includeDetails: true,
      maxDetails: 100,
      requestedAt: sim.createdAt.toISOString(),
    }));

    // Initialize multi-node tracking for PENDING simulations
    const pendingIds = simulationsForThisNode
      .filter((sim) => sim.status === "PENDING")
      .map((sim) => sim.id);

    if (pendingIds.length > 0) {
      // Get node count from cluster or default to 1
      const firstSim = simulationsForThisNode[0];
      const expectedNodes = firstSim?.cluster.nodeCount ?? 1;
      const aggregationDeadline = new Date(Date.now() + AGGREGATION_TIMEOUT_MS);

      await db.simulation.updateMany({
        where: {
          id: { in: pendingIds },
        },
        data: {
          status: "RUNNING",
          expectedNodes,
          processedNodes: [],
          nodeResults: {},
          aggregationDeadline,
        },
      });
    }

    return NextResponse.json({
      success: true,
      simulations,
      nodeName, // Echo back for debugging
    });
  } catch (error) {
    console.error("Error fetching pending simulations:", error);
    return NextResponse.json(
      {
        success: false,
        simulations: [],
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
