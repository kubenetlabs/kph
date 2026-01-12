import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, orgProtectedProcedure } from "../trpc";
import {
  isGatewayAPIType,
  validateGatewayAPIPolicy,
} from "~/lib/gateway-api-validator";

// Use orgProtectedProcedure for all template operations (requires organization)
const protectedProcedure = orgProtectedProcedure;

// Enum schemas matching Prisma
const PolicyTypeSchema = z.enum([
  "CILIUM_NETWORK",
  "CILIUM_CLUSTERWIDE",
  "TETRAGON",
  "GATEWAY_HTTPROUTE",
  "GATEWAY_GRPCROUTE",
  "GATEWAY_TCPROUTE",
  "GATEWAY_TLSROUTE",
]);

// Input schemas
const createTemplateSchema = z.object({
  name: z
    .string()
    .min(1, "Template name is required")
    .max(63, "Template name must be 63 characters or less")
    .regex(
      /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/,
      "Template name must start and end with alphanumeric characters and can only contain lowercase letters, numbers, and hyphens"
    ),
  description: z.string().max(5000).optional(),
  type: PolicyTypeSchema,
  content: z.string().min(1, "Template content is required"),
  defaultTargetNamespaces: z.array(z.string()).default([]),
  defaultTargetLabels: z.record(z.string()).optional(),
});

const updateTemplateSchema = z.object({
  id: z.string(),
  name: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/)
    .optional(),
  description: z.string().max(5000).optional(),
  content: z.string().min(1).optional(),
  defaultTargetNamespaces: z.array(z.string()).optional(),
  defaultTargetLabels: z.record(z.string()).optional(),
});

