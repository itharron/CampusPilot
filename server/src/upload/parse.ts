import path from 'node:path';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_EXTENSIONS = ['pdf', 'docx', 'md', 'txt'];
export const ACCEPTED_HINT = 'PDF、Word（.docx）、Markdown（.md）或 TXT';

export type UploadErrorCode = 'UNSUPPORTED_TYPE' | 'FILE_TOO_LARGE' | 'EMPTY_DOCUMENT' | 'PARSE_FAILED';

export class UploadError extends Error {
  constructor(
    public readonly code: UploadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

export interface ParsedUpload {
  text: string;
  kind: string;
  pages: number;
}

export function extensionOf(fileName: string): string {
  return path.extname(fileName).toLowerCase().replace('.', '');
}

/** 抽文本：PDF 用 pdf-parse，Word 用 mammoth，纯文本直接读。失败一律抛出带错误码的 UploadError */
export async function extractText(file: { buffer: Buffer; originalname: string; size: number }): Promise<ParsedUpload> {
  const ext = extensionOf(file.originalname);

  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    throw new UploadError(
      'UNSUPPORTED_TYPE',
      `不支持的文件类型：.${ext || '未知'}。允许上传 ${ACCEPTED_HINT}，单个文件不超过 5 MB。`,
    );
  }

  if (file.size > MAX_FILE_BYTES) {
    throw new UploadError('FILE_TOO_LARGE', '文件超过 5 MB 上限，请拆分或压缩后再上传。');
  }

  try {
    let text = '';
    let pages = 0;

    if (ext === 'pdf') {
      const result = await pdfParse(file.buffer);
      text = result.text;
      pages = result.numpages;
    } else if (ext === 'docx') {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      text = result.value;
    } else {
      text = file.buffer.toString('utf8');
    }

    const cleaned = text.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();

    if (cleaned.length < 50) {
      throw new UploadError(
        'EMPTY_DOCUMENT',
        '没有从文件里抽到可用文字。如果这是扫描件 PDF（图片型），需要先做 OCR 再上传。',
      );
    }

    return { text: cleaned, kind: ext, pages };
  } catch (error) {
    if (error instanceof UploadError) throw error;
    throw new UploadError('PARSE_FAILED', `文件解析失败：${(error as Error)?.message?.slice(0, 120) ?? '未知错误'}`);
  }
}
