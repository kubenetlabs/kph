/**
 * User Router
 *
 * Provides user-related procedures including current user info.
 */

import { createTRPCRouter, protectedProcedure } from "../trpc";

export const userRouter = createTRPCRouter({
  /**
   * Get the current authenticated user's info
   */
  me: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user) {
      return null;
    }

    return {
      id: ctx.user.id,
      email: ctx.user.email,
      isSuperAdmin: ctx.user.isSuperAdmin,
      role: ctx.user.newRole,
      organizationId: ctx.user.organizationId,
    };
  }),
});
