/**
 * 天工造梦内嵌飞书控制台（多机器人版）。
 *
 * 安全边界：App Secret 只允许单向提交，读取接口仅返回掩码；保存配置会关闭旧独立
 * Agent 并按新配置重建，避免同一个 chatId 同时绑定两套运行参数。
 *
 * 多机器人（0.47.0）：每个机器人独立 App ID/Secret/角色（chat 只聊天、notify 只
 * 通知、both 兼具）；页头聚合在线数，机器人列表卡管理增删与测试，完成通知卡指定
 * 通知机器人。旧单机器人配置由 Host 自动迁移为 default 机器人。
 */
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { FeishuBotPatch, FeishuBotRole, FeishuBotView, FeishuConfigPatch, FeishuModelOptions, FeishuPanelConfig, FeishuStatus } from '../../feishu/protocol.ts'
import { IconPlug, IconBot, IconUsers, IconBell, IconActivity, IconPlus, IconTrash } from './icons.tsx'
import css from './panel.module.css'

/** Host 尚未返回前的飞书安全默认值。 */
const EMPTY_CONFIG: FeishuPanelConfig = {
  enabled: false,
  appId: '',
  appSecretConfigured: false,
  appSecretMask: '未配置',
  bots: [],
  notifyBotId: '',
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

/** 机器人角色中文标签。 */
const BOT_ROLE_LABELS: Record<FeishuBotRole, string> = {
  chat: '只聊天',
  notify: '只通知',
  both: '聊天 + 通知',
}

/** 内嵌页属性。 */
export interface FeishuTabProps {
  /** 天工造梦统一 API 客户端。 */
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

/** 卡片标题行：分色图标 + 标题 + 可选说明小字（与项目卡图标体系一致）。 */
function cardTitle(kind: 'plug' | 'bot' | 'users' | 'bell' | 'activity', text: string, hint?: string): JSX.Element {
  const icons = { plug: IconPlug, bot: IconBot, users: IconUsers, bell: IconBell, activity: IconActivity } as const
  const Icon = icons[kind]
  return (
    <h3 className={css['sectionTitle']}>
      <span className={css['cardIcon']} data-kind={kind} aria-hidden="true"><Icon /></span>
      {text}
      {hint !== undefined && <span className={css['sectionHint']}>{hint}</span>}
    </h3>
  )
}

/** 天工造梦飞书控制台。 */
export function FeishuTab({ api }: FeishuTabProps): JSX.Element {
  const [config, setConfig] = useState<FeishuPanelConfig>(EMPTY_CONFIG)
  const [status, setStatus] = useState<FeishuStatus>({ state: 'loading', connected: false, independentSessions: [] })
  const [options, setOptions] = useState<FeishuModelOptions>(EMPTY_OPTIONS)
  const [allowUsersText, setAllowUsersText] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // 机器人编辑态：仅存放未保存的输入值（Secret/名称等）；保存时整体提交 bots[]。
  const [botDrafts, setBotDrafts] = useState<Record<string, { name?: string; appId?: string; appSecret?: string; role?: FeishuBotRole }>>({})

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

  const patchDraft = (botId: string, patch: { name?: string; appId?: string; appSecret?: string; role?: FeishuBotRole }): void => {
    setBotDrafts((current) => ({ ...current, [botId]: { ...current[botId], ...patch } }))
  }

  /** 当前表单到 Host 更新载荷；机器人 Secret 留空由 Host 继承旧值。 */
  const payload = (): FeishuConfigPatch => {
    const bots: FeishuBotPatch[] = config.bots.map((bot) => ({
      id: bot.id,
      name: botDrafts[bot.id]?.name ?? bot.name,
      appId: botDrafts[bot.id]?.appId ?? bot.appId,
      appSecret: botDrafts[bot.id]?.appSecret?.trim() || undefined,
      role: botDrafts[bot.id]?.role ?? bot.role,
      enabled: bot.enabled,
    }))
    return {
      enabled: config.enabled,
      bots,
      notifyBotId: config.notifyBotId,
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
    }
  }

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

  /** 保存后 Host 会重连全部机器人 WebSocket，并关闭旧参数下的独立 Agent。 */
  const save = async (): Promise<void> => run(async () => {
    const result = await api.saveFeishuConfig(payload())
    setConfig(result.config)
    setStatus(result.status)
    setBotDrafts({})
    setAllowUsersText(result.config.allowUsers.join(String.fromCharCode(10)))
    setNotice('飞书设置已保存，机器人连接已按新配置重建')
  })

  /** 测试指定机器人的凭据（含未保存的输入值），不落盘。 */
  const testBot = async (bot: FeishuBotView): Promise<void> => run(async () => {
    const draft = botDrafts[bot.id]
    await api.testFeishuConnection({
      botId: bot.id,
      bots: [{ id: bot.id, appId: draft?.appId ?? bot.appId, appSecret: draft?.appSecret?.trim() || undefined }],
    })
    setNotice('机器人「' + (draft?.name || bot.name) + '」的 App ID 与 App Secret 验证成功')
  })

  /** 本地新增一个未保存的机器人行（保存时才提交）。 */
  const addBot = (): void => {
    const tempId = 'new-' + String(Date.now())
    setConfig((current) => ({
      ...current,
      bots: [...current.bots, { id: tempId, name: '新机器人', appId: '', role: 'chat', enabled: true, appSecretConfigured: false, appSecretMask: '未配置' }],
    }))
    patchDraft(tempId, { name: '新机器人' })
  }

  /** 本地移除机器人行（保存时才真正删除）。 */
  const removeBot = (botId: string): void => {
    setConfig((current) => ({ ...current, bots: current.bots.filter((bot) => bot.id !== botId) }))
    setBotDrafts((current) => {
      const next = { ...current }
      delete next[botId]
      return next
    })
  }

  /** Provider 改变时重置不再适用的 Model 和推理级别。 */
  const selectProvider = (provider: string): void => {
    const firstModel = options.models.find((model) => model.provider === provider)
    setConfig({ ...config, provider, model: provider === '' ? '' : firstModel?.model || '', reasoningEffort: '' })
  }

  if (loading) return <div className={css['empty']} data-loading="">正在加载飞书状态…</div>

  const sessions = status.independentSessions ?? []
  const botStatuses = status.bots ?? []
  const connectedCount = botStatuses.filter((bot) => bot.connected).length
  const actualProvider = options.current.provider || status.model?.provider || '--'
  const actualModel = options.current.model || status.model?.model || '--'
  const actualEffort = options.current.reasoningEffort || status.model?.reasoningEffort || '默认'
  const actualPreset = options.current.agentPreset || status.model?.agentPreset || config.agentPreset
  /** 通知机器人下拉的可选项：全部机器人；当前生效值（含自动）额外展示一行说明。 */
  const notifyOptions = config.bots

  return (
    <section className={css['feishuWorkspace']} aria-label="飞书控制台">
      <div className={css['integrationHeader']}>
        <span className={css['connectionDot']} data-state={status.connected ? 'connected' : status.state} aria-hidden="true" />
        <div className={css['resourceInfo']}>
          <strong className={css['resourceTitle']}>飞书长连接 · {connectionLabel(status)}</strong>
          <span className={css['resourceMeta']}>
            {config.bots.length > 0
              ? config.bots.length + ' 个机器人 · ' + connectedCount + ' 个在线 · '
              : '未配置机器人 · '}
            当前模型 <span className={css['monoText']}>{actualProvider}/{actualModel}</span> · 推理 {actualEffort}
          </span>
        </div>
        <button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void refresh() }}>刷新</button>
      </div>

      {error !== '' && (
        <div className={[css['banner'], css['bannerRow']].join(' ')} data-kind="error">
          <span>{error}</span>
          <button type="button" className={css['ghostButton']} onClick={() => { void refresh() }}>重试</button>
        </div>
      )}
      {notice !== '' && <div className={css['banner']} data-kind="success">{notice}</div>}
      {status.state === 'error' && status.lastError && <div className={css['banner']} data-kind="error">运行错误：{status.lastError}</div>}
      {status.lastSessionError && <div className={css['banner']} data-kind="error">会话错误：{status.lastSessionError}</div>}

      <div className={css['feishuGrid']}>
        <section className={[css['githubSection'], css['feishuWide']].join(' ')}>
          {cardTitle('bot', '机器人', '每个机器人独立应用与角色；保存后重建连接')}
          <div className={css['feishuBotList']}>
            {config.bots.length === 0 && <div className={css['empty']}>还没有机器人；点击「添加机器人」创建第一个，或保存一次旧配置自动迁移。</div>}
            {config.bots.map((bot) => {
              const draft = botDrafts[bot.id] ?? {}
              const name = draft.name ?? bot.name
              const appId = draft.appId ?? bot.appId
              const role = draft.role ?? bot.role
              const live = botStatuses.find((item) => item.id === bot.id)
              return (
                <div key={bot.id} className={css['feishuBotRow']} data-role={role}>
                  <div className={css['feishuBotMain']}>
                    <span className={css['connectionDot']} data-state={live === undefined ? 'stopped' : live.connected ? 'connected' : live.state} aria-hidden="true" />
                    <input
                      className={[css['input'], css['feishuBotName']].join(' ')}
                      value={name}
                      aria-label="机器人名称"
                      onChange={(event) => { patchDraft(bot.id, { name: event.target.value }) }}
                    />
                    <select
                      className={[css['input'], css['feishuBotRole']].join(' ')}
                      value={role}
                      aria-label="机器人角色"
                      onChange={(event) => { patchDraft(bot.id, { role: event.target.value as FeishuBotRole }) }}
                    >
                      {(Object.keys(BOT_ROLE_LABELS) as FeishuBotRole[]).map((key) => <option key={key} value={key}>{BOT_ROLE_LABELS[key]}</option>)}
                    </select>
                    <label className={css['checkRow']}><input type="checkbox" checked={bot.enabled} onChange={(event) => { setConfig((current) => ({ ...current, bots: current.bots.map((item) => item.id === bot.id ? { ...item, enabled: event.target.checked } : item) })) }} />启用</label>
                    <div className={css['feishuBotActions']}>
                      <button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void testBot(bot) }}>测试</button>
                      <button type="button" className={css['ghostButton']} data-danger="" aria-label={'删除机器人 ' + name} onClick={() => { removeBot(bot.id) }}><IconTrash /></button>
                    </div>
                  </div>
                  <div className={css['feishuBotCreds']}>
                    <input
                      className={[css['input'], css['feishuBotAppId']].join(' ')}
                      value={appId}
                      placeholder="cli_xxxxxxxxxxxxxxxx"
                      aria-label="机器人 App ID"
                      onChange={(event) => { patchDraft(bot.id, { appId: event.target.value }) }}
                    />
                    <input
                      className={[css['input'], css['feishuBotSecret']].join(' ')}
                      type="password"
                      autoComplete="new-password"
                      value={draft.appSecret ?? ''}
                      placeholder={bot.appSecretConfigured ? bot.appSecretMask : '填入 App Secret'}
                      aria-label="机器人 App Secret"
                      onChange={(event) => { patchDraft(bot.id, { appSecret: event.target.value }) }}
                    />
                  </div>
                  {live !== undefined && live.lastError !== '' && live.lastError !== undefined && (
                    <div className={css['feishuBotError']}>{live.lastError}</div>
                  )}
                </div>
              )
            })}
            <button type="button" className={css['ghostButton']} disabled={busy} onClick={addBot}><IconPlus /> 添加机器人</button>
          </div>
          <label className={css['field']}>
            <span className={css['fieldLabel']}>开放平台地址</span>
            <input className={css['input']} value={config.domain} onChange={(event) => { setConfig({ ...config, domain: event.target.value }) }} />
          </label>
        </section>

        <section className={css['githubSection']}>
          {cardTitle('plug', 'Agent 配置', '所有机器人共用：模型与预设')}
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
            <label className={css['field']}><span className={css['fieldLabel']}>独立会话工作目录</span><input className={css['input']} value={config.cwd} onChange={(event) => { setConfig({ ...config, cwd: event.target.value }) }} placeholder="D:/项目" /></label>
          </div>
        </section>

        <section className={css['githubSection']}>
          {cardTitle('users', '访问与消息', '谁能用、怎么回应')}
          <div className={css['form']}>
            <label className={css['field']}><span className={css['fieldLabel']}>允许的 open_id</span><textarea className={[css['input'], css['textarea']].filter(Boolean).join(' ')} value={allowUsersText} onChange={(event) => { setAllowUsersText(event.target.value) }} placeholder="每行一个 ou_xxx" /></label>
            <label className={css['checkRow']}><input type="checkbox" checked={config.ack} onChange={(event) => { setConfig({ ...config, ack: event.target.checked }) }} />收到消息后添加确认反应</label>
            <label className={css['field']}><span className={css['fieldLabel']}>确认反应</span><input className={css['input']} value={config.ackReaction} onChange={(event) => { setConfig({ ...config, ackReaction: event.target.value }) }} /></label>
            <label className={css['field']}><span className={css['fieldLabel']}>群聊响应</span><select className={css['input']} value={config.groupMode} onChange={(event) => { setConfig({ ...config, groupMode: event.target.value as 'all' | 'mention' }) }}><option value="all">所有消息</option><option value="mention">仅被 @ 时</option></select></label>
            <label className={css['checkRow']}><input type="checkbox" checked={config.syncCatchUp} onChange={(event) => { setConfig({ ...config, syncCatchUp: event.target.checked }) }} />连接恢复后补收消息</label>
            <label className={css['field']}><span className={css['fieldLabel']}>新会话欢迎语</span><textarea className={[css['input'], css['textarea']].filter(Boolean).join(' ')} value={config.welcomeText} onChange={(event) => { setConfig({ ...config, welcomeText: event.target.value }) }} placeholder="可留空" /></label>
          </div>
        </section>

        <section className={css['githubSection']}>
          {cardTitle('bell', '完成通知', '任务完成飞书卡片提醒')}
          <div className={css['form']}>
            <label className={css['checkRow']}><input type="checkbox" checked={config.notifyOnComplete} onChange={(event) => { setConfig({ ...config, notifyOnComplete: event.target.checked }) }} />电脑端任务完成时通过飞书卡片通知</label>
            <label className={css['field']}>
              <span className={css['fieldLabel']}>通知机器人</span>
              <select className={css['input']} value={config.notifyBotId} onChange={(event) => { setConfig({ ...config, notifyBotId: event.target.value }) }}>
                <option value="">自动选择（首个含通知角色的启用机器人）</option>
                {notifyOptions.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}（{BOT_ROLE_LABELS[bot.role]}）</option>)}
              </select>
            </label>
            <label className={css['field']}><span className={css['fieldLabel']}>通知目标 chat_id</span><input className={css['input']} value={config.notifyChatId} onChange={(event) => { setConfig({ ...config, notifyChatId: event.target.value }) }} placeholder="oc_xxx（群）或 on_xxx（个人 open_id）" /></label>
          </div>
        </section>

        <section className={[css['githubSection'], css['feishuWide']].join(' ')}>
          {cardTitle('activity', '运行状态', '实时生效配置 · 每 10 秒自动刷新')}
          <div className={css['feishuStatGrid']}>
            <div className={css['feishuStat']}><span>连接</span><strong data-state={status.connected ? 'ok' : status.state === 'connecting' ? 'pending' : 'idle'}>{connectionLabel(status)}</strong></div>
            <div className={css['feishuStat']}><span>机器人</span><strong data-state={connectedCount > 0 ? 'ok' : 'idle'}>{connectedCount}/{config.bots.length} 在线</strong></div>
            <div className={css['feishuStat']}><span>Provider</span><strong className={css['monoText']}>{actualProvider}</strong></div>
            <div className={css['feishuStat']}><span>Model</span><strong className={css['monoText']}>{actualModel}</strong></div>
            <div className={css['feishuStat']}><span>推理级别</span><strong>{actualEffort}</strong></div>
            <div className={css['feishuStat']}><span>Agent 预设</span><strong>{actualPreset}</strong></div>
            <div className={css['feishuStat']}><span>独立会话</span><strong data-state={sessions.length > 0 ? 'ok' : 'idle'}>{sessions.length}</strong></div>
          </div>
        </section>
      </div>

      <section className={css['githubSection']}>
        <div className={css['toolbar']}>
          <h3 className={css['sectionTitle']}>
            <span className={css['cardIcon']} data-kind="users" aria-hidden="true"><IconUsers /></span>
            活动会话
          </h3>
          <span className={css['toolbarSpacer']} />
          <button type="button" className={css['primaryButton']} disabled={busy} onClick={() => { void save() }}>保存飞书设置</button>
        </div>
        {sessions.length === 0 ? (
          <div className={css['empty']}>暂无活动飞书会话</div>
        ) : (
          <div className={css['tableScroll']}>
            <table className={css['dataTable']}>
              <thead><tr><th>机器人</th><th>Chat ID</th><th>会话</th><th>模型</th><th>状态</th></tr></thead>
              <tbody>{sessions.map((session) => {
                const botName = config.bots.find((bot) => bot.id === session.botId)?.name ?? session.botId ?? '--'
                return (
                  <tr key={session.chatId + '/' + session.sessionId}>
                    <td>{botName}</td>
                    <td className={css['monoText']}>{session.chatId}</td>
                    <td className={css['monoText']}>{session.sessionId}</td>
                    <td>{session.provider} / {session.model}<div className={css['resourceMeta']}>{session.effort || '默认'} · {session.preset}</div></td>
                    <td><span className={css['badge']} data-status={session.status}>{session.status}</span></td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  )
}
