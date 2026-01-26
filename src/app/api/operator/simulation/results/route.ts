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
  nodeName: z.string().optional(), // NEW: Node that produced these results
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

// Type for node results storage
interface NodeResult {
  nodeName: string;
  totalFlowsAnalyzed: number;
  allowedCount: number;
  deniedCount: number;
  noChangeCount: number;
  wouldChangeCount: number;
  breakdownByNamespace?: Record<string, z.infer<typeof NSImpactSchema>>;
  breakdownByVerdict?: z.infer<typeof VerdictBreakdownSchema>;
  sampleFlows?: z.infer<typeof SimulatedFlowSchema>[];
  errors?: string[];
  duration: number;
  submittedAt: string;
}

// Aggregates results from multiple nodes
function aggregateNodeResults(nodeResults: Record<string, NodeResult>): {
  flowsAnalyzed: number;
  flowsAllowed: number;
  flowsDenied: number;
  flowsChanged: number;
  aggregatedResults: {
    noChangeCount: number;
    breakdownByNamespace: Record<string, z.infer<typeof NSImpactSchema>>;
    breakdownByVerdict: z.infer<typeof VerdictBreakdownSchema>;
    sampleFlows: z.infer<typeof SimulatedFlowSchema>[];
    errors: string[];
    nodeBreakdown: Record<string, { flowsAnalyzed: number; flowsChanged: number }>;
    durationNs: number;
  };
} {
  let totalFlows = 0;
  let totalAllowed = 0;
  let totalDenied = 0;
  let totalChanged = 0;
  let totalNoChange = 0;
  let maxDuration = 0;

  const aggregatedBreakdownByNs: Record<string, z.infer<typeof NSImpactSchema>> = {};
  const aggregatedBreakdownByVerdict: z.infer<typeof VerdictBreakdownSchema> = {
    allowedToAllowed: 0,
    allowedToDenied: 0,
    deniedToAllowed: 0,
    deniedToDenied: 0,
    droppedToAllowed: 0,
    droppedToDenied: 0,
  };
  const allSampleFlows: z.infer<typeof SimulatedFlowSchema>[] = [];
  const allErrors: string[] = [];
  const nodeBreakdown: Record<string, { flowsAnalyzed: number; flowsChanged: number }> = {};

  for (const [nodeName, result] of Object.entries(nodeResults)) {
    totalFlows += result.totalFlowsAnalyzed;
    totalAllowed += result.allowedCount;
    totalDenied += result.deniedCount;
    totalChanged += result.wouldChangeCount;
    totalNoChange += result.noChangeCount;
    maxDuration = Math.max(maxDuration, result.duration);

    nodeBreakdown[nodeName] = {
      flowsAnalyzed: result.totalFlowsAnalyzed,
      flowsChanged: result.wouldChangeCount,
    };

    // Merge namespace breakdown
    if (result.breakdownByNamespace) {
      for (const [ns, impact] of Object.entries(result.breakdownByNamespace)) {
        if (!aggregatedBreakdownByNs[ns]) {
          aggregatedBreakdownByNs[ns] = { ...impact };
        } else {
          const existing = aggregatedBreakdownByNs[ns];
          existing.totalFlows += impact.totalFlows;
          existing.allowedCount += impact.allowedCount;
          existing.deniedCount += impact.deniedCount;
          existing.wouldDeny += impact.wouldDeny;
          existing.wouldAllow += impact.wouldAllow;
          existing.noChange += impact.noChange;
        }
      }
    }

    // Merge verdict breakdown
    if (result.breakdownByVerdict) {
      aggregatedBreakdownByVerdict.allowedToAllowed += result.breakdownByVerdict.allowedToAllowed;
      aggregatedBreakdownByVerdict.allowedToDenied += result.breakdownByVerdict.allowedToDenied;
      aggregatedBreakdownByVerdict.deniedToAllowed += result.breakdownByVerdict.deniedToAllowed;
      aggregatedBreakdownByVerdict.deniedToDenied += result.breakdownByVerdict.deniedToDenied;
      aggregatedBreakdownByVerdict.droppedToAllowed =
        (aggregatedBreakdownByVerdict.droppedToAllowed ?? 0) +
        (result.breakdownByVerdict.droppedToAllowed ?? 0);
      aggregatedBreakdownByVerdict.droppedToDenied =
        (aggregatedBreakdownByVerdict.droppedToDenied ?? 0) +
        (result.breakdownByVerdict.droppedToDenied ?? 0);
    }

    // Collect sample flows (limit to 20 per node, 100 total)
    if (result.sampleFlows) {
      allSampleFlows.push(...result.sampleFlows.slice(0, 20));
    }

    // Collect errors
    if (result.errors) {
      allErrors.push(...result.errors.map((e) => `[${nodeName}] ${e}`));
    }
  }

  return {
    flowsAnalyzed: totalFlows,
    flowsAllowed: totalAllowed,
    flowsDenied: totalDenied,
    flowsChanged: totalChanged,
    aggregatedResults: {
      noChangeCount: totalNoChange,
      breakdownByNamespace: aggregatedBreakdownByNs,
      breakdownByVerdict: aggregatedBreakdownByVerdict,
      sampleFlows: allSampleFlows.slice(0, 100),
      errors: allErrors,
      nodeBreakdown,
      durationNs: maxDuration,
    },
  };
}

