/**
 * 可选的向量检索接口。
 *
 * 设计原则：默认不启用，也不在本地下载或加载任何模型权重。
 * 只有在环境变量里配置了 EMBEDDING_MODEL + EMBEDDING_API_KEY（可复用 LLM_API_KEY）时，
 * 才会调用 OpenAI 兼容的 /embeddings 接口；没有配置就纯 BM25 运行。
 */

export interface EmbeddingProvider {
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
}

class OpenAICompatibleEmbedding implements EmbeddingProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    readonly model: string,
    private readonly timeoutMs: number,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`embedding 接口返回 ${response.status}：${detail.slice(0, 200)}`);
    }

    const payload = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
    const vectors = (payload.data ?? []).map((item) => item.embedding ?? []);
    if (vectors.length !== texts.length || vectors.some((vector) => vector.length === 0)) {
      throw new Error('embedding 接口返回的向量数量或维度异常');
    }
    return vectors;
  }
}

export function createEmbeddingProvider(): EmbeddingProvider | null {
  const model = process.env.EMBEDDING_MODEL?.trim();
  const apiKey = (process.env.EMBEDDING_API_KEY ?? process.env.LLM_API_KEY ?? '').trim();
  if (!model || !apiKey) return null;

  const baseUrl = (process.env.EMBEDDING_BASE_URL ?? process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1').replace(
    /\/+$/,
    '',
  );

  return new OpenAICompatibleEmbedding(baseUrl, apiKey, model, 20_000);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);

  for (let index = 0; index < length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }

  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
