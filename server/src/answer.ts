import type { KnowledgeStore } from './knowledge/store';
import type { Chunk } from './knowledge/types';
import type { RetrievalHit } from './retrieval/types';

export interface Citation {
  index: number;
  docId: string;
  docTitle: string;
  document: string;
  chapter: string;
  article: string;
  section: string;
  source: string;
  pages: string;
  department: string;
  excerpt: string;
}

const NO_MATCH_ANSWER = [
  '这件事我暂时没在知识库里查到对应的办理入口。',
  '',
  '目前收录的有：学籍证明、休学复学、缓考补考、奖助学金、违纪申诉、请假报备、宿舍报修、校园卡、校园网、场地借用。',
  '你可以换个说法再问一次，或者直接说明是哪个部门的事，我再帮你找找。',
  '如果是紧急情况，建议直接联系辅导员或拨打学校总机转人工服务台。',
].join('\n');

const SECTION_PRIORITY: Array<[RegExp, number]> = [
  [/步骤|流程|程序/, 0],
  [/材料|证件/, 1],
  [/适用|条件|对象/, 2],
  [/注意|说明|须知/, 3],
];

function sectionPriority(section: string): number {
  for (const [pattern, priority] of SECTION_PRIORITY) {
    if (pattern.test(section)) return priority;
  }
  return 4;
}

/**
 * 展示顺序：按文档得分排序，同一文档内「办理步骤」排在前面，
 * 这样引用 [1] 就是最关键的流程片段，而不是恰好命中次数最多的小节。
 */
export function orderHitsForAnswer(hits: RetrievalHit[]): RetrievalHit[] {
  const byDoc = new Map<string, RetrievalHit[]>();
  for (const hit of hits) {
    const list = byDoc.get(hit.chunk.docId) ?? [];
    list.push(hit);
    byDoc.set(hit.chunk.docId, list);
  }

  return [...byDoc.values()]
    .sort((a, b) => (b[0]?.score ?? 0) - (a[0]?.score ?? 0))
    .flatMap((group) =>
      [...group].sort(
        (a, b) => sectionPriority(a.chunk.section) - sectionPriority(b.chunk.section) || b.score - a.score,
      ),
    );
}

/** 把片段整理成前端可展开的引用列表 */
export function buildCitations(hits: RetrievalHit[], limit = 3): Citation[] {
  return hits.slice(0, limit).map((hit, index) => ({
    index: index + 1,
    docId: hit.chunk.docId,
    docTitle: hit.chunk.docTitle,
    document: hit.chunk.document,
    chapter: hit.chunk.chapter,
    article: hit.chunk.article,
    section: hit.chunk.section,
    source: hit.chunk.source,
    pages: hit.chunk.pages,
    department: hit.chunk.department,
    excerpt: hit.chunk.excerpt,
  }));
}

function bodyLines(chunk: Chunk): string[] {
  const lines = chunk.text.split('\n');
  if (lines[0]?.trim() === chunk.section) lines.shift();
  return lines.map((line) => line.trim()).filter(Boolean);
}

function cleanItem(line: string): string {
  return line
    .replace(/^[-*]\s*/, '')
    .replace(/^\d+[.、)]\s*/, '')
    .replace(/^[（(]\d+[）)]\s*/, '')
    .trim();
}

function collect(chunks: Chunk[], pattern: RegExp): string[] {
  return chunks
    .filter((chunk) => pattern.test(chunk.section))
    .flatMap((chunk) => bodyLines(chunk).map(cleanItem))
    .filter(Boolean);
}

function renderCitationFooter(citations: Citation[]): string {
  if (!citations.length) return '';
  const lines = citations.map((citation) => `[${citation.index}] ${citation.source}`);
  return ['', '依据来源：', ...lines].join('\n');
}

/**
 * 用检索结果拼一段可直接展示的答案。
 * 两个用途：mock 模式的正文，以及真实模型调用失败时的兜底内容。
 */
export function composeAnswer(hits: RetrievalHit[], store: KnowledgeStore): string {
  if (!hits.length) return NO_MATCH_ANSWER;

  const top = hits[0];
  const doc = store.docById(top.chunk.docId);
  const docChunks = doc?.chunks ?? [top.chunk];
  const citations = buildCitations(hits);

  const steps = collect(docChunks, /步骤|流程|程序/).slice(0, 8);
  const materials = doc?.materials.length ? doc.materials : collect(docChunks, /材料|证件/);
  const notes = collect(docChunks, /注意|说明|须知/).slice(0, 6);
  const condition = collect(docChunks, /适用|条件|对象/)[0] ?? '';

  const lines: string[] = [`我在知识库里找到了「${top.chunk.docTitle}」的办理方式（依据 [1]）：`, ''];

  if (top.chunk.document || top.chunk.chapter) {
    lines.push(`· 出处：${[top.chunk.document, top.chunk.chapter, top.chunk.article].filter(Boolean).join(' · ')}`);
  }
  if (doc?.department) lines.push(`· 归属部门：${doc.department}`);
  if (doc?.duration) lines.push(`· 办理时限：${doc.duration}`);
  if (doc?.entry) lines.push(`· 办理入口：${doc.entry}`);
  if (condition) lines.push(`· 适用情形：${condition}`);

  if (steps.length) {
    lines.push('', '办理步骤：');
    steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
  }

  if (materials.length) {
    lines.push('', '需要准备：');
    materials.slice(0, 8).forEach((item) => lines.push(`- ${item}`));
  }

  if (notes.length) {
    lines.push('', '补充说明：');
    notes.forEach((item) => lines.push(`- ${item}`));
  }

  const related = [...new Set(hits.slice(1).map((hit) => hit.chunk.docTitle))].filter(
    (title) => title !== top.chunk.docTitle,
  );
  if (related.length) lines.push('', `另外可能相关：${related.join('、')}`);

  const footer = renderCitationFooter(citations);
  if (footer) lines.push(footer);

  return lines.join('\n');
}

/** 把检索结果整理成给大模型的参考资料，编号与 citations 一一对应 */
export function renderContext(hits: RetrievalHit[]): string {
  if (!hits.length) return '（本次没有检索到相关资料）';

  return hits
    .map((hit, index) => {
      const chunk = hit.chunk;
      const meta = [
        `出处：${chunk.source}`,
        chunk.pages ? `页码：${chunk.pages}` : '',
        chunk.department ? `归属部门：${chunk.department}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      return `[${index + 1}]\n${meta}\n正文：\n${chunk.text}`;
    })
    .join('\n\n');
}
