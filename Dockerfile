# =============================================================================
# KPH (Kubernetes Policy Hub) - Production Dockerfile
# =============================================================================
# Multi-stage build for optimized production image
# Produces a standalone Next.js application (~150MB)
#
# Auth is OPTIONAL - builds without Clerk keys by default (anonymous mode)
# =============================================================================

# --- Base ---
FROM node:20-alpine AS base
# Install libc6-compat for Alpine compatibility
# Install openssl for Prisma (Alpine 3.19+ uses OpenSSL 3.x)
RUN apk add --no-cache libc6-compat openssl openssl-dev

# --- Dependencies ---
FROM base AS deps
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./
COPY prisma ./prisma/

# Install all dependencies (including devDependencies for build)
RUN npm ci

# --- Builder ---
FROM base AS builder
WORKDIR /app

# Build-time auth provider configuration
# Default to "none" (anonymous mode) - no Clerk keys required
ARG KPH_AUTH_PROVIDER=none
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=""
ARG CLERK_SECRET_KEY=""

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Disable Next.js telemetry
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Prisma needs DATABASE_URL at build time for type generation
# Use a dummy URL that satisfies Prisma's format check
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"

# Auth configuration for build
# When KPH_AUTH_PROVIDER=none (default), Clerk is not loaded
ENV KPH_AUTH_PROVIDER=${KPH_AUTH_PROVIDER}
ENV NEXT_PUBLIC_KPH_AUTH_PROVIDER=${KPH_AUTH_PROVIDER}

# Only set Clerk keys if provider is clerk
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
ENV CLERK_SECRET_KEY=${CLERK_SECRET_KEY}

# Generate Prisma client
RUN npx prisma generate

# Build the Next.js application
RUN npm run build

# --- Runner ---
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV KPH_DOCKER=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy public assets
COPY --from=builder /app/public ./public

# Copy standalone output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy Prisma schema and migrations for runtime migration support
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma

# Copy tsx for running seed script
COPY --from=builder /app/node_modules/tsx ./node_modules/tsx
COPY --from=builder /app/node_modules/esbuild ./node_modules/esbuild
COPY --from=builder /app/node_modules/esbuild-* ./node_modules/
COPY --from=builder /app/node_modules/get-tsconfig ./node_modules/get-tsconfig
COPY --from=builder /app/node_modules/resolve-pkg-maps ./node_modules/resolve-pkg-maps

# Copy entrypoint script
COPY --from=builder /app/docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Switch to non-root user
USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
