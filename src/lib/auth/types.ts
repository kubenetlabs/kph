/**
 * Auth Provider Abstraction Types
 *
 * Enables pluggable authentication providers:
 * - none: Anonymous admin mode (default for OSS)
 * - clerk: Hosted auth via Clerk
 * - oidc: Generic OIDC (future)
 */

import type { Role } from "@prisma/client";

/**
 * Authenticated user context available throughout the application
 */
export interface AuthUser {
  id: string;                  // Internal KPH user ID (cuid)
  email: string;
  name: string | null;
  image: string | null;
  isSuperAdmin: boolean;
  newRole: Role;
  organizationId: string | null;
  organization: {
    id: string;
    name: string;
    slug: string;
  } | null;
}

/**
 * Auth session returned by providers
 */
export interface AuthSession {
  user: AuthUser | null;
  userId: string | null;       // For backward compatibility with existing code
  isAuthenticated: boolean;
  provider: "none" | "clerk" | "oidc";
}

/**
 * Auth provider interface - implemented by each provider
 */
export interface AuthProvider {
  /** Get the current session from the request context */
  getSession(): Promise<AuthSession>;

  /** Get the provider name */
  getProviderName(): "none" | "clerk" | "oidc";

  /** Check if this provider requires client-side UI components */
  hasClientComponents(): boolean;
}

/**
 * Auth configuration from environment
 */
export interface AuthConfig {
  provider: "none" | "clerk" | "oidc";
  clerk?: {
    publishableKey: string;
    secretKey: string;
  };
  oidc?: {
    issuerUrl: string;
    clientId: string;
    clientSecret: string;
  };
}
