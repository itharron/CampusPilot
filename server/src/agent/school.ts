import fs from 'node:fs';
import path from 'node:path';

/** 部门的人工窗口信息：来自 config/school.json，换学校只改配置 */
export interface SchoolDepartment {
  key: string;
  name: string;
  entry: string;
  /** school.json 里的 phone 实际存的是窗口/地点，不是电话号码，这里按真实语义命名为 window */
  window: string;
}

export interface SchoolProfile {
  name: string;
  serviceHours: string;
  humanFallback: string;
  departments: Record<string, SchoolDepartment>;
}

interface RawDepartment {
  name?: string;
  entry?: string;
  phone?: string;
}

interface RawSchoolFile {
  school?: { name?: string; serviceHours?: string; humanFallback?: string };
  departments?: Record<string, RawDepartment>;
}

// src/agent 与 dist/agent 都能定位到仓库根的 config/school.json
const SCHOOL_FILE = path.resolve(__dirname, '../../../config/school.json');

let cached: SchoolProfile | null | undefined;

/**
 * 读取学校配置。文件缺失或格式异常时返回 null，路由层退回语料 frontmatter 里的部门字段，
 * 不影响问答主链路。
 */
export function getSchoolProfile(): SchoolProfile | null {
  if (cached !== undefined) return cached;

  try {
    const raw = JSON.parse(fs.readFileSync(SCHOOL_FILE, 'utf8')) as RawSchoolFile;
    const departments: Record<string, SchoolDepartment> = {};

    for (const [key, item] of Object.entries(raw.departments ?? {})) {
      departments[key] = {
        key,
        name: item.name?.trim() || key,
        entry: item.entry?.trim() || '',
        window: item.phone?.trim() || '',
      };
    }

    cached = {
      name: raw.school?.name?.trim() || '示例大学',
      serviceHours: raw.school?.serviceHours?.trim() || '',
      humanFallback: raw.school?.humanFallback?.trim() || '',
      departments,
    };
  } catch {
    cached = null;
  }

  return cached;
}
