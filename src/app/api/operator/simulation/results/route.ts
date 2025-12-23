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
  srcPodName: z.string(),
  dstNamespace: z.string(),
  dstPodName: z.string(),
  dstPort: z.number().int(),
  protocol: z.string(),
  originalVerdict: z.string(),
  simulatedVerdict: z.string(),
  wouldChange: z.boolean(),
});

const VerdictBreakdownSchema = z.object({
  allowedToAllowed: z.number().int(),
  allowedToDenied: z.number().int(),
  deniedToAllowed: z.number().int(),
  deniedToDenied: z.number().int(),
});

const SimulationResultSchema = z.object({
  simulationId: z.string(),
  clusterId: z.string(),
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
      return NextResponse.json(
        { success: false, error: "Invalid request body", details: parseResult.error.issues },
        { status: 400 }
      );
    }

    const data: z.infer<typeof SimulationResultSchema> = parseResult.data;

    // Verify cluster ID matches authenticated cluster
    if (data.clusterId !== auth.clusterId) {
      return NextResponse.json(
        { success: false, error: "Cluster ID mismatch" },
        { status: 403 }
      );
    }

    // Check if simulation exists and belongs to this cluster
    const existingSimulation = await db.policySimulation.findFirst({
      where: {
        id: data.simulationId,
        clusterId: data.clusterId,
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
    const status = hasErrors ? "COMPLETED_WITH_ERRORS" : "COMPLETED";

    // Update simulation with results
    await db.policySimulation.update({
      where: { id: data.simulationId },
      data: {
        status,
        completedAt: new Date(),
        totalFlowsAnalyzed: BigInt(data.totalFlowsAnalyzed),
        allowedCount: BigInt(data.allowedCount),
        deniedCount: BigInt(data.deniedCount),
        noChangeCount: BigInt(data.noChangeCount),
        wouldChangeCount: BigInt(data.wouldChangeCount),
        breakdownByNamespace: data.breakdownByNamespace as object,
        breakdownByVerdict: data.breakdownByVerdict as object,
        sampleFlows: data.sampleFlows as object[],
        errors: data.errors ?? [],
        durationNs: BigInt(data.duration),
      },
    });

    // Create notification for significant changes
    if (data.wouldChangeCount > 0) {
      await db.notification.create({
        data: {
          clusterId: data.clusterId,
          type: "SIMULATION_COMPLETE",
          title: "Policy Simulation Complete",
          message: `Simulation found ${data.wouldChangeCount} flows that would change behavior`,
          metadata: {
            simulationId: data.simulationId,
            wouldChangeCount: data.wouldChangeCount,
            totalFlowsAnalyzed: data.totalFlowsAnalyzed,
          },
          read: false,
        },
      });
    }

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
    const clusterId = searchParams.get("clusterId");

    if (!simulationId) {
      return NextResponse.json(
        { success: false, error: "Simulation ID required" },
        { status: 400 }
      );
    }

    const simulation = await db.policySimulation.findFirst({
      where: {
        id: simulationId,
        ...(clusterId ? { clusterId } : {}),
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
        clusterId: simulation.clusterId,
        policyContent: simulation.policyContent,
        policyType: simulation.policyType,
        status: simulation.status,
        startTime: simulation.startTime.toISOString(),
        endTime: simulation.endTime.toISOString(),
        namespaces: simulation.namespaces,
        totalFlowsAnalyzed: simulation.totalFlowsAnalyzed?.toString(),
        allowedCount: simulation.allowedCount?.toString(),
        deniedCount: simulation.deniedCount?.toString(),
        noChangeCount: simulation.noChangeCount?.toString(),
        wouldChangeCount: simulation.wouldChangeCount?.toString(),
        breakdownByNamespace: simulation.breakdownByNamespace,
        breakdownByVerdict: simulation.breakdownByVerdict,
        sampleFlows: simulation.sampleFlows,
        errors: simulation.errors,
        requestedAt: simulation.requestedAt.toISOString(),
        completedAt: simulation.completedAt?.toISOString(),
        durationMs: simulation.durationNs
          ? Number(simulation.durationNs) / 1_000_000
          : null,
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
