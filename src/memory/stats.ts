/**
 * 记忆层持久化统计 —— 修复"自动沉淀/主动注入计数重启清零"的可观测性缺陷。
 *
 * 设计要点：
 * - 计数落在 store.db settings 域 `memory.stats`，跨重启累计，与沉淀库总量口径一致；
 * - 首次初始化（域不存在）时用当前 RAG memory 库文档数作为 sedimentTotal 基线，
 *   避免存量库（如已有 126 条沉淀）与新计数器并排展示时自相矛盾；
 * - injectTotal 无历史可回填，诚实从 0 起步，面板以"本次运行 +N"副文案区分口径；
 * - 同时记录最近注入时间与内容预览、无命中跳过计数，让"功能没触发"和"触发了没命中"可区分。
 */
import type { DatabaseSync } from 'node:sqlite'
import { getDb, getSettings, putSettings } from '../store/db.ts'
import type { RagService } from '../rag/service.ts'

/** 记忆层持久化统计结构（settings 域 memory.stats）。 */
export interface MemoryStats {
  /** 累计沉淀条数：首次以存量 memory 库文档数做基线，此后随每次沉淀累加。 */
  sedimentTotal: number
  /** 累计主动注入次数（跨进程累计；历史不可回填，从启用本版起计）。 */
  injectTotal: number
  /** 最近一次沉淀成功的时间戳（毫秒，0 表示本版启用后尚未沉淀）。 */
  lastSedimentAt: number
  /** 最近一次注入的时间戳（毫秒，0 表示尚未注入过）。 */
  lastInjectAt: number
  /** 最近一次注入内容预览（前 120 字，便于确认注入的是预期内容）。 */
  lastInjectPreview: string
  /** 累计"触发了但检索无命中"的注入跳过次数（区分功能失效与正常无命中）。 */
  injectNoHit: number
  /** 累计做梦整理次数（含失败：便于发现"做梦一直失败"的异常）。 */
  dreamTotal: number
  /** 最近一次做梦完成的时间戳（毫秒，0 表示尚未做过）。 */
  lastDreamAt: number
  /** 最近一次做梦结果状态（ok/degraded/failed/skipped）。 */
  lastDreamStatus: string
  /** 最近一次做梦的一句话摘要（面板展示）。 */
  lastDreamSummary: string
}

/** 缺省统计：全部为零值。 */
export function defaultMemoryStats(): MemoryStats {
  return { sedimentTotal: 0, injectTotal: 0, lastSedimentAt: 0, lastInjectAt: 0, lastInjectPreview: '', injectNoHit: 0, dreamTotal: 0, lastDreamAt: 0, lastDreamStatus: '', lastDreamSummary: '' }
}

/** 统计字段防御式规整：存储里的旧数据/脏数据不至让面板崩掉。 */
function normalizeStats(raw: unknown): MemoryStats {
  const base = defaultMemoryStats()
  if (typeof raw !== 'object' || raw === null) return base
  const record = raw as Record<string, unknown>
  return {
    sedimentTotal: typeof record.sedimentTotal === 'number' && Number.isSafeInteger(record.sedimentTotal) && record.sedimentTotal >= 0 ? record.sedimentTotal : base.sedimentTotal,
    injectTotal: typeof record.injectTotal === 'number' && Number.isSafeInteger(record.injectTotal) && record.injectTotal >= 0 ? record.injectTotal : base.injectTotal,
    lastSedimentAt: typeof record.lastSedimentAt === 'number' && record.lastSedimentAt >= 0 ? record.lastSedimentAt : base.lastSedimentAt,
    lastInjectAt: typeof record.lastInjectAt === 'number' && record.lastInjectAt >= 0 ? record.lastInjectAt : base.lastInjectAt,
    lastInjectPreview: typeof record.lastInjectPreview === 'string' ? record.lastInjectPreview.slice(0, 200) : base.lastInjectPreview,
    injectNoHit: typeof record.injectNoHit === 'number' && Number.isSafeInteger(record.injectNoHit) && record.injectNoHit >= 0 ? record.injectNoHit : base.injectNoHit,
    dreamTotal: typeof record.dreamTotal === 'number' && Number.isSafeInteger(record.dreamTotal) && record.dreamTotal >= 0 ? record.dreamTotal : base.dreamTotal,
    lastDreamAt: typeof record.lastDreamAt === 'number' && record.lastDreamAt >= 0 ? record.lastDreamAt : base.lastDreamAt,
    lastDreamStatus: typeof record.lastDreamStatus === 'string' ? record.lastDreamStatus : base.lastDreamStatus,
    lastDreamSummary: typeof record.lastDreamSummary === 'string' ? record.lastDreamSummary.slice(0, 200) : base.lastDreamSummary,
  }
}

/** 持久化统计存储：读写 store.db 单一 settings 域，写频率为对话级（每轮至多一次），无压力。 */
export class MemoryStatsStore {
  private static readonly DOMAIN = 'memory.stats'
  private cache: MemoryStats | undefined

  private readonly rag: RagService
  private readonly memoryKbId: () => string
  private readonly dbPath?: string

  constructor(rag: RagService, memoryKbId: () => string, dbPath?: string) {
    this.rag = rag
    /** memory 库 id 解析器：首次初始化基线用（与沉淀服务同一解析逻辑的宿主侧版本）。 */
    this.memoryKbId = memoryKbId
    /** 库路径：缺省跟随 DSH 默认库；测试传独立路径避免污染真实库。 */
    this.dbPath = dbPath
  }

  /** 统一取库：全部读写走同一路径的单例连接。 */
  private db(): DatabaseSync {
    return getDb(this.dbPath)
  }

  /** 读取统计（带缓存；首次无记录时以存量 memory 库文档数作沉淀基线）。 */
  read(): MemoryStats {
    if (this.cache !== undefined) return this.cache
    const stored = getSettings(this.db(), MemoryStatsStore.DOMAIN)
    if (stored === undefined) {
      // 存量库引导：历史沉淀不可丢口径。RAG 读取失败时保守从 0 起步。
      let baseline = 0
      try {
        const kbId = this.memoryKbId()
        baseline = this.rag.listDocs(kbId).length
      } catch { /* 无库/读取失败：基线 0 */ }
      const initialized = { ...defaultMemoryStats(), sedimentTotal: baseline }
      try { putSettings(this.db(), MemoryStatsStore.DOMAIN, initialized) } catch { /* 写失败下次再试 */ }
      this.cache = initialized
      return this.cache
    }
    this.cache = normalizeStats(stored)
    return this.cache
  }

  /** 原子式更新：读-改-写同一域；回调抛错时不落盘。 */
  update(mutate: (stats: MemoryStats) => MemoryStats): MemoryStats {
    const next = mutate({ ...this.read() })
    try { putSettings(this.db(), MemoryStatsStore.DOMAIN, next) } catch { /* 写失败保留内存值，下次更新再落盘 */ }
    this.cache = next
    return next
  }
}
