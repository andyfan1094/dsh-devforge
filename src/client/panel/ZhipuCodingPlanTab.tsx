import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { ZhipuKeyUsage, ZhipuPoolKey, ZhipuQuotaLimit, ZhipuStatus, ZhipuUsageWindow } from '../../zhipu/protocol.ts'
import css from './panel.module.css'
import { ResetBadge } from './reset-badge.tsx'
import { resolveZhipuReset } from './reset-countdown.ts'

/** 智谱页签属性。 */
export interface ZhipuCodingPlanTabProps {
  api: DevforgeApi
  /** 默认受管凭据引用名（主 Key 缺省位，用于兜底展示）。 */
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

/** 计算一条额度的已用百分比（缺失字段按 0 处理）。 */
function usedPercentOf(limit: ZhipuQuotaLimit): number {
  const raw = limit.usedPercent ?? (limit.used !== undefined && limit.total !== undefined && limit.total > 0 ? limit.used / limit.total * 100 : 0)
  return Math.max(0, Math.min(100, raw))
}

/** 智谱 Coding Plan 模型与官方用量面板（自定义命名 Key 池，用量按 Key 多卡片展示）。 */
export function ZhipuCodingPlanTab({ api, apiKeyEnv, section = 'config', embedded = false, onStatusChange }: ZhipuCodingPlanTabProps): JSX.Element {
  const isConfig = section === 'config'
  const isUsage = section === 'usage'
  const [status, setStatus] = useState<ZhipuStatus | null>(null)
  const [usages, setUsages] = useState<ZhipuKeyUsage[] | null>(null)
  const [usageWindow, setUsageWindow] = useState<ZhipuUsageWindow>('day')
  const [loading, setLoading] = useState(true)
  const [settingUp, setSettingUp] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [savingKey, setSavingKey] = useState(false)
  /** 「设为主 Key」「删除 Key」「重命名」的进行中条目 id（同一时刻只允许一个操作）。 */
  const [keyBusyId, setKeyBusyId] = useState('')
  /** 新 Key 表单：名称与 Key 明文。 */
  const [labelDraft, setLabelDraft] = useState('')
  const [keyDraft, setKeyDraft] = useState('')
  /** 行内重命名状态：正在编辑的条目 id 与草稿。 */
  const [editingId, setEditingId] = useState('')
  const [renameDraft, setRenameDraft] = useState('')
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())
  const mounted = useRef(true)
  const refreshGeneration = useRef(0)
  const refreshController = useRef<AbortController | null>(null)
  const setupController = useRef<AbortController | null>(null)
  const fetchController = useRef<AbortController | null>(null)
  const keyController = useRef<AbortController | null>(null)

  /** 同时读取脱敏状态和按 Key 用量；Key 永不进入浏览器。 */
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
      const nextUsages = isUsage && nextStatus.keys.some((key) => key.configured)
        ? await api.getZhipuDashboards(usageWindow, controller.signal)
        : null
      if (!mounted.current || refreshGeneration.current !== generation) return
      setStatus(nextStatus)
      onStatusChange?.(nextStatus)
      setUsages(nextUsages)
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

