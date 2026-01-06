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
});

/**
 * PATCH /api/operator/gateway-api/[id]/status
 * Update the deployment status of a Gateway API resource.
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
    const { id: resourceId } = await params;
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

    const { status, error } = validationResult.data;

    // Verify resource belongs to this cluster
    const resource = await db.gatewayAPIPolicy.findFirst({
      where: {
        id: resourceId,
        clusterId: auth.clusterId,
      },
    });

    if (!resource) {
      return NextResponse.json(
        { error: "Gateway API resource not found" },
        { status: 404 }
      );
    }

    // Update resource status
    const updatedResource = await db.gatewayAPIPolicy.update({
      where: { id: resourceId },
      data: {
        status: status,
        syncedAt: status === "DEPLOYED" ? new Date() : undefined,
      },
    });

    // Create audit log entry
    await db.auditLog.create({
      data: {
        action: `gateway-api.${status.toLowerCase()}`,
        resource: "GatewayAPIPolicy",
        resourceId: resourceId,
        details: error
          ? { error, kind: resource.kind, name: resource.name }
          : { kind: resource.kind, name: resource.name, namespace: resource.namespace },
        organizationId: auth.organizationId,
      },
    });

    return NextResponse.json({
      success: true,
      resourceId: updatedResource.id,
      kind: updatedResource.kind,
      name: updatedResource.name,
      status: updatedResource.status,
    });
  } catch (error) {
    console.error("Error updating Gateway API resource status:", error);

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
