import fs from 'node:fs';
import path from 'node:path';
import { Router, type Response } from 'express';
import multer from 'multer';
import { getClientIp } from '../http/sse';
import { chunkBody, guessChapter, normalizePlainText } from '../knowledge/chunker';
import { answerCache, retriever, store } from '../runtime';
import { requireKbAuth } from './auth';
import { IpRateLimiter } from '../safety/rateLimit';
import { createDraft, getDraft, removeDraft } from '../upload/drafts';
import { ACCEPTED_EXTENSIONS, ACCEPTED_HINT, MAX_FILE_BYTES, UploadError, extractText } from '../upload/parse';

const UPLOAD_DIR = path.resolve(__dirname, '../../../data/uploads');
const uploadLimiter = new IpRateLimiter({ windowMs: 60_000, max: 10 });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      callback(new UploadError('UNSUPPORTED_TYPE', `不支持的文件类型：.${ext || '未知'}。允许上传 ${ACCEPTED_HINT}。`));
      return;
    }
    callback(null, true);
  },
});

function statusOf(code: UploadError['code']): number {
  if (code === 'UNSUPPORTED_TYPE') return 415;
  if (code === 'FILE_TOO_LARGE') return 413;
  if (code === 'EMPTY_DOCUMENT') return 422;
  return 422;
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof UploadError) {
    res.status(statusOf(error.code)).json({ ok: false, code: error.code, message: error.message });
    return;
  }

  if (error instanceof multer.MulterError) {
    const tooLarge = error.code === 'LIMIT_FILE_SIZE';
    res.status(tooLarge ? 413 : 400).json({
      ok: false,
      code: tooLarge ? 'FILE_TOO_LARGE' : 'UPLOAD_FAILED',
      message: tooLarge ? '文件超过 5 MB 上限，请拆分或压缩后再上传。' : `上传失败：${error.message}`,
    });
    return;
  }

  console.error('[kb] 上传处理失败：', (error as Error)?.message);
  res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', message: '服务处理上传时出错了，请稍后重试。' });
}

function text(value: unknown, max = 120): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function yamlSafe(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/["']/g, '').trim();
}

function suggestTitle(fileName: string, markdown: string): string {
  const headings = [...markdown.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1].trim());

  // 优先用不像条款号的标题作事项名，其次用文件开头的第一行
  const preferred = headings.find(
    (heading) => heading.length <= 40 && !/^第[一二三四五六七八九十百零]+[章节条]/.test(heading),
  );
  if (preferred) return preferred;

  const firstLine = markdown.split('\n').find((line) => line.trim())?.trim();
  if (firstLine && firstLine.length <= 40 && !firstLine.startsWith('#')) return firstLine;

  return path.basename(fileName, path.extname(fileName)).slice(0, 40) || '未命名知识库文档';
}

function buildMarkdown(input: {
  title: string;
  document: string;
  chapter: string;
  article: string;
  category: string;
  department: string;
  duration: string;
  entry: string;
  fileName: string;
  body: string;
}): string {
  const keywords = [...new Set([input.title, ...input.chapter.split(/\s+/).slice(-1)])]
    .map((item) => item.replace(/[,，、]/g, ''))
    .filter(Boolean)
    .slice(0, 6);

  const frontmatter = [
    '---',
    `id: upload-${Date.now().toString(36)}`,
    `title: ${yamlSafe(input.title)}`,
    `document: ${yamlSafe(input.document)}`,
    `chapter: ${yamlSafe(input.chapter)}`,
    `article: ${yamlSafe(input.article)}`,
    `category: ${yamlSafe(input.category || '上传文档')}`,
    `department: ${yamlSafe(input.department)}`,
    `duration: ${yamlSafe(input.duration)}`,
    `entry: ${yamlSafe(input.entry)}`,
    `updated: ${new Date().toISOString().slice(0, 10)}`,
    `keywords: [${keywords.join(', ')}]`,
    'origin: upload',
    `sourceFile: ${yamlSafe(input.fileName)}`,
    '---',
    '',
  ].join('\n');

  return `${frontmatter}${input.body}\n`;
}

export const kbRouter = Router();

