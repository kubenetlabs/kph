import { NextResponse } from "next/server";
import { getLLMStatus } from "~/lib/llm";
import { getLLMEnv } from "~/lib/env";

// Force dynamic rendering - evaluate env vars at runtime, not build time
export const dynamic = "force-dynamic";

/**
 * GET /api/status/llm
 *
 * Returns the current LLM configuration status.
 * Used by the UI to determine whether to show AI features.
 */
export async function GET() {
  const status = getLLMStatus();
  const env = getLLMEnv();

  // Include debug info in response (temporary)
  const debug = {
    KPH_LLM_PROVIDER: env.provider ?? null,
    KPH_LLM_API_KEY: env.apiKey ? "SET" : null,
    ANTHROPIC_API_KEY: env.anthropicApiKey ? "SET" : null,
  };

  return NextResponse.json({
    ...status,
    features: {
      policyGeneration: status.enabled,
    },
    docs: status.enabled ? null : "https://github.com/kubenetlabs/kph/docs/byom-llm-setup.md",
    _debug: debug,
  });
}
