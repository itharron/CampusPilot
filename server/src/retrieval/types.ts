import type { Chunk } from '../knowledge/types';

export interface RetrievalHit {
  chunk: Chunk;
  /** 归一化后的最终得分，0-1 */
  score: number;
  /** BM25 原始分（归一化前） */
  lexicalScore: number;
  /** 向量余弦相似度，未启用向量检索时为空 */
  vectorScore?: number;
  matchedTerms: string[];
}

export interface SearchOptions {
  topK?: number;
  minScore?: number;
}

/**
 * 检索层接口。
 * 当前实现是 BM25（可选叠加向量相似度）；将来换成别的实现，
 * 只要保持同样的签名，路由、答案拼装与前端都不用改。
 */
export interface Retriever {
  readonly name: string;
  search(query: string, options?: SearchOptions): Promise<RetrievalHit[]>;
  /** 语料变更后重建索引（上传入库时调用） */
  refresh?(): void;
}
