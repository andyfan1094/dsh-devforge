import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { MiniMaxDashboard, MiniMaxRemainsModel, MiniMaxStatus } from '../../minimax/protocol.ts'
import css from './panel.module.css'

/** MiniMax 页签属性。 */
export interface MiniMaxCodingPlanTabProps {
  api: DevforgeApi
}

/** 把时间戳转成中文短倒计时（不足 1 天显示 h/分，否则显示 x 天 y 小时）。 */
function formatCountdown(timestamp: number | undefined, now: number): string {
  if (timestamp === undefined) return '重置时间未知'
  const remaining = Math.max(0, timestamp - now)
  const minutes = Math.ceil(remaining / 60_000)
  if (minutes <= 0) return '即将重置'
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return days + ' 天 ' + hours + ' 小时后重置'
  if (hours > 0) return hours + ' 小时 ' + mins + ' 分钟后重置'
  return mins + ' 分钟后重置'
}

/** 一行用量条目：单窗口（5h 或周）的进度条。 */
function UsageRow({ label, percent, endAt, now }: { label: string; percent: number | undefined; endAt: number | undefined; now: number }): JSX.Element {
  const value = Math.max(0, Math.min(100, percent ?? 0))
  const level = value >= 95 ? 'danger' : value >= 80 ? 'warning' : 'normal'
  return (
    <div className={css['quotaRow']}>
      <div className={css['quotaMeta']}>
        <strong>{label}</strong>
        <span>{(100 - value).toFixed(1)}% 已用 · {value.toFixed(1)}% 剩余 · {formatCountdown(endAt, now)}</span>
      </div>
      <div className={css['progressTrack']} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
        <span className={css['progressFill']} data-level={level} style={{ width: value + '%' }} />
      </div>
    </div>
  )
}

/** 资源类型中文名（MiniMax 套餐里常见分类）。 */
function modelLabel(name: string): string {
  if (name === 'general') return '文本模型'
  if (name === 'video') return '视频生成'
  if (name === 'tts' || name === 'speech') return '语音合成'
  if (name === 'image') return '图像生成'
  if (name === 'music') return '音乐生成'
  return name
}

/**
 * MiniMax Coding Plan 用量与状态页签。
 * 套餐用量接口已实测可用（GET /v1/token_plan/remains，Bearer 订阅 Key）；
 * 这里同时展示凭据、模型路由与官方 5h/周双窗口用量。
 */
