import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { MiniMaxDashboard, MiniMaxRemainsModel, MiniMaxStatus } from '../../minimax/protocol.ts'
import css from './panel.module.css'
import { ResetBadge } from './reset-badge.tsx'
import { resolveGenericReset, type ResetLevel } from './reset-countdown.ts'

/** MiniMax 页签属性。 */
export interface MiniMaxCodingPlanTabProps {
  api: DevforgeApi
  /** 当前生效的受管凭据引用名（用于面板展示）。 */
  apiKeyEnv: string
  /** 统一 Coding Plan 页面内的内容区域。 */
  section?: 'config' | 'usage'
  /** 嵌入统一工作区时由父容器提供标题与页签。 */
  embedded?: boolean
  /** 状态刷新后回传给统一工作区摘要。 */
  onStatusChange?: (status: MiniMaxStatus) => void
}

/** 一行用量条目：单窗口（5h 或周）的进度条（按已用百分比填充）。 */
function UsageRow({ label, percent, endAt, now, level: windowLevel }: {
  label: string
  percent: number | undefined
  endAt: number | undefined
  now: number
  level: ResetLevel
}): JSX.Element {
  /** percent 是剩余百分比；进度条与颜色按已用百分比展示。 */
  const remaining = Math.max(0, Math.min(100, percent ?? 0))
  const used = 100 - remaining
  const level = used >= 95 ? 'danger' : used >= 80 ? 'warning' : 'normal'
  const resetView = resolveGenericReset(endAt, now, windowLevel)
  return (
    <div className={css['quotaRow']}>
      <div className={css['quotaMeta']}>
        <strong>{label}</strong>
        <span>{used.toFixed(1)}% 已用 · {remaining.toFixed(1)}% 剩余</span>
      </div>
      <div className={css['progressTrack']} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={used}>
        <span className={css['progressFill']} data-level={level} style={{ width: used + '%' }} />
      </div>
      <ResetBadge view={resetView} />
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

/** MiniMax Coding Plan 用量与状态页签。 */
export function MiniMaxCodingPlanTab({ api, apiKeyEnv, section = 'config', embedded = false, onStatusChange }: MiniMaxCodingPlanTabProps): JSX.Element {
  const isConfig = section === 'config'
  const isUsage = section === 'usage'
  const [status, setStatus] = useState<MiniMaxStatus | null>(null)
  const [dashboard, setDashboard] = useState<MiniMaxDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [settingUp, setSettingUp] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [savingKey, setSavingKey] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())
  const mounted = useRef(true)
  const refreshGeneration = useRef(0)
  const refreshController = useRef<AbortController | null>(null)
  const setupController = useRef<AbortController | null>(null)
  const fetchController = useRef<AbortController | null>(null)
  const keyController = useRef<AbortController | null>(null)

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
      const nextDashboard = isUsage && nextStatus.credentialConfigured ? await api.getMiniMaxDashboard(controller.signal) : null
      if (!mounted.current || refreshGeneration.current !== generation) return
      setStatus(nextStatus)
      onStatusChange?.(nextStatus)
      setDashboard(nextDashboard)
    } catch (cause) {
      if (controller.signal.aborted || !mounted.current || refreshGeneration.current !== generation) return
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mounted.current && refreshGeneration.current === generation) setLoading(false)
    }
  }, [api, isUsage, onStatusChange])

  useEffect(() => {
    mounted.current = true
    void refresh()
    return () => {
      mounted.current = false
      refreshGeneration.current += 1
      refreshController.current?.abort()
      setupController.current?.abort()
      fetchController.current?.abort()
      keyController.current?.abort()
    }
  }, [refresh])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

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
      onStatusChange?.(nextStatus)
      if (mounted.current) setNotice({ kind: 'success', text: '模型路由已补齐。' })
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mounted.current) setSettingUp(false)
    }
  }

  const fetchOfficialModels = async (): Promise<void> => {
    if (fetching) return
    fetchController.current?.abort()
    const controller = new AbortController()
    fetchController.current = controller
    setFetching(true)
    setError('')
    try {
      const result = await api.fetchMiniMaxModels(controller.signal)
      if (mounted.current) setStatus(result.status)
      onStatusChange?.(result.status)
      if (mounted.current) setNotice({ kind: 'success', text: '从 MiniMax 官方拉取成功：新增 ' + result.added.length + '、已有 ' + result.kept.length + '，合计 ' + result.total + '。' })
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mounted.current) setFetching(false)
    }
  }

  const saveKey = async (): Promise<void> => {
    const value = keyDraft.trim()
    if (value === '') { setNotice({ kind: 'error', text: 'API Key 不能为空。' }); return }
    keyController.current?.abort()
    const controller = new AbortController()
    keyController.current = controller
    setSavingKey(true)
    setError('')
    try {
      await api.setCredential(apiKeyEnv, value)
      setKeyDraft('')
      if (mounted.current) setNotice({ kind: 'success', text: 'API Key 已保存到 ' + apiKeyEnv + '。' })
      await refresh()
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current) setNotice({ kind: 'error', text: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      if (mounted.current) setSavingKey(false)
    }
  }

  const modelsReady = useMemo(() => status?.providerConfigured === true && status.models.length > 0 && status.models.every((model) => model.configured), [status])
  const visibleModels: MiniMaxRemainsModel[] = useMemo(() => (dashboard?.models ?? []).filter((model) => model.included), [dashboard])

  return (
    <section className={css['zhipuWorkspace']}>
      {!embedded && <div className={css['integrationHeader']}>
        <span className={css['connectionDot']} data-state={status?.credentialConfigured === true ? 'connected' : 'error'} />
        <div className={css['resourceInfo']}>
          <strong className={css['resourceTitle']}>MiniMax Coding Plan{dashboard?.planName !== undefined ? ' · ' + dashboard.planName : ''}</strong>
          <span className={css['resourceMeta']}>{status?.credentialConfigured === true ? '官方凭据已配置' : '等待配置 MINIMAX_CN_API_KEY'} · {modelsReady ? '模型已就绪' : '模型待完善'} · {status?.tools !== false ? '官方工具已启用' : '官方工具已关闭'}</span>
        </div>
        {!modelsReady && <button type="button" className={css['ghostButton']} disabled={settingUp} onClick={() => { void setupModels() }}>{settingUp ? '正在配置…' : '完善模型接入'}</button>}
        <button type="button" className={css['ghostButton']} disabled={loading} onClick={() => { void refresh() }}>{loading ? '刷新中…' : '刷新'}</button>
      </div>}

      {error !== '' && <div className={css['banner']} data-kind="error">{error}</div>}
      {notice !== null && <div className={css['banner']} data-kind={notice.kind === 'success' ? 'success' : 'error'}>{notice.text}<button type="button" className={css['ghostButton']} onClick={() => setNotice(null)}>关闭</button></div>}
      {loading && status === null && <div className={css['empty']} data-loading="">正在读取 MiniMax{isUsage ? '套餐用量' : '配置状态'}…</div>}

      {isConfig && <>
      <section className={css['usageSection']}>
        <h3 className={css['sectionTitle']}>API Key 配置</h3>
        <div className={css['metricRow']}><span>受管凭据引用</span><strong>{apiKeyEnv}</strong></div>
        <div className={css['keyInputRow']}>
          <input
            type="password"
            className={css['keyInput']}
            placeholder={status?.credentialConfigured === true ? '已配置 · 输入新 Key 可覆盖' : '粘贴 MINIMAX_CN_API_KEY（订阅 Key）'}
            value={keyDraft}
            onChange={(event) => { setKeyDraft(event.target.value); setNotice(null) }}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className={css['ghostButton']} disabled={savingKey || keyDraft.trim() === ''} onClick={() => { void saveKey() }}>{savingKey ? '保存中…' : '保存 Key'}</button>
        </div>
      </section>

      <section className={css['usageSection']}>
        <h3 className={css['sectionTitle']}>模型路由（minimax-cn）</h3>
        <div className={css['modelToolbar']}>
          <button type="button" className={css['ghostButton']} disabled={fetching || !status?.credentialConfigured} onClick={() => { void fetchOfficialModels() }} title="调官方 /v1/models 拉取最新模型并合并进 provider">{fetching ? '拉取中…' : '从官方拉取模型'}</button>
        </div>
        {status?.models.length === 0 ? (
          <div className={css['empty']}>尚未配置任何模型。</div>
        ) : (
          status?.models.map((model) => (
            <div key={model.id} className={css['metricRow']}>
              <span>{model.id}</span>
              <strong data-state={model.configured ? 'ok' : 'pending'}>{model.configured ? '已就绪' : '待补齐'}</strong>
            </div>
          ))
        )}
      </section>

      {status !== null && !status.credentialConfigured && <div className={css['banner']} data-kind="warning">请先在上方 API Key 配置区填写 MINIMAX_CN_API_KEY（必须使用订阅 Key，不能使用普通按量付费 API Key）。</div>}

      <section className={css['usageSection']}>
        <h3 className={css['sectionTitle']}>官方工具</h3>
        <div className={css['metricRow']}><span>minimax_web_search</span><strong>{status?.tools !== false ? '已启用' : '已关闭'}</strong></div>
        <div className={css['metricRow']}><span>minimax_understand_image</span><strong>{status?.tools !== false ? '已启用' : '已关闭'}</strong></div>
        <div className={css['metricRow']}><span>minimax_image_generation</span><strong>{status?.tools !== false ? '已启用' : '已关闭'}</strong></div>
        <div className={css['metricRow']}><span>minimax_text_to_speech</span><strong>{status?.tools !== false ? '已启用' : '已关闭'}</strong></div>
        <div className={css['metricRow']}><span>minimax_video_generation</span><strong>{status?.tools !== false ? '已启用' : '已关闭'}</strong></div>
        <div className={css['metricRow']}><span>模型端点</span><strong>api.minimaxi.com</strong></div>
      </section>
      </>}

      {isUsage && status !== null && !status.credentialConfigured && <div className={css['banner']} data-kind="warning">尚未配置 API Key，请切换到“使用配置”填写 MINIMAX_CN_API_KEY。</div>}
      {isUsage && dashboard !== null && dashboard.warnings.map((warning) => <div key={warning} className={css['banner']} data-kind="warning">{warning}</div>)}
      {isUsage && dashboard !== null && visibleModels.length > 0 && (
        <div className={css['quotaList']}>
          {visibleModels.flatMap((model) => [
            model.intervalRemainingPercent !== undefined ? (
              <UsageRow key={model.name + '-interval'} label={modelLabel(model.name) + ' · 5 小时窗口'} percent={model.intervalRemainingPercent} endAt={model.intervalEndAt} now={now} level="short-window" />
            ) : null,
            model.weeklyRemainingPercent !== undefined ? (
              <UsageRow key={model.name + '-week'} label={modelLabel(model.name) + ' · 每周窗口'} percent={model.weeklyRemainingPercent} endAt={model.weeklyEndAt} now={now} level="weekly" />
            ) : null,
          ])}
        </div>
      )}
      {isUsage && dashboard !== null && visibleModels.length === 0 && dashboard.warnings.length === 0 && <div className={css['banner']} data-kind="warning">当前订阅未包含用量接口覆盖的资源类型。</div>}
    </section>
  )
}
