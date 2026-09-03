/**
 * 会话记忆自动沉淀 —— turn/end 驱动的记忆提炼入库。
 *
 * - 订阅宿主 session/event（turn/end），每会话去抖（60s 无新轮次才提炼），
 *   取最近一轮「用户问题 + 助手答复」窗口（限长），走默认模型路由提炼候选记忆；
 * - 与库内已有记忆做哈希 + 包含式去重，命中即跳过（防重复入库）；
 * - 入库到「会话记忆库」（source=memory 知识库），随 RAG 全文检索被注入层召回。
 * 红线：不落任何凭据；提炼失败只计数，绝不影响会话本身。
 */
import { createHash } from 'node:crypto'
import type { RagService } from '../rag/service.ts'
import type { MemorySettings } from './protocol.ts'
import type { NativeMemoryStore } from './native.ts'

/** 记忆提炼用的文本生成适配器（接线层用 ctx.llm.stream 实现；测试注入 fake）。 */
export type MemoryGenerateFn = (system: string, user: string) => Promise<string>

/** 提炼候选（模型 JSON 输出）。 */
interface MemoryCandidate {
  content: string
  importance: 'critical' | 'normal' | 'low'
}

/** 从会话事件里提取最近一轮的用户/助手文本窗口（导出供单测）。 */
export function extractLastTurnWindow(events: readonly unknown[], maxChars = 9000): { userText: string; assistantText: string } {
  let lastEnd = -1
  for (let i = events.length - 1; i >= 0; i--) {
    if ((events[i] as { type?: unknown })?.type === 'turn/end') { lastEnd = i; break }
  }
  if (lastEnd < 0) return { userText: '', assistantText: '' }
  let start = 0
  for (let i = lastEnd - 1; i >= 0; i--) {
    if ((events[i] as { type?: unknown })?.type === 'turn/end') { start = i + 1; break }
  }
  const userParts: string[] = []
  const assistantParts: string[] = []
  for (const raw of events.slice(start, lastEnd)) {
    const event = raw as { type?: unknown; data?: unknown }
    const data = event.data as { content?: unknown; message?: unknown } | undefined
    const content = Array.isArray(data?.content) ? data?.content : Array.isArray((data?.message as { content?: unknown })?.content) ? (data?.message as { content: unknown[] }).content : undefined
    if (!Array.isArray(content)) continue
    const text = content.map((block) => {
      const b = block as { type?: unknown; text?: unknown }
      return b?.type === 'text' && typeof b.text === 'string' ? b.text : ''
    }).join('')
    if (text.trim() === '') continue
    if (event.type === 'user/message') userParts.push(text)
    else if (event.type === 'assistant/message') assistantParts.push(text)
  }
  return { userText: userParts.join('\n').slice(-maxChars), assistantText: assistantParts.join('\n').slice(0, maxChars) }
}

/** 记忆规范化（去重键）：压空白去首尾。 */
export function normalizeMemoryText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

/** 会话记忆沉淀服务。 */
export class MemorySedimentService {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly processedTurns = new Map<string, number>()
  private existingKeys: Set<string> | undefined
  sedimentCount = 0
  lastSedimentAt = 0
  private readonly disposers: Array<() => void> = []

  private readonly rag: RagService
  private readonly getKbId: () => string
  private readonly generate: MemoryGenerateFn
  private readonly config: () => MemorySettings
  private readonly native?: NativeMemoryStore

  constructor(rag: RagService, getKbId: () => string, generate: MemoryGenerateFn, config: () => MemorySettings, native?: NativeMemoryStore) {
    this.rag = rag
    this.getKbId = getKbId
    this.generate = generate
    this.config = config
    this.native = native
  }

  /** 挂到宿主上下文（防御式解析 on）；dispose 解除全部监听与待处理定时器。 */
  attach(ctx: unknown): void {
    try {
      const holder = ctx as { on?: (event: string, listener: (...args: never[]) => unknown) => unknown }
      const off = holder.on?.('session/event', (session: unknown, event: { type?: unknown }) => {
        if (event?.type !== 'turn/end') return
        this.schedule(session)
      })
      if (typeof off === 'function') this.disposers.push(off as () => void)
    } catch { /* 事件不可用时静默降级为不沉淀 */ }
  }

  dispose(): void {
    for (const dispose of this.disposers) { try { dispose() } catch { /* 忽略 */ } }
    this.disposers.length = 0
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }

