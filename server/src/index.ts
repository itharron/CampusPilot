import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from './config';
import { getClientIp } from './http/sse';
import { answerCache, provider, quota, retriever } from './runtime';
import { chatRouter } from './routes/chat';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

/** 健康检查：顺手暴露当前运行模式，方便验收时确认是 mock 还是真实模型 */
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    mode: provider.mode,
    model: provider.model,
    retriever: retriever.name,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

/** 前端初始化用：展示模式、限额与当前 IP 的剩余额度（不含任何密钥信息） */
app.get('/api/meta', (req, res) => {
  const ip = getClientIp(req.headers['x-forwarded-for'] as string | undefined, req.socket.remoteAddress);
  res.json({
    ok: true,
    mode: provider.mode,
    model: provider.model,
    retriever: retriever.name,
    limits: {
      ratePerMinute: config.safety.rateLimit.max,
      dailyRequests: config.safety.quota.dailyRequests,
      dailyTokens: config.safety.quota.dailyTokens,
      inputMaxChars: config.safety.inputMaxChars,
    },
    usage: quota.snapshot(ip),
    cache: answerCache.stats(),
  });
});

app.use('/api/chat', chatRouter);

// 静态托管构建产物（执行过 npm run build 后，后端也能单独提供一个入口）
const webDist = path.resolve(__dirname, '../../web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
}

// 统一兜底：JSON 解析失败、路由不存在等，都返回前端能直接展示的友好结构
app.use((req: Request, res: Response) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ ok: false, code: 'NOT_FOUND', message: '接口不存在。' });
    return;
  }
  res.status(404).send('Not Found');
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const isBodyError = (error as { type?: string })?.type === 'entity.parse.failed';
  console.error('[server] 请求处理失败：', (error as Error)?.message);

  res.status(isBodyError ? 400 : 500).json({
    ok: false,
    code: isBodyError ? 'BAD_JSON' : 'INTERNAL_ERROR',
    message: isBodyError ? '请求格式不对，请刷新页面重试。' : '服务出错了，请稍后再试。',
  });
});

app.listen(config.port, () => {
  const modeText = provider.mode === 'live' ? `真实模型（${provider.model}）` : 'mock 演示模式（未配置 LLM_API_KEY）';
  console.log(`[CampusPilot] 服务已启动：http://localhost:${config.port}`);
  console.log(`[CampusPilot] 当前模式：${modeText}`);
  console.log(`[CampusPilot] 限流：${config.safety.rateLimit.max} 次/分钟 · 每日 ${config.safety.quota.dailyRequests} 次`);
});