/**
 * POST /api/operator/simulation/results
 * Receives simulation results from a collector node.
 *
 * Multi-node aggregation:
 * - Each node submits its partial results with nodeName
 * - Results are aggregated when all nodes respond or deadline is reached
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

    // Get node name from header or body
    const headerNodeName = request.headers.get("X-Node-Name");

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
    const nodeName = data.nodeName ?? headerNodeName ?? "unknown";

    // Check if simulation exists
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

    // Get current node tracking state
    const processedNodes = (existingSimulation.processedNodes as string[] | null) ?? [];
    const nodeResults = (existingSimulation.nodeResults as Record<string, NodeResult> | null) ?? {};
    const expectedNodes = existingSimulation.expectedNodes ?? 1;

    // Check if this node already submitted
    if (processedNodes.includes(nodeName)) {
      console.log(`Node ${nodeName} already submitted results for simulation ${data.simulationId}`);
      return NextResponse.json({
        success: true,
        simulationId: data.simulationId,
        message: "Results already submitted by this node",
      });
    }

    // Store this node's results
    const nodeResult: NodeResult = {
      nodeName,
      totalFlowsAnalyzed: data.totalFlowsAnalyzed,
      allowedCount: data.allowedCount,
      deniedCount: data.deniedCount,
      noChangeCount: data.noChangeCount,
      wouldChangeCount: data.wouldChangeCount,
      breakdownByNamespace: data.breakdownByNamespace,
      breakdownByVerdict: data.breakdownByVerdict,
      sampleFlows: data.sampleFlows,
      errors: data.errors,
      duration: data.duration,
      submittedAt: new Date().toISOString(),
    };

    const updatedProcessedNodes = [...processedNodes, nodeName];
    const updatedNodeResults = { ...nodeResults, [nodeName]: nodeResult };

    // Check if all nodes have responded or deadline passed
    const allNodesResponded = updatedProcessedNodes.length >= expectedNodes;
    const deadlinePassed = existingSimulation.aggregationDeadline
      ? new Date() >= existingSimulation.aggregationDeadline
      : false;

    const shouldFinalize = allNodesResponded || deadlinePassed;

    if (shouldFinalize) {
      // Aggregate results from all nodes
      const aggregated = aggregateNodeResults(updatedNodeResults);
      const hasErrors = aggregated.aggregatedResults.errors.length > 0;
      const status = hasErrors ? "FAILED" : "COMPLETED";

      await db.simulation.update({
        where: { id: data.simulationId },
        data: {
          status,
          completedAt: new Date(),
          processedNodes: updatedProcessedNodes as unknown as string[],
          nodeResults: updatedNodeResults as unknown as Record<string, unknown>,
          flowsAnalyzed: aggregated.flowsAnalyzed,
          flowsAllowed: aggregated.flowsAllowed,
          flowsDenied: aggregated.flowsDenied,
          flowsChanged: aggregated.flowsChanged,
          results: aggregated.aggregatedResults as unknown as Record<string, unknown>,
        },
      });

      console.log(`Simulation ${data.simulationId} finalized:`, {
        status,
        nodesResponded: updatedProcessedNodes.length,
        expectedNodes,
        totalFlows: aggregated.flowsAnalyzed,
        wouldChange: aggregated.flowsChanged,
      });
    } else {
      // Store partial results, keep RUNNING
      await db.simulation.update({
        where: { id: data.simulationId },
        data: {
          processedNodes: updatedProcessedNodes as unknown as string[],
          nodeResults: updatedNodeResults as unknown as Record<string, unknown>,
        },
      });

      console.log(`Simulation ${data.simulationId} partial result from ${nodeName}:`, {
        nodesResponded: updatedProcessedNodes.length,
        expectedNodes,
        flows: data.totalFlowsAnalyzed,
        wouldChange: data.wouldChangeCount,
      });
    }

    return NextResponse.json({
      success: true,
      simulationId: data.simulationId,
      nodeName,
      finalized: shouldFinalize,
      nodesResponded: updatedProcessedNodes.length,
      expectedNodes,
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
        // Multi-node tracking
        expectedNodes: simulation.expectedNodes,
        processedNodes: simulation.processedNodes,
        aggregationDeadline: simulation.aggregationDeadline?.toISOString(),
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
