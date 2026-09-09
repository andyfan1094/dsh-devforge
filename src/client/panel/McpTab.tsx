/**
 * MCP 页签 —— 外部 MCP 服务器配置管理。
 *
 * 职责：展示服务器清单与运行时状态（fiber 挂载/已注册工具）、新增与编辑表单、
 * 连接测试与全量重载。所有请求走 DevforgeApi 客户端层；失败内联横幅提示。
 * 密钥纪律：env/headers 只显示键与「已配置」标记；输入框留空 = 保留已存值。
 * 布局：统一面板布局体系 —— workspace 作为滚动根（在 DevforgePanel 的
 * overflow:hidden 内容区内自行滚动），卡片/表单/操作栏复用 surface、
 * formRow、field 等现成类；窄屏依赖 flex-wrap 与 tableScroll 防溢出。
 */
import { useCallback, useEffect, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { McpRuntimeStatus, McpSecretInput, McpServerSaveRequest, McpServerSummary, McpTestResult } from '../../mcp/protocol.ts'
import css from './panel.module.css'

/** 编辑表单的行状态：value 为空串表示「保留已存值」（configured 标记提示）。 */
interface SecretRow {
  key: string
  value: string
  configured: boolean
}

/** 编辑表单状态（与 McpServerSaveRequest 一一对应，args 用按行文本承载）。 */
interface McpFormState {
  id?: string
  name: string
  serverName: string
  transport: 'stdio' | 'streamable-http'
  enabled: boolean
  command: string
  argsText: string
  cwd: string
  envRows: SecretRow[]
  url: string
  headerRows: SecretRow[]
  toolCallTimeoutMs: number
}

/** 空表单（新增默认值）。 */
function emptyForm(): McpFormState {
  return {
    name: '',
    serverName: '',
    transport: 'stdio',
    enabled: true,
    command: '',
    argsText: '',
    cwd: '',
    envRows: [{ key: '', value: '', configured: false }],
    url: '',
    headerRows: [{ key: '', value: '', configured: false }],
    toolCallTimeoutMs: 60000,
  }
}

/** 摘要 → 表单（编辑回填；密钥值不回填，留空即保留）。 */
function formFromSummary(summary: McpServerSummary): McpFormState {
  return {
    id: summary.id,
    name: summary.name,
    serverName: summary.serverName,
    transport: summary.transport,
    enabled: summary.enabled,
    command: summary.command,
    argsText: summary.args.join('\n'),
    cwd: summary.cwd,
    envRows: summary.envEntries.length > 0 ? summary.envEntries.map((entry) => ({ key: entry.key, value: '', configured: entry.configured })) : [{ key: '', value: '', configured: false }],
    url: summary.url,
    headerRows: summary.headerEntries.length > 0 ? summary.headerEntries.map((entry) => ({ key: entry.key, value: '', configured: entry.configured })) : [{ key: '', value: '', configured: false }],
    toolCallTimeoutMs: summary.toolCallTimeoutMs,
  }
}

/** 表单 → 保存/测试请求（过滤空键名；空值语义由 Host 端「保留已存值」处理）。 */
function formToRequest(form: McpFormState): McpServerSaveRequest {
  const toSecretInputs = (rows: SecretRow[]): McpSecretInput[] => rows
    .filter((row) => row.key.trim() !== '')
    .map((row) => ({ key: row.key.trim(), value: row.value }))
  const base: McpServerSaveRequest = {
    ...(form.id !== undefined ? { id: form.id } : {}),
    name: form.name.trim(),
    serverName: form.serverName.trim(),
    transport: form.transport,
    enabled: form.enabled,
    toolCallTimeoutMs: form.toolCallTimeoutMs,
  }
  if (form.transport === 'stdio') {
    return {
      ...base,
      command: form.command.trim(),
      args: form.argsText.split('\n').map((line) => line.trim()).filter((line) => line !== ''),
      cwd: form.cwd.trim(),
      env: toSecretInputs(form.envRows),
    }
  }
  return { ...base, url: form.url.trim(), headers: toSecretInputs(form.headerRows) }
}

/** 服务器目标摘要（列表行展示：命令或 URL）。 */
function targetSummary(server: McpServerSummary): string {
  return server.transport === 'stdio'
    ? [server.command, ...server.args].join(' ')
    : server.url
}

/** 服务器行内的运行时徽标文案。 */
function runtimeBadge(server: McpServerSummary, status: McpRuntimeStatus | null): string {
  const runtime = status?.servers.find((item) => item.id === server.id)
  if (runtime === undefined) return status === null ? '…' : '未挂载'
  if (!runtime.mounted) return runtime.state !== undefined ? '异常（' + runtime.state + '）' : '未挂载'
  return runtime.tools.length > 0 ? `已挂载 · ${runtime.tools.length} 工具` : '已挂载 · 未发现工具'
}

export function McpTab({ api }: { api: DevforgeApi }): JSX.Element {
  const [servers, setServers] = useState<McpServerSummary[]>([])
  const [status, setStatus] = useState<McpRuntimeStatus | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [form, setForm] = useState<McpFormState | null>(null)
  const [testResult, setTestResult] = useState<McpTestResult | null>(null)
  const [testing, setTesting] = useState(false)

  /** 并行拉取配置清单与运行时状态；失败内联提示，不阻塞面板其余页签。 */
  const reload = useCallback(async (): Promise<void> => {
    try {
      const [serverList, runtimeStatus] = await Promise.all([
        api.listMcpServers(),
        api.getMcpStatus().catch(() => null),
      ])
      setServers(serverList)
      setStatus(runtimeStatus)
      setMessage('')
    } catch (error) {
      setMessage('加载失败：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      setLoaded(true)
    }
  }, [api])

  useEffect(() => { void reload() }, [reload])

  /** 统一动作包装：busy + 错误内联。 */
  const run = async (fn: () => Promise<string>): Promise<void> => {
    setBusy(true)
    setMessage('')
    try { setMessage(await fn()) }
    catch (error) { setMessage('❌ ' + (error instanceof Error ? error.message : String(error))) }
    finally { setBusy(false) }
  }

  /** 保存表单（新增或更新）；保存即生效，无需重启。 */
  const save = (): Promise<void> => run(async () => {
    if (form === null) return '表单未打开。'
    await api.saveMcpServer(formToRequest(form))
    setForm(null)
    await reload()
    return '✅ 已保存并生效'
  })

  /** 删除服务器（二次确认）。 */
  const remove = (server: McpServerSummary): Promise<void> => run(async () => {
    if (!window.confirm(`确认删除 MCP 服务器「${server.name}」？其全部工具将从模型侧移除。`)) return '已取消'
    await api.deleteMcpServer(server.id)
    await reload()
    return '✅ 已删除并卸载'
  })

  /** 启停切换：翻转 enabled 并保存（挂载/卸载即时生效）。 */
  const toggleEnabled = (server: McpServerSummary): Promise<void> => run(async () => {
    await api.saveMcpServer({ id: server.id, enabled: !server.enabled })
    await reload()
    return server.enabled ? '⏸ 已停用（工具已卸载）' : '▶️ 已启用（工具已注册）'
  })

  /** 测试已存配置（含已存密钥）。 */
  const testSaved = (server: McpServerSummary): Promise<void> => run(async () => {
    setTesting(true)
    try {
      const result = await api.testMcpServer({ id: server.id })
      setTestResult(result)
    } finally { setTesting(false) }
    return ''
  })

  /** 测试当前表单（未保存也行；密钥空值由 Host 回填已存值）。 */
  const testForm = (): Promise<void> => run(async () => {
    if (form === null) return '表单未打开。'
    setTesting(true)
    try {
      const result = await api.testMcpServer({ server: formToRequest(form) })
      setTestResult(result)
    } finally { setTesting(false) }
    return ''
  })

  /** 全量重载：断开全部连接后按当前配置重建。 */
  const reloadAll = (): Promise<void> => run(async () => {
    const next = await api.reloadMcp()
    setStatus(next)
    return '✅ 已全量重载（' + next.mountedCount + ' 台已挂载）'
  })

  return (
    <section className={css.workspace}>
      {message !== '' && <div className={css.banner}>{message}</div>}

      {/* 概览与主操作栏：徽标统计靠左、动作靠右，窄屏由 surfaceHeader 换行防溢出 */}
      <section className={css.surface}>
        <div className={css.surfaceHeader}>
          <span className={css.badge}>{servers.length} 台服务器</span>
          <span className={css.badge}>{status === null ? '…' : `${status.mountedCount} 已挂载 · ${status.toolCount} 工具已注册`}</span>
          <span className={css.rowSpacer} />
          <button type="button" className={css.ghostButton} disabled={busy} onClick={() => { setForm(emptyForm()) }}>添加服务器</button>
          <button type="button" className={css.ghostButton} disabled={busy} onClick={() => { void reloadAll() }}>重载全部</button>
          <button type="button" className={css.ghostButton} disabled={busy} onClick={() => { void reload() }}>刷新</button>
        </div>
      </section>

      {!loaded && <div className={css.empty} data-loading="">正在加载 MCP 配置…</div>}
      {loaded && servers.length === 0 && (
        <div className={css.empty}>还没有配置 MCP 服务器——点上方「添加服务器」，配置后其工具会以 mcp__&lt;命名空间&gt;__&lt;工具名&gt; 注册给模型。</div>
      )}

      {servers.map((server) => (
        <section key={server.id} className={css.surface}>
          <div className={css.surfaceHeader}>
            <strong className={css.surfaceTitle}>{server.name}</strong>
            <span className={css.badge} title="模型可见工具的命名空间">mcp__{server.serverName}__*</span>
            <span className={css.badge}>{server.transport === 'stdio' ? 'stdio' : 'HTTP'}</span>
            <span className={css.subtleText} title={status?.servers.find((item) => item.id === server.id)?.tools.map((tool) => tool.name).join('\n')}>{runtimeBadge(server, status)}</span>
            <span className={css.rowSpacer} />
            <label className={css.checkLabel} title="停用后其全部工具从模型侧卸载">
              <input type="checkbox" checked={server.enabled} disabled={busy} onChange={() => { void toggleEnabled(server) }} />启用
            </label>
            <button type="button" className={css.ghostButton} disabled={busy || testing} onClick={() => { void testSaved(server) }}>测试连接</button>
            <button type="button" className={css.ghostButton} onClick={() => { setForm(formFromSummary(server)) }}>编辑</button>
            <button type="button" className={css.dangerButton} disabled={busy} onClick={() => { void remove(server) }}>删除</button>
          </div>
          {/* 目标摘要：等宽字体 + 任意位置换行，长命令/长 URL 不再撑破卡片 */}
          <p className={css.monoText}>
            {targetSummary(server)}
            {server.transport === 'stdio' && server.cwd !== '' ? ' · cwd=' + server.cwd : ''}
            {' · 超时 ' + Math.round(server.toolCallTimeoutMs / 1000) + 's'}
          </p>
          {server.lastTest !== undefined && (
            <p className={css.subtleText}>
              {server.lastTest.ok
                ? `✅ 最近测试通过（${new Date(server.lastTest.at).toLocaleString()}，发现 ${server.lastTest.toolCount ?? 0} 个工具）`
                : `❌ 最近测试失败（${new Date(server.lastTest.at).toLocaleString()}）：${server.lastTest.error ?? '未知错误'}`}
            </p>
          )}
        </section>
      ))}

      {/* 编辑弹层：新增/编辑共用；密钥行留空 = 保留已存值。
          内容栈复用 resultStack（纵向字段栈 + min-width 保护），
          仅保留功能性的限高/滚动/内边距 inline 样式，弹窗尺寸与滚动行为不变。 */}
      {form !== null && (
        <div className={css.modalBackdrop} onClick={() => { setForm(null) }}>
          <div className={css.modal} role="dialog" aria-modal="true" aria-label="编辑 MCP 服务器" onClick={(event) => { event.stopPropagation() }}>
            <h3 className={css.modalTitle}>{form.id === undefined ? '添加 MCP 服务器' : '编辑 MCP 服务器'}</h3>
            <div className={css.resultStack} style={{ maxHeight: '60vh', overflow: 'auto', paddingRight: 4 }}>
              <div className={css.formRow}>
                <label className={[css.field, css.fieldGrow].join(' ')}>
                  <span className={css.fieldLabel}>显示名</span>
                  <input className={css.input} value={form.name} placeholder="默认取命名空间" onChange={(e) => { setForm({ ...form, name: e.target.value }) }} />
                </label>
                <label className={[css.field, css.fieldGrow].join(' ')}>
                  <span className={css.fieldLabel}>命名空间 serverName（工具名前缀）</span>
                  <input className={css.input} value={form.serverName} placeholder="如 github（字母/数字/_/-，1-32 位）" onChange={(e) => { setForm({ ...form, serverName: e.target.value }) }} />
                </label>
              </div>
              <div className={css.formRow}>
                <label className={[css.field, css.fieldCompact].join(' ')}>
                  <span className={css.fieldLabel}>传输类型</span>
                  <select className={css.input} value={form.transport} onChange={(e) => { setForm({ ...form, transport: e.target.value as McpFormState['transport'] }) }}>
                    <option value="stdio">stdio（本地子进程）</option>
                    <option value="streamable-http">Streamable HTTP（远端服务）</option>
                  </select>
                </label>
                <label className={css.checkLabel}>
                  <input type="checkbox" checked={form.enabled} onChange={(e) => { setForm({ ...form, enabled: e.target.checked }) }} />启用
                </label>
                <label className={[css.field, css.fieldCompact].join(' ')}>
                  <span className={css.fieldLabel}>工具调用超时（毫秒）</span>
                  <input className={css.input} type="number" min={5000} max={600000} step={1000} value={form.toolCallTimeoutMs} onChange={(e) => { setForm({ ...form, toolCallTimeoutMs: Number(e.target.value) || 60000 }) }} />
                </label>
              </div>

              {form.transport === 'stdio' ? (
                <>
                  <label className={css.field}>
                    <span className={css.fieldLabel}>启动命令（如 npx / uvx / 本机可执行文件）</span>
                    <input className={css.input} style={{ fontFamily: 'ui-monospace, monospace' }} value={form.command} placeholder="npx" onChange={(e) => { setForm({ ...form, command: e.target.value }) }} />
                  </label>
                  <label className={css.field}>
                    <span className={css.fieldLabel}>参数（每行一个，不做 shell 插值）</span>
                    {/* 保留 54px 紧凑高度与等宽字体：参数通常 1-3 行，避免弹窗无故拔高 */}
                    <textarea className={css.input} style={{ minHeight: 54, fontFamily: 'ui-monospace, monospace' }} value={form.argsText} placeholder={'-y\n@modelcontextprotocol/server-github'} onChange={(e) => { setForm({ ...form, argsText: e.target.value }) }} />
                  </label>
                  <label className={css.field}>
                    <span className={css.fieldLabel}>工作目录（留空 = 继承宿主）</span>
                    <input className={css.input} style={{ fontFamily: 'ui-monospace, monospace' }} value={form.cwd} onChange={(e) => { setForm({ ...form, cwd: e.target.value }) }} />
                  </label>
                  <div className={css.field}>
                    <span className={css.fieldLabel}>环境变量</span>
                    {form.envRows.map((entry, index) => (
                      <div key={index} className={css.formRow}>
                        <input className={[css.input, css.fieldGrow].join(' ')} style={{ fontFamily: 'ui-monospace, monospace' }} value={entry.key} placeholder="键，如 GITHUB_TOKEN" onChange={(e) => { setForm({ ...form, envRows: form.envRows.map((item, i) => (i === index ? { ...item, key: e.target.value } : item)) }) }} />
                        <input className={[css.input, css.fieldGrow].join(' ')} style={{ fontFamily: 'ui-monospace, monospace' }} type="password" value={entry.value} placeholder={entry.configured ? '已配置——留空保持原值' : '值'} onChange={(e) => { setForm({ ...form, envRows: form.envRows.map((item, i) => (i === index ? { ...item, value: e.target.value } : item)) }) }} />
                        <button type="button" className={css.ghostButton} onClick={() => { setForm({ ...form, envRows: form.envRows.length > 1 ? form.envRows.filter((_, i) => i !== index) : [{ key: '', value: '', configured: false }] }) }}>移除</button>
                      </div>
                    ))}
                    <button type="button" className={css.ghostButton} onClick={() => { setForm({ ...form, envRows: [...form.envRows, { key: '', value: '', configured: false }] }) }}>+ 添加变量</button>
                  </div>
                </>
              ) : (
                <>
                  <label className={css.field}>
                    <span className={css.fieldLabel}>MCP 端点 URL</span>
                    <input className={css.input} style={{ fontFamily: 'ui-monospace, monospace' }} value={form.url} placeholder="http://127.0.0.1:3000/mcp" onChange={(e) => { setForm({ ...form, url: e.target.value }) }} />
                  </label>
                  <div className={css.field}>
                    <span className={css.fieldLabel}>请求头（如 Authorization）</span>
                    {form.headerRows.map((entry, index) => (
                      <div key={index} className={css.formRow}>
                        <input className={[css.input, css.fieldGrow].join(' ')} style={{ fontFamily: 'ui-monospace, monospace' }} value={entry.key} placeholder="键，如 Authorization" onChange={(e) => { setForm({ ...form, headerRows: form.headerRows.map((item, i) => (i === index ? { ...item, key: e.target.value } : item)) }) }} />
                        <input className={[css.input, css.fieldGrow].join(' ')} style={{ fontFamily: 'ui-monospace, monospace' }} type="password" value={entry.value} placeholder={entry.configured ? '已配置——留空保持原值' : '值'} onChange={(e) => { setForm({ ...form, headerRows: form.headerRows.map((item, i) => (i === index ? { ...item, value: e.target.value } : item)) }) }} />
                        <button type="button" className={css.ghostButton} onClick={() => { setForm({ ...form, headerRows: form.headerRows.length > 1 ? form.headerRows.filter((_, i) => i !== index) : [{ key: '', value: '', configured: false }] }) }}>移除</button>
                      </div>
                    ))}
                    <button type="button" className={css.ghostButton} onClick={() => { setForm({ ...form, headerRows: [...form.headerRows, { key: '', value: '', configured: false }] }) }}>+ 添加请求头</button>
                  </div>
                </>
              )}
              <p className={css.subtleText}>工具注册后以 mcp__{form.serverName || '<命名空间>'}__&lt;工具名&gt; 呈现给模型；调用失败会如实报错，不会伪造成功。</p>
            </div>
            <div className={css.modalActions}>
              <button type="button" className={css.ghostButton} disabled={busy || testing} onClick={() => { void testForm() }}>{testing ? '测试中…' : '测试连接'}</button>
              <button type="button" className={css.ghostButton} disabled={busy} onClick={() => { void save() }}>{busy ? '保存中…' : '保存'}</button>
              <button type="button" className={css.ghostButton} onClick={() => { setForm(null) }}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 测试结果弹层：工具清单 + 公开名预览；表格套 tableScroll，窄屏在弹窗内横向滚动而非撑破 */}
      {testResult !== null && (
        <div className={css.modalBackdrop} onClick={() => { setTestResult(null) }}>
          <div className={css.modal} role="dialog" aria-modal="true" aria-label="MCP 连接测试结果" onClick={(event) => { event.stopPropagation() }}>
            <h3 className={css.modalTitle}>{testResult.ok ? '✅ 连接成功' : '❌ 连接失败'}{testResult.serverInfo !== undefined ? ' · ' + testResult.serverInfo : ''}{testResult.ok ? ` · ${testResult.ms}ms` : ''}</h3>
            <div className={css.modalContent} style={{ maxHeight: '50vh' }}>
              {testResult.ok && (testResult.tools?.length ?? 0) === 0 && <div>连接成功，但服务器未发布任何工具。</div>}
              {testResult.ok && (testResult.tools?.length ?? 0) > 0 && (
                <div className={css.tableScroll}>
                  <table className={css.dataTable}>
                    <thead><tr><th>工具名（注册给模型）</th><th>原始名</th><th>说明</th></tr></thead>
                    <tbody>
                      {(testResult.tools ?? []).map((tool) => (
                        <tr key={tool.publicName}>
                          <td style={{ fontFamily: 'ui-monospace, monospace' }}>{tool.publicName}</td>
                          <td style={{ fontFamily: 'ui-monospace, monospace' }}>{tool.name}</td>
                          <td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tool.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!testResult.ok && <div>{testResult.error}</div>}
            </div>
            <div className={css.modalActions}>
              <button type="button" className={css.ghostButton} onClick={() => { setTestResult(null) }}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
