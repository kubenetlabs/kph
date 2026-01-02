import { initTRPC, TRPCError } from "@trpc/server";
import { type FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { getServerSession } from "next-auth";
import superjson from "superjson";
import { ZodError } from "zod";
import { db } from "~/lib/db";
import { authOptions } from "~/lib/auth";

/**
 * Context creation for tRPC
 * This runs for each request and makes the database and session available to all procedures
 */
export const createTRPCContext = async (opts: FetchCreateContextFnOptions) => {
  // Get the session from NextAuth
  const session = await getServerSession(authOptions);

  return {
    db,
    session,
    userId: session?.user?.id ?? null,
    organizationId: session?.user?.organizationId ?? null,
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
 * Ensures user is authenticated before running
 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session?.user?.id) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
      userId: ctx.session.user.id,
      organizationId: ctx.session.user.organizationId ?? null,
    },
  });
});

/**
 * Organization-protected procedure
 * Ensures user is authenticated AND has an organization
 */
export const orgProtectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session?.user?.id) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  if (!ctx.session.user.organizationId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Organization required. Please complete onboarding.",
    });
  }

  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
      userId: ctx.session.user.id,
      organizationId: ctx.session.user.organizationId,
    },
  });
});
