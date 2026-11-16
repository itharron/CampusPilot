import { computed, ref } from 'vue';

export type Theme = 'light' | 'dark';

/** 与 index.html 里的首屏脚本共用同一个键，改这里要同步改那边 */
const STORAGE_KEY = 'campuspilot-theme';

const media = window.matchMedia('(prefers-color-scheme: dark)');

function readStored(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

/** null 表示「跟随系统」，只有手动切换后才会写入具体值 */
const preference = ref<Theme | null>(readStored());
const systemTheme = ref<Theme>(media.matches ? 'dark' : 'light');

export const theme = computed<Theme>(() => preference.value ?? systemTheme.value);

function apply(value: Theme) {
  const root = document.documentElement;
  root.dataset.theme = value;
  root.style.colorScheme = value;
}

export function initTheme() {
  apply(theme.value);

  media.addEventListener('change', (event) => {
    systemTheme.value = event.matches ? 'dark' : 'light';
    // 用户手动选过就尊重用户的选择，不再跟随系统
    if (!preference.value) apply(theme.value);
  });
}

export function toggleTheme() {
  const next: Theme = theme.value === 'dark' ? 'light' : 'dark';
  preference.value = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // 隐私模式下 localStorage 可能不可写，主题在本次会话内仍然生效
  }
  apply(next);
}
