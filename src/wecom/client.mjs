// 企业微信智能机器人长连接客户端。
//
// 职责边界：
// - 只负责「建连、订阅、心跳、收帧分发、断线重连、发帧并等回执」。
// - 不认识 DSH 会话，不认识业务指令；业务全部通过 onMessage / onEvent 回调出去。
// - 帧格式在 protocol.mjs，业务在 bridge.mjs。
//
// 关键约束（来自官方文档，违反会静默失效）：
// 1. 订阅成功后不要反复发 aibot_subscribe，有频率保护。
// 2. 同一机器人同一时间只允许一条有效长连接，新连接会踢掉旧连接，
//    因此本端必须保证单实例，并在收到 disconnected_event 时立刻重连。
// 3. 心跳建议 30 秒一次；长期无心跳服务端会断开。

import { isAck, makeReqId, parseFrame, reqIdOf, WECOM_WS_URL } from './protocol.mjs'

/** 等待回执的默认超时；服务端正常回执在毫秒级，10 秒足够区分「网络问题」与「协议错误」。 */
const ACK_TIMEOUT_MS = 10_000
/** 订阅失败后的退避上限，避免被服务端风控判定为恶意重连。 */
const RECONNECT_MAX_MS = 60_000
/** 心跳间隔：官方建议 30 秒。 */
const HEARTBEAT_MS = 30_000

/**
 * 长连接客户端。
 *
 * 使用方式：
 *   const client = new WecomClient({ botId, secret, onMessage, onEvent, logger })
 *   await client.start()
 *   client.respondText(reqId, '你好')
 *   await client.stop()
 */
export class WecomClient {
  /**
   * @param {object} options
   * @param {string} options.botId 智能机器人 BotID
   * @param {string} options.secret 长连接 Secret
   * @param {(body: object, reqId: string) => void} [options.onMessage] 用户消息回调
   * @param {(body: object, reqId: string) => void} [options.onEvent] 事件回调
   * @param {{info?:Function,warn?:Function,error?:Function}} [options.logger] 日志出口
   * @param {number} [options.heartbeatMs] 心跳间隔（测试可缩短）
   * @param {number} [options.ackTimeoutMs] 回执超时（测试可缩短）
   * @param {string} [options.url] 覆盖连接地址（仅测试用）
   * @param {any} [options.WebSocketImpl] 覆盖 WebSocket 实现（仅测试用）
   */
  constructor(options = {}) {
    this.botId = String(options.botId ?? '')
    this.secret = String(options.secret ?? '')
    this.onMessage = typeof options.onMessage === 'function' ? options.onMessage : () => {}
    this.onEvent = typeof options.onEvent === 'function' ? options.onEvent : () => {}
    this.logger = options.logger ?? {}
    this.heartbeatMs = Number(options.heartbeatMs) > 0 ? Number(options.heartbeatMs) : HEARTBEAT_MS
    this.ackTimeoutMs = Number(options.ackTimeoutMs) > 0 ? Number(options.ackTimeoutMs) : ACK_TIMEOUT_MS
    this.url = String(options.url ?? WECOM_WS_URL)
    this.WebSocketImpl = options.WebSocketImpl ?? null

    /** @type {any} 当前底层连接 */
    this.socket = null
    /** 连接状态：idle / connecting / subscribed / closing / closed */
    this.state = 'idle'
    /** 订阅是否已完成（决定重连后是否需要重新订阅） */
    this.subscribed = false
    /** 主动停止标记：为 true 时不再自动重连 */
    this.stopped = false
    /** 重连退避计数 */
    this.reconnectAttempts = 0
    /** 等待回执的请求：reqId -> { resolve, reject, timer } */
    this.pending = new Map()
    /** 心跳定时器 */
    this.heartbeatTimer = null
    /** 重连定时器 */
    this.reconnectTimer = null
    /** 最近一次错误（供状态面板展示） */
    this.lastError = ''
    /** 最近一次成功订阅时间 */
    this.subscribedAt = 0
  }

  /** 统一日志前缀，便于在宿主日志里定位。 */
  log(level, message) {
    const fn = this.logger?.[level]
    if (typeof fn === 'function') {
      try { fn('[dsh-wecom]', message) } catch { /* 日志失败不影响主流程 */ }
      return
    }
    try { console[level === 'error' ? 'error' : 'log']('[dsh-wecom]', message) } catch { /* ignore */ }
  }

