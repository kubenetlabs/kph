import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMConfig, LLMGenerateOptions, LLMResponse } from '../types';

const DEFAULT_MODEL = 'claude-3-haiku-20240307';

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;

  constructor(config: LLMConfig) {
    if (!config.apiKey) {
      throw new Error('Anthropic API key is required');
    }
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model ?? DEFAULT_MODEL;
  }

  async generate(options: LLMGenerateOptions): Promise<LLMResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: options.maxTokens ?? 4096,
      system: options.systemPrompt,
      messages: [{ role: 'user', content: options.userPrompt }],
    });

    const content = response.content[0];
    const text = content?.type === 'text' ? content.text : '';

    return {
      content: text,
      model: this.model,
      provider: 'anthropic',
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}
