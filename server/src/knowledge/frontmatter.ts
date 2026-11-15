/**
 * 极简 frontmatter 解析：只支持语料实际用到的 YAML 子集，避免为了几行元数据引入 YAML 依赖。
 * 支持 `key: value`、`key: [a, b]` 与 `key:` + `  - item` 三种写法。
 */
export type FrontmatterValue = string | string[];
export interface ParsedFile {
  data: Record<string, FrontmatterValue>;
  body: string;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseFrontmatter(raw: string): ParsedFile {
  const source = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

  if (!source.startsWith('---\n')) {
    return { data: {}, body: source };
  }

  const end = source.indexOf('\n---', 4);
  if (end === -1) {
    return { data: {}, body: source };
  }

  const header = source.slice(4, end);
  const body = source.slice(end + 4).replace(/^\n+/, '');
  const data: Record<string, FrontmatterValue> = {};
  let currentListKey: string | null = null;

  for (const rawLine of header.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line.trim() || line.trimStart().startsWith('#')) continue;

    const itemMatch = /^\s+-\s+(.*)$/.exec(line);
    if (itemMatch && currentListKey) {
      (data[currentListKey] as string[]).push(unquote(itemMatch[1]));
      continue;
    }

    const kv = /^([A-Za-z0-9_$-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;

    const key = kv[1];
    const value = kv[2].trim();
    currentListKey = null;

    if (!value) {
      data[key] = [];
      currentListKey = key;
      continue;
    }

    if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = value
        .slice(1, -1)
        .split(',')
        .map((item) => unquote(item))
        .filter(Boolean);
      continue;
    }

    data[key] = unquote(value);
  }

  return { data, body };
}

export function asString(value: FrontmatterValue | undefined, fallback = ''): string {
  if (Array.isArray(value)) return value.join('、');
  return value?.trim() || fallback;
}

export function asList(value: FrontmatterValue | undefined): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : value.split(/[,，、]/);
  return list.map((item) => item.trim()).filter(Boolean);
}
