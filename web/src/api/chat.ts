import type { ChatDone, ChatErrorEvent, ChatMeta, ServerMeta } from '../types';

export interface ChatErrorPayload {
  code: string;
  message: string;
  category?: string;
  retryAfterSeconds?: number;
}

/** 后端在流开始前就拒绝（限流 / 拦截 / 额度用尽）时抛这个错误，前端据此给出明确反馈 */
export class ChatRequestError extends Error {
  constructor(readonly payload: ChatErrorPayload) {
    super(payload.message);
    this.name = 'ChatRequestError';
  }
}

export interface StreamHandlers {
  onMeta?: (meta: ChatMeta) => void;
  onDelta: (text: string) => void;
  onDone?: (done: ChatDone) => void;
  onError?: (error: ChatErrorEvent) => void;
}

/** 读取后端 /api/meta，用于页面初始化时展示模式与剩余额度 */
export async function fetchMeta(): Promise<ServerMeta> {
  const response = await fetch('/api/meta');
  if (!response.ok) {
    throw new ChatRequestError({ code: 'META_FAILED', message: `无法读取服务状态（${response.status}）` });
  }
  return (await response.json()) as ServerMeta;
}

/**
 * 用 fetch + ReadableStream 读 SSE。
 * 用 POST 是为了不把问题拼在 URL 上；事件格式由后端约定为 meta / delta / done / error。
 */
export async function streamChat(
  message: string,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
    signal,
  });

  if (!response.ok) {
    const fallback: ChatErrorPayload = {
      code: 'HTTP_ERROR',
      message: `请求失败（${response.status}），请稍后重试。`,
    };
    const payload = (await response.json().catch(() => fallback)) as Partial<ChatErrorPayload>;
    throw new ChatRequestError({
      code: payload.code ?? fallback.code,
      message: payload.message ?? fallback.message,
      category: payload.category,
      retryAfterSeconds: payload.retryAfterSeconds,
    });
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new ChatRequestError({ code: 'NO_BODY', message: '服务端没有返回流式内容。' });
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      dispatch(chunk, handlers);
      boundary = buffer.indexOf('\n\n');
    }
  }
}

function dispatch(chunk: string, handlers: StreamHandlers): void {
  let event = 'message';
  const dataLines: string[] = [];

  for (const line of chunk.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }

  if (!dataLines.length) return;

  let payload: unknown;
  try {
    payload = JSON.parse(dataLines.join('\n'));
  } catch {
    return;
  }

  if (event === 'meta') handlers.onMeta?.(payload as ChatMeta);
  else if (event === 'delta') handlers.onDelta((payload as { text: string }).text ?? '');
  else if (event === 'done') handlers.onDone?.(payload as ChatDone);
  else if (event === 'error') handlers.onError?.(payload as ChatErrorEvent);
}
