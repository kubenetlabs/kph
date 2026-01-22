import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { db } from "~/lib/db";
import {
  authenticateOperatorToken,
  unauthorized,
  requireScope,
} from "~/lib/api-auth";

const registerRequestSchema = z.object({
  operatorVersion: z.string().min(1),
  kubernetesVersion: z.string().optional(),
  nodeCount: z.number().int().nonnegative().optional(),
  namespaceCount: z.number().int().nonnegative().optional(),
});

/**
 * POST /api/operator/register
 * Operator calls this on startup to register with the SaaS platform.
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
    const validationResult = registerRequestSchema.safeParse(body);
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

    const { operatorVersion, kubernetesVersion, nodeCount, namespaceCount } =
      validationResult.data;

    // Fetch existing cluster to preserve operatorId if already set
    const existingCluster = await db.cluster.findUnique({
      where: { id: auth.clusterId },
      select: { operatorId: true },
    });

    // Only generate new operator ID if not already set (preserves identity across restarts)
    const operatorId = existingCluster?.operatorId ?? crypto.randomUUID();

    // Update the cluster with operator info
    const cluster = await db.cluster.update({
      where: { id: auth.clusterId },
      data: {
        operatorInstalled: true,
        operatorVersion,
        operatorId,
        kubernetesVersion: kubernetesVersion ?? null,
        nodeCount: nodeCount ?? null,
        namespaceCount: namespaceCount ?? null,
        lastHeartbeat: new Date(),
        status: "CONNECTED",
      },
    });

    // Create audit log entry
    await db.auditLog.create({
      data: {
        action: "operator.registered",
        resource: "Cluster",
        resourceId: auth.clusterId,
        details: {
          operatorId,
          operatorVersion,
          kubernetesVersion,
          nodeCount,
          namespaceCount,
        },
        organizationId: auth.organizationId,
      },
    });

    return NextResponse.json({
      success: true,
      operatorId: cluster.operatorId,
      clusterId: cluster.id,
      clusterName: cluster.name,
      syncInterval: 30, // seconds
      heartbeatInterval: 60, // seconds
    });
  } catch (error) {
    console.error("Error registering operator:", error);

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
