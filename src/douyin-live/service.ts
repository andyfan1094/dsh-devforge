import WebSocket from 'ws'
import type { CompanionSnapshot, DouyinLiveConfig, DouyinLiveSnapshot } from './protocol.ts'
import { probeDouyinPublicRoom, readDouyinCompanionSnapshot } from './companion.ts'
import { WelcomeSpeechService } from './speech.ts'
import { asRecord, normalizeDouyinMessage } from './normalize.ts'
import { DouyinInputError, resolveDouyinRoom } from './room.ts'

/** 可替换外部边界供离线测试；生产只访问固定本机接收器和伴侣日志。 */
interface Dependencies {
  store: { read(): DouyinLiveConfig; write(config: DouyinLiveConfig): void }
  log(message: string): void
  socket?: (url: string) => WebSocket
  resolve?: typeof resolveDouyinRoom
  companionRead?: () => CompanionSnapshot
  companionProbe?: typeof probeDouyinPublicRoom
  speech?: WelcomeSpeechService
  retryMs?: number
  monitorIntervalMs?: number
}

const EMPTY_COMPANION: CompanionSnapshot = { installed: false, state: 'unknown', internalRoomId: '', publicRoomId: '', error: '' }
const EMPTY_CONFIG: DouyinLiveConfig = { roomInput: '', autoMonitor: false, welcomeSpeech: false }

/** Host 管理只读直播连接，并按需跟随本机直播伴侣的开播/停播状态。 */
export class DouyinLiveService {
  private readonly deps: Dependencies
  private readonly speech: WelcomeSpeechService
  private state: DouyinLiveSnapshot = { config: EMPTY_CONFIG, companion: EMPTY_COMPANION, connection: 'idle', upstreamReady: false, roomId: '', error: '', messages: [], received: 0 }
  private socket?: WebSocket
  private retry?: ReturnType<typeof setTimeout>
  private heartbeat?: ReturnType<typeof setInterval>
  private monitorTimer?: ReturnType<typeof setInterval>
  private resolving?: AbortController
  private generation = 0
  private attempt = 0
  private sequence = 0
  private wanted = false
  private autoOwned = false
  private autoConnecting = false
  private autoStartKey = ''
  private autoSuppressedKey = ''
  private seen = new Set<string>()
  private loaded = false
  private monitorBusy = false

  /** 读取配置但不自动打开 WebSocket；自动跟随由持久化开关控制。 */
  constructor(deps: Dependencies) {
    this.deps = deps
    this.speech = deps.speech ?? new WelcomeSpeechService()
    this.ensureLoaded()
    this.state.companion = this.readCompanion()
    this.monitorTimer = setInterval(() => { void this.monitorCompanion() }, deps.monitorIntervalMs ?? 5000)
    this.monitorTimer.unref()
    void this.monitorCompanion()
  }

  /** 返回副本，调用方不能修改 Host 的权威缓存。 */
  snapshot(): DouyinLiveSnapshot {
    this.ensureLoaded()
    return {
      ...this.state,
      config: { ...this.state.config },
      companion: { ...this.state.companion },
      messages: this.state.messages.map(message => ({ ...message })),
    }
  }

  /** 手动连接；成功后只记住公开房间输入，不改变自动跟随开关。 */
  async connect(roomInput: unknown): Promise<void> {
    this.autoOwned = false
    this.autoSuppressedKey = this.companionKey()
    await this.connectConfigured(roomInput, false)
  }

  /** 开关自动跟随；打开后立即检查一次当前伴侣状态。 */
  setAutoMonitor(enabled: boolean): void {
    this.ensureLoaded()
    this.state.config = { ...this.state.config, autoMonitor: enabled }
    this.deps.store.write(this.state.config)
    if (!enabled) {
      if (this.autoOwned) this.disconnectInternal()
      this.autoOwned = false
      this.autoConnecting = false
      this.autoStartKey = ''
      this.autoSuppressedKey = ''
      return
    }
    this.autoStartKey = ''
    this.autoSuppressedKey = ''
    void this.monitorCompanion()
  }

  /** 开关进场与点赞语音播报；默认关闭，避免首次升级时突然出声。 */
  setWelcomeSpeech(enabled: boolean): void {
    this.ensureLoaded()
    this.state.config = { ...this.state.config, welcomeSpeech: enabled }
    this.deps.store.write(this.state.config)
  }

  /** 手动停止；自动跟随会抑制当前这一场，下一次重新开播才会再次连接。 */
  disconnect(): void {
    this.autoOwned = false
    this.autoSuppressedKey = this.companionKey()
    this.disconnectInternal()
  }

