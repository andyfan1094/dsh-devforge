/**
 * 会话记忆层协议 —— host 与 client 共享的类型与 API 路径常量（纯类型，无 Node 依赖）。
 */

/** 记忆工作台路由族。 */
export const MEMORY_API = {
  status: '/api/dsh-devforge/memory/status',
  settings: '/api/dsh-devforge/memory/settings',
  memories: '/api/dsh-devforge/memory/memories',
  memoryItem: '/api/dsh-devforge/memory/memories/item',
  index: '/api/dsh-devforge/rag/kb/index',
  mirrorSync: '/api/dsh-devforge/rag/mirror/sync',
  mirrorStatus: '/api/dsh-devforge/rag/mirror/status',
} as const

/** 记忆层运行设置（store.db settings 域 memory.settings 单例）。 */
export interface MemorySettings {
  /** 总开关：关闭后不沉淀也不注入。 */
  enabled: boolean
  /** 会话结束自动提炼入库（turn/end 驱动）。 */
  autoSediment: boolean
  /** 每轮首步自动检索注入（agent/pre-step 驱动）。 */
  autoInject: boolean
  /** 注入召回条数。 */
  topK: number
  /** 注入相关度阈值（0-1，低于不注入）。 */
  threshold: number
  /** 注入上下文最大字符数。 */
  maxChars: number
}

/** 记忆层状态（面板顶栏）。 */
export interface MemoryStatus {
  enabled: boolean
  autoSediment: boolean
  autoInject: boolean
  memoryKbId: string
  memoryCount: number
  sedimentCount: number
  injectCount: number
  lastSedimentAt: number
  mirror: { mnemonRootExists: boolean; hindsightConfigured: boolean; hindsightServerMode: string; hindsightBank: string }
}

/** 镜像同步响应。 */
export interface MirrorSyncResult {
  source: string
  scanned: number
  added: number
  updated: number
  removed: number
  skipped: number
  errors: string[]
}

/** 项目索引响应。 */
export interface ProjectIndexResult {
  root: string
  scanned: number
  added: number
  updated: number
  removed: number
  skipped: number
  errors: string[]
}
