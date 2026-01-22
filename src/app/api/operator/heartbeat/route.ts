import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "~/lib/db";
import {
  authenticateOperatorToken,
  unauthorized,
  requireScope,
} from "~/lib/api-auth";

const heartbeatRequestSchema = z.object({
  operatorVersion: z.string().optional(),
  kubernetesVersion: z.string().optional(),
  nodeCount: z.number().int().nonnegative().optional(),
  namespaceCount: z.number().int().nonnegative().optional(),
  managedPoliciesCount: z.number().int().nonnegative().optional(),
  status: z.enum(["healthy", "degraded", "error"]).optional(),
  error: z.string().optional(),
});

/**
 * POST /api/operator/heartbeat
 * Operator sends periodic heartbeats with status updates.
 */
export async function POST(request: NextRequest) {
  // Authenticate the operator
  const auth = await authenticateOperatorToken(
    request.headers.get("Authorization")
  );
  if (!auth) {
    return unauthorized();
  }

  // Check required scope
  const scopeError = requireScope(auth, "cluster:write");
  if (scopeError) return scopeError;

  try {
    const body: unknown = await request.json();

    // Validate request body
    const validationResult = heartbeatRequestSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: validationResult.error.errors.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          })),
        },
        { status: 400 }
      );
    }

    const data = validationResult.data;

    // Map operator status to cluster status
    let clusterStatus: "CONNECTED" | "DEGRADED" | "ERROR" = "CONNECTED";
    if (data.status === "degraded") {
      clusterStatus = "DEGRADED";
    } else if (data.status === "error") {
      clusterStatus = "ERROR";
    }

    // Update cluster with heartbeat data
    const cluster = await db.cluster.update({
      where: { id: auth.clusterId },
      data: {
        lastHeartbeat: new Date(),
        status: clusterStatus,
        ...(data.operatorVersion && { operatorVersion: data.operatorVersion }),
        ...(data.kubernetesVersion && {
          kubernetesVersion: data.kubernetesVersion,
        }),
        ...(data.nodeCount !== undefined && { nodeCount: data.nodeCount }),
        ...(data.namespaceCount !== undefined && {
          namespaceCount: data.namespaceCount,
        }),
      },
      select: {
        id: true,
        name: true,
        status: true,
        lastHeartbeat: true,
      },
    });

    // Check if there are pending policies that need operator action
    const pendingPolicies = await db.policy.count({
      where: {
        clusterId: auth.clusterId,
        status: "PENDING",
      },
    });

    return NextResponse.json({
      success: true,
      clusterId: cluster.id,
      clusterStatus: cluster.status,
      pendingPoliciesCount: pendingPolicies,
      nextHeartbeat: 60, // seconds until next expected heartbeat
    });
  } catch (error) {
    console.error("Error processing heartbeat:", error);

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
