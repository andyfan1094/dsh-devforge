/**
 * 项目约束上下文注入 —— 三层渐进式注入（0.11.0）。
 *
 * 需求（辉哥定）：涉及开发就把项目约束送进模型上下文，不依赖模型自觉读文档。
 *   第一层 常驻保底：所有会话无条件注入红线摘要 + 路由指令；
 *   第二层 仓库信号：会话 cwd 命中开发仓库路径清单 → 从第一轮起注入全文；
 *   第三层 行为信号：会话事件流出现写文件/bash/git 等开发工具动作 → 升级注入全文。
 * 注入级别只升不降（summary → full）。
 *
 * 机制全部采用宿主官方 SDK 实证能力（与 dsh-mnemon 生产同款）：
 *   ctx.on('agent/created') + ctx.agents.roots() 采纳全部代理；
 *   agent 作用域 systemPrompt.section({ text: 动态函数 }) 每次装配求值；
 *   agent.session.events 扫描工具调用（防御式读取，形状未知时优雅降级为仅摘要层）。
 */

/** 注入级别：常驻摘要 / 约束全文。 */
export type ConstraintLevel = 'summary' | 'full'

/** 约束注入配置。 */
export interface ConstraintsConfig {
  /** 总开关；false 时文本函数返回空串（已注册的节即时失效）。 */
  enabled: boolean
  /** 开发仓库路径清单：会话 cwd 命中任一前缀即注入全文。 */
  fullTextPaths: string[]
}

/** 默认开发仓库路径（辉哥主工作区，覆盖全部子项目）。 */
export const CONSTRAINTS_DEFAULT_PATHS = ['/Users/andyfan/Documents/ds']

/** 第一层：常驻保底摘要（所有会话可见）。 */
export const CONSTRAINT_SUMMARY_TEXT = [
  '【项目约束摘要（dsh-devforge 注入，必须遵守）】',
  '1. 插件/服务改动交付：源仓库测试通过 → 中文提交推远端 → 安装 → 暂存实例人工验收 → 用户明确确认后才允许重启生产。',
  '2. 生产实例不是试验田；devforge_restart 仅在用户明确要求后执行。',
  '3. 暂存验证必须用隔离 HOME 暂存实例（详见全文），禁止与生产共用 HOME。',
  '4. 暂存 overlay 必须禁桌面宠物与飞书桥（防双弹窗、防双连抢事件）。',
  '5. Git 提交说明用中文，只提交本次变更；未经用户明确要求禁止 push。',
  '6. 项目文档一律使用中文。',
  '凡涉及开发、构建、测试、交付、部署，必须先通过 devforge_standards 读取对应规范，并按 docs/插件暂存环境测试约束.md 的完整流程执行（该约束在涉及开发时会自动展开为全文注入）。',
].join('\n')

/** 第二/三层：约束全文（命中开发仓库或检测到开发动作后注入）。 */
export const CONSTRAINT_FULL_TEXT = [
  '【项目约束全文（dsh-devforge 注入，本会话涉及开发，必须严格遵守）】',
  '',
  '一、交付红线',
  '1. 交付流程必须完整：源仓库测试通过 → 中文提交推远端 → 安装到 profile → 起暂存实例人工过目 → 用户明确确认 → 才允许重启生产 → 关停暂存实例。',
  '2. 禁止跳过暂存验收直接重启生产；devforge_restart 只能在用户明确要求后执行。',
  '3. 暂存实例必须独立 HOME；禁止与生产共用 HOME 直接 --patch（loader 只向插件传 schema 内字段，配置不生效且飞书桥仍连生产凭据）。',
  '4. 暂存 overlay 必须显式禁用桌面宠物（防双弹窗）和飞书桥 feishu.enabled=false（同 appId 双 WSClient 会分流事件，铁律）。',
  '5. 暂存固定 3081 端口，启动前检查占用。',
  '6. 飞书卡片效果预览用一次性 node 脚本 REST 直发预览卡，不依赖暂存实例。',
  '',
  '二、暂存实例标准做法（0.7.7 验证、0.10.0 复验）',
  '一次性准备：mkdir -p ~/.dsh-staging/.dsh && ln -s ~/.dsh/profiles ~/.dsh-staging/.dsh/profiles && ln -s ~/.dsh/bin ~/.dsh-staging/.dsh/bin；overlay 放 ~/.dsh/staging.patch.yml（禁 web-ui-pet + devforge feishu.enabled=false）。',
  '启动：HOME=/Users/andyfan/.dsh-staging DSH_HOME=/Users/andyfan/.dsh-staging/.dsh dsh --profile web --patch /Users/andyfan/.dsh/staging.patch.yml --port 3081 --no-open',
  "验收：curl -s --noproxy '*' http://127.0.0.1:3081/api/dsh-devforge/meta 核对版本；浏览器打开 3081 人工过目（暂存 GUI 无生产模型配置属正常）。",
  '收尾：用户确认后重启生产，关停暂存实例。',
  '',
  '三、Git 与文档纪律',
  '- 提交说明使用中文，说明类型与实际变更；只暂存本次任务文件，不带无关改动、日志、私有配置或凭据。',
  '- 验证失败不强行提交；除非用户明确要求，禁止 push、建远端分支、标签或 PR。',
  '- 项目文档统一中文，不得使用英文。',
  '',
  '四、规范库',
  '- 写代码前先查 devforge_standards 对应规范；服务生成走 devforge_jobs（模板默认挂 v1/common.zh、v1/api.zh 等）。',
  '- 完整约束文档：dsh-devforge 仓库 docs/插件暂存环境测试约束.md（提交 e364977 起生效）。',
].join('\n')

