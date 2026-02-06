/**
 * Clerk Auth Provider
 *
 * Wraps the existing Clerk integration for use with the auth abstraction.
 * All Clerk-specific imports are isolated in this file.
 */

import type { AuthProvider, AuthSession, AuthUser } from "../types";
import { db } from "~/lib/db";

/**
 * Clerk Auth Provider Implementation
 *
 * Uses dynamic import internally to load Clerk only when this provider
 * is actually instantiated (i.e., when KPH_AUTH_PROVIDER=clerk).
 */
export class ClerkAuthProvider implements AuthProvider {
  async getSession(): Promise<AuthSession> {
    // Dynamic import to prevent Clerk from being bundled when not used
    const { auth } = await import("@clerk/nextjs/server");
    const { userId: clerkUserId } = await auth();

    if (!clerkUserId) {
      return {
        user: null,
        userId: null,
        isAuthenticated: false,
        provider: "clerk",
      };
    }

    // Look up the KPH user by their Clerk ID
    // Note: In the current schema, User.id IS the Clerk ID
    const user = await db.user.findUnique({
      where: { id: clerkUserId },
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
      // User authenticated with Clerk but not yet in our database
      // This happens during onboarding - return partial session
      return {
        user: null,
        userId: clerkUserId,
        isAuthenticated: true,
        provider: "clerk",
      };
    }

    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      isSuperAdmin: user.isSuperAdmin,
      newRole: user.newRole,
      organizationId: user.organizationId,
      organization: user.organization,
    };

    return {
      user: authUser,
      userId: user.id,
      isAuthenticated: true,
      provider: "clerk",
    };
  }

  getProviderName(): "clerk" {
    return "clerk";
  }

  hasClientComponents(): boolean {
    return true; // Clerk has <UserButton />, <SignIn />, etc.
  }
}
