import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, orgProtectedProcedure } from "../trpc";
import {
  isGatewayAPIType,
  validateGatewayAPIPolicy,
} from "~/lib/gateway-api-validator";

// Use orgProtectedProcedure for all policy operations (requires organization)
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

const PolicyStatusSchema = z.enum([
  "DRAFT",
  "SIMULATING",
  "PENDING",
  "DEPLOYED",
  "FAILED",
  "ARCHIVED",
]);

// Input schemas
const createPolicySchema = z.object({
  name: z
    .string()
    .min(1, "Policy name is required")
    .max(63, "Policy name must be 63 characters or less")
    .regex(
      /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/,
      "Policy name must start and end with alphanumeric characters and can only contain lowercase letters, numbers, and hyphens"
    ),
  description: z.string().max(5000).optional(),
  type: PolicyTypeSchema,
  content: z.string().min(1, "Policy content is required"),
  clusterId: z.string().min(1, "Cluster is required"),
  targetNamespaces: z.array(z.string()).default([]),
  targetLabels: z.record(z.string()).optional(),
  generatedFrom: z.string().optional(),
  generatedModel: z.string().optional(),
});

const updatePolicySchema = z.object({
  id: z.string(),
  name: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/)
    .optional(),
  description: z.string().max(5000).optional(),
  type: PolicyTypeSchema.optional(),
  status: PolicyStatusSchema.optional(),
  content: z.string().min(1).optional(),
  targetNamespaces: z.array(z.string()).optional(),
  targetLabels: z.record(z.string()).optional(),
});

