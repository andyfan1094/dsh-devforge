/**
 * 已安装插件功能总览注入（0.12.1）。
 *
 * 需求（辉哥定）：天工造梦只把各插件的工具 schema 注入模型上下文，
 * 插件级「这个插件是干什么的」没有通用通道，没手写通报文本的插件对模型是隐形的。
 * 本模块自动枚举 Loader 里用户安装的插件，读取各包 package.json 的描述，
 * 以一个动态 systemPrompt 节注入总览；插件装卸/启停后下一轮装配即时生效。
 *
 * 数据边界（防上下文爆炸）：
 *   - 只逐条列出第三方/自研插件（模块名不以 @deepseek-ai/ 开头）；
 *     官方核心内置模块只给一条计数汇总。
 *   - 过滤 npm 临时安装目录（dsh-xxx_4354_d187543f 之类）。
 *   - 总行数封顶，超限省略并提示。
 *
 * 机制与 constraints.ts 同款：ctx.systemPrompt.section({ text: 动态函数 })，
 * 宿主每次装配求值；配置开关在求值时判断，热更新即时生效。
 */

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolveSystemPrompt } from './constraints.ts'

/** Loader 条目的最小投影（防御式读取后的稳定形状）。 */
export interface LoaderEntryLite {
  /** 模块名（Loader entry 的精确 specifier）。 */
  moduleName: string
  /** 是否启用（disabled 取反）。 */
  enabled: boolean
}

/** 插件包元数据（来自 package.json，字段都可能缺省）。 */
export interface PackageInfo {
  /** 包版本号。 */
  version?: string
  /** 包描述。 */
  description?: string
}

/** 按模块名读包元数据的读取函数（实现负责缓存与降级）。 */
export type PackageReader = (moduleName: string) => PackageInfo | undefined

/** 总览节名（全局唯一，重复注册会抛错）。 */
export const PLUGIN_BRIEF_SECTION_NAME = 'plugin:dsh-devforge:plugin-brief'

/** 节顺序：约束注入(80)之后、工具指引(100-199)与 devforge 通报(500)之前。 */
export const PLUGIN_BRIEF_SECTION_ORDER = 90

/** 总览正文最大行数（含表头与汇总行，防个别环境插件失控）。 */
const MAX_TOTAL_LINES = 40

/** 单条插件行里描述的最大字符数（控制 token 占用）。 */
const MAX_DESCRIPTION_CHARS = 100

/** 禁用插件名单最多列出的模块名个数。 */
const MAX_DISABLED_NAMES = 8

/** 官方核心包 scope 前缀：只汇总计数，不逐条列出。 */
const CORE_SCOPE = '@deepseek-ai/'

/** npm 安装中断留下的临时目录后缀（dsh-xxx_4354_d187543f）。 */
const TEMP_MODULE_SUFFIX = /_\d+_[0-9a-f]{6,}$/i

/** 是否 npm 临时目录模块（安装过程的中间产物，不该出现在总览里）。 */
export function isTempModule(moduleName: string): boolean {
  return TEMP_MODULE_SUFFIX.test(moduleName)
}

/** 是否官方核心内置模块（@deepseek-ai/ 开头）。 */
export function isCoreModule(moduleName: string): boolean {
  return moduleName.startsWith(CORE_SCOPE)
}

/**
 * 从宿主 Loader 防御式收集非分组条目。
 * Loader 形状以 dsh-host-plugin-inventory 实证为准（entries/options.name/options.group/disabled）；
 * 任何异常都降级为空列表，让总览节渲染为空而不是拖垮装配。
 */
