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

    // Upsert subscription (idempotent - safe for multi-replica starts)
    await prisma.subscription.upsert({
      where: { organizationId: DEFAULT_ORG_ID },
      update: {}, // Don't overwrite if it exists
      create: {
        organizationId: DEFAULT_ORG_ID,
        tier: "FREE",
        status: "ACTIVE",
      },
    });
    console.log(`[seed] Subscription: FREE tier for organization`);

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

    console.log("[seed] ✓ Default auth seed complete.");
  } catch (error) {
    // In multi-replica environments, concurrent upserts may occasionally conflict
    // This is expected and safe - one pod will succeed, others can proceed
    if (error instanceof Error) {
      console.error("[seed] Warning: Seed operation failed:", error.message);
      // Check if it's a database connection error (should retry) vs conflict (can ignore)
      if (error.message.includes("connection") || error.message.includes("timeout")) {
        console.error("[seed] Database connection issue - will retry on pod restart");
        throw error; // Fatal: database not ready
      }
      // For other errors (likely constraint conflicts from race conditions), log and continue
      console.log("[seed] Continuing startup - NoAuthProvider will verify default user exists");
    }
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
