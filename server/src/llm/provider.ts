import { config, hasLiveModel } from '../config';
import { MockProvider } from './mockProvider';
import { OpenAICompatibleProvider } from './openaiProvider';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface StreamRequest {
  messages: ChatMessage[];
  /**
   * 本地模板答案（由检索结果拼装）。
   * mock 模式直接把它流式吐出来，真实模型则忽略它，
   * 这样"没有 Key 也能完整演示"和"有 Key 走真模型"共用同一套上层流程。
   */
  fallbackText: string;
}

export type ProviderMode = 'mock' | 'live';

export interface LLMProvider {
  readonly mode: ProviderMode;
  readonly model: string;
  stream(req: StreamRequest, signal: AbortSignal): AsyncGenerator<string, void, unknown>;
}

export class LLMError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'LLMError';
  }
}

export function createProvider(): LLMProvider {
  if (!hasLiveModel()) {
    return new MockProvider();
  }
  return new OpenAICompatibleProvider({
    apiKey: config.llm.apiKey,
    baseUrl: config.llm.baseUrl,
    model: config.llm.model,
    timeoutMs: config.llm.timeoutMs,
  });
}
