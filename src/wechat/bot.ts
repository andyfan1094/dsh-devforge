/**
 * 微信 AI 自动回复引擎 —— 把微信消息接进模型，和飞书通道一个思路。
 *
 * 链路：
 *   轮询 wx-auto 新消息 → 过滤（私聊 / 群 @我 / 白名单）
 *   → agents.create 建会话（每个微信对象一个固定 sessionId，保持上下文）
 *   → agent.followup 派活 → 监听 session/event 的 assistant/message 取回复
 *   → 调 wx-auto /api/send 发回微信
 *
 * 与飞书桥的差别：飞书是长连接推送，微信这边是轮询 + 本地服务代理；
 * 其余（会话复用、回复追踪、超时兜底）沿用同样思路。
 */

import type { Context } from '@deepseek-ai/cordis'

/** 控制台地址。 */
const WX_API = 'http://127.0.0.1:8765'

/** 轮询间隔（毫秒）。 */
const POLL_MS = 3000

/** 单条消息等模型回复的上限（毫秒）。 */
const REPLY_TIMEOUT_MS = 120_000

/** 判定要回复的消息。 */
export interface BotMessage {
  session: string
  sessionName: string
  sender: string
  senderName: string
  text: string
  ts: number
  isGroup: boolean
}

/** 运行状态（面板用）。 */
export interface BotState {
  enabled: boolean
  /** 已处理消息数。 */
  replied: number
  /** 正在等回复的会话数。 */
  pending: number
  /** 最近一条错误。 */
  lastError: string
  /** 最近一次活动时间（毫秒）。 */
  lastActivity: number
}

interface PendingReply {
  sessionId: string
  target: string
  createdAt: number
}

export class WechatBot {
  private ctx: Context
  private timer: ReturnType<typeof setInterval> | undefined
  private disposed = false
  private seen = new Set<string>()
  private pending = new Map<string, PendingReply>()
  private state: BotState = { enabled: false, replied: 0, pending: 0, lastError: '', lastActivity: 0 }
  private offSession: (() => void) | undefined
  /** /api/messages 的增量游标。 */
  private cursor = 0

  constructor(ctx: Context) {
    this.ctx = ctx
  }

  /** 当前状态快照。 */
  status(): BotState {
    return { ...this.state, pending: this.pending.size }
  }

  /** 打开自动回复：开始轮询并订阅会话事件。 */
  start(): void {
    if (this.state.enabled) return
    this.state.enabled = true
    this.state.lastError = ''
    this.offSession = this.ctx.on('session/event', (session: unknown, event: { type?: unknown; data?: unknown }) => {
      this.onSessionEvent(session, event)
    })
    this.timer = setInterval(() => { void this.tick() }, POLL_MS)
    void this.tick()
  }

  /** 关闭自动回复。 */
  stop(): void {
    this.state.enabled = false
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    this.offSession?.()
    this.offSession = undefined
    this.pending.clear()
  }

  dispose(): void {
    this.disposed = true
    this.stop()
  }

  /** 拉一次新消息并派活。 */
  private async tick(): Promise<void> {
    if (this.disposed || !this.state.enabled) return
    try {
      const res = await fetch(`${WX_API}/api/messages?after=${this.cursor}`, { signal: AbortSignal.timeout(4000) })
      if (!res.ok) return
      const data = (await res.json()) as { total?: number; messages?: Array<Record<string, unknown>> }
      const list = Array.isArray(data.messages) ? data.messages : []
      if (typeof data.total === 'number') this.cursor = data.total
      for (const raw of list) {
        const msg = this.normalize(raw)
        if (msg === null) continue
        const key = `${msg.session}|${msg.ts}|${msg.text}`
        if (this.seen.has(key)) continue
        this.seen.add(key)
        if (!this.shouldReply(msg)) continue
        void this.reply(msg)
      }
    } catch (error) {
      this.state.lastError = error instanceof Error ? error.message : String(error)
    }
  }

