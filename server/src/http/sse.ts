import type { Response } from 'express';

type SseEvent = 'meta' | 'delta' | 'done' | 'error';

export interface SseStream {
  send(event: SseEvent, data: unknown): void;
  close(): void;
  readonly closed: boolean;
}

/**
 * 打开一条 SSE 通道。
 * 约定：meta → 若干 delta → done / error，事件之间用空行分隔，前端按 "\n\n" 切分。
 */
export function openSse(res: Response): SseStream {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // 关掉 Nginx 等反代的缓冲，否则前端会一次性收到整段内容
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  let closed = false;

  return {
    send(event, data) {
      if (closed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    close() {
      if (closed) return;
      closed = true;
      res.end();
    },
    get closed() {
      return closed;
    },
  };
}

/** 取客户端 IP：优先信任反代写入的 x-forwarded-for，便于本地/部署环境都能限流 */
export function getClientIp(headerValue: string | undefined, socketAddress: string | undefined): string {
  const forwarded = headerValue?.split(',')[0]?.trim();
  return forwarded || socketAddress || 'unknown';
}
