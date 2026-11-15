/**
 * 中文检索分词：不引入分词词典或模型文件。
 * - 连续汉字切成「单字 + 相邻双字」，双字覆盖了「空调 / 报修 / 学籍」这类常见词；
 * - 英文与数字按整词保留；
 * - 过滤高频虚词单字，避免「的、了、我」拉高无关片段。
 */
const STOP_CHARS = new Set(
  '的了呢吗啊呀吧哦我你他她它是在有和与及或就都也还要想能可怎请们这那个下些把被给对从到以为'.split(''),
);

const CJK = /[\u4e00-\u9fa5]/;
const ALNUM = /[a-z0-9]/;

export function tokenize(text: string): string[] {
  const normalized = text.toLowerCase().normalize('NFKC');
  const tokens: string[] = [];
  let buffer = '';

  const flush = () => {
    if (!buffer) return;

    if (CJK.test(buffer[0])) {
      for (const char of buffer) {
        if (!STOP_CHARS.has(char)) tokens.push(char);
      }
      for (let index = 0; index + 1 < buffer.length; index += 1) {
        tokens.push(buffer.slice(index, index + 2));
      }
    } else if (buffer.length > 1) {
      tokens.push(buffer);
    } else if (buffer.length === 1 && ALNUM.test(buffer)) {
      tokens.push(buffer);
    }

    buffer = '';
  };

  for (const char of normalized) {
    if (CJK.test(char) || ALNUM.test(char)) {
      // 汉字与英文/数字相邻时断开，避免「宿舍wifi」被拼成一个词
      if (buffer && CJK.test(buffer[0]) !== CJK.test(char)) flush();
      buffer += char;
    } else {
      flush();
    }
  }
  flush();

  return tokens;
}
