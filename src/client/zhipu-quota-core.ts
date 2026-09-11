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

/** 把毫秒级剩余时间规整成简短倒计时文案；无法计算返回空串（UI 不渲染该段）。
 * 文案风格：<60 分钟「X 分钟后重置」；<48 小时「X 小时 Y 分后重置」；更长「X 天后重置」。 */
export function formatResetCountdown(resetAt: number | undefined, now: number): string {
  const remaining = typeof resetAt === 'number' && Number.isFinite(resetAt) ? resetAt - now : NaN
  if (!Number.isFinite(remaining)) return ''
  if (remaining <= 0) return '即将重置'
  const minutes = Math.ceil(remaining / 60_000)
  if (minutes < 60) return minutes + ' 分钟后重置'
  const hours = Math.floor(minutes / 60)
  if (hours < 48) {
    const mins = minutes % 60
    return mins === 0 ? hours + ' 小时后重置' : hours + ' 小时 ' + mins + ' 分后重置'
  }
  return Math.floor(hours / 24) + ' 天后重置'
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
