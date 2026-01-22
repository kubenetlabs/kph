/**
 * Token Management Router
 *
 * Handles creation, listing, and revocation of API tokens.
 * Supports both cluster-scoped agent tokens and org-wide API tokens.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, orgProtectedProcedure } from "../trpc";
import { hasMinRole, logAudit } from "~/lib/permissions";
import {
  generateAgentToken,
  generateApiToken,
  hashToken,
  maskToken,
  getExpiryStatus,
  isTokenExpired,
} from "~/lib/tokens";

// Token scopes available for different token types
const AGENT_SCOPES = ["cluster:read", "cluster:write", "policy:read", "policy:write", "flow:write"] as const;
const API_SCOPES = ["policy:read", "policy:write", "cluster:read", "simulation:read", "simulation:write"] as const;

export const tokenRouter = createTRPCRouter({
  /**
   * Create a new token
   */
  create: orgProtectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        type: z.enum(["AGENT", "REGISTRATION", "API"]),
        clusterId: z.string().optional(),
        scopes: z.array(z.string()).optional(),
        expiryDays: z.number().min(0).max(365).default(365),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Permission check based on token type
      const requiredRole = input.type === "API" ? "ORG_ADMIN" : "CLUSTER_ADMIN";
      if (!ctx.user?.isSuperAdmin && !hasMinRole(ctx.user?.newRole ?? "VIEWER", requiredRole)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Only ${requiredRole.replace("_", " ")}s can create ${input.type} tokens`,
        });
      }

      // Validate cluster access for agent tokens
      if (input.type === "AGENT" && input.clusterId) {
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
      }

      // Generate the token
      const tokenData =
        input.type === "API"
          ? generateApiToken(input.expiryDays)
          : generateAgentToken(input.type, input.expiryDays);

      // Determine scopes
      const scopes =
        input.scopes ?? (input.type === "API" ? [...API_SCOPES] : [...AGENT_SCOPES]);

      // Create the token record
      const token = await ctx.db.apiToken.create({
        data: {
          name: input.name,
          type: input.type,
          tokenHash: tokenData.tokenHash,
          prefix: tokenData.tokenPrefix,
          scopes: scopes,
          status: "ACTIVE",
          expiresAt: tokenData.expiresAt,
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

      // Log audit event
      await logAudit(
        {
          user: { id: ctx.userId, email: ctx.user?.email ?? "" },
          organizationId: ctx.organizationId ?? undefined,
        },
        "token.created",
        {
          tokenId: token.id,
          tokenType: input.type,
          tokenName: input.name,
          clusterId: input.clusterId,
          scopes,
        }
      );

      // Return the full token (ONLY returned once, never stored)
      return {
        id: token.id,
        name: token.name,
        type: token.type,
        token: tokenData.token, // The actual token - shown once!
        prefix: token.prefix,
        scopes: token.scopes,
        expiresAt: token.expiresAt,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        cluster: token.cluster,
        createdAt: token.createdAt,
      };
    }),

  /**
   * List tokens for the organization
   */
  list: orgProtectedProcedure
    .input(
      z.object({
        type: z.enum(["AGENT", "REGISTRATION", "API", "all"]).default("all"),
        clusterId: z.string().optional(),
        status: z.enum(["ACTIVE", "REVOKED", "EXPIRED", "all"]).default("all"),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Check permission (at least CLUSTER_ADMIN to view tokens)
      if (!ctx.user?.isSuperAdmin && !hasMinRole(ctx.user?.newRole ?? "VIEWER", "CLUSTER_ADMIN")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only Cluster Admins can view tokens",
        });
      }

      const now = new Date();

      const whereClause = {
        organizationId: ctx.organizationId,
        ...(input.type !== "all" && { type: input.type }),
        ...(input.clusterId && { clusterId: input.clusterId }),
        ...(input.status === "ACTIVE" && {
          status: "ACTIVE",
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        }),
        ...(input.status === "REVOKED" && { status: "REVOKED" }),
        ...(input.status === "EXPIRED" && {
          status: "ACTIVE",
          expiresAt: { lte: now },
        }),
      };

      const tokens = await ctx.db.apiToken.findMany({
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        where: whereClause,
        orderBy: { createdAt: "desc" },
        include: {
          cluster: {
            select: {
              id: true,
              name: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      let nextCursor: string | undefined;
      if (tokens.length > input.limit) {
        const nextItem = tokens.pop();
        nextCursor = nextItem?.id;
      }

      return {
        tokens: tokens.map((t) => ({
          id: t.id,
          name: t.name,
          type: t.type,
          prefix: t.prefix,
          maskedToken: maskToken(t.prefix + "..."),
          scopes: t.scopes,
          status:
            t.status === "REVOKED"
              ? "REVOKED"
              : t.expiresAt && t.expiresAt < now
                ? "EXPIRED"
                : "ACTIVE",
          expiresAt: t.expiresAt,
          expiryStatus: getExpiryStatus(t.expiresAt),
          lastUsedAt: t.lastUsedAt,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          cluster: t.cluster,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          createdBy: t.createdBy,
          createdAt: t.createdAt,
        })),
        nextCursor,
      };
    }),

  /**
   * Get token details by ID
   */
  getById: orgProtectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const token = await ctx.db.apiToken.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.organizationId,
        },
        include: {
          cluster: {
            select: {
              id: true,
              name: true,
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
        },
      });

      if (!token) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Token not found",
        });
      }

      const now = new Date();

      return {
        id: token.id,
        name: token.name,
        type: token.type,
        prefix: token.prefix,
        scopes: token.scopes,
        status:
          token.status === "REVOKED"
            ? "REVOKED"
            : token.expiresAt && token.expiresAt < now
              ? "EXPIRED"
              : "ACTIVE",
        expiresAt: token.expiresAt,
        expiryStatus: getExpiryStatus(token.expiresAt),
        lastUsedAt: token.lastUsedAt,
        revokedAt: token.revokedAt,
        cluster: token.cluster,
        createdBy: token.createdBy,
        createdAt: token.createdAt,
      };
    }),

  /**
   * Revoke a token
   */
  revoke: orgProtectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Check permission
      if (!ctx.user?.isSuperAdmin && !hasMinRole(ctx.user?.newRole ?? "VIEWER", "CLUSTER_ADMIN")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only Cluster Admins can revoke tokens",
        });
      }

      const token = await ctx.db.apiToken.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.organizationId,
        },
      });

      if (!token) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Token not found",
        });
      }

      if (token.status === "REVOKED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Token is already revoked",
        });
      }

      const updated = await ctx.db.apiToken.update({
        where: { id: input.id },
        data: {
          status: "REVOKED",
          revokedAt: new Date(),
        },
      });

      // Log audit event
      await logAudit(
        {
          user: { id: ctx.userId, email: ctx.user?.email ?? "" },
          organizationId: ctx.organizationId ?? undefined,
        },
        "token.revoked",
        {
          tokenId: token.id,
          tokenName: token.name,
          tokenType: token.type,
        }
      );

      return { success: true, revokedAt: updated.revokedAt };
    }),

  /**
   * Rotate a token (revoke old and create new with same settings)
   */
  rotate: orgProtectedProcedure
    .input(
      z.object({
        id: z.string(),
        expiryDays: z.number().min(0).max(365).default(365),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check permission
      if (!ctx.user?.isSuperAdmin && !hasMinRole(ctx.user?.newRole ?? "VIEWER", "CLUSTER_ADMIN")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only Cluster Admins can rotate tokens",
        });
      }

      const oldToken = await ctx.db.apiToken.findFirst({
        where: {
          id: input.id,
          organizationId: ctx.organizationId,
        },
      });

      if (!oldToken) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Token not found",
        });
      }

      // Generate new token with same settings
      const tokenData =
        oldToken.type === "API"
          ? generateApiToken(input.expiryDays)
          : generateAgentToken(oldToken.type as "AGENT" | "REGISTRATION", input.expiryDays);

      // Transaction: revoke old, create new
      const [, newToken] = await ctx.db.$transaction([
        // Revoke old token
        ctx.db.apiToken.update({
          where: { id: input.id },
          data: {
            status: "REVOKED",
            revokedAt: new Date(),
          },
        }),
        // Create new token
        ctx.db.apiToken.create({
          data: {
            name: oldToken.name,
            type: oldToken.type,
            tokenHash: tokenData.tokenHash,
            prefix: tokenData.tokenPrefix,
            scopes: oldToken.scopes,
            status: "ACTIVE",
            expiresAt: tokenData.expiresAt,
            organizationId: ctx.organizationId,
            clusterId: oldToken.clusterId,
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
        }),
      ]);

      // Log audit event
      await logAudit(
        {
          user: { id: ctx.userId, email: ctx.user?.email ?? "" },
          organizationId: ctx.organizationId ?? undefined,
        },
        "token.rotated",
        {
          oldTokenId: oldToken.id,
          newTokenId: newToken.id,
          tokenName: newToken.name,
          tokenType: newToken.type,
        }
      );

      return {
        id: newToken.id,
        name: newToken.name,
        type: newToken.type,
        token: tokenData.token, // New token - shown once!
        prefix: newToken.prefix,
        scopes: newToken.scopes,
        expiresAt: newToken.expiresAt,
        cluster: newToken.cluster,
        oldTokenId: oldToken.id,
      };
    }),

  /**
   * Validate a token (for internal use / debugging)
   */
  validate: orgProtectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Hash the provided token
      const tokenHash = hashToken(input.token);

      // Look up the token
      const storedToken = await ctx.db.apiToken.findFirst({
        where: {
          tokenHash,
          organizationId: ctx.organizationId,
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

      if (!storedToken) {
        return {
          valid: false,
          error: "Token not found",
        };
      }

      if (storedToken.status === "REVOKED") {
        return {
          valid: false,
          error: "Token has been revoked",
          revokedAt: storedToken.revokedAt,
        };
      }

      if (isTokenExpired(storedToken.expiresAt)) {
        return {
          valid: false,
          error: "Token has expired",
          expiresAt: storedToken.expiresAt,
        };
      }

      // Update last used timestamp
      await ctx.db.apiToken.update({
        where: { id: storedToken.id },
        data: { lastUsedAt: new Date() },
      });

      return {
        valid: true,
        tokenId: storedToken.id,
        name: storedToken.name,
        type: storedToken.type,
        scopes: storedToken.scopes,
        cluster: storedToken.cluster,
        expiresAt: storedToken.expiresAt,
      };
    }),

  /**
   * Get token statistics for the organization
   */
  stats: orgProtectedProcedure.query(async ({ ctx }) => {
    const now = new Date();

    const [total, active, revoked, expired, byType] = await Promise.all([
      ctx.db.apiToken.count({
        where: { organizationId: ctx.organizationId },
      }),
      ctx.db.apiToken.count({
        where: {
          organizationId: ctx.organizationId,
          status: "ACTIVE",
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      }),
      ctx.db.apiToken.count({
        where: {
          organizationId: ctx.organizationId,
          status: "REVOKED",
        },
      }),
      ctx.db.apiToken.count({
        where: {
          organizationId: ctx.organizationId,
          status: "ACTIVE",
          expiresAt: { lte: now },
        },
      }),
      ctx.db.apiToken.groupBy({
        by: ["type"],
        where: {
          organizationId: ctx.organizationId,
          status: "ACTIVE",
        },
        _count: true,
      }),
    ]);

    return {
      total,
      active,
      revoked,
      expired,
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
