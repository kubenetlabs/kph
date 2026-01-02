import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, orgProtectedProcedure } from "../trpc";

// Use orgProtectedProcedure for all deployment operations (requires organization)
const protectedProcedure = orgProtectedProcedure;

export const deploymentRouter = createTRPCRouter({
  // List deployments for a policy
  listByPolicy: protectedProcedure
    .input(
      z.object({
        policyId: z.string(),
        limit: z.number().min(1).max(50).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Verify policy belongs to organization
      const policy = await ctx.db.policy.findFirst({
        where: {
          id: input.policyId,
          organizationId: ctx.organizationId,
        },
      });

      if (!policy) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Policy not found",
        });
      }

      const deployments = await ctx.db.policyDeployment.findMany({
        where: { policyId: input.policyId },
        take: input.limit + 1,
        ...(input.cursor && { cursor: { id: input.cursor }, skip: 1 }),
        orderBy: { requestedAt: "desc" },
        include: {
          version: {
            select: {
              id: true,
              version: true,
              changelog: true,
            },
          },
          cluster: {
            select: {
              id: true,
              name: true,
            },
          },
          deployedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          previousDeployment: {
            select: {
              id: true,
              version: {
                select: { version: true },
              },
            },
          },
        },
      });

      let nextCursor: string | undefined = undefined;
      if (deployments.length > input.limit) {
        const nextItem = deployments.pop();
        nextCursor = nextItem?.id;
      }

      return {
        deployments,
        nextCursor,
      };
    }),

  // Get single deployment by ID
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const deployment = await ctx.db.policyDeployment.findFirst({
        where: { id: input.id },
        include: {
          policy: {
            select: {
              id: true,
              name: true,
              organizationId: true,
            },
          },
          version: true,
          cluster: {
            select: {
              id: true,
              name: true,
              provider: true,
            },
          },
          deployedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          previousDeployment: {
            select: {
              id: true,
              version: {
                select: { version: true },
              },
            },
          },
        },
      });

      if (!deployment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Deployment not found",
        });
      }

      // Verify organization access
      if (deployment.policy.organizationId !== ctx.organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Deployment not found",
        });
      }

      return deployment;
    }),

  // Trigger a new deployment
  deploy: protectedProcedure
    .input(
      z.object({
        policyId: z.string(),
        versionId: z.string().optional(), // If not provided, use latest version
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify policy belongs to organization
      const policy = await ctx.db.policy.findFirst({
        where: {
          id: input.policyId,
          organizationId: ctx.organizationId,
        },
        include: {
          cluster: true,
        },
      });

      if (!policy) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Policy not found",
        });
      }

      // Get the version to deploy
      let version;
      if (input.versionId) {
        version = await ctx.db.policyVersion.findFirst({
          where: {
            id: input.versionId,
            policyId: input.policyId,
          },
        });
      } else {
        version = await ctx.db.policyVersion.findFirst({
          where: { policyId: input.policyId },
          orderBy: { version: "desc" },
        });
      }

      if (!version) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Policy version not found",
        });
      }

      // Find previous successful deployment
      const previousDeployment = await ctx.db.policyDeployment.findFirst({
        where: {
          policyId: input.policyId,
          status: "SUCCEEDED",
        },
        orderBy: { completedAt: "desc" },
      });

      // Create deployment record
      const deployment = await ctx.db.policyDeployment.create({
        data: {
          policyId: input.policyId,
          versionId: version.id,
          clusterId: policy.clusterId,
          status: "PENDING",
          deployedById: ctx.userId,
          previousDeploymentId: previousDeployment?.id,
        },
        include: {
          version: {
            select: {
              id: true,
              version: true,
            },
          },
          cluster: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      // Update policy status to pending
      await ctx.db.policy.update({
        where: { id: input.policyId },
        data: { status: "PENDING" },
      });

      return deployment;
    }),

  // Rollback to a previous deployment
  rollback: protectedProcedure
    .input(
      z.object({
        policyId: z.string(),
        targetDeploymentId: z.string(),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify policy belongs to organization
      const policy = await ctx.db.policy.findFirst({
        where: {
          id: input.policyId,
          organizationId: ctx.organizationId,
        },
      });

      if (!policy) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Policy not found",
        });
      }

      // Get target deployment
      const targetDeployment = await ctx.db.policyDeployment.findFirst({
        where: {
          id: input.targetDeploymentId,
          policyId: input.policyId,
          status: "SUCCEEDED",
        },
        include: {
          version: true,
        },
      });

      if (!targetDeployment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Target deployment not found or was not successful",
        });
      }

      // Find current successful deployment
      const currentDeployment = await ctx.db.policyDeployment.findFirst({
        where: {
          policyId: input.policyId,
          status: "SUCCEEDED",
        },
        orderBy: { completedAt: "desc" },
      });

      // Create rollback deployment
      const rollbackDeployment = await ctx.db.policyDeployment.create({
        data: {
          policyId: input.policyId,
          versionId: targetDeployment.versionId,
          clusterId: policy.clusterId,
          status: "PENDING",
          deployedById: ctx.userId,
          previousDeploymentId: currentDeployment?.id,
          isRollback: true,
          rollbackNote: input.note ?? `Rollback to version ${targetDeployment.version.version}`,
        },
        include: {
          version: {
            select: {
              id: true,
              version: true,
            },
          },
          cluster: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      // Update policy status
      await ctx.db.policy.update({
        where: { id: input.policyId },
        data: { status: "PENDING" },
      });

      return rollbackDeployment;
    }),

  // Get deployment history summary for a policy
  getSummary: protectedProcedure
    .input(z.object({ policyId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Verify policy belongs to organization
      const policy = await ctx.db.policy.findFirst({
        where: {
          id: input.policyId,
          organizationId: ctx.organizationId,
        },
      });

      if (!policy) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Policy not found",
        });
      }

      const [total, succeeded, failed, pending, rollbacks] = await Promise.all([
        ctx.db.policyDeployment.count({
          where: { policyId: input.policyId },
        }),
        ctx.db.policyDeployment.count({
          where: { policyId: input.policyId, status: "SUCCEEDED" },
        }),
        ctx.db.policyDeployment.count({
          where: { policyId: input.policyId, status: "FAILED" },
        }),
        ctx.db.policyDeployment.count({
          where: { policyId: input.policyId, status: "PENDING" },
        }),
        ctx.db.policyDeployment.count({
          where: { policyId: input.policyId, isRollback: true },
        }),
      ]);

      // Get latest successful deployment
      const latestSuccess = await ctx.db.policyDeployment.findFirst({
        where: {
          policyId: input.policyId,
          status: "SUCCEEDED",
        },
        orderBy: { completedAt: "desc" },
        include: {
          version: {
            select: { version: true },
          },
          deployedBy: {
            select: { name: true, email: true },
          },
        },
      });

      return {
        total,
        succeeded,
        failed,
        pending,
        rollbacks,
        latestSuccess: latestSuccess
          ? {
              id: latestSuccess.id,
              version: latestSuccess.version.version,
              deployedBy: latestSuccess.deployedBy.name ?? latestSuccess.deployedBy.email,
              completedAt: latestSuccess.completedAt,
            }
          : null,
      };
    }),
});
