/**
 * 记忆库做梦整理 —— 定期让模型对内置记忆（memory.entry）做一次「合并重复、归档过期」的整理。
 *
 * 设计要点（每条都来自真实踩坑，见仓库记忆）：
 * - 只列需要动作的条目：模型只输出 merge/archive/update 决策，未点名的记忆视为保留。
 *   （mneme 的教训：要求给每条记忆都出决策，200 条的输出数组轻易撑爆 token 上限被截断，整轮作废。）
 * - 单条决策非法只跳过该条，绝不整批作废。（mneme 的教训：一个全局配额错误让 200 条决策全部落空。）
 * - 钉选（pinned）条目任何决策都不得触碰：常驻注入是用户显式红线，做梦无权动它。
 * - 归档是软删除（archived=true，可恢复），审计记录保留每一步，可人工回滚。
 * - 触发采用「静默窗口 + 最小间隔 + 库指纹」三重门槛：不打断写入、不空转重复做梦。
 * - 裁决失败只记审计与计数，绝不影响会话与写入主链路。
 */
import { randomUUID } from 'node:crypto'
import type { NativeMemoryEntry, NativeMemoryStore } from './native.ts'
import type { MemoryDreamDecision, MemoryDreamRun, MemorySettings } from './protocol.ts'

/** 做梦裁决用的文本生成适配器（接线层用 ctx.llm.stream 实现，支持模型路由覆盖；测试注入 fake）。 */
export type DreamGenerateFn = (input: { system: string; user: string; maxTokens?: number; provider?: string; model?: string }) => Promise<string>

/** 做梦审计的 docs 域名（store.db，随 CNB 备份跨端）。 */
export const MEMORY_DREAM_RUN_DOMAIN = 'memory.dreamrun'

/** 审计保留条数上限：只留最近 20 次，防止域无限膨胀。 */
const MAX_AUDIT_RUNS = 20

/** 活跃记忆少于此数不值得做梦（空库/近空库整理没有意义，还白花一次模型调用）。 */
const MIN_SNAPSHOT = 8

/** 快照条目里单条被跳过的原因上限（审计防膨胀）。 */
const MAX_SKIPPED_RECORDS = 20

/** 裁决系统提示词：说明可用动作、红线与输出格式（导出供单测断言关键约束存在）。 */
export function buildDreamSystemPrompt(): string {
  return [
    '你是记忆库整理员。下面给出内置长期记忆库的活跃条目快照（JSON 数组），请找出应当整理的条目并输出决策。',
    '目标：合并语义重复/高度同主题的条目、归档已过期或一次性的临时状态条目、修订内容有错漏的条目。',
    '可用动作：',
    '- merge：把 2 条及以上同分类（category 相同）的重复条目合并为 1 条。必须给出 content（合并后的完整内容，信息不丢失）、可选 keepId（保留哪条的 id，缺省用 ids 第一条）、可选 tags/importance。',
    '- archive：归档过期、失效或一次性的条目（软删除，可恢复）。',
    '- update：修订单条记忆的 content/category/tags/importance，必须产生真实变化。',
    '- keep：明确保留（通常不需要输出，未点名的条目一律视为 keep）。',
    '红线：不要输出任何未列出的 id；不要合并不同分类的条目；宁可少动也不误删——拿不准的一律 keep。',
    'ids 必须逐字复制快照里的完整 id（不得缩写或截断）；只整理确实需要动作的条目，输出可以是空数组。',
    '只输出 JSON 数组，不输出解释。数组元素形如：',
    '[{"action":"merge","ids":["id1","id2"],"keepId":"id1","content":"合并后的内容","importance":4,"reason":"同一主题重复 3 条"}]',
  ].join('\n')
}

