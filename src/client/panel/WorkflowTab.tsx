/**
 * 工作流页签 —— 工作流列表/参数编辑/运行台/历史。
 * 布局：统一面板布局体系——根为 workspace 滚动平面（在 DevforgePanel 的 overflow:hidden
 * 内容区内自行滚动），页级工具栏与两张功能卡片统一用 surface，左右双列用 workbenchGrid
 * （窄屏 ≤960px 由公共样式自动折叠为单列），历史数据表置于 tableScroll 内横向滚动。
 * 直接 fetch 同源 API（对齐 RagTab 模式）；所有失败内联横幅提示。
 */
import { useCallback, useEffect, useState } from 'react'
import { WORKFLOW_API, type WorkflowDefinition, type WorkflowRunRecord, type WorkflowRunResult } from '../../workflow/protocol.ts'
import css from './panel.module.css'

/** 同源 JSON 请求。 */
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json' } })
  const body = (await response.json()) as { ok?: boolean; error?: string }
  if (!response.ok || body?.ok === false) throw new Error(body?.error ?? ('HTTP ' + response.status))
  return body as T
}

/** 节点摘要（列表一行展示）。 */
function nodesSummary(workflow: WorkflowDefinition): string {
  const n = workflow.nodes
  const parts = ['检索' + n.retrieve.topK + '/w' + n.retrieve.vectorWeight.toFixed(2)]
  if (n.rewrite?.enabled === true) parts.push('改写')
  if (n.rerank?.enabled === true) parts.push('精排')
  if (n.selfCheck?.enabled === true) parts.push('自评×' + Math.min(n.selfCheck.maxRetries, 2))
  return parts.join(' · ')
}

