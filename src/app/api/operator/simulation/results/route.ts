import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "~/lib/db";
import {
  authenticateOperatorToken,
  unauthorized,
  requireScope,
} from "~/lib/api-auth";

// Validation schemas
const NSImpactSchema = z.object({
  namespace: z.string(),
  totalFlows: z.number().int(),
  allowedCount: z.number().int(),
  deniedCount: z.number().int(),
  wouldDeny: z.number().int(),
  wouldAllow: z.number().int(),
  noChange: z.number().int(),
});

const SimulatedFlowSchema = z.object({
  srcNamespace: z.string(),
  srcPodName: z.string().optional(),
  dstNamespace: z.string(),
  dstPodName: z.string().optional(),
  dstPort: z.number().int(),
  protocol: z.string(),
  originalVerdict: z.string(),
  simulatedVerdict: z.string(),
  verdictChanged: z.boolean(),
  matchedRule: z.string().optional(),
  matchReason: z.string().optional(),
});

const VerdictBreakdownSchema = z.object({
  allowedToAllowed: z.number().int(),
  allowedToDenied: z.number().int(),
  deniedToAllowed: z.number().int(),
  deniedToDenied: z.number().int(),
  droppedToAllowed: z.number().int().optional(),
  droppedToDenied: z.number().int().optional(),
});

const SimulationResultSchema = z.object({
  simulationId: z.string(),
  clusterId: z.string().optional(),
  policyContent: z.string(),
  policyType: z.string(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  namespaces: z.array(z.string()).optional(),
  totalFlowsAnalyzed: z.number().int(),
  allowedCount: z.number().int(),
  deniedCount: z.number().int(),
  noChangeCount: z.number().int(),
  wouldChangeCount: z.number().int(),
  breakdownByNamespace: z.record(z.string(), NSImpactSchema).optional(),
  breakdownByVerdict: VerdictBreakdownSchema.optional(),
  sampleFlows: z.array(SimulatedFlowSchema).optional(),
  errors: z.array(z.string()).optional(),
  simulationTime: z.string().datetime(),
  duration: z.number().int(), // nanoseconds
});

/**
 * POST /api/operator/simulation/results
 * Receives simulation results from the operator
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
    const parseResult = SimulationResultSchema.safeParse(body);

    if (!parseResult.success) {
      console.error("Validation errors:", parseResult.error.issues);
      return NextResponse.json(
        { success: false, error: "Invalid request body", details: parseResult.error.issues },
        { status: 400 }
      );
    }

    const data = parseResult.data;

    // Check if simulation exists in Simulation table (created by UI)
    const existingSimulation = await db.simulation.findFirst({
      where: {
        id: data.simulationId,
        clusterId: auth.clusterId,
      },
    });

    if (!existingSimulation) {
      return NextResponse.json(
        { success: false, error: "Simulation not found" },
        { status: 404 }
      );
    }

    // Determine final status
    const hasErrors = data.errors && data.errors.length > 0;
    const status = hasErrors ? "FAILED" : "COMPLETED";

    // Update simulation with results
    await db.simulation.update({
      where: { id: data.simulationId },
      data: {
        status,
        completedAt: new Date(),
        flowsAnalyzed: data.totalFlowsAnalyzed,
        flowsAllowed: data.allowedCount,
        flowsDenied: data.deniedCount,
        flowsChanged: data.wouldChangeCount,
        results: {
          noChangeCount: data.noChangeCount,
          breakdownByNamespace: data.breakdownByNamespace,
          breakdownByVerdict: data.breakdownByVerdict,
          sampleFlows: data.sampleFlows,
          errors: data.errors,
          durationNs: data.duration,
        },
      },
    });

    // Log the update
    console.log(`Simulation ${data.simulationId} completed:`, {
      status,
      totalFlows: data.totalFlowsAnalyzed,
      wouldChange: data.wouldChangeCount,
    });

    return NextResponse.json({
      success: true,
      simulationId: data.simulationId,
    });
  } catch (error) {
    console.error("Error processing simulation results:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/operator/simulation/results
 * Retrieves simulation results (for dashboard)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const simulationId = searchParams.get("id");

    if (!simulationId) {
      return NextResponse.json(
        { success: false, error: "Simulation ID required" },
        { status: 400 }
      );
    }

    const simulation = await db.simulation.findFirst({
      where: {
        id: simulationId,
      },
      include: {
        policy: {
          select: {
            id: true,
            name: true,
            type: true,
            content: true,
          },
        },
        cluster: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!simulation) {
      return NextResponse.json(
        { success: false, error: "Simulation not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      simulation: {
        id: simulation.id,
        name: simulation.name,
        description: simulation.description,
        status: simulation.status,
        policy: simulation.policy,
        cluster: simulation.cluster,
        startTime: simulation.startTime.toISOString(),
        endTime: simulation.endTime.toISOString(),
        flowsAnalyzed: simulation.flowsAnalyzed,
        flowsAllowed: simulation.flowsAllowed,
        flowsDenied: simulation.flowsDenied,
        flowsChanged: simulation.flowsChanged,
        results: simulation.results,
        createdAt: simulation.createdAt.toISOString(),
        completedAt: simulation.completedAt?.toISOString(),
      },
    });
  } catch (error) {
    console.error("Error fetching simulation:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
