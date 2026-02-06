"use client";

import type { ReactNode, ComponentType } from "react";

/**
 * Conditional Auth Provider
 *
 * Uses Clerk when NEXT_PUBLIC_KPH_AUTH_PROVIDER=clerk is set,
 * otherwise provides a passthrough for anonymous mode.
 *
 * This allows Docker builds without Clerk keys for self-hosted deployments.
 */

// Check at module load time if Clerk should be used
// NEXT_PUBLIC_ vars are available at build time
const authProvider = process.env.NEXT_PUBLIC_KPH_AUTH_PROVIDER ??
  (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? "clerk" : "none");

interface AuthProviderProps {
  children: ReactNode;
}

// Type for the Clerk provider component
type ClerkProviderType = ComponentType<{ children: ReactNode }>;

// Cache the Clerk provider component
let ClerkProviderComponent: ClerkProviderType | null = null;
let clerkLoadAttempted = false;

function loadClerkProvider(): ClerkProviderType | null {
  if (clerkLoadAttempted) {
    return ClerkProviderComponent;
  }
  clerkLoadAttempted = true;

  if (authProvider !== "clerk") {
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const clerk = require("@clerk/nextjs") as { ClerkProvider: ClerkProviderType };
    ClerkProviderComponent = clerk.ClerkProvider;
    return ClerkProviderComponent;
  } catch {
    console.warn("[auth] Clerk provider requested but @clerk/nextjs not available");
    return null;
  }
}

/**
 * Conditional Auth Provider component
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const Provider = loadClerkProvider();

  if (Provider) {
    return <Provider>{children}</Provider>;
  }

  // No-auth mode or OIDC: just render children directly
  return <>{children}</>;
}

/**
 * Hook to check which auth provider is active
 */
export function useAuthProvider(): "none" | "clerk" | "oidc" {
  return authProvider as "none" | "clerk" | "oidc";
}
