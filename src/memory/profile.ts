/**
 * 用户身份卡 —— 插件分发多用户场景下的「常驻用户画像」层（0.17.10）。
 *
 * 背景（辉哥定）：插件要给不同的人用，召回式记忆覆盖不了「每轮必须知道」的
 * 身份与硬偏好（称呼、语言、排版习惯等），需要一张常驻身份卡注入每轮系统提示。
 *
 * - 存储：store.db settings 域 memory.profile 单例，随插件配置走（不依赖外部记忆插件）；
 * - 注入：仿 ConstraintInjectionService（agent/created + roots 采纳 + systemPrompt.section），
 *   text 为动态函数每次装配求值——面板保存后即时生效，无需重启；
 * - 渲染规则：开关关闭 / 称呼身份习惯全空 / 超过 maxChars 截断；空段自动跳过。
 */

/** 用户身份卡（settings 域 memory.profile 单例）。 */
export interface MemoryUserProfile {
  /** 常驻注入总开关；false 时不注入。 */
  enabled: boolean
  /** 称呼（如「辉哥」）；空串视为未配置。 */
  alias: string
  /** 身份简介（是谁、在做什么）。 */
  identity: string
  /** 习惯与硬偏好，逐条注入。 */
  habits: string[]
  /** 注入文本字符上限（含标题行），超出截断。 */
  maxChars: number
}

/** 默认身份卡：全空（其他用户装上从零填写，不预置任何人的私人信息）。 */
export const DEFAULT_USER_PROFILE: MemoryUserProfile = { enabled: true, alias: '', identity: '', habits: [], maxChars: 800 }

/** agent 作用域节名（同 constraints 的命名规范）。 */
export const USER_PROFILE_SECTION_NAME = 'plugin:dsh-devforge:user-profile'

/** 节顺序：排在项目约束(80)之前——先知道「为谁服务」再看「怎么干活」。 */
export const USER_PROFILE_SECTION_ORDER = 50

/** 防御式规整字符串字段：非字符串/超长截断/去首尾空白。 */
function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/gu, ' ').trim().slice(0, max)
}

/** 规整身份卡（部分保存不炸；字段夹紧；habits 去重去空）。 */
export function normalizeUserProfile(raw: unknown, current: MemoryUserProfile): MemoryUserProfile {
  if (raw === null || typeof raw !== 'object') return current
  const body = raw as Record<string, unknown>
  const habitsRaw = Array.isArray(body.habits) ? body.habits : current.habits
  const habits: string[] = []
  for (const item of habitsRaw) {
    if (typeof item !== 'string') continue
    const text = item.trim().slice(0, 200)
    if (text === '' || habits.includes(text)) continue
    habits.push(text)
    if (habits.length >= 20) break
  }
  return {
    enabled: typeof body.enabled === 'boolean' ? body.enabled : current.enabled,
    alias: cleanText(body.alias, 40),
    identity: cleanText(body.identity, 500),
    habits,
    maxChars: typeof body.maxChars === 'number' && body.maxChars >= 300 ? Math.min(2000, Math.floor(body.maxChars)) : current.maxChars,
  }
}

/** 渲染常驻注入文本；关闭或全空返回空串（不注入空块）。 */
export function renderUserProfileText(profile: MemoryUserProfile): string {
  if (!profile.enabled) return ''
  if (profile.alias === '' && profile.identity === '' && profile.habits.length === 0) return ''
  const lines: string[] = ['【用户身份卡（dsh-devforge 常驻注入，必须遵守）】']
  if (profile.alias !== '') lines.push('称呼：' + profile.alias + '（每次回答必须带此称呼）')
  if (profile.identity !== '') lines.push('身份：' + profile.identity)
  if (profile.habits.length > 0) {
    lines.push('习惯与偏好：')
    profile.habits.forEach((habit, index) => lines.push(String(index + 1) + '. ' + habit))
  }
  let text = lines.join('\n')
  if (text.length > profile.maxChars) text = text.slice(0, profile.maxChars)
  return text
}

/** 会话记忆层渲染接口依赖（注入服务只依赖取卡函数，便于测试）。 */
export type GetUserProfile = () => MemoryUserProfile

