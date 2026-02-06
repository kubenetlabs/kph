import OpenAI from 'openai';
import type { LLMProvider, LLMConfig, LLMGenerateOptions, LLMResponse } from '../types';

const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o-mini',
  ollama: 'llama3.2',
  'openai-compatible': 'gpt-4o-mini',
};

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;
  private providerName: string;

  constructor(config: LLMConfig) {
    const isOllama = config.provider === 'ollama';

    // API key not required for Ollama (local), but required for OpenAI
    if (!isOllama && !config.apiKey) {
      throw new Error(`${config.provider} API key is required`);
    }

    this.client = new OpenAI({
      apiKey: config.apiKey ?? 'ollama', // Ollama doesn't need a real key
      ...(config.endpoint && { baseURL: config.endpoint }),
      // Default endpoint for Ollama if not specified
      ...(isOllama && !config.endpoint && { baseURL: 'http://localhost:11434/v1' }),
    });

    this.model = config.model ?? DEFAULT_MODELS[config.provider] ?? 'gpt-4o-mini';
    this.providerName = config.provider;
  }

  async generate(options: LLMGenerateOptions): Promise<LLMResponse> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: options.maxTokens ?? 4096,
      messages: [
        { role: 'system', content: options.systemPrompt },
        { role: 'user', content: options.userPrompt },
      ],
    });

    return {
      content: response.choices[0]?.message?.content ?? '',
      model: this.model,
      provider: this.providerName,
      usage: response.usage
        ? {
            inputTokens: response.usage.prompt_tokens,
            outputTokens: response.usage.completion_tokens,
          }
        : undefined,
    };
  }
}
