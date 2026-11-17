/**
 * 提问容错与合理推测。
 *
 * 同学常常只写半句、用俗称、或者干脆只丢一个名词（「空调」「请假」「证明」）。
 * 这一层在检索与路径判定之前，把这类输入归一化成校内标准问法，并把「推测了什么」
 * 原样返回给界面，让用户能看见、能改。
 *
 * 三条边界：
 * 1. 只认识校园事务里已有的主题，认不出来就原样返回，交给后面的拒答规则；
 * 2. 找人的诉求（找辅导员、投诉食堂找谁、我要找宿管）不做场景补全，保持转人工；
 * 3. 不做同音字大范围猜测，只处理与校园词表强相关的少数常见错写。
 */

export interface InterpretationCandidate {
  label: string;
  query: string;
}

/** 一次提问的推测结果：original 是原话，query 是拿去检索 / 判路的问法 */
export interface Interpretation {
  original: string;
  query: string;
  /** 是否真的改写过；false 时界面不显示推测提示 */
  guessed: boolean;
  /** 一句话说明推测依据 */
  reason: string;
  /** 必要时给用户的候选方向，0–1 个 */
  candidates: InterpretationCandidate[];
}

interface Alias {
  re: RegExp;
  to: string;
  /** 写进 reason 的说法，留空表示不单独提示 */
  note?: string;
}

interface Topic {
  key: string;
  /** 只写了主题词时的标准问法 */
  template: string;
  /** 缺问法时补上的动作 */
  verb: string;
  test: RegExp;
  bare: RegExp;
  finish?: Array<[RegExp, string]>;
  alternative?: InterpretationCandidate;
}

/** 找人的诉求：出现这些词就不做场景补全，避免把「找宿管」改写成报修流程 */
const CONTACT_HINT =
  /(找谁|在哪|哪儿|电话|联系方式|怎么联系|人工|窗口|投诉|辅导员|宿管|宿舍管理员|保卫处|保卫科|教务老师|老师办公室|地址|办公时间|几点上班|找(?:人|老师|教务|保卫|部门))/;

/** 已经带了问法的句子不再补动作；「怎么…」统一视为已带问法，避免补成「…怎么开怎么申请」 */
const PROCEDURAL =
  /(怎么|如何|咋|流程|步骤|材料|需要什么|多久|几天|能不能|可以吗|条件|规定|打印|补办|挂失|报修|借用|办理|申请)/;

/**
 * 口语、俗称、错字与漏字。顺序有讲究：
 * 先处理整句短语，再处理词，最后处理语气与问法。
 */
const ALIASES: Alias[] = [
  { re: /空掉/g, to: '空调', note: '「空掉」按「空调」理解' },
  { re: /正明/g, to: '证明', note: '「正明」按「证明」理解' },
  { re: /清假/g, to: '请假', note: '「清假」按「请假」理解' },
  { re: /缓拷/g, to: '缓考', note: '「缓拷」按「缓考」理解' },
  {
    re: /网上不去|上不去网|上不了网|网连不上|连不上网|没网了|没有网/g,
    to: '校园网连不上',
    note: '「{0}」按「校园网连不上」理解',
  },
  {
    re: /宿舍(?:太|很|好|特别)?热(?:了|死了)?|热得睡不着/g,
    to: '宿舍空调不制冷',
    note: '「{0}」按「宿舍空调不制冷」理解',
  },
  { re: /不冷|制冷不行|不凉/g, to: '不制冷', note: '「{0}」按「不制冷」理解' },
  { re: /冷气|冷风/g, to: '空调', note: '「{0}」是「空调」的俗称' },
  { re: /一卡通|饭卡|门禁卡|校卡/g, to: '校园卡', note: '「{0}」是「校园卡」的俗称' },
  {
    re: /延期考试|延迟考试|推迟考试|延考/g,
    to: '缓考',
    note: '「{0}」的校内说法是「缓考」',
  },
  { re: /寝室/g, to: '宿舍', note: '「寝室」与「宿舍」同指' },
  {
    re: /(?<!校园)卡(?:丢了|掉了|没了)/g,
    to: '校园卡丢了',
    note: '「{0}」按「校园卡丢了」理解',
  },
  { re: /咋弄|咋办|咋整|怎么弄|怎么搞/g, to: '怎么办' },
];

/** 去掉「我那个」「那个」这类指代，它们不影响主题判断 */
const FILLER = /^(?:我那个|我的那个|那个|我的)(?:的)?/;

