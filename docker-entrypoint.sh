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

# --- Database Migrations ---
if [ "$KPH_AUTO_MIGRATE" = "true" ]; then
  echo "[entrypoint] Running database migrations..."
  npx prisma migrate deploy
  echo "[entrypoint] Migrations complete."
  echo ""
fi

# --- Auth Mode Banner ---
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
else
  echo "[entrypoint] Auth provider: $AUTH_PROVIDER"
  echo ""
fi

# --- Start Application ---
echo "[entrypoint] Starting KPH server..."
exec node server.js
