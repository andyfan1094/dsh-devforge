/** 首页侧栏「智谱 5 小时」用量卡片的数据规整纯函数：无 DOM / React 依赖，供 node --test 直接单测。
 * 数据源是 /api/dsh-devforge/zhipu/dashboards 载荷（Key 池按主 Key 在前的顺序返回）。
 * 原独立插件 dsh-zhipu-quota 0.3.0 原样并入（辉哥 2026-09-11 定稿：不再搞独立插件）。 */

/** 仅接纳有限数值，阻止异常响应把 NaN/Infinity 带进 UI。 */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 把秒级/毫秒级数字或 ISO 字符串时间戳规整成毫秒；无法解析返回 undefined。 */
export function normalizeReset(value: unknown): number | undefined {
  const raw = typeof value === 'string' ? Date.parse(value) : finiteNumber(value)
  if (raw === undefined || !Number.isFinite(raw)) return undefined
  return raw < 1_000_000_000_000 ? raw * 1000 : raw
}

/** 进度条着色级别：≥95% 危险、≥80% 警告、其余正常。 */
export function percentLevel(percent: number): 'normal' | 'warning' | 'danger' {
  return percent >= 95 ? 'danger' : percent >= 80 ? 'warning' : 'normal'
}

/** 窗口倒计时（辉哥 2026-09-21 定稿）：'5h-3:00' / '周-1d3h' / '月-28d20h'；已过期「即将重置」；无法计算空串。
 * - 5h 短窗口用 H:MM 钟表式；周/月长窗口用 DdHh（分钟舍弃）；
 * - level 归一化值（5h/session/weekly/monthly）与智谱 kind（tokens-5h/tokens-week/tools-month）都认。 */
export function formatWindowCountdown(level: string | undefined, resetAt: number | undefined, now: number): string {
  const remaining = typeof resetAt === 'number' && Number.isFinite(resetAt) ? resetAt - now : NaN
  if (!Number.isFinite(remaining)) return ''
  if (remaining <= 0) return '即将重置'
  const prefix = level === undefined ? '' : levelPrefix(level)
  const totalMinutes = Math.max(1, Math.ceil(remaining / 60_000))
  if (prefix === '5h') {
    const hours = Math.floor(totalMinutes / 60)
    return '5h-' + hours + ':' + String(totalMinutes % 60).padStart(2, '0')
  }
  const totalHours = Math.floor(totalMinutes / 60)
  if (totalHours < 1) return prefix + '-' + totalMinutes + 'm'
  if (totalHours < 24) return prefix + '-' + totalHours + 'h'
  return prefix + '-' + Math.floor(totalHours / 24) + 'd' + (totalHours % 24) + 'h'
}

/** 窗口前缀：短窗口 '5h'、周 '周'、月 '月'；认不出的无前缀（仅时长）。 */
function levelPrefix(level: string): string {
  const value = level.toLowerCase()
  if (value === '5h' || value === 'session' || value === 'interval' || value === 'tokens-5h' || value === 'short-window') return '5h'
  if (value === 'weekly' || value === 'week' || value === 'tokens-week') return '周'
  if (value === 'monthly' || value === 'month' || value === 'tools-month') return '月'
  return value
}

/** 卡片一行的展示模型。 */
export interface ZhipuQuotaRow {
  label: string
  primary: boolean
  percent: number
  level: 'normal' | 'warning' | 'danger'
  resetAt?: number
  title: string
}

/**
 * 从 dashboards 载荷提取各渠道的 5 小时额度行。
 * - 只保留 kind === 'tokens-5h' 的窗口（辉哥要的就是 5 小时量）；
 * - 保持服务端池序（主 Key 在前）；单渠道查询失败（ok !== true）直接跳过；
 * - 最多 maxRows 行（辉哥定稿：只显示第一把 Key 时传 1）；
 * - usedPercent 缺失时按 used/total 换算并 clamp 到 [0, 100]。
 */