  /** 每会话去抖：60s 内多轮只提炼一次。 */
  private schedule(session: unknown): void {
    const settings = this.config()
    if (!settings.enabled || !settings.autoSediment) return
    const id = this.sessionIdOf(session)
    if (id === undefined) return
    const turn = this.turnOf(session)
    const previous = this.timers.get(id)
    if (previous !== undefined) clearTimeout(previous)
    const timer = setTimeout(() => {
      this.timers.delete(id)
      void this.process(session, id, turn).catch(() => { /* 单会话失败不影响其他会话 */ })
    }, 60_000)
    timer.unref?.()
    this.timers.set(id, timer)
  }

  private sessionIdOf(session: unknown): string | undefined {
    const record = session as { id?: unknown } | null
    return record !== null && typeof record === 'object' && typeof record.id === 'string' ? record.id : undefined
  }

  private turnOf(session: unknown): number {
    const events = (session as { events?: unknown })?.events
    if (!Array.isArray(events)) return 0
    const last = events[events.length - 1] as { data?: { turn?: unknown } }
    return typeof last?.data?.turn === 'number' ? last.data.turn : 0
  }

  /** 处理一次提炼（可被面板手动触发）。 */
  async process(session: unknown, sessionId: string, turn: number): Promise<number> {
    const settings = this.config()
    if (!settings.enabled || !settings.autoSediment) return 0
    if (turn > 0 && this.processedTurns.get(sessionId) === turn) return 0
    const events = (session as { events?: unknown })?.events
    if (!Array.isArray(events)) return 0
    const window = extractLastTurnWindow(events)
    if (window.userText.trim() === '' || window.assistantText.trim().length < 50) return 0
    const system = '你是记忆管理员。从对话里提炼值得长期保存的记忆条目（用户偏好、项目决策、环境事实、踩坑教训）。跳过：寒暄、一次性任务进度、问题本身、原始代码、密钥。最多 5 条，每条一句独立中文陈述。只输出 JSON，不输出解释。'
    const user = '对话窗口：\n【用户】' + window.userText + '\n【助手】' + window.assistantText + '\n\n返回 JSON：{"items":[{"content":"...","importance":"critical|normal|low"}]}'
    let raw: string
    try { raw = await this.generate(system, user) } catch { return 0 }
    let candidates: MemoryCandidate[] = []
    try {
      const start = raw.indexOf('{')
      const end = raw.lastIndexOf('}')
      const parsed = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : '{}') as { items?: MemoryCandidate[] }
      candidates = (parsed.items ?? []).filter((item) => typeof item.content === 'string' && normalizeMemoryText(item.content).length >= 6)
    } catch { return 0 }
    if (candidates.length === 0) return 0
    const keys = this.existingKeysOf()
    const kbId = this.getKbId()
    let stored = 0
    for (const candidate of candidates.slice(0, 5)) {
      const content = normalizeMemoryText(candidate.content)
      const key = createHash('sha256').update(content).digest('hex')
      if (keys.has(key)) continue
      let duplicated = false
      for (const existing of keys) {
        if (existing.includes(content) || content.includes(existing)) { duplicated = true; break }
      }
      if (duplicated) continue
      const importance = candidate.importance === 'critical' || candidate.importance === 'low' ? candidate.importance : 'normal'
      const fileName = 'mem-' + Date.now() + '-' + stored + '.md'
      const text = '重要性: ' + importance + '\n来源会话: ' + sessionId + '\n沉淀时间: ' + new Date().toISOString() + '\n\n' + content
      try {
        // 内置 memory.entry 是长期记忆主存储，RAG 文档保留为语义检索索引。
        this.native?.migrate([{ content, category: 'general', source: 'session', sourceId: sessionId, importance: importance === 'critical' ? 5 : importance === 'low' ? 2 : 3, migrationKey: 'session:' + sessionId + ':' + turn + ':' + key }])
        await this.rag.ingestText(kbId, fileName, text, { source: 'memory' })
        keys.add(key)
        this.existingKeys = undefined // 下次重建
        stored += 1
      } catch { /* 单条失败继续 */ }
    }
    this.processedTurns.set(sessionId, turn)
    if (stored > 0) { this.sedimentCount += stored; this.lastSedimentAt = Date.now() }
    return stored
  }

  /** 已有记忆的规范化文本键集合（懒加载；小库直接扫切块文本）。 */
  private existingKeysOf(): Set<string> {
    if (this.existingKeys !== undefined) return this.existingKeys
    const keys = new Set<string>()
    for (const doc of this.rag.listDocs(this.getKbId())) {
      for (const chunk of this.rag.listChunks(doc.id)) {
        keys.add(normalizeMemoryText(chunk.text))
      }
    }
    this.existingKeys = keys
    return keys
  }
}
