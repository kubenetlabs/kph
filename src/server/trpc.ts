import { initTRPC, TRPCError } from "@trpc/server";
import { type FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { auth } from "@clerk/nextjs/server";
import superjson from "superjson";
import { ZodError, z } from "zod";
import { db } from "~/lib/db";
import type { Role } from "@prisma/client";
import { hasMinRole, checkClusterAccess, type PermissionUser } from "~/lib/permissions";

/**
 * User context with RBAC fields
 */
export interface UserContext {
  id: string;
  email: string;
  isSuperAdmin: boolean;
  newRole: Role;
  organizationId: string | null;
}

/**
 * Context creation for tRPC
 * This runs for each request and makes the database and auth available to all procedures
 */
export const createTRPCContext = async (opts: FetchCreateContextFnOptions) => {
  // Get the auth from Clerk
  const { userId: clerkUserId } = await auth();

  // If user is authenticated, get or create their database record
  let userId: string | null = null;
  let organizationId: string | null = null;
  let user: UserContext | null = null;

  if (clerkUserId) {
    // Find or create user in our database
    const dbUser = await db.user.findFirst({
      where: { id: clerkUserId },
      select: {
        id: true,
        email: true,
        isSuperAdmin: true,
        newRole: true,
        organizationId: true,
      },
    });

    if (!dbUser) {
      // User doesn't exist in our DB yet - they'll be created during onboarding
      userId = clerkUserId;
    } else {
      userId = dbUser.id;
      organizationId = dbUser.organizationId;
      user = dbUser;
    }
  }

  return {
    db,
    clerkUserId,
    userId,
    organizationId,
    user,
    headers: opts.req.headers,
  };
};

export type Context = Awaited<ReturnType<typeof createTRPCContext>>;

/**
 * Initialize tRPC
 */
const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

/**
 * Create router and procedure helpers
 */
export const createTRPCRouter = t.router;
export const createCallerFactory = t.createCallerFactory;

/**
 * Public (unauthenticated) procedure
 * In a real app, this would check for authentication
 */
export const publicProcedure = t.procedure;

/**
 * Protected (authenticated) procedure
 * Ensures user is authenticated via Clerk before running
 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.clerkUserId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  return next({
    ctx: {
      ...ctx,
      userId: ctx.userId!,
      organizationId: ctx.organizationId,
    },
  });
});

/**
 * Organization-protected procedure
 * Ensures user is authenticated AND has an organization
 */
export const orgProtectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.clerkUserId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  if (!ctx.organizationId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Organization required. Please complete onboarding.",
    });
  }

  return next({
    ctx: {
      ...ctx,
      userId: ctx.userId!,
      organizationId: ctx.organizationId,
    },
  });
});

// ============================================================================
// RBAC PROTECTED PROCEDURES
// ============================================================================

/**
 * SuperAdmin-only procedure
 * Ensures user is authenticated AND is a SuperAdmin
 */
export const superAdminProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.clerkUserId || !ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  if (!ctx.user.isSuperAdmin) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "SuperAdmin access required",
    });
  }

  return next({
    ctx: {
      ...ctx,
      userId: ctx.userId!,
      user: ctx.user,
    },
  });
});

/**
 * Role-protected procedure factory
 * Creates a procedure that requires a minimum organization-level role
 *
 * @param minRole - Minimum required role (ORG_ADMIN, CLUSTER_ADMIN, POLICY_EDITOR, VIEWER)
 *
 * @example
 * // Only OrgAdmins can register new clusters
 * registerCluster: roleProtectedProcedure("ORG_ADMIN")
 *   .input(...)
 *   .mutation(...)
 */
export const roleProtectedProcedure = (minRole: Role) =>
  orgProtectedProcedure.use(async ({ ctx, next }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    // SuperAdmins bypass role checks
    if (ctx.user.isSuperAdmin) {
      return next({ ctx: { ...ctx, user: ctx.user } });
    }

    if (!hasMinRole(ctx.user.newRole, minRole)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Requires ${minRole} role or higher`,
      });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  });

/**
 * Cluster-protected procedure factory
 * Creates a procedure that requires cluster-level permission
 *
 * The input MUST include a `clusterId` field. Access is granted if:
 * 1. User is a SuperAdmin (platform-wide access)
 * 2. User is an OrgAdmin (org-wide access)
 * 3. User has a ClusterAssignment with sufficient role
 *
 * @param minRole - Minimum required role for the cluster
 *
 * @example
 * // PolicyEditors+ can create policies on assigned clusters
 * createPolicy: clusterProtectedProcedure("POLICY_EDITOR")
 *   .input(z.object({ clusterId: z.string(), ... }))
 *   .mutation(...)
 */
export const clusterProtectedProcedure = (minRole: Role) =>
  orgProtectedProcedure
    .input(z.object({ clusterId: z.string() }))
    .use(async ({ ctx, input, next }) => {
      if (!ctx.user) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      const hasAccess = await checkClusterAccess(
        ctx.user as PermissionUser,
        input.clusterId,
        minRole
      );

      if (!hasAccess) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Requires ${minRole} access on this cluster`,
        });
      }

      return next({
        ctx: {
          ...ctx,
          user: ctx.user,
          clusterId: input.clusterId,
        },
      });
    });
