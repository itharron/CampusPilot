import type { IntentResult } from '../intent';
import type { KnowledgeStore } from '../knowledge/store';
import type { RetrievalHit } from '../retrieval/types';
import { getSchoolProfile, type SchoolDepartment } from './school';

export type RouteTool = 'kb_search' | 'refuse_out_of_scope' | 'handoff_human';
export type RoutePath = 'kb' | 'refuse' | 'handoff';

export interface RouteDepartment extends SchoolDepartment {
  serviceHours: string;
  fallback: string;
}

export interface RouteSignals {
  intent: IntentResult;
  retrieval: {
    hits: number;
    topScore: number;
    matched: string[];
    /** 问题里能被知识库多字关键词覆盖的比例，0–1 */
    evidence: number;
  };
  cues: {
    outOfScope: boolean;
    contactRequest: boolean;
    campusCue: boolean;
    departmentCue: string | null;
  };
}

/**
 * 一次显式的工具选择结果：服务端据此分支到 kb_search / refuse / handoff，
 * 并原样随 SSE meta 下发给界面，缓存回放时也复用同一份决策。
 */
export interface RouteDecision {
  tool: RouteTool;
  path: RoutePath;
  title: string;
  reason: string;
  confidence: number;
  signals: RouteSignals;
  department?: RouteDepartment;
}

const MIN_EVIDENCE = 0.5;

/** 明确不属于校园办事范围的问题 */
const OUT_OF_SCOPE: RegExp[] = [
  /(写|改|调试|优化|解释|生成).{0,8}(代码|程序|脚本|算法|函数|网页|sql)/i,
  /(python|javascript|typescript|java|c\+\+|sql|编程|算法题)/i,
  /(作文|论文|读后感|演讲稿|文案|翻译|作业|数学题|英语题)/,
  /(天气|气温|股票|基金|彩票|汇率|新闻|电影|游戏|旅游|菜谱|餐厅推荐)/,
  /(恋爱|情感|失恋|表白|塔罗|星座)/,
  /(讲个笑话|笑话|唱歌|写诗)/,
];

/**
 * 找人工 / 找窗口的诉求。这类问题优先于关键词覆盖率：
 * 手册提到某个角色，不代表手册里有这个人的联系方式或办公地点。
 */
const CONTACT_REQUEST =
  /(电话|联系方式|怎么联系|人工|窗口|地址|在哪|找谁|投诉|辅导员|宿管|宿舍管理员|保卫处|保卫科|教务老师|老师办公室|服务台|几点上班|办公时间|找(?:人|老师|教务|保卫|部门))/;

/** 只被手册提到、但不提供联系方式的角色 / 窗口，命中即转人工 */
const CONTACT_ENTITY =
  /(辅导员|宿管|宿舍管理员|保卫处|保卫科|教务窗口|教务老师|老师办公室)/;

/** 问流程而不是找人的表述：有校内线索且检索有命中时，优先按知识库作答 */
const PROCEDURAL_REQUEST =
  /(怎么办理|怎么办|如何|流程|步骤|材料|需要什么|多久|几天|能不能|可以吗|条件|规定)/;

/** 校内办事线索：只收具体词，避免“校外租房”这类误判 */
const CAMPUS_CUE =
  /(宿舍|寝室|宿管|空调|报修|维修|水电|校园卡|一卡通|校园网|网络|教室|场地|借用|证明|学籍|成绩|缓考|补考|休学|复学|请假|奖学金|助学金|贷款|处分|申诉|投诉|辅导员|教务|食堂|餐饮|图书馆|校医院|体检|心理|社团|志愿|毕业|选课)/;

/** 关键词到部门的显式映射，命中时优先于意图文档里的部门 */
const DEPARTMENT_CUES: Array<[RegExp, string]> = [
  [/校园卡|一卡通/, 'card-center'],
  [/校园网|网络|断网|网费/, 'network'],
  [/食堂|餐饮/, 'student-affairs'],
  [/空调|宿舍|寝室|宿管|报修|维修|水电/, 'logistics'],
  [/教室|场地|借用/, 'classroom'],
  [/缓考|补考|考试|成绩复核/, 'exam'],
  [/教务|证明|学籍|成绩单|休学|复学|毕业/, 'academic'],
  [/奖学金|助学金|贷款|处分|申诉|投诉|请假|辅导员|心理/, 'student-affairs'],
];

