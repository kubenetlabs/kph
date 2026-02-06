/**
 * Runtime Environment Variable Access
 *
 * This module provides a central location for accessing environment variables.
 * API routes that use these helpers MUST export `dynamic = "force-dynamic"`
 * to ensure Next.js evaluates them at runtime, not build time.
 *
 * Example:
 *   export const dynamic = "force-dynamic";
 *   import { getLLMEnv } from "~/lib/env";
 */

/**
 * Get LLM-related environment variables at runtime.
 */
export function getLLMEnv() {
  return {
    provider: process.env.KPH_LLM_PROVIDER,
    apiKey: process.env.KPH_LLM_API_KEY ?? process.env.ANTHROPIC_API_KEY,
    model: process.env.KPH_LLM_MODEL,
    endpoint: process.env.KPH_LLM_ENDPOINT,
    // For backward compatibility check
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  };
}

/**
 * Get auth-related environment variables at runtime.
 */
export function getAuthEnv() {
  return {
    provider: process.env.KPH_AUTH_PROVIDER ?? 'none',
    clerkPublishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    clerkSecretKey: process.env.CLERK_SECRET_KEY,
  };
}

/**
 * Get a specific environment variable at runtime.
 */
export function env(key: string): string | undefined {
  return process.env[key];
}
