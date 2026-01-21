import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, orgProtectedProcedure } from "../trpc";

// Use orgProtectedProcedure for all marketplace operations (requires organization)
const protectedProcedure = orgProtectedProcedure;

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

      // Single query: fetch packs with counts AND check if current org has installed
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
          // Include installations for current org to check installed status
          installations: {
            where: { organizationId: ctx.organizationId },
            select: { id: true },
            take: 1, // Only need to know if at least one exists
          },
        },
      });

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
          isInstalled: pack.installations.length > 0,
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

      if (!pack?.isPublished) {
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

  // =====================
  // Admin Endpoints
  // =====================

  // Get packs created by this organization
  getMyPacks: protectedProcedure.query(async ({ ctx }) => {
    const packs = await ctx.db.policyPack.findMany({
      where: { createdByOrgId: ctx.organizationId },
      orderBy: { createdAt: "desc" },
      include: {
        policies: {
          orderBy: { order: "asc" },
        },
        _count: {
          select: { installations: true },
        },
      },
    });

    return {
      packs: packs.map((pack) => ({
        id: pack.id,
        slug: pack.slug,
        name: pack.name,
        description: pack.description,
        tier: pack.tier,
        category: pack.category,
        version: pack.version,
        isPublished: pack.isPublished,
        policies: pack.policies,
        installCount: pack._count.installations,
        createdAt: pack.createdAt,
        updatedAt: pack.updatedAt,
      })),
    };
  }),

  // Create a new policy pack
  createPack: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
        description: z.string().min(1).max(500),
        tier: PolicyPackTierSchema,
        category: PolicyPackCategorySchema,
        version: z.string().default("1.0.0"),
        complianceFramework: z.string().optional(),
        iconUrl: z.string().url().optional(),
        docsUrl: z.string().url().optional(),
        tags: z.array(z.string()).default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check if slug is already taken
      const existing = await ctx.db.policyPack.findUnique({
        where: { slug: input.slug },
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A pack with this slug already exists",
        });
      }

      const pack = await ctx.db.policyPack.create({
        data: {
          slug: input.slug,
          name: input.name,
          description: input.description,
          tier: input.tier,
          category: input.category,
          version: input.version,
          complianceFramework: input.complianceFramework,
          iconUrl: input.iconUrl,
          docsUrl: input.docsUrl,
          tags: input.tags,
          isPublished: false,
          createdByOrgId: ctx.organizationId,
        },
      });

      return { pack };
    }),

  // Update a policy pack
  updatePack: protectedProcedure
    .input(
      z.object({
        packId: z.string(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().min(1).max(500).optional(),
        tier: PolicyPackTierSchema.optional(),
        category: PolicyPackCategorySchema.optional(),
        version: z.string().optional(),
        complianceFramework: z.string().nullable().optional(),
        iconUrl: z.string().url().nullable().optional(),
        docsUrl: z.string().url().nullable().optional(),
        tags: z.array(z.string()).optional(),
        isPublished: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify pack belongs to organization
      const pack = await ctx.db.policyPack.findFirst({
        where: {
          id: input.packId,
          createdByOrgId: ctx.organizationId,
        },
      });

      if (!pack) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Policy pack not found",
        });
      }

      const { packId, ...updateData } = input;

      const updated = await ctx.db.policyPack.update({
        where: { id: packId },
        data: updateData,
      });

      return { pack: updated };
    }),

  // Delete a policy pack
  deletePack: protectedProcedure
    .input(z.object({ packId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Verify pack belongs to organization
      const pack = await ctx.db.policyPack.findFirst({
        where: {
          id: input.packId,
          createdByOrgId: ctx.organizationId,
        },
        include: {
          _count: { select: { installations: true } },
        },
      });

      if (!pack) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Policy pack not found",
        });
      }

      if (pack._count.installations > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot delete pack with ${pack._count.installations} active installation(s)`,
        });
      }

      // Delete policies first, then pack
      await ctx.db.policyPackItem.deleteMany({
        where: { packId: input.packId },
      });

      await ctx.db.policyPack.delete({
        where: { id: input.packId },
      });

      return { success: true };
    }),

  // Add a new policy to a pack
  addPolicyToPack: protectedProcedure
    .input(
      z.object({
        packId: z.string(),
        name: z.string().min(1).max(100),
        description: z.string().min(1).max(500),
        policyType: z.enum(["CILIUM_NETWORK", "CILIUM_CLUSTERWIDE"]),
        yamlContent: z.string().min(1),
        controlIds: z.array(z.string()).default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify pack belongs to organization
      const pack = await ctx.db.policyPack.findFirst({
        where: {
          id: input.packId,
          createdByOrgId: ctx.organizationId,
        },
        include: {
          policies: { select: { order: true }, orderBy: { order: "desc" }, take: 1 },
        },
      });

      if (!pack) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Policy pack not found",
        });
      }

      const nextOrder = (pack.policies[0]?.order ?? -1) + 1;

      const policy = await ctx.db.policyPackItem.create({
        data: {
          packId: input.packId,
          name: input.name,
          description: input.description,
          policyType: input.policyType,
          yamlContent: input.yamlContent,
          controlIds: input.controlIds,
          order: nextOrder,
        },
      });

      return { policy };
    }),

  // Update a policy in a pack
  updatePackPolicy: protectedProcedure
    .input(
      z.object({
        policyId: z.string(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().min(1).max(500).optional(),
        policyType: z.enum(["CILIUM_NETWORK", "CILIUM_CLUSTERWIDE"]).optional(),
        yamlContent: z.string().min(1).optional(),
        controlIds: z.array(z.string()).optional(),
        order: z.number().int().min(0).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify policy's pack belongs to organization
      const policy = await ctx.db.policyPackItem.findFirst({
        where: { id: input.policyId },
        include: {
          pack: { select: { createdByOrgId: true } },
        },
      });

      if (!policy || policy.pack.createdByOrgId !== ctx.organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Policy not found",
        });
      }

      const { policyId, ...updateData } = input;

      const updated = await ctx.db.policyPackItem.update({
        where: { id: policyId },
        data: updateData,
      });

      return { policy: updated };
    }),

  // Remove a policy from a pack
  removePackPolicy: protectedProcedure
    .input(z.object({ policyId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Verify policy's pack belongs to organization
      const policy = await ctx.db.policyPackItem.findFirst({
        where: { id: input.policyId },
        include: {
          pack: { select: { createdByOrgId: true } },
        },
      });

      if (!policy || policy.pack.createdByOrgId !== ctx.organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Policy not found",
        });
      }

      await ctx.db.policyPackItem.delete({
        where: { id: input.policyId },
      });

      return { success: true };
    }),

  // Import existing organization policy into a pack
  importPolicyToPack: protectedProcedure
    .input(
      z.object({
        packId: z.string(),
        policyId: z.string(),
        controlIds: z.array(z.string()).default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify pack belongs to organization
      const pack = await ctx.db.policyPack.findFirst({
        where: {
          id: input.packId,
          createdByOrgId: ctx.organizationId,
        },
        include: {
          policies: { select: { order: true }, orderBy: { order: "desc" }, take: 1 },
        },
      });

      if (!pack) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Policy pack not found",
        });
      }

      // Get the organization policy
      const orgPolicy = await ctx.db.policy.findFirst({
        where: {
          id: input.policyId,
          organizationId: ctx.organizationId,
        },
      });

      if (!orgPolicy) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Policy not found",
        });
      }

      const nextOrder = (pack.policies[0]?.order ?? -1) + 1;

      const policy = await ctx.db.policyPackItem.create({
        data: {
          packId: input.packId,
          name: orgPolicy.name,
          description: orgPolicy.description ?? "",
          policyType: orgPolicy.type === "CILIUM_CLUSTERWIDE" ? "CILIUM_CLUSTERWIDE" : "CILIUM_NETWORK",
          yamlContent: orgPolicy.content,
          controlIds: input.controlIds,
          order: nextOrder,
        },
      });

      return { policy };
    }),

  // List organization's policies for import selection
  listOrgPolicies: protectedProcedure
    .input(
      z.object({
        search: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const policies = await ctx.db.policy.findMany({
        where: {
          organizationId: ctx.organizationId,
          ...(input?.search && {
            OR: [
              { name: { contains: input.search, mode: "insensitive" as const } },
              { description: { contains: input.search, mode: "insensitive" as const } },
            ],
          }),
        },
        take: input?.limit ?? 50,
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          description: true,
          type: true,
          status: true,
          cluster: {
            select: { id: true, name: true },
          },
        },
      });

      return { policies };
    }),
});
