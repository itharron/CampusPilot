/** 知识库数据模型：一份文档 = 一个 Markdown 文件，切成若干带出处元数据的片段。 */

export interface DocMeta {
  id: string;
  /** 事项名，例如「在读证明开具」 */
  title: string;
  /** 出处文档名，例如《示例大学学生手册（2026）》 */
  document: string;
  /** 章标题，例如「第四章 学籍与证明」 */
  chapter: string;
  /** 条款号，例如「第二十三条」 */
  article: string;
  category: string;
  department: string;
  departmentKey: string;
  duration: string;
  entry: string;
  updated: string;
  keywords: string[];
  materials: string[];
  /** 来源：sample（仓库内置示例语料）/ upload（运行时上传入库） */
  origin: string;
  /** 相对语料根目录的文件路径，便于排查 */
  file: string;
}

export interface Chunk {
  /** 全局唯一片段 id：`<docId>#<序号>` */
  id: string;
  docId: string;
  docTitle: string;
  document: string;
  chapter: string;
  article: string;
  /** 片段所属小节标题，没有标题时为「正文」 */
  section: string;
  /** 页码区间（带页码锚点的语料才有值） */
  pages: string;
  /** 完整的出处串，直接用于前端展示，例如「《…》 · 第四章 学籍与证明 · 第二十三条 · 办理步骤」 */
  source: string;
  department: string;
  /** 片段正文（含小节标题），用于生成回答与 BM25 索引 */
  text: string;
  /** 引用面板里展开显示的原文，过长时截断 */
  excerpt: string;
}

export interface KnowledgeDoc extends DocMeta {
  chunks: Chunk[];
}
