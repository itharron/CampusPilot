import { config } from '../config';

export type FilterCategory = 'injection' | 'out_of_scope' | 'privacy' | 'too_long';

export type FilterVerdict =
  | { ok: true }
  | { ok: false; category: FilterCategory; message: string };

interface Rule {
  category: FilterCategory;
  patterns: RegExp[];
  message: string;
}

/**
 * 输入过滤（第一版为规则占位实现）。
 * 三件事：长度兜底、提示词注入/越狱拦截、越界请求拦截。
 * 后续可以换成分类模型，只要保持返回 FilterVerdict 即可。
 */
const RULES: Rule[] = [
  {
    category: 'injection',
    patterns: [
      /忽略.{0,8}(之前|上面|以上|前面).{0,8}(指令|要求|设定|规则)/,
      /(ignore|forget|disregard).{0,20}(previous|above|prior).{0,20}(instruction|prompt|rule)/i,
      /(系统提示词|系统指令|system\s*prompt|prompt\s*(泄露|输出|给我))/i,
      /(开发者模式|developer\s*mode|越狱|jailbreak)/i,
      /(你现在不是|假装你是|扮演).{0,12}(不受限制|没有任何限制|无限制|管理员)/,
    ],
    message:
      '抱歉，这类"改设定/要提示词"的要求我不能处理。我只负责校园办事指引，你可以直接说想办的事，比如「宿舍空调坏了」。',
  },
  {
    category: 'out_of_scope',
    patterns: [
      /(代考|替考|代写论文|论文代写|代写作业|枪手)/,
      /(伪造|制作假).{0,6}(公章|证明|证件|签名|成绩单|实习证明)/,
      /(黑进|入侵|破解|绕过|hack).{0,10}(教务|系统|后台|密码|账号|成绩)/i,
      /(查|获取).{0,4}(别人|他人|同学|室友).{0,4}(成绩|信息|身份)/,
      /(开房|赌博|代开发票|洗钱|办假证)/,
    ],
    message:
      '抱歉，涉及伪造材料、代考代写、绕过系统或查询他人信息的事情我不能帮忙。如果是你自己的办事需求，直接说事情本身就行。',
  },
  {
    category: 'privacy',
    patterns: [
      // 18 位身份证号、大陆手机号：提醒脱敏，不落库、不外发
      /(?<!\d)\d{17}[\dXx](?!\d)/,
      /(?<!\d)1[3-9]\d{9}(?!\d)/,
    ],
    message:
      '为保护隐私，请不要发送身份证号、手机号这类敏感信息。说明要办的事项即可，需要核验时系统会单独引导你。',
  },
];

export function filterInput(rawInput: string): FilterVerdict {
  const input = rawInput.trim();

  if (input.length === 0) {
    return { ok: false, category: 'too_long', message: '请先输入你想办的事情～' };
  }

  if (input.length > config.safety.inputMaxChars) {
    return {
      ok: false,
      category: 'too_long',
      message: `输入有点长（上限 ${config.safety.inputMaxChars} 字）。请用一句话描述要办的事情，我再帮你查流程。`,
    };
  }

  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(input))) {
      return { ok: false, category: rule.category, message: rule.message };
    }
  }

  return { ok: true };
}