  /** 惰性加载 ws 实现：测试注入，生产用依赖。 */
  async resolveWebSocket() {
    if (this.WebSocketImpl !== null) return this.WebSocketImpl
    const module = await import('ws')
    return module.default ?? module.WebSocket ?? module
  }

  /**
   * 启动长连接：建连 → 订阅 → 开心跳。
   * 失败会抛错，由调用方决定是否重试；start() 本身不做无限重试，
   * 自动重连只在「已订阅后断线」场景发生（见 scheduleReconnect）。
   */
  async start() {
    if (this.botId === '' || this.secret === '') throw new Error('企微机器人 BotID/Secret 未配置')
    this.stopped = false
    this.state = 'connecting'
    const WebSocketImpl = await this.resolveWebSocket()
    await new Promise((resolve, reject) => {
      let socket
      try {
        socket = new WebSocketImpl(this.url)
      } catch (error) {
        this.state = 'closed'
        reject(error)
        return
      }
      this.socket = socket
      let settled = false
      const fail = (error) => {
        if (settled) return
        settled = true
        this.state = 'closed'
        reject(error)
      }
      socket.on('open', () => {
        this.log('info', 'WebSocket 已建立，开始订阅')
        this.subscribe()
          .then(() => {
            if (settled) return
            settled = true
            this.state = 'subscribed'
            this.subscribed = true
            this.subscribedAt = Date.now()
            this.reconnectAttempts = 0
            this.startHeartbeat()
            this.log('info', '订阅成功，长连接就绪')
            resolve()
          })
          .catch((error) => {
            this.lastError = error instanceof Error ? error.message : String(error)
            try { socket.close() } catch { /* ignore */ }
            fail(error)
          })
      })
      socket.on('message', (data) => this.handleFrame(data))
      socket.on('error', (error) => {
        this.lastError = error instanceof Error ? error.message : String(error)
        this.log('warn', '长连接错误：' + this.lastError)
      })
      socket.on('close', (code) => {
        this.stopHeartbeat()
        this.rejectAllPending('连接已断开')
        const wasSubscribed = this.subscribed
        this.subscribed = false
        this.socket = null
        if (this.stopped) {
          this.state = 'closed'
          fail(new Error('连接已关闭'))
          return
        }
        if (wasSubscribed) {
          this.log('warn', '长连接断开（code=' + String(code ?? '') + '），准备重连')
          this.scheduleReconnect()
        } else {
          this.state = 'closed'
          fail(new Error('连接在订阅完成前关闭（code=' + String(code ?? '') + '）'))
        }
      })
    })
  }

  /** 发送订阅帧并等待回执。 */
  async subscribe() {
    const frame = { cmd: 'aibot_subscribe', headers: { req_id: makeReqId() }, body: { bot_id: this.botId, secret: this.secret } }
    const ack = await this.request(frame)
    if (Number(ack?.errcode ?? 0) !== 0) {
      throw new Error('订阅失败：errcode=' + String(ack?.errcode ?? '') + ' errmsg=' + String(ack?.errmsg ?? ''))
    }
  }

  /** 发送一帧并等待服务端回执（按 req_id 匹配）。 */
  request(frame) {
    const reqId = reqIdOf(frame) || makeReqId()
    if (!frame.headers) frame.headers = {}
    frame.headers.req_id = reqId
    return new Promise((resolve, reject) => {
      const socket = this.socket
      if (socket === null || socket.readyState !== 1) {
        reject(new Error('长连接未就绪，无法发送 ' + String(frame.cmd ?? '')))
        return
      }
      const timer = setTimeout(() => {
        this.pending.delete(reqId)
        reject(new Error('等待回执超时：' + String(frame.cmd ?? '')))
      }, this.ackTimeoutMs)
      this.pending.set(reqId, { resolve, reject, timer })
      try {
        socket.send(JSON.stringify(frame))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(reqId)
        reject(error)
      }
    })
  }

  /** 不等待回执的发送（流式刷新、心跳），失败只记日志。 */
  send(frame) {
    const socket = this.socket
    if (socket === null || socket.readyState !== 1) {
      this.log('warn', '长连接未就绪，丢弃帧 ' + String(frame?.cmd ?? ''))
      return false
    }
    try {
      socket.send(JSON.stringify(frame))
      return true
    } catch (error) {
      this.log('warn', '发送失败：' + (error instanceof Error ? error.message : String(error)))
      return false
    }
  }

