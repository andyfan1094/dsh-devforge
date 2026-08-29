// Vendored from dsh-feishu 0.2.2 (MIT, andyfan1094/dsh-feishu).
// dsh-devforge consolidation modification: module folded into dsh-devforge;
// runtime behavior preserved. See THIRD_PARTY_NOTICES.md.
export const inject = []

const BASE = '/api/dsh-feishu'
const CSS = `
[data-dsh-feishu-view]{display:none;height:100%;min-height:0;color:var(--dsw-alias-fg-l1,#e8e8e8);background:var(--dsw-alias-bg-l1,#151515);font:13px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
html[data-dsh-feishu-active] [data-dsh-feishu-view]{display:flex;flex-direction:column}
html[data-dsh-feishu-active] [data-pane="conversation"]>*:not([data-dsh-feishu-view]){display:none!important}
.NS3bAW_entry{width:100%;height:32px;color:var(--dsw-alias-label-secondary);white-space:nowrap;cursor:pointer;background:transparent;border:0;border-radius:8px;display:flex;align-items:center;gap:8px;padding:0 12px;font-size:13px}
.NS3bAW_entry:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-specific-sidebar-nav-item-hover)}
.NS3bAW_entry[data-active]{color:var(--dsw-alias-label-primary);background:var(--dsw-specific-sidebar-nav-item-active);font-weight:600}
.NS3bAW_entryIcon{display:inline-flex;align-items:center;justify-content:center;flex:none}
.NS3bAW_entryLabel{overflow:hidden;text-overflow:ellipsis}
[data-dsh-frame][data-sidebar-collapsed] .NS3bAW_entry{justify-content:center;width:100%;padding:0}
[data-dsh-frame][data-sidebar-collapsed] .NS3bAW_entryLabel{display:none}
.dshFeishuPanel{display:flex;flex-direction:column;min-height:0;height:100%}
.dshFeishuHeader{display:flex;align-items:center;gap:14px;padding:17px 24px 14px;border-bottom:1px solid rgba(255,255,255,.1)}
.dshFeishuStatusLine{width:4px;align-self:stretch;border-radius:2px;background:#777}
.dshFeishuStatusLine[data-state="connected"]{background:#46c69c}
.dshFeishuStatusLine[data-state="connecting"]{background:#e4ae57}
.dshFeishuStatusLine[data-state="error"]{background:#df7777}
.dshFeishuTitle{margin:0;font-size:17px;font-weight:650}
.dshFeishuSubtle{color:#9b9b9b;font-size:12px}
.dshFeishuClose{margin-left:auto;border:1px solid rgba(255,255,255,.16);border-radius:5px;padding:5px 10px;color:inherit;background:transparent;cursor:pointer}
.dshFeishuBody{min-height:0;overflow:auto;padding:0 24px 28px}
.dshFeishuSection{padding:22px 0;border-bottom:1px solid rgba(255,255,255,.1)}
.dshFeishuSection:last-child{border-bottom:0}
.dshFeishuSection h3{margin:0 0 14px;font-size:13px;font-weight:650}
.dshFeishuGrid{display:grid;grid-template-columns:minmax(260px,1fr) minmax(260px,1fr);gap:0 28px}
.dshFeishuSpan{grid-column:1/-1}
.dshFeishuForm{display:grid;gap:12px}
.dshFeishuField{display:grid;gap:6px;min-width:0}
.dshFeishuField>span{color:#b8b8b8;font-size:12px}
.dshFeishuInput,.dshFeishuSelect,.dshFeishuTextarea{width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,.16);border-radius:5px;background:#202020;color:inherit;padding:8px 10px;outline:none}
.dshFeishuInput:focus,.dshFeishuSelect:focus,.dshFeishuTextarea:focus{border-color:#46a58a}
.dshFeishuTextarea{min-height:92px;resize:vertical}
.dshFeishuCheck{display:flex;align-items:center;gap:8px;color:#c8c8c8}
.dshFeishuMetric{display:grid;grid-template-columns:110px minmax(0,1fr);gap:12px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.07)}
.dshFeishuMetric strong{font-weight:600;overflow-wrap:anywhere}
.dshFeishuActions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
.dshFeishuButton{border:1px solid rgba(255,255,255,.18);border-radius:5px;padding:7px 12px;color:inherit;background:#242424;cursor:pointer}
.dshFeishuButton[data-primary]{border-color:#3d8f78;background:#26705c}
.dshFeishuButton:disabled,.dshFeishuInput:disabled,.dshFeishuSelect:disabled,.dshFeishuTextarea:disabled{opacity:.55;cursor:not-allowed}
.dshFeishuNotice{margin:18px 0 0;padding:9px 11px;border-left:3px solid #46a58a;background:rgba(70,165,138,.1)}
.dshFeishuNotice[data-kind="error"]{border-color:#d66;background:rgba(221,102,102,.1)}
.dshFeishuSession{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08)}
.dshFeishuSession:last-child{border-bottom:0}
.dshFeishuSessionMeta{margin-top:3px;color:#969696;font-size:12px;overflow-wrap:anywhere}
.dshFeishuMono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}
.dshFeishuBadge{display:inline-flex;align-items:center;min-height:22px;border-radius:4px;padding:0 7px;background:#292929;color:#bbb;font-size:11px}
@media(max-width:760px){.dshFeishuHeader{padding-left:16px;padding-right:16px}.dshFeishuBody{padding-left:16px;padding-right:16px}.dshFeishuGrid{grid-template-columns:1fr;gap:0}.dshFeishuSpan{grid-column:auto}}
`

