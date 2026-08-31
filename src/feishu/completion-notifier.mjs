// Vendored from dsh-feishu 0.2.2 (MIT, andyfan1094/dsh-feishu).
// dsh-devforge consolidation modification: 模块折叠至 dsh-devforge；新增任务完成飞书卡片通知能力。
import { buildCompletionCard, sendCard } from './outbound.mjs'

/**
 * 订阅 Host session/event，在 turn/end 时构造并发送完成卡片。
 *
 * 设计原则：
 * - 独立于 reply-tracker，避免和入站桥耦合；
 * - 主题优先取会话标题，其次跟踪最近一条用户消息，取不到就不显示主题；
 * - reason 是 Host 的结构化 TurnEndReason（对象），原样交给 buildCompletionCard 归一化，
 *   绝不 String() 后直接拼接（否则卡片上渲染成 [object Object]）；
 * - 通过外部 getConfig/getClient 注入配置与 SDK client，无独立网络连接；
 * - 所有错误吞掉并 warn，永不向上抛（不能影响 agent loop）。
 */
export function createCompletionNotifier({ getConfig, getClient, getSessionTitle, sendCard: sendCardFn = sendCard, warn = () => {} } = {}) {
  const lastTurnStart = new Map() // sessionId:turn -> startedAt(ms)
  const lastUserText = new Map() // sessionId -> 最近一条用户消息文本（主题兜底）
  const MAX_TRACKED_SESSIONS = 200

  function observe(session, event) {
    const sessionId = String(session?.id ?? '').trim()
    if (sessionId === '') return
    const type = String(event?.type ?? '')
    if (type === 'user/message') {
      const text = userTextOf(event?.data)
      if (text !== '') {
        if (lastUserText.size >= MAX_TRACKED_SESSIONS && !lastUserText.has(sessionId)) {
          const oldest = lastUserText.keys().next().value
          if (oldest !== undefined) lastUserText.delete(oldest)
        }
        lastUserText.set(sessionId, text)
      }
      return
    }
    const turn = Number(event?.data?.turn ?? 0)
    if (type === 'turn/start') {
      if (turn > 0) lastTurnStart.set(sessionId + ':' + turn, Date.now())
      return
    }
    if (type !== 'turn/end') return
    if (turn <= 0) return
    const startedAt = lastTurnStart.get(sessionId + ':' + turn) ?? Date.now()
    lastTurnStart.delete(sessionId + ':' + turn)

    const config = typeof getConfig === 'function' ? getConfig() : null
    if (config === null) return
    if (config.notifyOnComplete !== true) return
    const chatId = String(config.notifyChatId ?? '').trim()
    if (chatId === '') return
    const client = typeof getClient === 'function' ? getClient() : null
    if (client === null) return

    const subject = extractSubject(session, getSessionTitle) || lastUserText.get(sessionId) || ''
    const card = buildCompletionCard({ subject, turn, durationMs: Date.now() - startedAt, reason: event?.data?.reason })
    void sendCardFn(client, chatId, card).catch((error) => {
      warn('feishu completion notify failed: ' + (error instanceof Error ? error.message : String(error)))
    })
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