const TOPICS: Topic[] = [
  {
    key: 'exam',
    template: '缓考怎么申请',
    verb: '怎么申请',
    test: /(缓考|补考|缺考)/,
    bare: /^(?:我想|我要)?(?:申请)?(?:缓考|补考)$/,
  },
  {
    key: 'card',
    template: '校园卡丢了怎么挂失补办',
    verb: '怎么挂失补办',
    test: /(校园卡|挂失|补卡)/,
    bare: /^(?:校园卡|一卡通|饭卡|卡)(?:丢了|掉了|没了)?$/,
  },
  {
    key: 'network',
    template: '校园网连不上怎么报修',
    verb: '怎么报修',
    test: /(校园网|断网|连不上|网速|wifi|认证失败)/i,
    bare: /^校园网$/,
  },
  {
    key: 'dorm-ac',
    template: '宿舍空调坏了怎么报修',
    verb: '怎么报修',
    test: /(空调|制冷|报修|维修|漏水)/,
    bare: /^(?:宿舍|寝室)?(?:的)?(?:空调|冷气)$/,
  },
  {
    key: 'leave',
    template: '请假怎么办理',
    verb: '怎么办理',
    test: /(请假|病假|事假|销假|离校报备)/,
    bare: /^(?:我想|我要)?请(?:个)?假$/,
    alternative: { label: '其实是考试请假，申请缓考', query: '缓考怎么申请' },
  },
  {
    key: 'enrollment',
    template: '在读证明怎么开',
    verb: '怎么开',
    test: /(在读证明|学籍证明|成绩单|证明)/,
    bare: /^(?:我想|我要)?(?:开|要|打印)?(?:在读)?证明$/,
    finish: [[/^(?:在读)?证明怎么办$/, '在读证明怎么开']],
    alternative: { label: '其实要的是成绩单', query: '成绩单怎么打印' },
  },
  {
    key: 'classroom',
    template: '教室怎么借用',
    verb: '怎么借用',
    test: /(教室|场地|借用)/,
    bare: /^教室$/,
  },
  {
    key: 'scholarship',
    template: '奖学金怎么申请',
    verb: '怎么申请',
    test: /(奖学金|助学金|助学贷款)/,
    bare: /^(?:奖学金|助学金)$/,
  },
  {
    key: 'discipline',
    template: '对处分有异议怎么办',
    verb: '怎么办',
    test: /(处分|申诉)/,
    bare: /^(?:处分|申诉)$/,
  },
  {
    key: 'leave-resume',
    template: '休学复学怎么办',
    verb: '怎么办',
    test: /(休学|复学)/,
    bare: /^(?:休学|复学)$/,
  },
];

const MAX_GUESS_LENGTH = 60;

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function applyAliases(text: string): { text: string; notes: string[] } {
  let next = text;
  const notes: string[] = [];

  for (const alias of ALIASES) {
    next = next.replace(alias.re, (match) => {
      if (alias.note) notes.push(alias.note.replace('{0}', match));
      return alias.to;
    });
  }

  return { text: next, notes };
}

/**
 * 把一句可能很随意的提问归一化成校内标准问法。
 * 返回的 query 会用于缓存键、检索、意图与路径判定，保证同一件事只有一种问法。
 */
export function interpretQuery(rawInput: string): Interpretation {
  const original = rawInput.trim();
  const base: Interpretation = {
    original,
    query: original,
    guessed: false,
    reason: '',
    candidates: [],
  };

  if (!original || original.length > MAX_GUESS_LENGTH) return base;

  const { text: aliased, notes } = applyAliases(original);
  const trimmed = aliased.replace(FILLER, '').trim() || aliased;

  // 找人 / 找窗口：只统一叫法，不补场景，保持转人工的判定
  if (CONTACT_HINT.test(original)) {
    const query = trimmed;
    if (query === original) return base;
    return {
      original,
      query,
      guessed: true,
      reason: `这句话更像在找人 / 找窗口，只把叫法统一成「${query}」，不做场景补全。`,
      candidates: [],
    };
  }

  const topic = TOPICS.find((item) => item.test.test(trimmed));
  if (!topic) {
    return trimmed !== original
      ? {
          original,
          query: trimmed,
          guessed: true,
          reason: notes.length ? `${notes.slice(0, 2).join('；')}。` : '去掉了句子里的指代词。',
          candidates: [],
        }
      : base;
  }

  let query = trimmed;
  let completed = false;

  if (topic.bare.test(query)) {
    query = topic.template;
    completed = true;
  } else {
    for (const [pattern, replacement] of topic.finish ?? []) {
      if (pattern.test(query)) {
        query = query.replace(pattern, replacement);
        completed = true;
        break;
      }
    }

    if (!completed && !PROCEDURAL.test(query)) {
      query = `${query}${topic.verb}`;
      completed = true;
    }
  }

  query = collapse(query);
  if (query === original) return base;

  const parts: string[] = [];
  if (notes.length) parts.push(notes.slice(0, 2).join('；'));
  if (completed) parts.push(`再按校园里最常见的场景补成「${query}」`);
  const reason = parts.length ? `${parts.join('，')}。` : `按「${query}」理解。`;

  return {
    original,
    query,
    guessed: true,
    reason,
    candidates: topic.alternative ? [topic.alternative] : [],
  };
}