  /** 心跳：发 ping 并检查回执，失败不抛错。 */
  startHeartbeat() {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      const frame = { cmd: 'ping', headers: { req_id: makeReqId() } }
      try {
        const ack = this.request(frame)
        ack.catch((error) => this.log('warn', '心跳失败：' + (error instanceof Error ? error.message : String(error))))
      } catch (error) {
        this.log('warn', '心跳发送异常：' + (error instanceof Error ? error.message : String(error)))
      }
    }, this.heartbeatMs)
    // 定时器不应阻止进程退出（宿主关闭时靠 stop() 清理）。
    if (typeof this.heartbeatTimer?.unref === 'function') this.heartbeatTimer.unref()
  }

  stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  /** 断线重连：指数退避，上限 60 秒。 */
  scheduleReconnect() {
    if (this.stopped) return
    if (this.reconnectTimer !== null) return
    this.reconnectAttempts += 1
    const delay = Math.min(RECONNECT_MAX_MS, 1000 * 2 ** Math.min(this.reconnectAttempts - 1, 6))
    this.log('info', '将在 ' + String(delay) + 'ms 后重连（第 ' + String(this.reconnectAttempts) + ' 次）')
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.state = 'connecting'
      this.start().catch((error) => {
        this.lastError = error instanceof Error ? error.message : String(error)
        this.log('warn', '重连失败：' + this.lastError)
        this.scheduleReconnect()
      })
    }, delay)
    if (typeof this.reconnectTimer?.unref === 'function') this.reconnectTimer.unref()
  }

  /** 收帧分发：回执归位，回调转业务。 */
  handleFrame(data) {
    const frame = parseFrame(data)
    if (frame === null) {
      this.log('warn', '收到无法解析的帧，已丢弃')
      return
    }
    const reqId = reqIdOf(frame)
    if (isAck(frame)) {
      const entry = this.pending.get(reqId)
      if (entry !== undefined) {
        clearTimeout(entry.timer)
        this.pending.delete(reqId)
        entry.resolve(frame)
      }
      return
    }
    const cmd = String(frame.cmd ?? '')
    const body = frame.body ?? {}
    if (cmd === 'aibot_msg_callback') {
      try { this.onMessage(body, reqId) } catch (error) {
        this.log('error', '消息回调处理异常：' + (error instanceof Error ? error.message : String(error)))
      }
      return
    }
    if (cmd === 'aibot_event_callback') {
      // 断线事件：服务端已踢掉本连接，立刻重连（不要等 close 事件，可能晚到）。
      if (String(body?.event?.eventtype ?? '') === 'disconnected_event') {
        this.log('warn', '收到 disconnected_event（新连接踢掉了旧连接），立即重连')
        try { this.socket?.close() } catch { /* ignore */ }
        this.scheduleReconnect()
      }
      try { this.onEvent(body, reqId) } catch (error) {
        this.log('error', '事件回调处理异常：' + (error instanceof Error ? error.message : String(error)))
      }
      return
    }
    this.log('warn', '收到未知命令帧：' + cmd)
  }

  /** 主动停止：关连接、清定时器、拒绝所有等待中的回执。 */
  async stop() {
    this.stopped = true
    this.stopHeartbeat()
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.rejectAllPending('客户端已停止')
    const socket = this.socket
    this.socket = null
    this.subscribed = false
    this.state = 'closed'
    if (socket !== null) {
      await new Promise((resolve) => {
        try {
          socket.once?.('close', resolve)
          socket.close()
        } catch {
          resolve()
        }
        // 兜底：部分实现不触发 close，最多等 1 秒。
        setTimeout(resolve, 1000)
      })
    }
  }

  rejectAllPending(reason) {
    for (const [reqId, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error(reason))
      this.pending.delete(reqId)
    }
  }

  /** 供状态面板展示的只读快照。 */
  status() {
    return {
      state: this.state,
      connected: this.subscribed,
      botId: this.botId === '' ? '' : this.botId.slice(0, 6) + '***',
      lastError: this.lastError,
      subscribedAt: this.subscribedAt,
      pendingRequests: this.pending.size,
    }
  }
}
