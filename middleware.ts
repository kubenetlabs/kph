import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl;
    const token = req.nextauth.token;

    // If user is authenticated but has no organization, redirect to onboarding
    // (except if they're already on onboarding page)
    if (token && !token.organizationId && !pathname.startsWith("/onboarding")) {
      return NextResponse.redirect(new URL("/onboarding", req.url));
    }

    // If user completed onboarding, don't let them go back
    if (token?.organizationId && pathname.startsWith("/onboarding")) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        // Allow access if user has a valid token
        return !!token;
      },
    },
    pages: {
      signIn: "/auth/signin",
    },
  }
);

// Protect these routes - require authentication
export const config = {
  matcher: [
    // Protected dashboard routes
    "/dashboard/:path*",
    "/clusters/:path*",
    "/policies/:path*",
    "/topology/:path*",
    "/settings/:path*",
    "/simulation/:path*",
    "/validation/:path*",
    "/marketplace/:path*",
    "/onboarding/:path*",
    "/onboarding",
    // Protect tRPC API routes (but not operator/auth routes)
    "/api/trpc/:path*",
  ],
};
