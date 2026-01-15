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

/**
 * GET /api/operator/simulation/pending
 * Returns pending simulations for the authenticated cluster
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

    // Fetch pending simulations from the Simulation table (created by UI)
    const pendingSimulations = await db.simulation.findMany({
      where: {
        clusterId: auth.clusterId,
        status: "PENDING",
      },
      orderBy: {
        createdAt: "asc", // Process oldest first
      },
      take: 10, // Limit batch size
      include: {
        policy: {
          select: {
            content: true,
            type: true,
            targetNamespaces: true,
          },
        },
      },
    });

    // Transform to API response format
    const simulations: PendingSimulation[] = pendingSimulations.map((sim) => ({
      simulationId: sim.id,
      policyContent: sim.policy.content,
      policyType: sim.policy.type,
      startTime: sim.startTime.toISOString(),
      endTime: sim.endTime.toISOString(),
      namespaces: sim.policy.targetNamespaces.length > 0
        ? sim.policy.targetNamespaces
        : undefined,
      includeDetails: true,
      maxDetails: 100,
      requestedAt: sim.createdAt.toISOString(),
    }));

    // Mark simulations as RUNNING to prevent duplicate processing
    if (simulations.length > 0) {
      await db.simulation.updateMany({
        where: {
          id: { in: simulations.map((s) => s.simulationId) },
        },
        data: {
          status: "RUNNING",
        },
      });
    }

    return NextResponse.json({
      success: true,
      simulations,
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
