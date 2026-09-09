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
  dream: '/api/dsh-devforge/memory/dream',
  dreamRun: '/api/dsh-devforge/memory/dream/run',
  memoryItem: '/api/dsh-devforge/memory/memories/item',
  memoriesPreview: '/api/dsh-devforge/memory/memories/preview',
  profile: '/api/dsh-devforge/memory/profile',
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
  /** 做梦总开关：定期让模型整理记忆库（合并重复、归档过期），默认关闭需显式开启。 */
  dreamEnabled: boolean
  /** 库静默多少分钟后才允许做梦（避免与正在进行的写入互相打断）。 */
  dreamIdleMinutes: number
  /** 两次做梦之间的最小间隔（小时）；无变化的库不会重复做梦。 */
  dreamMinIntervalHours: number
  /** 裁决模型 provider 覆盖；空串 = 跟随会话默认模型。 */
  dreamProvider: string
  /** 裁决模型名覆盖；空串 = 跟随会话默认模型。 */
  dreamModel: string
  /** 裁决输出 token 上限（教训：上限过小时大库的决策清单会被截断导致整轮作废）。 */
  dreamMaxTokens: number
  /** 单轮快照最大条数（超出时优先保留最近更新的条目）。 */
  dreamMaxEntries: number
  /** 快照中单条记忆的截断字符数（控制裁决输入体量）。 */
  dreamMaxChars: number
  /** 沉淀模型 provider 覆盖；空串 = 跟随全局默认路由。
   * 0.26.6 新增：默认路由指向的模型不可用（503 等）时，沉淀不应被聊天默认路由绑架。 */
  sedimentProvider: string
  /** 沉淀模型名覆盖；空串 = 跟随全局默认路由。 */
  sedimentModel: string
}

/** 记忆层状态（面板顶栏）。 */
export interface MemoryStatus {
  enabled: boolean
  autoSediment: boolean
  autoInject: boolean
  memoryKbId: string
  memoryCount: number
  /** 累计沉淀条数（持久化，跨重启累计；首版启用时以存量 memory 库文档数做基线）。 */
  sedimentCount: number
  /** 本次进程运行期沉淀条数（增量口径，与累计值并排展示）。 */
  sedimentRunCount: number
  /** 累计主动注入次数（持久化；历史不可回填，从 0.17.14 起计）。 */
  injectCount: number
  /** 本次进程运行期注入次数（增量口径）。 */
  injectRunCount: number
  lastSedimentAt: number
  /** 最近一次注入时间戳（0 表示尚未注入过）。 */
  lastInjectAt: number
  /** 最近一次注入内容预览（前 120 字）。 */
  lastInjectPreview: string
  /** 累计"触发了但检索无命中"的注入跳过次数。 */
  injectNoHit: number
  /** 本次进程运行期沉淀尝试次数（含失败；观测自动沉淀是否真的在跑）。 */
  sedimentAttemptCount: number
  /** 本次进程运行期沉淀失败次数（模型/解析异常）。 */
  sedimentFailureCount: number
  /** 最近一次沉淀失败原因（脱敏截断；空串 = 无失败）。 */
  sedimentLastError: string
  /** 最近一次提炼批处理判定结果（stored:N / no-candidates / filtered-or-deduped / window-short / failed）。 */
  sedimentLastOutcome: string
  /** 累计做梦整理次数（含失败）。 */
  dreamTotal: number
  /** 最近一次做梦完成时间戳（0 表示尚未做过）。 */
  lastDreamAt: number
  /** 最近一次做梦结果状态。 */
  lastDreamStatus: string
  /** 最近一次做梦一句话摘要。 */
  lastDreamSummary: string
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
  /** 常驻钉选：true 时每轮固定注入，不参与检索相关性过滤（显式钉选，可控可审计）。 */
  pinned?: boolean
  /** 做梦整理标记：true=已归档（软删除，可恢复），不参与注入/检索/图谱。 */
  archived?: boolean
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
  /** 常驻钉选（缺省 false）。 */
  pinned?: boolean
  /** 归档标记（内部透传；缺省视为活跃）。 */
  archived?: boolean
}

/** 内置记忆更新补丁。 */
export interface NativeMemoryPatch {
  content?: string
  category?: NativeMemoryCategory
  tags?: string[]
  source?: string
  sourceId?: string
  importance?: number
  /** 传 false 取消钉选。 */
  pinned?: boolean
  /** 传 false 恢复归档条目。 */
  archived?: boolean
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

/** 用户身份卡（常驻注入的用户画像）。实现与默认值在 memory/profile.ts。 */
export type { MemoryUserProfile } from './profile.ts'

/** 做梦裁决动作：keep=保留原样，merge=多条合并为一条，archive=归档（软删除），update=修订单条。 */
export type MemoryDreamAction = 'keep' | 'merge' | 'archive' | 'update'

/** 模型输出的单条整理决策（仅列需要动作的条目；未被点名的记忆视为 keep）。 */
export interface MemoryDreamDecision {
  action: MemoryDreamAction
  /** 目标记忆 id 清单（merge/archive 可多条，update/keep 恰好 1 条）。 */
  ids: string[]
  /** merge 时保留哪条（缺省取 ids[0]），其余归档。 */
  keepId?: string
  /** merge 时的合并后内容 / update 时的修订内容。 */
  content?: string
  category?: NativeMemoryCategory
  tags?: string[]
  importance?: number
  /** 模型给出的整理理由（仅入审计，不落库）。 */
  reason?: string
}

/** 一次做梦运行的审计记录（docs 域 memory.dreamrun，只保留最近 20 条）。 */
export interface MemoryDreamRun {
  id: string
  /** true=面板/接口手动触发；false=静默窗口自动触发。 */
  manual: boolean
  startedAt: number
  finishedAt: number
  /** ok=决策全部合法；degraded=部分决策被跳过但合法子集已应用；failed=未产出可用决策；skipped=未达触发条件。 */
  status: 'ok' | 'degraded' | 'failed' | 'skipped'
  /** 实际使用的模型路由（provider:model；skipped 时为空串）。 */
  model: string
  /** 快照条数。 */
  snapshot: number
  /** 归档条数（软删除）。 */
  archived: number
  /** 合并组数（一组 merge 保留 1 条、归档其余）。 */
  merged: number
  /** 修订条数。 */
  updated: number
  /** 被跳过的非法决策（截断保留前 20 条原因，防审计膨胀）。 */
  skipped: Array<{ ids: string[]; reason: string }>
  error?: string
}

/** 面板做梦状态（运行开关 + 最近运行记录）。 */
export interface MemoryDreamStatus {
  /** 做梦开关当前值。 */
  enabled: boolean
  /** 是否有做梦运行正在执行。 */
  running: boolean
  /** 最近一次运行记录（从未运行过时缺省）。 */
  lastRun?: MemoryDreamRun
  /** 最近运行记录（新到旧，最多 20 条）。 */
  runs: MemoryDreamRun[]
}
