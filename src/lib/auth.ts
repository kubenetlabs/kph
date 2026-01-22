/**
 * Server-side authentication helpers for Next.js App Router
 */

import { auth } from "@clerk/nextjs/server";
import { db } from "./db";
import type { Role } from "@prisma/client";

/**
 * User object with RBAC fields for server-side checks
 */
export interface ServerUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  isSuperAdmin: boolean;
  newRole: Role;
  organizationId: string | null;
  organization: {
    id: string;
    name: string;
    slug: string;
  } | null;
}

/**
 * Get the current authenticated user with their database record
 * Use this in server components and server actions
 *
 * @returns The user or null if not authenticated/not in database
 */
export async function getCurrentUser(): Promise<ServerUser | null> {
  const { userId: clerkUserId } = await auth();

  if (!clerkUserId) {
    return null;
  }

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

  return user;
}

/**
 * Require the current user to be authenticated
 * Throws if not authenticated
 *
 * @returns The authenticated user
 * @throws Error if not authenticated
 */
export async function requireUser(): Promise<ServerUser> {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("Authentication required");
  }

  return user;
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
