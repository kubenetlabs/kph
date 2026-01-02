import { PrismaAdapter } from "@auth/prisma-adapter";
import { type NextAuthOptions } from "next-auth";
import { type Adapter } from "next-auth/adapters";
import GoogleProvider from "next-auth/providers/google";
import GitHubProvider from "next-auth/providers/github";
import EmailProvider from "next-auth/providers/email";
import { db } from "~/lib/db";

/**
 * NextAuth.js configuration for Kubernetes Policy Hub
 *
 * Supports:
 * - Email Magic Link (P0) - passwordless authentication
 * - Google OAuth (P0) - enterprise SSO
 * - GitHub OAuth (P1) - developer-friendly option
 */
export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(db) as Adapter,

  providers: [
    // Email Magic Link (P0) - uses Resend in production
    ...(process.env.EMAIL_SERVER_HOST && process.env.EMAIL_SERVER_PASSWORD
      ? [
          EmailProvider({
            server: {
              host: process.env.EMAIL_SERVER_HOST,
              port: Number(process.env.EMAIL_SERVER_PORT) || 587,
              auth: {
                user: process.env.EMAIL_SERVER_USER,
                pass: process.env.EMAIL_SERVER_PASSWORD,
              },
            },
            from: process.env.EMAIL_FROM || "noreply@policyhub.io",
          }),
        ]
      : []),

    // Google OAuth (P0) - enterprise SSO
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            authorization: {
              params: {
                prompt: "consent",
                access_type: "offline",
                response_type: "code",
              },
            },
          }),
        ]
      : []),

    // GitHub OAuth (P1) - developer-friendly
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? [
          GitHubProvider({
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
          }),
        ]
      : []),
  ],

  session: {
    strategy: "database",
    maxAge: 30 * 24 * 60 * 60, // 30 days
    updateAge: 24 * 60 * 60, // Update session every 24 hours
  },

  pages: {
    signIn: "/auth/signin",
    verifyRequest: "/auth/verify",
    error: "/auth/error",
    newUser: "/onboarding",
  },

  callbacks: {
    async session({ session, user }) {
      // Add user ID and organization info to session
      if (session.user) {
        session.user.id = user.id;

        // Fetch user with organization
        const dbUser = await db.user.findUnique({
          where: { id: user.id },
          include: { organization: true },
        });

        if (dbUser) {
          session.user.role = dbUser.role;
          session.user.organizationId = dbUser.organizationId;
          session.user.organizationName = dbUser.organization?.name;
          session.user.organizationSlug = dbUser.organization?.slug;
          session.user.needsOnboarding = !dbUser.organizationId;
        }
      }
      return session;
    },

    async signIn({ user, account }) {
      // Allow sign in - onboarding will handle org creation
      return true;
    },

    async redirect({ url, baseUrl }) {
      // Check if user needs onboarding after sign in
      if (url === baseUrl || url === `${baseUrl}/`) {
        return `${baseUrl}/dashboard`;
      }

      // Redirect to same origin only
      if (url.startsWith(baseUrl)) {
        return url;
      }

      return baseUrl;
    },
  },

  events: {
    async createUser({ user }) {
      // Log new user creation
      console.log(`New user created: ${user.email}`);
    },
  },

  debug: process.env.NODE_ENV === "development",
};

// Type augmentation for session
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      role?: string;
      organizationId?: string | null;
      organizationName?: string | null;
      organizationSlug?: string | null;
      needsOnboarding?: boolean;
    };
  }
}