export function collectLoaderEntries(loader: unknown): LoaderEntryLite[] {
  if (loader === null || typeof loader !== 'object') return []
  const entries = (loader as { entries?: unknown }).entries
  if (typeof entries !== 'function') return []
  let raw: unknown
  try {
    raw = entries.call(loader)
  } catch {
    return []
  }
  // entries() 实测返回可迭代对象（非数组，cordis loader 服务如此，inventory 网关用 for...of 消费），统一摊平。
  let items: readonly unknown[]
  if (Array.isArray(raw)) {
    items = raw
  } else if (raw !== null && typeof raw === 'object' && typeof (raw as Iterable<unknown>)[Symbol.iterator] === 'function') {
    try {
      items = Array.from(raw as Iterable<unknown>)
    } catch {
      return []
    }
  } else {
    return []
  }
  const result: LoaderEntryLite[] = []
  for (const item of items) {
    // Map 摊平后是 [key, value] 对，取值部分。
    const node = Array.isArray(item) && item.length === 2 ? item[1] : item
    if (node === null || typeof node !== 'object') continue
    const record = node as { options?: { name?: unknown; group?: unknown }; disabled?: unknown }
    const moduleName = record.options?.name
    if (typeof moduleName !== 'string' || moduleName.length === 0) continue
    // 分组条目只是容器，本身不是插件。
    if (record.options?.group) continue
    if (isTempModule(moduleName)) continue
    result.push({ moduleName, enabled: record.disabled !== true })
  }
  return result
}

/**
 * 创建带缓存与负缓存的包元数据读取器。
 * anchors 是模块解析锚点（文件路径或 file:// URL），按顺序尝试：
 *   - 本插件 lib 位置 → 能解析同 profile node_modules 里的兄弟插件；
 *   - 宿主入口（process.argv[1]）→ 能解析 @deepseek-ai 官方包（备用）。
 * 解析失败的模块记 null 负缓存，避免每轮装配反复打文件系统。
 */
export function createPackageReader(anchors: readonly string[]): PackageReader {
  const cache = new Map<string, PackageInfo | null>()
  return (moduleName: string): PackageInfo | undefined => {
    if (moduleName.length === 0) return undefined
    if (cache.has(moduleName)) return cache.get(moduleName) ?? undefined
    let resolved: PackageInfo | null = null
    for (const anchor of anchors) {
      if (!anchor) continue
      try {
        const require = createRequire(anchor)
        // 绝对路径模块（本地目录安装）：直接拼 package.json；裸模块名：走解析链。
        const specifier = moduleName.startsWith('/')
          ? moduleName.replace(/\/+$/, '') + '/package.json'
          : moduleName + '/package.json'
        const pkgPath = require.resolve(specifier)
        const parsed = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: unknown; description?: unknown }
        resolved = {
          version: typeof parsed.version === 'string' ? parsed.version : undefined,
          description: typeof parsed.description === 'string' ? parsed.description : undefined,
        }
        break
      } catch {
        // 换下一个锚点；全部失败按未解析处理。
      }
    }
    cache.set(moduleName, resolved)
    return resolved ?? undefined
  }
}

/** 规整描述：压平空白、超长截断。 */
function normalizeDescription(raw: string): string {
  const collapsed = raw.replace(/\s+/gu, ' ').trim()
  if (collapsed.length <= MAX_DESCRIPTION_CHARS) return collapsed
  return collapsed.slice(0, MAX_DESCRIPTION_CHARS) + '…'
}

/**
 * 渲染插件功能总览文本（纯函数，便于单测）。
 * 没有任何用户插件时返回空串（宿主会丢弃空节）。
 */
export function renderPluginBrief(
  entries: readonly LoaderEntryLite[],
  readInfo: PackageReader,
  options?: { maxLines?: number },
): string {
  const userEntries = entries.filter((entry) => !isCoreModule(entry.moduleName))
  const coreCount = entries.length - userEntries.length
  if (userEntries.length === 0) return ''
  const maxLines = options?.maxLines ?? MAX_TOTAL_LINES
  const enabled = userEntries
    .filter((entry) => entry.enabled)
    .sort((a, b) => (a.moduleName < b.moduleName ? -1 : a.moduleName > b.moduleName ? 1 : 0))
  const disabled = userEntries.filter((entry) => !entry.enabled)

  const lines: string[] = [
    '【已安装插件功能总览（dsh-devforge 自动注入，随插件装卸/启停实时变化；各工具的具体用法见工具清单描述）】',
  ]
  let used = 0
  let omitted = 0
  for (const entry of enabled) {
    if (lines.length >= maxLines) {
      omitted = enabled.length - used
      break
    }
    const info = readInfo(entry.moduleName)
    const version = info?.version ? ' v' + info.version : ''
    const description = info?.description ? normalizeDescription(info.description) : '（包内无描述）'
    lines.push('- ' + entry.moduleName + version + '：' + description)
    used += 1
  }
  if (omitted > 0) lines.push('……另有 ' + omitted + ' 个启用插件未逐条列出。')
  if (disabled.length > 0) {
    const names = disabled.map((entry) => entry.moduleName).slice(0, MAX_DISABLED_NAMES).join('、')
    const suffix = disabled.length > MAX_DISABLED_NAMES ? ' 等' : ''
    lines.push('另有 ' + disabled.length + ' 个已禁用插件：' + names + suffix + '。')
  }
  if (coreCount > 0) lines.push('另有 ' + coreCount + ' 个 @deepseek-ai 官方核心内置模块（工具链本体）不逐条列出。')
  return lines.join('\n')
}

