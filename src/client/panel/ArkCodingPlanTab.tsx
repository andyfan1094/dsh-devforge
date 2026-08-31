import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { ArkStatus, ArkUsageDashboard, ArkUsagePeriod, ArkUsageProduct } from '../../ark/protocol.ts'
import css from './panel.module.css'
import { ResetBadge } from './reset-badge.tsx'
import { resolveArkReset } from './reset-countdown.ts'

/** 火山方舟页签属性。 */
export interface ArkCodingPlanTabProps {
  api: DevforgeApi
  apiKeyEnv: string
  section?: 'config' | 'usage'
  embedded?: boolean
  onStatusChange?: (status: ArkStatus) => void
}

const ARK_USAGE_CONSOLE = 'https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement?LLM=%7B%7D&advancedActiveKey=agentPlan'
const VOLC_KEY_CONSOLE = 'https://console.volcengine.com/iam/keymanage/'

/** 套餐种类中文名。 */
function productLabel(product: ArkUsageProduct): string {
  return product === 'agent-plan' ? 'Agent Plan' : 'Coding Plan'
}

/** 额度周期中文名。 */
function periodLabel(level: string): string {
  if (level === '5h' || level === 'session') return '5 小时窗口'
  if (level === 'weekly' || level === 'week') return '每周窗口'
  if (level === 'monthly' || level === 'month') return '每月窗口'
  return level
}

