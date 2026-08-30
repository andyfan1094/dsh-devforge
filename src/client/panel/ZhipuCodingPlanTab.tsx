import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { ZhipuDashboard, ZhipuQuotaLimit, ZhipuStatus, ZhipuUsageWindow } from '../../zhipu/protocol.ts'
import css from './panel.module.css'

/** 智谱页签属性。 */
export interface ZhipuCodingPlanTabProps {
  api: DevforgeApi
}

/** 格式化数量，避免大 Token 数撑破布局。 */
function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', { notation: value >= 100_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
}

/** 将官方重置时间转成短倒计时。 */
function formatCountdown(value: string | number | undefined, now: number): string {
  if (value === undefined) return '重置时间未知'
  const rawTimestamp = typeof value === 'number' ? value : Date.parse(value)
  const timestamp = typeof rawTimestamp === 'number' && rawTimestamp > 0 && rawTimestamp < 1_000_000_000_000 ? rawTimestamp * 1000 : rawTimestamp
  if (!Number.isFinite(timestamp)) return '重置时间未知'
  const remaining = Math.max(0, timestamp - now)
  const minutes = Math.ceil(remaining / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return days + ' 天 ' + hours + ' 小时后重置'
  if (hours > 0) return hours + ' 小时 ' + mins + ' 分钟后重置'
  return mins + ' 分钟后重置'
}

/** 额度类型中文名。 */
function quotaLabel(kind: ZhipuQuotaLimit['kind']): string {
  if (kind === 'tokens-5h') return '5 小时 Token'
  if (kind === 'tokens-week') return '每周 Token'
  if (kind === 'tools-month') return '本月 MCP 工具'
  return '其他额度'
}

/** 智谱 Coding Plan 模型与官方用量面板。 */
export function ZhipuCodingPlanTab({ api }: ZhipuCodingPlanTabProps): JSX.Element {
  const [status, setStatus] = useState<ZhipuStatus | null>(null)
  const [dashboard, setDashboard] = useState<ZhipuDashboard | null>(null)
  const [usageWindow, setUsageWindow] = useState<ZhipuUsageWindow>('day')
  const [loading, setLoading] = useState(true)
  const [settingUp, setSettingUp] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())
  const mounted = useRef(true)
  const refreshGeneration = useRef(0)
  const refreshController = useRef<AbortController | null>(null)
  const setupController = useRef<AbortController | null>(null)

  /** 同时读取脱敏状态和官方用量；Key 永不进入浏览器。 */
  const refresh = useCallback(async (): Promise<void> => {
    const generation = refreshGeneration.current + 1
    refreshGeneration.current = generation
    refreshController.current?.abort()
    const controller = new AbortController()
    refreshController.current = controller
    setLoading(true)
    setError('')
    try {
      const nextStatus = await api.getZhipuStatus(controller.signal)
      const nextDashboard = nextStatus.credentialConfigured ? await api.getZhipuDashboard(usageWindow, controller.signal) : null
      if (!mounted.current || refreshGeneration.current !== generation) return
      setStatus(nextStatus)
      setDashboard(nextDashboard)
    } catch (cause) {
      if (controller.signal.aborted || !mounted.current || refreshGeneration.current !== generation) return
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mounted.current && refreshGeneration.current === generation) setLoading(false)
    }
  }, [api, usageWindow])

  useEffect(() => {
    mounted.current = true
    void refresh()
    return () => {
      mounted.current = false
      refreshGeneration.current += 1
      refreshController.current?.abort()
      setupController.current?.abort()
    }
  }, [refresh])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  /** 一键补齐 provider 和两条最新模型，不切默认模型。 */
  const setupModels = async (): Promise<void> => {
    if (settingUp) return
    setupController.current?.abort()
    const controller = new AbortController()
    setupController.current = controller
    setSettingUp(true)
    setError('')
    try {
      const nextStatus = await api.setupZhipuModels(controller.signal)
      if (mounted.current) setStatus(nextStatus)
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mounted.current) setSettingUp(false)
    }
  }

  const modelsReady = useMemo(() => status?.providerConfigured === true && status.models.every((model) => model.configured), [status])

  return (
    <section className={css['zhipuWorkspace']}>
      <div className={css['integrationHeader']}>
        <span className={css['connectionDot']} data-state={status?.credentialConfigured === true ? 'connected' : 'error'} />
        <div className={css['resourceInfo']}>
          <strong className={css['resourceTitle']}>智谱 Coding Plan</strong>
          <span className={css['resourceMeta']}>{status?.credentialConfigured === true ? '官方凭据已配置' : '等待配置 ZAI_CODING_CN_API_KEY'} · {modelsReady ? '模型已就绪' : '模型待完善'} · {status?.mcpTools !== false ? '官方 MCP 工具已启用' : '官方 MCP 工具已关闭'}</span>
        </div>
        {!modelsReady && <button type="button" className={css['ghostButton']} disabled={settingUp} onClick={() => { void setupModels() }}>{settingUp ? '正在配置…' : '完善模型接入'}</button>}
        <button type="button" className={css['ghostButton']} disabled={loading} onClick={() => { void refresh() }}>{loading ? '刷新中…' : '刷新'}</button>
      </div>

      {error !== '' && <div className={css['banner']} data-kind="error">{error}</div>}
      {loading && dashboard === null && <div className={css['empty']} data-loading="">正在读取智谱官方额度…</div>}
      {!loading && status?.credentialConfigured !== true && <div className={css['banner']} data-kind="warning">请先在 DSH 模型设置中配置 zai-coding-cn 的 API Key。</div>}

      {dashboard !== null && (
        <>
          {dashboard.warnings.map((warning) => <div key={warning} className={css['banner']} data-kind="warning">{warning}</div>)}
          <div className={css['quotaHeader']}>
            <div><span className={css['sectionHint']}>当前套餐</span><strong>{dashboard.level?.toUpperCase() ?? '未知'}</strong></div>
            <span className={css['toolbarSpacer']} />
            <span className={css['sectionHint']}>更新于 {new Date(dashboard.fetchedAt).toLocaleTimeString('zh-CN')}</span>
          </div>

          <div className={css['quotaList']}>
            {dashboard.limits.map((limit, index) => {
              const usedPercent = Math.max(0, Math.min(100, limit.usedPercent ?? (limit.used !== undefined && limit.total !== undefined && limit.total > 0 ? limit.used / limit.total * 100 : 0)))
              return (
                <div key={limit.kind + '-' + index} className={css['quotaRow']}>
                  <div className={css['quotaMeta']}>
                    <strong>{quotaLabel(limit.kind)}</strong>
                    <span>{usedPercent.toFixed(1)}% 已用 · {(100 - usedPercent).toFixed(1)}% 剩余 · {formatCountdown(limit.nextResetTime, now)}</span>
                  </div>
                  <div className={css['progressTrack']} role="progressbar" aria-label={quotaLabel(limit.kind)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={usedPercent}>
                    <span className={css['progressFill']} data-level={usedPercent >= 95 ? 'danger' : usedPercent >= 80 ? 'warning' : 'normal'} style={{ width: usedPercent + '%' }} />
                  </div>
                </div>
              )
            })}
          </div>

          <div className={css['usageToolbar']}>
            <h3 className={css['sectionTitle']}>官方用量</h3>
            <div className={css['segmented']} role="group" aria-label="用量时间范围">
              <button type="button" data-active={usageWindow === 'day' ? '' : undefined} onClick={() => setUsageWindow('day')}>近 24 小时</button>
              <button type="button" data-active={usageWindow === 'week' ? '' : undefined} onClick={() => setUsageWindow('week')}>近 7 天</button>
            </div>
          </div>

          <div className={css['usageGrid']}>
            <section className={css['usageSection']}>
              <h3 className={css['sectionTitle']}>模型调用</h3>
              <div className={css['metricRow']}><span>调用次数</span><strong>{formatNumber(dashboard.modelUsage.totalCalls)}</strong></div>
              <div className={css['metricRow']}><span>Token 总量</span><strong>{formatNumber(dashboard.modelUsage.totalTokens)}</strong></div>
              {dashboard.modelUsage.models.map((model) => <div key={model.name} className={css['metricRow']}><span>{model.name}</span><strong>{formatNumber(model.tokens)}</strong></div>)}
            </section>
            <section className={css['usageSection']}>
              <h3 className={css['sectionTitle']}>MCP 工具</h3>
              <div className={css['metricRow']}><span>联网搜索</span><strong>{formatNumber(dashboard.toolUsage.networkSearch)}</strong></div>
              <div className={css['metricRow']}><span>网页读取</span><strong>{formatNumber(dashboard.toolUsage.webRead)}</strong></div>
              <div className={css['metricRow']}><span>Zread</span><strong>{formatNumber(dashboard.toolUsage.zread)}</strong></div>
            </section>
          </div>
        </>
      )}
    </section>
  )
}
