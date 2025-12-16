import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "~/lib/db";
import {
  authenticateOperatorToken,
  unauthorized,
  requireScope,
} from "~/lib/api-auth";

const statusUpdateSchema = z.object({
  status: z.enum(["DEPLOYED", "FAILED"]),
  error: z.string().optional(),
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

    const { status, error, deployedResources, version } = validationResult.data;

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

    // Update policy status
    const updatedPolicy = await db.policy.update({
      where: { id: policyId },
      data: {
        status: status,
        deployedAt: status === "DEPLOYED" ? new Date() : undefined,
        deployedVersion: version ?? (policy.deployedVersion ?? 0) + 1,
      },
    });

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
