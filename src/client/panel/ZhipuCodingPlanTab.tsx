import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { ZhipuDashboard, ZhipuQuotaLimit, ZhipuStatus, ZhipuUsageWindow } from '../../zhipu/protocol.ts'
import css from './panel.module.css'
import { ResetBadge } from './reset-badge.tsx'
import { resolveZhipuReset } from './reset-countdown.ts'

/** 智谱页签属性。 */
export interface ZhipuCodingPlanTabProps {
  api: DevforgeApi
  /** 当前生效的受管凭据引用名（用于面板展示）。 */
  apiKeyEnv: string
  /** 统一 Coding Plan 页面内的内容区域。 */
  section?: 'config' | 'usage'
  /** 嵌入统一工作区时由父容器提供标题与页签。 */
  embedded?: boolean
  /** 状态刷新后回传给统一工作区摘要。 */
  onStatusChange?: (status: ZhipuStatus) => void
}

/** 格式化数量，避免大 Token 数撑破布局。 */
function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', { notation: value >= 100_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
}

/** 额度类型中文名。 */
function quotaLabel(kind: ZhipuQuotaLimit['kind']): string {
  if (kind === 'tokens-5h') return '5 小时 Token'
  if (kind === 'tokens-week') return '每周 Token'
  if (kind === 'tools-month') return '本月 MCP 工具'
  return '其他额度'
}

/** 智谱 Coding Plan 模型与官方用量面板。 */
export function ZhipuCodingPlanTab({ api, apiKeyEnv, section = 'config', embedded = false, onStatusChange }: ZhipuCodingPlanTabProps): JSX.Element {
  const isConfig = section === 'config'
  const isUsage = section === 'usage'
  const [status, setStatus] = useState<ZhipuStatus | null>(null)
  const [dashboard, setDashboard] = useState<ZhipuDashboard | null>(null)
  const [usageWindow, setUsageWindow] = useState<ZhipuUsageWindow>('day')
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
      const nextDashboard = isUsage && nextStatus.credentialConfigured ? await api.getZhipuDashboard(usageWindow, controller.signal) : null
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
  }, [api, isUsage, onStatusChange, usageWindow])

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

  /** 一键补齐 provider 和硬编码的 GLM-5.3/Flash（用于初次接入）。 */
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
      onStatusChange?.(nextStatus)
      if (mounted.current) setNotice({ kind: 'success', text: '模型路由已补齐。' })
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mounted.current) setSettingUp(false)
    }
  }

  /** 调官方 /v4/models 拉取最新模型清单，合并进 provider。 */
  const fetchOfficialModels = async (): Promise<void> => {
    if (fetching) return
    fetchController.current?.abort()
    const controller = new AbortController()
    fetchController.current = controller
    setFetching(true)
    setError('')
    try {
      const result = await api.fetchZhipuModels(controller.signal)
      if (mounted.current) setStatus(result.status)
      onStatusChange?.(result.status)
      if (mounted.current) setNotice({ kind: 'success', text: '从智谱官方拉取成功：新增 ' + result.added.length + '、已有 ' + result.kept.length + '，合计 ' + result.total + '。' })
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mounted.current) setFetching(false)
    }
  }

  /** 把面板输入的 Key 写入受管凭据；写入成功后仅刷新状态，不在面板显示明文。 */
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

  return (
    <section className={css['zhipuWorkspace']}>
      {!embedded && <div className={css['integrationHeader']}>
        <span className={css['connectionDot']} data-state={status?.credentialConfigured === true ? 'connected' : 'error'} />
        <div className={css['resourceInfo']}>
          <strong className={css['resourceTitle']}>智谱 Coding Plan</strong>
          <span className={css['resourceMeta']}>{status?.credentialConfigured === true ? '官方凭据已配置' : '等待配置 ZAI_CODING_CN_API_KEY'} · {modelsReady ? '模型已就绪' : '模型待完善'} · {status?.mcpTools !== false ? '官方 MCP 工具已启用' : '官方 MCP 工具已关闭'}</span>
        </div>
        {!modelsReady && <button type="button" className={css['ghostButton']} disabled={settingUp} onClick={() => { void setupModels() }}>{settingUp ? '正在配置…' : '完善模型接入'}</button>}
        <button type="button" className={css['ghostButton']} disabled={loading} onClick={() => { void refresh() }}>{loading ? '刷新中…' : '刷新'}</button>
      </div>}

      {error !== '' && <div className={css['banner']} data-kind="error">{error}</div>}
      {notice !== null && <div className={css['banner']} data-kind={notice.kind === 'success' ? 'success' : 'error'}>{notice.text}<button type="button" className={css['ghostButton']} onClick={() => setNotice(null)}>关闭</button></div>}
      {loading && status === null && <div className={css['empty']} data-loading="">正在读取智谱{isUsage ? '官方额度' : '配置状态'}…</div>}

      {isConfig && <>
      <section className={css['usageSection']}>
        <h3 className={css['sectionTitle']}>API Key 配置</h3>
        <div className={css['metricRow']}><span>受管凭据引用</span><strong>{apiKeyEnv}</strong></div>
        <div className={css['keyInputRow']}>
          <input
            type="password" autoComplete="new-password"
            className={css['keyInput']}
            placeholder={status?.credentialConfigured === true ? '已配置 · 输入新 Key 可覆盖' : '粘贴 ZAI_CODING_CN_API_KEY'}
            value={keyDraft}
            onChange={(event) => { setKeyDraft(event.target.value); setNotice(null) }}
            spellCheck={false}
          />
          <button type="button" className={css['ghostButton']} disabled={savingKey || keyDraft.trim() === ''} onClick={() => { void saveKey() }}>{savingKey ? '保存中…' : '保存 Key'}</button>
        </div>
      </section>

      <section className={css['usageSection']}>
        <h3 className={css['sectionTitle']}>模型路由（zai-coding-cn）</h3>
        <div className={css['modelToolbar']}>
          <button type="button" className={css['ghostButton']} disabled={fetching || !status?.credentialConfigured} onClick={() => { void fetchOfficialModels() }} title="调官方 /v4/models 拉取最新模型并合并进 provider">{fetching ? '拉取中…' : '从官方拉取模型'}</button>
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

      {status !== null && !status.credentialConfigured && <div className={css['banner']} data-kind="warning">请先在上方 API Key 配置区填写 ZAI_CODING_CN_API_KEY。</div>}
      </>}

      {isUsage && status !== null && !status.credentialConfigured && <div className={css['banner']} data-kind="warning">尚未配置 API Key，请切换到“使用配置”填写 ZAI_CODING_CN_API_KEY。</div>}

      {isUsage && dashboard !== null && (
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
                    <span>{usedPercent.toFixed(1)}% 已用 · {(100 - usedPercent).toFixed(1)}% 剩余</span>
                  </div>
                  <div className={css['progressTrack']} role="progressbar" aria-label={quotaLabel(limit.kind)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={usedPercent}>
                    <span className={css['progressFill']} data-level={usedPercent >= 95 ? 'danger' : usedPercent >= 80 ? 'warning' : 'normal'} style={{ width: usedPercent + '%' }} />
                  </div>
                  <ResetBadge view={resolveZhipuReset(limit.nextResetTime, now, limit.kind)} />
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
