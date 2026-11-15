import { randomUUID } from 'node:crypto';
import type { ChunkDraft } from '../knowledge/chunker';

export interface UploadDraft {
  id: string;
  fileName: string;
  fileType: string;
  pages: number;
  chars: number;
  /** 已规范化的 Markdown 正文，确认入库时按原样写入 */
  markdown: string;
  chunks: ChunkDraft[];
  createdAt: number;
}

const TTL_MS = 15 * 60_000;
const MAX_DRAFTS = 20;

// 预览草稿只存在内存里，确认后写入语料目录；重启即失效，避免留下半成品
const drafts = new Map<string, UploadDraft>();

function sweep(now: number): void {
  for (const [id, draft] of drafts) {
    if (now - draft.createdAt > TTL_MS) drafts.delete(id);
  }
  while (drafts.size > MAX_DRAFTS) {
    const oldest = drafts.keys().next().value;
    if (oldest === undefined) break;
    drafts.delete(oldest);
  }
}

export function createDraft(input: Omit<UploadDraft, 'id' | 'createdAt'>): UploadDraft {
  const now = Date.now();
  sweep(now);

  const draft: UploadDraft = { ...input, id: randomUUID(), createdAt: now };
  drafts.set(draft.id, draft);
  return draft;
}

export function getDraft(id: string): UploadDraft | null {
  sweep(Date.now());
  return drafts.get(id) ?? null;
}

export function removeDraft(id: string): void {
  drafts.delete(id);
}
