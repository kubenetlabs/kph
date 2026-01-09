import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "~/lib/db";
import {
  authenticateOperatorToken,
  unauthorized,
  requireScope,
} from "~/lib/api-auth";

const statusUpdateSchema = z.object({
  status: z.enum(["IN_PROGRESS", "DEPLOYED", "FAILED"]),
  error: z.string().optional(),
  errorDetails: z
    .object({
      type: z.string().optional(), // e.g., "ValidationError", "K8sAPIError", "NetworkError"
      resource: z.string().optional(), // e.g., "CiliumNetworkPolicy/my-policy"
      reason: z.string().optional(), // K8s reason code
      retryable: z.boolean().optional(), // Whether the error is retryable
      suggestion: z.string().optional(), // Suggested fix
    })
    .optional(),
  deployedResources: z
    .array(
      z.object({
        apiVersion: z.string(),
        kind: z.string(),
        name: z.string(),
        namespace: z.string().optional(),
      })
    )
    .optional(),
  version: z.number().int().positive().optional(),
});

/**
 * PATCH /api/operator/policies/[id]/status
 * Update the deployment status of a policy.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Authenticate the operator
  const auth = await authenticateOperatorToken(
    request.headers.get("Authorization")
  );
  if (!auth) {
    return unauthorized();
  }

  // Check required scope
  const scopeError = requireScope(auth, "policy:read");
  if (scopeError) return scopeError;

  try {
    const { id: policyId } = await params;
    const body: unknown = await request.json();

    // Validate request body
    const validationResult = statusUpdateSchema.safeParse(body);
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

    const { status, error, errorDetails, deployedResources, version } = validationResult.data;

    // Verify policy belongs to this cluster
    const policy = await db.policy.findFirst({
      where: {
        id: policyId,
        clusterId: auth.clusterId,
      },
    });

    if (!policy) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    }

    // Handle IN_PROGRESS status differently - don't update Policy.status yet
    if (status === "IN_PROGRESS") {
      // Find the pending deployment and mark it as in progress
      const pendingDeployment = await db.policyDeployment.findFirst({
        where: {
          policyId: policyId,
          status: "PENDING",
        },
        orderBy: { requestedAt: "desc" },
      });

      if (pendingDeployment) {
        await db.policyDeployment.update({
          where: { id: pendingDeployment.id },
          data: {
            status: "IN_PROGRESS",
            startedAt: new Date(),
          },
        });
      }

      return NextResponse.json({
        success: true,
        policyId: policy.id,
        status: "IN_PROGRESS",
        deployedVersion: policy.deployedVersion,
      });
    }

    // Update policy status for DEPLOYED or FAILED
    const updatedPolicy = await db.policy.update({
      where: { id: policyId },
      data: {
        status: status,
        deployedAt: status === "DEPLOYED" ? new Date() : undefined,
        deployedVersion: version ?? (policy.deployedVersion ?? 0) + 1,
      },
    });

    // Update the most recent PENDING or IN_PROGRESS PolicyDeployment for this policy
    const activeDeployment = await db.policyDeployment.findFirst({
      where: {
        policyId: policyId,
        status: { in: ["PENDING", "IN_PROGRESS"] },
      },
      orderBy: { requestedAt: "desc" },
    });

    if (activeDeployment) {
      const deploymentStatus = status === "DEPLOYED" ? "SUCCEEDED" : "FAILED";
      await db.policyDeployment.update({
        where: { id: activeDeployment.id },
        data: {
          status: deploymentStatus,
          completedAt: new Date(),
          errorMessage: error ?? null,
          errorDetails: errorDetails ?? Prisma.DbNull,
          resourceName: deployedResources?.[0]?.name ?? null,
          resourceNamespace: deployedResources?.[0]?.namespace ?? null,
        },
      });
    }

    // Create audit log entry
    await db.auditLog.create({
      data: {
        action: `policy.${status.toLowerCase()}`,
        resource: "Policy",
        resourceId: policyId,
        details: error
          ? { error }
          : { resources: deployedResources, version: updatedPolicy.deployedVersion },
        organizationId: auth.organizationId,
      },
    });

    return NextResponse.json({
      success: true,
      policyId: updatedPolicy.id,
      status: updatedPolicy.status,
      deployedVersion: updatedPolicy.deployedVersion,
    });
  } catch (error) {
    console.error("Error updating policy status:", error);

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
