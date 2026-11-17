export interface IntentResult {
  id: string;
  label: string;
  confidence: number;
}

export type RoutePath = 'kb' | 'refuse' | 'handoff';

export interface RouteDepartment {
  key: string;
  name: string;
  entry: string;
  window: string;
  serviceHours: string;
  fallback: string;
}

/** 服务端作答前的工具 / 路径决策，随 SSE meta 下发 */
export interface RouteDecision {
  tool: 'kb_search' | 'refuse_out_of_scope' | 'handoff_human';
  path: RoutePath;
  title: string;
  reason: string;
  confidence: number;
  signals: {
    intent: IntentResult;
    retrieval: { hits: number; topScore: number; matched: string[]; evidence: number };
    cues: {
      outOfScope: boolean;
      contactRequest: boolean;
      campusCue: boolean;
      departmentCue: string | null;
    };
  };
  department?: RouteDepartment;
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

/** 服务端对口语化 / 半句提问的推测结果 */
export interface Interpretation {
  original: string;
  query: string;
  guessed: boolean;
  reason: string;
  candidates: Array<{ label: string; query: string }>;
}

export interface ChatMeta {
  mode: 'mock' | 'live';
  model: string;
  intent: IntentResult;
  topDocTitle: string | null;
  citations?: Citation[];
  route?: RouteDecision;
  interpretation?: Interpretation;
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
