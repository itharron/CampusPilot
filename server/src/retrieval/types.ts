/** 一条校园办事事项。字段与 handbook.md 的写法一一对应。 */
export interface ServiceDoc {
  id: string;
  title: string;
  keywords: string[];
  department: string;
  duration: string;
  entry: string;
  steps: string[];
  materials: string[];
  notes: string[];
}

export interface RetrievalHit {
  doc: ServiceDoc;
  score: number;
}

export interface SearchOptions {
  topK?: number;
  minScore?: number;
}

/**
 * 检索层接口。
 * 当前是关键词匹配实现；后续换成向量检索 / RAG 时，只要提供同样签名的实现，
 * 上层（意图识别、答案拼装、SSE 路由）完全不用改。
 */
export interface Retriever {
  readonly name: string;
  search(query: string, options?: SearchOptions): Promise<RetrievalHit[]>;
}
