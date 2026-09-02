/**
 * 工作流页签 —— 工作流列表/参数编辑/运行台/历史。
 * 布局：顶栏（新建默认工作流+刷新）→ 左列定义列表与参数、右列运行台与历史（紧凑双栏）。
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

const row = { display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' } as const
const card = { border: '1px solid rgba(128,128,128,0.3)', borderRadius: 8, padding: '8px 10px', minWidth: 0 } as const
const cardTitle = { fontSize: 12, fontWeight: 600, opacity: 0.85, margin: '0 0 6px' } as const

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
      {message !== '' && <div className={css.banner}>{message}</div>}
      <div style={{ ...card, ...row, display: 'flex' }}>
        <span className={css.badge}>{workflows.length} 个工作流</span>
        <div style={{ flex: 1 }} />
        <button type="button" className={css.ghostButton} disabled={busy} onClick={() => { void createDefault() }}>新建默认工作流</button>
        <button type="button" className={css.ghostButton} disabled={busy} onClick={() => { void reload() }}>刷新</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,3fr)', gap: 10, alignItems: 'start' }}>
        <div style={card}>
          <p style={cardTitle}>工作流定义</p>
          {selected === null
            ? <div className={css.empty}>还没有工作流——点右上角「新建默认工作流」。</div>
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <select className={css.input} value={selected.id} onChange={(e) => setSelected(workflows.find((item) => item.id === e.target.value) ?? null)}>
                  {workflows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <div style={{ fontSize: 11, opacity: 0.7 }}>{nodesSummary(selected)}</div>
                <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={selected.nodes.rewrite?.enabled === true} onChange={(e) => patchSelected({ rewrite: { enabled: e.target.checked } })} />查询改写（多路召回）
                </label>
                <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={selected.nodes.rerank?.enabled === true} onChange={(e) => patchSelected({ rerank: { enabled: e.target.checked } })} />合并后精排
                </label>
                <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={selected.nodes.selfCheck?.enabled === true} onChange={(e) => patchSelected({ selfCheck: { enabled: e.target.checked, maxRetries: selected.nodes.selfCheck?.maxRetries ?? 1 } })} />自评重试
                </label>
                <div style={row}>
                  <label style={{ fontSize: 12, opacity: 0.85 }}>Top-K
                    <input className={css.input} style={{ width: 56, marginLeft: 6 }} type="number" min={1} max={50} value={selected.nodes.retrieve.topK} onChange={(e) => patchSelected({ retrieve: { ...selected.nodes.retrieve, topK: Number(e.target.value) || 8 } })} />
                  </label>
                  <label style={{ fontSize: 12, opacity: 0.85, display: 'flex', alignItems: 'center', gap: 6 }}>向量 {selected.nodes.retrieve.vectorWeight.toFixed(2)}
                    <input type="range" min={0} max={1} step={0.05} value={selected.nodes.retrieve.vectorWeight} style={{ width: 100 }} onChange={(e) => patchSelected({ retrieve: { ...selected.nodes.retrieve, vectorWeight: Number(e.target.value) } })} />
                  </label>
                </div>
                <div style={row}>
                  <button type="button" className={css.ghostButton} disabled={busy} onClick={() => { void saveSelected() }}>保存参数</button>
                  <button type="button" className={css.dangerButton} disabled={busy} onClick={() => { void removeSelected() }}>删除</button>
                </div>
              </div>
            )}
        </div>
        <div style={card}>
          <p style={cardTitle}>运行台（改写 → 多源检索 → 精排 → 生成 → 自评）</p>
          <div style={row}>
            <input className={css.input} style={{ flex: 1, minWidth: 200 }} value={query} placeholder="例如：暂存实例怎么启动？" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void doRun() }} />
            <button type="button" className={css.ghostButton} disabled={busy} onClick={() => { void doRun() }}>{busy ? '运行中…' : '运行'}</button>
          </div>
          {result !== null && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 11, opacity: 0.7 }}>{result.steps.map((step) => step.name + ' ' + step.ms + 'ms').join(' → ')}</div>
              <div style={{ fontSize: 12, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{result.answer}</div>
              <div style={{ fontSize: 11, opacity: 0.75 }}>
                出处：{result.sources.map((source, i) => (source.headingPath !== '' ? source.fileName + ' · ' + source.headingPath : source.fileName) + '（' + source.score.toFixed(3) + '）').join('；')}
              </div>
            </div>
          )}
          {runs.length > 0 && (
            <table className={css.dataTable} style={{ marginTop: 10 }}>
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
          )}
        </div>
      </div>
    </div>
  )
}
