/**
 * Admin Router
 *
 * Provides SuperAdmin-only procedures for platform management.
 * All procedures in this router require SuperAdmin access.
 */

import { z } from "zod";
import { createTRPCRouter, superAdminProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";

export const adminRouter = createTRPCRouter({
  /**
   * Get platform-wide statistics for the admin dashboard
   */
  getDashboardStats: superAdminProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Run all queries in parallel
    const [
      totalUsers,
      activeUsers,
      totalOrganizations,
      totalClusters,
      connectedClusters,
      totalPolicies,
      deployedPolicies,
      recentActivity,
    ] = await Promise.all([
      // Total users
      ctx.db.user.count(),

      // Active users (logged in within 7 days) - using updatedAt as proxy
      ctx.db.user.count({
        where: {
          updatedAt: { gte: sevenDaysAgo },
        },
      }),

      // Total organizations
      ctx.db.organization.count(),

      // Total clusters
      ctx.db.cluster.count(),

      // Connected clusters
      ctx.db.cluster.count({
        where: { status: "CONNECTED" },
      }),

      // Total policies
      ctx.db.policy.count(),

      // Deployed policies
      ctx.db.policy.count({
        where: { status: "DEPLOYED" },
      }),

      // Recent audit log activity (last 10 events)
      ctx.db.auditLog.findMany({
        take: 10,
        orderBy: { timestamp: "desc" },
        select: {
          id: true,
          action: true,
          userEmail: true,
          timestamp: true,
          resourceType: true,
          resource: true,
        },
      }),
    ]);

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
      },
      organizations: {
        total: totalOrganizations,
      },
      clusters: {
        total: totalClusters,
        connected: connectedClusters,
      },
      policies: {
        total: totalPolicies,
        deployed: deployedPolicies,
      },
      recentActivity: recentActivity.map((log) => ({
        id: log.id,
        action: log.action,
        userEmail: log.userEmail,
        timestamp: log.timestamp,
        resourceType: log.resourceType ?? log.resource,
      })),
    };
  }),

  /**
   * List all users across the platform
   */
  listUsers: superAdminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
        search: z.string().optional(),
        organizationId: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const users = await ctx.db.user.findMany({
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        where: {
          ...(input.search && {
            OR: [
              { email: { contains: input.search, mode: "insensitive" } },
              { name: { contains: input.search, mode: "insensitive" } },
            ],
          }),
          ...(input.organizationId && { organizationId: input.organizationId }),
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          isSuperAdmin: true,
          role: true,
          newRole: true,
          organizationId: true,
          organization: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
          createdAt: true,
          updatedAt: true,
        },
      });

      let nextCursor: string | undefined;
      if (users.length > input.limit) {
        const nextItem = users.pop();
        nextCursor = nextItem?.id;
      }

      return {
        users,
        nextCursor,
      };
    }),

  /**
   * Get a single user by ID
   */
  getUser: superAdminProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUnique({
        where: { id: input.userId },
        include: {
          organization: true,
          clusterAssignments: {
            include: {
              cluster: {
                select: {
                  id: true,
                  name: true,
                  status: true,
                },
              },
            },
          },
        },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      return user;
    }),

  /**
   * Update a user's role or SuperAdmin status
   */
  updateUser: superAdminProcedure
    .input(
      z.object({
        userId: z.string(),
        isSuperAdmin: z.boolean().optional(),
        newRole: z.enum(["ORG_ADMIN", "CLUSTER_ADMIN", "POLICY_EDITOR", "VIEWER"]).optional(),
        organizationId: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { userId, ...updates } = input;

      // Don't allow removing your own SuperAdmin status
      if (userId === ctx.userId && updates.isSuperAdmin === false) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot remove your own SuperAdmin status",
        });
      }

      const user = await ctx.db.user.update({
        where: { id: userId },
        data: updates,
        include: {
          organization: true,
        },
      });

      return user;
    }),

  /**
   * List all organizations
   */
  listOrganizations: superAdminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
        search: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const organizations = await ctx.db.organization.findMany({
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        where: input.search
          ? {
              OR: [
                { name: { contains: input.search, mode: "insensitive" } },
                { slug: { contains: input.search, mode: "insensitive" } },
              ],
            }
          : undefined,
        orderBy: { createdAt: "desc" },
        include: {
          _count: {
            select: {
              users: true,
              clusters: true,
              policies: true,
            },
          },
        },
      });

      let nextCursor: string | undefined;
      if (organizations.length > input.limit) {
        const nextItem = organizations.pop();
        nextCursor = nextItem?.id;
      }

      return {
        organizations,
        nextCursor,
      };
    }),

  /**
   * Get a single organization by ID
   */
  getOrganization: superAdminProcedure
    .input(z.object({ organizationId: z.string() }))
    .query(async ({ ctx, input }) => {
      const organization = await ctx.db.organization.findUnique({
        where: { id: input.organizationId },
        include: {
          users: {
            select: {
              id: true,
              email: true,
              name: true,
              newRole: true,
              isSuperAdmin: true,
            },
          },
          clusters: {
            select: {
              id: true,
              name: true,
              status: true,
              provider: true,
            },
          },
          _count: {
            select: {
              policies: true,
            },
          },
        },
      });

      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      return organization;
    }),

  /**
   * Create a new organization
   */
  createOrganization: superAdminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        slug: z
          .string()
          .min(1)
          .max(63)
          .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check if slug is already taken
      const existing = await ctx.db.organization.findUnique({
        where: { slug: input.slug },
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Organization slug already exists",
        });
      }

      const organization = await ctx.db.organization.create({
        data: {
          name: input.name,
          slug: input.slug,
        },
      });

      return organization;
    }),

  /**
   * Get audit logs with filtering
   */
  getAuditLogs: superAdminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
        organizationId: z.string().optional(),
        userId: z.string().optional(),
        action: z.string().optional(),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const logs = await ctx.db.auditLog.findMany({
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        where: {
          ...(input.organizationId && { organizationId: input.organizationId }),
          ...(input.userId && { userId: input.userId }),
          ...(input.action && { action: input.action }),
          ...((input.startDate ?? input.endDate)
            ? {
                timestamp: {
                  ...(input.startDate && { gte: input.startDate }),
                  ...(input.endDate && { lte: input.endDate }),
                },
              }
            : {}),
        },
        orderBy: { timestamp: "desc" },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
          organization: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      let nextCursor: string | undefined;
      if (logs.length > input.limit) {
        const nextItem = logs.pop();
        nextCursor = nextItem?.id;
      }

      return {
        logs,
        nextCursor,
      };
    }),

  /**
   * List all clusters across the platform
   */
  listClusters: superAdminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
        organizationId: z.string().optional(),
        status: z.enum(["CONNECTED", "PENDING", "DEGRADED", "DISCONNECTED", "ERROR"]).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const clusters = await ctx.db.cluster.findMany({
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        where: {
          ...(input.organizationId && { organizationId: input.organizationId }),
          ...(input.status && { status: input.status }),
        },
        orderBy: { createdAt: "desc" },
        include: {
          organization: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
      });

      let nextCursor: string | undefined;
      if (clusters.length > input.limit) {
        const nextItem = clusters.pop();
        nextCursor = nextItem?.id;
      }

      return {
        clusters,
        nextCursor,
      };
    }),

  /**
   * Get system configuration
   */
  getSystemConfig: superAdminProcedure
    .input(z.object({ key: z.string() }).optional())
    .query(async ({ ctx, input }) => {
      if (input?.key) {
        const config = await ctx.db.systemConfig.findUnique({
          where: { key: input.key },
        });
        return config;
      }

      // Return all configs
      const configs = await ctx.db.systemConfig.findMany();
      return configs;
    }),

  /**
   * Update system configuration
   */
  updateSystemConfig: superAdminProcedure
    .input(
      z.object({
        key: z.string(),
        value: z.union([
          z.string(),
          z.number(),
          z.boolean(),
          z.record(z.unknown()),
          z.array(z.unknown()),
        ]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const config = await ctx.db.systemConfig.upsert({
        where: { key: input.key },
        update: { value: input.value as object },
        create: { key: input.key, value: input.value as object },
      });

      return config;
    }),

  /**
   * Invite a user to any organization (SuperAdmin only)
   */
  inviteUser: superAdminProcedure
    .input(
      z.object({
        email: z.string().email(),
        organizationId: z.string(),
        role: z.enum(["ORG_ADMIN", "CLUSTER_ADMIN", "POLICY_EDITOR", "VIEWER"]).default("VIEWER"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify organization exists
      const org = await ctx.db.organization.findUnique({
        where: { id: input.organizationId },
      });

      if (!org) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      // Check if user is already in the organization
      const existingUser = await ctx.db.user.findFirst({
        where: {
          email: input.email,
          organizationId: input.organizationId,
        },
      });

      if (existingUser) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "User is already a member of this organization",
        });
      }

      // Check if there's already a pending invitation
      const existingInvitation = await ctx.db.invitation.findFirst({
        where: {
          email: input.email,
          organizationId: input.organizationId,
          acceptedAt: null,
          expiresAt: { gt: new Date() },
        },
      });

      if (existingInvitation) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An invitation for this email is already pending",
        });
      }

      // Calculate expiry date (7 days)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      // Create the invitation
      const invitation = await ctx.db.invitation.create({
        data: {
          email: input.email.toLowerCase(),
          organizationId: input.organizationId,
          role: input.role,
          invitedById: ctx.userId,
          expiresAt,
        },
        include: {
          organization: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
      });

      return {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        organization: invitation.organization,
      };
    }),
});
