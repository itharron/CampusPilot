import { loadHandbook } from './handbook';
import type { RetrievalHit, Retriever, SearchOptions, ServiceDoc } from './types';

/**
 * 关键词检索：命中关键词累加分数，命中标题额外加权。
 * 结构上完全遵守 Retriever 接口，后续替换为向量/RAG 实现时不影响调用方。
 */
export class KeywordRetriever implements Retriever {
  readonly name = 'keyword';
  private readonly docs: ServiceDoc[];

  constructor(docs: ServiceDoc[] = loadHandbook()) {
    this.docs = docs;
  }

  async search(query: string, options: SearchOptions = {}): Promise<RetrievalHit[]> {
    const { topK = 3, minScore = 1 } = options;
    const text = query.toLowerCase();

    const hits: RetrievalHit[] = [];

    for (const doc of this.docs) {
      let score = 0;

      for (const keyword of doc.keywords) {
        const normalized = keyword.toLowerCase();
        if (!normalized) continue;
        if (text.includes(normalized)) {
          // 关键词越长越具体，权重越高（最多按 4 个字封顶）
          score += 2 + Math.min(normalized.length, 4) * 0.5;
        }
      }

      if (text.includes(doc.title.toLowerCase())) {
        score += 4;
      }

      if (score >= minScore) {
        hits.push({ doc, score: Number(score.toFixed(2)) });
      }
    }

    return hits.sort((a, b) => b.score - a.score).slice(0, topK);
  }
}