/** 裁决输入快照：紧凑 JSON 行列表（导出供单测）。 */
export function buildDreamUserPrompt(entries: readonly NativeMemoryEntry[], maxChars: number): string {
  const lines = entries.map((entry) => JSON.stringify({
    id: entry.id,
    category: entry.category,
    importance: entry.importance,
    ...(entry.tags.length > 0 ? { tags: entry.tags } : {}),
    ...(entry.pinned === true ? { pinned: true } : {}),
    content: entry.content.length > maxChars ? entry.content.slice(0, maxChars) + '…' : entry.content,
  }))
  return '记忆库活跃条目快照（共 ' + entries.length + ' 条）：\n' + lines.join('\n')
}

/** 从模型输出里提取决策 JSON 数组（容忍代码块围栏与前后缀文本；无数组时抛错由调用方记审计）。 */
export function parseDreamDecisions(text: string): MemoryDreamDecision[] {
  // 失败时带上原始输出预览：否则「模型到底输出了什么」无从排查（真实踩坑：failed 只有错误名）。
  const preview = (): string => {
    const flat = text.trim().replace(/\s+/g, ' ')
    return flat === '' ? '（空输出）' : flat.slice(0, 160)
  }
  const fail = (message: string): never => { throw new Error(message + '（输出预览：' + preview() + '）') }
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return fail('no json array in llm output')
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1)) as unknown
  } catch (error) {
    return fail('决策 JSON 解析失败：' + (error instanceof Error ? error.message : String(error)).slice(0, 120))
  }
  if (Array.isArray(parsed)) return filterDreamDecisions(parsed)
  // 兜底：模型把数组包进对象（如 {"decisions":[...]}）时取第一个数组值字段，不让整轮作废。
  if (parsed !== null && typeof parsed === 'object') {
    const wrapper = Object.values(parsed as Record<string, unknown>).find((value): value is unknown[] => Array.isArray(value))
    if (wrapper !== undefined) return filterDreamDecisions(wrapper)
  }
  return fail('no json array in llm output')
}

/** 决策元素过滤：非对象或缺 action 字符串的元素直接丢弃。 */
function filterDreamDecisions(items: readonly unknown[]): MemoryDreamDecision[] {
  return items.filter((item): item is MemoryDreamDecision => item !== null && typeof item === 'object' && typeof (item as MemoryDreamDecision).action === 'string')
}

/** 决策应用结果（审计口径）。 */
export interface DreamApplyResult {
  archived: number
  merged: number
  updated: number
  skipped: Array<{ ids: string[]; reason: string }>
}

/**
 * 逐条校验并应用决策。单条非法只跳过并记录原因，合法子集照常应用。
 * 铁律：钉选条目不可触碰；跨分类不得合并；已归档条目不再参与。
 */