export function MiniMaxCodingPlanTab({ api }: MiniMaxCodingPlanTabProps): JSX.Element {
  const [status, setStatus] = useState<MiniMaxStatus | null>(null)
  const [dashboard, setDashboard] = useState<MiniMaxDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [settingUp, setSettingUp] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())
  const mounted = useRef(true)
  const refreshGeneration = useRef(0)
  const refreshController = useRef<AbortController | null>(null)
  const setupController = useRef<AbortController | null>(null)

  /** 同时读取脱敏状态与官方用量；Key 永不进入浏览器。 */
  const refresh = useCallback(async (): Promise<void> => {
    const generation = refreshGeneration.current + 1
    refreshGeneration.current = generation
    refreshController.current?.abort()
    const controller = new AbortController()
    refreshController.current = controller
    setLoading(true)
    setError('')
    try {
      const nextStatus = await api.getMiniMaxStatus(controller.signal)
      const nextDashboard = nextStatus.credentialConfigured ? await api.getMiniMaxDashboard(controller.signal) : null
      if (!mounted.current || refreshGeneration.current !== generation) return
      setStatus(nextStatus)
      setDashboard(nextDashboard)
    } catch (cause) {
      if (controller.signal.aborted || !mounted.current || refreshGeneration.current !== generation) return
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mounted.current && refreshGeneration.current === generation) setLoading(false)
    }
  }, [api])

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

  /** 一键补齐 minimax-cn provider 与最新模型，不覆盖已有字段。 */
  const setupModels = async (): Promise<void> => {
    if (settingUp) return
    setupController.current?.abort()
    const controller = new AbortController()
    setupController.current = controller
    setSettingUp(true)
    setError('')
    try {
      const nextStatus = await api.setupMiniMaxModels(controller.signal)
      if (mounted.current) setStatus(nextStatus)
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mounted.current) setSettingUp(false)
    }
  }

  const modelsReady = useMemo(() => status?.providerConfigured === true && status.models.length > 0 && status.models.every((model) => model.configured), [status])
  const visibleModels: MiniMaxRemainsModel[] = useMemo(() => (dashboard?.models ?? []).filter((model) => model.included), [dashboard])

  return (
    <section className={css['zhipuWorkspace']}>
      <div className={css['integrationHeader']}>
        <span className={css['connectionDot']} data-state={status?.credentialConfigured === true ? 'connected' : 'error'} />
        <div className={css['resourceInfo']}>
          <strong className={css['resourceTitle']}>MiniMax Coding Plan{dashboard?.planName !== undefined ? ' · ' + dashboard.planName : ''}</strong>
          <span className={css['resourceMeta']}>{status?.credentialConfigured === true ? '官方凭据已配置' : '等待配置 MINIMAX_CN_API_KEY'} · {modelsReady ? '模型已就绪' : '模型待完善'} · {status?.tools !== false ? '官方工具已启用' : '官方工具已关闭'}</span>
        </div>
        {!modelsReady && <button type="button" className={css['ghostButton']} disabled={settingUp} onClick={() => { void setupModels() }}>{settingUp ? '正在配置…' : '完善模型接入'}</button>}
        <button type="button" className={css['ghostButton']} disabled={loading} onClick={() => { void refresh() }}>{loading ? '刷新中…' : '刷新'}</button>
      </div>

      {error !== '' && <div className={css['banner']} data-kind="error">{error}</div>}
      {loading && status === null && <div className={css['empty']} data-loading="">正在读取 MiniMax 状态…</div>}
      {!loading && status?.credentialConfigured !== true && <div className={css['banner']} data-kind="warning">请先在 DSH 凭据中配置 MINIMAX_CN_API_KEY（用量接口必须使用订阅 Key，不能使用普通按量付费 API Key）。</div>}

      {status !== null && (
        <div className={css['usageGrid']}>
          <section className={css['usageSection']}>
            <h3 className={css['sectionTitle']}>模型路由（minimax-cn）</h3>
            {status.models.map((model) => (
              <div key={model.id} className={css['metricRow']}>
                <span>{model.id}</span>
                <strong data-state={model.configured ? 'ok' : 'pending'}>{model.configured ? '已就绪' : '待补齐'}</strong>
              </div>
            ))}
          </section>
          <section className={css['usageSection']}>
            <h3 className={css['sectionTitle']}>官方工具</h3>
            <div className={css['metricRow']}><span>minimax_web_search</span><strong>{status.tools ? '已启用' : '已关闭'}</strong></div>
            <div className={css['metricRow']}><span>minimax_understand_image</span><strong>{status.tools ? '已启用' : '已关闭'}</strong></div>
            <div className={css['metricRow']}><span>模型端点</span><strong>api.minimaxi.com</strong></div>
          </section>
        </div>
      )}

      {dashboard !== null && dashboard.warnings.map((warning) => <div key={warning} className={css['banner']} data-kind="warning">{warning}</div>)}
      {dashboard !== null && visibleModels.length > 0 && (
        <>
          <div className={css['quotaHeader']}>
            <div><span className={css['sectionHint']}>套餐用量</span><strong>{dashboard.planName ?? '订阅 Key'}</strong></div>
            <span className={css['toolbarSpacer']} />
            <span className={css['sectionHint']}>更新于 {new Date(dashboard.fetchedAt).toLocaleTimeString('zh-CN')}</span>
          </div>
          <div className={css['quotaList']}>
            {visibleModels.flatMap((model) => [
              model.intervalRemainingPercent !== undefined ? (
                <UsageRow key={model.name + '-interval'} label={modelLabel(model.name) + ' · 5 小时窗口'} percent={model.intervalRemainingPercent} endAt={model.intervalEndAt} now={now} />
              ) : null,
              model.weeklyRemainingPercent !== undefined ? (
                <UsageRow key={model.name + '-week'} label={modelLabel(model.name) + ' · 每周窗口'} percent={model.weeklyRemainingPercent} endAt={model.weeklyEndAt} now={now} />
              ) : null,
            ])}
          </div>
        </>
      )}
      {dashboard !== null && visibleModels.length === 0 && dashboard.warnings.length === 0 && <div className={css['banner']} data-kind="warning">当前订阅未包含用量接口覆盖的资源类型。</div>}
    </section>
  )
}
