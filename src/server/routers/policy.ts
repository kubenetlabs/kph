import { z } from "zod";
import { TRPCError } from "@trpc/server";
import yaml from "js-yaml";
import { createTRPCRouter, orgProtectedProcedure } from "../trpc";
import {
  isGatewayAPIType,
  validateGatewayAPIPolicy,
  validatePolicyTypeMatchesYaml,
  KIND_TO_POLICY_TYPE,
  GATEWAY_API_KINDS,
} from "~/lib/gateway-api-validator";
import { validatePolicy, type PolicyType as ValidatorPolicyType } from "~/lib/policy-validator";

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
  "UNDEPLOYING",
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

      // Validate policy content (YAML syntax + schema validation)
      const validation = validatePolicy(input.content, input.type as ValidatorPolicyType);
      if (!validation.valid) {
        const errorMessages = validation.errors.map((e) => e.message).join("; ");
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invalid policy YAML: ${errorMessages}`,
        });
      }

      // Bidirectional validation: ensure YAML kind matches declared policy type
      validatePolicyTypeMatchesYaml(input.content, input.type);

      // Additional Gateway API validation (more detailed schema checks)
      if (isGatewayAPIType(input.type)) {
        // This will throw a TRPCError with BAD_REQUEST if validation fails
        validateGatewayAPIPolicy(input.content, input.type);
      }

      // Create policy and initial version in a transaction
      const policy = await ctx.db.$transaction(async (tx) => {
        const newPolicy = await tx.policy.create({
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
        await tx.policyVersion.create({
          data: {
            policyId: newPolicy.id,
            version: 1,
            content: input.content,
            changelog: "Initial version",
          },
        });

        return newPolicy;
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

        // Validate policy content (YAML syntax + schema validation)
        const validation = validatePolicy(data.content, policyType as ValidatorPolicyType);
        if (!validation.valid) {
          const errorMessages = validation.errors.map((e) => e.message).join("; ");
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid policy YAML: ${errorMessages}`,
          });
        }

        // Bidirectional validation: ensure YAML kind matches declared policy type
        validatePolicyTypeMatchesYaml(data.content, policyType);

        // Additional Gateway API validation (more detailed schema checks)
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

  // Get policy stats for dashboard (optimized: 2 queries instead of 5)
  getStats: protectedProcedure.query(async ({ ctx }) => {
    const [statusCounts, typeCounts] = await Promise.all([
      ctx.db.policy.groupBy({
        by: ["status"],
        where: { organizationId: ctx.organizationId },
        _count: { _all: true },
      }),
      ctx.db.policy.groupBy({
        by: ["type"],
        where: { organizationId: ctx.organizationId },
        _count: { _all: true },
      }),
    ]);

    // Calculate totals from status groupBy
    const total = statusCounts.reduce((sum, s) => sum + s._count._all, 0);
    const deployed = statusCounts.find((s) => s.status === "DEPLOYED")?._count._all ?? 0;
    const simulating = statusCounts.find((s) => s.status === "SIMULATING")?._count._all ?? 0;
    const drafts = statusCounts.find((s) => s.status === "DRAFT")?._count._all ?? 0;

    return {
      total,
      deployed,
      simulating,
      drafts,
      byType: typeCounts.reduce(
        (acc, item) => {
          acc[item.type] = item._count._all;
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

  // Undeploy a policy (remove from cluster, keep in SaaS as DRAFT)
  undeploy: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Verify policy exists and belongs to org
      const existing = await ctx.db.policy.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.organizationId,
        },
        include: {
          versions: {
            orderBy: { version: "desc" },
            take: 1,
          },
        },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Policy not found",
        });
      }

      // Verify policy is currently deployed
      if (existing.status !== "DEPLOYED") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Policy is not deployed",
        });
      }

      // Get latest version for deployment record
      const latestVersion = existing.versions[0];
      if (!latestVersion) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "No policy version found",
        });
      }

      // Update policy status to UNDEPLOYING and create deployment record
      const [policy, deployment] = await ctx.db.$transaction([
        ctx.db.policy.update({
          where: { id: input.id },
          data: {
            status: "UNDEPLOYING",
          },
        }),
        ctx.db.policyDeployment.create({
          data: {
            policyId: input.id,
            versionId: latestVersion.id,
            clusterId: existing.clusterId,
            status: "UNDEPLOYING",
            deployedById: ctx.userId,
          },
        }),
      ]);

      return { policy, deploymentId: deployment.id };
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

  // Parse YAML to discover Gateway API resources for import
  parseGatewayYaml: protectedProcedure
    .input(z.object({ yamlContent: z.string() }))
    .mutation(async ({ input }) => {
      const { yamlContent } = input;

      // Split multi-document YAML
      const documents = yamlContent.split(/^---$/m).filter((doc) => doc.trim());

      interface DiscoveredResource {
        name: string;
        namespace: string;
        kind: string;
        policyType: string;
        hostnames: string[];
        yaml: string;
        valid: boolean;
        error?: string;
      }

      const discovered: DiscoveredResource[] = [];

      for (const doc of documents) {
        try {
          const parsed = yaml.load(doc.trim()) as Record<string, unknown>;
          if (!parsed || typeof parsed !== "object") continue;

          const kind = parsed.kind as string;
          const apiVersion = parsed.apiVersion as string;

          // Check if it's a Gateway API resource
          if (!apiVersion?.includes("gateway.networking.k8s.io")) continue;
          if (!GATEWAY_API_KINDS.includes(kind as typeof GATEWAY_API_KINDS[number])) continue;

          const metadata = parsed.metadata as Record<string, unknown> | undefined;
          const spec = parsed.spec as Record<string, unknown> | undefined;

          const name = (metadata?.name as string) ?? "unknown";
          const namespace = (metadata?.namespace as string) ?? "default";
          const hostnames = (spec?.hostnames as string[]) ?? [];
          const policyType = KIND_TO_POLICY_TYPE[kind as keyof typeof KIND_TO_POLICY_TYPE];

          if (!policyType) continue;

          // Clean up the YAML - remove status, managedFields, etc.
          const cleanedParsed = {
            apiVersion: parsed.apiVersion,
            kind: parsed.kind,
            metadata: {
              name: metadata?.name,
              namespace: metadata?.namespace,
              labels: metadata?.labels,
              annotations: metadata?.annotations,
            },
            spec: parsed.spec,
          };

          // Remove undefined values
          if (!cleanedParsed.metadata.labels) delete (cleanedParsed.metadata as Record<string, unknown>).labels;
          if (!cleanedParsed.metadata.annotations) delete (cleanedParsed.metadata as Record<string, unknown>).annotations;

          const cleanedYaml = yaml.dump(cleanedParsed, { indent: 2, lineWidth: -1 });

          discovered.push({
            name,
            namespace,
            kind,
            policyType,
            hostnames,
            yaml: cleanedYaml,
            valid: true,
          });
        } catch (e) {
          // Skip invalid YAML documents
          continue;
        }
      }

      return { discovered };
    }),

  // Import a Gateway API resource as a policy
  importGatewayResource: protectedProcedure
    .input(
      z.object({
        clusterId: z.string(),
        name: z.string(),
        namespace: z.string(),
        policyType: z.string(),
        yamlContent: z.string(),
        description: z.string().optional(),
      })
    )
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
          message: `Policy "${input.name}" already exists in this cluster`,
        });
      }

      // Validate the YAML
      if (isGatewayAPIType(input.policyType)) {
        validateGatewayAPIPolicy(input.yamlContent, input.policyType);
      }

      // Create policy and initial version in a transaction
      const policy = await ctx.db.$transaction(async (tx) => {
        const newPolicy = await tx.policy.create({
          data: {
            name: input.name,
            description: input.description ?? `Imported ${input.policyType.replace("GATEWAY_", "")} from cluster`,
            type: input.policyType as "GATEWAY_HTTPROUTE" | "GATEWAY_GRPCROUTE" | "GATEWAY_TCPROUTE" | "GATEWAY_TLSROUTE",
            content: input.yamlContent,
            targetNamespaces: [input.namespace],
            status: "DEPLOYED", // Already deployed in cluster
            deployedAt: new Date(),
            organizationId: ctx.organizationId,
            clusterId: input.clusterId,
            createdById: ctx.userId,
          },
        });

        // Create initial version
        await tx.policyVersion.create({
          data: {
            policyId: newPolicy.id,
            version: 1,
            content: input.yamlContent,
            changelog: "Imported from cluster",
          },
        });

        return newPolicy;
      });

      return policy;
    }),
});
