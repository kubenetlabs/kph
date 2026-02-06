/**
 * Auth Provider Factory
 *
 * Creates and manages auth providers based on environment configuration.
 * Supports pluggable authentication:
 * - none: Anonymous admin mode (default)
 * - clerk: Hosted auth via Clerk
 * - oidc: Generic OIDC (future)
 *
 * Environment Variables:
 *   KPH_AUTH_PROVIDER: none | clerk | oidc (default: none)
 */

import type { AuthProvider, AuthSession, AuthUser, AuthConfig } from "./types";
import { NoAuthProvider } from "./providers/none";

/**
 * Get auth configuration from environment
 */
export function getAuthConfig(): AuthConfig {
  const provider = (process.env.KPH_AUTH_PROVIDER ?? "none") as AuthConfig["provider"];

  return {
    provider,
    clerk: {
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "",
      secretKey: process.env.CLERK_SECRET_KEY ?? "",
    },
    oidc: {
      issuerUrl: process.env.KPH_OIDC_ISSUER_URL ?? "",
      clientId: process.env.KPH_OIDC_CLIENT_ID ?? "",
      clientSecret: process.env.KPH_OIDC_CLIENT_SECRET ?? "",
    },
  };
}

// Lazy singleton provider
let _provider: AuthProvider | undefined;

/**
 * Get the configured auth provider instance.
 * Uses dynamic imports to avoid bundling unused providers.
 */
export async function getAuthProvider(): Promise<AuthProvider> {
  if (_provider) {
    return _provider;
  }

  const config = getAuthConfig();

  switch (config.provider) {
    case "none":
      _provider = new NoAuthProvider();
      break;

    case "clerk": {
      // Dynamic import - Clerk packages only loaded when configured
      const { ClerkAuthProvider } = await import("./providers/clerk");
      _provider = new ClerkAuthProvider();
      break;
    }

    case "oidc":
      // OIDC provider is planned for future release
      console.warn(
        "[auth] OIDC provider is not yet implemented. Falling back to no-auth mode."
      );
      _provider = new NoAuthProvider();
      break;

    default: {
      const unknownProvider: string = config.provider;
      console.warn(
        `[auth] Unknown provider: ${unknownProvider}, falling back to no-auth mode`
      );
      _provider = new NoAuthProvider();
    }
  }

  return _provider;
}

/**
 * Get the current auth session.
 * This is the primary function that replaces all direct Clerk auth() calls.
 *
 * Usage:
 *   const session = await getAuthSession();
 *   if (!session.isAuthenticated) { redirect('/sign-in'); }
 *   const userId = session.userId;
 */
export async function getAuthSession(): Promise<AuthSession> {
  const provider = await getAuthProvider();
  return provider.getSession();
}

/**
 * Get the current authenticated user.
 * Returns null if not authenticated or user not in database.
 *
 * Replaces the old getCurrentUser() from src/lib/auth.ts
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const session = await getAuthSession();
  return session.user;
}

/**
 * Require the current user to be authenticated.
 * Throws if not authenticated.
 *
 * Replaces the old requireUser() from src/lib/auth.ts
 */
export async function requireUser(): Promise<AuthUser> {
  const session = await getAuthSession();

  if (!session.user) {
    throw new Error("Authentication required");
  }

  return session.user;
}

/**
 * Get the auth provider name from environment.
 * Safe to call during build time (doesn't require provider initialization).
 */
export function getAuthProviderName(): "none" | "clerk" | "oidc" {
  return (process.env.KPH_AUTH_PROVIDER ?? "none") as "none" | "clerk" | "oidc";
}

/**
 * Check if auth is enabled (i.e., not in anonymous mode).
 */
export function isAuthEnabled(): boolean {
  return getAuthProviderName() !== "none";
}

/**
 * Check if Clerk auth is configured.
 * Useful for conditional rendering of Clerk components.
 */
export function isClerkConfigured(): boolean {
  return getAuthProviderName() === "clerk";
}

/**
 * Log auth status on startup
 */
export function logAuthStatus(): void {
  const provider = getAuthProviderName();

  if (provider === "none") {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║  KPH is running in ANONYMOUS MODE (no authentication)        ║
║                                                              ║
║  All users will be logged in as the default admin.           ║
║  This is suitable for local development, single-user,        ║
║  or environments behind a VPN/reverse proxy.                 ║
║                                                              ║
║  To enable authentication, set:                              ║
║    KPH_AUTH_PROVIDER=clerk    (hosted auth via clerk.com)    ║
║    KPH_AUTH_PROVIDER=oidc     (self-hosted OIDC - coming)    ║
╚══════════════════════════════════════════════════════════════╝
    `);
  } else {
    console.log(`[auth] Provider: ${provider}`);
  }
}

// Re-export types
export type { AuthProvider, AuthSession, AuthUser, AuthConfig } from "./types";