  /** wx-auto 消息 → 统一结构；只取收到的私聊/群消息，自己发的不回复。 */
  private normalize(raw: Record<string, unknown>): BotMessage | null {
    const kind = typeof raw.kind === 'string' ? raw.kind : ''
    if (kind === 'sent') return null
    const session = typeof raw.session === 'string' ? raw.session : ''
    const text = typeof raw.text === 'string' ? raw.text.trim() : ''
    if (session === '' || text === '') return null
    // 系统通知/公众号 XML（<msg><op id='11'>…）不是人说的话，别喂给模型
    if (text.startsWith('<msg') || text.startsWith('<sysmsg') || text.startsWith('<?xml')) return null
    // 纯链接/文件/语音等非文本形态同样跳过
    if (text.startsWith('<') && text.endsWith('>')) return null
    const isGroup = session.endsWith('@chatroom')
    const sender = typeof raw.sender === 'string' ? raw.sender : ''
    return {
      session,
      sessionName: typeof raw.session_name === 'string' ? raw.session_name : session,
      sender,
      senderName: typeof raw.sender_name === 'string' ? raw.sender_name : '',
      text,
      ts: typeof raw.ts === 'number' ? raw.ts : 0,
      isGroup,
    }
  }

  /**
   * 回复策略：
   * - 私聊：默认回复；
   * - 群聊：暂不自动回复（群里人多，避免刷屏），等辉哥明确要求再放开。
   */
  private shouldReply(msg: BotMessage): boolean {
    if (msg.isGroup) return false
    return true
  }

  /** 建会话 + 派活 + 等回复。 */
  private async reply(msg: BotMessage): Promise<void> {
    const agents = this.ctx.get('agents') as {
      create?: (options: Record<string, unknown>) => Promise<{ agent: { followup(text: string): void }; dispose(): void }>
    } | undefined
    if (!agents?.create) {
      this.state.lastError = '宿主未提供 agents 服务，无法回复'
      return
    }
    const sessionId = 'wechat-' + msg.sender.replace(/[^A-Za-z0-9_@.-]/g, '_')
    try {
      const handle = await agents.create({
        sessionId,
        cwd: 'D:/项目',
        agentOptions: {},
      })
      this.pending.set(sessionId, { sessionId, target: msg.session, createdAt: Date.now() })
      const prompt = msg.senderName !== '' ? `${msg.senderName} 说：${msg.text}` : msg.text
      handle.agent.followup(prompt)
      this.state.lastActivity = Date.now()
    } catch (error) {
      this.state.lastError = error instanceof Error ? error.message : String(error)
    }
  }

  /** 会话事件：命中 assistant/message 就把文本发回微信。 */
  private onSessionEvent(session: unknown, event: { type?: unknown; data?: unknown }): void {
    if (event?.type !== 'assistant/message') return
    const info = session as { id?: unknown }
    const sessionId = typeof info?.id === 'string' ? info.id : ''
    const p = this.pending.get(sessionId)
    if (p === undefined) return
    if (Date.now() - p.createdAt > REPLY_TIMEOUT_MS) {
      this.pending.delete(sessionId)
      return
    }
    const data = event.data as { message?: { content?: unknown } } | undefined
    const blocks = data?.message?.content
    if (!Array.isArray(blocks)) return
    const text = blocks
      .filter((b): b is { type: string; text: string } => typeof b === 'object' && b !== null && (b as { type?: unknown }).type === 'text' && typeof (b as { text?: unknown }).text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim()
    if (text === '') return
    this.pending.delete(sessionId)
    void this.send(p.target, text)
  }

  /** 调 wx-auto 发回微信。 */
  private async send(target: string, text: string): Promise<void> {
    try {
      const res = await fetch(WX_API + '/api/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, session: target }),
        signal: AbortSignal.timeout(60_000),
      })
      if (!res.ok) {
        this.state.lastError = '发送失败：HTTP ' + res.status
        return
      }
      this.state.replied += 1
      this.state.lastActivity = Date.now()
    } catch (error) {
      this.state.lastError = error instanceof Error ? error.message : String(error)
    }
  }
}

/** 插件生命周期内唯一的 bot 实例（路由拿来读写状态）。 */
let current: WechatBot | null = null

/** 注册/注销 bot 实例。 */
export function setWechatBot(bot: WechatBot | null): void {
  current = bot
}

/** 取当前 bot 实例（未初始化返回 null）。 */
export function getWechatBot(): WechatBot | null {
  return current
}
