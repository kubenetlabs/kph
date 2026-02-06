/**
 * Server-side authentication helpers for Next.js App Router
 *
 * This is a compatibility layer that re-exports from the auth abstraction.
 * New code should import directly from ~/lib/auth/index.ts
 */

import {
  getCurrentUser as getUser,
  requireUser as requireAuthUser,
  getAuthSession,
} from "./auth/index";
import type { AuthUser } from "./auth/types";

// Re-export the AuthUser type as ServerUser for backward compatibility
export type ServerUser = AuthUser;

/**
 * Get the current authenticated user with their database record
 * Use this in server components and server actions
 *
 * @returns The user or null if not authenticated/not in database
 */
export async function getCurrentUser(): Promise<ServerUser | null> {
  return getUser();
}

/**
 * Require the current user to be authenticated
 * Throws if not authenticated
 *
 * @returns The authenticated user
 * @throws Error if not authenticated
 */
export async function requireUser(): Promise<ServerUser> {
  return requireAuthUser();
}

/**
 * Require the current user to be a SuperAdmin
 * Returns the user if they are a SuperAdmin, null otherwise
 *
 * @returns The SuperAdmin user or null
 */
export async function requireSuperAdmin(): Promise<ServerUser | null> {
  const user = await getCurrentUser();

  if (!user?.isSuperAdmin) {
    return null;
  }

  return user;
}

/**
 * Check if the current user is a SuperAdmin
 *
 * @returns true if SuperAdmin, false otherwise
 */
export async function isSuperAdmin(): Promise<boolean> {
  const user = await getCurrentUser();
  return user?.isSuperAdmin === true;
}

// Re-export from new auth module for convenience
export { getAuthSession, getAuthProviderName, isAuthEnabled } from "./auth/index";
