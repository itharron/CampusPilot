export interface CachedAnswer {
  text: string;
  intentLabel: string;
  topDocTitle: string | null;
  createdAt: number;
}

/** 相同问题归一化：去掉空白与常见标点、忽略大小写，让「宿舍空调坏了」与「宿舍空调坏了！」命中同一条缓存 */
export function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[。．.，,！!？?～~…、；;：:"'“”‘’]/g, '');
}

/**
 * 答案缓存：相同问题直接回放上次结果，既不重复消耗模型额度，也更快。
 * 内存 LRU（按插入顺序淘汰），重启后自然清空。
 */
export class AnswerCache {
  private readonly store = new Map<string, CachedAnswer>();
  private hitCount = 0;
  private missCount = 0;

  constructor(private readonly options: { ttlMs: number; maxEntries: number }) {}

  get(question: string): CachedAnswer | null {
    const key = normalizeQuestion(question);
    const entry = this.store.get(key);

    if (!entry) {
      this.missCount += 1;
      return null;
    }

    if (Date.now() - entry.createdAt > this.options.ttlMs) {
      this.store.delete(key);
      this.missCount += 1;
      return null;
    }

    // 命中后移到队尾，实现最简 LRU
    this.store.delete(key);
    this.store.set(key, entry);
    this.hitCount += 1;
    return entry;
  }

  set(question: string, value: Omit<CachedAnswer, 'createdAt'>): void {
    const key = normalizeQuestion(question);
    if (!key) return;

    this.store.delete(key);
    this.store.set(key, { ...value, createdAt: Date.now() });

    while (this.store.size > this.options.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  stats(): { size: number; hits: number; misses: number } {
    return { size: this.store.size, hits: this.hitCount, misses: this.missCount };
  }
}
