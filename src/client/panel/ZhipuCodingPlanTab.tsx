import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { ZhipuDashboard, ZhipuPoolKey, ZhipuQuotaLimit, ZhipuStatus, ZhipuUsageWindow } from '../../zhipu/protocol.ts'
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

/** 智谱 Coding Plan 模型与官方用量面板（支持多 Key 池）。 */
export function ZhipuCodingPlanTab({ api, apiKeyEnv, section = 'config', embedded = false, onStatusChange }: ZhipuCodingPlanTabProps): JSX.Element {
  const isConfig = section === 'config'
  const isUsage = section === 'usage'
  const [status, setStatus] = useState<ZhipuStatus | null>(null)
  const [dashboard, setDashboard] = useState<ZhipuDashboard | null>(null)
  const [usageWindow, setUsageWindow] = useState<ZhipuUsageWindow>('day')
  /** 用量查看选择的 Key 引用名；空串表示自动（主 Key 优先，失败自动切换）。 */
  const [usageKey, setUsageKey] = useState('')
  const [loading, setLoading] = useState(true)
  const [settingUp, setSettingUp] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [savingKey, setSavingKey] = useState(false)
  /** 「设为主 Key」「删除 Key」的进行中引用名（同一时刻只允许一个 Key 操作）。 */
  const [keyBusyEnv, setKeyBusyEnv] = useState('')
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
      // 选择的 Key 已不在池内（被删除）时回落到自动模式。
      const selectedKey = usageKey !== '' && nextStatus.keys.some((key) => key.env === usageKey) ? usageKey : ''
      const nextDashboard = isUsage && nextStatus.keys.some((key) => key.configured)
        ? await api.getZhipuDashboard(usageWindow, controller.signal, selectedKey === '' ? undefined : selectedKey)
        : null
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
  }, [api, isUsage, onStatusChange, usageKey, usageWindow])

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

  /** 把输入框的 Key 写入指定受管凭据槽位；写入成功后仅刷新状态，不在面板显示明文。 */
  const saveKey = async (env: string): Promise<void> => {
    const value = keyDraft.trim()
    if (value === '') { setNotice({ kind: 'error', text: 'API Key 不能为空。' }); return }
    keyController.current?.abort()
    const controller = new AbortController()
    keyController.current = controller
    setSavingKey(true)
    setError('')
    try {
      await api.setCredential(env, value)
      setKeyDraft('')
      if (mounted.current) setNotice({ kind: 'success', text: 'API Key 已保存到 ' + env + '。' })
      await refresh()
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current) setNotice({ kind: 'error', text: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      if (mounted.current) setSavingKey(false)
    }
  }

  /** 把某把已配置 Key 设为主 Key：聊天路由 zai-coding-cn 的下一请求即改用该 Key。 */
  const setPrimary = async (env: string): Promise<void> => {
    if (keyBusyEnv !== '') return
    setKeyBusyEnv(env)
    setError('')
    try {
      const nextStatus = await api.setZhipuPrimaryKey(env)
      if (mounted.current) setStatus(nextStatus)
      onStatusChange?.(nextStatus)
      if (mounted.current) setNotice({ kind: 'success', text: '主 Key 已切换为 ' + env + '，聊天模型路由即将生效。' })
    } catch (cause) {
      if (mounted.current) setNotice({ kind: 'error', text: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      if (mounted.current) setKeyBusyEnv('')
    }
  }

  /** 删除一把附加 Key（主 Key 不允许删除；删除后该槽位退出 Key 池）。 */
  const removeKey = async (env: string): Promise<void> => {
    if (keyBusyEnv !== '') return
    if (!window.confirm('删除 Key ' + env + '？删除后该 Key 退出 Key 池，正在使用它的官方调用将切换到其他 Key。')) return
    setKeyBusyEnv(env)
    setError('')
    try {
      await api.removeCredential(env)
      if (mounted.current) setNotice({ kind: 'success', text: '已删除 ' + env + '。' })
      await refresh()
    } catch (cause) {
      if (mounted.current) setNotice({ kind: 'error', text: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      if (mounted.current) setKeyBusyEnv('')
    }
  }

  /** Key 池清单（主 Key 在前）与统计。 */
  const keys = useMemo(() => status?.keys ?? [], [status])
  const primaryKey = useMemo(() => keys.find((key) => key.primary), [keys])
  const configuredCount = useMemo(() => keys.filter((key) => key.configured).length, [keys])
  /** 第一个未配置的附加槽位：添加 Key 的落位。 */
  const nextSlot = useMemo(() => keys.find((key) => !key.primary && !key.configured), [keys])
  const modelsReady = useMemo(() => status?.providerConfigured === true && status.models.length > 0 && status.models.every((model) => model.configured), [status])

  /** Key 池一行：名称、主/附加徽标、状态与操作。 */
  const renderKeyRow = (key: ZhipuPoolKey): JSX.Element => (
    <div key={key.env} className={css['metricRow']}>
      <span>
        {key.env}
        <span className={css['keyBadge']} data-kind={key.primary ? 'primary' : 'extra'}>{key.primary ? '主 Key' : '附加'}</span>
      </span>
      <strong data-state={key.configured ? 'ok' : 'pending'}>{key.configured ? '已配置' : '空槽位'}</strong>
      <span className={css['keyActions']}>
        {key.configured && !key.primary && (
          <button type="button" className={css['ghostButton']} disabled={keyBusyEnv !== ''} onClick={() => { void setPrimary(key.env) }}>
            {keyBusyEnv === key.env ? '切换中…' : '设为主 Key'}
          </button>
        )}
        {key.configured && !key.primary && (
          <button type="button" className={css['ghostButton']} disabled={keyBusyEnv !== ''} onClick={() => { void removeKey(key.env) }}>删除</button>
        )}
      </span>
    </div>
  )

  return (
    <section className={css['zhipuWorkspace']}>
      {!embedded && <div className={css['integrationHeader']}>
        <span className={css['connectionDot']} data-state={configuredCount > 0 ? 'connected' : 'error'} />
        <div className={css['resourceInfo']}>
          <strong className={css['resourceTitle']}>智谱 Coding Plan</strong>
          <span className={css['resourceMeta']}>{configuredCount > 0 ? '官方凭据已配置（' + configuredCount + ' 把 Key）' : '等待配置 API Key'} · {modelsReady ? '模型已就绪' : '模型待完善'} · {status?.mcpTools !== false ? '官方 MCP 工具已启用' : '官方 MCP 工具已关闭'}</span>
        </div>
        {!modelsReady && <button type="button" className={css['ghostButton']} disabled={settingUp} onClick={() => { void setupModels() }}>{settingUp ? '正在配置…' : '完善模型接入'}</button>}
        <button type="button" className={css['ghostButton']} disabled={loading} onClick={() => { void refresh() }}>{loading ? '刷新中…' : '刷新'}</button>
      </div>}

      {error !== '' && <div className={css['banner']} data-kind="error">{error}</div>}
      {notice !== null && <div className={css['banner']} data-kind={notice.kind === 'success' ? 'success' : 'error'}>{notice.text}<button type="button" className={css['ghostButton']} onClick={() => setNotice(null)}>关闭</button></div>}
      {loading && status === null && <div className={css['empty']} data-loading="">正在读取智谱{isUsage ? '官方额度' : '配置状态'}…</div>}

      {isConfig && <>
      <section className={css['usageSection']}>
        <h3 className={css['sectionTitle']}>API Key 池</h3>
        <p className={css['sectionHint']}>
          主 Key 用于聊天模型路由（{primaryKey?.env ?? apiKeyEnv}）；官方 MCP 工具、额度看板等调用按池序自动切换——Key 失效、限流或额度耗尽时自动换下一把。
        </p>
        {keys.length > 0 && keys.map((key) => renderKeyRow(key))}
        <div className={css['keyInputRow']}>
          <input
            type="password" autoComplete="new-password"
            className={css['keyInput']}
            placeholder={configuredCount > 0 ? '已配置 ' + configuredCount + ' 把 · 粘贴新 Key 可追加或覆盖' : '粘贴智谱 Coding Plan API Key'}
            value={keyDraft}
            onChange={(event) => { setKeyDraft(event.target.value); setNotice(null) }}
            spellCheck={false}
          />
          <button type="button" className={css['ghostButton']} disabled={savingKey || keyDraft.trim() === '' || primaryKey === undefined} title={'保存到主 Key（' + (primaryKey?.env ?? apiKeyEnv) + '）'} onClick={() => { void saveKey(primaryKey?.env ?? apiKeyEnv) }}>{savingKey ? '保存中…' : '存为主 Key'}</button>
          <button type="button" className={css['ghostButton']} disabled={savingKey || keyDraft.trim() === '' || nextSlot === undefined} title={nextSlot !== undefined ? '保存到附加槽位（' + nextSlot.env + '）' : '附加槽位已满（最多 5 把）'} onClick={() => { if (nextSlot !== undefined) void saveKey(nextSlot.env) }}>{savingKey ? '保存中…' : '存为附加 Key'}</button>
        </div>
      </section>

      <section className={css['usageSection']}>
        <h3 className={css['sectionTitle']}>模型路由（zai-coding-cn）</h3>
        <div className={css['modelToolbar']}>
          <button type="button" className={css['ghostButton']} disabled={fetching || configuredCount === 0} onClick={() => { void fetchOfficialModels() }} title="调官方 /v4/models 拉取最新模型并合并进 provider">{fetching ? '拉取中…' : '从官方拉取模型'}</button>
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

      {status !== null && configuredCount === 0 && <div className={css['banner']} data-kind="warning">请先在上方 API Key 池保存至少一把 Key。</div>}
      </>}

      {isUsage && status !== null && configuredCount === 0 && <div className={css['banner']} data-kind="warning">尚未配置 API Key，请切换到“使用配置”保存。</div>}

      {isUsage && dashboard !== null && (
        <>
          {dashboard.warnings.map((warning) => <div key={warning} className={css['banner']} data-kind="warning">{warning}</div>)}
          <div className={css['quotaHeader']}>
            <div><span className={css['sectionHint']}>当前套餐</span><strong>{dashboard.level?.toUpperCase() ?? '未知'}</strong></div>
            <span className={css['toolbarSpacer']} />
            <span className={css['sectionHint']}>Key：{dashboard.keyEnv ?? primaryKey?.env ?? '自动'} · 更新于 {new Date(dashboard.fetchedAt).toLocaleTimeString('zh-CN')}</span>
          </div>

          {keys.some((key) => key.configured) && <div className={css['segmented']} role="group" aria-label="用量查看的 Key">
            <button type="button" data-active={usageKey === '' ? '' : undefined} onClick={() => setUsageKey('')}>自动切换</button>
            {keys.filter((key) => key.configured).map((key) => (
              <button key={key.env} type="button" data-active={usageKey === key.env ? '' : undefined} onClick={() => setUsageKey(key.env)}>{key.primary ? '主 Key' : key.env.slice(apiKeyEnv.length + 1)}</button>
            ))}
          </div>}

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