/** 上传预览：抽文本 → 规范化 → 按标题切块 → 返回草稿与建议元信息（需登录） */
kbRouter.post('/preview', requireKbAuth, (req, res) => {
  const rate = uploadLimiter.consume(getClientIp(req.headers['x-forwarded-for'] as string | undefined, req.socket.remoteAddress));
  if (!rate.allowed) {
    res.status(429).json({ ok: false, code: 'RATE_LIMITED', message: '上传有点频繁，请稍后再试（每分钟最多 10 次）。' });
    return;
  }

  upload.single('file')(req, res, async (error) => {
    if (error) {
      sendError(res, error);
      return;
    }

    if (!req.file) {
      res.status(400).json({ ok: false, code: 'NO_FILE', message: '没有收到文件，请选择要入库的文档。' });
      return;
    }

    try {
      const parsed = await extractText(req.file);
      const markdown = normalizePlainText(parsed.text);
      const chunks = chunkBody(markdown);

      if (!chunks.length) {
        res.status(422).json({ ok: false, code: 'EMPTY_DOCUMENT', message: '文件里没有可切分的正文。' });
        return;
      }

      const draft = createDraft({
        fileName: req.file.originalname,
        fileType: parsed.kind,
        pages: parsed.pages,
        chars: parsed.text.length,
        markdown,
        chunks,
      });

      res.json({
        ok: true,
        draftId: draft.id,
        fileName: draft.fileName,
        fileType: draft.fileType,
        pages: draft.pages,
        chars: draft.chars,
        chunkCount: chunks.length,
        chunks: chunks.map((chunk, index) => ({
          index: index + 1,
          heading: chunk.heading || '正文',
          chars: chunk.text.length,
          preview: chunk.text.length > 240 ? `${chunk.text.slice(0, 240)}…` : chunk.text,
        })),
        suggestions: {
          title: suggestTitle(draft.fileName, markdown),
          document: `《${path.basename(draft.fileName, path.extname(draft.fileName))}》`,
          chapter: guessChapter(markdown),
          article: '',
          category: '上传文档',
          department: '',
        },
      });
    } catch (uploadError) {
      sendError(res, uploadError);
    }
  });
});

/** 确认入库：写入 data/uploads/，重载语料并清空答案缓存，立即可被检索命中（需登录） */
kbRouter.post('/confirm', requireKbAuth, (req, res) => {
  const draftId = text(req.body?.draftId, 80);
  const draft = getDraft(draftId);

  if (!draft) {
    res.status(410).json({ ok: false, code: 'DRAFT_EXPIRED', message: '预览已过期，请重新上传文件。' });
    return;
  }

  const title = text(req.body?.title, 60);
  const document = text(req.body?.document, 80);
  const chapter = text(req.body?.chapter, 80);

  if (!title || !document || !chapter) {
    res.status(400).json({ ok: false, code: 'INVALID_META', message: '标题、文档名与章节都不能为空。' });
    return;
  }

  const markdown = buildMarkdown({
    title,
    document,
    chapter,
    article: text(req.body?.article, 40),
    category: text(req.body?.category, 30),
    department: text(req.body?.department, 60),
    duration: text(req.body?.duration, 80),
    entry: text(req.body?.entry, 120),
    fileName: draft.fileName,
    body: draft.markdown,
  });

  const idMatch = /^id:\s*(.+)$/m.exec(markdown);
  const docId = idMatch?.[1]?.trim() ?? `upload-${Date.now().toString(36)}`;

  try {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, `${docId}.md`), markdown, 'utf8');
  } catch (error) {
    console.error('[kb] 写入语料失败：', (error as Error).message);
    res.status(500).json({ ok: false, code: 'WRITE_FAILED', message: '写入语料目录失败，请检查磁盘权限后重试。' });
    return;
  }

  removeDraft(draftId);
  store.reload();
  retriever.refresh?.();
  answerCache.reset();

  const doc = store.docById(docId);
  res.json({
    ok: true,
    docId,
    title,
    chunkCount: doc?.chunks.length ?? 0,
    source: doc?.chunks[0]?.source ?? `${document} · ${chapter}`,
    corpus: store.stats(),
  });
});

/** 知识库文档列表：展示当前语料的来源与规模 */
kbRouter.get('/docs', (_req, res) => {
  res.json({
    ok: true,
    corpus: store.stats(),
    docs: store.allDocs().map((doc) => ({
      id: doc.id,
      title: doc.title,
      document: doc.document,
      chapter: doc.chapter,
      article: doc.article,
      department: doc.department,
      origin: doc.origin,
      chunks: doc.chunks.length,
      file: doc.file,
    })),
  });
});
