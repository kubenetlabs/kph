/**
 * Seed Default Organization and Admin User
 *
 * This script creates the default organization and admin user for anonymous mode.
 * It is idempotent - safe to run multiple times (uses upsert).
 *
 * Run manually: npx tsx prisma/seed-default-auth.ts
 * Or automatically via docker-entrypoint.sh when KPH_AUTH_PROVIDER=none
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// These constants must match src/lib/auth/providers/none.ts
const DEFAULT_ORG_ID = "kph_default_org";
const DEFAULT_USER_ID = "kph_default_admin";
const DEFAULT_ORG_SLUG = "default";

async function seedDefaultAuth() {
  console.log("[seed] Checking for default organization and admin user...");

  try {
    // Upsert default organization
    const org = await prisma.organization.upsert({
      where: { id: DEFAULT_ORG_ID },
      update: {}, // Don't overwrite if it exists (user may have customized it)
      create: {
        id: DEFAULT_ORG_ID,
        name: "Default Organization",
        slug: DEFAULT_ORG_SLUG,
      },
    });
    console.log(`[seed] Organization: "${org.name}" (${org.id})`);

    // Check if subscription exists
    const existingSub = await prisma.subscription.findUnique({
      where: { organizationId: DEFAULT_ORG_ID },
    });

    if (!existingSub) {
      // Create a free subscription for the org
      await prisma.subscription.create({
        data: {
          organizationId: DEFAULT_ORG_ID,
          tier: "FREE",
          status: "ACTIVE",
        },
      });
      console.log(`[seed] Created FREE subscription for organization`);
    }

    // Upsert default admin user
    const user = await prisma.user.upsert({
      where: { id: DEFAULT_USER_ID },
      update: {}, // Don't overwrite if it exists
      create: {
        id: DEFAULT_USER_ID,
        email: "admin@kph.local",
        name: "KPH Admin",
        role: "ADMIN",
        newRole: "ORG_ADMIN",
        isSuperAdmin: true,
        organizationId: DEFAULT_ORG_ID,
        emailVerified: new Date(),
      },
    });
    console.log(`[seed] Admin user: "${user.name}" <${user.email}> (${user.id})`);

    console.log("[seed] Default auth seed complete.");
  } catch (error) {
    // Log but don't crash - the app can still work if this fails
    // The NoAuthProvider will show a warning if the user is missing
    console.error("[seed] Warning: Default auth seed failed:", error);
    throw error;
  }
}

// Run the seed
seedDefaultAuth()
  .catch((e) => {
    console.error("[seed] Fatal error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
