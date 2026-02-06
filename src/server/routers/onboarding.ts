import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * Onboarding router
 * Handles organization creation and user onboarding
 */
export const onboardingRouter = createTRPCRouter({
  /**
   * Check if user needs onboarding
   */
  checkStatus: protectedProcedure.query(async ({ ctx }) => {
    // In no-auth mode, user is always fully onboarded with default org
    if (ctx.authProvider === "none") {
      const user = await ctx.db.user.findUnique({
        where: { id: ctx.userId },
        include: { organization: true },
      });

      return {
        needsOnboarding: false,
        organization: user?.organization ?? null,
      };
    }

    // Try to find the user in our database
    const user = await ctx.db.user.findUnique({
      where: { id: ctx.userId },
      include: { organization: true },
    });

    // If user doesn't exist in DB, they need onboarding
    if (!user) {
      return {
        needsOnboarding: true,
        organization: null,
      };
    }

    return {
      needsOnboarding: !user.organizationId,
      organization: user.organization ?? null,
    };
  }),

  /**
   * Create a new organization and assign user to it
   */
  createOrganization: protectedProcedure
    .input(
      z.object({
        name: z.string().min(2, "Organization name must be at least 2 characters"),
        slug: z
          .string()
          .min(2, "Slug must be at least 2 characters")
          .max(50, "Slug must be at most 50 characters")
          .regex(
            /^[a-z0-9-]+$/,
            "Slug can only contain lowercase letters, numbers, and hyphens"
          ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // In no-auth mode, user already has a default org
      if (ctx.authProvider === "none") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Organization management is not available in anonymous mode",
        });
      }

      // Check if slug is already taken
      const existingOrg = await ctx.db.organization.findUnique({
        where: { slug: input.slug },
      });

      if (existingOrg) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This organization slug is already taken",
        });
      }

      // Check if user exists and already has an organization
      const existingUser = await ctx.db.user.findUnique({
        where: { id: ctx.userId },
      });

      if (existingUser?.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You are already part of an organization",
        });
      }

      // Get user details from auth provider
      let userEmail = "";
      let userName: string | null = null;

      if (ctx.authProvider === "clerk") {
        // Dynamically import Clerk to get user details
        const { currentUser } = await import("@clerk/nextjs/server");
        const clerkUser = await currentUser();

        if (!clerkUser) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Unable to get user details",
          });
        }

        userEmail = clerkUser.emailAddresses[0]?.emailAddress ?? "";
        userName = clerkUser.fullName ?? clerkUser.firstName ?? null;
      } else {
        // For other providers, require email in input or throw
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "User onboarding is not supported for this auth provider",
        });
      }

      // Create organization, user (if needed), and update in a transaction
      const organization = await ctx.db.$transaction(async (tx) => {
        // Create the organization
        const org = await tx.organization.create({
          data: {
            name: input.name,
            slug: input.slug,
          },
        });

        // Create a free subscription for the org
        await tx.subscription.create({
          data: {
            organizationId: org.id,
            tier: "FREE",
            status: "ACTIVE",
          },
        });

        // Create or update user with org membership
        await tx.user.upsert({
          where: { id: ctx.userId },
          create: {
            id: ctx.userId,
            email: userEmail,
            name: userName,
            organizationId: org.id,
            role: "ADMIN",
          },
          update: {
            organizationId: org.id,
            role: "ADMIN",
          },
        });

        return org;
      });

      return {
        success: true,
        organization: {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
        },
      };
    }),

  /**
   * Check if a slug is available
   */
  checkSlugAvailability: protectedProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) => {
      const existingOrg = await ctx.db.organization.findUnique({
        where: { slug: input.slug },
      });

      return { available: !existingOrg };
    }),

  /**
   * Generate a slug suggestion from organization name
   */
  suggestSlug: protectedProcedure
    .input(z.object({ name: z.string() }))
    .query(async ({ ctx, input }) => {
      // Generate base slug from name
      const baseSlug = input.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .substring(0, 50);

      // Check if base slug is available
      let slug = baseSlug;
      let counter = 1;

      while (true) {
        const existing = await ctx.db.organization.findUnique({
          where: { slug },
        });

        if (!existing) break;

        slug = `${baseSlug}-${counter}`;
        counter++;

        if (counter > 100) {
          // Safety limit
          slug = `${baseSlug}-${Date.now()}`;
          break;
        }
      }

      return { slug };
    }),
});
