import { NextResponse } from "next/server";

// Force dynamic rendering - evaluate env vars at runtime, not build time
export const dynamic = "force-dynamic";

/**
 * GET /api/status/email
 *
 * Returns the current email provider configuration status.
 * Used by the UI to show setup guidance and by operators for health monitoring.
 */
export async function GET() {
  const provider = process.env.KPH_EMAIL_PROVIDER ?? "none";

  let configured = true;
  const missing: string[] = [];

  // Check required environment variables for each provider
  if (provider === "resend") {
    if (!process.env.RESEND_API_KEY) {
      configured = false;
      missing.push("RESEND_API_KEY");
    }
  } else if (provider === "smtp") {
    if (!process.env.KPH_SMTP_HOST) {
      configured = false;
      missing.push("KPH_SMTP_HOST");
    }
    if (!process.env.KPH_SMTP_USER) {
      configured = false;
      missing.push("KPH_SMTP_USER");
    }
    if (!process.env.KPH_SMTP_PASSWORD) {
      configured = false;
      missing.push("KPH_SMTP_PASSWORD");
    }
  }

  const response = {
    provider,
    configured,
    enabled: provider !== "none",
    features: {
      notifications: provider !== "none",
      invitations: provider !== "none",
    },
    docs:
      provider === "resend"
        ? "https://github.com/kubenetlabs/kph/blob/main/docs/email-setup.md#resend"
        : provider === "smtp"
          ? "https://github.com/kubenetlabs/kph/blob/main/docs/email-setup.md#smtp"
          : "https://github.com/kubenetlabs/kph/blob/main/docs/email-setup.md",
    ...(missing.length > 0 && {
      missing,
      message: `Missing required environment variables: ${missing.join(", ")}`,
    }),
  };

  return NextResponse.json(response, {
    status: configured ? 200 : 503,
  });
}