/** 插件能力总览注入配置。 */
export interface PluginBriefConfig {
  /** 总开关；false 时文本函数返回空串（已注册的节即时失效）。 */
  enabled: boolean
}

/** 总览注入诊断信息（暂存验收与排障用，只读快照）。 */
export interface PluginBriefDiagnostics {
  /** loader 服务是否解析成功。 */
  loaderResolved: boolean
  /** 最近一次渲染的 Loader 条目总数（含官方核心）。 */
  entryCount: number
  /** 最近一次渲染的用户插件条目数（排除官方核心与临时目录）。 */
  userCount: number
  /** 激活过程异常摘要；空串 = 无异常。 */
  error: string
  /** loader 用哪条路径解析成功：ctx / root / get-ctx / get-root / none。 */
  loaderPath: string
  /** loader.entries 成员的类型（function 之外的值都说明服务形状和预期不符）。 */
  entriesType: string
  /** entries() 原始返回是否为数组。 */
  rawIsArray: boolean
  /** entries() 原始返回长度（非数组为 -1）。 */
  rawLength: number
  /** 首条原始条目的 JSON 样本（截断）或 entries() 抛错摘要。 */
  sample: string
}

/** 空诊断快照（未激活时的占位）。 */
export function emptyDiagnostics(): PluginBriefDiagnostics {
  return { loaderResolved: false, entryCount: 0, userCount: 0, error: '', loaderPath: 'none', entriesType: 'unknown', rawIsArray: false, rawLength: -1, sample: '' }
}

/** 注入面：注册的节句柄 + 当前文本 + 诊断。 */
export interface PluginBriefSurface {
  /** 卸载已注册的节（幂等）。 */
  dispose: () => void
  /** 当前实际注入文本（与节渲染同一实现，所见即所注）。 */
  currentText: () => string
  /** 只读诊断快照。 */
  diagnostics: () => PluginBriefDiagnostics
}

/**
 * 激活总览注入：注册一个全局动态节。
 * loader / systemPrompt 服务都防御式解析（cordis 对未声明/未激活服务的属性访问会直接抛错），
 * 任一环失败都降级为空节不报错，细节进 diagnostics 供暂存验收路由排障。
 */