export function applyDreamDecisions(store: NativeMemoryStore, decisions: readonly MemoryDreamDecision[]): DreamApplyResult {
  const result: DreamApplyResult = { archived: 0, merged: 0, updated: 0, skipped: [] }
  const claimed = new Set<string>()
  const skip = (ids: string[], reason: string): void => {
    if (result.skipped.length < MAX_SKIPPED_RECORDS) result.skipped.push({ ids, reason })
  }
  const usable = (id: string): NativeMemoryEntry | undefined => {
    const entry = store.get(id)
    if (entry === undefined) return undefined
    if (entry.archived === true) return undefined
    if (entry.pinned === true) return undefined
    return entry
  }
  for (const decision of decisions) {
    const ids = Array.isArray(decision.ids) ? decision.ids.filter((id) => typeof id === 'string') : []
    try {
      if (decision.action === 'keep' || ids.length === 0) continue
      // 同一记忆不允许被多个决策重复处置（先到先得，后到跳过）。
      if (ids.some((id) => claimed.has(id))) { skip(ids, '目标条目已被其他决策处置'); continue }
      if (decision.action === 'archive') {
        const targets: NativeMemoryEntry[] = []
        let invalid = ''
        for (const id of ids) {
          const entry = usable(id)
          if (entry === undefined) { invalid = 'id 不存在、已归档或被钉选：' + id; break }
          targets.push(entry)
        }
        if (invalid !== '') { skip(ids, invalid); continue }
        for (const entry of targets) { store.archive(entry.id, true); claimed.add(entry.id) }
        result.archived += targets.length
        continue
      }
      if (decision.action === 'merge') {
        if (ids.length < 2) { skip(ids, 'merge 至少需要 2 个 id'); continue }
        const targets: NativeMemoryEntry[] = []
        let invalid = ''
        for (const id of ids) {
          const entry = usable(id)
          if (entry === undefined) { invalid = 'id 不存在、已归档或被钉选：' + id; break }
          targets.push(entry)
        }
        if (invalid !== '') { skip(ids, invalid); continue }
        const categories = new Set(targets.map((entry) => entry.category))
        if (categories.size > 1) { skip(ids, 'merge 不能跨分类（' + [...categories].join(', ') + '）'); continue }
        const content = typeof decision.content === 'string' ? decision.content.trim() : ''
        if (content === '') { skip(ids, 'merge 需要非空 content'); continue }
        const keepId = typeof decision.keepId === 'string' && ids.includes(decision.keepId) ? decision.keepId : targets[0].id
        const keeper = targets.find((entry) => entry.id === keepId) ?? targets[0]
        // 合并内容 = 决策给出的内容；保留条目吸收 tags 并集与最高重要性。
        const tags = [...new Set(targets.flatMap((entry) => entry.tags))].slice(0, 20)
        const importance = Math.max(...targets.map((entry) => entry.importance))
        store.update(keeper.id, {
          content,
          ...(decision.category !== undefined ? { category: decision.category } : {}),
          tags,
          importance: typeof decision.importance === 'number' ? decision.importance : importance,
        })
        claimed.add(keeper.id)
        let archivedCount = 0
        for (const entry of targets) {
          if (entry.id === keeper.id) continue
          store.archive(entry.id, true)
          claimed.add(entry.id)
          archivedCount += 1
        }
        result.archived += archivedCount
        result.merged += 1
        continue
      }
      if (decision.action === 'update') {
        if (ids.length !== 1) { skip(ids, 'update 只能针对 1 个 id'); continue }
        const entry = usable(ids[0])
        if (entry === undefined) { skip(ids, 'id 不存在、已归档或被钉选：' + ids[0]); continue }
        const patch: { content?: string; category?: MemoryDreamDecision['category']; tags?: string[]; importance?: number } = {}
        if (typeof decision.content === 'string' && decision.content.trim() !== '' && decision.content.trim() !== entry.content) patch.content = decision.content.trim()
        if (decision.category !== undefined && decision.category !== entry.category) patch.category = decision.category
        if (Array.isArray(decision.tags) && decision.tags.length > 0 && JSON.stringify(decision.tags) !== JSON.stringify(entry.tags)) patch.tags = decision.tags
        if (typeof decision.importance === 'number' && decision.importance !== entry.importance) patch.importance = decision.importance
        if (Object.keys(patch).length === 0) { skip(ids, 'update 未产生任何变化'); continue }
        store.update(entry.id, patch)
        claimed.add(entry.id)
        result.updated += 1
        continue
      }
      skip(ids, '不支持的 action：' + String(decision.action))
    } catch (error) {
      skip(ids, '应用失败：' + (error instanceof Error ? error.message : String(error)).slice(0, 120))
    }
  }
  return result
}

/** 做梦服务依赖（接线层注入；log 缺省静默）。 */
export interface MemoryDreamServiceDeps {
  native: NativeMemoryStore
  generate: DreamGenerateFn
  config: () => MemorySettings
  log?: (message: string) => void
  /** 审计读写走同一 RagStore 域（与 NativeMemoryStore 同库同连接）。 */
  listDomain: (domain: string) => Array<{ id: string; data: unknown }>
  putDomain: (domain: string, id: string, data: unknown) => void
  deleteDomain: (domain: string, id: string) => void
}

