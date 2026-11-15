export interface KbChunkPreview {
  index: number;
  heading: string;
  chars: number;
  preview: string;
}

export interface KbSuggestions {
  title: string;
  document: string;
  chapter: string;
  article: string;
  category: string;
  department: string;
}

export interface KbPreview {
  ok: true;
  draftId: string;
  fileName: string;
  fileType: string;
  pages: number;
  chars: number;
  chunkCount: number;
  chunks: KbChunkPreview[];
  suggestions: KbSuggestions;
}

export interface KbConfirmPayload {
  draftId: string;
  title: string;
  document: string;
  chapter: string;
  article: string;
  category: string;
  department: string;
  duration: string;
  entry: string;
}

export interface KbConfirmResult {
  ok: true;
  docId: string;
  title: string;
  chunkCount: number;
  source: string;
  corpus: { docs: number; chunks: number; chars: number };
}

export interface KbDocItem {
  id: string;
  title: string;
  document: string;
  chapter: string;
  article: string;
  department: string;
  origin: string;
  chunks: number;
  file: string;
}

export interface KbDocsResult {
  ok: true;
  corpus: { docs: number; chunks: number; chars: number };
  docs: KbDocItem[];
}

export class KbRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'KbRequestError';
  }
}

async function readError(response: Response): Promise<KbRequestError> {
  const payload = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
  return new KbRequestError(payload?.code ?? 'UPLOAD_FAILED', payload?.message ?? `请求失败（${response.status}）`);
}

export async function previewDocument(file: File): Promise<KbPreview> {
  const form = new FormData();
  form.append('file', file);

  const response = await fetch('/api/kb/preview', { method: 'POST', body: form });
  if (!response.ok) throw await readError(response);
  return (await response.json()) as KbPreview;
}

export async function confirmDocument(payload: KbConfirmPayload): Promise<KbConfirmResult> {
  const response = await fetch('/api/kb/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw await readError(response);
  return (await response.json()) as KbConfirmResult;
}

export async function fetchDocs(): Promise<KbDocsResult> {
  const response = await fetch('/api/kb/docs');
  if (!response.ok) throw await readError(response);
  return (await response.json()) as KbDocsResult;
}