export function WorkflowTab(): JSX.Element {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([])
  const [selected, setSelected] = useState<WorkflowDefinition | null>(null)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<WorkflowRunResult | null>(null)
  const [runs, setRuns] = useState<WorkflowRunRecord[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const reload = useCallback(async () => {
    try {
      const data = await api<{ workflows: WorkflowDefinition[] }>(WORKFLOW_API.list)
      setWorkflows(data.workflows)
      setSelected((prev) => data.workflows.find((item) => item.id === prev?.id) ?? data.workflows[0] ?? null)
    } catch (error) { setMessage('加载失败：' + (error instanceof Error ? error.message : String(error))) }
  }, [])

  const reloadRuns = useCallback(async (workflowId: string) => {
    try {
      const data = await api<{ runs: WorkflowRunRecord[] }>(WORKFLOW_API.runs + '?workflowId=' + encodeURIComponent(workflowId))
      setRuns(data.runs)
    } catch { setRuns([]) }
  }, [])

  useEffect(() => { void reload() }, [reload])
  useEffect(() => { if (selected !== null) void reloadRuns(selected.id) }, [selected, reloadRuns])

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setMessage('')
    try { await fn() }
    catch (error) { setMessage('❌ ' + (error instanceof Error ? error.message : String(error))) }
    finally { setBusy(false) }
  }

  const createDefault = (): Promise<void> => run(async () => {
    const data = await api<{ workflow: WorkflowDefinition }>(WORKFLOW_API.list, { method: 'POST', body: JSON.stringify({ name: '工作流 ' + new Date().toLocaleTimeString(), nodes: { retrieve: { topK: 8, vectorWeight: 0.5 }, generate: { maxTokens: 1200 }, selfCheck: { enabled: true, maxRetries: 1 } } }) })
    await reload()
    setSelected(data.workflow)
    setMessage('✅ 已创建')
  })

  const patchSelected = (patch: Partial<WorkflowDefinition['nodes']>): void => {
    if (selected === null) return
    setSelected({ ...selected, nodes: { ...selected.nodes, ...patch } })
  }

  const saveSelected = (): Promise<void> => run(async () => {
    if (selected === null) return
    await api(WORKFLOW_API.list, { method: 'POST', body: JSON.stringify({ id: selected.id, name: selected.name, nodes: selected.nodes }) })
    await reload()
    setMessage('✅ 已保存')
  })

  const removeSelected = (): Promise<void> => run(async () => {
    if (selected === null) return
    if (!window.confirm('确认删除该工作流？')) return
    await api(WORKFLOW_API.item + '?id=' + encodeURIComponent(selected.id), { method: 'DELETE' })
    setSelected(null)
    await reload()
    setMessage('✅ 已删除')
  })

  const doRun = (): Promise<void> => run(async () => {
    if (selected === null) throw new Error('先创建或选择一个工作流')
    if (query.trim() === '') throw new Error('问题必填')
    const data = await api<{ result: WorkflowRunResult }>(WORKFLOW_API.run, { method: 'POST', body: JSON.stringify({ query, workflowId: selected.id }) })
    setResult(data.result)
    await reloadRuns(selected.id)
  })

  return (
    <section className={css.workspace}>
      {message !== '' && <div className={css.banner}>{message}</div>}

      {/* 页级工具栏：总数徽标靠左，新建/刷新主操作靠右（surfaceHeader 换行安全）。 */}
      <section className={css.surface}>
        <div className={css.surfaceHeader}>
          <span className={css.badge}>{workflows.length} 个工作流</span>
          <div className={css.rowSpacer} />
          <button type="button" className={css.ghostButton} disabled={busy} onClick={() => { void createDefault() }}>新建默认工作流</button>
          <button type="button" className={css.ghostButton} disabled={busy} onClick={() => { void reload() }}>刷新</button>
        </div>
      </section>

      {/* 双列工作区：workbenchGrid 在窄屏（≤960px）自动折叠为单列，子项不再错位。 */}
      <div className={css.workbenchGrid}>
        <section className={css.surface}>
          <h3 className={css.surfaceTitle}>工作流定义</h3>
          {selected === null
            ? <div className={css.empty}>还没有工作流——点右上角「新建默认工作流」。</div>
            : (
              <div className={css.resultStack}>
                <select className={css.input} value={selected.id} onChange={(e) => setSelected(workflows.find((item) => item.id === e.target.value) ?? null)}>
                  {workflows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <div className={css.subtleText}>{nodesSummary(selected)}</div>
                <label className={css.checkLabel}>
                  <input type="checkbox" checked={selected.nodes.rewrite?.enabled === true} onChange={(e) => patchSelected({ rewrite: { enabled: e.target.checked } })} />查询改写（多路召回）
                </label>
                <label className={css.checkLabel}>
                  <input type="checkbox" checked={selected.nodes.rerank?.enabled === true} onChange={(e) => patchSelected({ rerank: { enabled: e.target.checked } })} />合并后精排
                </label>
                <label className={css.checkLabel}>
                  <input type="checkbox" checked={selected.nodes.selfCheck?.enabled === true} onChange={(e) => patchSelected({ selfCheck: { enabled: e.target.checked, maxRetries: selected.nodes.selfCheck?.maxRetries ?? 1 } })} />自评重试
                </label>
                <div className={css.formRow}>
                  <label className={[css.field, css.fieldCompact].join(' ')}>
                    <span className={css.fieldLabel}>Top-K</span>
                    <input className={css.input} type="number" min={1} max={50} value={selected.nodes.retrieve.topK} onChange={(e) => patchSelected({ retrieve: { ...selected.nodes.retrieve, topK: Number(e.target.value) || 8 } })} />
                  </label>
                  <label className={[css.field, css.fieldGrow].join(' ')}>
                    <span className={css.fieldLabel}>向量 {selected.nodes.retrieve.vectorWeight.toFixed(2)}</span>
                    <input type="range" min={0} max={1} step={0.05} value={selected.nodes.retrieve.vectorWeight} onChange={(e) => patchSelected({ retrieve: { ...selected.nodes.retrieve, vectorWeight: Number(e.target.value) } })} />
                  </label>
                </div>
                <div className={css.actionRow}>
                  <button type="button" className={css.ghostButton} disabled={busy} onClick={() => { void saveSelected() }}>保存参数</button>
                  <button type="button" className={css.dangerButton} disabled={busy} onClick={() => { void removeSelected() }}>删除</button>
                </div>
              </div>
            )}
        </section>
        <section className={css.surface}>
          <h3 className={css.surfaceTitle}>运行台（改写 → 多源检索 → 精排 → 生成 → 自评）</h3>
          <div className={css.formRow}>
            <input className={[css.input, css.fieldGrow].join(' ')} value={query} placeholder="例如：暂存实例怎么启动？" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void doRun() }} />
            <button type="button" className={css.ghostButton} disabled={busy} onClick={() => { void doRun() }}>{busy ? '运行中…' : '运行'}</button>
          </div>
          {result !== null && (
            <div className={css.resultStack}>
              <div className={css.resultItem}>
                <div className={css.monoText}>{result.steps.map((step) => step.name + ' ' + step.ms + 'ms').join(' → ')}</div>
                <div className={css.resultText}>{result.answer}</div>
                <div className={css.subtleText}>
                  出处：{result.sources.map((source, i) => (source.headingPath !== '' ? source.fileName + ' · ' + source.headingPath : source.fileName) + '（' + source.score.toFixed(3) + '）').join('；')}
                </div>
              </div>
            </div>
          )}
          {runs.length > 0 ? (
            /* tableScroll 兜住窄屏：dataTable 最小 620px，超出部分在容器内横向滚动。 */
            <div className={css.tableScroll}>
              <table className={css.dataTable}>
                <thead><tr><th>时间</th><th>问题</th><th style={{ width: 60 }}>状态</th><th style={{ width: 70 }}>步骤</th></tr></thead>
                <tbody>
                  {runs.slice(0, 8).map((item) => (
                    <tr key={item.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{new Date(item.createdAt).toLocaleTimeString()}</td>
                      <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.query}</td>
                      <td>{item.status === 'ok' ? '✅' : '❌'}</td>
                      <td>{item.steps.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={css.subtleText}>暂无运行记录。</div>
          )}
        </section>
      </div>
    </section>
  )
}
