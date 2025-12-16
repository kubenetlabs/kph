import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { db } from "~/lib/db";
import {
  authenticateRegistrationToken,
  unauthorized,
} from "~/lib/api-auth";
import { generateApiToken } from "~/lib/encryption";

const bootstrapRequestSchema = z.object({
  // Cluster identification
  clusterName: z.string().min(1).max(100),

  // Operator info
  operatorVersion: z.string().min(1),

  // Kubernetes cluster info (optional, will be updated after connection)
  kubernetesVersion: z.string().optional(),
  nodeCount: z.number().int().nonnegative().optional(),
  namespaceCount: z.number().int().nonnegative().optional(),

  // Optional: cluster metadata (the operator can provide these if known)
  provider: z.enum(["AWS", "GCP", "AZURE", "ON_PREM", "OTHER"]).optional(),
  region: z.string().optional(),

  // Optional: specify environment (matches Prisma enum)
  environment: z.enum(["DEVELOPMENT", "STAGING", "PRODUCTION", "TESTING"]).optional(),
});

/**
 * POST /api/operator/bootstrap
 *
 * Bootstrap a new cluster connection from the operator.
 *
 * Flow:
 * 1. Operator is installed with a registration token (org-level)
 * 2. Operator calls this endpoint with cluster metadata
 * 3. SaaS creates the cluster record and generates a cluster-specific token
 * 4. Operator stores the returned token and uses it for all future communication
 *
 * This allows operators to self-register without requiring users to
 * manually configure cluster credentials in the SaaS UI first.
 */
export async function POST(request: NextRequest) {
  // Authenticate the registration token (org-level, no cluster)
  const auth = await authenticateRegistrationToken(
    request.headers.get("Authorization")
  );
  if (!auth) {
    return unauthorized("Invalid or missing registration token");
  }

  try {
    const body: unknown = await request.json();

    // Validate request body
    const validationResult = bootstrapRequestSchema.safeParse(body);
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

    const {
      clusterName,
      operatorVersion,
      kubernetesVersion,
      nodeCount,
      namespaceCount,
      provider,
      region,
      environment,
    } = validationResult.data;

    // Check if a cluster with this name already exists in the organization
    const existingCluster = await db.cluster.findFirst({
      where: {
        name: clusterName,
        organizationId: auth.organizationId,
      },
    });

    if (existingCluster) {
      // If the cluster exists and has an operator installed, reject
      if (existingCluster.operatorInstalled) {
        return NextResponse.json(
          {
            error: "Cluster already registered",
            message: `A cluster named "${clusterName}" is already registered with an active operator. If you're re-installing the operator, please delete the existing cluster first or use a different name.`,
          },
          { status: 409 }
        );
      }

      // If the cluster exists but no operator, we can take over
      // This handles the case where a cluster was created in UI but operator never installed
    }

    // Generate a unique operator ID
    const operatorId = crypto.randomUUID();

    // Generate a cluster-specific API token
    const { token: clusterToken, tokenHash, prefix } = generateApiToken();

    // Use a transaction to create cluster and token atomically
    const result = await db.$transaction(async (tx) => {
      // Create or update the cluster
      const cluster = existingCluster
        ? await tx.cluster.update({
            where: { id: existingCluster.id },
            data: {
              operatorInstalled: true,
              operatorVersion,
              operatorId,
              kubernetesVersion: kubernetesVersion ?? null,
              nodeCount: nodeCount ?? null,
              namespaceCount: namespaceCount ?? null,
              lastHeartbeat: new Date(),
              status: "CONNECTED",
              environment: environment ?? existingCluster.environment ?? "DEVELOPMENT",
            },
          })
        : await tx.cluster.create({
            data: {
              name: clusterName,
              organizationId: auth.organizationId,
              // Required fields - use defaults if not provided by operator
              provider: provider ?? "OTHER",
              region: region ?? "unknown",
              endpoint: "in-cluster", // Operator runs inside the cluster
              // Operator status
              operatorInstalled: true,
              operatorVersion,
              operatorId,
              kubernetesVersion: kubernetesVersion ?? null,
              nodeCount: nodeCount ?? null,
              namespaceCount: namespaceCount ?? null,
              lastHeartbeat: new Date(),
              status: "CONNECTED",
              environment: environment ?? "DEVELOPMENT",
            },
          });

      // Revoke any existing tokens for this cluster
      await tx.apiToken.updateMany({
        where: {
          clusterId: cluster.id,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });

      // Create the new cluster-specific token
      const apiToken = await tx.apiToken.create({
        data: {
          name: `Operator token for ${clusterName}`,
          tokenHash,
          prefix,
          scopes: ["cluster:read", "cluster:write", "policy:read", "policy:write", "flow:write"],
          clusterId: cluster.id,
          organizationId: auth.organizationId,
        },
      });

      // Create audit log entry
      await tx.auditLog.create({
        data: {
          action: "cluster.bootstrapped",
          resource: "Cluster",
          resourceId: cluster.id,
          details: {
            clusterName,
            operatorId,
            operatorVersion,
            kubernetesVersion,
            nodeCount,
            namespaceCount,
            tokenId: apiToken.id,
            isNewCluster: !existingCluster,
          },
          organizationId: auth.organizationId,
        },
      });

      return { cluster, apiToken };
    });

    // Return the cluster token (shown only once!)
    return NextResponse.json({
      success: true,
      cluster: {
        id: result.cluster.id,
        name: result.cluster.name,
        operatorId: result.cluster.operatorId,
      },
      // This token is shown only once - operator must store it securely
      clusterToken: clusterToken,
      tokenPrefix: prefix,
      config: {
        syncInterval: 30, // seconds
        heartbeatInterval: 60, // seconds
      },
      message: "Cluster registered successfully. Store the clusterToken securely - it will not be shown again.",
    });
  } catch (error) {
    console.error("Error bootstrapping cluster:", error);

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
