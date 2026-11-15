export interface IntentResult {
  id: string;
  label: string;
  confidence: number;
}

export interface ChatMeta {
  mode: 'mock' | 'live';
  model: string;
  intent: IntentResult;
  topDocTitle: string | null;
  cached: boolean;
  retrieval?: { name: string; hits: number };
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

export interface ServerMeta {
  ok: boolean;
  mode: 'mock' | 'live';
  model: string;
  retriever: string;
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