export function extractZhipuRows(payload: unknown, maxRows = 4): ZhipuQuotaRow[] {
  const usages = payload !== null && typeof payload === 'object' && Array.isArray((payload as { usages?: unknown }).usages)
    ? (payload as { usages: unknown[] }).usages
    : []
  const rows: ZhipuQuotaRow[] = []
  for (const usage of usages) {
    if (rows.length >= maxRows) break
    if (usage === null || typeof usage !== 'object') continue
    const entry = usage as { ok?: unknown; primary?: unknown; label?: unknown; dashboard?: unknown }
    if (entry.ok !== true) continue
    const dashboard = entry.dashboard
    if (dashboard === null || typeof dashboard !== 'object' || !Array.isArray((dashboard as { limits?: unknown }).limits)) continue
    const limits = (dashboard as { limits: unknown[] }).limits
    const limit = limits.find((item): item is Record<string, unknown> => item !== null && typeof item === 'object' && (item as { kind?: unknown }).kind === 'tokens-5h')
    if (limit === undefined) continue
    const used = finiteNumber(limit.used)
    const total = finiteNumber(limit.total)
    const rawPercent = finiteNumber(limit.usedPercent) ?? (used !== undefined && total !== undefined && total > 0 ? used / total * 100 : 0)
    const percent = Math.max(0, Math.min(100, rawPercent))
    const resetAt = normalizeReset(limit.nextResetTime)
    const label = typeof entry.label === 'string' && entry.label.trim() !== '' ? entry.label : '渠道'
    rows.push({
      label,
      /** 是否主 Key（聊天路由当前使用的渠道）。 */
      primary: entry.primary === true,
      percent: Math.round(percent * 10) / 10,
      level: percentLevel(percent),
      /** 规整后的重置时间（毫秒）；UI 据此渲染「还有多久重置」倒计时。 */
      resetAt,
      title: resetAt === undefined
        ? label + ' · 5 小时额度 · 重置时间未知'
        : label + ' · 5 小时额度 · ' + new Date(resetAt).toLocaleString('zh-CN') + ' 重置',
    })
  }
  return rows
}

/** 方舟套餐在侧栏卡片的行展示模型（字段语义与 ZhipuQuotaRow 一致）。 */
export interface ArkQuotaRow {
  /** 套餐标识（'agent-plan' | 'coding-plan'），用作渲染 key。 */
  key: string
  label: string
  percent: number
  level: 'normal' | 'warning' | 'danger'
  resetAt?: number
  title: string
}

/** 上层窗口阻断阈值：周/月用量达到该百分比即视为满，5 小时窗口实际不可用（浮点容差）。 */
const WINDOW_BLOCKED_PERCENT = 99.5

/**
 * 从方舟用量 dashboard（/api/dsh-devforge/ark/dashboard 载荷的 dashboard 字段）提取
 * 各套餐的 5 小时窗口行，与智谱主 Key 行同一「盯紧短窗口」视角（辉哥 2026-09-21 定稿）。
 * - 只保留 subscribed === true 且存在 5h 窗口的套餐；AK/SK 未配置时 Host 返回空 plans，自然产出空行；
 * - 5 小时窗口 level 已由 Host 归一化（0.34.8），这里按字面量 '5h' 匹配；
 * - 周或月额度满（≥99.5%）时上层约束已阻断用量，5h 行强制显示 100%（danger）并在 label/title 注明（辉哥定稿）；
 * - usedPercent 缺失时按 used/total 换算并 clamp 到 [0, 100]。
 */
export function extractArkRows(dashboard: unknown): ArkQuotaRow[] {
  const plans = dashboard !== null && typeof dashboard === 'object' && Array.isArray((dashboard as { plans?: unknown }).plans)
    ? (dashboard as { plans: unknown[] }).plans
    : []
  const rows: ArkQuotaRow[] = []
  for (const plan of plans) {
    if (plan === null || typeof plan !== 'object') continue
    const entry = plan as { product?: unknown; subscribed?: unknown; periods?: unknown }
    if (entry.subscribed !== true || !Array.isArray(entry.periods)) continue
    const label = entry.product === 'agent-plan' ? '方舟 Agent' : entry.product === 'coding-plan' ? '方舟 Coding' : null
    if (label === null) continue
    // 闭包内 TS 窄化失效（unknown 收窄不进闭包），先落到显式数组类型。
    const periods: unknown[] = entry.periods
    const windowPercent = (level: string): number | undefined => {
      const row = periods.find((item): item is Record<string, unknown> => item !== null && typeof item === 'object' && (item as { level?: unknown }).level === level)
      if (row === undefined) return undefined
      const used = finiteNumber(row.used)
      const total = finiteNumber(row.total)
      const raw = finiteNumber(row.usedPercent) ?? (used !== undefined && total !== undefined && total > 0 ? used / total * 100 : undefined)
      return raw === undefined ? undefined : Math.max(0, Math.min(100, raw))
    }
    const period = entry.periods.find((item): item is Record<string, unknown> => item !== null && typeof item === 'object' && (item as { level?: unknown }).level === '5h')
    if (period === undefined) continue
    const used = finiteNumber(period.used)
    const total = finiteNumber(period.total)
    const rawPercent = finiteNumber(period.usedPercent) ?? (used !== undefined && total !== undefined && total > 0 ? used / total * 100 : 0)
    // 周或月额度满 ⇒ 上层约束阻断，5 小时窗口实际不可用：显示拉满并注明原因。
    const weeklyBlocked = (windowPercent('weekly') ?? 0) >= WINDOW_BLOCKED_PERCENT
    const monthlyBlocked = (windowPercent('monthly') ?? 0) >= WINDOW_BLOCKED_PERCENT
    const blocked = weeklyBlocked || monthlyBlocked
    const percent = blocked ? 100 : Math.max(0, Math.min(100, rawPercent))
    const blockedNote = blocked
      ? '（' + (weeklyBlocked && monthlyBlocked ? '周/月额度已满' : weeklyBlocked ? '周额度已满' : '月额度已满') + '，5 小时窗口不可用）'
      : ''
    const resetAt = normalizeReset(period.resetAt)
    rows.push({
      key: String(entry.product),
      label: blocked ? label + ' · 已阻断' : label,
      percent: Math.round(percent * 10) / 10,
      level: percentLevel(percent),
      resetAt,
      title: resetAt === undefined
        ? label + ' · 5 小时额度 · 重置时间未知' + (blockedNote === '' ? '' : ' ' + blockedNote)
        : label + ' · 5 小时额度 · ' + new Date(resetAt).toLocaleString('zh-CN') + ' 重置' + (blockedNote === '' ? '' : ' ' + blockedNote),
    })
  }
  return rows
}

