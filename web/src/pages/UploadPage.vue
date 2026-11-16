<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { AuthError, auth, login, logout } from '../api/auth';
import {
  KbRequestError,
  confirmDocument,
  fetchDocs,
  previewDocument,
  type KbConfirmResult,
  type KbDocsResult,
  type KbPreview,
} from '../api/kb';

const MAX_MB = 50;
const MAX_BYTES = MAX_MB * 1024 * 1024;

/** 与 server/src/config.ts 中的演示账号保持一致，页面直接给出便于评审照抄 */
const DEMO_ACCOUNT = { username: 'demo', password: 'campus2026' };

const loginForm = reactive({ username: '', password: '' });
const loginBusy = ref(false);
const loginError = ref('');

const fileInput = ref<HTMLInputElement | null>(null);
const selected = ref<File | null>(null);
const dragging = ref(false);
const preview = ref<KbPreview | null>(null);
const result = ref<KbConfirmResult | null>(null);
const docs = ref<KbDocsResult | null>(null);
const busy = ref(false);
const error = ref('');
const expandedChunk = ref<number | null>(null);

const form = reactive({
  title: '',
  document: '',
  chapter: '',
  article: '',
  category: '上传文档',
  department: '',
  duration: '',
  entry: '',
});

function describe(error: unknown): string {
  if (error instanceof KbRequestError) return error.message;
  return '上传失败，请确认后端服务在运行后重试。';
}

/** 会话过期时退回登录态，避免用户在上传按钮上反复失败 */
function handleExpired(error: unknown): boolean {
  if (error instanceof KbRequestError && error.code === 'UNAUTHORIZED') {
    logout();
    loginError.value = '登录已过期，请重新登录后再上传。';
    return true;
  }
  return false;
}

function fillDemo() {
  loginForm.username = DEMO_ACCOUNT.username;
  loginForm.password = DEMO_ACCOUNT.password;
  loginError.value = '';
}

async function submitLogin() {
  if (loginBusy.value) return;

  loginError.value = '';
  if (!loginForm.username.trim() || !loginForm.password) {
    loginError.value = '用户名和密码都要填写。';
    return;
  }

  loginBusy.value = true;
  try {
    await login(loginForm.username.trim(), loginForm.password);
    loginForm.password = '';
    await reloadDocs();
  } catch (failure) {
    loginError.value = failure instanceof AuthError ? failure.message : '登录失败，请确认后端服务在运行。';
  } finally {
    loginBusy.value = false;
  }
}

function selectFile(file: File | null) {
  error.value = '';
  result.value = null;
  preview.value = null;

  if (!file) {
    selected.value = null;
    return;
  }

  if (!/\.(pdf|docx|md|txt)$/i.test(file.name)) {
    selected.value = null;
    error.value = '只支持 PDF、Word（.docx）、Markdown、TXT 文件，请换一个文件。';
    return;
  }

  if (file.size > MAX_BYTES) {
    selected.value = null;
    error.value = `文件 ${(file.size / 1024 / 1024).toFixed(1)} MB，超过 ${MAX_MB} MB 上限，请拆分或压缩后再上传。`;
    return;
  }

  selected.value = file;
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  selectFile(input.files?.[0] ?? null);
  if (!selected.value) input.value = '';
}

function onDragOver(event: DragEvent) {
  event.preventDefault();
  dragging.value = true;
}

function onDragLeave(event: DragEvent) {
  const next = event.relatedTarget as Node | null;
  if (!next || !(event.currentTarget as HTMLElement).contains(next)) dragging.value = false;
}

function onDrop(event: DragEvent) {
  event.preventDefault();
  dragging.value = false;
  selectFile(event.dataTransfer?.files?.[0] ?? null);
  if (fileInput.value) fileInput.value.value = '';
}

async function reloadDocs() {
  try {
    docs.value = await fetchDocs();
  } catch {
    // 列表加载失败不阻断上传主流程
  }
}

