import { NextResponse } from "next/server";

// Force dynamic rendering - evaluate env vars at runtime, not build time
export const dynamic = "force-dynamic";

/**
 * GET /api/status/auth
 *
 * Returns the current authentication provider configuration status.
 * Used by the UI to show setup guidance and by operators for health monitoring.
 */
export async function GET() {
  const provider = process.env.KPH_AUTH_PROVIDER ?? "none";

  let configured = true;
  const missing: string[] = [];

  // Check required environment variables for each provider
  if (provider === "clerk") {
    if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
      configured = false;
      missing.push("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
    }
    if (!process.env.CLERK_SECRET_KEY) {
      configured = false;
      missing.push("CLERK_SECRET_KEY");
    }
  } else if (provider === "oidc") {
    if (!process.env.KPH_OIDC_ISSUER_URL) {
      configured = false;
      missing.push("KPH_OIDC_ISSUER_URL");
    }
    if (!process.env.KPH_OIDC_CLIENT_ID) {
      configured = false;
      missing.push("KPH_OIDC_CLIENT_ID");
    }
    if (!process.env.KPH_OIDC_CLIENT_SECRET) {
      configured = false;
      missing.push("KPH_OIDC_CLIENT_SECRET");
    }
  }

  const response = {
    provider,
    configured,
    enabled: provider !== "none",
    features: {
      multiTenant: provider !== "none",
      userManagement: provider !== "none",
    },
    docs:
      provider === "clerk"
        ? "https://github.com/kubenetlabs/kph/blob/main/docs/auth-clerk.md"
        : provider === "oidc"
          ? "https://github.com/kubenetlabs/kph/blob/main/docs/auth-oidc.md"
          : "https://github.com/kubenetlabs/kph/blob/main/docs/authentication.md",
    ...(missing.length > 0 && {
      missing,
      message: `Missing required environment variables: ${missing.join(", ")}`,
    }),
  };

  return NextResponse.json(response, {
    status: configured ? 200 : 503,
  });
}