/** 格式化 Agent Plan 返回的绝对额度值。 */
function formatAmount(value: number): string {
  return new Intl.NumberFormat('zh-CN', { notation: value >= 100_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
}

/** 单个额度周期：展示已用、剩余、绝对量与重置倒计时。 */
function UsageRow({ period, now }: { period: ArkUsagePeriod; now: number }): JSX.Element {
  const hasAbsolutePercent = period.used !== undefined && period.total !== undefined && period.total > 0
  const calculated = hasAbsolutePercent ? (period.used as number) / (period.total as number) * 100 : undefined
  const rawPercent = period.usedPercent ?? calculated
  const usedPercent = rawPercent === undefined ? 0 : Math.max(0, Math.min(100, rawPercent))
  const remainingPercent = 100 - usedPercent
  const amount = period.used !== undefined && period.total !== undefined
    ? ' · ' + formatAmount(period.used) + ' / ' + formatAmount(period.total)
    : ''
  const summary = rawPercent === undefined
    ? '用量比例未知' + amount
    : usedPercent.toFixed(1) + '% 已用 · ' + remainingPercent.toFixed(1) + '% 剩余' + amount
  const level = usedPercent >= 95 ? 'danger' : usedPercent >= 80 ? 'warning' : 'normal'
  const resetView = resolveArkReset(period, now)
  return (
    <div className={css['quotaRow']}>
      <div className={css['quotaMeta']}>
        <strong>{periodLabel(period.level)}</strong>
        <span>{summary}</span>
      </div>
      <div className={css['progressTrack']} role="progressbar" aria-label={periodLabel(period.level)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={rawPercent === undefined ? undefined : usedPercent}>
        <span className={css['progressFill']} data-level={level} style={{ width: usedPercent + '%' }} />
      </div>
      <ResetBadge view={resetView} />
    </div>
  )
}

/** 火山方舟 Agent Plan 的数据面配置、推理档位与控制面用量看板。 */
export function ArkCodingPlanTab({ api, apiKeyEnv, section = 'config', embedded = false, onStatusChange }: ArkCodingPlanTabProps): JSX.Element {
  const isConfig = section === 'config'
  const isUsage = section === 'usage'
  const [status, setStatus] = useState<ArkStatus | null>(null)
  const [dashboard, setDashboard] = useState<ArkUsageDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [savingKey, setSavingKey] = useState(false)
  const [savingUsageKeys, setSavingUsageKeys] = useState(false)
  const [refreshingUsage, setRefreshingUsage] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [accessKeyDraft, setAccessKeyDraft] = useState('')
  const [secretKeyDraft, setSecretKeyDraft] = useState('')
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())
  const mounted = useRef(true)
  const refreshGeneration = useRef(0)
  const refreshController = useRef<AbortController | null>(null)

  const applyStatus = useCallback((next: ArkStatus): void => {
    setStatus(next)
    onStatusChange?.(next)
  }, [onStatusChange])

  /** 写操作和手动刷新前取消旧后台刷新，避免旧快照覆盖新结果。 */
  const cancelBackgroundRefresh = (): void => {
    refreshGeneration.current += 1
    refreshController.current?.abort()
    setLoading(false)
  }

  /** 先读取脱敏凭据状态；AK/SK 齐全时再读取 Host 缓存的套餐用量。 */
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
      if (!mounted.current || refreshGeneration.current !== generation) return
      applyStatus(nextStatus)
      const usageConfigured = nextStatus.usageAccessKeyConfigured && nextStatus.usageSecretKeyConfigured
      const nextDashboard = isUsage && usageConfigured ? await api.getArkDashboard(controller.signal) : null
      if (!mounted.current || refreshGeneration.current !== generation) return
      setDashboard(nextDashboard)
    } catch (cause) {
      if (controller.signal.aborted || !mounted.current || refreshGeneration.current !== generation) return
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mounted.current && refreshGeneration.current === generation) setLoading(false)
    }
  }, [api, applyStatus, isUsage])

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

  /** 补齐模型路由以及旧模型记录缺失的 reasoningEfforts。 */
  const syncModels = async (): Promise<void> => {
    if (syncing) return
    cancelBackgroundRefresh()
    setSyncing(true)
    setError('')
    try {
      const next = await api.setupArkModels()
      if (!mounted.current) return
      applyStatus(next)
      setNotice({ kind: 'success', text: '官方 Agent Plan 模型池与推理档位已同步，当前共 ' + next.models.length + ' 个模型路由。' })
    } catch (cause) {
      if (mounted.current) setNotice({ kind: 'error', text: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      if (mounted.current) setSyncing(false)
    }
  }

  /** 保存模型调用用的 Plan Key；它不参与套餐用量查询。 */
  const saveKey = async (): Promise<void> => {
    const value = keyDraft.trim()
    if (value === '') { setNotice({ kind: 'error', text: 'Plan API Key 不能为空。' }); return }
    cancelBackgroundRefresh()
    setSavingKey(true)
    setError('')
    try {
      await api.setCredential(apiKeyEnv, value)
      setKeyDraft('')
      const next = await api.setupArkModels()
      if (!mounted.current) return
      applyStatus(next)
      setNotice({ kind: 'success', text: 'Plan API Key 已保存，模型与推理档位已同步。' })
    } catch (cause) {
      if (mounted.current) setNotice({ kind: 'error', text: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      if (mounted.current) setSavingKey(false)
    }
  }

  /** 保存控制面 AK/SK，随后立即验证签名并刷新看板。 */
  const saveUsageCredentials = async (): Promise<void> => {
    const accessKey = accessKeyDraft.trim()
    const secretKey = secretKeyDraft.trim()
    if (accessKey === '' || secretKey === '') {
      setNotice({ kind: 'error', text: 'Access Key 与 Secret Key 必须同时填写。' })
      return
    }
    cancelBackgroundRefresh()
    setSavingUsageKeys(true)
    setError('')
    try {
      const result = await api.saveArkUsageCredentials(accessKey, secretKey)
      if (!mounted.current) return
      setAccessKeyDraft('')
      setSecretKeyDraft('')
      applyStatus(result.status)
      setDashboard(result.dashboard)
      setNotice({ kind: 'success', text: '火山控制面 AK/SK 已验证并成对保存，用量看板已刷新。' })
    } catch (cause) {
      if (mounted.current) setNotice({ kind: 'error', text: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      if (mounted.current) setSavingUsageKeys(false)
    }
  }

  /** 用户点击刷新时跳过五分钟缓存，失败由 Host 返回旧快照。 */
  const refreshUsage = async (): Promise<void> => {
    if (refreshingUsage) return
    cancelBackgroundRefresh()
    setRefreshingUsage(true)
    setError('')
    try {
      const next = await api.refreshArkUsage()
      if (mounted.current) setDashboard(next)
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mounted.current) setRefreshingUsage(false)
    }
  }

  const modelsReady = useMemo(() => status?.providerConfigured === true && status.models.length > 1 && status.models.every((model) => model.configured), [status])
  const usageConfigured = status?.usageAccessKeyConfigured === true && status.usageSecretKeyConfigured === true

  return (
    <section className={css['zhipuWorkspace']}>
      {!embedded && <div className={css['integrationHeader']}>
        <span className={css['connectionDot']} data-state={status?.credentialConfigured === true ? 'connected' : 'error'} />
        <div className={css['resourceInfo']}>
          <strong className={css['resourceTitle']}>火山方舟 Agent Plan</strong>
          <span className={css['resourceMeta']}>{status?.credentialConfigured ? 'Plan Key 已配置' : '等待配置 Plan API Key'} · {modelsReady ? '模型与推理档位已就绪' : '模型待同步'}</span>
        </div>
        <button type="button" className={css['ghostButton']} disabled={loading} onClick={() => { void refresh() }}>{loading ? '刷新中…' : '刷新'}</button>
      </div>}

      {error !== '' && <div className={css['banner']} data-kind="error">{error}</div>}
      {notice !== null && <div className={css['banner']} data-kind={notice.kind === 'success' ? 'success' : 'error'}>{notice.text}<button type="button" className={css['ghostButton']} onClick={() => setNotice(null)}>关闭</button></div>}
      {loading && status === null && <div className={css['empty']} data-loading="">正在读取火山方舟{isConfig ? '配置状态' : '套餐用量'}…</div>}

      {isConfig && <>
        <section className={css['usageSection']}>
          <h3 className={css['sectionTitle']}>模型调用凭据</h3>
          <div className={css['metricRow']}><span>受管凭据引用</span><strong>{apiKeyEnv}</strong></div>
          <div className={css['keyInputRow']}>
            <input
              type="password"
              className={css['keyInput']}
              placeholder={status?.credentialConfigured ? '已配置 · 输入新 Key 可覆盖' : '粘贴 ark- 开头的 Agent Plan Key'}
              value={keyDraft}
              onChange={(event) => { setKeyDraft(event.target.value); setNotice(null) }}
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" className={css['ghostButton']} disabled={savingKey || keyDraft.trim() === ''} onClick={() => { void saveKey() }}>{savingKey ? '保存中…' : '保存 Plan Key'}</button>
          </div>
          <p className={css['planInfoHint']}>Plan Key 只用于模型调用。请求固定走官方 <code>https://ark.cn-beijing.volces.com/api/plan/v3</code>，不会使用普通按量计费的 <code>/api/v3</code>。</p>
        </section>

        <section className={css['usageSection']}>
          <h3 className={css['sectionTitle']}>模型路由（volcengine-ark-plan）</h3>
          <div className={css['modelToolbar']}>
            <button type="button" className={css['ghostButton']} disabled={syncing || !status?.credentialConfigured} onClick={() => { void syncModels() }}>{syncing ? '同步中…' : '同步模型与推理档位'}</button>
          </div>
          {status?.models.length === 0 ? <div className={css['empty']}>尚未配置任何模型。</div> : status?.models.map((model) => (
            <div key={model.id} className={css['metricRow']}>
              <span>{model.id}</span>
              <strong data-state={model.configured ? 'ok' : 'pending'}>{model.configured ? '已就绪' : '待同步'}</strong>
            </div>
          ))}
        </section>

        {status !== null && !status.credentialConfigured && <div className={css['banner']} data-kind="warning">请先填写 Agent Plan API Key；保存后会自动同步官方文本模型和推理档位。</div>}
      </>}

      {isUsage && <>
        <section className={css['usageSection']}>
          <div className={css['usageToolbar']}>
            <h3 className={css['sectionTitle']}>控制面 AK/SK</h3>
            <button type="button" className={css['ghostButton']} onClick={() => window.open(VOLC_KEY_CONSOLE, '_blank', 'noopener,noreferrer')}>打开火山密钥管理</button>
          </div>
          <div className={css['metricRow']}><span>{status?.usageAccessKeyEnv ?? 'VOLC_ACCESS_KEY'}</span><strong data-state={status?.usageAccessKeyConfigured ? 'ok' : 'pending'}>{status?.usageAccessKeyConfigured ? '已配置' : '待配置'}</strong></div>
          <div className={css['metricRow']}><span>{status?.usageSecretKeyEnv ?? 'VOLC_SECRET_KEY'}</span><strong data-state={status?.usageSecretKeyConfigured ? 'ok' : 'pending'}>{status?.usageSecretKeyConfigured ? '已配置' : '待配置'}</strong></div>
          <div className={css['credentialPair']}>
            <input
              type="password"
              className={css['keyInput']}
              placeholder={status?.usageAccessKeyConfigured ? 'Access Key 已配置 · 输入新值可覆盖' : '粘贴 Access Key'}
              value={accessKeyDraft}
              onChange={(event) => { setAccessKeyDraft(event.target.value); setNotice(null) }}
              autoComplete="off"
              spellCheck={false}
            />
            <input
              type="password"
              className={css['keyInput']}
              placeholder={status?.usageSecretKeyConfigured ? 'Secret Key 已配置 · 输入新值可覆盖' : '粘贴 Secret Key'}
              value={secretKeyDraft}
              onChange={(event) => { setSecretKeyDraft(event.target.value); setNotice(null) }}
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" className={css['ghostButton']} disabled={savingUsageKeys || accessKeyDraft.trim() === '' || secretKeyDraft.trim() === '' || status?.usageCredentialsWritable === false} onClick={() => { void saveUsageCredentials() }}>{savingUsageKeys ? '验证中…' : '保存并验证'}</button>
          </div>
          {!usageConfigured && <ol className={css['setupSteps']}>
            <li>打开火山密钥管理，使用购买套餐的同一火山账号登录。</li>
            <li>创建或启用一组 Access Key / Secret Key，并确保该身份有方舟用量查询权限。</li>
            <li>将两项分别粘贴到上方输入框，点击“保存并验证”。</li>
            <li>验证成功后，下方自动显示 5 小时、每周和每月额度。</li>
          </ol>}
          <p className={css['planInfoHint']}>AK/SK 只保存在 DSH 受管凭据中，不回显给浏览器。它们与模型调用使用的 ark- Plan Key 不是同一种凭据。</p>
        </section>

        {usageConfigured && <section className={css['usageSection']}>
          <div className={css['usageToolbar']}>
            <div>
              <h3 className={css['sectionTitle']}>套餐用量</h3>
              {dashboard !== null && dashboard.fetchedAt > 0 && <span className={css['sectionHint']}>更新于 {new Date(dashboard.fetchedAt).toLocaleTimeString('zh-CN')}{dashboard.stale ? ' · 旧快照' : ''}</span>}
            </div>
            <div className={css['modelToolbar']}>
              <button type="button" className={css['ghostButton']} disabled={refreshingUsage} onClick={() => { void refreshUsage() }}>{refreshingUsage ? '刷新中…' : '实时刷新'}</button>
              <button type="button" className={css['ghostButton']} onClick={() => window.open(ARK_USAGE_CONSOLE, '_blank', 'noopener,noreferrer')}>打开官方控制台</button>
            </div>
          </div>
          {dashboard?.warnings.map((warning) => <div key={warning} className={css['banner']} data-kind="warning">{warning}</div>)}
          {dashboard !== null && <div className={css['quotaPlans']}>
            {dashboard.plans.map((plan) => (
              <section key={plan.product} className={css['usageSection']}>
                <h3 className={css['sectionTitle']}>{productLabel(plan.product)}</h3>
                {plan.error !== undefined && <div className={css['banner']} data-kind="warning">{plan.error}</div>}
                {plan.error === undefined && plan.periods.length > 0 && <div className={css['quotaList']}>{plan.periods.map((period) => <UsageRow key={period.level} period={period} now={now} />)}</div>}
                {plan.error === undefined && plan.periods.length === 0 && <div className={css['empty']}>当前身份未检测到有效套餐。</div>}
              </section>
            ))}
          </div>}
        </section>}
      </>}
    </section>
  )
}