function installStyles() {
  if (document.querySelector('style[data-dsh-feishu-css]')) return
  const tag = document.createElement('style')
  tag.dataset.dshFeishuCss = 'true'
  tag.textContent = CSS
  document.head.appendChild(tag)
}

function sidebarRoot() {
  const column = document.querySelector('[data-pane="sidebar"],[class*="sidebarCol"]')
  if (!column) return null
  return column.querySelector('[class*="logoRow"]')?.parentElement ?? column.firstElementChild
}

async function json(response) {
  let body
  try { body = await response.json() } catch { throw new Error('HTTP ' + response.status + ': invalid JSON') }
  if (!response.ok) throw new Error(body?.error ?? ('HTTP ' + response.status))
  return body
}

function option(value, label, disabled = false) {
  const node = document.createElement('option')
  node.value = value
  node.textContent = label
  node.disabled = disabled
  return node
}

export function apply(ctx) {
  installStyles()
  let open = false
  let container = null
  let entry = null
  let observer = null
  let busy = false
  let catalog = { current: {}, providers: [], models: [], presets: [] }

  const field = (name) => container?.querySelector('[data-field="' + name + '"]')
  const role = (name) => container?.querySelector('[data-role="' + name + '"]')

  const setOpen = (value) => {
    open = value
    document.documentElement.toggleAttribute('data-dsh-feishu-active', open)
    if (entry) entry.dataset.active = open ? 'true' : 'false'
    if (open) void refresh()
  }

  const ensureEntry = () => {
    if (entry?.isConnected) return
    const root = sidebarRoot()
    if (!root) return
    entry = document.createElement('button')
    entry.type = 'button'
    entry.className = 'NS3bAW_entry'
    entry.dataset.dshFeishuEntry = ''
    entry.title = '飞书集成'
    entry.setAttribute('aria-label', '飞书集成')
    entry.innerHTML = '<span class="NS3bAW_entryIcon"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 14L14 2L11 14L8 9L2 14Z"/><path d="M8 9L14 2"/></svg></span><span class="NS3bAW_entryLabel">飞书</span>'
    entry.addEventListener('click', () => setOpen(!open))
    const anchor = root.querySelector('button[class*="newSession"]') ?? root.firstElementChild
    root.insertBefore(entry, anchor?.nextSibling ?? null)
  }

  const ensurePanel = () => {
    if (container?.isConnected) return
    const column = document.querySelector('[data-pane="conversation"],[class*="centerCol"]')
    if (!column) return
    container = document.createElement('div')
    container.dataset.dshFeishuView = ''
    container.innerHTML = `
      <div class="dshFeishuPanel">
        <header class="dshFeishuHeader">
          <div class="dshFeishuStatusLine" data-role="status-line"></div>
          <div><h2 class="dshFeishuTitle">飞书集成</h2><div class="dshFeishuSubtle" data-role="headline">读取连接状态…</div></div>
          <button class="dshFeishuClose" data-action="close" type="button">关闭</button>
        </header>
        <main class="dshFeishuBody">
          <div data-role="notice"></div>
          <div class="dshFeishuGrid">
            <section class="dshFeishuSection">
              <h3>应用连接</h3>
              <div class="dshFeishuForm">
                <label class="dshFeishuCheck"><input data-field="enabled" type="checkbox"> 启用飞书长连接</label>
                <label class="dshFeishuField"><span>App ID</span><input class="dshFeishuInput" data-field="appId" placeholder="cli_xxxxxxxxxxxxxxxx"></label>
                <label class="dshFeishuField"><span>App Secret</span><input class="dshFeishuInput" data-field="appSecret" type="password" placeholder="留空表示保留已保存密钥"><small class="dshFeishuSubtle" data-role="secret-state"></small></label>
                <label class="dshFeishuField"><span>开放平台地址</span><input class="dshFeishuInput" data-field="domain"></label>
                <label class="dshFeishuField"><span>独立会话工作目录</span><input class="dshFeishuInput" data-field="cwd" placeholder="D:\\项目"></label>
              </div>
            </section>
            <section class="dshFeishuSection">
              <h3>Agent 配置</h3>
              <div class="dshFeishuForm">
                <label class="dshFeishuField"><span>Provider</span><select class="dshFeishuSelect" data-field="provider"></select></label>
                <label class="dshFeishuField"><span>Model</span><select class="dshFeishuSelect" data-field="model"></select></label>
                <label class="dshFeishuField"><span>推理级别</span><select class="dshFeishuSelect" data-field="reasoningEffort"></select></label>
                <label class="dshFeishuField"><span>Agent 预设</span><select class="dshFeishuSelect" data-field="agentPreset"></select></label>
              </div>
            </section>
            <section class="dshFeishuSection">
              <h3>运行状态</h3>
              <div class="dshFeishuMetric"><span>WebSocket</span><strong data-role="connection">--</strong></div>
              <div class="dshFeishuMetric"><span>Provider</span><strong data-role="actual-provider">--</strong></div>
              <div class="dshFeishuMetric"><span>Model</span><strong data-role="actual-model">--</strong></div>
              <div class="dshFeishuMetric"><span>推理级别</span><strong data-role="actual-effort">--</strong></div>
              <div class="dshFeishuMetric"><span>Agent 预设</span><strong data-role="actual-preset">--</strong></div>
              <div class="dshFeishuMetric"><span>独立会话</span><strong data-role="session-count">0</strong></div>
              <div class="dshFeishuActions"><button class="dshFeishuButton" data-action="test" type="button">测试连接</button><button class="dshFeishuButton" data-action="refresh" type="button">刷新</button></div>
            </section>
            <section class="dshFeishuSection">
              <h3>访问与确认</h3>
              <div class="dshFeishuForm">
                <label class="dshFeishuField"><span>允许的 open_id</span><textarea class="dshFeishuTextarea" data-field="allowUsers" placeholder="每行一个 ou_xxx"></textarea></label>
                <label class="dshFeishuCheck"><input data-field="ack" type="checkbox"> 收到消息后添加确认反应</label>
                <label class="dshFeishuField"><span>确认反应</span><input class="dshFeishuInput" data-field="ackReaction"></label>
              </div>
            </section>
            <section class="dshFeishuSection dshFeishuSpan">
              <h3>活动会话</h3>
              <div data-role="sessions"></div>
              <div class="dshFeishuActions"><button class="dshFeishuButton" data-primary data-action="save" type="button">保存设置</button></div>
            </section>
          </div>
        </main>
      </div>`
    column.appendChild(container)
    container.querySelector('[data-action="close"]').addEventListener('click', () => setOpen(false))
    container.querySelector('[data-action="refresh"]').addEventListener('click', () => void refresh())
    container.querySelector('[data-action="save"]').addEventListener('click', () => void save())
    container.querySelector('[data-action="test"]').addEventListener('click', () => void testConnection())
    field('provider').addEventListener('change', () => {
      syncModelOptions(true)
      syncEffortOptions(true)
    })
    field('model').addEventListener('change', () => syncEffortOptions(true))
  }

  const notice = (text, kind = '') => {
    const host = role('notice')
    if (!host) return
    host.innerHTML = ''
    if (!text) return
    const box = document.createElement('div')
    box.className = 'dshFeishuNotice'
    if (kind) box.dataset.kind = kind
    box.textContent = text
    host.appendChild(box)
  }

  const setBusy = (value) => {
    busy = value
    container?.querySelectorAll('button,[data-field]').forEach((control) => { control.disabled = value })
    if (!value && field('provider')?.value === '') field('model').disabled = true
  }

  const selectedModel = () => {
    const provider = field('provider')?.value ?? ''
    const model = provider === '' ? catalog.current.model : field('model')?.value ?? ''
    const effectiveProvider = provider === '' ? catalog.current.provider : provider
    return catalog.models.find((item) => item.provider === effectiveProvider && item.model === model)
  }

  const syncProviderOptions = (value = '') => {
    const select = field('provider')
    select.innerHTML = ''
    select.appendChild(option('', '跟随 DSH 默认模型'))
    for (const provider of catalog.providers) select.appendChild(option(provider.provider, provider.name || provider.provider))
    select.value = value
  }

  const syncModelOptions = (reset = false, value = '') => {
    const select = field('model')
    const provider = field('provider').value
    select.innerHTML = ''
    if (provider === '') {
      select.appendChild(option('', (catalog.current.provider && catalog.current.model) ? catalog.current.provider + ' / ' + catalog.current.model : 'DSH 默认模型'))
      select.value = ''
      select.disabled = true
      return
    }
    const models = catalog.models.filter((item) => item.provider === provider)
    for (const model of models) select.appendChild(option(model.model, model.name || model.model))
    if (value && !models.some((item) => item.model === value)) select.appendChild(option(value, value))
    select.disabled = false
    select.value = reset ? (models[0]?.model ?? '') : value
  }

  const syncEffortOptions = (reset = false, value = '') => {
    const select = field('reasoningEffort')
    const followsDefault = field('provider').value === ''
    const model = selectedModel()
    select.innerHTML = ''
    select.appendChild(option('', followsDefault ? '跟随 DSH 默认推理级别' : '使用模型默认推理级别'))
    for (const effort of model?.reasoningEfforts ?? []) select.appendChild(option(effort.id, effort.name || effort.id))
    if (value && !(model?.reasoningEfforts ?? []).some((item) => item.id === value)) select.appendChild(option(value, value, true))
    select.value = reset ? '' : value
  }

  const syncPresetOptions = (value = 'cordis') => {
    const select = field('agentPreset')
    select.innerHTML = ''
    for (const preset of catalog.presets) select.appendChild(option(preset.id, preset.broken ? (preset.name + '（不可用）') : preset.name, Boolean(preset.broken)))
    if (!catalog.presets.some((preset) => preset.id === value)) select.appendChild(option(value, value))
    select.value = value
  }

  const formPayload = () => ({
    enabled: field('enabled').checked,
    appId: field('appId').value.trim(),
    appSecret: field('appSecret').value,
    domain: field('domain').value.trim(),
    cwd: field('cwd').value.trim(),
    provider: field('provider').value,
    model: field('provider').value === '' ? '' : field('model').value,
    reasoningEffort: field('reasoningEffort').value,
    agentPreset: field('agentPreset').value,
    allowUsers: field('allowUsers').value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
    ack: field('ack').checked,
    ackReaction: field('ackReaction').value.trim() || 'OK',
  })

  const renderSessions = (sessions) => {
    const host = role('sessions')
    host.innerHTML = ''
    if (!sessions.length) {
      const empty = document.createElement('div')
      empty.className = 'dshFeishuSubtle'
      empty.textContent = '暂无活动会话'
      host.appendChild(empty)
      return
    }
    for (const session of sessions) {
      const row = document.createElement('div')
      row.className = 'dshFeishuSession'
      const left = document.createElement('div')
      const chat = document.createElement('div')
      chat.className = 'dshFeishuMono'
      chat.textContent = session.chatId
      const sid = document.createElement('div')
      sid.className = 'dshFeishuSessionMeta'
      sid.textContent = session.provider + ' / ' + session.model + ' / ' + (session.effort || '默认') + ' / ' + session.preset + ' · ' + session.sessionId
      left.append(chat, sid)
      const badge = document.createElement('span')
      badge.className = 'dshFeishuBadge'
      badge.textContent = session.status
      row.append(left, badge)
      host.appendChild(row)
    }
  }

  const render = (config, status, options) => {
    catalog = options
    field('enabled').checked = config.enabled
    field('appId').value = config.appId
    field('appSecret').value = ''
    field('domain').value = config.domain
    field('cwd').value = config.cwd
    field('allowUsers').value = config.allowUsers.join('\n')
    field('ack').checked = config.ack
    field('ackReaction').value = config.ackReaction
    role('secret-state').textContent = config.appSecretMask
    syncProviderOptions(config.provider)
    syncModelOptions(false, config.model)
    syncEffortOptions(false, config.reasoningEffort)
    syncPresetOptions(config.agentPreset)
    role('connection').textContent = status.connected ? '已连接' : status.state === 'connecting' ? '连接中' : status.state === 'disabled' ? '已停用' : status.state === 'unconfigured' ? '未配置' : '未连接'
    role('actual-provider').textContent = options.current?.provider || status.model?.provider || '--'
    role('actual-model').textContent = options.current?.model || status.model?.model || '--'
    role('actual-effort').textContent = options.current?.reasoningEffort || '默认'
    role('actual-preset').textContent = options.current?.agentPreset || status.model?.preset || config.agentPreset
    role('session-count').textContent = String(status.independentSessions?.length ?? 0)
    role('status-line').dataset.state = status.state
    role('headline').textContent = status.connected ? 'WebSocket 已连接' : status.lastError || '等待连接'
    renderSessions(status.independentSessions ?? [])
  }

  async function refresh() {
    if (busy) return
    ensurePanel()
    setBusy(true)
    notice('')
    try {
      const [config, status, options] = await Promise.all([
        json(await fetch(BASE + '/config')),
        json(await fetch(BASE + '/status')),
        json(await fetch(BASE + '/models')),
      ])
      render(config.config, status.status, options)
    } catch (error) {
      notice(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (busy) return
    setBusy(true)
    notice('')
    try {
      await json(await fetch(BASE + '/config', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(formPayload()) }))
      setBusy(false)
      await refresh()
      notice('设置已保存；现有飞书 Agent 已关闭，下一条消息将按新配置创建或恢复会话。')
    } catch (error) {
      notice(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function testConnection() {
    if (busy) return
    setBusy(true)
    notice('')
    try {
      await json(await fetch(BASE + '/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(formPayload()) }))
      notice('App ID 与 App Secret 验证成功')
    } catch (error) {
      notice(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const SIDEBAR_CONTEXT_SELECTOR = '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]'
  function onSidebarContextClick(event) {
    if (!open) return
    const target = event.target
    if (target instanceof Element && target.closest(SIDEBAR_CONTEXT_SELECTOR) !== null) setOpen(false)
  }
  document.addEventListener('click', onSidebarContextClick, true)
  function onOtherActive() { if (open) setOpen(false) }
  const otherObserver = new MutationObserver(() => {
    if (document.documentElement.hasAttribute('data-dsh-github-active')) onOtherActive()
  })
  otherObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-dsh-github-active'] })
  const ensure = () => { ensureEntry(); ensurePanel() }
  observer = new MutationObserver(ensure)
  observer.observe(document.body, { childList: true, subtree: true })
  ensure()
  ctx.effect(() => () => {
    document.removeEventListener('click', onSidebarContextClick, true)
    otherObserver.disconnect()
    observer?.disconnect()
    entry?.remove()
    container?.remove()
    document.documentElement.removeAttribute('data-dsh-feishu-active')
  }, 'dsh-feishu: client panel')
}
