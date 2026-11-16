# Git 提交规范

本仓库按真实的开发顺序提交，**不采用一次性导入全部代码**的做法。历史本身也是交付物：评审者可以从提交记录看出每一步做了什么。

## 一、提交粒度

每个提交只做一件可描述清楚的事，且让仓库在该提交后仍处于"能讲通"的状态。以下仅是第一版与第二版的**分阶段提交示例**，不代表仓库的完整提交序列：

| 序号 | 提交信息 | 内容 |
| --- | --- | --- |
| 1 | `chore: 初始化 workspaces 脚手架` | 根 `package.json`、`.gitignore`、`.env.example`、前后端 `package.json` 与 `tsconfig`、Vite 配置与入口 HTML |
| 2 | `feat(server): 接入模型代理与 SSE 流式转发` | 配置读取、`LLMProvider` 接口、OpenAI 兼容实现、mock 实现、SSE 通道 |
| 3 | `feat(server): 增加限流、每日额度、答案缓存与输入过滤` | `safety/` 四个模块 |
| 4 | `feat(web): 实现单页对话界面与逐字流式渲染` | `web/src` 全部前端代码 |
| 5 | `feat(server): 增加意图识别与办事手册检索闭环` | `data/handbook.md`、`retrieval/`、`intent.ts`、`answer.ts`、`routes/chat.ts`、`index.ts`、`runtime.ts` |
| 6 | `docs: 补充 README 与 Git 提交规范` | `README.md`、`docs/git-conventions.md` |

第二版（RAG 化）示例：

| 序号 | 提交信息 | 内容 |
| --- | --- | --- |
| 7 | `feat(data): 语料与学校配置从代码中拆出` | `config/school.json`、`data/sample/*.md`、`knowledge/`（frontmatter / chunker / store）、移除旧的单文件语料 |
| 8 | `feat(server): 用 BM25 与可选向量实现混合检索层` | `retrieval/`（tokenizer / bm25 / embedding / hybridRetriever）、`runtime.ts`、`intent.ts`、`.env.example` |
| 9 | `feat: 回答附出处并支持展开原文` | `answer.ts`、`routes/chat.ts`、前端 `CitationList.vue`、`types.ts` |
| 10 | `feat: 支持 PDF/Word 上传预览与入库` | `upload/`、`routes/kb.ts`、上传页、路由与导航、样式 |
| 11 | `docs: 更新 RAG 架构与换学校指南` | `README.md`、`docs/git-conventions.md` |

后续提交（上传上限调整、登录鉴权、SPA 深链接回退、文档修订等）按同一约定执行：一改一分支、`git merge --ff-only` 快进合并、及时推送，不再在此逐条罗列。


## 二、提交信息格式

```
<type>(<scope>): <简述>

<可选：为什么要这样改，以及影响到哪些行为>
```

- `type` 取值：
  - `feat` 新功能
  - `fix` 缺陷修复
  - `refactor` 不改变行为的重构
  - `perf` 性能优化
  - `docs` 文档
  - `test` 测试
  - `chore` 构建、依赖、脚手架
  - `security` 安全相关调整（限流、过滤、鉴权等）
- `scope` 取值：`server`、`web`、`docs`、根目录相关留空。
- 简述使用中文，动词开头，不超过 50 字，结尾不加句号。
- 正文说明**为什么**改，以及验证方式；不要复述 diff。

示例：

```
feat(security): 按 IP 限制每日请求数与 token 消耗

模型调用是唯一有成本的环节，被脚本刷接口会直接消耗额度。
在路由入口处先做限流与额度判断，超限返回 429 并在响应体里给出可展示文案，
前端据此展示明确提示，而不是静默失败。
```

## 三、分支与合并

从 2026-11-16 起，**一个改动一个分支**，推分支后再线性合并回 `main`；此前直接提交到 `main` 的历史不追溯补分支。

1. 从最新 `main` 切分支，分支名体现内容：`feat/mobile-layout`、`fix/quota-429`、`chore/tunnel-host`、`docs/branch-workflow`。
2. 在该分支上提交并推送：`git push -u origin <branch>`。
3. 合并回 `main`，不使用 merge commit：

   ```powershell
   git checkout main
   git merge --ff-only <branch>
   git push origin main
   git branch -d <branch>
   git push origin --delete <branch>   # 远端分支不保留，提交本身仍在 main 上
   ```

4. `main` 始终保持可部署；合并前本地至少通过 `npm run typecheck`，涉及交互的改动再确认 `npm run dev` 能收到流式回复。
5. 报告改动时说明分支名、提交号、该分支改了什么，以及合并后 `main` 的提交数。

## 四、禁止事项

- 禁止提交 `.env`、任何真实 API Key、账号口令、内网地址。
- 禁止提交 `node_modules/`、`dist/`（已在 `.gitignore` 中忽略）。
- 禁止把不相关改动混进同一个提交，例如格式化全仓库。
- 禁止在 `main` 上直接提交（2026-11-16 起）。