async function runPreview() {
  if (!selected.value || busy.value) return;

  busy.value = true;
  error.value = '';
  result.value = null;

  try {
    const data = await previewDocument(selected.value);
    preview.value = data;
    Object.assign(form, {
      title: data.suggestions.title,
      document: data.suggestions.document,
      chapter: data.suggestions.chapter,
      article: data.suggestions.article,
      category: data.suggestions.category,
      department: data.suggestions.department,
      duration: '',
      entry: '',
    });
    expandedChunk.value = data.chunks.length ? data.chunks[0].index : null;
  } catch (uploadError) {
    if (!handleExpired(uploadError)) error.value = describe(uploadError);
  } finally {
    busy.value = false;
  }
}

async function confirm() {
  if (!preview.value || busy.value) return;

  if (!form.title.trim() || !form.document.trim() || !form.chapter.trim()) {
    error.value = '标题、文档名与章节都不能为空，它们会作为回答里的出处。';
    return;
  }

  busy.value = true;
  error.value = '';

  try {
    const data = await confirmDocument({ draftId: preview.value.draftId, ...form });
    result.value = data;
    preview.value = null;
    selected.value = null;
    if (fileInput.value) fileInput.value.value = '';
    await reloadDocs();
  } catch (uploadError) {
    if (!handleExpired(uploadError)) error.value = describe(uploadError);
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  if (auth.token) void reloadDocs();
});
</script>