  /** 清空展示缓存和计数；保留连接及自动监控状态。 */
  clear(): void {
    this.state.messages = []
    this.state.received = 0
    delete this.state.lastEventAt
  }

  /** 卸载时停止监控、连接和内存内容。 */
  dispose(): void {
    if (this.monitorTimer) clearInterval(this.monitorTimer)
    this.monitorTimer = undefined
    this.disconnectInternal()
    this.clear()
    this.seen.clear()
    this.speech.dispose()
  }

  private ensureLoaded(): void {
    if (this.loaded) return
    try { this.state.config = this.normalizeConfig(this.deps.store.read()) } catch { this.state.config = { ...EMPTY_CONFIG } }
    this.loaded = true
  }

  private normalizeConfig(config: DouyinLiveConfig): DouyinLiveConfig {
    return { roomInput: typeof config.roomInput === 'string' ? config.roomInput.slice(0, 2048) : '', autoMonitor: config.autoMonitor === true, welcomeSpeech: config.welcomeSpeech === true }
  }

  private readCompanion(): CompanionSnapshot {
    try { return this.deps.companionRead?.() ?? readDouyinCompanionSnapshot() } catch (error) {
      return { ...EMPTY_COMPANION, error: error instanceof Error ? error.message.slice(0, 200) : '无法读取直播伴侣状态。' }
    }
  }

  /** 伴侣日志作为开播事件，douyinLive 只读查询作为公开房间映射补充。 */
  private async monitorCompanion(): Promise<void> {
    if (this.monitorBusy) return
    this.monitorBusy = true
    try {
      this.ensureLoaded()
      const fromLog = this.readCompanion()
      let next = fromLog
      const publicRoom = this.state.config.roomInput
      if (publicRoom && this.state.config.autoMonitor) {
        const probe = await (this.deps.companionProbe ?? probeDouyinPublicRoom)(publicRoom)
        if (probe !== undefined) {
          next = { ...next, publicRoomId: probe.publicRoomId }
          if (next.state === 'live' && next.internalRoomId === '' && probe.internalRoomId !== '') next.internalRoomId = probe.internalRoomId
        }
      }
      this.state.companion = next
      if (next.state === 'live') {
        await this.followLiveIfNeeded(next)
      } else if (next.state === 'offline' && this.autoOwned) {
        this.disconnectInternal()
        this.autoOwned = false
        this.autoStartKey = ''
      }
    } finally { this.monitorBusy = false }
  }

  private companionKey(): string {
    const companion = this.state.companion
    if (companion.state !== 'live' || companion.internalRoomId === '') return ''
    return companion.internalRoomId + ':' + String(companion.updatedAt ?? '')
  }

  private async followLiveIfNeeded(companion: CompanionSnapshot): Promise<void> {
    if (!this.state.config.autoMonitor || this.autoConnecting) return
    const key = this.companionKey()
    if (key === '' || key === this.autoSuppressedKey || key === this.autoStartKey) return
    const roomInput = this.state.config.roomInput
    if (roomInput === '') {
      this.state.error = '已检测到直播伴侣开播，但还没有绑定公开直播间；请手动连接一次。'
      return
    }
    this.autoStartKey = key
    this.autoConnecting = true
    try { await this.connectConfigured(roomInput, true) }
    catch (error) { this.deps.log('抖音直播：自动跟随连接失败：' + (error instanceof Error ? error.message : String(error))) }
    finally { this.autoConnecting = false }
  }

