import { config } from './config';
import { KnowledgeStore } from './knowledge/store';
import { createProvider } from './llm/provider';
import { HybridRetriever } from './retrieval/hybridRetriever';
import type { Retriever } from './retrieval/types';
import { AnswerCache } from './safety/answerCache';
import { DailyQuota } from './safety/quota';
import { IpRateLimiter } from './safety/rateLimit';

// 单例装配层：所有有状态组件在这里创建一次，路由只做流程编排。

// 语料在启动时从 data/ 载入并切块；上传入库后调用 store.reload() + retriever.refresh()
export const store = new KnowledgeStore();
store.load();

export const provider = createProvider();

// 检索层按接口注入。默认 BM25；配置了 embedding 环境变量后自动升级为 BM25 + 向量混合。
export const retriever: Retriever = new HybridRetriever(store);

export const rateLimiter = new IpRateLimiter(config.safety.rateLimit);
export const quota = new DailyQuota(config.safety.quota);
export const answerCache = new AnswerCache(config.safety.cache);
