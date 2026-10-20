// 企微桥能力入口（与 feishu/activate.ts 同级能力）。
//
// 职责：
// - 读配置 → 建长连接客户端 → 建会话桥 → 挂 DSH 会话事件监听 → 启动连接。
// - 对外暴露只读 status（不含 Secret）与 dispose，由主入口统一管理生命周期。
//
// 生命周期约定：
// - apply 只做同步注册，真正的配置读取与连接建立是异步的；失败只记日志并置 error，
//   绝不抛到宿主启动流程里——桥挂了不能让整个天工造梦起不来。

import { WecomBridge } from './bridge.mjs'
import { WecomClient } from './client.mjs'
import { loadConfig, redactConfig } from './store.mjs'

/** 企微桥需要宿主提供的最小服务集合。 */
export const inject = ['agents', 'agentDefaultModel', 'agentPresets']

/** 空闲会话回收周期（10 分钟扫一次）。 */
const EVICT_INTERVAL_MS = 10 * 60 * 1000

/**
 * 模块级「当前实例的关闭钩子」。
 * 为什么需要它：企微同一机器人只允许一条长连接，新连接会踢掉旧连接；
 * 若热重建时新旧实例并存，两个实例会互相踢、无限重连。因此新实例在
 * 建立连接前必须先把旧实例彻底关掉（等它的 WebSocket 真正 close）。
 */
let activeDispose = null

/**
 * 创建并启动企微桥。
 * @param {any} ctx DSH 插件上下文
 * @param {object} [config] 宿主配置（enabled / botId / secret / cwd / agentPreset / storePath）
 * @returns {{ ready: Promise<void>, status(): object, dispose(): Promise<void> }}
 */
export function createWecomCapability(ctx, config = {}) {
  const info = (message) => {
    try { ctx?.logger?.info?.('[dsh-wecom]', message) } catch {}
    try { console.info('[dsh-wecom]', message) } catch {}
  }
  const warn = (message) => {
    try { ctx?.logger?.warn?.('[dsh-wecom]', message) } catch {}
    try { console.warn('[dsh-wecom]', message) } catch {}
  }

  /** @type {WecomClient|null} */
  let client = null
  /** @type {WecomBridge|null} */
  let bridge = null
  let resolved = null
  let closed = false
  let lastError = ''
  let connectedAt = 0
  const disposers = []
  let evictTimer = null

  // 宿主配置只认显式开关；未启用时连配置都不读，避免无谓的磁盘访问。
  const hostEnabled = config.enabled === true

  const ready = (async () => {
    if (!hostEnabled) {
      info('未启用（host config enabled=false），跳过启动')
      return
    }
    // 先等旧实例关干净，避免同一机器人双连接互踢。
    if (typeof activeDispose === 'function') {
      try { await activeDispose() } catch { /* 旧实例关闭失败不阻断新实例 */ }
      activeDispose = null
    }
    try {
      resolved = await loadConfig({ path: config.storePath, overrides: config })
      if (!resolved.enabled) {
        info('配置文件 enabled=false，跳过启动')
        return
      }
      if (resolved.botId === '' || resolved.secret === '') {
        lastError = 'BotID/Secret 未配置'
        warn('BotID/Secret 未配置，长连接不会建立')
        return
      }
      client = new WecomClient({
        botId: resolved.botId,
        secret: resolved.secret,
        logger: { info, warn, error: warn },
        onMessage: (body, reqId) => {
          // 白名单：配置了 allowUserIds 就只认列表内的成员，其余静默丢弃并留日志。
          if (resolved.allowUserIds.length > 0) {
            const userid = String(body?.from?.userid ?? '')
            if (!resolved.allowUserIds.includes(userid)) {
              warn('消息来自非白名单成员，已丢弃：' + (userid === '' ? '(空)' : userid))
              return
            }
          }
          void bridge?.handleMessage(body, reqId).catch((error) => {
            warn('处理消息失败：' + (error instanceof Error ? error.message : String(error)))
          })
        },
        onEvent: (body, reqId) => {
          void bridge?.handleEvent(body, reqId).catch((error) => {
            warn('处理事件失败：' + (error instanceof Error ? error.message : String(error)))
          })
        },
      })
      bridge = new WecomBridge({ ctx, client, config: resolved, warn, info })
      try {
        disposers.push(ctx.on('session/event', (session, event) => bridge?.observeSessionEvent(session, event)))
      } catch (error) {
        warn('session/event 监听注册失败：' + (error instanceof Error ? error.message : String(error)))
      }
      evictTimer = setInterval(() => {
        try { bridge?.evictIdle() } catch { /* 回收失败不影响主流程 */ }
      }, EVICT_INTERVAL_MS)
      if (typeof evictTimer?.unref === 'function') evictTimer.unref()

      await client.start()
      connectedAt = Date.now()
      activeDispose = dispose
      info('企微长连接已就绪')
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      warn('启动失败：' + lastError)
    }
  })()

  /** 只读状态：Secret 永远不回，BotID 只回前 6 位。 */
  const status = () => ({
    enabled: hostEnabled,
    configured: resolved !== null && resolved.botId !== '' && resolved.secret !== '',
    connected: client?.status?.().connected === true,
    connectedAt,
    lastError: lastError !== '' ? lastError : (client?.status?.().lastError ?? ''),
    client: client?.status?.() ?? null,
    conversations: bridge?.status?.().conversations ?? [],
    config: resolved === null ? null : redactConfig(resolved),
  })

  /** 关闭：先停连接再释放会话，顺序反过来会让在途回复打空。 */
  const dispose = async () => {
    if (closed) return
    closed = true
    if (evictTimer !== null) {
      clearInterval(evictTimer)
      evictTimer = null
    }
    for (const disposer of disposers) {
      try { disposer?.() } catch { /* 单点失败不阻断 */ }
    }
    try { await client?.stop?.() } catch (error) {
      warn('停止长连接失败：' + (error instanceof Error ? error.message : String(error)))
    }
    try { await bridge?.dispose?.() } catch (error) {
      warn('释放会话失败：' + (error instanceof Error ? error.message : String(error)))
    }
    if (activeDispose === dispose) activeDispose = null
    info('已停止')
  }

  return { ready, status, dispose }
}
