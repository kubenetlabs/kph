import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
import { createTRPCRouter, orgProtectedProcedure } from "../trpc";
import yaml from "js-yaml";

const protectedProcedure = orgProtectedProcedure;

// Enum schemas matching Prisma
const GatewayAPIKindSchema = z.enum([
  "HTTPRoute",
  "GRPCRoute",
  "TCPRoute",
  "TLSRoute",
  "Gateway",
  "ReferenceGrant",
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
const listGatewayAPISchema = z.object({
  clusterId: z.string(),
  kind: GatewayAPIKindSchema.optional(),
  namespace: z.string().optional(),
  status: PolicyStatusSchema.optional(),
  search: z.string().optional(),
  limit: z.number().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const createGatewayAPISchema = z.object({
  clusterId: z.string(),
  kind: GatewayAPIKindSchema,
  yaml: z.string().min(1, "YAML content is required"),
});

const updateGatewayAPISchema = z.object({
  id: z.string(),
  yaml: z.string().min(1, "YAML content is required"),
});

// Helper to parse Gateway API YAML and extract metadata
interface ParsedGatewayAPIResource {
  name: string;
  namespace: string;
  kind: string;
  parentRefs: Prisma.InputJsonValue;
  hostnames: Prisma.InputJsonValue | null;
  rules: Prisma.InputJsonValue;
  labels: Prisma.InputJsonValue | null;
  annotations: Prisma.InputJsonValue | null;
}

function parseGatewayAPIYaml(yamlContent: string, expectedKind: string): ParsedGatewayAPIResource {
  const doc = yaml.load(yamlContent) as Record<string, unknown>;

  if (!doc || typeof doc !== "object") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid YAML: expected an object",
    });
  }

  const kind = doc.kind as string;
  if (!kind) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid YAML: missing 'kind' field",
    });
  }

  if (kind !== expectedKind) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Kind mismatch: expected ${expectedKind}, got ${kind}`,
    });
  }

  const metadata = doc.metadata as Record<string, unknown> | undefined;
  if (!metadata || typeof metadata !== "object") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid YAML: missing 'metadata' field",
    });
  }

  const name = metadata.name as string;
  const namespace = (metadata.namespace as string) || "default";

  if (!name) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid YAML: missing 'metadata.name' field",
    });
  }

  const spec = doc.spec as Record<string, unknown> | undefined;

  // Extract Gateway API specific fields
  let parentRefs: Prisma.InputJsonValue = [];
  let hostnames: Prisma.InputJsonValue | null = null;
  let rules: Prisma.InputJsonValue = [];

  if (spec) {
    // Routes have parentRefs
    if (Array.isArray(spec.parentRefs)) {
      parentRefs = spec.parentRefs as Prisma.InputJsonValue;
    }

    // HTTPRoute, GRPCRoute, TLSRoute have hostnames
    if (Array.isArray(spec.hostnames)) {
      hostnames = spec.hostnames as Prisma.InputJsonValue;
    }

    // Routes have rules
    if (Array.isArray(spec.rules)) {
      rules = spec.rules as Prisma.InputJsonValue;
    }

    // Gateway has listeners instead of rules
    if (Array.isArray(spec.listeners)) {
      rules = spec.listeners as Prisma.InputJsonValue;
    }
  }

  return {
    name,
    namespace,
    kind,
    parentRefs,
    hostnames,
    rules,
    labels: metadata.labels ? (metadata.labels as Prisma.InputJsonValue) : null,
    annotations: metadata.annotations ? (metadata.annotations as Prisma.InputJsonValue) : null,
  };
}

export const gatewayApiRouter = createTRPCRouter({
  // List Gateway API resources with filtering
  list: protectedProcedure
    .input(listGatewayAPISchema)
    .query(async ({ ctx, input }) => {
      const { clusterId, kind, namespace, status, search, limit, cursor } = input;

      // Verify cluster belongs to organization
      const cluster = await ctx.db.cluster.findFirst({
        where: {
          id: clusterId,
          organizationId: ctx.organizationId,
        },
      });

      if (!cluster) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Cluster not found",
        });
      }

      const where = {
        clusterId,
        ...(kind && { kind }),
        ...(namespace && { namespace }),
        ...(status && { status }),
        ...(search && {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { namespace: { contains: search, mode: "insensitive" as const } },
          ],
        }),
      };

      const resources = await ctx.db.gatewayAPIPolicy.findMany({
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
        },
      });

      let nextCursor: string | undefined = undefined;
      if (resources.length > limit) {
        const nextItem = resources.pop();
        nextCursor = nextItem?.id;
      }

      return {
        resources,
        nextCursor,
      };
    }),

  // Get single Gateway API resource by ID
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const resource = await ctx.db.gatewayAPIPolicy.findFirst({
        where: {
          id: input.id,
          cluster: {
            organizationId: ctx.organizationId,
          },
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
        },
      });

      if (!resource) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Gateway API resource not found",
        });
      }

      return resource;
    }),

  // Create a new Gateway API resource
  create: protectedProcedure
    .input(createGatewayAPISchema)
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

      // Parse YAML to extract metadata
      const parsed = parseGatewayAPIYaml(input.yaml, input.kind);

      // Check for duplicate
      const existing = await ctx.db.gatewayAPIPolicy.findUnique({
        where: {
          clusterId_kind_namespace_name: {
            clusterId: input.clusterId,
            kind: input.kind,
            namespace: parsed.namespace,
            name: parsed.name,
          },
        },
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `A ${input.kind} named '${parsed.name}' already exists in namespace '${parsed.namespace}'`,
        });
      }

      const resource = await ctx.db.gatewayAPIPolicy.create({
        data: {
          clusterId: input.clusterId,
          kind: input.kind,
          name: parsed.name,
          namespace: parsed.namespace,
          yamlContent: input.yaml,
          parentRefs: parsed.parentRefs,
          hostnames: parsed.hostnames ?? Prisma.JsonNull,
          rules: parsed.rules,
          labels: parsed.labels ?? Prisma.JsonNull,
          annotations: parsed.annotations ?? Prisma.JsonNull,
          status: "DRAFT",
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

      return resource;
    }),

  // Update a Gateway API resource
  update: protectedProcedure
    .input(updateGatewayAPISchema)
    .mutation(async ({ ctx, input }) => {
      // Verify resource exists and belongs to organization
      const existing = await ctx.db.gatewayAPIPolicy.findFirst({
        where: {
          id: input.id,
          cluster: {
            organizationId: ctx.organizationId,
          },
        },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Gateway API resource not found",
        });
      }

      // Parse YAML to extract updated metadata
      const parsed = parseGatewayAPIYaml(input.yaml, existing.kind);

      // If name or namespace changed, check for conflicts
      if (parsed.name !== existing.name || parsed.namespace !== existing.namespace) {
        const duplicate = await ctx.db.gatewayAPIPolicy.findUnique({
          where: {
            clusterId_kind_namespace_name: {
              clusterId: existing.clusterId,
              kind: existing.kind,
              namespace: parsed.namespace,
              name: parsed.name,
            },
          },
        });

        if (duplicate && duplicate.id !== existing.id) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `A ${existing.kind} named '${parsed.name}' already exists in namespace '${parsed.namespace}'`,
          });
        }
      }

      const resource = await ctx.db.gatewayAPIPolicy.update({
        where: { id: input.id },
        data: {
          name: parsed.name,
          namespace: parsed.namespace,
          yamlContent: input.yaml,
          parentRefs: parsed.parentRefs,
          hostnames: parsed.hostnames ?? Prisma.JsonNull,
          rules: parsed.rules,
          labels: parsed.labels ?? Prisma.JsonNull,
          annotations: parsed.annotations ?? Prisma.JsonNull,
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

      return resource;
    }),

  // Delete a Gateway API resource
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Verify resource exists and belongs to organization
      const existing = await ctx.db.gatewayAPIPolicy.findFirst({
        where: {
          id: input.id,
          cluster: {
            organizationId: ctx.organizationId,
          },
        },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Gateway API resource not found",
        });
      }

      // Don't allow deletion of deployed resources
      if (existing.status === "DEPLOYED") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Cannot delete a deployed resource. Archive it first.",
        });
      }

      await ctx.db.gatewayAPIPolicy.delete({
        where: { id: input.id },
      });

      return { success: true };
    }),

  // Get stats for a cluster
  getStats: protectedProcedure
    .input(z.object({ clusterId: z.string() }))
    .query(async ({ ctx, input }) => {
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

      const [total, byKind, byStatus] = await Promise.all([
        ctx.db.gatewayAPIPolicy.count({
          where: { clusterId: input.clusterId },
        }),
        ctx.db.gatewayAPIPolicy.groupBy({
          by: ["kind"],
          where: { clusterId: input.clusterId },
          _count: true,
        }),
        ctx.db.gatewayAPIPolicy.groupBy({
          by: ["status"],
          where: { clusterId: input.clusterId },
          _count: true,
        }),
      ]);

      return {
        total,
        byKind: byKind.reduce(
          (acc, item) => {
            acc[item.kind] = item._count;
            return acc;
          },
          {} as Record<string, number>
        ),
        byStatus: byStatus.reduce(
          (acc, item) => {
            acc[item.status] = item._count;
            return acc;
          },
          {} as Record<string, number>
        ),
      };
    }),

  // Deploy a Gateway API resource
  deploy: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.gatewayAPIPolicy.findFirst({
        where: {
          id: input.id,
          cluster: {
            organizationId: ctx.organizationId,
          },
        },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Gateway API resource not found",
        });
      }

      if (existing.status === "DEPLOYED") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Resource is already deployed",
        });
      }

      const resource = await ctx.db.gatewayAPIPolicy.update({
        where: { id: input.id },
        data: {
          status: "PENDING",
        },
      });

      return resource;
    }),

  // Archive a Gateway API resource
  archive: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.gatewayAPIPolicy.findFirst({
        where: {
          id: input.id,
          cluster: {
            organizationId: ctx.organizationId,
          },
        },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Gateway API resource not found",
        });
      }

      const resource = await ctx.db.gatewayAPIPolicy.update({
        where: { id: input.id },
        data: {
          status: "ARCHIVED",
        },
      });

      return resource;
    }),

  // Simulate Gateway API resources (for what-if analysis)
  simulate: protectedProcedure
    .input(
      z.object({
        clusterId: z.string(),
        resources: z.array(
          z.object({
            kind: GatewayAPIKindSchema,
            yaml: z.string(),
          })
        ),
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

      // Parse all resources to validate them
      const parsedResources = input.resources.map((r) => ({
        ...parseGatewayAPIYaml(r.yaml, r.kind),
        yamlContent: r.yaml,
      }));

      // Validate Gateway references
      const gateways = parsedResources.filter((r) => r.kind === "Gateway");
      const routes = parsedResources.filter((r) => r.kind !== "Gateway" && r.kind !== "ReferenceGrant");

      const warnings: string[] = [];

      // Check if routes reference existing or proposed gateways
      for (const route of routes) {
        for (const parentRef of route.parentRefs as Array<{ name: string; namespace?: string }>) {
          const gatewayName = parentRef.name;
          const gatewayNamespace = parentRef.namespace ?? route.namespace;

          const gatewayExists =
            gateways.some((g) => g.name === gatewayName && g.namespace === gatewayNamespace) ||
            (await ctx.db.gatewayAPIPolicy.findFirst({
              where: {
                clusterId: input.clusterId,
                kind: "Gateway",
                name: gatewayName,
                namespace: gatewayNamespace,
              },
            }));

          if (!gatewayExists) {
            warnings.push(
              `${route.kind} '${route.namespace}/${route.name}' references Gateway '${gatewayNamespace}/${gatewayName}' which does not exist`
            );
          }
        }
      }

      return {
        valid: warnings.length === 0,
        resources: parsedResources.map((r) => ({
          kind: r.kind,
          name: r.name,
          namespace: r.namespace,
          parentRefs: r.parentRefs,
          hostnames: r.hostnames,
          rules: r.rules,
        })),
        warnings,
      };
    }),
});
