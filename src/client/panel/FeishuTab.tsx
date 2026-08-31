/**
 * 服务工厂内嵌飞书控制台。
 *
 * 安全边界：App Secret 只允许单向提交，读取接口仅返回掩码；保存配置会关闭旧独立
 * Agent 并按新配置重建，避免同一个 chatId 同时绑定两套运行参数。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { FeishuConfigPatch, FeishuModelOptions, FeishuPanelConfig, FeishuStatus } from '../../feishu/protocol.ts'
import css from './panel.module.css'

/** Host 尚未返回前的飞书安全默认值。 */
const EMPTY_CONFIG: FeishuPanelConfig = {
  enabled: false,
  appId: '',
  appSecretConfigured: false,
  appSecretMask: '未配置',
  domain: 'https://open.feishu.cn',
  cwd: '',
  allowUsers: [],
  ack: true,
  ackReaction: 'OK',
  provider: '',
  model: '',
  reasoningEffort: '',
  agentPreset: 'cordis',
  groupMode: 'all',
  welcomeText: '',
  chatCwds: {},
  asrBaseUrlConfigured: false,
  asrApiKeyConfigured: false,
  asrModel: '',
  syncCatchUp: true,
  notifyOnComplete: false,
  notifyChatId: '',
}

/** 空模型目录。 */
const EMPTY_OPTIONS: FeishuModelOptions = {
  current: { provider: '', model: '', reasoningEffort: '', agentPreset: 'cordis', followDefault: true },
  providers: [],
  models: [],
  presets: [],
}

/** 内嵌页属性。 */
export interface FeishuTabProps {
  /** 服务工厂统一 API 客户端。 */
  api: DevforgeApi
}

/** 统一异常文本。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 将底层状态翻译成操作台状态。 */
function connectionLabel(status: FeishuStatus): string {
  if (status.connected) return '已连接'
  if (status.state === 'connecting') return '连接中'
  if (status.state === 'disabled') return '已停用'
  if (status.state === 'unconfigured') return '未配置'
  if (status.state === 'error') return '错误'
  return '未连接'
}

