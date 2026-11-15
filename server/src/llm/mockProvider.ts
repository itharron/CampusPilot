import type { LLMProvider, StreamRequest } from './provider';

const CHUNK_SIZE = 2;
const DELAY_MS = 16;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 未配置 API Key 时的降级实现：不调用任何外部服务，
 * 直接把检索 + 模板层算好的答案分小块吐出来，保持与真实模型一致的流式体验。
 * 目的只有一个：没有 Key 也能把"输入一句话 → 看到逐字回复"这条链路演示完整。
 */
export class MockProvider implements LLMProvider {
  readonly mode = 'mock' as const;
  readonly model = 'campus-pilot-mock';

  async *stream(req: StreamRequest, signal: AbortSignal): AsyncGenerator<string, void, unknown> {
    const text = req.fallbackText || '（mock 模式暂时没有可用的答案，请稍后再试）';

    for (let index = 0; index < text.length; index += CHUNK_SIZE) {
      if (signal.aborted) return;
      yield text.slice(index, index + CHUNK_SIZE);
      await sleep(DELAY_MS);
    }
  }
}
