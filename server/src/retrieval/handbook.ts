import fs from 'node:fs';
import path from 'node:path';
import type { ServiceDoc } from './types';

// src/retrieval → ../../data/handbook.md；编译后 dist/retrieval 同样指向 server/data
const HANDBOOK_PATH = path.resolve(__dirname, '../../data/handbook.md');

function parseMetaLine(line: string): { key: string; value: string } | null {
  const match = /^[-*]\s*([^:：]+)[:：]\s*(.+)$/.exec(line.trim());
  return match ? { key: match[1].trim(), value: match[2].trim() } : null;
}

function splitList(value: string): string[] {
  return value
    .split(/[,，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** 把 handbook.md 解析成结构化的办理事项数组 */
export function parseHandbook(markdown: string): ServiceDoc[] {
  const docs: ServiceDoc[] = [];
  const blocks = markdown.split(/^## /m).slice(1);

  for (const block of blocks) {
    const lines = block.split('\n');
    const title = lines[0].trim();
    if (!title) continue;

    const doc: ServiceDoc = {
      id: `svc-${docs.length + 1}`,
      title,
      keywords: [],
      department: '',
      duration: '',
      entry: '',
      steps: [],
      materials: [],
      notes: [],
    };

    let section = '';

    for (const rawLine of lines.slice(1)) {
      const line = rawLine.trim();
      if (!line) continue;

      if (line.startsWith('### ')) {
        section = line.slice(4).trim();
        continue;
      }

      // 元信息区：## 标题 之后、第一个 ### 之前
      if (!section) {
        const meta = parseMetaLine(line);
        if (!meta) continue;
        if (/关键词/.test(meta.key)) doc.keywords = splitList(meta.value);
        else if (/部门|归属/.test(meta.key)) doc.department = meta.value;
        else if (/时限|时长|时间/.test(meta.key)) doc.duration = meta.value;
        else if (/入口|渠道|方式/.test(meta.key)) doc.entry = meta.value;
        continue;
      }

      const item = line
        .replace(/^[-*]\s*/, '')
        .replace(/^\d+[.、)]\s*/, '')
        .trim();

      if (/步骤|流程/.test(section)) doc.steps.push(item);
      else if (/材料|准备|证件/.test(section)) doc.materials.push(item);
      else doc.notes.push(item);
    }

    docs.push(doc);
  }

  return docs;
}

let cached: ServiceDoc[] | null = null;

/** 读取并缓存办事手册（文件很小，只在首次检索时读一次） */
export function loadHandbook(): ServiceDoc[] {
  if (!cached) {
    cached = parseHandbook(fs.readFileSync(HANDBOOK_PATH, 'utf8'));
  }
  return cached;
}
