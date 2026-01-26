import { type NextRequest, NextResponse } from "next/server";
import { db } from "~/lib/db";
import {
  authenticateOperatorToken,
  unauthorized,
  requireScope,
} from "~/lib/api-auth";

/**
 * GET /api/operator/policies
 * Returns all policies that should be deployed to the cluster.
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
    // Fetch policies that are PENDING, DEPLOYED, or UNDEPLOYING for this cluster
    const policies = await db.policy.findMany({
      where: {
        clusterId: auth.clusterId,
        status: { in: ["PENDING", "DEPLOYED", "UNDEPLOYING"] },
      },
      select: {
        id: true,
        name: true,
        description: true,
        type: true,
        status: true,
        content: true,
        targetNamespaces: true,
        deployedVersion: true,
        updatedAt: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    // Transform to operator-friendly format with action field
    const operatorPolicies = policies.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      type: p.type,
      status: p.status,
      content: p.content,
      targetNamespaces: p.targetNamespaces,
      version: p.deployedVersion ?? 1,
      lastUpdated: p.updatedAt.toISOString(),
      // Action tells operator what to do: DEPLOY or UNDEPLOY
      action: p.status === "UNDEPLOYING" ? "UNDEPLOY" : "DEPLOY",
    }));

    return NextResponse.json({
      success: true,
      policies: operatorPolicies,
      count: operatorPolicies.length,
    });
  } catch (error) {
    console.error("Error fetching policies:", error);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
