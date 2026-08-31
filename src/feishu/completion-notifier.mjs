// Vendored from dsh-feishu 0.2.2 (MIT, andyfan1094/dsh-feishu).
// dsh-devforge consolidation modification: 模块折叠至 dsh-devforge；任务完成飞书卡片通知能力。
import { buildCompletionCard, sendCard } from './outbound.mjs'

const MAX_TRACKED_SESSIONS = 200

/**
 * 订阅 Host session/event，整个任务收敛时只发一张汇总卡片（而非每轮一张）。
 *
 * 收敛判定：
 * - goal 任务：goal/change phase=active 期间全程静默；phase 变为
 *   complete/blocked/paused 的收敛点立即发卡——这是「整个任务完成」的精确信号。
 * - 普通会话：turn/end 后静默 settleMs 仍未开启新轮次才发卡（连续多轮合并为一张）。
 * - error/aborted/interrupted/blocked 轮次是终态，立即发卡。
 *
 * 卡片聚合整个任务：轮次=共 N 轮；耗时=本任务首个 turn/start 起的墙钟时间。
 * 主题优先取会话标题，其次跟踪最近一条用户消息；reason 是 Host 的结构化
 * TurnEndReason，原样交给 buildCompletionCard 归一化（绝不 String() 拼接）。
 * 所有错误吞掉并 warn，永不向上抛（不能影响 agent loop）。
 */
export function createCompletionNotifier({ getConfig, getClient, getSessionTitle, sendCard: sendCardFn = sendCard, settleMs = 8_000, warn = () => {} } = {}) {
  const sessions = new Map()     // sessionId -> 最近一次事件携带的 session 对象（供标题查询）
  const tasks = new Map()        // sessionId -> { startedAt, turns, lastReason }
  const goalActive = new Set()   // sessionId —— goal 处于 active，期间静默
  const settleTimers = new Map() // sessionId -> timer
  const lastUserText = new Map() // sessionId -> 最近一条用户消息文本（主题兜底）

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
      trackUserText(sessionId, event?.data)
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
        task = { startedAt: Date.now(), turns: 0, lastReason: null }
        if (tasks.size >= MAX_TRACKED_SESSIONS && !tasks.has(sessionId)) {
          const oldest = tasks.keys().next().value
          if (oldest !== undefined) { tasks.delete(oldest); clearSettleTimer(oldest) }
        }
        tasks.set(sessionId, task)
      }
      task.turns += 1
      return
    }
    if (type !== 'turn/end') return
    if (turn <= 0) return
    const task = tasks.get(sessionId)
    if (task === undefined) return
    task.lastReason = event?.data?.reason ?? null
    if (goalActive.has(sessionId)) return // goal 驱动的多轮任务：由 goal/change 收敛点发卡
    const kind = reasonKindOf(task.lastReason)
    if (kind === 'error' || kind === 'aborted' || kind === 'interrupted' || kind === 'blocked') {
      sendNow(sessionId, {})
      return
    }
    scheduleSettle(sessionId)
  }

  function handleGoalChange(sessionId, data) {
    if (String(data?.operation ?? '') === 'clear') {
      goalActive.delete(sessionId)
      return
    }
    const phase = String(data?.goal?.phase ?? '')
    if (phase === 'active') {
      goalActive.add(sessionId)
      clearSettleTimer(sessionId)
      return
    }
    goalActive.delete(sessionId)
    if (phase === 'complete' || phase === 'blocked' || phase === 'paused') {
      const goalRounds = Number(data?.goal?.roundsStarted ?? 0)
      sendNow(sessionId, {
        reason: phase === 'complete' ? { kind: 'completed' } : phase === 'blocked' ? { kind: 'blocked' } : { kind: 'paused' },
        fallbackTurns: Number.isFinite(goalRounds) && goalRounds > 0 ? goalRounds : 0,
      })
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

  function sendNow(sessionId, { reason = null, fallbackTurns = 0 } = {}) {
    try {
      clearSettleTimer(sessionId)
      const config = typeof getConfig === 'function' ? getConfig() : null
      if (config === null || config.notifyOnComplete !== true) { tasks.delete(sessionId); return }
      const chatId = String(config.notifyChatId ?? '').trim()
      if (chatId === '') { tasks.delete(sessionId); return }
      const client = typeof getClient === 'function' ? getClient() : null
      if (client === null) return
      const task = tasks.get(sessionId)
      const finalReason = reason ?? task?.lastReason ?? null
      const turns = Math.max(task?.turns ?? 0, fallbackTurns)
      if (turns <= 0 && finalReason === null) { tasks.delete(sessionId); return }
      const subject = extractSubject(sessions.get(sessionId) ?? { id: sessionId }, getSessionTitle) || lastUserText.get(sessionId) || ''
      const card = buildCompletionCard({
        subject,
        turn: turns,
        durationMs: task === undefined ? 0 : Math.max(0, Date.now() - task.startedAt),
        reason: finalReason,
      })
      tasks.delete(sessionId)
      void sendCardFn(client, chatId, card).catch((error) => {
        warn('feishu completion notify failed: ' + (error instanceof Error ? error.message : String(error)))
      })
    } catch (error) {
      warn('feishu completion notify crashed: ' + (error instanceof Error ? error.message : String(error)))
    }
  }

  return { observe }
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
    if (text !== '') return text.slice(0, 200)
  }
  return String(message?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
}
