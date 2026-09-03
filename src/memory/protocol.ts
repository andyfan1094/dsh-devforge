/**
 * 会话记忆层协议 —— host 与 client 共享的类型与 API 路径常量（纯类型，无 Node 依赖）。
 */

/** 记忆工作台路由族。 */
export const MEMORY_API = {
  status: '/api/dsh-devforge/memory/status',
  settings: '/api/dsh-devforge/memory/settings',
  memories: '/api/dsh-devforge/memory/memories',
  search: '/api/dsh-devforge/memory/search',
  save: '/api/dsh-devforge/memory/save',
  update: '/api/dsh-devforge/memory/update',
  remove: '/api/dsh-devforge/memory/delete',
  migrate: '/api/dsh-devforge/memory/migrate',
  migrateExternal: '/api/dsh-devforge/memory/migrate/external',
  migrationStatus: '/api/dsh-devforge/memory/migration-status',
  memoryItem: '/api/dsh-devforge/memory/memories/item',
  nativeList: '/api/dsh-devforge/memory/native',
  graph: '/api/dsh-devforge/memory/graph',
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

/** 内置记忆分类。 */
export type NativeMemoryCategory = 'preference' | 'decision' | 'fact' | 'insight' | 'context' | 'general'

/** 内置记忆条目（store.db docs 域 memory.entry，主存储不依赖外部插件）。 */
export interface NativeMemoryEntry {
  id: string
  content: string
  category: NativeMemoryCategory
  tags: string[]
  source: string
  sourceId?: string
  importance: number
  createdAt: number
  updatedAt: number
  /** 外部迁移幂等键；同一来源重复导入只更新。 */
  migrationKey?: string
}

/** 内置记忆写入输入。 */
export interface NativeMemoryInput {
  content: string
  category?: NativeMemoryCategory
  tags?: string[]
  source?: string
  sourceId?: string
  importance?: number
  migrationKey?: string
}

/** 内置记忆更新补丁。 */
export interface NativeMemoryPatch {
  content?: string
  category?: NativeMemoryCategory
  tags?: string[]
  source?: string
  sourceId?: string
  importance?: number
}

/** 批量迁移输入项。 */
export interface NativeMemoryMigrationItem extends NativeMemoryInput {
  id?: string
}

/** 批量迁移结果统计。 */
export interface NativeMemoryMigrationResult {
  scanned: number
  added: number
  updated: number
  skipped: number
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

/** 知识图谱节点类型：entry=记忆条目，tag=标签/关键词，category=分类枢纽。 */
export type MemoryGraphNodeKind = 'entry' | 'tag' | 'category'

/** 知识图谱节点（weight 为连接度，前端用来定半径）。 */
export interface MemoryGraphNode {
  id: string
  kind: MemoryGraphNodeKind
  label: string
  weight: number
  /** kind=entry 时回指完整条目 id，供点击查看详情。 */
  entryId?: string
}

/** 知识图谱边（weight 为共现强度）。 */
export interface MemoryGraphEdge {
  source: string
  target: string
  weight: number
}

/** 知识图谱（由内置长期记忆条目派生，只读、每次请求现算）。 */
export interface MemoryGraph {
  nodes: MemoryGraphNode[]
  edges: MemoryGraphEdge[]
  generatedAt: number
}
