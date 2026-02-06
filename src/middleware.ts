import { NextRequest, NextResponse } from "next/server";

/**
 * Conditional Auth Middleware
 *
 * Routes requests through the appropriate auth middleware based on KPH_AUTH_PROVIDER:
 * - none: All routes accessible (anonymous admin mode)
 * - clerk: Delegate to Clerk middleware
 * - oidc: Delegate to OIDC middleware (future)
 */

// Determine auth provider at module load time
const authProvider = process.env.KPH_AUTH_PROVIDER ?? "none";

// Routes that are always public (regardless of auth provider)
const PUBLIC_ROUTES = [
  "/",
  "/api/operator",
  "/api/cron",
  "/api/webhooks",
  "/api/status",
  "/api/debug",
  "/api/trpc/invitation.getById",
];

// Auth-specific routes (sign-in, sign-up, etc.)
const AUTH_ROUTES = ["/sign-in", "/sign-up", "/invite"];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname.startsWith(route));
}

function isAuthRoute(pathname: string): boolean {
  return AUTH_ROUTES.some((route) => pathname.startsWith(route));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow public routes
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  // --- No-Auth Mode: allow everything ---
  if (authProvider === "none") {
    // If someone hits /sign-in in no-auth mode, redirect to dashboard
    if (isAuthRoute(pathname)) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  // --- Clerk Mode: delegate to Clerk middleware ---
  if (authProvider === "clerk") {
    try {
      const { clerkMiddleware, createRouteMatcher } = await import(
        "@clerk/nextjs/server"
      );

      // Define protected routes for Clerk
      const isProtectedRoute = createRouteMatcher([
        "/dashboard(.*)",
        "/clusters(.*)",
        "/policies(.*)",
        "/topology(.*)",
        "/settings(.*)",
        "/simulation(.*)",
        "/recommendations(.*)",
        "/templates(.*)",
        "/validation(.*)",
        "/admin(.*)",
        "/onboarding(.*)",
      ]);

      // Create and run Clerk middleware
      const clerkHandler = clerkMiddleware(async (auth, req) => {
        if (isProtectedRoute(req)) {
          await auth.protect({
            unauthenticatedUrl: new URL("/sign-in", req.url).toString(),
          });
        }
      });

      // Type assertion needed for middleware compatibility
      return clerkHandler(request, {} as never);
    } catch (error) {
      console.error("[middleware] Failed to load Clerk middleware:", error);
      return NextResponse.next();
    }
  }

  // --- OIDC Mode (future) ---
  if (authProvider === "oidc") {
    // TODO: Implement OIDC middleware via NextAuth
    console.warn("[middleware] OIDC auth not yet implemented");
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Skip Next.js internals and all static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
