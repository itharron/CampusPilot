<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { auth, logout } from './api/auth';
import { fetchMeta } from './api/chat';

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
