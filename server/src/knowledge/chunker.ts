/**
 * 切块：按 Markdown 的 `##` / `###` 标题层级切分，保留标题作为出处的一部分；
 * 同时收集 `<!-- p:N -->` 页码锚点，PDF 语料因此能给出页码。
 * 对于没有标题的长文本（例如上传的纯文本），退化为按段落打包。
 */
export interface ChunkDraft {
  heading: string;
  text: string;
  pages: number[];
}

const HEADING = /^(#{2,3})\s+(.+)$/;
const PAGE_ANCHOR = /<!--\s*p:(\d+)\s*-->/g;
const MAX_UNTITLED_CHUNK = 900;

function finalize(heading: string, lines: string[]): ChunkDraft | null {
  const raw = lines.join('\n').trim();
  if (!raw) return null;

  const pages = [...raw.matchAll(PAGE_ANCHOR)].map((match) => Number(match[1]));
  const text = raw
    .replace(PAGE_ANCHOR, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!text) return null;
  return { heading: heading.trim(), text, pages: [...new Set(pages)] };
}

/** 把正文按 `##` / `###` 切成小节；标题行会作为小节正文的第一行保留 */
export function splitSections(body: string): ChunkDraft[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const drafts: ChunkDraft[] = [];
  let heading = '';
  let buffer: string[] = [];

  const flush = () => {
    const draft = finalize(heading, buffer);
    if (draft) drafts.push(draft);
    buffer = [];
  };

  for (const line of lines) {
    const match = HEADING.exec(line.trim());
    if (match) {
      flush();
      heading = match[2].trim();
      buffer.push(heading);
      continue;
    }
    buffer.push(line);
  }
  flush();

  return drafts;
}

/** 没有标题的长文本：按空行分段，再打包成不超过 900 字的片段 */
function packParagraphs(text: string): ChunkDraft[] {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const drafts: ChunkDraft[] = [];
  let buffer: string[] = [];
  let size = 0;

  const flush = () => {
    if (!buffer.length) return;
    drafts.push({ heading: '', text: buffer.join('\n\n'), pages: [] });
    buffer = [];
    size = 0;
  };

  for (const paragraph of paragraphs) {
    if (size > 0 && size + paragraph.length > MAX_UNTITLED_CHUNK) flush();
    buffer.push(paragraph);
    size += paragraph.length;
  }
  flush();

  return drafts;
}

export function chunkBody(body: string): ChunkDraft[] {
  const sections = splitSections(body);
  const hasRealHeading = sections.some((section) => section.heading);
  if (hasRealHeading) return sections;

  const plain = body.trim();
  if (!plain) return [];
  if (plain.length <= MAX_UNTITLED_CHUNK) return [{ heading: '', text: plain, pages: [] }];
  return packParagraphs(plain);
}

/**
 * 上传的纯文本转成 Markdown 正文：
 * 把「第X章 / 第X条 / 一、」这类短行识别为三级标题，便于按标题切块与展示出处。
 */
export function normalizePlainText(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let seenHeading = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      out.push('');
      continue;
    }

    const numberedHeading = /^(第[一二三四五六七八九十百零]+[章节条]|[一二三四五六七八九十]+、)/.test(line);
    // 开头的短标题行（如文档名）也升级为标题，避免变成一个只有 10 个字的「正文」块
    const leadingTitle = !seenHeading && line.length <= 30 && !/[。；！？，,]/.test(line);

    if (line.length <= 40 && (numberedHeading || leadingTitle)) {
      out.push(`## ${line}`);
      seenHeading = true;
      continue;
    }

    out.push(line);
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** 为上传内容猜一个章标题：优先取第一个「第X章」，否则用文件名 */
export function guessChapter(body: string): string {
  const match = /第[一二三四五六七八九十百零]+章[^\n。；]{0,30}/.exec(body);
  return match ? match[0].trim() : '';
}
