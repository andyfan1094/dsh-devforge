/**
 * dsh-settings 兼容层（对齐宿主 0.1.2-alpha.3）。
 *
 * 0.1.2-alpha.3 从 @deepseek-ai/dsh-settings 移除了独立导出的
 * settingsNamespace / installSettingsSection：前者只是命名空间校验的
 * 恒等函数（返回品牌类型），后者变成了 settings 服务上的 installSection
 * 方法（语义一致：注册命名空间 + base 层 + setSource/onChange 接线）。
 *
 * 这里按旧签名桥接到新 API，调用点无需改动；本文件对 dsh-settings 只保留
 * SettingsConflictError（alpha.3 仍导出）与类型导入（运行时零依赖），
 * 待 devDependencies 整体升到 alpha 线后可整体移除。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'

/** 与官方实现保持一致的命名空间规则：小写字母开头，其后小写字母/数字/连字符。 */
const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*$/

/**
 * 校验并返回品牌化的设置命名空间（旧 settingsNamespace）。
 * 新 provider 的 get/update/replace 内部已做同样的 parseSettingsNamespace
 * 校验；这里保留前置校验以维持旧报错时机与文案。
 */
export function settingsNamespace(value: string): SettingsNamespace {
  if (!NAMESPACE_PATTERN.test(value)) throw new TypeError(`settings namespace "${value}" must match ${String(NAMESPACE_PATTERN)}`)
  return value as SettingsNamespace
}

/** installSection 的 hooks 契约（与官方 SettingsSectionHooks 同形）。 */
export interface SettingsSectionHooks<T> {
  /** 收到当前权威配置源：挂载时是已解析 scope，卸载后回落到组合 entry。 */
  setSource: (current: () => T) => void
  /** 挂载/卸载/提交变更后触发，调用方据此重算派生注册。 */
  onChange: () => void
  /** 拒绝 schema 无法表达的跨字段约束（拒绝的是写入而非存储）。 */
  validate?: (value: T) => void
}

/** 宿主 alpha.3 settings 服务上 installSection 方法的最小结构类型（hooks 放宽为 unknown 规避变型问题）。 */
interface SettingsServiceWithInstallSection {
  installSection(owner: Context, ns: string, schema: unknown, entry: unknown, hooks: unknown): void
}

/**
 * 结构化探测宿主 settings 服务（不绑定具体版本类型）：
 * - 0.1.6 及以前：`get(ns)` 同步返回命名空间的已解析配置段；
 * - 0.1.7 起：服务换成 SettingsForms（configure/describe/update/replace/mutate），
 *   `get` 与 `installSection` 均被移除，读值只能走 `describe()` 的 entry 目录。
 */
interface SettingsServiceProbe {
  get?(ns: string): unknown
  describe?(): ReadonlyArray<{ ns?: unknown; value?: unknown }>
}

/**
 * 从宿主 settings 服务对象读取一个命名空间的配置段（跨宿主版本兼容）。
 *
 * 匹配顺序：
 * 1. 旧宿主 `get(ns)` 优先（同步、语义就是「读已解析段」）；
 * 2. 新宿主 `describe()` 回落：profile 补丁条目是裸 id（如 `llm-pi-ai`），
 *    官方内置组合条目可能带 `include:` 前缀，先精确匹配再按 `:` 后缀兜底。
 * 找不到或服务形态不符时返回 undefined，调用方按「未配置」处理，绝不抛错。
 */
export function readSectionFrom(settings: unknown, ns: string): unknown {
  const probe = settings as SettingsServiceProbe | null | undefined
  if (probe === null || typeof probe !== 'object') return undefined
  if (typeof probe.get === 'function') return probe.get(ns)
  if (typeof probe.describe === 'function') {
    let list: ReadonlyArray<{ ns?: unknown; value?: unknown }>
    try {
      list = probe.describe()
    } catch {
      return undefined
    }
    if (!Array.isArray(list)) return undefined
    const exact = list.find((descriptor) => descriptor?.ns === ns)
    if (exact !== undefined) return exact.value
    const suffix = ':' + ns
    const loose = list.find((descriptor) => typeof descriptor?.ns === 'string' && descriptor.ns.endsWith(suffix))
    return loose === undefined ? undefined : loose.value
  }
  return undefined
}

/** readSectionFrom 的 Context 便捷版：从宿主 ctx.settings 读配置段。 */
export function readSettingsSection(ctx: Context, ns: string): unknown {
  return readSectionFrom((ctx as unknown as { settings?: unknown }).settings, ns)
}

/**
 * 旧 installSettingsSection：官方迁移写法是把 ctx.inject(["settings"], ...)
 * 包在外面，里面调 settings.installSection(owner, ns, schema, entry, hooks)。
 * 结构断言是因为本地 devDependencies 仍钉在 rc.8 类型上（无该方法声明）。
 *
 * 0.1.7 起 installSection 被移除，配置改由 loader 注入 apply 的 config 参数
 * 并随 profile 组合条目变更整体重载插件。此时退化为「静态来源」：把注入的
 * entry 直接交给 setSource，保证 resolve() 有配置可读；设置页策略尽力申请，
 * 失败不影响配置读取。
 */
export function installSettingsSection<T>(ctx: Context, ns: string, schema: unknown, entry: T, hooks: SettingsSectionHooks<T>): void {
  ctx.inject(['settings'], (sctx) => {
    const service = sctx.settings as unknown as SettingsServiceWithInstallSection & { configure?: (presentation: { auto?: boolean }) => unknown }
    if (typeof service.installSection === 'function') {
      service.installSection(ctx, ns, schema, entry, hooks)
      return
    }
    hooks.setSource(() => entry)
    try {
      service.configure?.({ auto: true })
    } catch {
      // 设置页自动生成策略失败只影响面板形态，不影响配置读取与业务功能。
    }
  })
}