  /** 统一的 Key 操作执行器：串行防抖 + 通知呈现 + 用量页跟随刷新。 */
  const runKeyAction = useCallback(async (id: string, action: (signal: AbortSignal) => Promise<ZhipuStatus>, successText: string): Promise<void> => {
    if (keyBusyId !== '') return
    setKeyBusyId(id)
    setError('')
    const controller = new AbortController()
    keyController.current = controller
    try {
      const nextStatus = await action(controller.signal)
      if (mounted.current) setStatus(nextStatus)
      onStatusChange?.(nextStatus)
      if (mounted.current) setNotice({ kind: 'success', text: successText })
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current) setNotice({ kind: 'error', text: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      if (mounted.current) setKeyBusyId('')
    }
  }, [onStatusChange])

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

  /** 添加一把新 Key（第一把自动成为主 Key）。 */
  const addKey = async (): Promise<void> => {
    const label = labelDraft.trim()
    const value = keyDraft.trim()
    if (label === '') { setNotice({ kind: 'error', text: '请先给这把 Key 起个名字。' }); return }
    if (value === '') { setNotice({ kind: 'error', text: 'API Key 不能为空。' }); return }
    keyController.current?.abort()
    const controller = new AbortController()
    keyController.current = controller
    setSavingKey(true)
    setError('')
    try {
      const nextStatus = await api.addZhipuKey({ label, value }, controller.signal)
      if (mounted.current) { setLabelDraft(''); setKeyDraft('') }
      if (mounted.current) setStatus(nextStatus)
      onStatusChange?.(nextStatus)
      if (mounted.current) setNotice({ kind: 'success', text: 'Key「' + label + '」已加入 Key 池。' })
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current) setNotice({ kind: 'error', text: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      if (mounted.current) setSavingKey(false)
    }
  }

  /** 把输入框的 Key 明文更新到主 Key（轮换主 Key 值时使用）。 */
  const updatePrimaryValue = async (): Promise<void> => {
    const value = keyDraft.trim()
    if (value === '') { setNotice({ kind: 'error', text: 'API Key 不能为空。' }); return }
    const primary = status?.keys.find((key) => key.primary)
    const targetRef = primary?.ref ?? apiKeyEnv
    keyController.current?.abort()
    const controller = new AbortController()
    keyController.current = controller
    setSavingKey(true)
    setError('')
    try {
      await api.setCredential(targetRef, value)
      if (mounted.current) setKeyDraft('')
      if (mounted.current) setNotice({ kind: 'success', text: '主 Key（' + targetRef + '）已更新。' })
      await refresh()
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current) setNotice({ kind: 'error', text: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      if (mounted.current) setSavingKey(false)
    }
  }

  /** Key 池清单与统计。 */
  const keys = useMemo(() => status?.keys ?? [], [status])
  const primaryKey = useMemo(() => keys.find((key) => key.primary), [keys])
  const configuredCount = useMemo(() => keys.filter((key) => key.configured).length, [keys])
  const modelsReady = useMemo(() => status?.providerConfigured === true && status.models.length > 0 && status.models.every((model) => model.configured), [status])

  /** 提交行内重命名。 */
  const commitRename = (key: ZhipuPoolKey): void => {
    const label = renameDraft.trim()
    if (label === '') { setNotice({ kind: 'error', text: 'Key 名称不能为空。' }); return }
    void runKeyAction(key.id, (signal) => api.renameZhipuKey(key.id, label, signal), '已重命名为「' + label + '」。').then(() => setEditingId(''))
  }

  /** Key 池一行：自定义名称（可行内改名）、引用、主/附加徽标与操作。 */
  const renderKeyRow = (key: ZhipuPoolKey): JSX.Element => {
    const editing = editingId === key.id
    return (
      <div key={key.id} className={css['metricRow']}>
        <span>
          {editing ? (
            <input
              className={css['keyInput']}
              style={{ minWidth: 140, fontFamily: 'inherit' }}
              value={renameDraft}
              autoFocus
              onChange={(event) => setRenameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitRename(key)
                if (event.key === 'Escape') setEditingId('')
              }}
              spellCheck={false}
            />
          ) : (
            <>
              {key.label}
              <span className={css['keyBadge']} data-kind={key.primary ? 'primary' : 'extra'}>{key.primary ? '主 Key' : '附加'}</span>
              <span style={{ marginLeft: 8, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', opacity: 0.75 }}>{key.ref}</span>
            </>
          )}
        </span>
        <strong data-state={key.configured ? 'ok' : 'pending'}>{key.configured ? '已配置' : '未配置'}</strong>
        <span className={css['keyActions']}>
          {editing ? (
            <>
              <button type="button" className={css['ghostButton']} disabled={keyBusyId !== '' || renameDraft.trim() === ''} onClick={() => commitRename(key)}>保存</button>
              <button type="button" className={css['ghostButton']} onClick={() => setEditingId('')}>取消</button>
            </>
          ) : (
            <>
              {key.configured && !key.primary && (
                <button type="button" className={css['ghostButton']} disabled={keyBusyId !== ''} onClick={() => { void runKeyAction(key.id, (signal) => api.setZhipuPrimaryKey(key.ref, signal), '主 Key 已切换为「' + key.label + '」，池成员不变，聊天路由即将生效。') }}>
                  {keyBusyId === key.id ? '切换中…' : '设为主 Key'}
                </button>
              )}
              <button type="button" className={css['ghostButton']} disabled={keyBusyId !== ''} onClick={() => { setEditingId(key.id); setRenameDraft(key.label) }}>重命名</button>
              {key.configured && !key.primary && (
                <button type="button" className={css['ghostButton']} disabled={keyBusyId !== ''} onClick={() => { if (window.confirm('删除 Key「' + key.label + '」（' + key.ref + '）？将同时删除其受管凭据。')) { void runKeyAction(key.id, (signal) => api.removeZhipuKey(key.id, signal), '已删除「' + key.label + '」。') } }}>删除</button>
              )}
            </>
          )}
        </span>
      </div>
    )
  }

  /** 按 Key 用量卡片：每把已配置 Key 独立展示额度窗口与重置倒计时。 */
  const renderUsageCard = (usage: ZhipuKeyUsage): JSX.Element => (
    <section key={usage.id} className={css['usageSection']}>
      <h3 className={css['sectionTitle']} style={{ margin: 0 }}>
        {usage.label}
        <span className={css['keyBadge']} data-kind={usage.primary ? 'primary' : 'extra'}>{usage.primary ? '主 Key' : '附加'}</span>
      </h3>
      <div className={css['metricRow']}>
        <span>凭据引用</span>
        <strong style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}>{usage.ref}</strong>
      </div>
      {!usage.ok && <div className={css['banner']} data-kind="error">{usage.error ?? '该 Key 查询失败。'}</div>}
      {usage.ok && usage.dashboard !== undefined && (
        <>
          {usage.dashboard.limits.map((limit, index) => {
            const usedPercent = usedPercentOf(limit)
            return (
              <div key={limit.kind + '-' + index}>
                <div className={css['metricRow']}>
                  <span>{quotaLabel(limit.kind)}</span>
                  <strong>{usedPercent.toFixed(1)}% 已用 · {(100 - usedPercent).toFixed(1)}% 剩余</strong>
                </div>
                <div className={css['progressTrack']} role="progressbar" aria-label={quotaLabel(limit.kind)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={usedPercent}>
                  <span className={css['progressFill']} data-level={usedPercent >= 95 ? 'danger' : usedPercent >= 80 ? 'warning' : 'normal'} style={{ width: usedPercent + '%' }} />
                </div>
                <div className={css['metricRow']}>
                  <span>重置</span>
                  <ResetBadge view={resolveZhipuReset(limit.nextResetTime, now, limit.kind)} />
                </div>
              </div>
            )
          })}
          <div className={css['metricRow']}>
            <span>近 {usage.dashboard.window === 'day' ? '24 小时' : '7 天'}模型调用</span>
            <strong>{formatNumber(usage.dashboard.modelUsage.totalCalls)} 次 · {formatNumber(usage.dashboard.modelUsage.totalTokens)} tok</strong>
          </div>
          <div className={css['metricRow']}>
            <span>查询时间</span>
            <strong>{new Date(usage.dashboard.fetchedAt).toLocaleTimeString('zh-CN')}</strong>
          </div>
        </>
      )}
    </section>
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
      {loading && status === null && <div className={css['empty']} data-loading="">正在读取智谱{isUsage ? '按 Key 用量' : '配置状态'}…</div>}

      {isConfig && <>
      <section className={css['usageSection']}>
        <h3 className={css['sectionTitle']}>API Key 池</h3>
        <p className={css['sectionHint']}>
          每把 Key 自定义命名、独立凭据引用；主 Key 是聊天模型路由当前使用的 Key，切换主 Key 不会增删池成员。官方 MCP 工具、额度看板等调用按「主 Key → 附加」顺序自动切换——Key 失效、限流或额度耗尽时自动换下一把。
        </p>
        {keys.length > 0 && keys.map((key) => renderKeyRow(key))}
        <div className={css['keyInputRow']}>
          <input
            type="text"
            className={css['keyInput']}
            style={{ flex: '0 1 170px', fontFamily: 'inherit' }}
            placeholder="Key 名称（如 主力号）"
            value={labelDraft}
            onChange={(event) => { setLabelDraft(event.target.value); setNotice(null) }}
            spellCheck={false}
          />
          <input
            type="password" autoComplete="new-password"
            className={css['keyInput']}
            placeholder="粘贴智谱 Coding Plan API Key"
            value={keyDraft}
            onChange={(event) => { setKeyDraft(event.target.value); setNotice(null) }}
            spellCheck={false}
          />
          <button type="button" className={css['ghostButton']} disabled={savingKey || labelDraft.trim() === '' || keyDraft.trim() === ''} title="加入 Key 池（第一把自动成为主 Key）" onClick={() => { void addKey() }}>{savingKey ? '保存中…' : '添加 Key'}</button>
          <button type="button" className={css['ghostButton']} disabled={savingKey || keyDraft.trim() === ''} title={'覆盖主 Key 的凭据值（' + (primaryKey?.ref ?? apiKeyEnv) + '）'} onClick={() => { void updatePrimaryValue() }}>{savingKey ? '保存中…' : '更新主 Key 值'}</button>
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

      {status !== null && configuredCount === 0 && <div className={css['banner']} data-kind="warning">请先在上方添加至少一把 Key。</div>}
      </>}

      {isUsage && status !== null && configuredCount === 0 && <div className={css['banner']} data-kind="warning">尚未配置 API Key，请切换到“使用配置”添加。</div>}

      {isUsage && usages !== null && (
        <>
          <div className={css['usageToolbar']}>
            <h3 className={css['sectionTitle']}>按 Key 用量</h3>
            <div className={css['segmented']} role="group" aria-label="用量时间范围">
              <button type="button" data-active={usageWindow === 'day' ? '' : undefined} onClick={() => setUsageWindow('day')}>近 24 小时</button>
              <button type="button" data-active={usageWindow === 'week' ? '' : undefined} onClick={() => setUsageWindow('week')}>近 7 天</button>
            </div>
          </div>
          <div className={css['usageGrid']}>
            {usages.map((usage) => renderUsageCard(usage))}
          </div>
        </>
      )}
    </section>
  )
}
