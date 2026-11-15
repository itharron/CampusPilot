export interface QuotaSnapshot {
  requests: number;
  tokens: number;
  remainingRequests: number;
  remainingTokens: number;
}

export interface QuotaDecision {
  allowed: boolean;
  message?: string;
  snapshot: QuotaSnapshot;
}

interface Usage {
  day: string;
  requests: number;
  tokens: number;
}

/**
 * 每日成本护栏：按 IP 统计当天请求数与 token 消耗（估算）。
 * 超限直接拒绝，不再调用模型，避免被刷爆 Key 的额度。
 */
export class DailyQuota {
  private readonly usage = new Map<string, Usage>();

  constructor(private readonly options: { dailyRequests: number; dailyTokens: number }) {}

  private today(): string {
    // 用 UTC 日期做分界，避免服务器时区差异导致"每天"被重置多次
    return new Date().toISOString().slice(0, 10);
  }

  private entryFor(key: string): Usage {
    const day = this.today();
    const existing = this.usage.get(key);
    if (!existing || existing.day !== day) {
      const fresh: Usage = { day, requests: 0, tokens: 0 };
      this.usage.set(key, fresh);
      return fresh;
    }
    return existing;
  }

  private toSnapshot(usage: Usage): QuotaSnapshot {
    return {
      requests: usage.requests,
      tokens: usage.tokens,
      remainingRequests: Math.max(0, this.options.dailyRequests - usage.requests),
      remainingTokens: Math.max(0, this.options.dailyTokens - usage.tokens),
    };
  }

  /** 占用一次请求额度；超限时返回 allowed=false 与可展示的提示语 */
  reserve(key: string): QuotaDecision {
    const usage = this.entryFor(key);

    if (usage.requests >= this.options.dailyRequests) {
      return {
        allowed: false,
        message: `今天的免费查询次数已用完（每人每天 ${this.options.dailyRequests} 次），明天再来，或联系人工服务台。`,
        snapshot: this.toSnapshot(usage),
      };
    }

    if (usage.tokens >= this.options.dailyTokens) {
      return {
        allowed: false,
        message: '今天的查询额度已用完，明天会自动恢复；紧急事项请直接联系人工服务台。',
        snapshot: this.toSnapshot(usage),
      };
    }

    usage.requests += 1;
    return { allowed: true, snapshot: this.toSnapshot(usage) };
  }

  /** 记录本次回答消耗的 token 估算值 */
  addTokens(key: string, tokens: number): void {
    const usage = this.entryFor(key);
    usage.tokens += Math.max(0, tokens);
  }

  snapshot(key: string): QuotaSnapshot {
    return this.toSnapshot(this.entryFor(key));
  }
}
