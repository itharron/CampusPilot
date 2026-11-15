export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInMs: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * 按 IP 的固定窗口限流。
 * 单机内存实现，够第一版用；要横向扩展时把 consume 换成 Redis 计数即可。
 */
export class IpRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly options: { windowMs: number; max: number }) {}

  consume(key: string): RateLimitResult {
    const now = Date.now();
    this.sweep(now);

    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.options.windowMs });
      return { allowed: true, remaining: this.options.max - 1, resetInMs: this.options.windowMs };
    }

    bucket.count += 1;
    const remaining = Math.max(0, this.options.max - bucket.count);

    return {
      allowed: bucket.count <= this.options.max,
      remaining,
      resetInMs: bucket.resetAt - now,
    };
  }

  /** 清掉过期桶，避免长期运行内存单调增长 */
  private sweep(now: number): void {
    if (this.buckets.size < 1000) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
