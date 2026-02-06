/**
 * Email Service - Backward Compatibility Layer
 *
 * This file re-exports from the new email provider abstraction.
 * Import from "~/lib/email" or "~/lib/email/index" for new code.
 */

export {
  sendInvitationEmail,
  getEmailProvider,
  getEmailConfig,
  getEmailProviderName,
  isEmailEnabled,
} from "./email/index";

export type { EmailConfig, EmailProvider, SendEmailOptions } from "./email/types";
