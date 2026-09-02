/**
 * RAG 记忆中枢协议 —— host 与 client 共享的类型与 API 路径常量。
 *
 * 契约边界：浏览器半边（RagTab）与宿主半边（rag/routes.ts）都从这里 import，
 * 字段改名编译期即报错（对齐 src/protocol.ts 的总契约模式）。
 */

/** RAG 路由族。 */
export const RAG_API = {
  /** 知识库列表/创建。 */
  kbList: '/api/dsh-devforge/rag/kb',
  /** 单库操作（更新/删除）。 */
  kbItem: '/api/dsh-devforge/rag/kb/item',
  /** 文档上传/列表。 */
  docList: '/api/dsh-devforge/rag/docs',
  /** 二进制文档上传（PDF/DOCX base64，服务端临时文件解析）。 */
  docFile: '/api/dsh-devforge/rag/docs/file',
  /** 单文档操作（删除/重建索引）。 */
  docItem: '/api/dsh-devforge/rag/docs/item',
  /** 切块预览（不入库）。 */
  chunkPreview: '/api/dsh-devforge/rag/chunks/preview',
  /** 检索（测试台与 rag_search 工具共用）。 */
  search: '/api/dsh-devforge/rag/search',
  /** 全局设置读写。 */
  settings: '/api/dsh-devforge/rag/settings',
  /** 向量渠道连通性测试（不入库，实时调用）。 */
  settingsTest: '/api/dsh-devforge/rag/settings/test',
} as const

/** 向量渠道（对应天工造梦已接的 Provider；ollama=本机；custom=任意 OpenAI 兼容服务；siliconflow=硅基流动免费档）。 */
export type RagEmbeddingProvider = 'zhipu' | 'ark' | 'openai-gateway' | 'ollama' | 'custom' | 'siliconflow'

/** 知识库来源类型（memory=会话记忆库，由记忆沉淀层写入）。 */
export type RagKbSource = 'manual' | 'project' | 'mirror' | 'memory'

/** 知识库（store.db docs 域 rag.kb）。 */
export interface RagKnowledgeBase {
  id: string
  name: string
  /** 来源：手动上传 / 项目索引 / 外部系统镜像。 */
  source: RagKbSource
  /** 库级向量渠道；缺省继承全局设置。 */
  embedding?: { provider: RagEmbeddingProvider; model: string }
  /** 库级切块参数；缺省继承全局设置。 */
  chunk?: { maxSize: number; overlap: number }
  /** 创建时间（epoch 毫秒）。 */
  createdAt: number
  /** 简介（面板展示）。 */
  description?: string
}

/** 文档入库状态。 */
export type RagDocStatus = 'pending' | 'parsing' | 'embedding' | 'ready' | 'failed'

/** 文档（store.db docs 域 rag.doc）。 */
export interface RagDocument {
  id: string
  kbId: string
  fileName: string
  /** 来源路径（project/mirror 来源用）。 */
  sourcePath?: string
  /** 原文内容 sha256（增量索引判断是否需重嵌）。 */
  contentHash: string
  status: RagDocStatus
  /** 切块数（冗余展示字段）。 */
  chunkCount: number
  /** 失败原因（status=failed 时展示，已脱敏）。 */
  error?: string
  createdAt: number
}

/** 检索请求（测试台、rag_search 工具、工作流检索节点共用）。 */
export interface RagSearchRequest {
  kbIds?: string[]
  query: string
  /** 召回数量。 */
  topK?: number
  /** 混合权重 0-1：0 纯关键词，1 纯向量，默认 0.5。 */
  vectorWeight?: number
}

/** 检索命中。 */
export interface RagSearchHit {
  chunkId: string
  docId: string
  kbId: string
  fileName: string
  headingPath: string
  text: string
  /** 归一化相关度 0-1。 */
  score: number
  /** 所属知识库名（检索时冗余装饰，便于出处展示）。 */
  kbName?: string
}

/** 全局设置（store.db settings 域 rag.settings 单例）。 */
export interface RagSettings {
  embedding: {
    provider: RagEmbeddingProvider
    model: string
    /** custom 渠道：服务地址（填到 /v1 这级，实际调用 {baseURL}/embeddings）。 */
    baseURL?: string
    /** custom 渠道：受管凭据引用名（默认 RAG_CUSTOM_EMBEDDING_API_KEY）。 */
    apiKeyEnv?: string
  }
  rerank: { mode: 'zhipu' | 'llm' | 'off'; topN: number }
  chunk: { maxSize: number; overlap: number }
  search: { topK: number; vectorWeight: number; threshold: number }
  advanced: { concurrency: number; cacheEnabled: boolean; timeoutMs: number }
}
