/**
 * Email Provider Types
 *
 * Supports pluggable email providers:
 * - none: No-op mode (logs but doesn't send)
 * - resend: Resend API (hosted service)
 * - smtp: Generic SMTP (future)
 */

export interface EmailConfig {
  provider: "none" | "resend" | "smtp";
  fromAddress: string;
  resend?: {
    apiKey: string;
  };
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
  };
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailProvider {
  send(options: SendEmailOptions): Promise<void>;
  getProviderName(): string;
}