/**
 * 用户身份卡注入服务：为宿主内全部代理挂常驻身份节。
 * 与 ConstraintInjectionService 同款宿主官方 SDK 能力；无升级逻辑，纯常驻。
 */
export class UserProfileInjectionService {
  private readonly installed = new Set<string>()
  private readonly disposers: Array<() => void> = []
  private getProfile: GetUserProfile = () => DEFAULT_USER_PROFILE

  /** 启动：挂 agent/created、采纳存量根代理、监听 agent/disposed 清理。 */
  start(ctx: unknown, getProfile: GetUserProfile): void {
    this.getProfile = getProfile
    const holder = ctx as { on?: (event: string, listener: (payload: unknown) => void) => unknown; agents?: { roots?: () => unknown } } | null
    if (holder === null || typeof holder !== 'object') return
    try {
      const offCreated = holder.on?.('agent/created', (payload: unknown) => {
        const agent = (payload as { agent?: unknown } | null)?.agent
        try { this.install(agent) } catch { /* 单代理安装失败不影响其他代理 */ }
      })
      if (typeof offCreated === 'function') this.disposers.push(offCreated as () => void)
    } catch { /* 事件不可用时降级为仅存量采纳 */ }
    try {
      const roots = holder.agents?.roots?.()
      if (Array.isArray(roots)) for (const agent of roots) { try { this.install(agent) } catch { /* 跳过采纳失败的代理 */ } }
    } catch { /* 注册表不可用时仅靠 agent/created */ }
    try {
      const offDisposed = holder.on?.('agent/disposed', (payload: unknown) => {
        const agent = (payload as { agent?: unknown } | null)?.agent
        if (agent && typeof agent === 'object' && 'id' in (agent as Record<string, unknown>)) this.installed.delete(String((agent as { id: unknown }).id))
      })
      if (typeof offDisposed === 'function') this.disposers.push(offDisposed as () => void)
    } catch { /* 清理监听失败不影响主流程 */ }
  }

  /** 为单个代理安装身份节（同一代理只装一次；text 动态求值，改卡即时生效）。 */
  install(agent: unknown): void {
    if (agent === null || typeof agent !== 'object') return
    const record = agent as { id?: unknown; ctx?: unknown }
    const id = typeof record.id === 'string' || typeof record.id === 'number' ? String(record.id) : undefined
    if (id === undefined || this.installed.has(id)) return
    // 无 id 的代理也尝试安装（不进去重表），保证兼容宿主不同形状
    if (id !== '') this.installed.add(id)
    const prompt = resolveSystemPrompt(record.ctx)
    if (prompt?.section === undefined) return
    try {
      prompt.section({
        name: USER_PROFILE_SECTION_NAME,
        order: USER_PROFILE_SECTION_ORDER,
        text: () => renderUserProfileText(this.getProfile()),
      })
    } catch { /* 同名节冲突等场景：身份卡缺失但不影响代理运行 */ }
  }

  /** 卸载全部监听并清空去重表（节由 agent 作用域自动回收）。 */
  dispose(): void {
    for (const dispose of this.disposers) { try { dispose() } catch { /* 忽略 */ } }
    this.disposers.length = 0
    this.installed.clear()
  }
}

/** 从宿主 SDK 防御式解析 agent 作用域的 systemPrompt 服务（复用 constraints 的实现约定）。 */
function resolveSystemPrompt(agentCtx: unknown): { section?(input: { name: string; order: number; text: string | (() => string) }): () => void } | undefined {
  if (agentCtx === null || typeof agentCtx !== 'object') return undefined
  const holder = agentCtx as { systemPrompt?: unknown; get?: (name: string) => unknown }
  const direct = holder.systemPrompt
  if (direct && typeof direct === 'object') return direct as { section?(input: { name: string; order: number; text: string | (() => string) }): () => void }
  if (typeof holder.get === 'function') {
    try {
      const viaGet = holder.get('systemPrompt')
      if (viaGet && typeof viaGet === 'object') return viaGet as { section?(input: { name: string; order: number; text: string | (() => string) }): () => void }
    } catch { /* 服务未就绪时安静跳过 */ }
  }
  return undefined
}
