/**
 * Email Provider Factory
 *
 * Creates and manages email providers based on environment configuration.
 * Supports pluggable email delivery:
 * - none: No-op mode (default, logs but doesn't send)
 * - resend: Resend API
 * - smtp: Generic SMTP (future)
 *
 * Environment Variables:
 *   KPH_EMAIL_PROVIDER: none | resend | smtp (default: auto-detect)
 *   KPH_EMAIL_FROM: From address for emails
 *   RESEND_API_KEY: API key for Resend (triggers auto-detection)
 */

import type { EmailConfig, EmailProvider, SendEmailOptions } from "./types";
import { NoOpEmailProvider } from "./providers/none";

/**
 * Get email configuration from environment
 */
export function getEmailConfig(): EmailConfig {
  // Auto-detect provider: if RESEND_API_KEY is set, use resend
  const explicitProvider = process.env.KPH_EMAIL_PROVIDER as EmailConfig["provider"] | undefined;
  const hasResendKey = !!process.env.RESEND_API_KEY;

  const provider: EmailConfig["provider"] = explicitProvider ?? (hasResendKey ? "resend" : "none");

  return {
    provider,
    fromAddress: process.env.KPH_EMAIL_FROM ?? process.env.RESEND_FROM_EMAIL ?? "Policy Hub <noreply@kph.local>",
    resend: {
      apiKey: process.env.RESEND_API_KEY ?? "",
    },
    smtp: {
      host: process.env.KPH_SMTP_HOST ?? "",
      port: parseInt(process.env.KPH_SMTP_PORT ?? "587", 10),
      secure: process.env.KPH_SMTP_SECURE === "true",
      user: process.env.KPH_SMTP_USER ?? "",
      pass: process.env.KPH_SMTP_PASS ?? "",
    },
  };
}

// Lazy singleton provider
let _provider: EmailProvider | undefined;

/**
 * Get the configured email provider instance.
 */
export async function getEmailProvider(): Promise<EmailProvider> {
  if (_provider) {
    return _provider;
  }

  const config = getEmailConfig();

  switch (config.provider) {
    case "none":
      _provider = new NoOpEmailProvider();
      break;

    case "resend": {
      // Dynamic import to avoid bundling Resend when not used
      const { ResendEmailProvider } = await import("./providers/resend");
      _provider = new ResendEmailProvider(config);
      break;
    }

    case "smtp":
      // SMTP provider is planned for future release
      console.warn("[email] SMTP provider is not yet implemented. Falling back to no-op mode.");
      _provider = new NoOpEmailProvider();
      break;

    default: {
      const unknownProvider: string = config.provider;
      console.warn(`[email] Unknown provider: ${unknownProvider}, falling back to no-op mode`);
      _provider = new NoOpEmailProvider();
    }
  }

  return _provider;
}

/**
 * Check if email is configured (not in no-op mode).
 */
export function isEmailEnabled(): boolean {
  const config = getEmailConfig();
  return config.provider !== "none";
}

/**
 * Get email provider name.
 */
export function getEmailProviderName(): string {
  const config = getEmailConfig();
  return config.provider;
}

// ============================================================================
// Convenience Functions (maintain backward compatibility)
// ============================================================================

// Get base URL for email links
function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:3000";
}

interface SendInvitationEmailParams {
  to: string;
  organizationName: string;
  inviterName: string;
  role: string;
  invitationId: string;
  expiresAt: Date;
}

const roleDisplayNames: Record<string, string> = {
  ORG_ADMIN: "Organization Admin",
  CLUSTER_ADMIN: "Cluster Admin",
  POLICY_EDITOR: "Policy Editor",
  VIEWER: "Viewer",
};

/**
 * Send an invitation email.
 * This is a convenience function that maintains backward compatibility.
 */
export async function sendInvitationEmail({
  to,
  organizationName,
  inviterName,
  role,
  invitationId,
  expiresAt,
}: SendInvitationEmailParams): Promise<void> {
  const provider = await getEmailProvider();
  const baseUrl = getBaseUrl();
  const inviteUrl = `${baseUrl}/invite/${invitationId}`;
  const roleDisplay = roleDisplayNames[role] ?? role;
  const expiryDate = expiresAt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  await provider.send({
    to,
    subject: `You've been invited to join ${organizationName} on Policy Hub`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); border-radius: 12px; padding: 40px; text-align: center; margin-bottom: 24px;">
    <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600;">You're Invited!</h1>
  </div>

  <p style="margin-bottom: 16px;">Hi there,</p>

  <p style="margin-bottom: 16px;">
    <strong>${inviterName}</strong> has invited you to join <strong>${organizationName}</strong> as a <strong>${roleDisplay}</strong>.
  </p>

  <p style="margin-bottom: 24px; color: #6b7280;">
    Policy Hub helps teams manage Kubernetes network policies, security rules, and Gateway API routes across clusters.
  </p>

  <div style="text-align: center; margin: 32px 0;">
    <a href="${inviteUrl}" style="display: inline-block; background: #3b82f6; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
      Accept Invitation
    </a>
  </div>

  <p style="color: #6b7280; font-size: 14px; margin-bottom: 24px;">
    This invitation expires on <strong>${expiryDate}</strong>.
  </p>

  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">

  <p style="color: #9ca3af; font-size: 12px;">
    If the button above doesn't work, copy and paste this link into your browser:<br>
    <a href="${inviteUrl}" style="color: #3b82f6; word-break: break-all;">${inviteUrl}</a>
  </p>
</body>
</html>
    `.trim(),
    text: `
You've been invited to join ${organizationName} on Policy Hub

Hi there,

${inviterName} has invited you to join ${organizationName} as a ${roleDisplay}.

Policy Hub helps teams manage Kubernetes network policies, security rules, and Gateway API routes across clusters.

Accept your invitation by visiting:
${inviteUrl}

This invitation expires on ${expiryDate}.
    `.trim(),
  });
}

// Re-export types
export type { EmailConfig, EmailProvider, SendEmailOptions } from "./types";
