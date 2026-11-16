<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Citation } from '../types';

const props = defineProps<{ citations: Citation[]; question?: string }>();

const expanded = ref<number[]>([]);

function toggle(index: number) {
  expanded.value = expanded.value.includes(index)
    ? expanded.value.filter((item) => item !== index)
    : [...expanded.value, index];
}

/** 问句里的常见虚词，不参与高亮，避免满屏都是 mark */
const STOP_TERMS = new Set([
  '什么',
  '怎么',
  '为什',
  '么办',
  '如何',
  '我要',
  '我想',
  '我的',
  '可以',
  '能不',
  '不能',
  '是不',
  '不是',
  '没有',
  '一个',
  '一下',
  '请问',
  '需要',
  '现在',
  '时候',
  '哪些',
  '多少',
  '几天',
  '之后',
  '的话',
]);

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 从提问里抽取可高亮的词：
 * - 英文/数字按单词取（长度至少 2）
 * - 中文按连续汉字段切 n-gram（2~6 字），过滤虚词
 * 片段本身只在空格与标点处切分，因此不会把标点带进 mark。
 */
const terms = computed(() => {
  const question = (props.question ?? '').trim();
  if (!question) return [];

  const found = new Set<string>();

  for (const word of question.match(/[A-Za-z][A-Za-z0-9_-]*|\d{2,}/g) ?? []) {
    if (word.length >= 2) found.add(word);
  }

  for (const run of question.match(/[\u4e00-\u9fff]+/g) ?? []) {
    const longest = Math.min(6, run.length);
    for (let size = longest; size >= 2; size -= 1) {
      for (let start = 0; start + size <= run.length; start += 1) {
        const piece = run.slice(start, start + size);
        if (!STOP_TERMS.has(piece)) found.add(piece);
      }
    }
  }

  return [...found].sort((a, b) => b.length - a.length);
});

const matcher = computed(() => {
  if (!terms.value.length) return null;
  return new RegExp(terms.value.map(escapeRegExp).join('|'), 'gi');
});

function segments(text: string): { text: string; hit: boolean }[] {
  const pattern = matcher.value;
  if (!pattern) return [{ text, hit: false }];

  const parts: { text: string; hit: boolean }[] = [];
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) parts.push({ text: text.slice(cursor, start), hit: false });
    parts.push({ text: match[0], hit: true });
    cursor = start + match[0].length;
  }

  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false });
  return parts;
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
          <pre class="citation-text"><template v-for="(segment, index) in segments(citation.excerpt)" :key="index"><mark v-if="segment.hit">{{ segment.text }}</mark><template v-else>{{ segment.text }}</template></template></pre>
        </div>
      </li>
    </ul>
  </section>
</template>