const listPoliciesSchema = z.object({
  clusterId: z.string().optional(),
  type: PolicyTypeSchema.optional(),
  status: PolicyStatusSchema.optional(),
  search: z.string().optional(),
  limit: z.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export const policyRouter = createTRPCRouter({
  // List policies with filtering and pagination
  list: protectedProcedure
    .input(listPoliciesSchema)
    .query(async ({ ctx, input }) => {
      const { clusterId, type, status, search, limit, cursor } = input;

      const where = {
        organizationId: ctx.organizationId,
        ...(clusterId && { clusterId }),
        ...(type && { type }),
        ...(status && { status }),
        ...(search && {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { description: { contains: search, mode: "insensitive" as const } },
          ],
        }),
      };

      const policies = await ctx.db.policy.findMany({
        where,
        take: limit + 1,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
        orderBy: { createdAt: "desc" },
        include: {
          cluster: {
            select: {
              id: true,
              name: true,
              provider: true,
              environment: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          _count: {
            select: {
              versions: true,
              simulations: true,
            },
          },
        },
      });

      let nextCursor: string | undefined = undefined;
      if (policies.length > limit) {
        const nextItem = policies.pop();
        nextCursor = nextItem?.id;
      }

      return {
        policies,
        nextCursor,
      };
    }),

  // Get single policy by ID
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const policy = await ctx.db.policy.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.organizationId,
        },
        include: {
          cluster: {
            select: {
              id: true,
              name: true,
              provider: true,
              region: true,
              environment: true,
            },
          },
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
          simulations: {
            orderBy: { createdAt: "desc" },
            take: 5,
            select: {
              id: true,
              name: true,
              status: true,
              flowsAnalyzed: true,
              flowsAllowed: true,
              flowsDenied: true,
              createdAt: true,
              completedAt: true,
            },
          },
        },
      });

      if (!policy) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Policy not found",
        });
      }

      return policy;
    }),

  // Create a new policy
  create: protectedProcedure
    .input(createPolicySchema)
    .mutation(async ({ ctx, input }) => {
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

      // Check for duplicate name in cluster
      const existing = await ctx.db.policy.findUnique({
        where: {
          clusterId_name: {
            clusterId: input.clusterId,
            name: input.name,
          },
        },
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A policy with this name already exists in this cluster",
        });
      }

      // Validate Gateway API YAML if applicable
      if (isGatewayAPIType(input.type)) {
        // This will throw a TRPCError with BAD_REQUEST if validation fails
        validateGatewayAPIPolicy(input.content, input.type);
      }

      const policy = await ctx.db.policy.create({
        data: {
          name: input.name,
          description: input.description,
          type: input.type,
          content: input.content,
          targetNamespaces: input.targetNamespaces,
          targetLabels: input.targetLabels,
          generatedFrom: input.generatedFrom,
          generatedModel: input.generatedModel,
          status: "DRAFT",
          organizationId: ctx.organizationId,
          clusterId: input.clusterId,
          createdById: ctx.userId,
        },
        include: {
          cluster: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      // Create initial version
      await ctx.db.policyVersion.create({
        data: {
          policyId: policy.id,
          version: 1,
          content: input.content,
          changelog: "Initial version",
        },
      });

      return policy;
    }),

  // Update a policy
  update: protectedProcedure
    .input(updatePolicySchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      // Verify policy exists and belongs to organization
      const existing = await ctx.db.policy.findFirst({
        where: {
          id,
          organizationId: ctx.organizationId,
        },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Policy not found",
        });
      }

      // If name is changing, check for duplicates
      if (data.name && data.name !== existing.name) {
        const duplicate = await ctx.db.policy.findUnique({
          where: {
            clusterId_name: {
              clusterId: existing.clusterId,
              name: data.name,
            },
          },
        });

        if (duplicate) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A policy with this name already exists in this cluster",
          });
        }
      }

      // If content is changing, validate and create a new version
      if (data.content && data.content !== existing.content) {
        // Determine the policy type (use updated type if provided, otherwise existing)
        const policyType = data.type ?? existing.type;

        // Validate Gateway API YAML if applicable
        if (isGatewayAPIType(policyType)) {
          // This will throw a TRPCError with BAD_REQUEST if validation fails
          validateGatewayAPIPolicy(data.content, policyType);
        }

        const latestVersion = await ctx.db.policyVersion.findFirst({
          where: { policyId: id },
          orderBy: { version: "desc" },
        });

        await ctx.db.policyVersion.create({
          data: {
            policyId: id,
            version: (latestVersion?.version ?? 0) + 1,
            content: data.content,
            changelog: "Updated policy content",
          },
        });
      }

      const policy = await ctx.db.policy.update({
        where: { id },
        data,
        include: {
          cluster: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      return policy;
    }),

  // Delete a policy
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Verify policy exists and belongs to organization
      const existing = await ctx.db.policy.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.organizationId,
        },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Policy not found",
        });
      }

      // Don't allow deletion of deployed policies
      if (existing.status === "DEPLOYED") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Cannot delete a deployed policy. Archive it first.",
        });
      }

      await ctx.db.policy.delete({
        where: { id: input.id },
      });

      return { success: true };
    }),

  // Get policy stats for dashboard
  getStats: protectedProcedure.query(async ({ ctx }) => {
    const [total, deployed, simulating, drafts, byType] = await Promise.all([
      ctx.db.policy.count({
        where: { organizationId: ctx.organizationId },
      }),
      ctx.db.policy.count({
        where: { organizationId: ctx.organizationId, status: "DEPLOYED" },
      }),
      ctx.db.policy.count({
        where: { organizationId: ctx.organizationId, status: "SIMULATING" },
      }),
      ctx.db.policy.count({
        where: { organizationId: ctx.organizationId, status: "DRAFT" },
      }),
      ctx.db.policy.groupBy({
        by: ["type"],
        where: { organizationId: ctx.organizationId },
        _count: true,
      }),
    ]);

    return {
      total,
      deployed,
      simulating,
      drafts,
      byType: byType.reduce(
        (acc, item) => {
          acc[item.type] = item._count;
          return acc;
        },
        {} as Record<string, number>
      ),
    };
  }),

  // Deploy a policy (update status)
  deploy: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.policy.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.organizationId,
        },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Policy not found",
        });
      }

      if (existing.status === "DEPLOYED") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Policy is already deployed",
        });
      }

      const latestVersion = await ctx.db.policyVersion.findFirst({
        where: { policyId: input.id },
        orderBy: { version: "desc" },
      });

      const policy = await ctx.db.policy.update({
        where: { id: input.id },
        data: {
          status: "DEPLOYED",
          deployedAt: new Date(),
          deployedVersion: latestVersion?.version ?? 1,
        },
      });

      return policy;
    }),

  // Archive a policy
  archive: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.policy.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.organizationId,
        },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Policy not found",
        });
      }

      const policy = await ctx.db.policy.update({
        where: { id: input.id },
        data: {
          status: "ARCHIVED",
        },
      });

      return policy;
    }),

  // Get validation status for Gateway API policies
  // Returns policies with type GATEWAY_* and their validation status
  getGatewayValidationStatus: protectedProcedure
    .input(z.object({ clusterId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Verify cluster belongs to organization
      const cluster = await ctx.db.cluster.findFirst({
        where: {
          id: input.clusterId,
          organizationId: ctx.organizationId,
        },
        select: {
          id: true,
          name: true,
        },
      });

      if (!cluster) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Cluster not found",
        });
      }

      // Get Gateway API resources from the Policy table (type starts with GATEWAY_)
      const policies = await ctx.db.policy.findMany({
        where: {
          clusterId: input.clusterId,
          type: {
            in: ["GATEWAY_HTTPROUTE", "GATEWAY_GRPCROUTE", "GATEWAY_TCPROUTE", "GATEWAY_TLSROUTE"],
          },
        },
        select: {
          id: true,
          name: true,
          type: true,
          status: true,
          content: true,
          targetNamespaces: true,
          deployedAt: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
      });

      // Map policy types to Gateway API kinds
      const typeToKind: Record<string, string> = {
        GATEWAY_HTTPROUTE: "HTTPRoute",
        GATEWAY_GRPCROUTE: "GRPCRoute",
        GATEWAY_TCPROUTE: "TCPRoute",
        GATEWAY_TLSROUTE: "TLSRoute",
      };

      // Transform to validation results format
      const validationResults = policies.map((policy) => {
        // Parse the YAML to extract namespace (default to first target namespace or "default")
        const namespace = policy.targetNamespaces[0] ?? "default";

        // For now, mark deployed policies as valid, others as pending validation
        const isDeployed = policy.status === "DEPLOYED";

        return {
          id: policy.id,
          kind: typeToKind[policy.type] ?? policy.type,
          name: policy.name,
          namespace: namespace,
          deploymentStatus: policy.status,
          syncedAt: policy.deployedAt,
          validation: isDeployed
            ? {
                valid: true,
                errors: [] as string[],
                warnings: [] as string[],
                validatedAt: policy.deployedAt?.toISOString() ?? policy.updatedAt.toISOString(),
              }
            : null,
        };
      });

      // Calculate summary stats
      const total = validationResults.length;
      const validated = validationResults.filter((r) => r.validation !== null).length;
      const valid = validationResults.filter((r) => r.validation?.valid === true).length;
      const invalid = validationResults.filter((r) => r.validation?.valid === false).length;
      const pending = validationResults.filter((r) => r.validation === null).length;

      return {
        cluster,
        summary: {
          total,
          validated,
          valid,
          invalid,
          pending,
        },
        resources: validationResults,
      };
    }),
});
