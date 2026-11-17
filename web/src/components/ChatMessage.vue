<script setup lang="ts">
import { computed } from 'vue';
import CitationList from './CitationList.vue';
import type { ChatMessageItem } from '../types';

const props = defineProps<{ message: ChatMessageItem; question?: string }>();
const emit = defineEmits<{ pick: [query: string] }>();
const route = computed(() => props.message.meta?.route ?? null);
const guess = computed(() => {
  const interpretation = props.message.meta?.interpretation;
  return interpretation?.guessed ? interpretation : null;
});
</script>

<template>
  <article class="msg" :class="message.role">
    <div class="avatar" aria-hidden="true">{{ message.role === 'user' ? '我' : 'CP' }}</div>

    <div class="body">
      <div v-if="message.meta" class="meta-row">
        <span v-if="route" class="chip route" :class="'route-' + route.path">
          路径：{{ route.title }}
        </span>
        <span v-if="!route || route.path === 'kb'" class="chip intent">意图：{{ message.meta.intent.label }}</span>
        <span v-if="message.meta.cached" class="chip cached">命中缓存</span>
        <span v-if="message.meta.retrieval" class="chip retrieval">
          {{ message.meta.retrieval.name }} 检索 · {{ message.meta.retrieval.hits }} 个片段
        </span>
      </div>

      <div v-if="guess" class="guess-note">
        <div class="guess-head">
          <span class="guess-tag">推测</span>
          <span>你问的是「<strong>{{ guess.query }}</strong>」</span>
        </div>
        <p class="guess-why">{{ guess.reason }}</p>
        <div v-if="guess.candidates.length" class="guess-actions">
          <span class="guess-ask">不是这个？</span>
          <button
            v-for="candidate in guess.candidates"
            :key="candidate.query"
            type="button"
            @click="emit('pick', candidate.query)"
          >
            {{ candidate.label }}
          </button>
        </div>
      </div>

      <div v-if="route" class="route-note" :class="'route-' + route.path">
        <div class="route-head">
          <span class="route-tool">{{ route.tool }}</span>
          <strong>{{ route.title }}</strong>
          <span class="route-conf">置信度 {{ Math.round(route.confidence * 100) }}%</span>
        </div>
        <p class="route-why">{{ route.reason }}</p>
        <ul v-if="route.department" class="route-contact">
          <li><span>归属部门</span>{{ route.department.name }}</li>
          <li v-if="route.department.entry">
            <span>办理入口</span>{{ route.department.entry }}
          </li>
          <li v-if="route.department.window">
            <span>人工窗口</span>{{ route.department.window }}
          </li>
          <li v-if="route.department.serviceHours">
            <span>服务时间</span>{{ route.department.serviceHours }}
          </li>
          <li v-if="route.department.fallback">
            <span>兜底渠道</span>{{ route.department.fallback }}
          </li>
        </ul>
      </div>

      <div class="bubble">
        <span v-if="!message.content && message.streaming" class="thinking" role="status">
          <span class="thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span>
          正在检索知识库…
        </span>
        <template v-else>
          <pre class="text">{{ message.content }}</pre>
          <span v-if="message.streaming" class="caret" aria-hidden="true" />
        </template>
      </div>

      <CitationList
        v-if="message.meta?.citations?.length"
        :citations="message.meta.citations"
        :question="question"
      />

      <p v-if="message.error" class="msg-error">{{ message.error }}</p>
    </div>
  </article>
</template>
