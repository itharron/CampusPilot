<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import {
  KbRequestError,
  confirmDocument,
  fetchDocs,
  previewDocument,
  type KbConfirmResult,
  type KbDocsResult,
  type KbPreview,
} from '../api/kb';

const MAX_BYTES = 5 * 1024 * 1024;

const fileInput = ref<HTMLInputElement | null>(null);
const selected = ref<File | null>(null);
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

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;
  error.value = '';
  result.value = null;
  preview.value = null;

  if (file && file.size > MAX_BYTES) {
    selected.value = null;
    error.value = `文件 ${(file.size / 1024 / 1024).toFixed(1)} MB，超过 5 MB 上限，请拆分或压缩后再上传。`;
    input.value = '';
    return;
  }
  selected.value = file;
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
    error.value = describe(uploadError);
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
    error.value = describe(uploadError);
  } finally {
    busy.value = false;
  }
}

onMounted(reloadDocs);
</script>

<template>
  <div class="kb-page">
    <main class="kb-main">
      <section class="kb-hero">
        <h2>知识库上传入库</h2>
        <p>
          支持 PDF、Word（.docx）、Markdown、TXT，单个文件不超过 5 MB。上传后先看切分结果，确认即写入
          <code>data/uploads/</code> 并重新构建索引，回到对话页就能检索到。
        </p>
      </section>

      <div v-if="error" class="banner error" role="alert">
        <span>{{ error }}</span>
        <button type="button" aria-label="关闭提示" @click="error = ''">×</button>
      </div>

      <section class="kb-card">
        <h3>1. 选择文件</h3>
        <div class="kb-picker">
          <input ref="fileInput" type="file" accept=".pdf,.docx,.md,.txt" @change="onFileChange" />
          <button type="button" class="primary" :disabled="!selected || busy" @click="runPreview">
            {{ busy && !preview ? '解析中…' : '上传并切分' }}
          </button>
        </div>
        <p v-if="selected" class="kb-tip">已选择：{{ selected.name }}（{{ (selected.size / 1024).toFixed(0) }} KB）</p>
        <p class="kb-tip">扫描件 PDF 抽不出文字时会明确报错（不做 OCR）；解析失败也会给出原因，不会静默吞掉。</p>
      </section>

      <section v-if="preview" class="kb-card">
        <h3>2. 预览切分结果</h3>
        <p class="kb-tip">
          {{ preview.fileName }} · 抽取 {{ preview.chars }} 字<template v-if="preview.pages"> · {{ preview.pages }} 页</template>
          · 切成 {{ preview.chunkCount }} 块
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
        <h3>已入库</h3>
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
    </main>
  </div>
</template>
