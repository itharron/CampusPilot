<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { auth, logout } from './api/auth';
import { fetchMeta } from './api/chat';
import { theme, toggleTheme } from './theme';

const route = useRoute();
const router = useRouter();

const mode = ref<'mock' | 'live' | 'unknown'>('unknown');
const model = ref('');

function handleLogout() {
  logout();
  if (route.path !== '/') void router.push('/');
}

/**
 * 手机浏览器弹出软键盘时，布局视口（100dvh）不会跟着变，
 * 只有 visualViewport 会缩小。把它的高度写进 CSS 变量，
 * 让外壳高度跟随可视区域，输入框才不会被键盘盖住。
 */
const viewport = window.visualViewport ?? null;

function syncViewportHeight() {
  if (!viewport) return;
  document.documentElement.style.setProperty('--app-h', `${Math.round(viewport.height)}px`);
}

onMounted(async () => {
  syncViewportHeight();
  viewport?.addEventListener('resize', syncViewportHeight);

  try {
    const meta = await fetchMeta();
    mode.value = meta.mode;
    model.value = meta.model;
  } catch {
    // 具体错误由对话页展示，这里只保持「连接中」状态
  }
});

onBeforeUnmount(() => viewport?.removeEventListener('resize', syncViewportHeight));
</script>

<template>
  <div class="app">
    <header class="topbar">
      <router-link to="/" class="brand">
        <div class="logo">CP</div>
        <div class="brand-text">
          <h1>CampusPilot</h1>
          <p>校园「一句话办事」服务台 · RAG 版</p>
        </div>
      </router-link>

      <nav class="nav">
        <router-link to="/" exact-active-class="active">对话</router-link>
        <template v-if="auth.token">
          <router-link to="/upload" active-class="active">知识库入库</router-link>
          <button type="button" class="nav-action" @click="handleLogout">退出</button>
        </template>
        <router-link v-else to="/upload" active-class="active">登录</router-link>

        <button
          type="button"
          class="theme-toggle"
          :title="theme === 'dark' ? '当前为暗色，点击切换到亮色' : '当前为亮色，点击切换到暗色'"
          :aria-label="theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'"
          @click="toggleTheme"
        >
          <!-- 图标与当前主题一致：暗色显示月亮，亮色显示太阳 -->
          <svg
            v-if="theme === 'dark'"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a6.6 6.6 0 0 0 9.7 9.7Z" />
          </svg>
          <svg
            v-else
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="4.2" />
            <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" />
          </svg>
        </button>
      </nav>

      <span class="mode" :class="mode">
        <template v-if="mode === 'live'">
          真实模型<span class="mode-model"> · {{ model }}</span>
        </template>
        <template v-else-if="mode === 'mock'">Mock 演示模式</template>
        <template v-else>连接中…</template>
      </span>
    </header>

    <div class="page">
      <router-view />
    </div>
  </div>
</template>
