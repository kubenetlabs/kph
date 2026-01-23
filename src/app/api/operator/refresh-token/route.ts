import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "~/lib/db";
import {
  authenticateOperatorToken,
  unauthorized,
  requireScope,
} from "~/lib/api-auth";
import { generateAgentToken, hashToken } from "~/lib/tokens";

const refreshRequestSchema = z.object({
  // Optional: specify new expiry days (capped at 90 for AGENT tokens)
  expiryDays: z.number().min(1).max(90).default(90),
});

/**
 * POST /api/operator/refresh-token
 * Allows operators to rotate their token before expiry.
 * Returns a new token while revoking the old one.
 *
 * Security notes:
 * - Token must be valid (not expired, not revoked) to refresh
 * - New token has same scopes and cluster association
 * - Old token is immediately revoked
 * - Max expiry is 90 days for AGENT tokens
 */
export async function POST(request: NextRequest) {
  // Authenticate the current token
  const auth = await authenticateOperatorToken(
    request.headers.get("Authorization")
  );
  if (!auth) {
    return unauthorized();
  }

  // Check required scope (same scope needed to refresh as to use the token)
  const scopeError = requireScope(auth, "cluster:write");
  if (scopeError) return scopeError;

  try {
    const body: unknown = await request.json();

    // Validate request body
    const validationResult = refreshRequestSchema.safeParse(body);
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

    // Get the current token record
    const currentToken = await db.apiToken.findUnique({
      where: { id: auth.tokenId },
    });

    if (!currentToken) {
      return NextResponse.json(
        { error: "Token not found" },
        { status: 404 }
      );
    }

    // Verify token is not already revoked
    if (currentToken.status === "REVOKED") {
      return unauthorized("Token has been revoked");
    }

    // Generate new token
    const newTokenData = generateAgentToken("AGENT", data.expiryDays);

    // Transaction: revoke old token and create new one
    const [, newToken] = await db.$transaction([
      // Revoke current token
      db.apiToken.update({
        where: { id: auth.tokenId },
        data: {
          status: "REVOKED",
          revokedAt: new Date(),
        },
      }),
      // Create new token with same settings
      db.apiToken.create({
        data: {
          name: currentToken.name,
          type: currentToken.type,
          tokenHash: newTokenData.tokenHash,
          prefix: newTokenData.tokenPrefix,
          scopes: currentToken.scopes,
          status: "ACTIVE",
          expiresAt: newTokenData.expiresAt,
          organizationId: currentToken.organizationId,
          clusterId: currentToken.clusterId,
          createdById: currentToken.createdById,
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      message: "Token refreshed successfully",
      token: newTokenData.token, // New token - operator must update their configuration!
      tokenId: newToken.id,
      expiresAt: newToken.expiresAt?.toISOString(),
      oldTokenRevoked: true,
      // Important: Operator should immediately update their stored token
      note: "Your old token has been revoked. Update your operator configuration with this new token.",
    });
  } catch (error) {
    console.error("Error refreshing token:", error);

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

/**
 * GET /api/operator/refresh-token
 * Returns information about the current token's expiry status.
 */
export async function GET(request: NextRequest) {
  // Authenticate the current token
  const auth = await authenticateOperatorToken(
    request.headers.get("Authorization")
  );
  if (!auth) {
    return unauthorized();
  }

  if (!auth.expiresAt) {
    return NextResponse.json({
      tokenId: auth.tokenId,
      expiresAt: null,
      neverExpires: true,
    });
  }

  const now = new Date();
  const expiresAt = new Date(auth.expiresAt);
  const msUntilExpiry = expiresAt.getTime() - now.getTime();
  const daysUntilExpiry = Math.floor(msUntilExpiry / (1000 * 60 * 60 * 24));

  return NextResponse.json({
    tokenId: auth.tokenId,
    expiresAt: expiresAt.toISOString(),
    expiresInDays: Math.max(0, daysUntilExpiry),
    isExpiringSoon: daysUntilExpiry <= 14,
    shouldRotate: daysUntilExpiry <= 7,
    refreshEndpoint: "/api/operator/refresh-token",
  });
}
