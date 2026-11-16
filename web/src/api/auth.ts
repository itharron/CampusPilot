import { reactive } from 'vue';

const TOKEN_KEY = 'campuspilot.kb.token';
const USER_KEY = 'campuspilot.kb.user';

export class AuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

function readStorage(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

/** 登录态放响应式对象里，顶栏导航与上传页共享同一份状态 */
export const auth = reactive({
  token: readStorage(TOKEN_KEY),
  username: readStorage(USER_KEY),
});

function persist(): void {
  try {
    if (auth.token) {
      localStorage.setItem(TOKEN_KEY, auth.token);
      localStorage.setItem(USER_KEY, auth.username);
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    }
  } catch {
    // 隐私模式下 localStorage 不可写，退化为仅本次会话有效
  }
}

/** 需要鉴权的请求统一从这里取头，未登录时返回空对象 */
export function authHeaders(): Record<string, string> {
  return auth.token ? { authorization: `Bearer ${auth.token}` } : {};
}

export async function login(username: string, password: string): Promise<void> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; token?: string; username?: string; code?: string; message?: string }
    | null;

  if (!response.ok || !payload?.token) {
    throw new AuthError(payload?.code ?? 'LOGIN_FAILED', payload?.message ?? '登录失败，请稍后再试。');
  }

  auth.token = payload.token;
  auth.username = payload.username ?? username;
  persist();
}

export function logout(): void {
  const token = auth.token;
  auth.token = '';
  auth.username = '';
  persist();

  if (token) {
    void fetch('/api/auth/logout', { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => {
      // 退出失败不影响本地状态清理
    });
  }
}
