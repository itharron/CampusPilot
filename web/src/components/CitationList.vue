<script setup lang="ts">
import { ref } from 'vue';
import type { Citation } from '../types';

defineProps<{ citations: Citation[] }>();

const expanded = ref<number[]>([]);

function toggle(index: number) {
  expanded.value = expanded.value.includes(index)
    ? expanded.value.filter((item) => item !== index)
    : [...expanded.value, index];
}
</script>

<template>
  <section class="citations">
    <p class="citations-title">依据来源 · 点击可查看原文</p>
    <ul class="citation-list">
      <li v-for="citation in citations" :key="citation.index" class="citation-item">
        <button type="button" class="citation-head" @click="toggle(citation.index)">
          <span class="citation-index">[{{ citation.index }}]</span>
          <span class="citation-source">{{ citation.source }}</span>
          <span class="citation-toggle">{{ expanded.includes(citation.index) ? '收起' : '展开原文' }}</span>
        </button>
        <div v-if="expanded.includes(citation.index)" class="citation-body">
          <p class="citation-meta">
            {{ citation.document }}<template v-if="citation.pages"> · 第 {{ citation.pages }} 页</template>
            <template v-if="citation.department"> · {{ citation.department }}</template>
          </p>
          <pre class="citation-text">{{ citation.excerpt }}</pre>
        </div>
      </li>
    </ul>
  </section>
</template>
