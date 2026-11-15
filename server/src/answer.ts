import type { RetrievalHit } from './retrieval/types';

const NO_MATCH_ANSWER = [
  '这件事我暂时没在校园办事手册里查到对应的办理入口。',
  '',
  '目前收录的事项有：宿舍空调报修、在读证明开具、校园卡挂失补办、教室与活动场地借用、校园网故障处理。',
  '你可以换个说法再问一次，或者直接说明是哪个部门的事，我再帮你找找。',
  '如果是紧急情况，建议直接联系辅导员或拨打学校总机转人工服务台。',
].join('\n');

function renderDoc(hit: RetrievalHit): string {
  const doc = hit.doc;
  const lines: string[] = [`我在校园办事手册里找到了「${doc.title}」的办理方式：`, ''];

  if (doc.department) lines.push(`· 归属部门：${doc.department}`);
  if (doc.duration) lines.push(`· 办理时限：${doc.duration}`);
  if (doc.entry) lines.push(`· 办理入口：${doc.entry}`);

  if (doc.steps.length) {
    lines.push('', '办理步骤：');
    doc.steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
  }

  if (doc.materials.length) {
    lines.push('', '需要准备：');
    doc.materials.forEach((item) => lines.push(`- ${item}`));
  }

  if (doc.notes.length) {
    lines.push('', '补充说明：');
    doc.notes.forEach((item) => lines.push(`- ${item}`));
  }

  return lines.join('\n');
}

/**
 * 用检索结果拼一段可直接展示的答案。
 * 两个用途：mock 模式下的正文，以及真实模型调用失败时的兜底内容。
 */
export function composeAnswer(hits: RetrievalHit[]): string {
  if (hits.length === 0) return NO_MATCH_ANSWER;

  const parts = [renderDoc(hits[0])];
  const related = hits.slice(1).map((hit) => hit.doc.title);

  if (related.length) {
    parts.push('', `另外可能相关：${related.join('、')}`);
  }

  return parts.join('\n');
}

/** 把检索结果整理成给大模型的参考资料文本 */
export function renderContext(hits: RetrievalHit[]): string {
  if (hits.length === 0) return '（本次没有检索到相关办事事项）';

  return hits
    .map((hit) => {
      const doc = hit.doc;
      return [
        `## ${doc.title}`,
        `归属部门：${doc.department || '未标注'}`,
        `办理时限：${doc.duration || '未标注'}`,
        `办理入口：${doc.entry || '未标注'}`,
        doc.steps.length ? `办理步骤：\n${doc.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : '',
        doc.materials.length ? `需要材料：\n${doc.materials.map((m) => `- ${m}`).join('\n')}` : '',
        doc.notes.length ? `补充说明：\n${doc.notes.map((n) => `- ${n}`).join('\n')}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
}