/** 服务工厂飞书控制台。 */
export function FeishuTab({ api }: FeishuTabProps): JSX.Element {
  const [config, setConfig] = useState<FeishuPanelConfig>(EMPTY_CONFIG)
  const [status, setStatus] = useState<FeishuStatus>({ state: 'loading', connected: false, independentSessions: [] })
  const [options, setOptions] = useState<FeishuModelOptions>(EMPTY_OPTIONS)
  const [appSecret, setAppSecret] = useState('')
  const [allowUsersText, setAllowUsersText] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  /** 当前 Provider 下可选模型。留空 Provider 表示跟随 DSH 默认模型。 */
  const availableModels = useMemo(
    () => config.provider === '' ? [] : options.models.filter((model) => model.provider === config.provider),
    [config.provider, options.models],
  )
  const selectedModel = useMemo(
    () => options.models.find((model) => model.provider === (config.provider || options.current.provider) && model.model === (config.model || options.current.model)),
    [config.model, config.provider, options.current.model, options.current.provider, options.models],
  )

  /** 拉取配置、连接状态和模型目录；三者一起完成后再展示表单。 */
  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const [nextConfig, nextStatus, nextOptions] = await Promise.all([
        api.getFeishuConfig(),
        api.getFeishuStatus(),
        api.getFeishuModelOptions(),
      ])
      setConfig(nextConfig)
      setStatus(nextStatus)
      setOptions(nextOptions)
      setAppSecret('')
      setAllowUsersText(nextConfig.allowUsers.join(String.fromCharCode(10)))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { void refresh() }, [refresh])

  // 连接状态会变化，但轮询只替换 status，不覆盖用户尚未保存的表单。
  useEffect(() => {
    const timer = window.setInterval(() => {
      void api.getFeishuStatus().then(setStatus).catch(() => { /* 页面已有手动刷新，短暂失败不打断编辑 */ })
    }, 10000)
    return () => { window.clearInterval(timer) }
  }, [api])

  /** 当前表单到 Host 更新载荷；空 App Secret 表示沿用已保存值。 */
  const payload = (): FeishuConfigPatch => ({
    enabled: config.enabled,
    appId: config.appId.trim(),
    appSecret: appSecret.trim() || undefined,
    domain: config.domain.trim(),
    cwd: config.cwd.trim(),
    provider: config.provider,
    model: config.provider === '' ? '' : config.model,
    reasoningEffort: config.reasoningEffort,
    agentPreset: config.agentPreset,
    allowUsers: allowUsersText.split(String.fromCharCode(10)).map((value) => value.trim()).filter(Boolean),
    ack: config.ack,
    ackReaction: config.ackReaction.trim() || 'OK',
    groupMode: config.groupMode,
    welcomeText: config.welcomeText,
    syncCatchUp: config.syncCatchUp,
    notifyOnComplete: config.notifyOnComplete,
    notifyChatId: config.notifyChatId,
  })

  /** 统一操作状态和错误呈现。 */
  const run = async (operation: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await operation()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  /** 保存后 Host 会重连 WebSocket，并关闭旧参数下的独立 Agent。 */
  const save = async (): Promise<void> => run(async () => {
    const result = await api.saveFeishuConfig(payload())
    setConfig(result.config)
    setStatus(result.status)
    setAppSecret('')
    setAllowUsersText(result.config.allowUsers.join(String.fromCharCode(10)))
    setNotice('飞书设置已保存，后续消息将使用新配置')
  })

  /** 测试只验证当前 App 凭据，不落盘。 */
  const testConnection = async (): Promise<void> => run(async () => {
    await api.testFeishuConnection(payload())
    setNotice('App ID 与 App Secret 验证成功')
  })

  /** Provider 改变时重置不再适用的 Model 和推理级别。 */
  const selectProvider = (provider: string): void => {
    const firstModel = options.models.find((model) => model.provider === provider)
    setConfig({ ...config, provider, model: provider === '' ? '' : firstModel?.model || '', reasoningEffort: '' })
  }

  if (loading) return <div className={css['empty']} data-loading="">正在加载飞书状态…</div>

  const sessions = status.independentSessions ?? []
  const actualProvider = options.current.provider || status.model?.provider || '--'
  const actualModel = options.current.model || status.model?.model || '--'
  const actualEffort = options.current.reasoningEffort || status.model?.reasoningEffort || '默认'
  const actualPreset = options.current.agentPreset || status.model?.agentPreset || config.agentPreset

  return (
    <section className={css['feishuWorkspace']} aria-label="飞书控制台">
      <div className={css['integrationHeader']}>
        <span className={css['connectionDot']} data-state={status.connected ? 'connected' : status.state} aria-hidden="true" />
        <div className={css['resourceInfo']}>
          <strong className={css['resourceTitle']}>飞书长连接 · {connectionLabel(status)}</strong>
          <span className={css['resourceMeta']}>{status.connected ? 'WebSocket 正常' : status.lastError || '等待连接'}</span>
        </div>
        <button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void testConnection() }}>测试连接</button>
        <button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void refresh() }}>刷新</button>
      </div>

      {error !== '' && <div className={css['banner']} data-kind="error">{error}</div>}
      {notice !== '' && <div className={css['banner']} data-kind="success">{notice}</div>}
      {status.state === 'error' && status.lastError && <div className={css['banner']} data-kind="error">运行错误：{status.lastError}</div>}
      {status.lastCardError && <div className={css['banner']} data-kind="error">卡片错误：{status.lastCardError}</div>}
      {status.lastSessionError && <div className={css['banner']} data-kind="error">会话错误：{status.lastSessionError}</div>}

      <div className={css['feishuGrid']}>
        <section className={css['githubSection']}>
          <h3 className={css['sectionTitle']}>应用连接</h3>
          <div className={css['form']}>
            <label className={css['checkRow']}><input type="checkbox" checked={config.enabled} onChange={(event) => { setConfig({ ...config, enabled: event.target.checked }) }} />启用飞书长连接</label>
            <label className={css['field']}><span className={css['fieldLabel']}>App ID</span><input className={css['input']} value={config.appId} onChange={(event) => { setConfig({ ...config, appId: event.target.value }) }} placeholder="cli_xxxxxxxxxxxxxxxx" /></label>
            <label className={css['field']}><span className={css['fieldLabel']}>App Secret</span><input className={css['input']} type="password" value={appSecret} onChange={(event) => { setAppSecret(event.target.value) }} placeholder="留空保留已保存密钥" autoComplete="new-password" /><span className={css['sectionHint']}>{config.appSecretMask}</span></label>
            <label className={css['field']}><span className={css['fieldLabel']}>开放平台地址</span><input className={css['input']} value={config.domain} onChange={(event) => { setConfig({ ...config, domain: event.target.value }) }} /></label>
            <label className={css['field']}><span className={css['fieldLabel']}>独立会话工作目录</span><input className={css['input']} value={config.cwd} onChange={(event) => { setConfig({ ...config, cwd: event.target.value }) }} placeholder="D:/项目" /></label>
          </div>
        </section>

        <section className={css['githubSection']}>
          <h3 className={css['sectionTitle']}>Agent 配置</h3>
          <div className={css['form']}>
            <label className={css['field']}>
              <span className={css['fieldLabel']}>Provider</span>
              <select className={css['input']} value={config.provider} onChange={(event) => { selectProvider(event.target.value) }}>
                <option value="">跟随 DSH 默认模型</option>
                {options.providers.map((provider) => <option key={provider.provider} value={provider.provider}>{provider.name || provider.provider}</option>)}
              </select>
            </label>
            <label className={css['field']}>
              <span className={css['fieldLabel']}>Model</span>
              <select className={css['input']} value={config.provider === '' ? '' : config.model} disabled={config.provider === ''} onChange={(event) => { setConfig({ ...config, model: event.target.value, reasoningEffort: '' }) }}>
                {config.provider === '' && <option value="">{actualProvider} / {actualModel}</option>}
                {availableModels.map((model) => <option key={model.provider + '/' + model.model} value={model.model}>{model.name || model.model}</option>)}
              </select>
            </label>
            <label className={css['field']}>
              <span className={css['fieldLabel']}>推理级别</span>
              <select className={css['input']} value={config.reasoningEffort} onChange={(event) => { setConfig({ ...config, reasoningEffort: event.target.value }) }}>
                <option value="">{config.provider === '' ? '跟随 DSH 默认推理级别' : '使用模型默认推理级别'}</option>
                {(selectedModel?.reasoningEfforts ?? []).map((effort) => <option key={effort.id} value={effort.id}>{effort.name || effort.id}</option>)}
              </select>
            </label>
            <label className={css['field']}>
              <span className={css['fieldLabel']}>Agent 预设</span>
              <select className={css['input']} value={config.agentPreset} onChange={(event) => { setConfig({ ...config, agentPreset: event.target.value }) }}>
                {options.presets.map((preset) => <option key={preset.id} value={preset.id} disabled={Boolean(preset.broken)}>{preset.name || preset.id}{preset.broken ? '（不可用）' : ''}</option>)}
              </select>
            </label>
          </div>
        </section>

        <section className={css['githubSection']}>
          <h3 className={css['sectionTitle']}>访问与消息</h3>
          <div className={css['form']}>
            <label className={css['field']}><span className={css['fieldLabel']}>允许的 open_id</span><textarea className={[css['input'], css['textarea']].filter(Boolean).join(' ')} value={allowUsersText} onChange={(event) => { setAllowUsersText(event.target.value) }} placeholder="每行一个 ou_xxx" /></label>
            <label className={css['checkRow']}><input type="checkbox" checked={config.ack} onChange={(event) => { setConfig({ ...config, ack: event.target.checked }) }} />收到消息后添加确认反应</label>
            <label className={css['field']}><span className={css['fieldLabel']}>确认反应</span><input className={css['input']} value={config.ackReaction} onChange={(event) => { setConfig({ ...config, ackReaction: event.target.value }) }} /></label>
            <label className={css['field']}><span className={css['fieldLabel']}>群聊响应</span><select className={css['input']} value={config.groupMode} onChange={(event) => { setConfig({ ...config, groupMode: event.target.value as 'all' | 'mention' }) }}><option value="all">所有消息</option><option value="mention">仅被 @ 时</option></select></label>
            <label className={css['checkRow']}><input type="checkbox" checked={config.syncCatchUp} onChange={(event) => { setConfig({ ...config, syncCatchUp: event.target.checked }) }} />连接恢复后补收消息</label>
          </div>
        </section>

        <section className={css['githubSection']}>
          <h3 className={css['sectionTitle']}>完成通知</h3>
          <div className={css['form']}>
            <label className={css['checkRow']}><input type="checkbox" checked={config.notifyOnComplete} onChange={(event) => { setConfig({ ...config, notifyOnComplete: event.target.checked }) }} />电脑端任务完成时通过飞书卡片通知</label>
            <label className={css['field']}><span className={css['fieldLabel']}>通知目标 chat_id</span><input className={css['input']} value={config.notifyChatId} onChange={(event) => { setConfig({ ...config, notifyChatId: event.target.value }) }} placeholder="oc_xxx（群）或 on_xxx（个人 open_id）" /></label>
          </div>
        </section>

        <section className={css['githubSection']}>
          <h3 className={css['sectionTitle']}>运行状态</h3>
          <div className={css['metricList']}>
            <div className={css['metricRow']}><span>WebSocket</span><strong>{connectionLabel(status)}</strong></div>
            <div className={css['metricRow']}><span>Provider</span><strong>{actualProvider}</strong></div>
            <div className={css['metricRow']}><span>Model</span><strong>{actualModel}</strong></div>
            <div className={css['metricRow']}><span>推理级别</span><strong>{actualEffort}</strong></div>
            <div className={css['metricRow']}><span>Agent 预设</span><strong>{actualPreset}</strong></div>
            <div className={css['metricRow']}><span>独立会话</span><strong>{sessions.length}</strong></div>
          </div>
        </section>
      </div>

      <section className={css['githubSection']}>
        <div className={css['toolbar']}><h3 className={css['sectionTitle']}>活动会话</h3><span className={css['toolbarSpacer']} /><button type="button" className={css['primaryButton']} disabled={busy} onClick={() => { void save() }}>保存飞书设置</button></div>
        {sessions.length === 0 ? (
          <div className={css['empty']}>暂无活动飞书会话</div>
        ) : (
          <div className={css['tableScroll']}>
            <table className={css['dataTable']}>
              <thead><tr><th>Chat ID</th><th>会话</th><th>模型</th><th>状态</th></tr></thead>
              <tbody>{sessions.map((session) => <tr key={session.chatId + '/' + session.sessionId}><td>{session.chatId}</td><td>{session.sessionId}</td><td>{session.provider} / {session.model}<div className={css['resourceMeta']}>{session.effort || '默认'} · {session.preset}</div></td><td><span className={css['badge']} data-status={session.status}>{session.status}</span></td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  )
}
