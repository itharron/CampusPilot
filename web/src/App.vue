<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { fetchMeta } from './api/chat';

const mode = ref<'mock' | 'live' | 'unknown'>('unknown');
const model = ref('');

onMounted(async () => {
  try {
    const meta = await fetchMeta();
    mode.value = meta.mode;
    model.value = meta.model;
  } catch {
    // 具体错误由对话页展示，这里只保持「连接中」状态
  }
});
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
        <router-link to="/upload" active-class="active">知识库入库</router-link>
      </nav>

      <span class="mode" :class="mode">
        {{ mode === 'live' ? `真实模型 · ${model}` : mode === 'mock' ? 'Mock 演示模式' : '连接中…' }}
      </span>
    </header>

    <div class="page">
      <router-view />
    </div>
  </div>
</template>
