// 企业微信 ↔ 天工造梦会话桥。
//
// 职责边界：
// - 入站：把企微回调（文本/@机器人）变成 DSH 用户消息，投递到按会话派生的固定会话。
// - 出站：监听 DSH 的 session/event，把助手输出聚合后通过长连接回给企微（流式）。
// - 指令：/help /new /stop 三个运维指令，避免用户只能靠重启插件兜底。
// - 不碰 WebSocket 细节（client.mjs），不碰协议编码（protocol.mjs）。
//
// 关键设计（为什么这样做）：
// 1. 会话号由会话键哈希派生而不是随机生成：企微每次回调都带 chatid/userid，
//    只有稳定派生才能让同一聊天连续多轮落在同一个 DSH 会话里。
// 2. 回复走流式：DSH 一轮可能几十秒，企微侧若一直静默用户会以为掉线；
//    先发一条流式占位，再增量刷新，最后 finish=true 收尾。
// 3. 流式有 10 分钟硬上限：超时先收尾并把结果改为「主动推送」，
//    不能让它卡在那里变成永久"正在输入"。

import { randomUUID } from 'node:crypto'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import {
  buildRespondStream,
  buildRespondText,
  buildRespondWelcome,
  buildSendMarkdown,
  deriveSessionId,
  textOfCallback,
  truncateMarkdown,
} from './protocol.mjs'

/** 流式刷新节流间隔：太密会被服务端限流（30 条/分钟/会话），太稀用户觉得卡。 */
const STREAM_FLUSH_MS = 900
/** 流式消息硬上限（官方 10 分钟），留 60 秒余量先收尾。 */
const STREAM_MAX_MS = 9 * 60 * 1000
/** 单条消息最大长度，超过先截断再投递，避免超长文本把上下文撑爆。 */
const MAX_INBOUND_CHARS = 8000
/** 空闲会话回收时间：超过 30 分钟无消息的条目在下次访问时清掉，避免 Map 无限增长。 */
const IDLE_EVICT_MS = 30 * 60 * 1000

/** 去掉群聊文本里的 @机器人 前缀（企微不会自动剥离）。 */
export function stripMention(text, botName = '') {
  let value = String(text ?? '').trim()
  const name = String(botName ?? '').trim()
  if (name !== '') {
    const exact = '@' + name
    if (value.startsWith(exact)) value = value.slice(exact.length).trim()
  }
  // 兜底：形如 "@某某 内容"，只削掉第一个 token。
  value = value.replace(/^@\S+\s+/, '')
  return value.trim()
}

/**
 * 构造 DSH 用户消息。
 * 与飞书桥同一思路，但 source.kind 必须是本桥登记的 'dsh-wecom'，
 * 否则 v4 会话格式会以 "requires a producer-owned source kind" 直接拒绝整轮。
 */
export function buildWecomUserMessage(text) {
  const value = String(text ?? '').trim()
  return {
    id: randomUUID(),
    role: 'user',
    content: value === '' ? [] : [{ type: 'text', text: value }],
    source: { kind: 'dsh-wecom', form: 'notice', summary: value.slice(0, 120) },
  }
}