/** 记忆库做梦服务：定时 tick 三重门槛触发，单轮全流程裁决-应用-审计。 */
export class MemoryDreamService {
  private running = false
  private lastFinishedAt = 0
  private lastFingerprint = ''
  private timer: ReturnType<typeof setInterval> | undefined

  private readonly native: NativeMemoryStore
  private readonly generate: DreamGenerateFn
  private readonly config: () => MemorySettings
  private readonly log: (message: string) => void
  private readonly listDomain: (domain: string) => Array<{ id: string; data: unknown }>
  private readonly putDomain: (domain: string, id: string, data: unknown) => void
  private readonly deleteDomain: (domain: string, id: string) => void

  constructor(deps: MemoryDreamServiceDeps) {
    this.native = deps.native
    this.generate = deps.generate
    this.config = deps.config
    this.log = deps.log ?? (() => {})
    this.listDomain = deps.listDomain
    this.putDomain = deps.putDomain
    this.deleteDomain = deps.deleteDomain
  }

  /** 启动定时巡检（60s 一次，进程空闲不占事件循环：unref）。 */
  start(): void {
    if (this.timer !== undefined) return
    this.timer = setInterval(() => { this.tick() }, 60_000)
    this.timer.unref?.()
  }

  /** 停止巡检并等待在途运行自然结束（不硬中断：裁决中的模型调用让它跑完）。 */
  dispose(): void {
    if (this.timer !== undefined) { clearInterval(this.timer); this.timer = undefined }
  }

  /** 面板状态：开关、在途标记与最近运行记录。 */
  status(): { enabled: boolean; running: boolean; runs: MemoryDreamRun[] } {
    return { enabled: this.config().dreamEnabled, running: this.running, runs: this.recentRuns() }
  }

  /** 手动触发一次整理（面板按钮/接口）：只要求记忆层总开关，绕过静默与最小间隔门槛。 */
  async triggerNow(): Promise<{ started: boolean; message: string }> {
    if (!this.config().enabled) return { started: false, message: '记忆层总开关未开启' }
    if (this.running) return { started: false, message: '已有一次做梦正在执行，请稍后再试' }
    void this.run(true).catch(() => {})
    return { started: true, message: '做梦已开始，结果稍后可在运行记录中查看' }
  }

  /** 定时巡检：四重门槛（开关 / 库规模 / 指纹 / 静默与间隔）全过才真正开跑。 */
  private tick(): void {
    const settings = this.config()
    if (this.running) return
    const fingerprint = this.native.activityFingerprint()
    const gate = dreamGate({
      enabled: settings.enabled,
      dreamEnabled: settings.dreamEnabled,
      count: fingerprint.count,
      maxUpdatedAt: fingerprint.maxUpdatedAt,
      lastFinishedAt: this.lastFinishedAt,
      lastFingerprint: this.lastFingerprint,
      now: Date.now(),
      idleMinutes: settings.dreamIdleMinutes,
      minIntervalHours: settings.dreamMinIntervalHours,
    })
    if (!gate.allow) return
    void this.run(false).catch(() => {})
  }

