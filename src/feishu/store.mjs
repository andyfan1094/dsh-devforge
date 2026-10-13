// Vendored from dsh-feishu 0.2.2 (MIT, andyfan1094/dsh-feishu).
// dsh-devforge consolidation modification: module folded into dsh-devforge;
// runtime behavior preserved. See THIRD_PARTY_NOTICES.md.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

const DEFAULTS = Object.freeze({
  enabled: true,
  appId: '',
  appSecret: '',
  domain: 'https://open.feishu.cn',
  cwd: process.cwd(),
  allowUsers: [],
  ack: true,
  ackReaction: 'OK',
  provider: '',
  model: '',
  reasoningEffort: '',
  agentPreset: 'cordis',
  mediaDir: '',
  groupMode: 'all',
  welcomeText: '',
  chatCwds: {},
  asrBaseUrl: '',
  asrApiKey: '',
  asrModel: '',
  syncCatchUp: true,
  notifyOnComplete: false,
  notifyChatId: '',
})

export function storePath() {
  return join(homedir(), '.dsh', 'dsh-feishu.json')
}

function normalizeRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    const id = String(key).trim()
    const dir = String(item ?? '').trim()
    if (id !== '' && dir !== '') out[id] = dir
  }
  return out
}

function normalize(value = {}, fallback = DEFAULTS) {
  const users = Array.isArray(value.allowUsers)
    ? value.allowUsers.map((item) => String(item).trim()).filter(Boolean)
    : fallback.allowUsers
  return {
    enabled: value.enabled === undefined ? fallback.enabled : value.enabled !== false,
    appId: String(value.appId ?? fallback.appId).trim(),
    appSecret: String(value.appSecret ?? fallback.appSecret),
    domain: String(value.domain ?? fallback.domain).trim().replace(/\/+$/, '') || DEFAULTS.domain,
    cwd: String(value.cwd ?? fallback.cwd).trim() || process.cwd(),
    allowUsers: [...new Set(users)],
    ack: value.ack === undefined ? fallback.ack : value.ack !== false,
    ackReaction: String(value.ackReaction ?? fallback.ackReaction).trim() || 'OK',
    provider: String(value.provider ?? fallback.provider).trim(),
    model: String(value.model ?? fallback.model).trim(),
    reasoningEffort: String(value.reasoningEffort ?? fallback.reasoningEffort).trim(),
    agentPreset: String(value.agentPreset ?? fallback.agentPreset).trim() || 'cordis',
    mediaDir: String(value.mediaDir ?? fallback.mediaDir).trim(),
    groupMode: String(value.groupMode ?? fallback.groupMode).trim() === 'mention' ? 'mention' : 'all',
    welcomeText: String(value.welcomeText ?? fallback.welcomeText),
    chatCwds: normalizeRecord(value.chatCwds ?? fallback.chatCwds),
    asrBaseUrl: String(value.asrBaseUrl ?? fallback.asrBaseUrl).trim(),
    asrApiKey: String(value.asrApiKey ?? fallback.asrApiKey).trim(),
    asrModel: String(value.asrModel ?? fallback.asrModel).trim(),
    syncCatchUp: value.syncCatchUp === undefined ? fallback.syncCatchUp : value.syncCatchUp !== false,
    notifyOnComplete: value.notifyOnComplete === undefined ? fallback.notifyOnComplete : value.notifyOnComplete === true,
    notifyChatId: String(value.notifyChatId ?? fallback.notifyChatId).trim(),
  }
}

export class FeishuStore {
  constructor(bootstrap = {}, path = storePath()) {
    this.path = path
    this.bootstrap = normalize(bootstrap)
    this.state = this.readState()
    // 会话代际与插件侧归档号：state 原样持久化（save 不走 config 的 normalize），
    // 这里统一保证字段存在，避免调用方到处判空。
    if (this.state.generations === null || typeof this.state.generations !== 'object' || Array.isArray(this.state.generations)) this.state.generations = {}
    if (this.state.archivedExtra === null || typeof this.state.archivedExtra !== 'object' || Array.isArray(this.state.archivedExtra)) this.state.archivedExtra = {}
    if (!existsSync(this.path) && (this.bootstrap.appId || this.bootstrap.appSecret)) this.save(this.bootstrap)
  }

  /**
   * 读取某条飞书聊天的会话代际（缺省 1 = 初始代）。
   * 代际用于「会话被占用 → fork 后继会话」的场景：新号 = 原身份 + ':gen-N'，
   * 重启后用同一个持久化代际重算出同一个号，resume 照常命中。
   */
  getChatGeneration(chatId) {
    const key = String(chatId ?? '').trim()
    const value = Number(this.state.generations?.[key])
    return Number.isSafeInteger(value) && value >= 1 ? value : 1
  }