const listTemplatesSchema = z.object({
  type: PolicyTypeSchema.optional(),
  search: z.string().optional(),
  limit: z.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const syncTemplateSchema = z.object({
  templateId: z.string(),
  clusterIds: z.array(z.string()).min(1, "At least one cluster is required"),
  deployAfterSync: z.boolean().default(false),
});

export const templateRouter = createTRPCRouter({
  // List templates with filtering and pagination
  list: protectedProcedure
    .input(listTemplatesSchema)
    .query(async ({ ctx, input }) => {
      const { type, search, limit, cursor } = input;

      const where = {
        organizationId: ctx.organizationId,
        ...(type && { type }),
        ...(search && {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { description: { contains: search, mode: "insensitive" as const } },
          ],
        }),
      };

      const templates = await ctx.db.policyTemplate.findMany({
        where,
        take: limit + 1,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
        orderBy: { createdAt: "desc" },
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          _count: {
            select: {
              policies: true,
              versions: true,
              syncOperations: true,
            },
          },
        },
      });

      let nextCursor: string | undefined = undefined;
      if (templates.length > limit) {
        const nextItem = templates.pop();
        nextCursor = nextItem?.id;
      }

      return {
        templates,
        nextCursor,
      };
    }),

  // Get single template by ID with sync status per cluster
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const template = await ctx.db.policyTemplate.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.organizationId,
        },
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          versions: {
            orderBy: { version: "desc" },
            take: 10,
          },
          policies: {
            include: {
              cluster: {
                select: {
                  id: true,
                  name: true,
                  environment: true,
                  provider: true,
                },
              },
            },
          },
          syncOperations: {
            orderBy: { createdAt: "desc" },
            take: 10,
            include: {
              triggeredBy: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
        },
      });

      if (!template) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Template not found",
        });
      }

      // Get all clusters for this organization to show sync status
      const clusters = await ctx.db.cluster.findMany({
        where: { organizationId: ctx.organizationId },
        select: {
          id: true,
          name: true,
          environment: true,
          provider: true,
        },
      });

      // Build sync status for each cluster
      const syncStatus = clusters.map((cluster) => {
        const linkedPolicy = template.policies.find(
          (p) => p.clusterId === cluster.id
        );
        return {
          cluster,
          status: linkedPolicy
            ? linkedPolicy.syncedFromVersion === template.currentVersion
              ? ("SYNCED" as const)
              : ("OUT_OF_DATE" as const)
            : ("NOT_SYNCED" as const),
          syncedVersion: linkedPolicy?.syncedFromVersion ?? null,
          policyId: linkedPolicy?.id ?? null,
          policyStatus: linkedPolicy?.status ?? null,
        };
      });

      return {
        ...template,
        syncStatus,
      };
    }),

  // Create a new template
  create: protectedProcedure
    .input(createTemplateSchema)
    .mutation(async ({ ctx, input }) => {
      // Check for duplicate name in organization
      const existing = await ctx.db.policyTemplate.findUnique({
        where: {
          organizationId_name: {
            organizationId: ctx.organizationId,
            name: input.name,
          },
        },
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A template with this name already exists",
        });
      }

      // Validate Gateway API YAML if applicable
      if (isGatewayAPIType(input.type)) {
        validateGatewayAPIPolicy(input.content, input.type);
      }

      const template = await ctx.db.policyTemplate.create({
        data: {
          name: input.name,
          description: input.description,
          type: input.type,
          content: input.content,
          defaultTargetNamespaces: input.defaultTargetNamespaces,
          defaultTargetLabels: input.defaultTargetLabels,
          currentVersion: 1,
          organizationId: ctx.organizationId,
          createdById: ctx.userId,
        },
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      // Create initial version
      await ctx.db.policyTemplateVersion.create({
        data: {
          templateId: template.id,
          version: 1,
          content: input.content,
          changelog: "Initial version",
        },
      });

      return template;
    }),

  // Update a template (creates new version if content changes)
  update: protectedProcedure
    .input(updateTemplateSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      // Verify template exists and belongs to organization
      const existing = await ctx.db.policyTemplate.findFirst({
        where: {
          id,
          organizationId: ctx.organizationId,
        },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Template not found",
        });
      }

      // If name is changing, check for duplicates
      if (data.name && data.name !== existing.name) {
        const duplicate = await ctx.db.policyTemplate.findUnique({
          where: {
            organizationId_name: {
              organizationId: ctx.organizationId,
              name: data.name,
            },
          },
        });

        if (duplicate) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A template with this name already exists",
          });
        }
      }

      // If content is changing, validate and create a new version
      let newVersion = existing.currentVersion;
      if (data.content && data.content !== existing.content) {
        // Validate Gateway API YAML if applicable
        if (isGatewayAPIType(existing.type)) {
          validateGatewayAPIPolicy(data.content, existing.type);
        }

        newVersion = existing.currentVersion + 1;

        await ctx.db.policyTemplateVersion.create({
          data: {
            templateId: id,
            version: newVersion,
            content: data.content,
            changelog: "Updated template content",
          },
        });
      }

      const template = await ctx.db.policyTemplate.update({
        where: { id },
        data: {
          ...data,
          currentVersion: newVersion,
        },
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      return template;
    }),

  // Delete a template
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Verify template exists and belongs to organization
      const existing = await ctx.db.policyTemplate.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.organizationId,
        },
        include: {
          _count: {
            select: { policies: true },
          },
        },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Template not found",
        });
      }

      // Warn if there are linked policies (they will become standalone)
      const hasLinkedPolicies = existing._count.policies > 0;

      await ctx.db.policyTemplate.delete({
        where: { id: input.id },
      });

      return {
        success: true,
        policiesUnlinked: existing._count.policies,
        message: hasLinkedPolicies
          ? `Template deleted. ${existing._count.policies} policies are now standalone.`
          : "Template deleted.",
      };
    }),

  // Sync template to selected clusters
  sync: protectedProcedure
    .input(syncTemplateSchema)
    .mutation(async ({ ctx, input }) => {
      const { templateId, clusterIds, deployAfterSync } = input;

      // Get the template
      const template = await ctx.db.policyTemplate.findFirst({
        where: {
          id: templateId,
          organizationId: ctx.organizationId,
        },
      });

      if (!template) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Template not found",
        });
      }

      // Verify all clusters belong to organization
      const clusters = await ctx.db.cluster.findMany({
        where: {
          id: { in: clusterIds },
          organizationId: ctx.organizationId,
        },
      });

      if (clusters.length !== clusterIds.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "One or more clusters not found",
        });
      }

      // Create sync operation record
      const syncOp = await ctx.db.templateSyncOperation.create({
        data: {
          templateId,
          templateVersion: template.currentVersion,
          targetClusterIds: clusterIds,
          status: "IN_PROGRESS",
          triggeredById: ctx.userId,
        },
      });

      let policiesCreated = 0;
      let policiesUpdated = 0;
      let policiesFailed = 0;
      const errors: Array<{ clusterId: string; error: string }> = [];

      // Sync to each cluster
      for (const cluster of clusters) {
        try {
          // Check if policy already exists for this template in this cluster
          const existingPolicy = await ctx.db.policy.findFirst({
            where: {
              templateId,
              clusterId: cluster.id,
            },
          });

          if (existingPolicy) {
            // Update existing policy
            await ctx.db.policy.update({
              where: { id: existingPolicy.id },
              data: {
                content: template.content,
                syncedFromVersion: template.currentVersion,
                targetNamespaces: template.defaultTargetNamespaces,
                targetLabels: template.defaultTargetLabels ?? undefined,
              },
            });

            // Create new version for the policy
            const latestVersion = await ctx.db.policyVersion.findFirst({
              where: { policyId: existingPolicy.id },
              orderBy: { version: "desc" },
            });

            await ctx.db.policyVersion.create({
              data: {
                policyId: existingPolicy.id,
                version: (latestVersion?.version ?? 0) + 1,
                content: template.content,
                changelog: `Synced from template v${template.currentVersion}`,
              },
            });

            policiesUpdated++;

            // Optionally trigger deployment
            if (deployAfterSync) {
              await ctx.db.policy.update({
                where: { id: existingPolicy.id },
                data: { status: "PENDING" },
              });
            }
          } else {
            // Check if a policy with this name already exists (not from this template)
            const conflictingPolicy = await ctx.db.policy.findUnique({
              where: {
                clusterId_name: {
                  clusterId: cluster.id,
                  name: template.name,
                },
              },
            });

            if (conflictingPolicy) {
              throw new Error(
                `Policy "${template.name}" already exists in cluster but is not managed by this template`
              );
            }

            // Create new policy from template
            const newPolicy = await ctx.db.policy.create({
              data: {
                name: template.name,
                description: template.description,
                type: template.type,
                content: template.content,
                status: deployAfterSync ? "PENDING" : "DRAFT",
                targetNamespaces: template.defaultTargetNamespaces,
                targetLabels: template.defaultTargetLabels ?? undefined,
                organizationId: ctx.organizationId,
                clusterId: cluster.id,
                createdById: ctx.userId,
                templateId,
                syncedFromVersion: template.currentVersion,
              },
            });

            // Create initial version
            await ctx.db.policyVersion.create({
              data: {
                policyId: newPolicy.id,
                version: 1,
                content: template.content,
                changelog: `Created from template v${template.currentVersion}`,
              },
            });

            policiesCreated++;
          }
        } catch (error) {
          policiesFailed++;
          errors.push({
            clusterId: cluster.id,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      // Update sync operation with results
      const finalStatus =
        policiesFailed === 0
          ? "COMPLETED"
          : policiesFailed === clusterIds.length
            ? "FAILED"
            : "COMPLETED_WITH_ERRORS";

      await ctx.db.templateSyncOperation.update({
        where: { id: syncOp.id },
        data: {
          status: finalStatus,
          policiesCreated,
          policiesUpdated,
          policiesFailed,
          errorDetails: errors.length > 0 ? errors : undefined,
          completedAt: new Date(),
        },
      });

      return {
        syncOperationId: syncOp.id,
        status: finalStatus,
        policiesCreated,
        policiesUpdated,
        policiesFailed,
        errors,
      };
    }),

  // Get sync history for a template
  getSyncHistory: protectedProcedure
    .input(
      z.object({
        templateId: z.string(),
        limit: z.number().min(1).max(50).default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      // Verify template exists and belongs to organization
      const template = await ctx.db.policyTemplate.findFirst({
        where: {
          id: input.templateId,
          organizationId: ctx.organizationId,
        },
      });

      if (!template) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Template not found",
        });
      }

      const operations = await ctx.db.templateSyncOperation.findMany({
        where: { templateId: input.templateId },
        orderBy: { createdAt: "desc" },
        take: input.limit,
        include: {
          triggeredBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      return operations;
    }),

  // Create template from existing policy
  createFromPolicy: protectedProcedure
    .input(
      z.object({
        policyId: z.string(),
        name: z
          .string()
          .min(1)
          .max(63)
          .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/)
          .optional(),
        description: z.string().max(5000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Get the source policy
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

      const templateName = input.name ?? policy.name;

      // Check for duplicate template name
      const existing = await ctx.db.policyTemplate.findUnique({
        where: {
          organizationId_name: {
            organizationId: ctx.organizationId,
            name: templateName,
          },
        },
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A template with this name already exists",
        });
      }

      // Create the template
      const template = await ctx.db.policyTemplate.create({
        data: {
          name: templateName,
          description: input.description ?? policy.description,
          type: policy.type,
          content: policy.content,
          defaultTargetNamespaces: policy.targetNamespaces,
          defaultTargetLabels: policy.targetLabels ?? undefined,
          currentVersion: 1,
          organizationId: ctx.organizationId,
          createdById: ctx.userId,
        },
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      // Create initial version
      await ctx.db.policyTemplateVersion.create({
        data: {
          templateId: template.id,
          version: 1,
          content: policy.content,
          changelog: `Created from policy "${policy.name}"`,
        },
      });

      // Optionally link the source policy to this template
      await ctx.db.policy.update({
        where: { id: policy.id },
        data: {
          templateId: template.id,
          syncedFromVersion: 1,
        },
      });

      return template;
    }),

  // Get stats for dashboard
  getStats: protectedProcedure.query(async ({ ctx }) => {
    const [total, byType, recentSyncs] = await Promise.all([
      ctx.db.policyTemplate.count({
        where: { organizationId: ctx.organizationId },
      }),
      ctx.db.policyTemplate.groupBy({
        by: ["type"],
        where: { organizationId: ctx.organizationId },
        _count: true,
      }),
      ctx.db.templateSyncOperation.count({
        where: {
          template: { organizationId: ctx.organizationId },
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
          },
        },
      }),
    ]);

    // Count total policies linked to templates
    const linkedPolicies = await ctx.db.policy.count({
      where: {
        organizationId: ctx.organizationId,
        templateId: { not: null },
      },
    });

    return {
      total,
      linkedPolicies,
      recentSyncs,
      byType: byType.reduce(
        (acc, item) => {
          acc[item.type] = item._count;
          return acc;
        },
        {} as Record<string, number>
      ),
    };
  }),
});
