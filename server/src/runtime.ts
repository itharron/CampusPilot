import { config } from './config';
import { createProvider } from './llm/provider';
import { KeywordRetriever } from './retrieval/keywordRetriever';
import type { Retriever } from './retrieval/types';
import { AnswerCache } from './safety/answerCache';
import { DailyQuota } from './safety/quota';
import { IpRateLimiter } from './safety/rateLimit';

// 单例装配层：所有有状态组件在这里创建一次，路由只做流程编排。
export const provider = createProvider();

// 检索层按接口注入。换成向量检索 / RAG 时只改这一行，路由与答案拼装都不用动。
export const retriever: Retriever = new KeywordRetriever();

export const rateLimiter = new IpRateLimiter(config.safety.rateLimit);
export const quota = new DailyQuota(config.safety.quota);
export const answerCache = new AnswerCache(config.safety.cache);
