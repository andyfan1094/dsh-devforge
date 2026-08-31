// Vendored from dsh-feishu 0.2.2 (MIT, andyfan1094/dsh-feishu).
// dsh-devforge consolidation modification: 模块折叠至 dsh-devforge；新增任务完成飞书卡片通知能力。
import { buildCompletionCard, sendCard } from './outbound.mjs'

/**
 * 跟踪每个会话最近一次轮次开始时间，在 turn/end 时构造并发送完成卡片。
 *
 * 设计原则：
 * - 订阅 Host 的 session/event，独立于 reply-tracker，避免和入站桥耦合；
 * - 通过外部 getConfig/getClient 注入配置与 SDK client，无独立网络连接；
 * - 所有错误吞掉并 warn，永不向上抛（不能影响 agent loop）。
 */
export function createCompletionNotifier({ getConfig, getClient, warn = () => {} } = {}) {
  const lastTurnStart = new Map() // sessionId -> startedAt(ms)

  function observe(session, event) {
    const sessionId = String(session?.id ?? '').trim()
    if (sessionId === '') return
    const type = String(event?.type ?? '')
    const turn = Number(event?.data?.turn ?? 0)
    if (type === 'turn/start') {
      if (turn > 0) lastTurnStart.set(sessionId + ':' + turn, Date.now())
      return
    }
    if (type !== 'turn/end') return
    if (turn <= 0) return
    const startedAt = lastTurnStart.get(sessionId + ':' + turn) ?? Date.now()
    lastTurnStart.delete(sessionId + ':' + turn)
    const reason = String(event?.data?.reason ?? '')

    const config = typeof getConfig === 'function' ? getConfig() : null
    if (config === null) return
    if (config.notifyOnComplete !== true) return
    const chatId = String(config.notifyChatId ?? '').trim()
    if (chatId === '') return

    const client = typeof getClient === 'function' ? getClient() : null
    if (client === null) return

    const subject = extractSubject(session)
    const card = buildCompletionCard({ subject, turn, durationMs: Date.now() - startedAt, reason })
    void sendCard(client, chatId, card).catch((error) => {
      warn('feishu completion notify failed: ' + (error instanceof Error ? error.message : String(error)))
    })
  }

  return { observe }
}

function extractSubject(session) {
  const explicit = String(session?.title ?? '').trim()
  if (explicit !== '') return explicit
  // 退而求其次：从会话事件流里找第一条 user 文本。
  const events = Array.isArray(session?.events) ? session.events : []
  for (const entry of events) {
    const text = String(entry?.data?.message?.content?.text ?? entry?.data?.message?.text ?? '').trim()
    if (text !== '') return text.slice(0, 200)
  }
  return ''
}