  /** 执行一轮做梦：快照 → 裁决 → 应用 → 审计。任何失败都落为 failed 审计，绝不外抛。 */
  async run(manual: boolean): Promise<MemoryDreamRun> {
    const settings = this.config()
    const run: MemoryDreamRun = {
      id: 'dream-' + Date.now() + '-' + randomUUID().slice(0, 8),
      manual, startedAt: Date.now(), finishedAt: 0,
      status: 'failed', model: '', snapshot: 0, archived: 0, merged: 0, updated: 0, skipped: [],
    }
    this.running = true
    try {
      const snapshot = this.native.dreamSnapshot(settings.dreamMaxEntries)
      run.snapshot = snapshot.length
      if (snapshot.length < MIN_SNAPSHOT) {
        run.status = 'skipped'
        run.error = '活跃记忆不足 ' + MIN_SNAPSHOT + ' 条，无需整理'
        return run
      }
      const provider = settings.dreamProvider.trim()
      const model = settings.dreamModel.trim()
      run.model = provider !== '' && model !== '' ? provider + ':' + model : '会话默认模型'
      let raw: string
      try {
        raw = await this.generate({
          system: buildDreamSystemPrompt(),
          user: buildDreamUserPrompt(snapshot, settings.dreamMaxChars),
          maxTokens: settings.dreamMaxTokens,
          ...(provider !== '' ? { provider } : {}),
          ...(model !== '' ? { model } : {}),
        })
      } catch (error) {
        run.error = '裁决模型调用失败：' + (error instanceof Error ? error.message : String(error)).slice(0, 200)
        return run
      }
      let decisions: MemoryDreamDecision[]
      try {
        decisions = parseDreamDecisions(raw)
      } catch (firstError) {
        // 解析失败自动重试一次：附更严格的「只输出 JSON 数组」硬约束。
        // （真实踩坑：glm-5.3-flash 曾输出整段口语说明没有数组，一次失败就干等 6 小时下一轮。）
        const firstMessage = firstError instanceof Error ? firstError.message : String(firstError)
        try {
          const retryRaw = await this.generate({
            system: buildDreamSystemPrompt(),
            user: buildDreamUserPrompt(snapshot, settings.dreamMaxChars) + '\n\n补充硬性要求：上一次输出无法解析（' + firstMessage.slice(0, 120) + '）。请严格只输出 JSON 数组本身：第一个字符必须是 [，最后一个字符必须是 ]，不要输出任何解释、思考过程或代码块围栏。',
            maxTokens: settings.dreamMaxTokens,
            ...(provider !== '' ? { provider } : {}),
            ...(model !== '' ? { model } : {}),
          })
          decisions = parseDreamDecisions(retryRaw)
          run.retried = true
        } catch (retryError) {
          run.error = '重试后仍失败：' + (retryError instanceof Error ? retryError.message : String(retryError))
          return run
        }
      }
      const applied = applyDreamDecisions(this.native, decisions)
      run.archived = applied.archived
      run.merged = applied.merged
      run.updated = applied.updated
      run.skipped = applied.skipped
      run.status = applied.skipped.length > 0 ? 'degraded' : 'ok'
      return run
    } finally {
      run.finishedAt = Date.now()
      this.running = false
      // 仅「真正跑过模型」的运行才推进触发状态：skipped（条件不足）不打扰节流窗口。
      if (run.status !== 'skipped') {
        this.lastFinishedAt = run.finishedAt
        const after = this.native.activityFingerprint()
        this.lastFingerprint = after.count + ':' + after.maxUpdatedAt
        this.statsNote(run)
      }
      this.saveRun(run)
      this.log('dsh-devforge 记忆做梦：' + run.status + ' 快照 ' + run.snapshot + ' 条，归档 ' + run.archived + '，合并 ' + run.merged + ' 组，修订 ' + run.updated + '，跳过 ' + run.skipped.length)
    }
  }

  /** 累计统计（面板展示口径；失败也计次，便于发现「做梦一直失败」这类异常）。 */
  private statsNote(run: MemoryDreamRun): void {
    this.onRunFinished?.(run)
  }

  /** 运行完成回调（接线层注入统计存储；与核心逻辑解耦便于测试）。 */
  onRunFinished: ((run: MemoryDreamRun) => void) | undefined

