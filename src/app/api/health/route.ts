/**
 * Health Check Endpoint
 *
 * Provides comprehensive health status including:
 * - Database connectivity
 * - Auth provider configuration
 * - LLM provider configuration
 * - Email provider configuration
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface HealthStatus {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  uptime: number;
  database: {
    connected: boolean;
    error?: string;
  };
  auth: {
    provider: string;
    configured: boolean;
  };
  llm: {
    enabled: boolean;
    provider: string | null;
    configured: boolean;
  };
  email: {
    provider: string;
    configured: boolean;
  };
}

export async function GET() {
  const startTime = Date.now();

  const authProvider = process.env.KPH_AUTH_PROVIDER ?? 'none';
  const emailProvider = process.env.KPH_EMAIL_PROVIDER ?? 'none';

  const health: HealthStatus = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: {
      connected: false,
    },
    auth: {
      provider: authProvider,
      configured: false,
    },
    llm: {
      enabled: false,
      provider: null,
      configured: false,
    },
    email: {
      provider: emailProvider,
      configured: false,
    },
  };

  try {
    // Check database connectivity
    const { db } = await import('~/lib/db');
    await db.$queryRaw`SELECT 1`;
    health.database.connected = true;

    // Check auth provider
    health.auth.configured = authProvider !== 'none';

    // Check LLM provider
    const llmProviderEnv = process.env.KPH_LLM_PROVIDER;
    if (llmProviderEnv) {
      const llm = await import('~/lib/llm');
      const llmProvider = llm.getLLMProvider();
      if (llmProvider) {
        health.llm.enabled = true;
        health.llm.provider = llmProviderEnv;
        health.llm.configured = true;
      }
    }

    // Check email provider
    health.email.configured = emailProvider !== 'none';

    // Determine overall status
    if (!health.database.connected) {
      health.status = 'error';
    }

    const responseTime = Date.now() - startTime;

    return NextResponse.json(
      {
        ...health,
        responseTime: `${responseTime}ms`,
      },
      {
        status: health.status === 'error' ? 503 : 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (error) {
    health.status = 'error';
    health.database.error = error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.json(health, {
      status: 503,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  }
}
