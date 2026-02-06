/**
 * LLM Provider Factory
 *
 * Creates and manages LLM providers based on environment configuration.
 * Supports BYOM (Bring Your Own Model) with multiple providers:
 * - Anthropic (Claude)
 * - OpenAI (GPT-4, etc.)
 * - Ollama (local models)
 * - OpenAI-compatible APIs (Azure, Together, etc.)
 *
 * Environment Variables:
 *   KPH_LLM_PROVIDER: anthropic | openai | ollama | openai-compatible
 *   KPH_LLM_API_KEY: API key for the provider
 *   KPH_LLM_MODEL: Override default model (optional)
 *   KPH_LLM_ENDPOINT: Custom endpoint URL (required for ollama/openai-compatible)
 *
 * Backward Compatibility:
 *   ANTHROPIC_API_KEY still works when KPH_LLM_PROVIDER is not set
 */

import type { LLMConfig, LLMProvider } from './types';
import { AnthropicProvider } from './providers/anthropic';
import { OpenAIProvider } from './providers/openai';
import { getLLMEnv } from '../env';

function createLLMProvider(): LLMProvider | null {
  // Use runtime env access to prevent webpack inlining
  const env = getLLMEnv();

  // Backward compatibility: if no provider set but ANTHROPIC_API_KEY exists, use Anthropic
  if (!env.provider) {
    if (env.anthropicApiKey) {
      return new AnthropicProvider({
        provider: 'anthropic',
        apiKey: env.anthropicApiKey,
      });
    }
    return null; // LLM not configured
  }

  const config: LLMConfig = {
    provider: env.provider as LLMConfig['provider'],
    apiKey: env.apiKey,
    endpoint: env.endpoint,
    model: env.model,
  };

  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'openai':
    case 'ollama':
    case 'openai-compatible':
      return new OpenAIProvider(config);
    default:
      console.warn(`[llm] Unknown provider: ${env.provider}, LLM features disabled`);
      return null;
  }
}

// Lazy singleton
let _provider: LLMProvider | null | undefined;

/**
 * Get the configured LLM provider instance.
 * Returns null if LLM is not configured.
 */
export function getLLMProvider(): LLMProvider | null {
  if (_provider === undefined) {
    try {
      _provider = createLLMProvider();
      if (_provider) {
        const env = getLLMEnv();
        const providerName = env.provider ?? 'anthropic';
        const model = env.model ?? '(default)';
        console.log(`[llm] Provider initialized: ${providerName}, model: ${model}`);
      }
    } catch (error) {
      console.error('[llm] Failed to initialize provider:', error);
      _provider = null;
    }
  }
  return _provider;
}

/**
 * Check if LLM is configured and available.
 */
export function isLLMEnabled(): boolean {
  return getLLMProvider() !== null;
}

/**
 * Get LLM status information for API responses.
 */
export function getLLMStatus(): {
  enabled: boolean;
  provider: string | null;
  model: string | null;
} {
  const provider = getLLMProvider();
  const env = getLLMEnv();
  return {
    enabled: provider !== null,
    provider: provider
      ? (env.provider ?? (env.anthropicApiKey ? 'anthropic' : null))
      : null,
    model: provider ? (env.model ?? null) : null,
  };
}

// Re-export types
export type { LLMProvider, LLMConfig, LLMGenerateOptions, LLMResponse } from './types';
