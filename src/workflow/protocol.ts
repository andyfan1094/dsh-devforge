/**
 * 工作流协议 —— RAG 管线编排的类型与 API 路径常量（纯类型，无 Node 依赖）。
 */

/** 工作流路由族。 */
export const WORKFLOW_API = {
  list: '/api/dsh-devforge/rag/workflows',
  item: '/api/dsh-devforge/rag/workflows/item',
  run: '/api/dsh-devforge/rag/workflows/run',
  runs: '/api/dsh-devforge/rag/workflows/runs',
} as const

/** 工作流节点集合（每个节点可选；缺省=关闭）。 */
export interface WorkflowNodes {
  /** 查询改写：用模型把原问题改写为 2-3 个等价检索式，多路召回合并。 */
  rewrite?: { enabled: boolean }
  /** 多源检索（必选节点，参数可调）。 */
  retrieve: { kbIds?: string[]; topK: number; vectorWeight: number }
  /** 精排（跟随全局 rerank 设置执行；节点仅决定是否启用）。 */
  rerank?: { enabled: boolean }
  /** 生成：带引用标注的回答。 */
  generate: { provider?: string; model?: string; maxTokens?: number }
  /** 自评重试：判断答案是否严格基于材料，未过则重试。 */
  selfCheck?: { enabled: boolean; maxRetries: number }
}

/** 工作流定义（store.db docs 域 rag.workflow）。 */
export interface WorkflowDefinition {
  id: string
  name: string
  description?: string
  nodes: WorkflowNodes
  createdAt: number
  updatedAt: number
}

/** 单步执行记录。 */
export interface WorkflowStepTrace {
  name: string
  ms: number
  detail?: string
}

/** 运行记录（store.db docs 域 rag.workflow_run，保留最近 50 条）。 */
export interface WorkflowRunRecord {
  id: string
  workflowId: string
  workflowName: string
  query: string
  answer: string
  sources: Array<{ fileName: string; headingPath: string; score: number }>
  steps: WorkflowStepTrace[]
  status: 'ok' | 'failed'
  error?: string
  createdAt: number
}

/** 运行结果（面板与 rag_run 工具共用）。 */
export interface WorkflowRunResult {
  runId: string
  answer: string
  sources: WorkflowRunRecord['sources']
  steps: WorkflowStepTrace[]
  status: 'ok' | 'failed'
  error?: string
}
