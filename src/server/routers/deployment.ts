import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
import { createTRPCRouter, orgProtectedProcedure } from "../trpc";

// Use orgProtectedProcedure for all deployment operations (requires organization)
const protectedProcedure = orgProtectedProcedure;

export const deploymentRouter = createTRPCRouter({
  // List all recent deployments across all policies (for dashboard)
  listAll: protectedProcedure
    .input(
      z.object({
        status: z.enum(["PENDING", "IN_PROGRESS", "SUCCEEDED", "FAILED", "ROLLED_BACK"]).optional(),
        clusterId: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { status, clusterId, limit, cursor } = input;

      // Build where clause
      const where = {
        policy: {
          organizationId: ctx.organizationId,
        },
        ...(status && { status }),
        ...(clusterId && { clusterId }),
      };

      const deployments = await ctx.db.policyDeployment.findMany({
        where,
        take: limit + 1,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
        orderBy: { requestedAt: "desc" },
        include: {
          policy: {
            select: {
              id: true,
              name: true,
              type: true,
            },
          },
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
        },
      });

      let nextCursor: string | undefined = undefined;
      if (deployments.length > limit) {
        const nextItem = deployments.pop();
        nextCursor = nextItem?.id;
      }

      return {
        deployments,
        nextCursor,
      };
    }),

  // Get deployment stats across all policies (for dashboard)
  getStats: protectedProcedure.query(async ({ ctx }) => {
    // Use groupBy to get all status counts in a single query (instead of 6 separate count() calls)
    const [statusCounts, recentActivity] = await Promise.all([
      ctx.db.policyDeployment.groupBy({
        by: ["status"],
        where: { policy: { organizationId: ctx.organizationId } },
        _count: { _all: true },
      }),
      // Count deployments in last 24 hours
      ctx.db.policyDeployment.count({
        where: {
          policy: { organizationId: ctx.organizationId },
          requestedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    // Extract counts from groupBy result
    const countByStatus = Object.fromEntries(
      statusCounts.map((s) => [s.status, s._count._all])
    ) as Record<string, number>;

    const succeeded = countByStatus.SUCCEEDED ?? 0;
    const failed = countByStatus.FAILED ?? 0;
    const pending = countByStatus.PENDING ?? 0;
    const inProgress = countByStatus.IN_PROGRESS ?? 0;
    const rolledBack = countByStatus.ROLLED_BACK ?? 0;
    const total = statusCounts.reduce((sum, s) => sum + s._count._all, 0);

    // Get active deployments (pending or in progress)
    const activeDeployments = await ctx.db.policyDeployment.findMany({
      where: {
        policy: { organizationId: ctx.organizationId },
        status: { in: ["PENDING", "IN_PROGRESS"] },
      },
      take: 5,
      orderBy: { requestedAt: "desc" },
      include: {
        policy: {
          select: {
            id: true,
            name: true,
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

    return {
      total,
      succeeded,
      failed,
      pending,
      inProgress,
      rolledBack,
      recentActivity,
      activeDeployments,
      successRate: total > 0 ? Math.round((succeeded / total) * 100) : 0,
    };
  }),

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

  // Retry a failed deployment
  retry: protectedProcedure
    .input(z.object({ deploymentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Get the failed deployment
      const deployment = await ctx.db.policyDeployment.findFirst({
        where: { id: input.deploymentId },
        include: {
          policy: {
            select: {
              id: true,
              organizationId: true,
              clusterId: true,
            },
          },
          version: true,
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

      // Only failed deployments can be retried
      if (deployment.status !== "FAILED") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Only failed deployments can be retried",
        });
      }

      // Check retry limit
      if (deployment.retryCount >= deployment.maxRetries) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Maximum retry attempts (${deployment.maxRetries}) reached`,
        });
      }

      // Update deployment status to pending and increment retry count
      const updatedDeployment = await ctx.db.policyDeployment.update({
        where: { id: input.deploymentId },
        data: {
          status: "PENDING",
          retryCount: { increment: 1 },
          lastRetryAt: new Date(),
          errorMessage: null,
          errorDetails: Prisma.DbNull,
          startedAt: null,
          completedAt: null,
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
        where: { id: deployment.policy.id },
        data: { status: "PENDING" },
      });

      return updatedDeployment;
    }),

  // Get active deployment status for a policy (for polling)
  getActiveDeployment: protectedProcedure
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

      // Find any active deployment (PENDING or IN_PROGRESS)
      const activeDeployment = await ctx.db.policyDeployment.findFirst({
        where: {
          policyId: input.policyId,
          status: { in: ["PENDING", "IN_PROGRESS"] },
        },
        orderBy: { requestedAt: "desc" },
        include: {
          version: {
            select: {
              id: true,
              version: true,
            },
          },
          deployedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      return {
        hasActiveDeployment: !!activeDeployment,
        deployment: activeDeployment,
        policyStatus: policy.status,
      };
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
