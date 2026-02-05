import { Resend } from "resend";

// Lazy-initialize Resend client to avoid build-time errors when API key is not set
let _resend: Resend | null = null;

function getResendClient(): Resend | null {
  if (_resend) return _resend;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return null;
  }

  _resend = new Resend(apiKey);
  return _resend;
}

// Get base URL for invitation links
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

export async function sendInvitationEmail({
  to,
  organizationName,
  inviterName,
  role,
  invitationId,
  expiresAt,
}: SendInvitationEmailParams): Promise<void> {
  const resend = getResendClient();

  // If email is not configured, log and skip
  if (!resend) {
    console.log(`[email] Email not configured (RESEND_API_KEY not set). Would send invitation to: ${to}`);
    console.log(`[email] Invitation ID: ${invitationId}, Organization: ${organizationName}, Role: ${role}`);
    return;
  }

  const baseUrl = getBaseUrl();
  const inviteUrl = `${baseUrl}/invite/${invitationId}`;
  const roleDisplay = roleDisplayNames[role] ?? role;
  const expiryDate = expiresAt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL ?? "Policy Hub <onboarding@resend.dev>",
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

  if (error) {
    throw new Error(`Failed to send invitation email: ${error.message}`);
  }
}
