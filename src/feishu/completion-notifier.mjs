// Vendored from dsh-feishu 0.2.2 (MIT, andyfan1094/dsh-feishu).
// dsh-devforge consolidation modification: 模块折叠至 dsh-devforge；任务完成飞书卡片通知能力。
import { buildCompletionCard, sendCard } from './outbound.mjs'

const MAX_TRACKED_SESSIONS = 200

/**
 * 订阅 Host session/event，整个任务收敛时只发一张汇总卡片（而非每轮一张）。
 *
 * 收敛判定：
 * - goal 任务：goal/change phase=active 期间全程静默；phase 变为
 *   complete/blocked/paused 后等待当前 turn/end，再发送包含最终模型回复的卡片。
 * - 普通会话：turn/end 后静默 settleMs 仍未开启新轮次才发卡（连续多轮合并为一张）。
 * - error/aborted/interrupted/blocked 轮次是终态，在 turn/end 立即发卡。
 *
 * 卡片聚合整个任务：正文包含用户请求和最后一条非空 assistant/message，
 * 轮次与耗时仅作辅助信息；reason 原样交给 buildCompletionCard 归一化。
 * 所有错误吞掉并 warn，永不向上抛（不能影响 agent loop）。
 */
export function createCompletionNotifier({ getConfig, getClient, getSessionTitle, sendCard: sendCardFn = sendCard, settleMs = 8_000, warn = () => {} } = {}) {
  const sessions = new Map()     // sessionId -> 最近一次事件携带的 session 对象（供标题查询）
  const tasks = new Map()             // sessionId -> { startedAt, turns, lastReason }
  const goalActive = new Set()        // sessionId -> goal 处于 active，期间静默
  const goalTerminal = new Map()      // sessionId -> goal 终态，等待当前 turn/end
  const settleTimers = new Map()      // sessionId -> timer
  const lastUserText = new Map()      // sessionId -> 当前任务用户请求
  const lastAssistantText = new Map() // sessionId -> 当前任务最后一条非空模型回复
  const modelBySession = new Map()     // sessionId -> 最近一次真实请求路由的模型 ID

  function rememberSession(sessionId, session) {
    if (session !== undefined && session !== null) {
      if (sessions.size >= MAX_TRACKED_SESSIONS && !sessions.has(sessionId)) {
        const oldest = sessions.keys().next().value
        if (oldest !== undefined) sessions.delete(oldest)
      }
      sessions.set(sessionId, session)
    }
  }

  function observe(session, event) {
    const sessionId = String(session?.id ?? '').trim()
    if (sessionId === '') return
    rememberSession(sessionId, session)
    const type = String(event?.type ?? '')
    if (type === 'user/message') {
      const pending = goalTerminal.get(sessionId)
      if (pending !== undefined) sendNow(sessionId, pending)
      trackUserText(sessionId, event?.data)
      lastAssistantText.delete(sessionId)
      return
    }
    if (type === 'assistant/message') {
      trackAssistantText(sessionId, event?.data?.message)
      return
    }
    if (type === 'request/header') {
      trackModel(sessionId, event?.data?.header?.config)
      return
    }
    if (type === 'request/context') {
      trackModel(sessionId, event?.data)
      return
    }
    if (type === 'goal/change') {
      handleGoalChange(sessionId, event?.data)
      return
    }
    const turn = Number(event?.data?.turn ?? 0)
    if (type === 'turn/start') {
      if (turn <= 0) return
      clearSettleTimer(sessionId)
      let task = tasks.get(sessionId)
      if (task === undefined) {
        task = { startedAt: Date.now(), turns: 0, openTurn: 0, lastReason: null }
        lastAssistantText.delete(sessionId)
        if (tasks.size >= MAX_TRACKED_SESSIONS && !tasks.has(sessionId)) {
          const oldest = tasks.keys().next().value
          if (oldest !== undefined) clearTaskState(oldest, { clearModel: true })
        }
        tasks.set(sessionId, task)
      }
      task.turns += 1
      task.openTurn = turn
      return
    }
    if (type !== 'turn/end') return
    if (turn <= 0) return
    const task = tasks.get(sessionId)
    if (task === undefined) return
    task.lastReason = event?.data?.reason ?? null
    task.openTurn = 0
    const terminal = goalTerminal.get(sessionId)
    if (terminal !== undefined && terminal.turn === turn) {
      goalTerminal.delete(sessionId)
      sendNow(sessionId, terminal)
      return
    }
    if (terminal !== undefined) goalTerminal.delete(sessionId)
    const kind = reasonKindOf(task.lastReason)
    if (kind === 'error' || kind === 'aborted' || kind === 'interrupted' || kind === 'blocked') {
      goalActive.delete(sessionId)
      sendNow(sessionId, {})
      return
    }
    if (goalActive.has(sessionId)) return
    scheduleSettle(sessionId)
  }

  function handleGoalChange(sessionId, data) {
    if (String(data?.operation ?? '') === 'clear') {
      goalActive.delete(sessionId)
      goalTerminal.delete(sessionId)
      return
    }
    const phase = String(data?.goal?.phase ?? '')
    if (phase === 'active') {
      goalActive.add(sessionId)
      goalTerminal.delete(sessionId)
      clearSettleTimer(sessionId)
      return
    }
    goalActive.delete(sessionId)
    if (phase === 'complete' || phase === 'blocked' || phase === 'paused') {
      const task = tasks.get(sessionId)
      if (task === undefined) return
      const goalRounds = Number(data?.goal?.roundsStarted ?? 0)
      const terminal = {
        reason: phase === 'complete' ? { kind: 'completed' } : phase === 'blocked' ? { kind: 'blocked' } : { kind: 'paused' },
        fallbackTurns: Number.isFinite(goalRounds) && goalRounds > 0 ? goalRounds : 0,
        turn: task.openTurn,
      }
      if (task.openTurn > 0) goalTerminal.set(sessionId, terminal)
      else sendNow(sessionId, terminal)
    }
  }

  function reasonKindOf(reason) {
    if (reason === null || reason === undefined) return ''
    if (typeof reason === 'object') return String(reason.kind ?? '')
    return String(reason)
  }

  function trackUserText(sessionId, data) {
    const text = userTextOf(data)
    if (text === '') return
    if (lastUserText.size >= MAX_TRACKED_SESSIONS && !lastUserText.has(sessionId)) {
      const oldest = lastUserText.keys().next().value
      if (oldest !== undefined) lastUserText.delete(oldest)
    }
    lastUserText.set(sessionId, text)
  }

  function trackAssistantText(sessionId, message) {
    const text = assistantTextOf(message)
    if (text === '') return
    if (lastAssistantText.size >= MAX_TRACKED_SESSIONS && !lastAssistantText.has(sessionId)) {
      const oldest = lastAssistantText.keys().next().value
      if (oldest !== undefined) lastAssistantText.delete(oldest)
    }
    lastAssistantText.set(sessionId, text)
  }

  function trackModel(sessionId, config) {
    const model = String(config?.model ?? '').trim()
    if (model === '') return
    if (modelBySession.size >= MAX_TRACKED_SESSIONS && !modelBySession.has(sessionId)) {
      const oldest = modelBySession.keys().next().value
      if (oldest !== undefined) modelBySession.delete(oldest)
    }
    modelBySession.delete(sessionId)
    modelBySession.set(sessionId, model)
  }

  function clearSettleTimer(sessionId) {
    const timer = settleTimers.get(sessionId)
    if (timer !== undefined) { clearTimeout(timer); settleTimers.delete(sessionId) }
  }

  function scheduleSettle(sessionId) {
    if (settleTimers.has(sessionId)) return
    const timer = setTimeout(() => {
      settleTimers.delete(sessionId)
      sendNow(sessionId, {})
    }, settleMs)
    settleTimers.set(sessionId, timer)
  }

  function clearTaskState(sessionId, { clearModel = false } = {}) {
    clearSettleTimer(sessionId)
    tasks.delete(sessionId)
    goalActive.delete(sessionId)
    goalTerminal.delete(sessionId)
    lastAssistantText.delete(sessionId)
    lastUserText.delete(sessionId)
    sessions.delete(sessionId)
    if (clearModel) modelBySession.delete(sessionId)
  }

  function sendNow(sessionId, { reason = null, fallbackTurns = 0 } = {}) {
    try {
      clearSettleTimer(sessionId)
      const config = typeof getConfig === 'function' ? getConfig() : null
      if (config === null || config.notifyOnComplete !== true) { clearTaskState(sessionId, { clearModel: true }); return }
      const chatId = String(config.notifyChatId ?? '').trim()
      if (chatId === '') { clearTaskState(sessionId, { clearModel: true }); return }
      const client = typeof getClient === 'function' ? getClient() : null
      if (client === null) { clearTaskState(sessionId, { clearModel: true }); return }
      const task = tasks.get(sessionId)
      const finalReason = reason ?? task?.lastReason ?? null
      const turns = Math.max(task?.turns ?? 0, fallbackTurns)
      if (turns <= 0 && finalReason === null) { clearTaskState(sessionId, { clearModel: true }); return }
      const session = sessions.get(sessionId) ?? { id: sessionId }
      const subject = extractSubject(session, getSessionTitle) || lastUserText.get(sessionId) || ''
      const request = lastUserText.get(sessionId) || subject
      const response = lastAssistantText.get(sessionId) || latestAssistantTextOf(session)
      const card = buildCompletionCard({
        subject,
        request,
        response,
        model: modelBySession.get(sessionId) || '',
        turn: turns,
        durationMs: task === undefined ? 0 : Math.max(0, Date.now() - task.startedAt),
        reason: finalReason,
      })
      clearTaskState(sessionId)
      void sendCardFn(client, chatId, card).catch((error) => {
        warn('feishu completion notify failed: ' + (error instanceof Error ? error.message : String(error)))
      })
    } catch (error) {
      clearTaskState(sessionId, { clearModel: true })
      warn('feishu completion notify crashed: ' + (error instanceof Error ? error.message : String(error)))
    }
  }

  function observeAgentDisposed(sessionOrId) {
    const sessionId = String(typeof sessionOrId === 'string' ? sessionOrId : sessionOrId?.id ?? '').trim()
    if (sessionId === '' || tasks.get(sessionId) === undefined) return false
    if (sessionOrId !== null && typeof sessionOrId === 'object') rememberSession(sessionId, sessionOrId)
    const terminal = goalTerminal.get(sessionId)
    const task = tasks.get(sessionId)
    const fallbackReason = goalActive.has(sessionId) ? { kind: 'interrupted' } : task?.lastReason ?? { kind: 'interrupted' }
    goalActive.delete(sessionId)
    sendNow(sessionId, terminal ?? { reason: fallbackReason })
    modelBySession.delete(sessionId)
    return true
  }

  return { observe, observeAgentDisposed }
}

function extractSubject(session, getSessionTitle) {
  if (typeof getSessionTitle === 'function') {
    try {
      const explicit = String(getSessionTitle(session) ?? '').trim()
      if (explicit !== '') return explicit.slice(0, 200)
    } catch {}
  }
  const fallbackTitle = String(session?.title ?? '').trim()
  if (fallbackTitle !== '') return fallbackTitle.slice(0, 200)
  // 退而求其次：从会话事件流里找第一条 user 文本。
  const events = Array.isArray(session?.events) ? session.events : []
  for (const entry of events) {
    const text = userTextOf(entry?.data)
    if (text !== '') return text
  }
  return ''
}

function latestAssistantTextOf(session) {
  const events = Array.isArray(session?.events) ? session.events : []
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const entry = events[index]
    if (entry?.type !== 'assistant/message') continue
    const text = assistantTextOf(entry?.data?.message)
    if (text !== '') return text
  }
  return ''
}

function assistantTextOf(message) {
  const blocks = message?.content
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

function userTextOf(data) {
  const message = data?.message ?? data
  const blocks = message?.content
  if (Array.isArray(blocks)) {
    const text = blocks
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text !== '') return text.slice(0, 2_000)
  }
  return String(message?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 2_000)
}
