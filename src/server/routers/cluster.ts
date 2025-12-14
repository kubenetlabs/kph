import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const clusterRouter = createTRPCRouter({
  // List clusters for organization (used in policy form dropdown)
  list: protectedProcedure.query(async ({ ctx }) => {
    const clusters = await ctx.db.cluster.findMany({
      where: {
        organizationId: ctx.organizationId,
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        provider: true,
        region: true,
        environment: true,
        status: true,
        _count: {
          select: {
            policies: true,
          },
        },
      },
    });

    return clusters;
  }),

  // Get single cluster by ID
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const cluster = await ctx.db.cluster.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.organizationId,
        },
        include: {
          _count: {
            select: {
              policies: true,
            },
          },
        },
      });

      return cluster;
    }),
});