  /** 连接准备成功后固定使用本机接收器，不允许外部输入控制主机或端口。 */
  private async connectConfigured(roomInput: unknown, autoOwned: boolean): Promise<void> {
    this.disconnectInternal()
    const generation = this.generation
    const controller = new AbortController()
    this.resolving = controller
    this.state.connection = 'connecting'
    try {
      const roomId = await (this.deps.resolve ?? resolveDouyinRoom)(roomInput, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]))
      if (generation !== this.generation) return
      this.state.config = { ...this.state.config, roomInput: roomId }
      this.deps.store.write(this.state.config)
      if (roomId !== this.state.roomId) { this.clear(); this.seen.clear() }
      this.state.roomId = roomId
      this.wanted = true
      this.autoOwned = autoOwned
      this.attempt = 0
      this.open(generation)
    } catch (error) {
      if (generation !== this.generation) return
      this.state.connection = 'error'
      this.state.error = error instanceof DouyinInputError ? error.message : autoOwned ? '已检测到开播，但自动连接公开直播间失败。' : '直播间解析或配置保存失败，请稍后重试或改填直播间号码。'
      this.deps.log(autoOwned ? '抖音直播：自动跟随连接准备失败' : '抖音直播：连接准备失败')
      if (error instanceof DouyinInputError) throw error
      throw new Error(this.state.error)
    } finally {
      if (generation === this.generation) this.resolving = undefined
    }
  }

  /** 内部停止不改变自动跟随抑制标记，用于切换房间、重连和卸载。 */
  private disconnectInternal(): void {
    this.generation += 1
    this.wanted = false
    this.resolving?.abort()
    this.resolving = undefined
    if (this.retry) clearTimeout(this.retry)
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.retry = undefined
    this.heartbeat = undefined
    const socket = this.socket
    this.socket = undefined
    socket?.terminate()
    this.state.connection = 'idle'
    this.state.upstreamReady = false
    delete this.state.roomOnline
    this.state.error = ''
  }

  /** 固定本机接收器，不允许 HTTP 参数控制 WS 主机、端口或认证头。 */
  private open(generation: number): void {
    if (!this.wanted || generation !== this.generation) return
    this.state.connection = this.attempt ? 'reconnecting' : 'connecting'
    const url = 'ws://127.0.0.1:1088/ws/' + this.state.roomId
    let socket: WebSocket
    try { socket = this.deps.socket?.(url) ?? new WebSocket(url, { handshakeTimeout: 8000, maxPayload: 1024 * 1024, followRedirects: false }) }
    catch { this.schedule(generation); return }
    this.socket = socket
    const current = (): boolean => this.socket === socket && generation === this.generation
    socket.on('open', () => {
      if (!current()) return
      this.state.connection = 'connected'
      this.state.error = ''
      this.deps.log('抖音直播：本地接收器已连接')
      let alive = true
      socket.on('pong', () => { alive = true })
      this.heartbeat = setInterval(() => {
        if (!current()) return
        if (!alive) { socket.terminate(); return }
        alive = false
        socket.ping()
      }, 30000)
      this.heartbeat.unref()
    })
    socket.on('message', (buffer) => {
      if (!current()) return
      let raw: unknown
      try { raw = JSON.parse(buffer.toString()) } catch { return }
      const data = asRecord(raw)
      if (data.type === 'system' && data.event === 'live_status') {
        if (typeof data.live === 'boolean') this.state.roomOnline = data.live
        else delete this.state.roomOnline
        if (data.code === 'ROOM_ONLINE' && data.valid === true && data.live === true) this.state.upstreamReady = true
        if (data.code === 'ROOM_ENDED' || data.valid === false || data.live === false) this.state.upstreamReady = false
      }
      if (data.type === 'system' && typeof data.upstream_ready === 'boolean') this.state.upstreamReady = data.upstream_ready
      const normalized = normalizeDouyinMessage(raw, this.sequence + 1)
      if (!normalized) return
      if (normalized.remoteId && this.seen.has(normalized.remoteId)) return
      if (normalized.remoteId) {
        this.seen.add(normalized.remoteId)
        if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value!)
      }
      if (normalized.message.type !== 'system') { this.state.upstreamReady = true; this.attempt = 0 }
      if (this.state.config.welcomeSpeech) {
        if (normalized.message.type === 'member') this.speech.announce(normalized.message.nickname, normalized.message.receivedAt)
        else if (normalized.message.type === 'like') this.speech.announceLike(normalized.message.nickname, normalized.message.receivedAt)
      }
      this.sequence += 1
      this.state.messages.push(normalized.message)
      if (this.state.messages.length > 500) this.state.messages.shift()
      this.state.received += 1
      this.state.lastEventAt = normalized.message.receivedAt
    })
    socket.on('error', () => { if (current()) this.state.error = '本地接收器连接异常，请确认 douyinLive 正在 1088 端口运行。' })
    socket.on('close', () => {
      if (!current()) return
      this.socket = undefined
      if (this.heartbeat) clearInterval(this.heartbeat)
      this.heartbeat = undefined
      this.schedule(generation)
    })
  }

  /** 本地断线采用有上限的指数退避；不开多个并行连接。 */
  private schedule(generation: number): void {
    if (!this.wanted || generation !== this.generation || this.retry) return
    this.state.connection = 'reconnecting'
    this.state.upstreamReady = false
    delete this.state.roomOnline
    this.state.error = '本地接收器已断开，正在重试；请确认 douyinLive 正在运行。'
    this.deps.log('抖音直播：本地接收器断线，安排重试')
    const delay = Math.min(30000, (this.deps.retryMs ?? 1000) * 2 ** Math.min(this.attempt++, 5))
    this.retry = setTimeout(() => { this.retry = undefined; this.open(generation) }, delay)
    this.retry.unref()
  }
}
