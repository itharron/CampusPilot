<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ChatMessage from '../components/ChatMessage.vue';
import { ChatRequestError, fetchMeta, streamChat } from '../api/chat';
import type { ChatMessageItem, ServerMeta } from '../types';

/**
 * 首屏只露出 3 个高频示例（每个分组取一条），其余收进「更多示例」；
 * 展开后仍按原来的三个分组给出全部 9 条。
 */
const PRIMARY_PROMPTS = ['宿舍空调坏了', '我要开在读证明', '教室怎么借用'];

const EXAMPLE_GROUPS = [
  {
    title: '生活报修',
    prompts: ['宿舍空调坏了', '校园网连不上', '校园卡丢了怎么办'],
  },
  {
    title: '学籍与考试',
    prompts: ['我要开在读证明', '缓考怎么申请', '休学和复学怎么办'],
  },
  {
    title: '场地与奖惩',
    prompts: ['教室怎么借用', '奖学金什么时候评', '对处分有异议怎么办'],
  },
];

const STEPS = [
  { title: '选一句话开始', text: '点示例或直接输入。' },
  { title: '说清什么事', text: '带上具体情况更好查。' },
  { title: '看部门与出处', text: '回答附手册原文。' },
];

const SCOPE = '可问：报修、校园卡、校园网、教室借用、在读证明、缓考、休学复学、请假、奖学金、处分申诉';

const route = useRoute();
const router = useRouter();

const messages = ref<ChatMessageItem[]>([]);
const input = ref('');
const sending = ref(false);
const showAllExamples = ref(false);

/**
 * 触屏设备或窄屏（与样式断点一致）上回车只换行，发送统一走按钮：
 * 软键盘的回车很容易误触，而且用户往往只是想分段。
 * 桌面端保持回车发送、Shift + Enter 换行的既有约定。
 */
const mobileQuery =
  typeof window === 'undefined' ? null : window.matchMedia('(pointer: coarse), (max-width: 640px)');
const isMobile = ref(mobileQuery?.matches ?? false);

function syncMobile() {
  isMobile.value = mobileQuery?.matches ?? false;
}
const serverMeta = ref<ServerMeta | null>(null);
const quotaRemaining = ref<number | null>(null);
const rateRemaining = ref<number | null>(null);
const banner = ref<{ type: 'warn' | 'error'; text: string } | null>(null);
const scroller = ref<HTMLElement | null>(null);
const controller = shallowRef<AbortController | null>(null);

let seq = 0;
const nextId = () => `m-${++seq}`;

const maxChars = computed(() => serverMeta.value?.limits.inputMaxChars ?? 500);
const canSend = computed(() => input.value.trim().length > 0 && !sending.value);

onMounted(async () => {
  syncMobile();
  mobileQuery?.addEventListener('change', syncMobile);

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

  // /?q=<问题> 直达：自动填入并发送，然后清掉查询参数，避免刷新重复提问
  const preset = typeof route.query.q === 'string' ? route.query.q.trim() : '';
  if (preset) {
    await router.replace({ path: route.path });
    input.value = preset.slice(0, maxChars.value);
    void send();
  }
});

onBeforeUnmount(() => {
  mobileQuery?.removeEventListener('change', syncMobile);
  controller.value?.abort();
});

function scrollToBottom() {
  nextTick(() => {
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight;
  });
}

function applyQuickPrompt(text: string) {
  input.value = text;
  void send();
}

/** 引用高亮需要知道这一轮回答对应的问题，取该消息之前最近的一条用户消息 */
function questionBefore(index: number): string {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (messages.value[i].role === 'user') return messages.value[i].content;
  }
  return '';
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
  if (event.key !== 'Enter' || event.shiftKey) return;
  // 移动端：交给浏览器插入换行，不拦截、不发送
  if (isMobile.value) return;
  event.preventDefault();
  void send();
}
</script>

<template>
  <div class="chat-page">
    <main ref="scroller" class="chat">
      <section v-if="messages.length === 0" class="welcome">
        <div class="hero">
          <span class="hero-badge">校园事务 · 一句话问清</span>
          <h2>不用查手册，把要办的事说一句话</h2>
          <p>
            我会告诉你去哪个部门、带什么材料、怎么走流程，并附上学生手册的原文出处，方便你核对。
          </p>
        </div>

        <ol class="steps">
          <li v-for="(step, index) in STEPS" :key="step.title">
            <strong><span class="step-no">{{ index + 1 }}</span>{{ step.title }}</strong>
            <span>{{ step.text }}</span>
          </li>
        </ol>

        <p class="guide-title">点一个示例，直接看效果</p>
        <div v-if="!showAllExamples" class="quick quick-primary">
          <button
            v-for="prompt in PRIMARY_PROMPTS"
            :key="prompt"
            type="button"
            @click="applyQuickPrompt(prompt)"
          >
            {{ prompt }}
          </button>
        </div>

        <div class="example-more">
          <button
            type="button"
            class="more-toggle"
            :aria-expanded="showAllExamples"
            @click="showAllExamples = !showAllExamples"
          >
            {{ showAllExamples ? '收起更多示例' : '更多示例' }}
            <svg
              class="more-chevron"
              :class="{ open: showAllExamples }"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="m4 6 4 4 4-4" />
            </svg>
          </button>
        </div>

        <div v-if="showAllExamples" class="example-groups">
          <section v-for="group in EXAMPLE_GROUPS" :key="group.title" class="example-group">
            <h3>{{ group.title }}</h3>
            <div class="quick">
              <button
                v-for="prompt in group.prompts"
                :key="prompt"
                type="button"
                @click="applyQuickPrompt(prompt)"
              >
                {{ prompt }}
              </button>
            </div>
          </section>
        </div>

        <p class="scope">{{ SCOPE }}</p>
      </section>

      <ChatMessage
        v-for="(item, index) in messages"
        :key="item.id"
        :message="item"
        :question="questionBefore(index)"
        @pick="applyQuickPrompt"
      />
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
        :enterkeyhint="isMobile ? 'enter' : 'send'"
        :placeholder="
          isMobile
            ? '描述你要办的事，回车换行，点「发送」提交'
            : '用一句话描述你要办的事，Enter 发送，Shift + Enter 换行'
        "
        :disabled="sending"
        @focus="scrollToBottom"
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
      <span>
        知识库 {{ serverMeta?.corpus?.docs ?? '—' }} 篇 / {{ serverMeta?.corpus?.chunks ?? '—' }} 个片段 · 仅供参考
      </span>
    </footer>
  </div>
</template>
