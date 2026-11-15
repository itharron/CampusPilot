import { LLMError, type LLMProvider, type StreamRequest } from './provider';

interface Options {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

/**
 * OpenAI 兼容的 /chat/completions 流式实现。
 * 只要服务支持 data: {...choices[0].delta.content...} 形式的分片，就能直接接入。
 * Key 只存在于本进程内存中，永远不会出现在任何响应体里。
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly mode = 'live' as const;
  readonly model: string;

  constructor(private readonly options: Options) {
    this.model = options.model;
  }

  async *stream(req: StreamRequest, signal: AbortSignal): AsyncGenerator<string, void, unknown> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    const merged = AbortSignal.any([signal, timeout]);

    const response = await fetch(`${this.options.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model: this.options.model,
        messages: req.messages,
        stream: true,
        temperature: 0.3,
      }),
      signal: merged,
    });

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '');
      throw new LLMError(
        `模型服务返回 ${response.status}${detail ? `：${detail.slice(0, 120)}` : ''}`,
        response.status,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;

        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') return;

        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // 心跳行或非 JSON 分片，直接跳过
        }
      }
    }
  }
}
