/**
 * Invitation Router
 *
 * Handles user invitations to organizations.
 * OrgAdmins+ can invite users, users accept via email link.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createId } from "@paralleldrive/cuid2";
import { createTRPCRouter, orgProtectedProcedure, publicProcedure, protectedProcedure } from "../trpc";
import { hasMinRole, logAudit } from "~/lib/permissions";
import { sendInvitationEmail } from "~/lib/email";

// Default invitation expiry: 7 days
const INVITATION_EXPIRY_DAYS = 7;

export const invitationRouter = createTRPCRouter({
  /**
   * Create a new invitation
   * Only OrgAdmins can invite users to their organization
   */
  create: orgProtectedProcedure
    .input(
      z.object({
        email: z.string().email(),
        role: z.enum(["ORG_ADMIN", "CLUSTER_ADMIN", "POLICY_EDITOR", "VIEWER"]).default("VIEWER"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check if user has OrgAdmin role or higher
      if (!ctx.user) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      if (!ctx.user.isSuperAdmin && !hasMinRole(ctx.user.newRole, "ORG_ADMIN")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only Organization Admins can invite users",
        });
      }

      // Check if user is already in the organization
      const existingUser = await ctx.db.user.findFirst({
        where: {
          email: input.email,
          organizationId: ctx.organizationId,
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
          organizationId: ctx.organizationId,
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

      // Get organization name for the email
      const organization = await ctx.db.organization.findUnique({
        where: { id: ctx.organizationId },
        select: { name: true, slug: true },
      });

      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      // Calculate expiry date
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS);

      // Generate invitation ID upfront so email link matches DB record
      const invitationId = createId();

      // Send invitation email FIRST - if this fails, no DB record is created
      try {
        await sendInvitationEmail({
          to: input.email.toLowerCase(),
          organizationName: organization.name,
          inviterName: ctx.user.name ?? ctx.user.email,
          role: input.role,
          invitationId,
          expiresAt,
        });
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to send invitation email",
        });
      }

      // Create the invitation with pre-generated ID
      const invitation = await ctx.db.invitation.create({
        data: {
          id: invitationId,
          email: input.email.toLowerCase(),
          organizationId: ctx.organizationId,
          role: input.role,
          invitedById: ctx.userId,
          expiresAt,
        },
        include: {
          organization: {
            select: {
              name: true,
              slug: true,
            },
          },
          invitedBy: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      });

      // Log the audit event
      await logAudit(
        {
          user: { id: ctx.userId, email: ctx.user.email },
          organizationId: ctx.organizationId ?? undefined,
        },
        "member.invited",
        {
          invitedEmail: input.email,
          role: input.role,
          invitationId: invitation.id,
        }
      );

      return {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        organization: invitation.organization,
        invitedBy: invitation.invitedBy,
      };
    }),

  /**
   * List invitations for the current organization
   */
  list: orgProtectedProcedure
    .input(
      z.object({
        status: z.enum(["pending", "accepted", "expired", "all"]).default("pending"),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Check if user has OrgAdmin role or higher to see invitations
      if (!ctx.user?.isSuperAdmin && !hasMinRole(ctx.user?.newRole ?? "VIEWER", "ORG_ADMIN")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only Organization Admins can view invitations",
        });
      }

      const now = new Date();

      const whereClause = {
        organizationId: ctx.organizationId,
        ...(input.status === "pending" && {
          acceptedAt: null,
          expiresAt: { gt: now },
        }),
        ...(input.status === "accepted" && {
          acceptedAt: { not: null },
        }),
        ...(input.status === "expired" && {
          acceptedAt: null,
          expiresAt: { lte: now },
        }),
      };

      const invitations = await ctx.db.invitation.findMany({
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        where: whereClause,
        orderBy: { createdAt: "desc" },
        include: {
          invitedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      let nextCursor: string | undefined;
      if (invitations.length > input.limit) {
        const nextItem = invitations.pop();
        nextCursor = nextItem?.id;
      }

      return {
        invitations: invitations.map((inv) => ({
          ...inv,
          status: inv.acceptedAt
            ? "accepted"
            : inv.expiresAt < now
              ? "expired"
              : "pending",
        })),
        nextCursor,
      };
    }),

  /**
   * Get invitation details by ID (public - for acceptance page)
   */
  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const invitation = await ctx.db.invitation.findUnique({
        where: { id: input.id },
        include: {
          organization: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
          invitedBy: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      });

      if (!invitation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Invitation not found",
        });
      }

      const now = new Date();
      const status = invitation.acceptedAt
        ? "accepted"
        : invitation.expiresAt < now
          ? "expired"
          : "pending";

      return {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        status,
        expiresAt: invitation.expiresAt,
        acceptedAt: invitation.acceptedAt,
        organization: invitation.organization,
        invitedBy: invitation.invitedBy,
      };
    }),

  /**
   * Accept an invitation
   * Requires the user to be authenticated via Clerk
   */
  accept: protectedProcedure
    .input(z.object({ invitationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Get the invitation
      const invitation = await ctx.db.invitation.findUnique({
        where: { id: input.invitationId },
        include: {
          organization: true,
        },
      });

      if (!invitation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Invitation not found",
        });
      }

      // Check if already accepted
      if (invitation.acceptedAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This invitation has already been accepted",
        });
      }

      // Check if expired
      if (invitation.expiresAt < new Date()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This invitation has expired",
        });
      }

      // Get the current user's email from Clerk
      // We need to look up or create the user record
      let user = await ctx.db.user.findUnique({
        where: { id: ctx.userId },
      });

      // If user doesn't exist, we need their email to verify
      // In this case, we'll create them during acceptance
      if (!user) {
        // We can't verify email without the user record
        // The user should complete sign-up first
        // For now, we'll create a minimal user record
        // In production, you'd verify email via Clerk API
        user = await ctx.db.user.create({
          data: {
            id: ctx.userId,
            email: invitation.email, // Trust the invitation email for now
            newRole: invitation.role,
            organizationId: invitation.organizationId,
          },
        });
      } else {
        // User exists - verify email matches (case-insensitive)
        if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "This invitation was sent to a different email address",
          });
        }

        // Check if user is already in an organization
        if (user.organizationId && user.organizationId !== invitation.organizationId) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "You are already a member of another organization",
          });
        }

        // Update the user's organization and role
        user = await ctx.db.user.update({
          where: { id: ctx.userId },
          data: {
            organizationId: invitation.organizationId,
            newRole: invitation.role,
            // Also update legacy role field for compatibility
            role: invitation.role === "ORG_ADMIN" ? "ADMIN" : invitation.role === "VIEWER" ? "VIEWER" : "OPERATOR",
          },
        });
      }

      // Mark the invitation as accepted
      await ctx.db.invitation.update({
        where: { id: input.invitationId },
        data: { acceptedAt: new Date() },
      });

      // Log the audit event
      await logAudit(
        {
          user: { id: user.id, email: user.email },
          organizationId: invitation.organizationId,
        },
        "member.joined",
        {
          invitationId: invitation.id,
          role: invitation.role,
        }
      );

      return {
        success: true,
        organization: invitation.organization,
        role: invitation.role,
      };
    }),

  /**
   * Resend an invitation (creates a new one with fresh expiry)
   */
  resend: orgProtectedProcedure
    .input(z.object({ invitationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Check permissions
      if (!ctx.user?.isSuperAdmin && !hasMinRole(ctx.user?.newRole ?? "VIEWER", "ORG_ADMIN")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only Organization Admins can resend invitations",
        });
      }

      // Get the original invitation
      const original = await ctx.db.invitation.findUnique({
        where: { id: input.invitationId },
      });

      if (!original) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Invitation not found",
        });
      }

      // Verify it belongs to this organization
      if (original.organizationId !== ctx.organizationId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Invitation belongs to another organization",
        });
      }

      // Check if already accepted
      if (original.acceptedAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This invitation has already been accepted",
        });
      }

      // Calculate new expiry
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS);

      // Update the invitation with new expiry
      const updated = await ctx.db.invitation.update({
        where: { id: input.invitationId },
        data: {
          expiresAt,
          invitedById: ctx.userId, // Update who resent it
        },
        include: {
          organization: {
            select: {
              name: true,
              slug: true,
            },
          },
        },
      });

      return {
        id: updated.id,
        email: updated.email,
        expiresAt: updated.expiresAt,
        organization: updated.organization,
      };
    }),

  /**
   * Revoke (delete) a pending invitation
   */
  revoke: orgProtectedProcedure
    .input(z.object({ invitationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Check permissions
      if (!ctx.user?.isSuperAdmin && !hasMinRole(ctx.user?.newRole ?? "VIEWER", "ORG_ADMIN")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only Organization Admins can revoke invitations",
        });
      }

      // Get the invitation
      const invitation = await ctx.db.invitation.findUnique({
        where: { id: input.invitationId },
      });

      if (!invitation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Invitation not found",
        });
      }

      // Verify it belongs to this organization
      if (invitation.organizationId !== ctx.organizationId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Invitation belongs to another organization",
        });
      }

      // Check if already accepted
      if (invitation.acceptedAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot revoke an accepted invitation",
        });
      }

      // Delete the invitation
      await ctx.db.invitation.delete({
        where: { id: input.invitationId },
      });

      return { success: true };
    }),
});
