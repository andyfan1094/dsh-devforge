/**
 * 失败自动续跑（auto-continue）—— 运行时服务。
 *
 * 触发链：宿主把每轮结束投递为 `session/event` 的 `turn/end`，其 `data.reason.kind`
 * 取值 `completed / aborted / blocked / error / max-tokens / interrupted / forked`
 * （见 @deepseek-ai/dsh-agent 的 TurnEndReasonMap）。GUI 上那句「本轮运行失败」
 * 对应 `kind === 'error'`（带 LlmFailure）。本服务只认这一种。
 *
 * 补发通道：`Agent.followup(message)` —— 投一条普通用户消息并自动唤醒新一轮，
 * 与飞书桥续跑用的是同一契约；消息的 `source.kind` 必须是生产者自有的 kind
 * （会话格式 v4），这里用插件本体 `dsh-devforge` + `form: 'notice'`，
 * 显示上归因于插件而不是冒充用户输入。
 *
 * 三道护栏（防止把失败放大成账单事故）：
 * 1. 只对 `error` 生效：用户主动停止（aborted，cause=user）、系统中断、
 *    超长截断、被拦截都不自动续跑；
 * 2. 同一会话**连续失败**最多补 maxAttempts 次（默认 1），成功轮次清零；
 * 3. 只作用本机 GUI 会话：飞书独立会话（`session-feishu-*`）与子代理
 *    （header.origin === 'subagent' / delegationDepth > 0）一律跳过。
 */

import { randomUUID } from 'node:crypto'
import type { AutoContinueSettings, AutoContinueStats } from './protocol.ts'
import { DEVFORGE_SOURCE_KIND } from '../session-source.ts'

export type { AutoContinueStats }

/** 服务需要的最小 Agent 契约（只用到 followup 与会话头，便于测试替身）。 */
export interface AutoContinueAgent {
  followup(message: unknown): void
  readonly session?: {
    readonly id?: unknown
    readonly header?: {
      readonly id?: unknown
      readonly origin?: unknown
      readonly delegationDepth?: unknown
    }
  }
}

/** 服务依赖：设置读取、agent 解析、可注入的调度器（测试用）。 */
export interface AutoContinueDeps {
  /** 每次事件动态读取设置（面板改完即时生效，无需重启）。 */
  readSettings(): AutoContinueSettings
  /** 按会话号取 live agent；取不到（未 resume / 已释放）时返回 undefined。 */
  resolveAgent(sessionId: string): AutoContinueAgent | undefined
  /** 诊断日志（可选）。 */
  log?(message: string): void
  /** 延迟调度（可选；测试注入立即执行版本）。返回取消函数。 */
  schedule?(run: () => void, delayMs: number): () => void
}

/** 一个会话的连续失败计数。 */
interface SessionFailureState {
  /** 连续失败轮数（成功轮次清零）。 */
  count: number
  /** 最后一次处理的轮次号，用于同一轮重复事件去重。 */
  lastTurn: number
}

/** 默认调度器：setTimeout + unref，不拖住宿主退出。 */
function defaultSchedule(run: () => void, delayMs: number): () => void {
  const timer = setTimeout(run, delayMs)
  ;(timer as { unref?: () => void }).unref?.()
  return () => { clearTimeout(timer) }
}

/** 取 turn/end 的原因 kind；非 turn/end 事件返回空串。 */
export function reasonKindOf(event: unknown): string {
  if (event === null || typeof event !== 'object') return ''
  const record = event as { type?: unknown; data?: { reason?: { kind?: unknown } } }
  if (record.type !== 'turn/end') return ''
  return typeof record.data?.reason?.kind === 'string' ? record.data.reason.kind : ''
}

/** 本轮是失败（模型报错）吗。 */
export function isErrorTurnEnd(event: unknown): boolean {
  return reasonKindOf(event) === 'error'
}

/** 本轮正常完成吗（用于清零连续失败计数）。 */
export function isCompletedTurnEnd(event: unknown): boolean {
  return reasonKindOf(event) === 'completed'
}

/**
 * 是否本机 GUI 会话：飞书桥的独立会话号固定以 `session-feishu-` 开头
 * （见 src/feishu/index.mjs 的 legacySessionIdOf / stableSessionIdOf），
 * 其它形态视为 GUI / 子代理，子代理再按会话头二次排除。
 */
export function isGuiConversation(sessionId: string): boolean {
  return sessionId !== '' && !sessionId.startsWith('session-feishu-')
}

/** 是否子代理会话（不该由本功能接管续跑）。 */
export function isSubagentAgent(agent: AutoContinueAgent | undefined): boolean {
  const header = agent?.session?.header
  if (header === undefined || header === null) return false
  if (header.origin === 'subagent') return true
  const depth = Number(header.delegationDepth ?? 0)
  return Number.isFinite(depth) && depth > 0
}

/** 构造补发用的用户消息（会话格式 v4：source.kind 必须生产者自有）。 */
export function buildContinueMessage(text: string): {
  id: string
  role: 'user'
  content: Array<{ type: 'text'; text: string }>
  source: { kind: typeof DEVFORGE_SOURCE_KIND; form: 'notice'; summary: string }
} {
  const value = String(text ?? '').trim() || '继续'
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: value }],
    source: { kind: DEVFORGE_SOURCE_KIND, form: 'notice', summary: value.slice(0, 120) },
  }
}

