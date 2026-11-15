import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

// 依次尝试 server/.env 与仓库根目录 .env，先找到的生效；
// dotenv 默认不覆盖已存在的真实环境变量，便于用系统环境变量覆盖配置。
for (const file of [path.resolve(__dirname, '../.env'), path.resolve(__dirname, '../../.env')]) {
  if (fs.existsSync(file)) {
    dotenv.config({ path: file });
    break;
  }
}

function readInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const config = {
  port: readInt('PORT', 8787),
  llm: {
    apiKey: (process.env.LLM_API_KEY ?? '').trim(),
    baseUrl: (process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, ''),
    model: process.env.LLM_MODEL?.trim() || 'gpt-4o-mini',
    timeoutMs: readInt('LLM_TIMEOUT_MS', 30_000),
  },
  safety: {
    inputMaxChars: readInt('INPUT_MAX_CHARS', 500),
    rateLimit: {
      windowMs: 60_000,
      max: readInt('RATE_LIMIT_PER_MINUTE', 20),
    },
    quota: {
      dailyRequests: readInt('DAILY_REQUEST_LIMIT', 60),
      dailyTokens: readInt('DAILY_TOKEN_LIMIT', 120_000),
    },
    cache: {
      ttlMs: readInt('CACHE_TTL_MS', 10 * 60_000),
      maxEntries: readInt('CACHE_MAX_ENTRIES', 200),
    },
  },
};

/** 是否配置了真实模型 Key：没有 Key 时整条链路自动降级为 mock 演示模式 */
export function hasLiveModel(): boolean {
  return config.llm.apiKey.length > 0;
}

/**
 * 粗略估算 token 数：中英混排场景下按字符数的一半计。
 * 只用于成本护栏与配额统计，不追求与模型 tokenizer 完全一致。
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2);
}