<template>
  <div class="kb-page">
    <main class="kb-main">
      <section v-if="!auth.token" class="kb-card login-card">
        <h2>知识库入库需要登录</h2>
        <p class="login-lead">
          上传的文档会写进共享知识库、改变所有人的检索结果，所以只对已登录用户开放。对话与检索无需登录。
        </p>

        <div class="demo-account">
          <span>演示账号：用户名 <code>{{ DEMO_ACCOUNT.username }}</code> · 密码 <code>{{ DEMO_ACCOUNT.password }}</code></span>
          <button type="button" class="ghost" @click="fillDemo">一键填入</button>
        </div>

        <form class="login-form" @submit.prevent="submitLogin">
          <label>
            用户名
            <input
              v-model="loginForm.username"
              maxlength="40"
              autocomplete="username"
              :placeholder="DEMO_ACCOUNT.username"
            />
          </label>
          <label>
            密码
            <input
              v-model="loginForm.password"
              type="password"
              maxlength="60"
              autocomplete="current-password"
              :placeholder="DEMO_ACCOUNT.password"
            />
          </label>
          <button type="submit" class="primary" :disabled="loginBusy">
            {{ loginBusy ? '登录中…' : '登录' }}
          </button>
        </form>

        <p v-if="loginError" class="login-error" role="alert">{{ loginError }}</p>
        <p class="kb-tip">登录状态保留 2 小时，退出后需要重新登录。</p>
      </section>

      <template v-else>
        <section class="kb-hero">
          <h2>知识库上传入库</h2>
          <p>
            已登录为 <strong>{{ auth.username }}</strong>。支持 PDF、Word（.docx）、Markdown、TXT，单个文件不超过
            {{ MAX_MB }} MB。上传后先看切分结果，确认即写入 <code>data/uploads/</code> 并重新构建索引，回到对话页就能检索到。
          </p>
        </section>

        <div v-if="error" class="banner error" role="alert">
          <span>{{ error }}</span>
          <button type="button" aria-label="关闭提示" @click="error = ''">×</button>
        </div>

        <section class="kb-card">
          <h3>1. 选择文件</h3>
          <div
            class="kb-drop"
            :class="{ 'is-dragging': dragging }"
            @dragenter.prevent="dragging = true"
            @dragover="onDragOver"
            @dragleave="onDragLeave"
            @drop="onDrop"
          >
            <p class="kb-drop-title">拖拽文件到这里，或点击选择</p>
            <p class="kb-drop-hint">
              支持 PDF、Word（.docx）、Markdown、TXT，单个文件不超过 {{ MAX_MB }} MB
            </p>
            <div class="kb-picker">
              <input ref="fileInput" type="file" accept=".pdf,.docx,.md,.txt" @change="onFileChange" />
              <button type="button" class="primary" :disabled="!selected || busy" @click="runPreview">
                {{ busy && !preview ? '解析中…' : '上传并切分' }}
              </button>
            </div>
          </div>
          <p v-if="selected" class="kb-tip">已选择：{{ selected.name }}（{{ (selected.size / 1024).toFixed(0) }} KB）</p>
          <p class="kb-tip">扫描件 PDF 抽不出文字时会明确报错（不做 OCR）；解析失败也会给出原因，不会静默吞掉。</p>
        </section>

      <section v-if="preview" class="kb-card">
        <h3>2. 预览切分结果</h3>
        <p class="kb-tip kb-feedback">
          已切分为 {{ preview.chunkCount }} 个片段：{{ preview.fileName }} · 抽取 {{ preview.chars }} 字<template v-if="preview.pages"> · {{ preview.pages }} 页</template>
        </p>

        <ul class="chunk-list">
          <li v-for="chunk in preview.chunks" :key="chunk.index">
            <button
              type="button"
              class="chunk-head"
              @click="expandedChunk = expandedChunk === chunk.index ? null : chunk.index"
            >
              <span class="chunk-index">#{{ chunk.index }}</span>
              <span class="chunk-heading">{{ chunk.heading }}</span>
              <span class="chunk-chars">{{ chunk.chars }} 字</span>
            </button>
            <pre v-if="expandedChunk === chunk.index" class="chunk-text">{{ chunk.preview }}</pre>
          </li>
        </ul>

        <h3>3. 确认出处信息</h3>
        <div class="kb-form">
          <label>标题<input v-model="form.title" maxlength="60" placeholder="例如：图书馆研讨间预约" /></label>
          <label>文档名<input v-model="form.document" maxlength="80" placeholder="例如：《示例大学图书馆使用手册（2026）》" /></label>
          <label>章节<input v-model="form.chapter" maxlength="80" placeholder="例如：第三章 空间预约" /></label>
          <label>条款<input v-model="form.article" maxlength="40" placeholder="选填，例如：第十二条" /></label>
          <label>部门<input v-model="form.department" maxlength="60" placeholder="选填，例如：图书馆读者服务部" /></label>
          <label>办理时限<input v-model="form.duration" maxlength="80" placeholder="选填" /></label>
          <label>办理入口<input v-model="form.entry" maxlength="120" placeholder="选填" /></label>
        </div>

        <div class="kb-actions">
          <button type="button" class="ghost" @click="preview = null">取消</button>
          <button type="button" class="primary" :disabled="busy" @click="confirm">
            {{ busy ? '入库中…' : '确认入库并立即检索' }}
          </button>
        </div>
      </section>

      <section v-if="result" class="kb-card success">
        <h3>入库成功</h3>
        <p>
          「{{ result.title }}」共 {{ result.chunkCount }} 个片段，出处：{{ result.source }}。
          知识库现有 {{ result.corpus.docs }} 篇文档 / {{ result.corpus.chunks }} 个片段。
        </p>
        <router-link to="/" class="inline-link">去对话页问一句试试 →</router-link>
      </section>

      <section class="kb-card">
        <h3>当前知识库</h3>
        <p class="kb-tip">
          {{ docs?.corpus.docs ?? '—' }} 篇文档 / {{ docs?.corpus.chunks ?? '—' }} 个片段 /
          {{ docs?.corpus.chars ?? '—' }} 字
        </p>
        <ul class="doc-list">
          <li v-for="doc in docs?.docs ?? []" :key="doc.id">
            <span class="doc-title">{{ doc.title }}</span>
            <span class="doc-meta">{{ doc.document }}<template v-if="doc.chapter"> · {{ doc.chapter }}</template></span>
            <span class="doc-origin" :class="doc.origin">{{ doc.origin === 'upload' ? '上传' : '内置' }}</span>
            <span class="doc-chunks">{{ doc.chunks }} 块</span>
          </li>
        </ul>
      </section>
      </template>
    </main>
  </div>
</template>