/** 套餐行展示模型（辉哥 2026-09-23 定稿：侧栏看板显示「什么套餐/总量/剩余」）。 */
export interface PackageRow {
  key: string
  label: string
  /** 剩余占总量百分比（0-100，总量 0 时 0）。 */
  percent: number
  /** false=未激活（首次使用后才计时）。 */
  activated: boolean
  /** 激活前提示：'首次使用后 N 天内有效'（目录 days 缺失时空串）。 */
  pendingHint: string
  title: string
}

/** 套餐目录条目（官网 GEM_PACKS 子集）。 */
export interface PackageCatalogEntry {
  key: string
  name: string
  ico: string
  days: number
}

/** 从 /api/dsh-devforge/modagentai/packages 载荷规整套餐行：只保留 gemsLeft > 0 的实例（active 与未激活都要——未激活也能用）。 */
export function extractPackageRows(payload: unknown, maxRows = 4): PackageRow[] {
  const data = payload !== null && typeof payload === 'object' ? (payload as { packages?: unknown }).packages : undefined
  if (data === null || typeof data !== 'object') return []
  const view = data as { loggedIn?: unknown; mine?: unknown; catalog?: unknown }
  if (view.loggedIn !== true || !Array.isArray(view.mine)) return []
  const catalog = Array.isArray(view.catalog) ? view.catalog : []
  const rows: PackageRow[] = []
  for (const raw of view.mine) {
    if (rows.length >= maxRows) break
    if (raw === null || typeof raw !== 'object') continue
    const m = raw as { packKey?: unknown; gemsTotal?: unknown; gemsLeft?: unknown; activatedAt?: unknown; expiresAt?: unknown }
    if (typeof m.packKey !== 'string' || m.packKey === '') continue
    const gemsTotal = typeof m.gemsTotal === 'number' && Number.isFinite(m.gemsTotal) ? m.gemsTotal : 0
    const gemsLeft = typeof m.gemsLeft === 'number' && Number.isFinite(m.gemsLeft) ? m.gemsLeft : 0
    if (gemsLeft <= 0) continue
    const entry = catalog.find((c) => c !== null && typeof c === 'object' && (c as PackageCatalogEntry).key === m.packKey) as PackageCatalogEntry | undefined
    const name = entry?.name ?? m.packKey
    const ico = entry?.ico ?? '🪙'
    const activated = typeof m.activatedAt === 'string' && m.activatedAt !== ''
    const days = entry && typeof entry.days === 'number' ? entry.days : undefined
    const noExp = m.expiresAt === undefined || m.expiresAt === null || m.expiresAt === 'infinity'
    rows.push({
      key: m.packKey,
      label: ico + ' ' + name,
      percent: gemsTotal > 0 ? Math.max(0, Math.min(100, (gemsLeft / gemsTotal) * 100)) : 0,
      activated,
      pendingHint: !activated && noExp && days !== undefined && days > 0 ? '首次使用后 ' + days + ' 天内有效' : '',
      title: name + '：剩余 ' + gemsLeft + ' / 总量 ' + gemsTotal + ' 💎' + (!activated && noExp ? '（未激活：首次消费后计时' + (days ? '，' + days + ' 天有效期' : '') + '）' : ''),
    })
  }
  return rows
}
