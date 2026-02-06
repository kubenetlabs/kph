#!/bin/sh
# =============================================================================
# KPH Docker Entrypoint
# =============================================================================
# Handles database migrations and default auth seeding before starting the app
# =============================================================================

set -e

echo "========================================"
echo "  KPH (Kubernetes Policy Hub)"
echo "========================================"
echo ""

# --- Database Setup ---
if [ "$KPH_AUTO_MIGRATE" = "true" ]; then
  echo "[entrypoint] Running database migrations..."
  node node_modules/prisma/build/index.js migrate deploy
  echo "[entrypoint] Migrations complete."
  echo ""
elif [ "$KPH_DB_PUSH" = "true" ]; then
  echo "[entrypoint] Pushing database schema (dev mode)..."
  node node_modules/prisma/build/index.js db push --skip-generate
  echo "[entrypoint] Schema push complete."
  echo ""
fi

# --- Auth Mode Banner and Seeding ---
AUTH_PROVIDER="${KPH_AUTH_PROVIDER:-none}"

if [ "$AUTH_PROVIDER" = "none" ]; then
  echo "========================================"
  echo "  ANONYMOUS MODE (no authentication)"
  echo "========================================"
  echo ""
  echo "  All users will be logged in as the"
  echo "  default admin. Suitable for:"
  echo "    - Local development"
  echo "    - Single-user deployments"
  echo "    - Behind VPN/reverse proxy"
  echo ""
  echo "  To enable authentication, set:"
  echo "    KPH_AUTH_PROVIDER=clerk"
  echo ""
  echo "========================================"
  echo ""

  # Seed default org and admin user for no-auth mode
  # This is idempotent and safe for multi-replica deployments
  echo "[entrypoint] Seeding default organization and admin user..."
  node --import tsx prisma/seed-default-auth.ts || {
    echo "[entrypoint] Warning: Seed script encountered an error"
    echo "[entrypoint] This is expected in multi-replica starts - one pod will succeed"
  }
  echo ""
else
  echo "[entrypoint] Auth provider: $AUTH_PROVIDER"
  echo ""
fi

# --- Debug Info ---
if [ -n "$KPH_DEBUG" ]; then
  echo "[entrypoint] Debug - ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:+SET}"
  echo "[entrypoint] Debug - KPH_LLM_PROVIDER: ${KPH_LLM_PROVIDER:-not set}"
  echo "[entrypoint] Debug - KPH_AUTH_PROVIDER: ${KPH_AUTH_PROVIDER:-none}"
fi

# --- Start Application ---
echo "[entrypoint] Starting KPH server..."
exec node server.js