const PUNCTUATION = /[\s，。！？、；：,.!?;:"'“”‘’（）()【】[\]<>《》\-—_/\\|·]/g;

function normalize(text: string): string {
  return text.replace(PUNCTUATION, '');
}

/**
 * 用知识库多字关键词在问题里的覆盖率衡量“是否有真依据”。
 * BM25 的归一化分会把任意查询的最高分压到 1，单字命中也会得高分，
 * 所以不能直接拿 score 判断是否越界。
 */
function lexicalEvidence(message: string, hits: RetrievalHit[]): number {
  const query = normalize(message);
  if (!query || !hits.length) return 0;

  const terms = new Set<string>();
  for (const hit of hits) {
    for (const term of hit.matchedTerms) {
      if (term.length >= 2) terms.add(term);
    }
  }

  let covered = 0;
  for (const term of terms) {
    if (query.includes(term)) covered += term.length;
  }

  return Math.min(1, covered / query.length);
}

function matchedTerms(hits: RetrievalHit[]): string[] {
  const terms = new Set<string>();
  for (const hit of hits) {
    for (const term of hit.matchedTerms) terms.add(term);
  }
  return [...terms].slice(0, 8);
}

function departmentCue(message: string): string | null {
  for (const [pattern, key] of DEPARTMENT_CUES) {
    if (pattern.test(message)) return key;
  }
  return null;
}

function resolveDepartment(input: {
  intent: IntentResult;
  evidence: number;
  cue: string | null;
  store: KnowledgeStore;
}): RouteDepartment {
  const school = getSchoolProfile();
  const { intent, evidence, cue, store } = input;

  const fromCue = cue ? school?.departments[cue] : undefined;
  const doc = store.docById(intent.id);
  const fromIntent =
    evidence >= MIN_EVIDENCE && doc?.departmentKey ? school?.departments[doc.departmentKey] : undefined;
  const base = fromCue ?? fromIntent;

  if (base) {
    return {
      ...base,
      serviceHours: school?.serviceHours ?? '',
      fallback: school?.humanFallback ?? '',
    };
  }

  if (doc?.department && evidence >= MIN_EVIDENCE) {
    return {
      key: doc.departmentKey || doc.id,
      name: doc.department,
      entry: doc.entry,
      window: '',
      serviceHours: school?.serviceHours ?? '',
      fallback: school?.humanFallback ?? '',
    };
  }

  return {
    key: 'human-service',
    name: '学生服务大厅 · 总服务台',
    entry: '现场前往学生服务大厅，或先联系辅导员',
    window: school?.humanFallback || '学生服务大厅总服务台',
    serviceHours: school?.serviceHours ?? '',
    fallback: school?.humanFallback ?? '',
  };
}

function buildSignals(message: string, hits: RetrievalHit[], intent: IntentResult): RouteSignals {
  return {
    intent,
    retrieval: {
      hits: hits.length,
      topScore: Number((hits[0]?.score ?? 0).toFixed(3)),
      matched: matchedTerms(hits),
      evidence: Number(lexicalEvidence(message, hits).toFixed(2)),
    },
    cues: {
      outOfScope: OUT_OF_SCOPE.some((pattern) => pattern.test(message)),
      contactRequest: CONTACT_REQUEST.test(message),
      campusCue: CAMPUS_CUE.test(message),
      departmentCue: departmentCue(message),
    },
  };
}

/**
 * 作答前的路径决策。纯规则、可复现、无 Key 也能跑；
 * 失败时由调用方回退到原来的知识库链路。
 */
export function planRoute(input: {
  message: string;
  hits: RetrievalHit[];
  intent: IntentResult;
  store: KnowledgeStore;
}): RouteDecision {
  const { message, hits, intent, store } = input;
  const evidence = lexicalEvidence(message, hits);
  const signals = buildSignals(message, hits, intent);
  const percent = Math.round(evidence * 100);

  let path: RoutePath;

  // 求助型诉求（找人、找窗口、投诉）优先于覆盖率：覆盖率只说明手册出现过这些词，
  // 不说明手册里有联系方式。范围外的问题仍先拒答，避免“帮我写代码找谁”被当成校内事务。
  if (signals.cues.outOfScope && !signals.cues.campusCue) {
    path = 'refuse';
  } else if (signals.cues.contactRequest) {
    path = 'handoff';
  } else if (hits.length && signals.cues.campusCue && PROCEDURAL_REQUEST.test(message)) {
    // “空调坏了怎么办”这类问流程的问题，即使关键词覆盖偏低，也优先查手册
    path = 'kb';
  } else if (!hits.length) {
    path = signals.cues.campusCue ? 'handoff' : 'refuse';
  } else if (evidence >= MIN_EVIDENCE) {
    path = 'kb';
  } else if (signals.cues.campusCue) {
    path = 'handoff';
  } else {
    path = 'refuse';
  }

  if (path === 'kb') {
    return {
      tool: 'kb_search',
      path,
      title: '知识库作答',
      reason: `检索命中 ${hits.length} 个片段，问题关键词覆盖 ${percent}%，且没有找人 / 找窗口的诉求，因此走知识库作答。`,
      confidence: Number(Math.min(0.95, Math.max(0.6, evidence)).toFixed(2)),
      signals,
    };
  }

  if (path === 'refuse') {
    const reason = signals.cues.outOfScope
      ? `问题属于通用或非校园事务，知识库关键词覆盖仅 ${percent}%，没有可引用的依据，因此拒答。`
      : hits.length === 0
        ? '没有检索到可用片段，且问题没有校内办事线索，因此拒答。'
        : `只命中 ${hits.length} 个弱相关片段，关键词覆盖仅 ${percent}%，判断为校外或无依据事务，因此拒答。`;
    return {
      tool: 'refuse_out_of_scope',
      path,
      title: '拒答（超出范围）',
      reason,
      confidence: signals.cues.outOfScope ? 0.85 : 0.65,
      signals,
    };
  }

  const department = resolveDepartment({
    intent,
    evidence,
    cue: signals.cues.departmentCue,
    store,
  });
  const entity = message.match(CONTACT_ENTITY)?.[0];
  const reason = entity
    ? `问题在找「${entity}」这类角色或窗口；手册只提到角色、不提供联系方式，因此转人工窗口。`
    : signals.cues.contactRequest
      ? `问题是在找人工或窗口，而不是查流程（知识库关键词覆盖 ${percent}%），因此转人工窗口。`
      : `问题在校内但知识库未收录（关键词覆盖 ${percent}%），因此给出对应部门的人工窗口。`;

  return {
    tool: 'handoff_human',
    path,
    title: '转人工窗口',
    reason,
    confidence: 0.7,
    signals,
    department,
  };
}

/** 路由层异常时的兜底：保持原来的知识库问答行为 */
export function fallbackRoute(input: {
  message: string;
  hits: RetrievalHit[];
  intent: IntentResult;
}): RouteDecision {
  return {
    tool: 'kb_search',
    path: 'kb',
    title: '知识库作答',
    reason: '路径判定异常，已回退到原有知识库链路。',
    confidence: 0.5,
    signals: buildSignals(input.message, input.hits, input.intent),
  };
}

/** 拒答与转人工的固定文案，mock / live 完全一致，不消耗模型额度 */
export function composeRouteAnswer(route: RouteDecision): string {
  if (route.path === 'refuse') {
    return [
      '这次先不走知识库：你问的内容不在校园办事范围内。',
      '',
      '我只处理报修、校园卡、校园网、教室借用、在读证明、缓考、休学复学、请假、奖学金、处分申诉这些事项。',
      '如果确实是校内的事，可以说清「哪个部门 + 要办什么」，我再帮你查。',
    ].join('\n');
  }

  const department = route.department;
  const lines = ['这条我先不走知识库：更像是找人、找窗口，而不是查手册条款。', ''];

  if (department) {
    lines.push(`· 归属部门：${department.name}`);
    if (department.entry) lines.push(`· 办理入口：${department.entry}`);
    if (department.window) lines.push(`· 人工窗口：${department.window}`);
    if (department.serviceHours) lines.push(`· 服务时间：${department.serviceHours}`);
    if (department.fallback) lines.push(`· 兜底渠道：${department.fallback}`);
  }

  lines.push('', '你也可以补充具体事项（哪栋楼、哪个环节），我再帮你查对应的办理流程。');
  return lines.join('\n');
}