/** 开发动作工具名（小写精确匹配）。 */
const DEV_TOOL_EXACT = new Set([
  'write', 'edit', 'multiedit', 'multi_edit', 'apply_patch', 'applypatch', 'notebook_edit', 'bash', 'shell', 'terminal', 'exec', 'str_replace',
])

/**
 * 插件系开发工具前缀（github_、cnb_、ssh_、winrm_ 系工具的提交、推送、执行、上传、克隆）。
 * 注意：注释里不能出现「星号斜杠」序列，否则 JSDoc 会被提前终止（0.10.x 教训）。
 */
const DEV_TOOL_PREFIXES = ['github_', 'cnb_', 'ssh_', 'winrm_']
/** 前缀命中但纯只读的工具不算开发动作。 */
const DEV_TOOL_PREFIX_SKIP = new Set(['github_auth_list', 'github_auth_test', 'github_repo_list', 'github_status', 'cnb_auth_list', 'cnb_auth_test', 'cnb_repo_list', 'cnb_status', 'ssh_list', 'ssh_tunnel', 'winrm_list'])

/** 规整路径：去尾部斜杠；空串返回 undefined。 */
function normalizePath(value: string): string | undefined {
  const trimmed = value.trim().replace(/\/+$/, '')
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * 判定 cwd 是否命中开发仓库路径清单（前缀匹配）。
 * cwd 或路径无法规整时返回 false；路径 '/' 视为命中任意绝对 cwd。
 */
export function matchesDevPath(cwd: string | undefined, paths: readonly string[]): boolean {
  const target = normalizePath(cwd ?? '')
  if (!target) return false
  for (const raw of paths) {
    // 纯斜杠（/、///）视为根路径：normalizePath 会把它规整成空串，
    // 必须先于 normalizePath 特判，否则「根路径命中一切」永不生效（0.11.0 测试抓到的死分支）。
    const trimmed = raw.trim()
    if (/^\/+$/u.test(trimmed)) {
      if (target.startsWith('/')) return true
      continue
    }
    const base = normalizePath(raw)
    if (!base) continue
    if (target === base || target.startsWith(base + '/')) return true
  }
  return false
}

/** 从 session 防御式解析 cwd（session.cwd 或 session.meta.cwd，须为绝对路径）。 */
export function resolveAgentCwd(session: unknown): string | undefined {
  if (session === null || typeof session !== 'object') return undefined
  const record = session as { cwd?: unknown; meta?: { cwd?: unknown } }
  for (const candidate of [record.cwd, record.meta?.cwd]) {
    if (typeof candidate === 'string' && candidate.startsWith('/')) return candidate
  }
  return undefined
}

/** 防御式读取 session 事件列表（数组或返回数组的访问器）。 */
function readEvents(session: unknown): readonly unknown[] {
  if (session === null || typeof session !== 'object') return []
  const events = (session as { events?: unknown }).events
  if (Array.isArray(events)) return events
  if (typeof events === 'function') {
    try {
      const resolved = (events as () => unknown)()
      if (Array.isArray(resolved)) return resolved
    } catch { /* 形状未知时安静降级 */ }
  }
  return []
}

/**
 * 从事件列表提取候选工具名：只认序列化 JSON 里 name/toolName/tool_name 字段的值，
 * 不匹配自由文本，避免用户消息里出现"编辑/write"等词造成误升级。
 */
export function collectToolNames(events: readonly unknown[], limit = 400, maxEventChars = 4000): Set<string> {
  const names = new Set<string>()
  const window = events.length > limit ? events.slice(events.length - limit) : events
  const pattern = /"(?:toolName|tool_name|name)"\s*:\s*"([\w.:-]+)"/g
  for (const event of window) {
    let serialized: string
    try { serialized = JSON.stringify(event) ?? '' } catch { continue }
    if (serialized.length > maxEventChars) serialized = serialized.slice(0, maxEventChars)
    for (const match of serialized.matchAll(pattern)) names.add(match[1]!.toLowerCase())
  }
  return names
}

/** 工具名集合是否含开发动作信号。 */
export function hasDevToolSignal(names: Iterable<string>): boolean {
  for (const raw of names) {
    const name = raw.toLowerCase()
    if (DEV_TOOL_EXACT.has(name)) return true
    if (DEV_TOOL_PREFIX_SKIP.has(name)) continue
    if (DEV_TOOL_PREFIXES.some((prefix) => name.startsWith(prefix))) {
      if (/_(commit|push|clone|exec|upload)$/.test(name)) return true
    }
  }
  return false
}

/** 事件列表是否含开发动作信号（便捷封装）。 */
export function eventsHaveDevSignal(events: readonly unknown[]): boolean {
  return hasDevToolSignal(collectToolNames(events))
}

/** 按当前级别与开关渲染注入文本。 */
export function renderConstraintText(level: ConstraintLevel, enabled: boolean): string {
  if (!enabled) return ''
  return level === 'full' ? CONSTRAINT_FULL_TEXT : CONSTRAINT_SUMMARY_TEXT
}

// ------------------------------------------------ 项目卡与产出公约注入（0.19.0）

/** 注入数据源（由 index.ts 组装，均带缓存；未提供时对应块不注入）。 */
export interface InjectionDataSources {
  /** 登记项目清单（多端语义已在 store 层处理）。 */
  getProjects?: () => import('./projects/protocol.ts').ProjectEntry[]
  /** 产出公约摘要文本（enabled=false 返回空串）。 */
  getConventionText?: () => string
}

/**
 * 按会话 cwd 匹配登记项目：cwd 等于项目本机路径或其子路径即命中；
 * machinePaths 全部映射参与匹配（跨机后旧映射同样能命中）。
 * 返回命中的第一个项目（无命中返回 undefined）。
 */
export function matchProjectByCwd(cwd: string | undefined, entries: readonly import('./projects/protocol.ts').ProjectEntry[]): import('./projects/protocol.ts').ProjectEntry | undefined {
  const target = normalizePath(cwd ?? '')
  if (target === undefined) return undefined
  for (const entry of entries) {
    const roots = [entry.path, ...Object.values(entry.machinePaths ?? {})]
    for (const raw of roots) {
      const base = normalizePath(raw ?? '')
      if (base === undefined) continue
      if (target === base || target.startsWith(base + '/')) return entry
    }
  }
  return undefined
}

/** 渲染当前项目卡（未登记描述等字段留空省略）。 */
export function renderProjectCard(entry: import('./projects/protocol.ts').ProjectEntry): string {
  const lines = [
    '【当前项目（dsh-devforge 注入）】',
    '- 项目：' + entry.name,
  ]
  if (entry.description.trim() !== '') lines.push('- 描述：' + entry.description)
  if (entry.repoUrl !== '') {
    lines.push('- 仓库：' + entry.repoKind + ' ' + entry.repoUrl + (entry.repoBranch !== '' ? ' · ' + entry.repoBranch : ''))
  }
  if (entry.siteUrl.trim() !== '') lines.push('- 线上地址：' + entry.siteUrl)
  if (entry.deployTargets.length > 0) {
    lines.push('- 发布服务器：' + entry.deployTargets.map((target) => target.transport + ':' + target.alias).join('、'))
  }
  lines.push('- 本机路径：' + entry.path)
  if (entry.pathExists === false) lines.push('- ⚠️ 本机路径失效：可能从其他电脑同步而来，请向用户确认本机实际路径（可重定位）。')
  return lines.join('\n')
}

/** 节名（agent 作用域内唯一；同名重复注册会抛错，卸旧后再挂新）。 */
export const CONSTRAINT_SECTION_NAME = 'plugin:dsh-devforge:constraints'

/** 节顺序：forge 规范注入(60)之后、工具指引(100-199)之前。 */
export const CONSTRAINT_SECTION_ORDER = 80

interface AgentState {
  level: ConstraintLevel
  removeSection?: () => void
  offEvent?: () => void
}

/** 从宿主 SDK 防御式解析 agent 作用域的 systemPrompt 服务（plugin-brief 复用同一实现）。 */
export function resolveSystemPrompt(agentCtx: unknown): { section?(input: { name: string; order: number; text: string | (() => string) }): () => void } | undefined {
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

/**
 * 约束注入服务：为宿主内全部代理挂约束节，仓库/行为信号驱动 summary → full 升级。
 * 生命周期由 index.ts 的 safeActivate/ctx.effect 管理；dispose 卸全部节与监听。
 */
export class ConstraintInjectionService {
  private readonly states = new Map<string, AgentState>()
  private readonly disposers: Array<() => void> = []
  private getConfig: () => ConstraintsConfig = () => ({ enabled: true, fullTextPaths: CONSTRAINTS_DEFAULT_PATHS })
  private sources: InjectionDataSources = {}

  /** 启动：挂 agent/created、采纳存量根代理、监听 agent/disposed 清理。 */
  start(ctx: unknown, getConfig: () => ConstraintsConfig, sources: InjectionDataSources = {}): void {
    this.getConfig = getConfig
    this.sources = sources
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
        if (agent && typeof agent === 'object' && 'id' in (agent as Record<string, unknown>)) this.states.delete(String((agent as { id: unknown }).id))
      })
      if (typeof offDisposed === 'function') this.disposers.push(offDisposed as () => void)
    } catch { /* 清理监听失败不影响主流程 */ }
  }

  /** 为单个代理安装约束节与升级监听（同一代理只装一次）。 */
  install(agent: unknown): void {
    if (agent === null || typeof agent !== 'object') return
    const record = agent as { id?: unknown; session?: unknown; ctx?: unknown }
    const id = typeof record.id === 'string' || typeof record.id === 'number' ? String(record.id) : undefined
    if (!id || this.states.has(id)) return
    const state: AgentState = { level: 'summary' }
    this.states.set(id, state)

    // 第二层：仓库信号——cwd 命中即全文（第一轮生效）。
    const config = this.getConfig()
    if (matchesDevPath(resolveAgentCwd(record.session), config.fullTextPaths)) state.level = 'full'
    // 第三层前置：存量会话历史里已有开发动作，直接升级。
    else if (eventsHaveDevSignal(readEvents(record.session))) state.level = 'full'

    // 约束节：text 为动态函数，宿主每次装配求值，级别升级即时生效。
    const prompt = resolveSystemPrompt(record.ctx)
    if (prompt?.section) {
      try {
        const remove = prompt.section({
          name: CONSTRAINT_SECTION_NAME,
          order: CONSTRAINT_SECTION_ORDER,
          text: () => this.composeAgentText(state, record),
        })
        if (typeof remove === 'function') state.removeSection = remove
      } catch { /* 节注册失败时该代理仅无注入，不影响其他代理 */ }
    }

    // 第三层：会话事件流——每个 turn/end 复扫工具调用，出现开发动作即升级。
    const agentCtx = record.ctx
    if (agentCtx && typeof agentCtx === 'object') {
      try {
        const onFn = (agentCtx as { on?: (event: string, listener: (session: unknown, event: { type?: unknown }) => void) => unknown }).on
        const off = onFn?.('session/event', (session: unknown, event: { type?: unknown }) => {
          if (event?.type !== 'turn/end' || state.level === 'full') return
          const events = session && typeof session === 'object' ? readEvents(session) : readEvents(record.session)
          if (eventsHaveDevSignal(events)) state.level = 'full'
        })
        if (typeof off === 'function') state.offEvent = off as () => void
      } catch { /* 事件订阅失败时仅失去第三层，一、二层不受影响 */ }
    }
  }

  /**
   * 组装单代理注入文本（每次系统提示装配求值）：
   * 约束（按级别）+ 产出公约摘要（启用时）+ 当前项目卡（cwd 命中登记项目时）。
   * 数据源未提供或求值异常时安静降级为纯约束文本，绝不阻塞会话。
   */
  private composeAgentText(state: AgentState, record: { session?: unknown }): string {
    const blocks: string[] = [renderConstraintText(state.level, this.getConfig().enabled)]
    try {
      const conventionText = this.sources.getConventionText?.() ?? ''
      if (conventionText !== '') blocks.push(conventionText)
      const cwd = resolveAgentCwd(record.session)
      const project = matchProjectByCwd(cwd, this.sources.getProjects?.() ?? [])
      if (project !== undefined) blocks.push(renderProjectCard(project))
    } catch { /* 数据源异常时仅注入约束本体 */ }
    return blocks.filter((block) => block !== '').join('\n\n')
  }

  /** 卸载全部节与监听，清空状态。 */
  dispose(): void {
    for (const state of this.states.values()) {
      try { state.offEvent?.() } catch { /* 忽略 */ }
      try { state.removeSection?.() } catch { /* 忽略 */ }
    }
    this.states.clear()
    for (const dispose of this.disposers) { try { dispose() } catch { /* 忽略 */ } }
    this.disposers.length = 0
  }

  /** 自检用：当前代理注入级别。 */
  levelOf(id: string): ConstraintLevel | undefined {
    return this.states.get(id)?.level
  }
}
