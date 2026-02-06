/**
 * LLM Provider Types
 *
 * Defines the interface for LLM providers, enabling BYOM (Bring Your Own Model)
 * support for AI policy generation.
 */

export interface LLMConfig {
  provider: 'anthropic' | 'openai' | 'ollama' | 'openai-compatible';
  apiKey?: string;
  endpoint?: string; // Required for ollama and openai-compatible
  model?: string; // Override default model per provider
}

export interface LLMGenerateOptions {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
}

export interface LLMResponse {
  content: string;
  model: string;
  provider: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface LLMProvider {
  generate(options: LLMGenerateOptions): Promise<LLMResponse>;
}
