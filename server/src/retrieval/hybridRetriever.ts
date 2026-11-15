import type { KnowledgeStore } from '../knowledge/store';
import type { Chunk } from '../knowledge/types';
import { Bm25Index } from './bm25';
import { cosineSimilarity, createEmbeddingProvider, type EmbeddingProvider } from './embedding';
import { tokenize } from './tokenizer';
import type { RetrievalHit, Retriever, SearchOptions } from './types';

const LEXICAL_WEIGHT = 0.65;
const VECTOR_WEIGHT = 0.35;
const EMBED_BATCH = 16;
const QUERY_CACHE_LIMIT = 100;

/**
 * 混合检索：
 * - 默认纯 BM25（无需任何模型权重，当前环境直接可跑）；
 * - 配置了 EMBEDDING_MODEL + Key 后自动叠加向量相似度，两者归一化加权合并；
 * - 向量接口调用失败时自动退回 BM25，不影响回答主链路。
 */
export class HybridRetriever implements Retriever {
  private readonly embedding: EmbeddingProvider | null;
  private bm25: Bm25Index;
  private chunksById: Map<string, Chunk>;
  private vectors: Map<string, number[]> | null = null;
  private building = false;
  private vectorNote = '未配置 EMBEDDING_MODEL，使用 BM25';
  private readonly queryVectors = new Map<string, number[]>();

  constructor(
    private readonly store: KnowledgeStore,
    embedding: EmbeddingProvider | null = createEmbeddingProvider(),
  ) {
    this.embedding = embedding;
    this.bm25 = new Bm25Index(store.allChunks());
    this.chunksById = new Map(store.allChunks().map((chunk) => [chunk.id, chunk]));
    if (this.embedding) {
      this.vectorNote = '向量索引构建中';
      void this.buildVectors();
    }
  }

  get name(): string {
    return this.vectors && this.embedding ? 'hybrid(bm25+vector)' : 'bm25';
  }

  get status(): { name: string; vector: string } {
    return { name: this.name, vector: this.vectorNote };
  }

  /** 语料变更后重建索引：BM25 立即生效，向量索引在后台重建 */
  refresh(): void {
    const chunks = this.store.allChunks();
    this.bm25 = new Bm25Index(chunks);
    this.chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    this.vectors = null;
    this.queryVectors.clear();
    if (this.embedding) {
      this.vectorNote = '向量索引重建中';
      void this.buildVectors();
    }
  }

  private async buildVectors(): Promise<void> {
    if (!this.embedding || this.building) return;
    this.building = true;

    try {
      const chunks = this.store.allChunks();
      const vectors = new Map<string, number[]>();

      for (let index = 0; index < chunks.length; index += EMBED_BATCH) {
        const batch = chunks.slice(index, index + EMBED_BATCH);
        const embedded = await this.embedding.embed(
          batch.map((chunk) => `${chunk.docTitle}\n${chunk.chapter} ${chunk.section}\n${chunk.text}`.slice(0, 2000)),
        );
        batch.forEach((chunk, offset) => vectors.set(chunk.id, embedded[offset]));
      }

      this.vectors = vectors;
      this.vectorNote = `已建立 ${vectors.size} 个片段的向量索引`;
    } catch (error) {
      this.vectors = null;
      this.vectorNote = `向量索引不可用，已退回 BM25：${(error as Error).message.slice(0, 80)}`;
      console.warn('[retrieval]', this.vectorNote);
    } finally {
      this.building = false;
    }
  }

  private async embedQuery(query: string): Promise<number[] | null> {
    if (!this.embedding) return null;

    const cached = this.queryVectors.get(query);
    if (cached) return cached;

    const [vector] = await this.embedding.embed([query]);
    if (!vector) return null;

    if (this.queryVectors.size >= QUERY_CACHE_LIMIT) {
      const oldest = this.queryVectors.keys().next().value;
      if (oldest !== undefined) this.queryVectors.delete(oldest);
    }
    this.queryVectors.set(query, vector);
    return vector;
  }

  async search(query: string, options: SearchOptions = {}): Promise<RetrievalHit[]> {
    const { topK = 4, minScore = 0 } = options;
    const tokens = tokenize(query);
    const lexicalHits = this.bm25.search(tokens, Math.max(topK * 4, 16));

    const maxLexical = lexicalHits[0]?.lexicalScore ?? 0;
    const lexicalOnly = (): RetrievalHit[] =>
      lexicalHits
        .map((hit) => ({ ...hit, score: maxLexical ? Number((hit.lexicalScore / maxLexical).toFixed(3)) : 0 }))
        .filter((hit) => hit.score > minScore)
        .slice(0, topK);

    if (!this.vectors || !this.embedding) return lexicalOnly();

    let queryVector: number[] | null = null;
    try {
      queryVector = await this.embedQuery(query);
    } catch (error) {
      this.vectorNote = `查询向量化失败，本次使用 BM25：${(error as Error).message.slice(0, 60)}`;
      return lexicalOnly();
    }
    if (!queryVector) return lexicalOnly();

    const merged = new Map<string, RetrievalHit>();

    for (const hit of lexicalHits) {
      merged.set(hit.chunk.id, {
        ...hit,
        score: LEXICAL_WEIGHT * (maxLexical ? hit.lexicalScore / maxLexical : 0),
        vectorScore: 0,
      });
    }

    const vectorRanking = [...this.vectors.entries()]
      .map(([id, vector]) => ({ id, similarity: Math.max(0, cosineSimilarity(queryVector, vector)) }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, Math.max(topK * 4, 16));

    for (const { id, similarity } of vectorRanking) {
      const chunk = this.chunksById.get(id);
      if (!chunk) continue;

      const existing = merged.get(id);
      if (existing) {
        existing.vectorScore = Number(similarity.toFixed(3));
        existing.score = Number((existing.score + VECTOR_WEIGHT * similarity).toFixed(3));
        continue;
      }

      merged.set(id, {
        chunk,
        lexicalScore: 0,
        vectorScore: Number(similarity.toFixed(3)),
        score: Number((VECTOR_WEIGHT * similarity).toFixed(3)),
        matchedTerms: [],
      });
    }

    return [...merged.values()]
      .filter((hit) => hit.score > minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}
