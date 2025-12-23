import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "~/lib/db";
import {
  authenticateOperatorToken,
  unauthorized,
  requireScope,
} from "~/lib/api-auth";

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

    // Fetch pending simulations for this cluster
    const pendingSimulations = await db.policySimulation.findMany({
      where: {
        clusterId: auth.clusterId,
        status: "PENDING",
      },
      orderBy: {
        requestedAt: "asc", // Process oldest first
      },
      take: 10, // Limit batch size
    });

    // Transform to API response format
    const simulations: PendingSimulation[] = pendingSimulations.map((sim) => ({
      simulationId: sim.id,
      policyContent: sim.policyContent,
      policyType: sim.policyType,
      startTime: sim.startTime.toISOString(),
      endTime: sim.endTime.toISOString(),
      namespaces: sim.namespaces as string[] | undefined,
      includeDetails: sim.includeDetails ?? false,
      maxDetails: sim.maxDetails ?? 100,
      requestedAt: sim.requestedAt.toISOString(),
    }));

    // Mark simulations as in-progress to prevent duplicate processing
    if (simulations.length > 0) {
      await db.policySimulation.updateMany({
        where: {
          id: { in: simulations.map((s) => s.simulationId) },
        },
        data: {
          status: "IN_PROGRESS",
          startedAt: new Date(),
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

// Validation schema for creating simulations
const CreateSimulationSchema = z.object({
  policyContent: z.string().min(1),
  policyType: z.enum([
    "CILIUM_NETWORK",
    "CILIUM_CLUSTERWIDE",
    "TETRAGON",
    "GATEWAY_HTTPROUTE",
    "GATEWAY_GRPCROUTE",
    "GATEWAY_TCPROUTE",
  ]),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  namespaces: z.array(z.string()).optional(),
  includeDetails: z.boolean().optional(),
  maxDetails: z.number().int().min(1).max(1000).optional(),
});

/**
 * POST /api/operator/simulation/pending
 * Creates a new simulation request (called from dashboard UI)
 */
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
    const scopeError = requireScope(auth, "simulation:write");
    if (scopeError) {
      return scopeError;
    }

    // Parse and validate request body
    const body: unknown = await request.json();
    const parseResult = CreateSimulationSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request body", details: parseResult.error.issues },
        { status: 400 }
      );
    }

    const data: z.infer<typeof CreateSimulationSchema> = parseResult.data;

    // Default time range: last 24 hours
    const endTime = data.endTime ? new Date(data.endTime) : new Date();
    const startTime = data.startTime
      ? new Date(data.startTime)
      : new Date(endTime.getTime() - 24 * 60 * 60 * 1000);

    const simulation = await db.policySimulation.create({
      data: {
        clusterId: auth.clusterId,
        policyContent: data.policyContent,
        policyType: data.policyType,
        startTime,
        endTime,
        namespaces: data.namespaces ?? [],
        includeDetails: data.includeDetails ?? false,
        maxDetails: data.maxDetails ?? 100,
        status: "PENDING",
        requestedAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      simulationId: simulation.id,
    });
  } catch (error) {
    console.error("Error creating simulation:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
