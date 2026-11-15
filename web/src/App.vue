<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import ChatMessage from './components/ChatMessage.vue';
import { ChatRequestError, fetchMeta, streamChat } from './api/chat';
import type { ChatMessageItem, ServerMeta } from './types';

const QUICK_PROMPTS = ['宿舍空调坏了', '我要开在读证明', '校园卡丢了怎么办', '自习教室怎么借'];

const messages = ref<ChatMessageItem[]>([]);
const input = ref('');
const sending = ref(false);
const serverMeta = ref<ServerMeta | null>(null);
const quotaRemaining = ref<number | null>(null);
const rateRemaining = ref<number | null>(null);
const banner = ref<{ type: 'warn' | 'error'; text: string } | null>(null);
const scroller = ref<HTMLElement | null>(null);
const controller = shallowRef<AbortController | null>(null);

let seq = 0;
const nextId = () => `m-${++seq}`;

const modeLabel = computed(() => {
  if (!serverMeta.value) return '连接中…';
  return serverMeta.value.mode === 'live' ? `真实模型 · ${serverMeta.value.model}` : 'Mock 演示模式';
});

const maxChars = computed(() => serverMeta.value?.limits.inputMaxChars ?? 500);
const canSend = computed(() => input.value.trim().length > 0 && !sending.value);

onMounted(async () => {
  try {
    const meta = await fetchMeta();
    serverMeta.value = meta;
    quotaRemaining.value = meta.usage.remainingRequests;
  } catch (error) {
    banner.value = {
      type: 'error',
      text: error instanceof ChatRequestError ? error.payload.message : '无法连接后端服务，请确认已启动 server。',
    };
  }
});

onBeforeUnmount(() => controller.value?.abort());

function scrollToBottom() {
  nextTick(() => {
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight;
  });
}

function applyQuickPrompt(text: string) {
  input.value = text;
  void send();
}

async function send() {
  const question = input.value.trim();
  if (!question || sending.value) return;

  banner.value = null;
  input.value = '';
  sending.value = true;

  messages.value.push({ id: nextId(), role: 'user', content: question });

  const reply: ChatMessageItem = { id: nextId(), role: 'assistant', content: '', streaming: true };
  messages.value.push(reply);
  scrollToBottom();

  const abort = new AbortController();
  controller.value = abort;

  const current = () => messages.value.find((item) => item.id === reply.id);

  try {
    await streamChat(
      question,
      {
        onMeta(meta) {
          const target = current();
          if (target) target.meta = meta;
          if (serverMeta.value) {
            serverMeta.value.mode = meta.mode;
            serverMeta.value.model = meta.model;
          }
          if (meta.quotaRemaining !== null) quotaRemaining.value = meta.quotaRemaining;
          if (meta.rateRemaining !== null) rateRemaining.value = meta.rateRemaining;
        },
        onDelta(text) {
          const target = current();
          if (!target) return;
          target.content += text;
          scrollToBottom();
        },
        onDone() {
          if (quotaRemaining.value !== null && quotaRemaining.value > 0) {
            quotaRemaining.value -= 1;
          }
          const target = current();
          if (target) target.streaming = false;
          scrollToBottom();
        },
        onError(event) {
          const target = current();
          if (target) target.error = event.message;
        },
      },
      abort.signal,
    );

    const target = current();
    if (target) target.streaming = false;
  } catch (error) {
    const target = current();

    if (error instanceof DOMException && error.name === 'AbortError') {
      if (target) {
        target.streaming = false;
        target.error = '已取消本次提问。';
      }
      return;
    }

    if (error instanceof ChatRequestError) {
      const { code, message, category, retryAfterSeconds } = error.payload;

      if (target) {
        target.streaming = false;
        target.content = '';
        target.error = message;
      }

      const hint =
        code === 'RATE_LIMITED'
          ? `请求被限流${retryAfterSeconds ? `，约 ${retryAfterSeconds} 秒后恢复` : ''}。`
          : code === 'DAILY_QUOTA_EXCEEDED'
            ? '今日额度已用完。'
            : code === 'BLOCKED_INPUT'
              ? `请求已被安全策略拦截（${category ?? 'unknown'}）。`
              : message;

      banner.value = { type: code === 'BLOCKED_INPUT' ? 'warn' : 'error', text: hint };
    } else {
      if (target) {
        target.streaming = false;
        target.error = '网络异常，回答中断了，请重试。';
      }
      banner.value = { type: 'error', text: '网络异常，请检查后端是否在运行。' };
    }
  } finally {
    sending.value = false;
    controller.value = null;
    scrollToBottom();
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    void send();
  }
}
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <div class="logo">CP</div>
        <div class="brand-text">
          <h1>CampusPilot</h1>
          <p>校园「一句话办事」服务台</p>
        </div>
      </div>
      <span class="mode" :class="serverMeta?.mode ?? 'unknown'">{{ modeLabel }}</span>
    </header>

    <main ref="scroller" class="chat">
      <section v-if="messages.length === 0" class="welcome">
        <h2>把要办的事说一句话就行</h2>
        <p>例如「宿舍空调坏了」「我要开在读证明」，我会告诉你找哪个部门、怎么走流程。</p>
        <div class="quick">
          <button v-for="prompt in QUICK_PROMPTS" :key="prompt" type="button" @click="applyQuickPrompt(prompt)">
            {{ prompt }}
          </button>
        </div>
      </section>

      <ChatMessage v-for="item in messages" :key="item.id" :message="item" />
    </main>

    <div v-if="banner" class="banner" :class="banner.type" role="status">
      <span>{{ banner.text }}</span>
      <button type="button" aria-label="关闭提示" @click="banner = null">×</button>
    </div>

    <form class="composer" @submit.prevent="send">
      <textarea
        v-model="input"
        :maxlength="maxChars"
        rows="2"
        placeholder="用一句话描述你要办的事，Enter 发送，Shift + Enter 换行"
        :disabled="sending"
        @keydown="onKeydown"
      />
      <div class="composer-actions">
        <span class="counter">{{ input.length }} / {{ maxChars }}</span>
        <button v-if="sending" type="button" class="ghost" @click="controller?.abort()">停止</button>
        <button type="submit" class="primary" :disabled="!canSend">发送</button>
      </div>
    </form>

    <footer class="foot">
      <span>今日剩余 {{ quotaRemaining ?? '—' }} 次 · 本分钟剩余 {{ rateRemaining ?? '—' }} 次</span>
      <span>仅供参考，正式办理以学校通知为准</span>
    </footer>
  </div>
</template>