  /** 持久化某条飞书聊天的会话代际（正整数；写盘失败静默——下次冷启动按旧代际重算）。 */
  setChatGeneration(chatId, generation) {
    const key = String(chatId ?? '').trim()
    const value = Math.max(1, Math.floor(Number(generation) || 1))
    if (key === '') return
    // 代际单调递增：fork 接管与 /new 都只会 +1。误传更小值时拒绝回退——
    // 回退会把身份算回可能已归档的旧号，resume 撞归档号等于悄悄回到旧会话。
    const current = Number(this.state.generations?.[key])
    if (Number.isSafeInteger(current) && current >= value) return
    this.state.generations[key] = value
    try { this.save(this.get()) } catch {}
  }

  /**
   * 归档一个不再参与 resume 的会话号（占用 fork 的旧号、/new 换掉的旧号）。
   * 每条聊天封顶保留 8 个，防止 state 无限膨胀；去重写入。
   */
  archiveSessionId(chatId, sessionId) {
    const key = String(chatId ?? '').trim()
    const id = String(sessionId ?? '').trim()
    if (key === '' || id === '') return
    const list = Array.isArray(this.state.archivedExtra[key]) ? this.state.archivedExtra[key].map(String) : []
    if (!list.includes(id)) list.push(id)
    this.state.archivedExtra[key] = list.slice(-8)
    try { this.save(this.get()) } catch {}
  }

  /** 某条聊天被插件归档的会话号（只读副本；与宿主 workspaceRegistry 归档语义互补）。 */
  extraArchivedIds(chatId) {
    const list = this.state.archivedExtra?.[String(chatId ?? '').trim()]
    return Array.isArray(list) ? [...list] : []
  }

  readState() {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8'))
      return parsed?.state ?? {}
    } catch {
      return {}
    }
  }

  getState() {
    return JSON.parse(JSON.stringify(this.state ?? {}))
  }

  setState(patch = {}) {
    if (patch.chats !== null && typeof patch.chats === 'object') {
      const chats = { ...(this.state?.chats ?? {}) }
      for (const [chatId, cursor] of Object.entries(patch.chats)) {
        const prev = chats[chatId] ?? {}
        chats[chatId] = {
          lastTs: Math.max(Number(prev.lastTs ?? 0), Number(cursor?.lastTs ?? 0)),
          seen: [...new Set([...(prev.seen ?? []), ...(Array.isArray(cursor?.seen) ? cursor.seen : [])])].slice(-200),
        }
      }
      this.state = { ...(this.state ?? {}), chats }
      try { this.save(this.get()) } catch {}
    }
  }

  get() {
    if (!existsSync(this.path)) return { ...this.bootstrap, allowUsers: [...this.bootstrap.allowUsers] }
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8'))
      return normalize(parsed?.config ?? parsed, this.bootstrap)
    } catch {
      return { ...this.bootstrap, allowUsers: [...this.bootstrap.allowUsers] }
    }
  }

  update(patch = {}) {
    const current = this.get()
    const nextPatch = { ...patch }
    if (nextPatch.appSecret === undefined || String(nextPatch.appSecret) === '') delete nextPatch.appSecret
    const next = normalize(nextPatch, current)
    this.save(next)
    return next
  }

  panel() {
    const config = this.get()
    return {
      enabled: config.enabled,
      appId: config.appId,
      appSecretConfigured: config.appSecret.length > 0,
      appSecretMask: config.appSecret.length > 0 ? '已配置 ····' + config.appSecret.slice(-4) : '未配置',
      domain: config.domain,
      cwd: config.cwd,
      allowUsers: [...config.allowUsers],
      ack: config.ack,
      ackReaction: config.ackReaction,
      provider: config.provider,
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      agentPreset: config.agentPreset,
      groupMode: config.groupMode,
      welcomeText: config.welcomeText,
      chatCwds: { ...config.chatCwds },
      asrBaseUrlConfigured: config.asrBaseUrl !== '',
      asrApiKeyConfigured: config.asrApiKey !== '',
      asrModel: config.asrModel,
      syncCatchUp: config.syncCatchUp,
      notifyOnComplete: config.notifyOnComplete,
      notifyChatId: config.notifyChatId,
    }
  }

  save(config) {
    const dir = dirname(this.path)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const tmp = this.path + '.tmp'
    writeFileSync(tmp, JSON.stringify({ version: 1, config, state: this.state ?? {} }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
    try { chmodSync(tmp, 0o600) } catch {}
    renameSync(tmp, this.path)
  }
}
