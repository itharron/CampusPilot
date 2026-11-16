import crypto from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { config } from '../config';
import { getClientIp } from '../http/sse';
import { IpRateLimiter } from '../safety/rateLimit';

interface Session {
  username: string;
  expiresAt: number;
}

/** 演示场景下用内存会话即可：进程重启后需要重新登录，正好避免 token 长期有效 */
const sessions = new Map<string, Session>();
const MAX_SESSIONS = 200;

/** 登录接口单独限流，避免被脚本反复试密码 */
const loginLimiter = new IpRateLimiter({ windowMs: 60_000, max: 10 });

function pruneExpired(): void {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token);
  }
}

function issueToken(username: string): string {
  pruneExpired();
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest) sessions.delete(oldest);
  }

  const token = crypto.randomBytes(24).toString('base64url');
  sessions.set(token, { username, expiresAt: Date.now() + config.kbAuth.tokenTtlMs });
  return token;
}

function readToken(req: Request): string {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function currentSession(req: Request): Session | null {
  const token = readToken(req);
  if (!token) return null;

  const session = sessions.get(token);
  if (!session) return null;

  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

/** 知识库写操作前的登录校验：未登录或不合法 token 一律 401 */
export function requireKbAuth(req: Request, res: Response, next: NextFunction): void {
  if (currentSession(req)) {
    next();
    return;
  }

  res.status(401).json({
    ok: false,
    code: 'UNAUTHORIZED',
    message: '请先登录后再使用知识库入库功能。',
  });
}

export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  const rate = loginLimiter.consume(
    getClientIp(req.headers['x-forwarded-for'] as string | undefined, req.socket.remoteAddress),
  );
  if (!rate.allowed) {
    res.status(429).json({ ok: false, code: 'RATE_LIMITED', message: '登录尝试太频繁，请稍后再试。' });
    return;
  }

  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!username || !password) {
    res.status(400).json({ ok: false, code: 'INVALID_INPUT', message: '用户名和密码都要填写。' });
    return;
  }

  if (username !== config.kbAuth.username || password !== config.kbAuth.password) {
    res.status(401).json({ ok: false, code: 'INVALID_CREDENTIALS', message: '用户名或密码不对，请按页面提示填写演示账号。' });
    return;
  }

  res.json({
    ok: true,
    token: issueToken(username),
    username,
    expiresInSeconds: Math.round(config.kbAuth.tokenTtlMs / 1000),
  });
});

authRouter.get('/session', (req, res) => {
  const session = currentSession(req);
  if (!session) {
    res.status(401).json({ ok: false, code: 'UNAUTHORIZED', message: '登录已失效，请重新登录。' });
    return;
  }

  res.json({ ok: true, username: session.username });
});

authRouter.post('/logout', (req, res) => {
  const token = readToken(req);
  if (token) sessions.delete(token);
  res.json({ ok: true });
});
