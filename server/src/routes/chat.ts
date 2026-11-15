import { Router } from 'express';
import { buildCitations, composeAnswer, orderHitsForAnswer, renderContext } from '../answer';
import { config, estimateTokens } from '../config';
import type { ChatMessage } from '../llm/provider';
import { LLMError } from '../llm/provider';
import { getClientIp, openSse } from '../http/sse';
import { groupHitsByDoc, recognizeIntent } from '../intent';
import { answerCache, provider, quota, rateLimiter, retriever, store } from '../runtime';
import { filterInput } from '../safety/inputFilter';

const SYSTEM_PROMPT = [
  '你是 CampusPilot，某高校的校园办事服务台助手。',
  '你的唯一职责是把同学描述的需求，对应到学校知识库里已收录的办事依据，并给出可执行的办理指引。',
  '',
  '规则：',
  '1. 只依据【参考资料】回答，不要编造部门名称、电话、网址、办理时限。',
  '2. 参考资料里没有的事项，就直说暂时未收录，并建议联系辅导员或人工服务台，不要硬编流程。',
  '3. 先给结论（去哪办），再给步骤，最后给材料或注意事项；总长度不超过 250 字。',
  '4. 每个关键结论后面用 [1]、[2] 这样的编号标注依据，编号必须与【参考资料】的序号一致；不要编造编号。',
  '5. 语气简洁、友好，像真人服务台，不使用营销腔。',
  '6. 不回答与校园办事无关的请求，包括写代码、写作文、闲聊、情感咨询。',
].join('\n');

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const chatRouter = Router();

chatRouter.post('/', async (req, res) => {
  const ip = getClientIp(req.headers['x-forwarded-for'] as string | undefined, req.socket.remoteAddress);
  const rawMessage = typeof req.body?.message === 'string' ? req.body.message : '';
  const message = rawMessage.trim();

  // 1) 输入过滤：越界 / 注入 / 敏感信息直接拦下，不消耗任何额度
  const verdict = filterInput(message);
  if (!verdict.ok) {
    res.status(400).json({ ok: false, code: 'BLOCKED_INPUT', category: verdict.category, message: verdict.message });
    return;
  }

  // 2) 单 IP 限流
  const rate = rateLimiter.consume(ip);
  if (!rate.allowed) {
    const retryAfter = Math.max(1, Math.ceil(rate.resetInMs / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({
      ok: false,
      code: 'RATE_LIMITED',
      retryAfterSeconds: retryAfter,
      message: `提问有点频繁，请 ${retryAfter} 秒后再试（每分钟上限 ${config.safety.rateLimit.max} 次）。`,
    });
    return;
  }

  // 3) 每日额度（请求数 + token 消耗）
  const decision = quota.reserve(ip);
  if (!decision.allowed) {
    res.status(429).json({ ok: false, code: 'DAILY_QUOTA_EXCEEDED', message: decision.message });
    return;
  }

  const sse = openSse(res);
  const controller = new AbortController();
  res.on('close', () => controller.abort());

  let answer = '';

  try {
    // 4) 相同问题直接回放缓存（仍然走流式，前端体验一致）
    const cached = answerCache.get(message);
    if (cached) {
      sse.send('meta', {
        mode: provider.mode,
        model: provider.model,
        intent: { id: 'cached', label: cached.intentLabel, confidence: 1 },
        topDocTitle: cached.topDocTitle,
        citations: cached.citations,
        cached: true,
        quotaRemaining: decision.snapshot.remainingRequests,
        rateRemaining: rate.remaining,
      });

      for (let index = 0; index < cached.text.length; index += 6) {
        if (controller.signal.aborted) return;
        sse.send('delta', { text: cached.text.slice(index, index + 6) });
        await sleep(8);
      }

      sse.send('done', { cached: true, tokens: 0 });
      sse.close();
      return;
    }

    // 5) 检索 → 引用 → 意图 → 组装上下文
    const hits = await retriever.search(message, { topK: 4 });
    const orderedHits = orderHitsForAnswer(hits);
    const intent = recognizeIntent(hits);
    const citations = buildCitations(orderedHits);
    const topDoc = groupHitsByDoc(hits)[0] ?? null;

    sse.send('meta', {
      mode: provider.mode,
      model: provider.model,
      intent,
      topDocTitle: topDoc?.title ?? null,
      citations,
      cached: false,
      retrieval: {
        name: retriever.name,
        hits: hits.length,
        topScore: hits[0]?.score ?? 0,
        matched: hits[0]?.matchedTerms ?? [],
      },
      quotaRemaining: decision.snapshot.remainingRequests,
      rateRemaining: rate.remaining,
    });

    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `【参考资料】\n${renderContext(orderedHits)}\n\n【同学的问题】\n${message}`,
      },
    ];

    // 6) 流式输出（真实模型 or mock）
    for await (const delta of provider.stream(
      { messages, fallbackText: composeAnswer(orderedHits, store) },
      controller.signal,
    )) {
      if (controller.signal.aborted) break;
      answer += delta;
      sse.send('delta', { text: delta });
    }

    if (controller.signal.aborted) return;

    const tokens = estimateTokens(answer);
    quota.addTokens(ip, tokens);

    if (answer.trim()) {
      answerCache.set(message, {
        text: answer,
        intentLabel: intent.label,
        topDocTitle: topDoc?.title ?? null,
        citations,
      });
    }

    sse.send('done', { cached: false, tokens });
    sse.close();
  } catch (error) {
    if (controller.signal.aborted) {
      sse.close();
      return;
    }

    const detail = error instanceof LLMError ? error.message : (error as Error)?.message;
    console.error('[chat] 生成失败：', detail);

    if (!answer) {
      // 一个字都没吐出来：退回本地模板答案，保证用户仍然拿得到办理指引
      const hits = await retriever.search(message, { topK: 1 }).catch(() => []);
      const text = `模型服务暂时不可用，先按本地知识库给你一份指引：\n\n${composeAnswer(hits, store)}`;

      for (let index = 0; index < text.length; index += 6) {
        sse.send('delta', { text: text.slice(index, index + 6) });
        await sleep(8);
      }

      sse.send('error', { code: 'LLM_UNAVAILABLE', message: '模型服务暂时不可用，以上内容来自本地知识库。' });
      sse.close();
      return;
    }

    sse.send('error', { code: 'LLM_INTERRUPTED', message: '回答中断了，请稍后重试。' });
    sse.close();
  }
});
