import fs from 'node:fs';
import path from 'node:path';
import { chunkBody } from './chunker';
import { asList, asString, parseFrontmatter } from './frontmatter';
import type { Chunk, DocMeta, KnowledgeDoc } from './types';

// server/src/knowledge 与 server/dist/knowledge 都能定位到仓库根的 data/
const DEFAULT_CORPUS_ROOT = path.resolve(__dirname, '../../../data');

const EXCERPT_LIMIT = 600;

/** 引用面板里的原文不重复显示小节标题（标题已经在出处串里） */
function excerptOf(text: string, heading: string): string {
  let body = heading && text.startsWith(heading) ? text.slice(heading.length).trim() : text;
  if (!body) body = text;
  return body.length > EXCERPT_LIMIT ? `${body.slice(0, EXCERPT_LIMIT)}…` : body;
}

function walkMarkdown(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const found: string[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walkMarkdown(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) found.push(full);
  }

  return found.sort();
}

/**
 * 语料库：启动时递归扫描 data/ 下所有 .md，切成带出处元数据的片段。
 * 上传入库后调用 reload() 即可让新语料立即参与检索。
 */
export class KnowledgeStore {
  private docs: KnowledgeDoc[] = [];
  private chunks: Chunk[] = [];
  private readonly roots: string[];

  constructor(roots?: string[]) {
    const fromEnv = process.env.CORPUS_DIR?.trim();
    this.roots = roots ?? (fromEnv ? [path.resolve(fromEnv)] : [DEFAULT_CORPUS_ROOT]);
  }

  load(): void {
    const docs: KnowledgeDoc[] = [];
    const usedIds = new Set<string>();

    for (const root of this.roots) {
      for (const file of walkMarkdown(root)) {
        const raw = fs.readFileSync(file, 'utf8');
        const { data, body } = parseFrontmatter(raw);
        const relative = path.relative(root, file).split(path.sep).join('/');
        const baseId = asString(data.id, path.basename(file, '.md'));

        let id = baseId;
        let suffix = 2;
        while (usedIds.has(id)) id = `${baseId}-${suffix++}`;
        usedIds.add(id);

        const meta: DocMeta = {
          id,
          title: asString(data.title, path.basename(file, '.md')),
          document: asString(data.document, '未命名文档'),
          chapter: asString(data.chapter),
          article: asString(data.article),
          category: asString(data.category, '未分类'),
          department: asString(data.department),
          departmentKey: asString(data.departmentKey),
          duration: asString(data.duration),
          entry: asString(data.entry),
          updated: asString(data.updated),
          keywords: asList(data.keywords),
          materials: asList(data.materials),
          origin: asString(data.origin, 'corpus'),
          file: relative,
        };

        const chunks = chunkBody(body).map((section, index): Chunk => {
          const source = [meta.document, meta.chapter, meta.article, section.heading]
            .filter(Boolean)
            .join(' · ');

          return {
            id: `${id}#${index}`,
            docId: id,
            docTitle: meta.title,
            document: meta.document,
            chapter: meta.chapter,
            article: meta.article,
            section: section.heading || '正文',
            pages: section.pages.length ? `${section.pages[0]}-${section.pages[section.pages.length - 1]}` : '',
            source,
            department: meta.department,
            text: section.text,
            excerpt: excerptOf(section.text, section.heading),
          };
        });

        if (chunks.length) docs.push({ ...meta, chunks });
      }
    }

    this.docs = docs;
    this.chunks = docs.flatMap((doc) => doc.chunks);
  }

  reload(): void {
    this.load();
  }

  allDocs(): KnowledgeDoc[] {
    return this.docs;
  }

  allChunks(): Chunk[] {
    return this.chunks;
  }

  docById(id: string): KnowledgeDoc | undefined {
    return this.docs.find((doc) => doc.id === id);
  }

  chunksOfDoc(id: string): Chunk[] {
    return this.docById(id)?.chunks ?? [];
  }

  stats(): { docs: number; chunks: number; chars: number } {
    return {
      docs: this.docs.length,
      chunks: this.chunks.length,
      chars: this.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0),
    };
  }

  rootsReadable(): string[] {
    return this.roots;
  }
}