/** 从 assistant/message 事件里抽纯文本（与飞书桥同规则）。 */
export function assistantTextOf(message) {
  const blocks = message?.content
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

/**
 * 会话桥。
 * 由 index.mjs 创建并持有；对外只暴露 handleMessage / handleEvent / observeSessionEvent / dispose / status。
 */
export class WecomBridge {
  /**
   * @param {object} options
   * @param {any} options.ctx DSH 插件上下文
   * @param {any} options.client 长连接客户端
   * @param {object} options.config 已归一化配置
   * @param {(msg:string)=>void} [options.warn] 警告日志
   * @param {(msg:string)=>void} [options.info] 信息日志
   */
  constructor({ ctx, client, config, warn = () => {}, info = () => {}, streamFlushMs = STREAM_FLUSH_MS }) {
    this.ctx = ctx
    this.client = client
    this.config = config
    this.warn = warn
    this.info = info
    // 流式刷新节流间隔；测试传 0 关闭节流，生产保持默认 900ms。
    this.streamFlushMs = Number(streamFlushMs) >= 0 ? Number(streamFlushMs) : STREAM_FLUSH_MS
    /** @type {Map<string, any>} chatKey -> 会话条目 */
    this.conversations = new Map()
    /** @type {Map<string, any>} sessionId -> 会话条目（事件回查） */
    this.bySession = new Map()
    this.closed = false
  }

  /** 状态快照：给面板/日志用，不含任何密钥。 */
  status() {
    return {
      conversations: [...this.conversations.values()].map((entry) => ({
        chatKey: entry.chatKey,
        sessionId: entry.sessionId,
        chatType: entry.chatType,
        running: entry.agent?.status === 'running',
        lastActive: entry.lastActive,
        queued: entry.queue.length,
      })),
    }
  }

  /** 会话键：单聊按用户、群聊按群，两类互不串上下文。 */
  chatKeyOf(body) {
    const chatType = String(body?.chattype ?? 'single') === 'group' ? 'group' : 'single'
    const chatid = String(body?.chatid ?? '').trim()
    const userid = String(body?.from?.userid ?? '').trim()
    return chatType === 'group'
      ? 'group:' + (chatid === '' ? 'unknown' : chatid)
      : 'single:' + (userid === '' ? 'unknown' : userid)
  }

  /** 会话在企微侧的发送目标（单聊=userid，群聊=chatid）。 */
  targetOf(entry) {
    return entry.chatType === 'group' ? entry.chatid : entry.userid
  }

  /**
   * 处理用户消息回调。
   * @param {object} body 回调 body
   * @param {string} reqId 回调 req_id（回复时必须透传）
   */
  async handleMessage(body, reqId) {
    if (this.closed) return
    const text = textOfCallback(body)
    const cleaned = stripMention(text, this.config.botName)

    // 群聊里没有 @机器人 但被推送到的消息：企微只在被 @ 时回调，这里仅做空消息保护。
    if (cleaned === '') {
      this.info('收到空文本消息，已忽略')
      return
    }
    if (cleaned.length > MAX_INBOUND_CHARS) {
      this.info('消息超长，截断后投递')
    }
    const content = cleaned.slice(0, MAX_INBOUND_CHARS)

    // 指令先处理：/help 不需要建会话，避免"问个帮助就凭空开一个会话"。
    if (await this.handleCommand(body, content, reqId)) return

    const entry = await this.ensureConversation(body)
    entry.lastActive = Date.now()

    const pending = {
      id: randomUUID(),
      text: content,
      reqId,
      chatid: String(body?.chatid ?? ''),
      userid: String(body?.from?.userid ?? ''),
      chatType: entry.chatType,
      createdAt: Date.now(),
    }
    entry.queue.push(pending)
    this.info('排队消息 chatKey=' + entry.chatKey + ' 队列=' + String(entry.queue.length))
    await this.flushQueue(entry)
  }

  /** 处理事件回调：只认 enter_chat（欢迎语）与 disconnected_event（连接层已处理）。 */
  async handleEvent(body, reqId) {
    const eventtype = String(body?.event?.eventtype ?? '')
    if (eventtype !== 'enter_chat') return
    const text = this.config.welcomeText
    if (text === '') return
    try {
      await this.client.request(buildRespondWelcome(reqId, text))
    } catch (error) {
      this.warn('欢迎语发送失败：' + (error instanceof Error ? error.message : String(error)))
    }
  }

  /** 三个运维指令；命中返回 true，表示不再投递给 Agent。 */
  async handleCommand(body, text, reqId) {
    const command = text.toLowerCase()
    if (command === '/help' || text === '帮助') {
      const help = [
        '**天工造梦 · 企微桥**',
        '',
        '直接发消息即可对话，当前会话独立于 Web 面板。',
        '',
        '- `/new` 开新会话（清空上下文）',
        '- `/stop` 中止当前任务',
        '- `/help` 显示本说明',
      ].join('\n')
      await this.respondText(reqId, help)
      return true
    }
    const entry = this.conversations.get(this.chatKeyOf(body))
    if (command === '/new') {
      if (entry === undefined) {
        await this.respondText(reqId, '当前还没有会话，直接发消息就会自动开始。')
        return true
      }
      if (entry.agent?.status === 'running') {
        await this.respondText(reqId, '当前任务还在运行，请先发 `/stop` 再开新会话。')
        return true
      }
      await this.dropConversation(entry)
      await this.respondText(reqId, '已开启新会话，上下文已清空。')
      return true
    }
    if (command === '/stop') {
      if (entry === undefined || entry.agent?.status !== 'running') {
        await this.respondText(reqId, '当前没有正在运行的任务。')
        return true
      }
      try {
        entry.agent.cancel({ kind: 'user' })
        await this.respondText(reqId, '已请求中止当前任务。')
      } catch (error) {
        this.warn('中止任务失败：' + (error instanceof Error ? error.message : String(error)))
        await this.respondText(reqId, '中止失败，请到 Web 面板处理。')
      }
      return true
    }
    return false
  }

  /** 发一次性 markdown 回复（指令类，不需要流式）。 */
  async respondText(reqId, text) {
    try {
      await this.client.request(buildRespondText(reqId, text))
    } catch (error) {
      this.warn('回复失败：' + (error instanceof Error ? error.message : String(error)))
    }
  }

  /**
   * 确保会话存在：命中缓存直接返回；否则按派生 sessionId 建/恢复 DSH 会话。
   * 建会话失败必须抛出，由调用方回一条可读错误，绝不能静默吞掉。
   */
  async ensureConversation(body) {
    const chatKey = this.chatKeyOf(body)
    const cached = this.conversations.get(chatKey)
    if (cached !== undefined && cached.agent?.status !== 'disposed') return cached
    if (cached !== undefined) this.conversations.delete(chatKey)

    const sessionId = deriveSessionId(chatKey)
    const chatType = chatKey.startsWith('group:') ? 'group' : 'single'
    const cwd = this.config.cwd
    const agentPreset = await this.resolvePreset()
    const selection = this.selection()
    const handle = await this.ctx.agents.create({
      sessionId,
      meta: { cwd, agentPreset },
      agentOptions: { provider: selection.provider, model: selection.model },
      setup: async (agentCtx) => {
        const preset = await this.ctx.agentPresets.mount(agentCtx, agentPreset)
        if (preset?.id !== undefined && preset.id !== agentPreset) {
          throw new Error('Agent 预设解析结果不一致：' + String(preset.id) + ' != ' + agentPreset)
        }
        installModelSelection(agentCtx, { current: selection, assembled: undefined })
      },
    })
    if (handle?.agent === undefined || typeof handle.dispose !== 'function') {
      throw new Error('DSH agents.create 返回的 handle 不完整')
    }
    const entry = {
      chatKey,
      chatType,
      chatid: String(body?.chatid ?? ''),
      userid: String(body?.from?.userid ?? ''),
      sessionId,
      agent: handle.agent,
      handle,
      queue: [],
      turn: null,
      lastActive: Date.now(),
      createdAt: Date.now(),
    }
    this.conversations.set(chatKey, entry)
    this.bySession.set(String(handle.agent.session?.id ?? sessionId), entry)
    this.info('已建立企微会话 chatKey=' + chatKey + ' sessionId=' + sessionId)
    return entry
  }

  /** 解析可用预设：配置值优先，解析不到回退 cordis；两者都不可用则报错。 */
  async resolvePreset() {
    const requested = String(this.config.agentPreset ?? '').trim()
    if (requested !== '') {
      try {
        const preset = await this.ctx.agentPresets.resolve(requested)
        if (preset !== undefined && preset.broken === undefined) return requested
      } catch { /* 落到回退 */ }
    }
    try {
      const fallback = await this.ctx.agentPresets.resolve('cordis')
      if (fallback !== undefined && fallback.broken === undefined) return 'cordis'
    } catch { /* 落到默认 */ }
    return requested === '' ? 'cordis' : requested
  }

  /** 取宿主默认模型；拿不到时返回空对象，让 agents.create 用宿主默认。 */
  selection() {
    try {
      const current = this.ctx.agentDefaultModel.currentSelection()
      if (current !== undefined && current !== null) return current
    } catch { /* ignore */ }
    return { provider: '', model: '' }
  }

  /** 队列推进：Agent 空闲时投递队首；turn/end 后强制推进（此时宿主即将切空闲）。 */
  async flushQueue(entry, force = false) {
    if (this.closed) return
    if (!force && entry.agent?.status === 'running') return
    const pending = entry.queue.shift()
    if (pending === undefined) return
    this.startTurn(entry, pending)
    try {
      entry.agent.followup(buildWecomUserMessage(pending.text))
    } catch (error) {
      this.warn('投递失败：' + (error instanceof Error ? error.message : String(error)))
      await this.respondText(pending.reqId, '投递到天工造梦失败，请稍后重试。')
      this.endTurn(entry, true)
      void this.flushQueue(entry, true)
    }
  }

  /** 开启一轮：占位流式消息 + 计时器（超时保护）。 */
  startTurn(entry, pending) {
    const streamId = randomUUID()
    entry.turn = {
      streamId,
      reqId: pending.reqId,
      text: '',
      lastFlushAt: 0,
      startedAt: Date.now(),
      finished: false,
      timer: null,
      chatid: pending.chatid,
      userid: pending.userid,
      chatType: pending.chatType,
    }
    this.pushStream(entry, '正在处理…', false)
    entry.turn.timer = setTimeout(() => {
      const turn = entry.turn
      if (turn === null || turn.finished) return
      this.info('流式消息接近 10 分钟上限，先收尾 chatKey=' + entry.chatKey)
      const tail = turn.text === '' ? '任务仍在运行，完成后会单独推送结果。' : turn.text + '\n\n（任务仍在运行，完成后会单独推送结果。）'
      this.pushStream(entry, tail, true)
      turn.finished = true
    }, STREAM_MAX_MS)
    if (typeof entry.turn.timer?.unref === 'function') entry.turn.timer.unref()
  }

  /** 结束一轮：清计时器；未 finish 的流式消息由调用方负责收尾。 */
  endTurn(entry, alreadyFinished = false) {
    const turn = entry.turn
    if (turn === null) return
    if (turn.timer !== null) clearTimeout(turn.timer)
    turn.timer = null
    if (alreadyFinished) turn.finished = true
    entry.turn = alreadyFinished || turn.finished ? null : turn
  }

  /** 推流式消息；失败不是致命错误（用户仍会看到最终收尾）。 */
  pushStream(entry, text, finish) {
    const turn = entry.turn
    if (turn === null) return
    const now = Date.now()
    if (finish !== true && turn.lastFlushAt !== 0 && now - turn.lastFlushAt < this.streamFlushMs) return
    turn.lastFlushAt = now
    const frame = buildRespondStream(turn.reqId, turn.streamId, truncateMarkdown(text), finish)
    // 流式刷新不等待回执，避免阻塞事件循环；失败只记日志。
    try {
      this.client.send(frame)
    } catch (error) {
      this.warn('流式推送失败：' + (error instanceof Error ? error.message : String(error)))
    }
  }

  /**
   * 观察 DSH 会话事件。
   * 只有「本桥持有的会话」才处理，GUI 会话的事件一律放行（返回 false）。
   */
  observeSessionEvent(session, event) {
    const sessionId = String(session?.id ?? '')
    const entry = this.bySession.get(sessionId)
    if (entry === undefined) return false
    if (event?.type === 'assistant/chunk') {
      const chunk = event.data?.chunk
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text !== '') {
        if (entry.turn !== null) {
          entry.turn.text += chunk.text
          this.pushStream(entry, entry.turn.text, false)
        }
      }
      return false
    }
    if (event?.type === 'assistant/message') {
      const text = assistantTextOf(event.data?.message)
      if (text !== '' && entry.turn !== null) {
        entry.turn.text = text
        this.pushStream(entry, text, false)
      }
      return false
    }
    if (event?.type !== 'turn/end') return false

    const turn = entry.turn
    const reason = String(event?.data?.reason?.kind ?? '')
    const finalText = (turn?.text ?? '') !== '' ? turn.text : this.lastAssistantText(session)
    if (turn !== null) {
      this.endTurn(entry, false)
      if (turn.finished === true) {
        // 已因超时收尾：用主动推送补发最终结果（回复窗口仍有效时也能送达）。
        this.pushFinal(entry, finalText, reason)
      } else {
        this.pushStream(entry, finalText === '' ? this.fallbackText(reason) : finalText, true)
      }
    }
    void this.flushQueue(entry, true)
    return false
  }

  /** 超时收尾后的最终结果：优先主动推送（markdown），失败再退回流式。 */
  pushFinal(entry, text, reason) {
    const content = text === '' ? this.fallbackText(reason) : text
    const frame = buildSendMarkdown(this.targetOf(entry), entry.chatType === 'group' ? 2 : 1, content)
    try {
      this.client.send(frame)
      this.info('已主动推送最终结果 chatKey=' + entry.chatKey)
    } catch (error) {
      this.warn('主动推送失败：' + (error instanceof Error ? error.message : String(error)))
    }
  }

  /** 从会话事件里取最后一条助手文本（兜底：chunk 丢失时仍能拿到答案）。 */
  lastAssistantText(session) {
    const events = session?.events
    if (!Array.isArray(events)) return ''
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (event?.type !== 'assistant/message') continue
      const text = assistantTextOf(event.data?.message)
      if (text !== '') return text
    }
    return ''
  }

  /** 异常结束时的可读兜底文案。 */
  fallbackText(reason) {
    return reason === 'error' ? '任务执行失败，请到 Web 面板查看详细日志。' : '任务已结束（无文本输出）。'
  }

  /** /new：结束并移除当前会话，下一次消息重建。 */
  async dropConversation(entry) {
    try { await entry.handle?.dispose?.() } catch (error) {
      this.warn('关闭会话失败：' + (error instanceof Error ? error.message : String(error)))
    }
    this.conversations.delete(entry.chatKey)
    for (const [sessionId, value] of this.bySession) {
      if (value === entry) this.bySession.delete(sessionId)
    }
  }

  /** 关闭整座桥：拒绝在途任务、释放所有会话。 */
  async dispose() {
    this.closed = true
    const entries = [...this.conversations.values()]
    this.conversations.clear()
    this.bySession.clear()
    for (const entry of entries) {
      if (entry.turn?.timer != null) clearTimeout(entry.turn.timer)
      try { await entry.handle?.dispose?.() } catch { /* 单点失败不阻断 */ }
    }
  }

  /** 清理超长空闲会话，避免长期运行后 Map 无界增长。 */
  evictIdle(now = Date.now()) {
    for (const [key, entry] of this.conversations) {
      if (now - entry.lastActive < IDLE_EVICT_MS) continue
      if (entry.agent?.status === 'running') continue
      void this.dropConversation(entry)
      this.info('回收空闲会话 chatKey=' + key)
    }
  }
}