/** 自动续跑服务。 */
export class AutoContinueService {
  readonly #deps: AutoContinueDeps
  readonly #failures = new Map<string, SessionFailureState>()
  readonly #timers = new Set<() => void>()
  #disposed = false
  readonly stats: AutoContinueStats = {
    attemptCount: 0,
    skipCount: 0,
    lastAt: 0,
    lastSessionId: '',
    lastText: '',
    lastSkipReason: '',
    lastError: '',
  }

  constructor(deps: AutoContinueDeps) {
    this.#deps = deps
  }

  /** 挂到宿主事件流：只订阅 session/event，异常全吞（不能影响宿主）。 */
  attach(holder: unknown): () => void {
    const target = holder as { on?: (event: string, listener: (...args: never[]) => unknown) => unknown }
    const off = target.on?.('session/event', ((session: unknown, event: unknown) => {
      try { this.handle(session, event) } catch { /* 事件处理失败绝不影响宿主 */ }
    }) as (...args: never[]) => unknown)
    return typeof off === 'function' ? (off as () => void) : (() => {})
  }

  /** 处理一条会话事件（公开以便单测直接驱动）。 */
  handle(session: unknown, event: unknown): void {
    if (this.#disposed) return
    const sessionId = typeof (session as { id?: unknown } | null)?.id === 'string'
      ? (session as { id: string }).id
      : ''
    if (sessionId === '') return
    const kind = reasonKindOf(event)
    if (kind === '') return
    // 正常完成即清零：下次再失败又是「新的一次」。
    if (kind === 'completed') {
      this.#failures.delete(sessionId)
      return
    }
    // 护栏一：只认模型报错，用户主动停止/中断/超长/拦截一律放过。
    if (kind !== 'error') return

    const settings = this.#deps.readSettings()
    if (!settings.enabled) { this.#skip('自动续跑已关闭'); return }
    if (settings.maxAttempts <= 0) { this.#skip('连续补发上限为 0'); return }
    // 护栏三：只作用本机 GUI 会话。
    if (!isGuiConversation(sessionId)) { this.#skip('飞书独立会话不自动续跑'); return }
    const agent = this.#deps.resolveAgent(sessionId)
    if (agent === undefined) { this.#skip('会话没有活跃 Agent（未 resume 或已释放）'); return }
    if (isSubagentAgent(agent)) { this.#skip('子代理会话不自动续跑'); return }

    const turn = typeof (event as { data?: { turn?: unknown } }).data?.turn === 'number'
      ? (event as { data: { turn: number } }).data.turn
      : 0
    const state = this.#failures.get(sessionId)
    // 同一轮可能投递多次 turn/end（含恢复补记），只处理第一次。
    if (state !== undefined && turn !== 0 && state.lastTurn === turn) return
    const count = state?.count ?? 0
    // 护栏二：连续失败上限。
    if (count >= settings.maxAttempts) {
      this.#skip('同一会话连续失败已达上限（' + String(count) + '/' + String(settings.maxAttempts) + '）')
      return
    }
    this.#failures.set(sessionId, { count: count + 1, lastTurn: turn })
    this.#scheduleContinue(sessionId, settings.delayMs)
  }

  /** 清空某会话（或全部）的连续失败计数。 */
  reset(sessionId?: string): void {
    if (sessionId === undefined) this.#failures.clear()
    else this.#failures.delete(sessionId)
  }

  /** 卸载：取消所有等待中的补发（避免拖住 Host 退出或卸载后再补一条）。 */
  dispose(): void {
    this.#disposed = true
    for (const cancel of this.#timers) {
      try { cancel() } catch { /* 取消失败不影响卸载 */ }
    }
    this.#timers.clear()
    this.#failures.clear()
  }

  /** 延迟补发：等待期间设置可能被改、agent 可能被释放，执行前全部复核。 */
  #scheduleContinue(sessionId: string, delayMs: number): void {
    let executed = false
    const run = (): void => {
      executed = true
      if (this.#disposed) return
      const settings = this.#deps.readSettings()
      if (!settings.enabled) { this.#skip('等待期间自动续跑被关闭'); return }
      const agent = this.#deps.resolveAgent(sessionId)
      if (agent === undefined) { this.#skip('等待期间会话 Agent 已释放'); return }
      try {
        agent.followup(buildContinueMessage(settings.text))
        this.stats.attemptCount += 1
        this.stats.lastAt = Date.now()
        this.stats.lastSessionId = sessionId
        this.stats.lastText = settings.text
        this.stats.lastError = ''
        this.#deps.log?.('[dsh-devforge] 自动续跑：会话 ' + sessionId + ' 本轮失败，已补发「' + settings.text + '」')
      } catch (error) {
        this.stats.lastError = error instanceof Error ? error.message : String(error)
      }
    }
    const schedule = this.#deps.schedule ?? defaultSchedule
    const cancel = schedule(run, delayMs)
    // 同步执行的调度器（测试）已经跑完，不必再登记取消函数。
    if (!executed) this.#timers.add(cancel)
  }

  #skip(reason: string): void {
    this.stats.skipCount += 1
    this.stats.lastSkipReason = reason
  }
}
