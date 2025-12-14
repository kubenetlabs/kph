import { initTRPC, TRPCError } from "@trpc/server";
import { type FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import superjson from "superjson";
import { ZodError } from "zod";
import { db } from "~/lib/db";

/**
 * Context creation for tRPC
 * This runs for each request and makes the database available to all procedures
 */
export const createTRPCContext = async (opts: FetchCreateContextFnOptions) => {
  // In a real app, you would get the session/user from NextAuth here
  // For now, we'll use mock organization and user IDs
  const mockOrganizationId = "org_demo";
  const mockUserId = "user_demo";

  return {
    db,
    organizationId: mockOrganizationId,
    userId: mockUserId,
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
  // In a real app, you would check ctx.session here
  if (!ctx.userId || !ctx.organizationId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  return next({
    ctx: {
      ...ctx,
      userId: ctx.userId,
      organizationId: ctx.organizationId,
    },
  });
});
