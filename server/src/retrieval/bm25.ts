import type { Chunk } from '../knowledge/types';
import { tokenize } from './tokenizer';
import type { RetrievalHit } from './types';

interface IndexedChunk {
  chunk: Chunk;
  termFrequency: Map<string, number>;
  length: number;
}

const K1 = 1.2;
const B = 0.75;

/** 参与索引的文本：事项标题权重最高（重复三次），其次章、条、小节标题 */
function indexText(chunk: Chunk): string {
  return [chunk.docTitle, chunk.docTitle, chunk.docTitle, chunk.chapter, chunk.article, chunk.section, chunk.text]
    .filter(Boolean)
    .join('\n');
}

/**
 * BM25：不依赖任何模型文件，内存建索引，毫秒级检索。
 * 中文靠 tokenizer 的「单字 + 双字」近似分词。
 */
export class Bm25Index {
  private readonly entries: IndexedChunk[] = [];
  private readonly documentFrequency = new Map<string, number>();
  private readonly averageLength: number;

  constructor(chunks: Chunk[]) {
    let totalLength = 0;

    for (const chunk of chunks) {
      const tokens = tokenize(indexText(chunk));
      const termFrequency = new Map<string, number>();

      for (const token of tokens) {
        termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
      }
      for (const term of termFrequency.keys()) {
        this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1);
      }

      this.entries.push({ chunk, termFrequency, length: tokens.length });
      totalLength += tokens.length;
    }

    this.averageLength = this.entries.length ? totalLength / this.entries.length : 0;
  }

  get size(): number {
    return this.entries.length;
  }

  search(tokens: string[], topK: number): RetrievalHit[] {
    const queryTerms = [...new Set(tokens)];
    if (!queryTerms.length || !this.entries.length) return [];

    const hits: RetrievalHit[] = [];
    const total = this.entries.length;
    const averageLength = this.averageLength || 1;

    for (const entry of this.entries) {
      let score = 0;
      const matched: string[] = [];

      for (const term of queryTerms) {
        const tf = entry.termFrequency.get(term);
        if (!tf) continue;

        const df = this.documentFrequency.get(term) ?? 0;
        const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
        const denominator = tf + K1 * (1 - B + (B * entry.length) / averageLength);
        score += (idf * tf * (K1 + 1)) / denominator;
        matched.push(term);
      }

      if (score <= 0) continue;

      // 命中查询里更长的词（双字）说明更具体，给一点额外权重
      const specificBoost = matched.filter((term) => term.length > 1).length * 0.15;
      const finalScore = score + specificBoost;

      hits.push({
        chunk: entry.chunk,
        score: finalScore,
        lexicalScore: Number(finalScore.toFixed(4)),
        matchedTerms: matched.sort((a, b) => b.length - a.length).slice(0, 6),
      });
    }

    return hits.sort((a, b) => b.score - a.score).slice(0, topK);
  }
}
