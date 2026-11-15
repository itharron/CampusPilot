import type { RetrievalHit } from './retrieval/types';

export interface IntentResult {
  id: string;
  label: string;
  confidence: number;
}

/**
 * 意图识别（第一版）：直接取检索最高分的事项作为意图。
 * 这一步现在很简单，但接口形态（输入检索结果，输出 id/label/confidence）
 * 已经预留好换成分类模型或大模型意图识别的位置。
 */
export function recognizeIntent(hits: RetrievalHit[]): IntentResult {
  const top = hits[0];
  if (!top) {
    return { id: 'unknown', label: '未识别', confidence: 0 };
  }
  const confidence = Math.min(1, Number((top.score / 8).toFixed(2)));
  return { id: top.doc.id, label: top.doc.title, confidence };
}
