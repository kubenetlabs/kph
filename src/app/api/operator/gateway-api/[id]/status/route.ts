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
 * Adds deprecation headers to a response.
 * This endpoint is deprecated in favor of /api/operator/policies/[id]/status
 * which handles all policy types including Gateway API routes.
 */
function addDeprecationHeaders(response: NextResponse): NextResponse {
  response.headers.set("Deprecation", "true");
  response.headers.set("Sunset", "2026-06-01");
  response.headers.set(
    "Link",
    '</api/operator/policies/{id}/status>; rel="successor-version"'
  );
  response.headers.set(
    "X-Deprecation-Notice",
    "This endpoint is deprecated. Use /api/operator/policies/[id]/status for GATEWAY_* policy types instead."
  );
  return response;
}

/**
 * PATCH /api/operator/gateway-api/[id]/status
 * Update the deployment status of a Gateway API resource.
 *
 * @deprecated Use /api/operator/policies/[id]/status for GATEWAY_* policy types instead.
 * Gateway API routes are now managed through the consolidated Policy model.
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
      const response = NextResponse.json(
        {
          error: "Validation failed",
          details: validationResult.error.errors.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          })),
        },
        { status: 400 }
      );
      return addDeprecationHeaders(response);
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
      const response = NextResponse.json(
        { error: "Gateway API resource not found" },
        { status: 404 }
      );
      return addDeprecationHeaders(response);
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

    const response = NextResponse.json({
      success: true,
      resourceId: updatedResource.id,
      kind: updatedResource.kind,
      name: updatedResource.name,
      status: updatedResource.status,
      _deprecation: {
        message:
          "This endpoint is deprecated. Use /api/operator/policies/[id]/status for GATEWAY_* policy types instead.",
        successor: "/api/operator/policies/{id}/status",
        sunset: "2026-06-01",
      },
    });
    return addDeprecationHeaders(response);
  } catch (error) {
    console.error("Error updating Gateway API resource status:", error);

    if (error instanceof SyntaxError) {
      const response = NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
      return addDeprecationHeaders(response);
    }

    const response = NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
    return addDeprecationHeaders(response);
  }
}
