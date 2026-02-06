/**
 * No-Op Email Provider
 *
 * Logs email operations without sending.
 * Used when email is not configured.
 */

import type { EmailProvider, SendEmailOptions } from "../types";

export class NoOpEmailProvider implements EmailProvider {
  async send(options: SendEmailOptions): Promise<void> {
    console.log(`[email] Email not configured - would send to: ${options.to}`);
    console.log(`[email] Subject: ${options.subject}`);
    // Don't log the full body - just acknowledge the operation
  }

  getProviderName(): string {
    return "none";
  }
}