  /** 读取最近运行记录（新到旧，最多 20 条）。 */
  private recentRuns(): MemoryDreamRun[] {
    const runs = this.listDomain(MEMORY_DREAM_RUN_DOMAIN)
      .map((row) => asRun(row.data, row.id))
      .filter((run): run is MemoryDreamRun => run !== undefined)
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, MAX_AUDIT_RUNS)
    return runs
  }

  /** 写入并裁剪审计：只保留最近 MAX_AUDIT_RUNS 条。 */
  private saveRun(run: MemoryDreamRun): void {
    try {
      this.putDomain(MEMORY_DREAM_RUN_DOMAIN, run.id, run)
      const all = this.listDomain(MEMORY_DREAM_RUN_DOMAIN)
        .map((row) => asRun(row.data, row.id))
        .filter((item): item is MemoryDreamRun => item !== undefined)
        .sort((a, b) => b.startedAt - a.startedAt)
      for (const stale of all.slice(MAX_AUDIT_RUNS)) this.deleteDomain(MEMORY_DREAM_RUN_DOMAIN, stale.id)
    } catch (error) {
      this.log('dsh-devforge 记忆做梦审计写入失败：' + (error instanceof Error ? error.message : String(error)))
    }
  }
}

/** 触发门槛判定（导出供单测）：四重门槛全过才放行；fingerprint 供放行后记录口径复用。 */
export function dreamGate(input: { enabled: boolean; dreamEnabled: boolean; count: number; maxUpdatedAt: number; lastFinishedAt: number; lastFingerprint: string; now: number; idleMinutes: number; minIntervalHours: number }): { allow: boolean; reason: string; fingerprint: string } {
  const fingerprint = input.count + ':' + input.maxUpdatedAt
  if (!input.enabled || !input.dreamEnabled) return { allow: false, reason: '做梦未开启', fingerprint }
  if (input.count < MIN_SNAPSHOT) return { allow: false, reason: '活跃记忆不足 ' + MIN_SNAPSHOT + ' 条', fingerprint }
  // 库指纹未变：上次做梦后没有任何写入，整理结果不会不同，省一次模型调用。
  if (input.lastFingerprint !== '' && fingerprint === input.lastFingerprint) return { allow: false, reason: '库无变化', fingerprint }
  // 静默窗口：写入/上次做梦之后至少安静 idleMinutes，避免与进行中的工作互相打断。
  const activityAt = Math.max(input.maxUpdatedAt, input.lastFinishedAt)
  if (input.now - activityAt < input.idleMinutes * 60_000) return { allow: false, reason: '静默窗口未到', fingerprint }
  // 最小间隔：自动做梦的频率上限（首次运行不设限，lastFinishedAt=0 表示从未跑过）。
  if (input.lastFinishedAt > 0 && input.now - input.lastFinishedAt < input.minIntervalHours * 3_600_000) return { allow: false, reason: '最小间隔未到', fingerprint }
  return { allow: true, reason: '', fingerprint }
}

/** 审计记录防御式解析（旧数据/脏数据不让面板与状态接口崩掉）。 */
function asRun(data: unknown, id: string): MemoryDreamRun | undefined {
  if (data === null || typeof data !== 'object') return undefined
  const value = data as Partial<MemoryDreamRun>
  if (typeof value.startedAt !== 'number' || typeof value.status !== 'string') return undefined
  const status = value.status as MemoryDreamRun['status']
  if (!['ok', 'degraded', 'failed', 'skipped'].includes(status)) return undefined
  return {
    id,
    manual: value.manual === true,
    startedAt: value.startedAt,
    finishedAt: typeof value.finishedAt === 'number' ? value.finishedAt : value.startedAt,
    status,
    model: typeof value.model === 'string' ? value.model : '',
    ...(value.retried === true ? { retried: true } : {}),
    snapshot: typeof value.snapshot === 'number' ? value.snapshot : 0,
    archived: typeof value.archived === 'number' ? value.archived : 0,
    merged: typeof value.merged === 'number' ? value.merged : 0,
    updated: typeof value.updated === 'number' ? value.updated : 0,
    skipped: Array.isArray(value.skipped)
      ? value.skipped.slice(0, MAX_SKIPPED_RECORDS).map((item) => ({ ids: Array.isArray(item?.ids) ? item.ids : [], reason: typeof item?.reason === 'string' ? item.reason : '' }))
      : [],
    ...(typeof value.error === 'string' && value.error !== '' ? { error: value.error } : {}),
  }
}
