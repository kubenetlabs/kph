import { initTRPC, TRPCError } from "@trpc/server";
import { type FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { auth } from "@clerk/nextjs/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { db } from "~/lib/db";

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

  if (clerkUserId) {
    // Find or create user in our database
    const user = await db.user.findFirst({
      where: { id: clerkUserId },
      include: { organization: true },
    });

    if (!user) {
      // User doesn't exist in our DB yet - they'll be created during onboarding
      userId = clerkUserId;
    } else {
      userId = user.id;
      organizationId = user.organizationId;
    }
  }

  return {
    db,
    clerkUserId,
    userId,
    organizationId,
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
