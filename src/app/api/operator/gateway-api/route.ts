import { type NextRequest, NextResponse } from "next/server";
import { db } from "~/lib/db";
import {
  authenticateOperatorToken,
  unauthorized,
  requireScope,
} from "~/lib/api-auth";

/**
 * GET /api/operator/gateway-api
 * Returns all Gateway API resources that should be deployed to the cluster.
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

    return NextResponse.json({
      success: true,
      resources: operatorResources,
      count: operatorResources.length,
    });
  } catch (error) {
    console.error("Error fetching Gateway API resources:", error);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
