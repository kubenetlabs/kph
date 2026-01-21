import { NextResponse } from "next/server";
import { db } from "~/lib/db";
import { hashToken } from "~/lib/encryption";

// Simple in-memory cache for token auth with 5-minute TTL
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
interface CachedAuth {
  data: OperatorAuthContext | null;
  expiresAt: number;
}
const tokenCache = new Map<string, CachedAuth>();

function getCachedAuth(tokenHash: string): OperatorAuthContext | null | undefined {
  const cached = tokenCache.get(tokenHash);
  if (!cached) return undefined; // Not in cache
  if (Date.now() > cached.expiresAt) {
    tokenCache.delete(tokenHash);
    return undefined; // Expired
  }
  return cached.data;
}

function setCachedAuth(tokenHash: string, data: OperatorAuthContext | null): void {
  tokenCache.set(tokenHash, {
    data,
    expiresAt: Date.now() + TOKEN_CACHE_TTL_MS,
  });
  // Cleanup old entries periodically (every 100 sets)
  if (tokenCache.size > 100) {
    const now = Date.now();
    for (const [key, value] of tokenCache) {
      if (now > value.expiresAt) {
        tokenCache.delete(key);
      }
    }
  }
}

/**
 * Context returned after successful operator authentication.
 * Used for cluster-specific operations.
 */
export interface OperatorAuthContext {
  clusterId: string;
  organizationId: string;
  scopes: string[];
  tokenId: string;
}

/**
 * Context returned after successful registration token authentication.
 * Used for bootstrapping new clusters (org-level token, no cluster yet).
 */
export interface RegistrationAuthContext {
  organizationId: string;
  scopes: string[];
  tokenId: string;
}

/**
 * Authenticate an operator using a Bearer token from the Authorization header.
 * Returns the auth context if valid, null otherwise.
 */
export async function authenticateOperatorToken(
  authHeader: string | null
): Promise<OperatorAuthContext | null> {
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7);
  const tokenHash = hashToken(token);

  // Check cache first
  const cached = getCachedAuth(tokenHash);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const apiToken = await db.apiToken.findUnique({
      where: { tokenHash },
      include: {
        cluster: true,
        organization: true,
      },
    });

    // Token not found
    if (!apiToken) {
      setCachedAuth(tokenHash, null);
      return null;
    }

    // Token revoked
    if (apiToken.revokedAt) {
      setCachedAuth(tokenHash, null);
      return null;
    }

    // Token expired
    if (apiToken.expiresAt && apiToken.expiresAt < new Date()) {
      setCachedAuth(tokenHash, null);
      return null;
    }

    // Token must be associated with a cluster for operator auth
    if (!apiToken.clusterId) {
      setCachedAuth(tokenHash, null);
      return null;
    }

    // Update last used timestamp (fire and forget)
    void db.apiToken.update({
      where: { id: apiToken.id },
      data: { lastUsedAt: new Date() },
    });

    const authContext: OperatorAuthContext = {
      clusterId: apiToken.clusterId,
      organizationId: apiToken.organizationId,
      scopes: apiToken.scopes,
      tokenId: apiToken.id,
    };

    setCachedAuth(tokenHash, authContext);
    return authContext;
  } catch (error) {
    console.error("Error authenticating operator token:", error);
    return null;
  }
}

/**
 * Authenticate a registration token from the Authorization header.
 * Registration tokens are org-level tokens (no cluster) with cluster:create scope.
 * Returns the auth context if valid, null otherwise.
 */
export async function authenticateRegistrationToken(
  authHeader: string | null
): Promise<RegistrationAuthContext | null> {
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7);
  const tokenHash = hashToken(token);

  try {
    const apiToken = await db.apiToken.findUnique({
      where: { tokenHash },
      include: {
        organization: true,
      },
    });

    // Token not found
    if (!apiToken) {
      return null;
    }

    // Token revoked
    if (apiToken.revokedAt) {
      return null;
    }

    // Token expired
    if (apiToken.expiresAt && apiToken.expiresAt < new Date()) {
      return null;
    }

    // Registration tokens should NOT be cluster-specific
    // (they are org-level tokens used to bootstrap clusters)
    if (apiToken.clusterId) {
      return null;
    }

    // Must have cluster:create scope
    if (!apiToken.scopes.includes("cluster:create")) {
      return null;
    }

    // Update last used timestamp (fire and forget)
    void db.apiToken.update({
      where: { id: apiToken.id },
      data: { lastUsedAt: new Date() },
    });

    return {
      organizationId: apiToken.organizationId,
      scopes: apiToken.scopes,
      tokenId: apiToken.id,
    };
  } catch (error) {
    console.error("Error authenticating registration token:", error);
    return null;
  }
}

/**
 * Check if the auth context has the required scope.
 */
export function hasScope(
  auth: OperatorAuthContext | RegistrationAuthContext,
  requiredScope: string
): boolean {
  return auth.scopes.includes(requiredScope);
}

/**
 * Return an unauthorized response.
 */
export function unauthorized(message = "Unauthorized"): NextResponse {
  return NextResponse.json({ error: message }, { status: 401 });
}

/**
 * Return a forbidden response.
 */
export function forbidden(message = "Forbidden"): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 });
}

/**
 * Helper to require specific scopes.
 * Returns a NextResponse error if scope is missing, null if OK.
 */
export function requireScope(
  auth: OperatorAuthContext | RegistrationAuthContext,
  requiredScope: string
): NextResponse | null {
  if (!hasScope(auth, requiredScope)) {
    return forbidden(`Missing required scope: ${requiredScope}`);
  }
  return null;
}
