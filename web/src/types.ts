export interface IntentResult {
  id: string;
  label: string;
  confidence: number;
}

/** 一条引用：出处 + 可展开的原文片段 */
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

export interface ChatMeta {
  mode: 'mock' | 'live';
  model: string;
  intent: IntentResult;
  topDocTitle: string | null;
  citations?: Citation[];
  cached: boolean;
  retrieval?: { name: string; hits: number; topScore?: number; matched?: string[] };
  quotaRemaining: number | null;
  rateRemaining: number | null;
}

export interface ChatDone {
  cached: boolean;
  tokens: number;
}

export interface ChatErrorEvent {
  code: string;
  message: string;
}

export interface CorpusStats {
  docs: number;
  chunks: number;
  chars: number;
}

export interface ServerMeta {
  ok: boolean;
  mode: 'mock' | 'live';
  model: string;
  retriever: string;
  corpus?: CorpusStats;
  limits: {
    ratePerMinute: number;
    dailyRequests: number;
    dailyTokens: number;
    inputMaxChars: number;
  };
  usage: {
    requests: number;
    tokens: number;
    remainingRequests: number;
    remainingTokens: number;
  };
  cache: { size: number; hits: number; misses: number };
}

export interface ChatMessageItem {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  meta?: ChatMeta;
  error?: string;
}
