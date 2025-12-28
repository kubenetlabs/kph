import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const PolicyPackTierSchema = z.enum(["COMMUNITY", "ENTERPRISE"]);
const PolicyPackCategorySchema = z.enum(["COMPLIANCE", "WORKLOAD", "SECURITY"]);

export const marketplaceRouter = createTRPCRouter({
  // List available packs (filtered by tier access)
  listPacks: protectedProcedure
    .input(
      z.object({
        category: PolicyPackCategorySchema.optional(),
        tier: PolicyPackTierSchema.optional(),
        search: z.string().optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      // Check organization's subscription tier
      const subscription = await ctx.db.subscription.findUnique({
        where: { organizationId: ctx.organizationId },
      });

      const hasEnterprise =
        subscription?.tier === "ENTERPRISE" && subscription?.status === "ACTIVE";

      // Build filter
      const where = {
        isPublished: true,
        ...(input?.category && { category: input.category }),
        ...(input?.tier && { tier: input.tier }),
        ...(input?.search && {
          OR: [
            { name: { contains: input.search, mode: "insensitive" as const } },
            { description: { contains: input.search, mode: "insensitive" as const } },
          ],
        }),
      };

      const packs = await ctx.db.policyPack.findMany({
        where,
        orderBy: [{ tier: "asc" }, { name: "asc" }],
        include: {
          _count: {
            select: {
              policies: true,
              installations: true,
            },
          },
        },
      });

      // Check if user has installed each pack
      const installations = await ctx.db.policyPackInstallation.findMany({
        where: {
          organizationId: ctx.organizationId,
          packId: { in: packs.map((p) => p.id) },
        },
        select: { packId: true },
      });

      const installedPackIds = new Set(installations.map((i) => i.packId));

      return {
        packs: packs.map((pack) => ({
          id: pack.id,
          slug: pack.slug,
          name: pack.name,
          description: pack.description,
          tier: pack.tier,
          category: pack.category,
          complianceFramework: pack.complianceFramework,
          version: pack.version,
          iconUrl: pack.iconUrl,
          tags: pack.tags,
          policyCount: pack._count.policies,
          installCount: pack._count.installations,
          isInstalled: installedPackIds.has(pack.id),
          isAccessible: pack.tier === "COMMUNITY" || hasEnterprise,
        })),
        hasEnterprise,
      };
    }),

  // Get pack details with policies
  getPackDetails: protectedProcedure
    .input(z.object({ packId: z.string() }))
    .query(async ({ ctx, input }) => {
      const pack = await ctx.db.policyPack.findUnique({
        where: { id: input.packId },
        include: {
          policies: {
            orderBy: { order: "asc" },
          },
          _count: {
            select: { installations: true },
          },
        },
      });

      if (!pack) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Policy pack not found",
        });
      }

      // Check subscription for enterprise packs
      const subscription = await ctx.db.subscription.findUnique({
        where: { organizationId: ctx.organizationId },
      });

      const hasEnterprise =
        subscription?.tier === "ENTERPRISE" && subscription?.status === "ACTIVE";
      const isAccessible = pack.tier === "COMMUNITY" || hasEnterprise;

      // Check if installed
      const installation = await ctx.db.policyPackInstallation.findUnique({
        where: {
          packId_organizationId: {
            packId: input.packId,
            organizationId: ctx.organizationId,
          },
        },
        include: {
          deployments: {
            include: {
              cluster: {
                select: { id: true, name: true },
              },
            },
          },
          installedBy: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      return {
        pack: {
          id: pack.id,
          slug: pack.slug,
          name: pack.name,
          description: pack.description,
          tier: pack.tier,
          category: pack.category,
          complianceFramework: pack.complianceFramework,
          auditorName: pack.auditorName,
          certificationDate: pack.certificationDate,
          version: pack.version,
          iconUrl: pack.iconUrl,
          docsUrl: pack.docsUrl,
          tags: pack.tags,
          installCount: pack._count.installations,
          createdAt: pack.createdAt,
          updatedAt: pack.updatedAt,
        },
        // Only include full YAML if accessible
        policies: isAccessible
          ? pack.policies.map((p) => ({
              id: p.id,
              name: p.name,
              description: p.description,
              policyType: p.policyType,
              yamlContent: p.yamlContent,
              controlIds: p.controlIds,
              order: p.order,
            }))
          : pack.policies.map((p) => ({
              id: p.id,
              name: p.name,
              description: p.description,
              policyType: p.policyType,
              yamlContent: null, // Hide YAML for non-subscribers
              controlIds: p.controlIds,
              order: p.order,
            })),
        installation: installation
          ? {
              id: installation.id,
              installedAt: installation.installedAt,
              installedBy: installation.installedBy,
              deployments: installation.deployments.map((d) => ({
                id: d.id,
                cluster: d.cluster,
                status: d.status,
                deployedAt: d.deployedAt,
              })),
            }
          : null,
        isAccessible,
        hasEnterprise,
      };
    }),

  // Install pack to organization
  installPack: protectedProcedure
    .input(z.object({ packId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Get the pack
      const pack = await ctx.db.policyPack.findUnique({
        where: { id: input.packId },
      });

      if (!pack || !pack.isPublished) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Policy pack not found",
        });
      }

      // Check subscription for enterprise packs
      if (pack.tier === "ENTERPRISE") {
        const subscription = await ctx.db.subscription.findUnique({
          where: { organizationId: ctx.organizationId },
        });

        if (subscription?.tier !== "ENTERPRISE" || subscription?.status !== "ACTIVE") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Enterprise subscription required for this pack",
          });
        }
      }

      // Check if already installed
      const existing = await ctx.db.policyPackInstallation.findUnique({
        where: {
          packId_organizationId: {
            packId: input.packId,
            organizationId: ctx.organizationId,
          },
        },
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Pack is already installed",
        });
      }

      // Create installation
      const installation = await ctx.db.policyPackInstallation.create({
        data: {
          packId: input.packId,
          organizationId: ctx.organizationId,
          installedById: ctx.userId,
        },
        include: {
          pack: {
            select: { name: true, slug: true },
          },
        },
      });

      return {
        installation: {
          id: installation.id,
          packName: installation.pack.name,
          installedAt: installation.installedAt,
        },
      };
    }),

  // Uninstall pack from organization
  uninstallPack: protectedProcedure
    .input(z.object({ installationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const installation = await ctx.db.policyPackInstallation.findFirst({
        where: {
          id: input.installationId,
          organizationId: ctx.organizationId,
        },
        include: {
          deployments: true,
        },
      });

      if (!installation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Installation not found",
        });
      }

      // Check if deployed anywhere
      const activeDeployments = installation.deployments.filter(
        (d) => d.status === "DEPLOYED"
      );

      if (activeDeployments.length > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Pack is deployed to ${activeDeployments.length} cluster(s). Remove deployments first.`,
        });
      }

      await ctx.db.policyPackInstallation.delete({
        where: { id: input.installationId },
      });

      return { success: true };
    }),

  // Deploy installed pack to cluster
  deployToCluster: protectedProcedure
    .input(
      z.object({
        installationId: z.string(),
        clusterId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify installation belongs to organization
      const installation = await ctx.db.policyPackInstallation.findFirst({
        where: {
          id: input.installationId,
          organizationId: ctx.organizationId,
        },
        include: {
          pack: {
            include: {
              policies: true,
            },
          },
        },
      });

      if (!installation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Installation not found",
        });
      }

      // Verify cluster belongs to organization
      const cluster = await ctx.db.cluster.findFirst({
        where: {
          id: input.clusterId,
          organizationId: ctx.organizationId,
        },
      });

      if (!cluster) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Cluster not found",
        });
      }

      // Check if already deployed
      const existingDeployment = await ctx.db.policyPackDeployment.findUnique({
        where: {
          installationId_clusterId: {
            installationId: input.installationId,
            clusterId: input.clusterId,
          },
        },
      });

      if (existingDeployment) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Pack is already deployed to this cluster",
        });
      }

      // Create deployment record
      const deployment = await ctx.db.policyPackDeployment.create({
        data: {
          installationId: input.installationId,
          clusterId: input.clusterId,
          status: "PENDING",
        },
      });

      // Create actual policies from pack items
      for (const item of installation.pack.policies) {
        await ctx.db.policy.create({
          data: {
            name: `${installation.pack.slug}-${item.name}`.toLowerCase().replace(/\s+/g, "-"),
            description: item.description,
            type: item.policyType,
            content: item.yamlContent,
            status: "PENDING",
            organizationId: ctx.organizationId,
            clusterId: input.clusterId,
            createdById: ctx.userId,
            targetNamespaces: [],
          },
        });
      }

      // Update deployment status
      await ctx.db.policyPackDeployment.update({
        where: { id: deployment.id },
        data: {
          status: "DEPLOYED",
          deployedAt: new Date(),
        },
      });

      return {
        deployment: {
          id: deployment.id,
          status: "DEPLOYED",
          policiesCreated: installation.pack.policies.length,
        },
      };
    }),

  // Get all installations for organization
  getInstallations: protectedProcedure.query(async ({ ctx }) => {
    const installations = await ctx.db.policyPackInstallation.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { installedAt: "desc" },
      include: {
        pack: {
          select: {
            id: true,
            slug: true,
            name: true,
            tier: true,
            category: true,
            version: true,
            iconUrl: true,
            _count: {
              select: { policies: true },
            },
          },
        },
        installedBy: {
          select: { id: true, name: true, email: true },
        },
        deployments: {
          include: {
            cluster: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });

    return {
      installations: installations.map((i) => ({
        id: i.id,
        pack: {
          id: i.pack.id,
          slug: i.pack.slug,
          name: i.pack.name,
          tier: i.pack.tier,
          category: i.pack.category,
          version: i.pack.version,
          iconUrl: i.pack.iconUrl,
          policyCount: i.pack._count.policies,
        },
        installedAt: i.installedAt,
        installedBy: i.installedBy,
        deployments: i.deployments.map((d) => ({
          id: d.id,
          cluster: d.cluster,
          status: d.status,
          deployedAt: d.deployedAt,
        })),
      })),
    };
  }),

  // Get organization's subscription status
  getSubscription: protectedProcedure.query(async ({ ctx }) => {
    const subscription = await ctx.db.subscription.findUnique({
      where: { organizationId: ctx.organizationId },
    });

    return {
      tier: subscription?.tier ?? "FREE",
      status: subscription?.status ?? "ACTIVE",
      currentPeriodEnd: subscription?.currentPeriodEnd,
    };
  }),
});
