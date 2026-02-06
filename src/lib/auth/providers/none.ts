/**
 * No-Auth Provider (Anonymous Admin Mode)
 *
 * Default provider for OSS deployments. All requests are handled as
 * a seeded default admin user in a default organization.
 *
 * Suitable for:
 * - Local development
 * - Single-user deployments
 * - Environments behind VPN/reverse proxy
 */

import type { AuthProvider, AuthSession, AuthUser } from "../types";
import { db } from "~/lib/db";

// Well-known IDs for the default org and user
// Using cuid-like format for consistency with Prisma
export const DEFAULT_ORG_ID = "kph_default_org";
export const DEFAULT_USER_ID = "kph_default_admin";
export const DEFAULT_ORG_SLUG = "default";

// Cache the default user to avoid repeated DB lookups
let _cachedUser: AuthUser | null = null;

/**
 * Get or create the default admin user
 */
async function getDefaultUser(): Promise<AuthUser> {
  if (_cachedUser) {
    return _cachedUser;
  }

  // Look up the seeded default user from the database
  const user = await db.user.findUnique({
    where: { id: DEFAULT_USER_ID },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      isSuperAdmin: true,
      newRole: true,
      organizationId: true,
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  });

  if (!user) {
    // This should not happen if seed ran correctly.
    // Return a synthetic user that matches expected structure
    // The seed script should create this user on startup
    console.warn(
      "[auth] Default admin user not found in database. " +
      "Run migrations with KPH_AUTO_MIGRATE=true or execute prisma/seed-default-auth.ts"
    );

    // Return a minimal user to prevent crashes - seed will fix this
    _cachedUser = {
      id: DEFAULT_USER_ID,
      email: "admin@kph.local",
      name: "KPH Admin",
      image: null,
      isSuperAdmin: true,
      newRole: "ORG_ADMIN",
      organizationId: DEFAULT_ORG_ID,
      organization: {
        id: DEFAULT_ORG_ID,
        name: "Default Organization",
        slug: DEFAULT_ORG_SLUG,
      },
    };
    return _cachedUser;
  }

  _cachedUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    isSuperAdmin: user.isSuperAdmin,
    newRole: user.newRole,
    organizationId: user.organizationId,
    organization: user.organization,
  };

  return _cachedUser;
}

/**
 * No-Auth Provider Implementation
 */
export class NoAuthProvider implements AuthProvider {
  async getSession(): Promise<AuthSession> {
    const user = await getDefaultUser();

    return {
      user,
      userId: user.id,
      isAuthenticated: true, // Always "authenticated" as default admin
      provider: "none",
    };
  }

  getProviderName(): "none" {
    return "none";
  }

  hasClientComponents(): boolean {
    return false; // No sign-in UI needed
  }
}

/**
 * Clear cached user (useful for testing)
 */
export function clearUserCache(): void {
  _cachedUser = null;
}
