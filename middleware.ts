import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Define protected routes
const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/clusters(.*)",
  "/policies(.*)",
  "/topology(.*)",
  "/settings(.*)",
  "/simulation(.*)",
  "/validation(.*)",
  "/marketplace(.*)",
  "/onboarding(.*)",
  "/api/trpc(.*)",
]);

// Define public routes (accessible without auth)
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/operator(.*)",
  "/api/auth(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  // If it's a protected route and user is not authenticated, redirect to sign-in
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
