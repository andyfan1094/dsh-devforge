/**
 * 记忆中枢页签 —— RAG 知识库管理、文档入库、检索测试台与设置。
 * 布局：顶部工具条（库管理+统计+上传）→ 主体双栏（左文档入库 / 右检索台）
 * → 底部一行式设置。样式复用 panel.module.css 主题类（深浅色自动适配），
 * 信息密度优先且守住块间距底线（辉哥排版偏好）。
 */
import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import { RAG_API, type RagDocument, type RagKnowledgeBase, type RagSearchHit, type RagSettings } from '../../rag/protocol.ts'
import css from './panel.module.css'

/** 同源 API（错误消息直接展示）。 */
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json' } })
  const body = (await response.json()) as { ok?: boolean; error?: string }
  if (!response.ok || body?.ok === false) throw new Error(body?.error ?? ('HTTP ' + response.status))
  return body as T
}

const grid2: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,3fr)', gap: 10, alignItems: 'start' }
const row: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }
const card: React.CSSProperties = { border: '1px solid rgba(128,128,128,0.3)', borderRadius: 8, padding: '8px 10px', minWidth: 0 }
const cardTitle: React.CSSProperties = { fontSize: 12, fontWeight: 600, opacity: 0.85, margin: '0 0 6px' }

export function RagTab() {
  const [kbs, setKbs] = useState<RagKnowledgeBase[]>([])
  const [kbId, setKbId] = useState('')
  const [docs, setDocs] = useState<RagDocument[]>([])
  const [newKbName, setNewKbName] = useState('')
  const [pasteName, setPasteName] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [query, setQuery] = useState('')
  const [topK, setTopK] = useState(8)
  const [vectorWeight, setVectorWeight] = useState(0.5)
  const [hits, setHits] = useState<RagSearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [settings, setSettings] = useState<RagSettings | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const totalChunks = docs.reduce((sum, doc) => sum + doc.chunkCount, 0)

  const reloadKbs = useCallback(async () => {
    try {
      const data = await api<{ kbs: RagKnowledgeBase[] }>(RAG_API.kbList)
      setKbs(data.kbs)
      if (data.kbs.length > 0 && !data.kbs.some((kb) => kb.id === kbId)) setKbId(data.kbs[0].id)
    } catch (error) { setMessage('知识库加载失败：' + (error instanceof Error ? error.message : String(error))) }
  }, [kbId])

  const reloadDocs = useCallback(async (target: string) => {
    if (target === '') { setDocs([]); return }
    try {
      const data = await api<{ docs: RagDocument[] }>(RAG_API.docList + '?kbId=' + encodeURIComponent(target))
      setDocs(data.docs)
    } catch (error) { setMessage('文档加载失败：' + (error instanceof Error ? error.message : String(error))) }
  }, [])

  useEffect(() => { void reloadKbs() }, [reloadKbs])
  useEffect(() => { void reloadDocs(kbId) }, [kbId, reloadDocs])
  useEffect(() => {
    api<{ settings: RagSettings }>(RAG_API.settings).then((data) => setSettings(data.settings)).catch(() => {})
  }, [])

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setMessage('')
    try { await fn() }
    catch (error) { setMessage('❌ ' + (error instanceof Error ? error.message : String(error))) }
    finally { setBusy(false) }
  }

  const createKb = () => run(async () => {
    if (newKbName.trim() === '') throw new Error('库名必填')
    const data = await api<{ kb: RagKnowledgeBase }>(RAG_API.kbList, { method: 'POST', body: JSON.stringify({ name: newKbName.trim() }) })
    setNewKbName('')
    await reloadKbs()
    setKbId(data.kb.id)
    setMessage('✅ 已创建：' + data.kb.name)
  })

  const deleteKb = () => run(async () => {
    if (kbId === '') throw new Error('未选择库')
    if (!window.confirm('确认删除当前知识库及其全部文档？')) return
    await api(RAG_API.kbItem + '?id=' + encodeURIComponent(kbId), { method: 'DELETE' })
    setKbId('')
    await reloadKbs()
    setMessage('✅ 已删除库')
  })

  const ingestText = () => run(async () => {
    if (kbId === '') throw new Error('未选择库')
    if (pasteName.trim() === '' || pasteText.trim() === '') throw new Error('文件名与内容必填')
    await api(RAG_API.docList, { method: 'POST', body: JSON.stringify({ kbId, fileName: pasteName.trim(), text: pasteText }) })
    setPasteName('')
    setPasteText('')
    await reloadDocs(kbId)
    setMessage('✅ 已入库并向量化')
  })

  const uploadFile = (event: ChangeEvent<HTMLInputElement>) => run(async () => {
    const file = event.target.files?.[0]
    if (file === undefined) return
    if (kbId === '') throw new Error('未选择库')
    const isTextLike = /\.(md|txt|csv|json|ya?ml|log|ts|tsx|js|jsx|mjs|py|go|rs|java|sh|css|html)$/i.test(file.name)
    if (isTextLike) {
      const text = await file.text()
      await api(RAG_API.docList, { method: 'POST', body: JSON.stringify({ kbId, fileName: file.name, text }) })
    } else {
      const buffer = await file.arrayBuffer()
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
      await api(RAG_API.docFile, { method: 'POST', body: JSON.stringify({ kbId, fileName: file.name, base64 }) })
    }
    await reloadDocs(kbId)
    setMessage('✅ 已入库：' + file.name)
  })

  const deleteDoc = (id: string) => run(async () => {
    await api(RAG_API.docItem + '?id=' + encodeURIComponent(id), { method: 'DELETE' })
    await reloadDocs(kbId)
    setMessage('✅ 已删除文档')
  })

  const doSearch = () => run(async () => {
    if (query.trim() === '') throw new Error('查询必填')
    setSearching(true)
    try {
      const data = await api<{ hits: RagSearchHit[] }>(RAG_API.search, {
        method: 'POST',
        body: JSON.stringify({ kbIds: kbId === '' ? undefined : [kbId], query, topK, vectorWeight }),
      })
      setHits(data.hits)
      setMessage('✅ 命中 ' + data.hits.length + ' 条')
    } finally { setSearching(false) }
  })

  const saveSettings = () => run(async () => {
    if (settings === null) return
    await api(RAG_API.settings, { method: 'PUT', body: JSON.stringify(settings) })
    setMessage('✅ 设置已保存（向量模型变更后旧库需重新入库）')
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
      {message !== '' && <div className={css.banner}>{message}</div>}

      <div style={{ ...card, padding: '8px 10px' }}>
        <div style={row}>
          <div style={{ flex: '0 0 190px' }}>
            <span className={css.fieldLabel}>知识库（{kbs.length}）</span>
            <select className={css.input} value={kbId} onChange={(e) => setKbId(e.target.value)}>
              {kbs.length === 0 && <option value="">（先创建一个库）</option>}
              {kbs.map((kb) => <option key={kb.id} value={kb.id}>{kb.name}</option>)}
            </select>
          </div>
          <div style={{ flex: '0 0 150px' }}>
            <span className={css.fieldLabel}>新建库</span>
            <input className={css.input} value={newKbName} placeholder="库名" onChange={(e) => setNewKbName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') createKb() }} />
          </div>
          <button type="button" className={css.ghostButton} disabled={busy} onClick={createKb}>创建</button>
          <button type="button" className={css.dangerButton} disabled={busy || kbId === ''} onClick={deleteKb}>删除库</button>
          <div style={{ flex: 1 }} />
          <span className={css.badge}>{docs.length} 文档 · {totalChunks} 切块</span>
          <label className={css.ghostButton} style={{ display: 'inline-block', cursor: 'pointer' }}>
            上传文档
            <input type="file" style={{ display: 'none' }} onChange={uploadFile} accept=".md,.txt,.csv,.json,.yaml,.yml,.log,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.sh,.css,.html,.pdf,.docx" />
          </label>
        </div>
      </div>

      <div style={grid2}>
        <div style={card}>
          <p style={cardTitle}>文档入库</p>
          <div style={row}>
            <input className={css.input} style={{ flex: '0 0 170px' }} value={pasteName} placeholder="文件名（如 部署文档.md）" onChange={(e) => setPasteName(e.target.value)} />
            <button type="button" className={css.ghostButton} disabled={busy} onClick={ingestText}>入库并嵌入</button>
          </div>
          <textarea
            className={css.input}
            style={{ minHeight: 96, resize: 'vertical', margin: '6px 0 8px', fontFamily: 'inherit' }}
            value={pasteText}
            placeholder="粘贴 Markdown / 文本内容…（自动标题感知切块 → 智谱向量化）"
            onChange={(e) => setPasteText(e.target.value)}
          />
          {docs.length === 0
            ? <div className={css.empty}>当前库还没有文档——粘贴文本或点右上角「上传文档」。</div>
            : <table className={css.dataTable}>
              <thead><tr><th>文件</th><th style={{ width: 64 }}>状态</th><th style={{ width: 52 }}>切块</th><th style={{ width: 56 }}>操作</th></tr></thead>
              <tbody>
                {docs.map((doc) => (
                  <tr key={doc.id}>
                    <td style={{ wordBreak: 'break-all' }}>{doc.fileName}</td>
                    <td>{doc.status === 'ready' ? '✅' : doc.status}</td>
                    <td>{doc.chunkCount}</td>
                    <td><button type="button" className={css.ghostButton} disabled={busy} onClick={() => deleteDoc(doc.id)}>删除</button></td>
                  </tr>
                ))}
              </tbody>
            </table>}
        </div>

        <div style={card}>
          <p style={cardTitle}>检索测试台（hybrid：中文全文 + 向量）</p>
          <div style={row}>
            <input
              className={css.input}
              style={{ flex: 1, minWidth: 200 }}
              value={query}
              placeholder="输入问题，如：暂存实例怎么启动？"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') doSearch() }}
            />
            <label style={{ fontSize: 12, opacity: 0.8 }}>Top-K <input className={css.input} style={{ width: 56, display: 'inline-block' }} type="number" min={1} max={50} value={topK} onChange={(e) => setTopK(Number(e.target.value) || 8)} /></label>
            <label style={{ fontSize: 12, opacity: 0.8, display: 'flex', alignItems: 'center', gap: 6 }}>向量 {vectorWeight.toFixed(2)}<input type="range" min={0} max={1} step={0.05} value={vectorWeight} style={{ width: 110 }} onChange={(e) => setVectorWeight(Number(e.target.value))} /></label>
            <button type="button" className={css.ghostButton} disabled={busy || searching} onClick={doSearch}>{searching ? '检索中…' : '检索'}</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {hits.length === 0
              ? <div className={css.empty}>暂无检索结果——入库后在这里验证召回与排序。</div>
              : hits.map((hit) => (
                <div key={hit.chunkId} style={{ padding: '6px 8px', borderRadius: 6, background: 'rgba(128,128,128,0.09)' }}>
                  <div style={{ fontSize: 11, opacity: 0.72, marginBottom: 2 }}>
                    「{hit.fileName}」{hit.headingPath !== '' ? ' · ' + hit.headingPath : ''}
                    <span className={css.badge} style={{ marginLeft: 8 }}>{hit.score.toFixed(3)}</span>
                  </div>
                  <div style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{hit.text.length > 360 ? hit.text.slice(0, 360) + '…' : hit.text}</div>
                </div>
              ))}
          </div>
        </div>
      </div>

      {settings !== null && <SettingsRow settings={settings} busy={busy} onChange={setSettings} onSave={saveSettings} />}
    </div>
  )
}
/** 设置行（子组件：props 类型保证非空，避免闭包窄化失效）。 */
function SettingsRow(props: { settings: RagSettings; busy: boolean; onChange: (next: RagSettings) => void; onSave: () => void }): JSX.Element {
  const { settings, busy, onChange, onSave } = props
  return (
    <div style={card}>
      <div style={row}>
        <span className={css.badge}>向量：{settings.embedding.provider} / {settings.embedding.model}</span>
        <span className={css.badge}>重排：{settings.rerank.mode}</span>
        <label style={{ fontSize: 12, opacity: 0.85 }}>块大小
          <input className={css.input} style={{ width: 72, marginLeft: 6 }} type="number" value={settings.chunk.maxSize} onChange={(e) => onChange({ ...settings, chunk: { ...settings.chunk, maxSize: Number(e.target.value) || 512 } })} />
        </label>
        <label style={{ fontSize: 12, opacity: 0.85 }}>重叠
          <input className={css.input} style={{ width: 64, marginLeft: 6 }} type="number" value={settings.chunk.overlap} onChange={(e) => onChange({ ...settings, chunk: { ...settings.chunk, overlap: Number(e.target.value) || 64 } })} />
        </label>
        <label style={{ fontSize: 12, opacity: 0.85 }}>默认 Top-K
          <input className={css.input} style={{ width: 60, marginLeft: 6 }} type="number" value={settings.search.topK} onChange={(e) => onChange({ ...settings, search: { ...settings.search, topK: Number(e.target.value) || 8 } })} />
        </label>
        <label style={{ fontSize: 12, opacity: 0.85 }}>阈值(0=不过滤)
          <input className={css.input} style={{ width: 64, marginLeft: 6 }} type="number" step="0.05" value={settings.search.threshold} onChange={(e) => onChange({ ...settings, search: { ...settings.search, threshold: Number(e.target.value) || 0 } })} />
        </label>
        <div style={{ flex: 1 }} />
        <button type="button" className={css.ghostButton} disabled={busy} onClick={onSave}>保存设置</button>
      </div>
    </div>
  )
}
