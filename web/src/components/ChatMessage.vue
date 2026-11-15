<script setup lang="ts">
import CitationList from './CitationList.vue';
import type { ChatMessageItem } from '../types';

defineProps<{ message: ChatMessageItem }>();
</script>

<template>
  <article class="msg" :class="message.role">
    <div class="avatar" aria-hidden="true">{{ message.role === 'user' ? '我' : 'CP' }}</div>

    <div class="body">
      <div v-if="message.meta" class="meta-row">
        <span class="chip intent">意图：{{ message.meta.intent.label }}</span>
        <span v-if="message.meta.cached" class="chip cached">命中缓存</span>
        <span v-if="message.meta.retrieval" class="chip retrieval">
          {{ message.meta.retrieval.name }} 检索 · {{ message.meta.retrieval.hits }} 个片段
        </span>
      </div>

      <div class="bubble">
        <span v-if="!message.content && message.streaming" class="thinking">正在检索知识库…</span>
        <template v-else>
          <pre class="text">{{ message.content }}</pre>
          <span v-if="message.streaming" class="caret" aria-hidden="true" />
        </template>
      </div>

      <CitationList v-if="message.meta?.citations?.length" :citations="message.meta.citations" />

      <p v-if="message.error" class="msg-error">{{ message.error }}</p>
    </div>
  </article>
</template>
