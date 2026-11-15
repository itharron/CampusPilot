import type { RetrievalHit } from './retrieval/types';

export interface IntentResult {
  id: string;
  label: string;
  confidence: number;
}

/**
 * 意图识别：取检索得分最高的片段所属事项作为意图。
 * 置信度用「第一名文档与第二名文档的分差」估算，语料只命中一篇时接近 0.99。
 * 将来换成分类模型时，保持这个返回结构即可。
 */
export function recognizeIntent(hits: RetrievalHit[]): IntentResult {
  const groups = groupHitsByDoc(hits);
  const top = groups[0];
  if (!top) {
    return { id: 'unknown', label: '未识别', confidence: 0 };
  }

  // 置信度看的是「第一名与第二名文档的差距」，而不是归一化后的绝对分
  const runnerUp = groups[1]?.score ?? 0;
  const margin = top.score > 0 ? (top.score - runnerUp) / top.score : 0;
  const confidence = Number(Math.min(0.99, Math.max(0.4, 0.55 + 0.44 * margin)).toFixed(2));

  return { id: top.docId, label: top.title, confidence };
}

/** 把片段命中按文档聚合，分数取该文档命中片段的最高分 */
export function groupHitsByDoc(hits: RetrievalHit[]): Array<{ docId: string; title: string; score: number; hits: RetrievalHit[] }> {
  const grouped = new Map<string, { docId: string; title: string; score: number; hits: RetrievalHit[] }>();

  for (const hit of hits) {
    const existing = grouped.get(hit.chunk.docId);
    if (existing) {
      existing.hits.push(hit);
      existing.score = Math.max(existing.score, hit.score);
    } else {
      grouped.set(hit.chunk.docId, {
        docId: hit.chunk.docId,
        title: hit.chunk.docTitle,
        score: hit.score,
        hits: [hit],
      });
    }
  }

  return [...grouped.values()].sort((a, b) => b.score - a.score);
}