export function activatePluginBrief(
  ctx: unknown,
  getConfig: () => PluginBriefConfig,
): PluginBriefSurface {
  const diag = emptyDiagnostics()
  const holder = ctx as {
    logger?: { warn?: (...args: unknown[]) => void }
    root?: unknown
    get?: (name: string) => unknown
    systemPrompt?: { section?: (input: { name: string; order: number; text: string | (() => string) }) => () => void }
  } | null
  if (holder === null || typeof holder !== 'object') {
    diag.error = 'ctx 不是对象'
    return { dispose: () => {}, currentText: () => '', diagnostics: () => ({ ...diag }) }
  }

  // loader 解析链：ctx.loader → ctx.root.loader → ctx.get('loader')；每条都独立防抛。
  const resolveLoader = (): unknown => {
    const holders: Array<{ label: string; h: unknown }> = [
      { label: 'ctx', h: holder },
      { label: 'root', h: holder.root },
    ]
    for (const { label, h } of holders) {
      if (h === null || typeof h !== 'object') continue
      const record = h as Record<string, unknown>
      try {
        const direct = record.loader
        if (direct !== undefined && direct !== null) {
          diag.loaderPath = label
          return direct
        }
      } catch { /* 属性代理抛错换下一条 */ }
      if (typeof record.get === 'function') {
        try {
          const viaGet = (record.get as (name: string) => unknown).call(h, 'loader')
          if (viaGet !== undefined && viaGet !== null) {
            diag.loaderPath = 'get-' + label
            return viaGet
          }
        } catch { /* get 抛错换下一条 */ }
      }
    }
    return undefined
  }
  const loader = resolveLoader()
  diag.loaderResolved = loader !== undefined && loader !== null
  if (!diag.loaderResolved) {
    diag.error = 'loader 服务不可用'
    holder.logger?.warn?.('[dsh-devforge] 插件能力总览：loader 服务不可用，不注入总览节')
  }

  // 包元数据读取器：本插件 lib 位置优先（能摸到 profile 兄弟插件），宿主入口兜底。
  const readInfo = createPackageReader([import.meta.url, process.argv[1] ?? ''])

  // 当前注入文本：节渲染与验收路由共用同一实现，保证「所见即所注」。
  const currentText = (): string => {
    if (!getConfig().enabled) return ''
    // 每轮装配重取条目：插件装卸后总览自动跟进；包信息走读取器缓存。
    const current = collectLoaderEntries(loader)
    diag.entryCount = current.length
    diag.userCount = current.filter((entry) => !isCoreModule(entry.moduleName)).length
    // 形状探针：entries 成员类型 / 原始返回形态 / 首条样本，排障用（随诊断路由透出）。
    const probe = loader as { entries?: unknown } | null | undefined
    diag.entriesType = typeof probe?.entries
    let raw: unknown
    if (typeof probe?.entries === 'function') {
      try {
        raw = (probe.entries as () => unknown).call(probe)
      } catch (error) {
        diag.sample = 'entries() 抛错：' + (error instanceof Error ? error.message : String(error))
      }
    } else if (probe !== null && typeof probe === 'object') {
      raw = probe.entries
    }
    diag.rawIsArray = Array.isArray(raw)
    diag.rawLength = Array.isArray(raw) ? raw.length : -1
    if (diag.sample === '' && raw !== null && typeof raw === 'object') {
      let items: unknown[] | undefined
      if (Array.isArray(raw)) {
        items = raw
      } else if (typeof (raw as Iterable<unknown>)[Symbol.iterator] === 'function') {
        try {
          items = Array.from(raw as Iterable<unknown>)
        } catch {
          items = undefined
        }
      }
      if (items && items.length > 0) {
        // Map 摊平后是 [key, value] 对，样本取值部分。
        const first = Array.isArray(items[0]) && (items[0] as unknown[]).length === 2 ? (items[0] as unknown[])[1] : items[0]
        try {
          diag.sample = JSON.stringify(first)?.slice(0, 400) ?? 'null'
        } catch {
          diag.sample = '样本序列化失败'
        }
      }
    }
    return renderPluginBrief(current, readInfo)
  }

  const prompt = resolveSystemPrompt(holder)
  if (!prompt?.section) {
    diag.error = 'systemPrompt 服务不可用'
    holder.logger?.warn?.('[dsh-devforge] 插件能力总览：systemPrompt 服务不可用，跳过注入')
    return { dispose: () => {}, currentText: () => '', diagnostics: () => ({ ...diag }) }
  }
  let remove: (() => void) | undefined
  try {
    remove = prompt.section({
      name: PLUGIN_BRIEF_SECTION_NAME,
      order: PLUGIN_BRIEF_SECTION_ORDER,
      text: currentText,
    })
  } catch (error) {
    diag.error = error instanceof Error ? error.message : String(error)
    holder.logger?.warn?.('[dsh-devforge] 插件能力总览节注册失败：%s', diag.error)
    return { dispose: () => {}, currentText: () => '', diagnostics: () => ({ ...diag }) }
  }
  return {
    currentText,
    diagnostics: () => ({ ...diag }),
    dispose: () => {
      try {
        remove?.()
      } catch {
        // 卸载失败不影响插件关闭流程。
      }
    },
  }
}
