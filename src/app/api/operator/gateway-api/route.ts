import { type NextRequest, NextResponse } from "next/server";
import { db } from "~/lib/db";
import {
  authenticateOperatorToken,
  unauthorized,
  requireScope,
} from "~/lib/api-auth";

/**
 * Adds deprecation headers to a response.
 * This endpoint is deprecated in favor of /api/operator/policies which handles
 * all policy types including Gateway API routes (GATEWAY_HTTPROUTE, etc.)
 */
function addDeprecationHeaders(response: NextResponse): NextResponse {
  response.headers.set("Deprecation", "true");
  response.headers.set("Sunset", "2026-06-01");
  response.headers.set(
    "Link",
    '</api/operator/policies>; rel="successor-version"'
  );
  response.headers.set(
    "X-Deprecation-Notice",
    "This endpoint is deprecated. Use /api/operator/policies with GATEWAY_* policy types instead."
  );
  return response;
}

/**
 * GET /api/operator/gateway-api
 * Returns all Gateway API resources that should be deployed to the cluster.
 *
 * @deprecated Use /api/operator/policies with GATEWAY_* policy types instead.
 * Gateway API routes are now managed through the consolidated Policy model.
 */
export async function GET(request: NextRequest) {
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
    // Fetch Gateway API resources that are PENDING or DEPLOYED for this cluster
    const resources = await db.gatewayAPIPolicy.findMany({
      where: {
        clusterId: auth.clusterId,
        status: { in: ["PENDING", "DEPLOYED"] },
      },
      select: {
        id: true,
        kind: true,
        name: true,
        namespace: true,
        yamlContent: true,
        parentRefs: true,
        hostnames: true,
        rules: true,
        status: true,
        syncedAt: true,
        updatedAt: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    // Transform to operator-friendly format
    const operatorResources = resources.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      namespace: r.namespace,
      yaml: r.yamlContent,
      parentRefs: r.parentRefs,
      hostnames: r.hostnames,
      rules: r.rules,
      status: r.status,
      syncedAt: r.syncedAt?.toISOString() ?? null,
      lastUpdated: r.updatedAt.toISOString(),
    }));

    const response = NextResponse.json({
      success: true,
      resources: operatorResources,
      count: operatorResources.length,
      _deprecation: {
        message:
          "This endpoint is deprecated. Use /api/operator/policies with GATEWAY_* policy types instead.",
        successor: "/api/operator/policies",
        sunset: "2026-06-01",
      },
    });

    return addDeprecationHeaders(response);
  } catch (error) {
    console.error("Error fetching Gateway API resources:", error);

    const response = NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
    return addDeprecationHeaders(response);
  }
}
