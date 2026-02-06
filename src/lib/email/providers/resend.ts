/**
 * Resend Email Provider
 *
 * Uses the Resend API for email delivery.
 * https://resend.com
 */

import { Resend } from "resend";
import type { EmailProvider, SendEmailOptions, EmailConfig } from "../types";

export class ResendEmailProvider implements EmailProvider {
  private client: Resend;
  private fromAddress: string;

  constructor(config: EmailConfig) {
    if (!config.resend?.apiKey) {
      throw new Error("[email] Resend API key is required");
    }
    this.client = new Resend(config.resend.apiKey);
    this.fromAddress = config.fromAddress;
  }

  async send(options: SendEmailOptions): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.fromAddress,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    if (error) {
      throw new Error(`[email] Failed to send email: ${error.message}`);
    }
  }

  getProviderName(): string {
    return "resend";
  }
}
