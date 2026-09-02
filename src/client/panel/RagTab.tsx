/**
 * 记忆中枢页签 —— RAG 知识库管理、文档入库、检索测试台与设置。
 * 数据通道：直连 RAG_API（loopback 同源 fetch）；样式内联（紧凑密度，
 * 边框/背景用中性半透明色自动适配浅色/深色主题，M2 走前端美化规范精调）。
 */
import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import { RAG_API, type RagDocument, type RagKnowledgeBase, type RagSearchHit, type RagSettings } from '../../rag/protocol.ts'

/** 同源 API（错误消息直接展示）。 */
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json' } })
  const body = (await response.json()) as { ok?: boolean; error?: string }
  if (!response.ok || body?.ok === false) throw new Error(body?.error ?? ('HTTP ' + response.status))
  return body as T
}

interface TextChunkLike { seq: number; headingPath: string; text: string; startLine: number; endLine: number }

const card: React.CSSProperties = {
  border: '1px solid rgba(128,128,128,0.35)',
  borderRadius: 8,
  padding: '10px 12px',
  marginBottom: 10,
}
const label: React.CSSProperties = { fontSize: 12, opacity: 0.75, marginBottom: 4, display: 'block' }
const input: React.CSSProperties = {
  fontSize: 13, padding: '5px 8px', borderRadius: 6,
  border: '1px solid rgba(128,128,128,0.45)',
  background: 'rgba(128,128,128,0.08)', color: 'inherit', width: '100%', boxSizing: 'border-box',
}
const button: React.CSSProperties = {
  fontSize: 12, padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
  border: '1px solid rgba(128,128,128,0.5)', background: 'rgba(128,128,128,0.12)', color: 'inherit',
}
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12 }
const th: React.CSSProperties = { textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid rgba(128,128,128,0.35)', opacity: 0.75 }
const td: React.CSSProperties = { padding: '4px 8px', borderBottom: '1px solid rgba(128,128,128,0.18)', verticalAlign: 'top' }

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
      // PDF/DOCX 等二进制：base64 上行，服务端临时文件解析
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
    <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {message !== '' && <div style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, background: 'rgba(128,128,128,0.12)' }}>{message}</div>}

      <div style={card}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '0 0 220px' }}>
            <span style={label}>知识库（{kbs.length}）</span>
            <select style={input} value={kbId} onChange={(e) => setKbId(e.target.value)}>
              {kbs.length === 0 && <option value="">（先创建一个库）</option>}
              {kbs.map((kb) => <option key={kb.id} value={kb.id}>{kb.name}</option>)}
            </select>
          </div>
          <div style={{ flex: '0 0 160px' }}>
            <span style={label}>新建库</span>
            <input style={input} value={newKbName} placeholder="库名" onChange={(e) => setNewKbName(e.target.value)} />
          </div>
          <button type="button" style={button} disabled={busy} onClick={createKb}>创建</button>
          <button type="button" style={button} disabled={busy || kbId === ''} onClick={deleteKb}>删除当前库</button>
          <div style={{ flex: 1 }} />
          <label style={{ ...button, display: 'inline-block' }}>
            上传文档
            <input type="file" style={{ display: 'none' }} onChange={uploadFile} accept=".md,.txt,.csv,.json,.yaml,.yml,.log,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.sh,.css,.html,.pdf,.docx" />
          </label>
        </div>
      </div>

      <div style={card}>
        <span style={label}>粘贴文本入库（{docs.length} 份文档）</span>
        <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <input style={{ ...input, flex: '0 0 220px' }} value={pasteName} placeholder="文件名（如 部署文档.md）" onChange={(e) => setPasteName(e.target.value)} />
          <button type="button" style={button} disabled={busy} onClick={ingestText}>入库并嵌入</button>
        </div>
        <textarea style={{ ...input, minHeight: 72, resize: 'vertical' }} value={pasteText} placeholder="粘贴 Markdown / 文本内容…" onChange={(e) => setPasteText(e.target.value)} />
        {docs.length > 0 && (
          <table style={table}>
            <thead><tr><th style={th}>文件</th><th style={th}>状态</th><th style={th}>切块</th><th style={th}>操作</th></tr></thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.id}>
                  <td style={td}>{doc.fileName}</td>
                  <td style={td}>{doc.status === 'ready' ? '✅ 就绪' : doc.status}</td>
                  <td style={td}>{doc.chunkCount}</td>
                  <td style={td}><button type="button" style={button} disabled={busy} onClick={() => deleteDoc(doc.id)}>删除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={card}>
        <span style={label}>检索测试台（hybrid：中文全文 + 向量混合）</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <input style={input} value={query} placeholder="输入问题，如：暂存实例怎么启动？" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') doSearch() }} />
          </div>
          <div style={{ flex: '0 0 90px' }}>
            <span style={label}>Top-K：{topK}</span>
            <input style={input} type="number" min={1} max={50} value={topK} onChange={(e) => setTopK(Number(e.target.value) || 8)} />
          </div>
          <div style={{ flex: '0 0 170px' }}>
            <span style={label}>向量权重：{vectorWeight.toFixed(2)}</span>
            <input style={{ width: '100%' }} type="range" min={0} max={1} step={0.05} value={vectorWeight} onChange={(e) => setVectorWeight(Number(e.target.value))} />
          </div>
          <button type="button" style={button} disabled={busy || searching} onClick={doSearch}>{searching ? '检索中…' : '检索'}</button>
        </div>
        {hits.map((hit) => (
          <div key={hit.chunkId} style={{ marginTop: 8, padding: '6px 8px', borderRadius: 6, background: 'rgba(128,128,128,0.08)' }}>
            <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 2 }}>「{hit.fileName}」{hit.headingPath !== '' ? ' · ' + hit.headingPath : ''} · 相关度 {hit.score.toFixed(3)}</div>
            <div style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{hit.text.length > 400 ? hit.text.slice(0, 400) + '…' : hit.text}</div>
          </div>
        ))}
      </div>

      {settings !== null && (
        <div style={card}>
          <span style={label}>RAG 设置（当前向量：{settings.embedding.provider} / {settings.embedding.model}；rerank：{settings.rerank.mode}）</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '0 0 130px' }}>
              <span style={label}>块大小</span>
              <input style={input} type="number" value={settings.chunk.maxSize} onChange={(e) => setSettings({ ...settings, chunk: { ...settings.chunk, maxSize: Number(e.target.value) || 512 } })} />
            </div>
            <div style={{ flex: '0 0 130px' }}>
              <span style={label}>重叠</span>
              <input style={input} type="number" value={settings.chunk.overlap} onChange={(e) => setSettings({ ...settings, chunk: { ...settings.chunk, overlap: Number(e.target.value) || 64 } })} />
            </div>
            <div style={{ flex: '0 0 130px' }}>
              <span style={label}>默认 Top-K</span>
              <input style={input} type="number" value={settings.search.topK} onChange={(e) => setSettings({ ...settings, search: { ...settings.search, topK: Number(e.target.value) || 8 } })} />
            </div>
            <div style={{ flex: '0 0 130px' }}>
              <span style={label}>相似度阈值（0=不过滤）</span>
              <input style={input} type="number" step="0.05" value={settings.search.threshold} onChange={(e) => setSettings({ ...settings, search: { ...settings.search, threshold: Number(e.target.value) || 0 } })} />
            </div>
            <button type="button" style={button} disabled={busy} onClick={saveSettings}>保存设置</button>
          </div>
        </div>
      )}
    </div>
  )
}