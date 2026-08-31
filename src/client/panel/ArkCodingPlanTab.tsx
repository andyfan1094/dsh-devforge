import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { ArkAfpLimit, ArkDashboard, ArkStatus } from '../../ark/protocol.ts'
import css from './panel.module.css'

/** 火山方舟页签属性。 */
export interface ArkCodingPlanTabProps {
  api: DevforgeApi
  apiKeyEnv: string
  accessKeyEnv: string
  secretKeyEnv: string
  section?: 'config' | 'usage'
  embedded?: boolean
  onStatusChange?: (status: ArkStatus) => void
}

/** AFP 窗口中文名。 */
function periodLabel(period: ArkAfpLimit['period']): string {
  if (period === 'fiveHour') return '近 5 小时 AFP'
  if (period === 'daily') return '近一天 AFP'
  if (period === 'weekly') return '近一周 AFP'
  return '近一月 AFP'
}

/** 时间戳转短重置倒计时。 */
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

/** AFP 用量条，进度按已用比例填充。 */
function AfpRow({ limit, now }: { limit: ArkAfpLimit; now: number }): JSX.Element {
  const usedPercent = limit.quota > 0 ? Math.min(100, Math.max(0, limit.used / limit.quota * 100)) : 0
  const level = usedPercent >= 95 ? 'danger' : usedPercent >= 80 ? 'warning' : 'normal'
  return (
    <div className={css['quotaRow']}>
      <div className={css['quotaMeta']}>
        <strong>{periodLabel(limit.period)}</strong>
        <span>{limit.used.toLocaleString('zh-CN', { maximumFractionDigits: 1 })} / {limit.quota.toLocaleString('zh-CN', { maximumFractionDigits: 1 })} AFP · 已使用 {usedPercent.toFixed(1)}% · {formatCountdown(limit.resetTime, now)}</span>
      </div>
      <div className={css['progressTrack']} role="progressbar" aria-label={periodLabel(limit.period)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={usedPercent}>
        <span className={css['progressFill']} data-level={level} style={{ width: usedPercent + '%' }} />
      </div>
    </div>
  )
}

/** 火山方舟 Agent/Coding Plan 的配置与 AFP 用量页面。 */
export function ArkCodingPlanTab({ api, apiKeyEnv, accessKeyEnv, secretKeyEnv, section = 'config', embedded = false, onStatusChange }: ArkCodingPlanTabProps): JSX.Element {
  const isConfig = section === 'config'
  const isUsage = section === 'usage'
  const [status, setStatus] = useState<ArkStatus | null>(null)
  const [dashboard, setDashboard] = useState<ArkDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [accessKeyDraft, setAccessKeyDraft] = useState('')
  const [secretKeyDraft, setSecretKeyDraft] = useState('')
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())
  const mounted = useRef(true)
  const refreshGeneration = useRef(0)
  const refreshController = useRef<AbortController | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const generation = refreshGeneration.current + 1
    refreshGeneration.current = generation
    refreshController.current?.abort()
    const controller = new AbortController()
    refreshController.current = controller
    setLoading(true)
    setError('')
    try {
      const nextStatus = await api.getArkStatus(controller.signal)
      const nextDashboard = isUsage && nextStatus.managementCredentialsConfigured ? await api.getArkDashboard(controller.signal) : null
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
    }
  }, [refresh])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const saveCredential = async (ref: string, value: string, label: string): Promise<void> => {
    const trimmed = value.trim()
    if (trimmed === '') { setNotice({ kind: 'error', text: label + '不能为空。' }); return }
    setSaving(ref)
    setError('')
    try {
      await api.setCredential(ref, trimmed)
      if (ref === apiKeyEnv) {
        setApiKeyDraft('')
        const nextStatus = await api.setupArkModels()
        if (mounted.current) {
          setStatus(nextStatus)
          onStatusChange?.(nextStatus)
          setNotice({ kind: 'success', text: 'Plan API Key 已保存，ark-code-latest 已就绪。' })
        }
        return
      }
      if (ref === accessKeyEnv) setAccessKeyDraft('')
      if (ref === secretKeyEnv) setSecretKeyDraft('')
      if (mounted.current) setNotice({ kind: 'success', text: label + '已保存到 ' + ref + '。' })
      await refresh()
    } catch (cause) {
      if (mounted.current) setNotice({ kind: 'error', text: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      if (mounted.current) setSaving(null)
    }
  }

  const fetchOfficialModels = async (): Promise<void> => {
    if (fetching) return
    setFetching(true)
    setError('')
    try {
      const result = await api.fetchArkModels()
      if (mounted.current) setStatus(result.status)
      onStatusChange?.(result.status)
      if (mounted.current) setNotice({ kind: 'success', text: '从方舟官方拉取成功：新增 ' + result.added.length + '、已有 ' + result.kept.length + '，合计 ' + result.total + '。' })
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mounted.current) setFetching(false)
    }
  }

  const modelsReady = useMemo(() => status?.providerConfigured === true && status.models.length > 0 && status.models.every((model) => model.configured), [status])

  return (
    <section className={css['zhipuWorkspace']}>
      {!embedded && <div className={css['integrationHeader']}>
        <span className={css['connectionDot']} data-state={status?.credentialConfigured === true ? 'connected' : 'error'} />
        <div className={css['resourceInfo']}>
          <strong className={css['resourceTitle']}>火山方舟 Agent/Coding Plan</strong>
          <span className={css['resourceMeta']}>{status?.credentialConfigured ? 'Plan 数据面 Key 已配置' : '等待配置 Plan Key'} · {modelsReady ? '模型已就绪' : '模型待完善'} · {status?.managementCredentialsConfigured ? 'AFP 管控面已配置' : 'AFP 管控面待配置'}</span>
        </div>
        <button type="button" className={css['ghostButton']} disabled={loading} onClick={() => { void refresh() }}>{loading ? '刷新中…' : '刷新'}</button>
      </div>}

      {error !== '' && <div className={css['banner']} data-kind="error">{error}</div>}
      {notice !== null && <div className={css['banner']} data-kind={notice.kind === 'success' ? 'success' : 'error'}>{notice.text}<button type="button" className={css['ghostButton']} onClick={() => setNotice(null)}>关闭</button></div>}
      {loading && status === null && <div className={css['empty']} data-loading="">正在读取火山方舟{isUsage ? ' AFP 用量' : '配置状态'}…</div>}

      {isConfig && <>
        <section className={css['usageSection']}>
          <h3 className={css['sectionTitle']}>Plan 数据面 API Key</h3>
          <div className={css['metricRow']}><span>受管凭据引用</span><strong>{apiKeyEnv}</strong></div>
          <div className={css['keyInputRow']}>
            <input type="password" className={css['keyInput']} placeholder={status?.credentialConfigured ? '已配置 · 输入新 Key 可覆盖' : '粘贴 ark- 开头的 Agent/Coding Plan Key'} value={apiKeyDraft} onChange={(event) => { setApiKeyDraft(event.target.value); setNotice(null) }} autoComplete="off" spellCheck={false} />
            <button type="button" className={css['ghostButton']} disabled={saving === apiKeyEnv || apiKeyDraft.trim() === ''} onClick={() => { void saveCredential(apiKeyEnv, apiKeyDraft, 'Plan API Key') }}>{saving === apiKeyEnv ? '保存中…' : '保存 Key'}</button>
          </div>
          <p className={css['planInfoHint']}>默认模型 <code>ark-code-latest</code>；OpenAI / Responses Base URL 固定为 <code>https://ark.cn-beijing.volces.com/api/plan/v3</code>，不会使用可能额外计费的普通 <code>/api/v3</code>。</p>
        </section>

        <section className={css['usageSection']}>
          <h3 className={css['sectionTitle']}>模型路由</h3>
          {status?.models.length === 0 ? <div className={css['empty']}>保存 Plan API Key 后会自动配置 <code>ark-code-latest</code>。</div> : status?.models.map((model) => <div key={model.id} className={css['metricRow']}><span>{model.id}</span><strong data-state={model.configured ? 'ok' : 'pending'}>{model.configured ? '已就绪' : '待保存 Plan Key'}</strong></div>)}
          <p className={css['planInfoHint']}>Plan 数据面不提供模型枚举接口。日常调用只需一个 Plan API Key，保存后会自动启用 <code>ark-code-latest</code>。</p>
        </section>

        <details className={css['arkAdvanced']}>
          <summary>高级管理：官方模型清单与 AFP 统计（可选）</summary>
          <div className={css['arkAdvancedContent']}>
            <p className={css['planInfoHint']}>完整官方模型清单和套餐 AFP 统计属于火山云管控面，官方规定必须由一对 AK/SK 做签名认证。它们不影响 Coding Plan 的普通模型调用。</p>
            <div className={css['metricRow']}><span>Access Key 引用</span><strong>{accessKeyEnv}</strong></div>
            <div className={css['keyInputRow']}>
              <input type="password" className={css['keyInput']} placeholder="粘贴火山云 Access Key ID" value={accessKeyDraft} onChange={(event) => { setAccessKeyDraft(event.target.value); setNotice(null) }} autoComplete="off" spellCheck={false} />
              <button type="button" className={css['ghostButton']} disabled={saving === accessKeyEnv || accessKeyDraft.trim() === ''} onClick={() => { void saveCredential(accessKeyEnv, accessKeyDraft, 'Access Key ID') }}>{saving === accessKeyEnv ? '保存中…' : '保存 AK'}</button>
            </div>
            <div className={css['metricRow']}><span>Secret Key 引用</span><strong>{secretKeyEnv}</strong></div>
            <div className={css['keyInputRow']}>
              <input type="password" className={css['keyInput']} placeholder="粘贴火山云 Secret Access Key" value={secretKeyDraft} onChange={(event) => { setSecretKeyDraft(event.target.value); setNotice(null) }} autoComplete="off" spellCheck={false} />
              <button type="button" className={css['ghostButton']} disabled={saving === secretKeyEnv || secretKeyDraft.trim() === ''} onClick={() => { void saveCredential(secretKeyEnv, secretKeyDraft, 'Secret Access Key') }}>{saving === secretKeyEnv ? '保存中…' : '保存 SK'}</button>
            </div>
            {status?.managementCredentialsConfigured
              ? <button type="button" className={css['ghostButton']} disabled={fetching} onClick={() => { void fetchOfficialModels() }}>{fetching ? '同步中…' : '同步完整官方模型清单'}</button>
              : <p className={css['planInfoHint']}>配置并保存 AK/SK 后，可同步完整官方模型清单并在“用量统计”查看 AFP。</p>}
          </div>
        </details>
      </>}

      {isUsage && !status?.managementCredentialsConfigured && <div className={css['banner']} data-kind="warning">AFP 用量需要火山云 AK/SK。请切换到“使用配置”保存 Access Key ID 和 Secret Access Key。</div>}
      {isUsage && dashboard !== null && <>
        {dashboard.warnings.map((warning) => <div key={warning} className={css['banner']} data-kind="warning">{warning}</div>)}
        <div className={css['quotaHeader']}>
          <div><span className={css['sectionHint']}>套餐类型</span><strong>{dashboard.planType ?? '未知'}</strong></div>
          <span className={css['toolbarSpacer']} />
          <span className={css['sectionHint']}>更新于 {new Date(dashboard.fetchedAt).toLocaleTimeString('zh-CN')}</span>
        </div>
        <div className={css['quotaList']}>
          {dashboard.limits.map((limit) => <AfpRow key={limit.period} limit={limit} now={now} />)}
        </div>
      </>}
    </section>
  )
}
