/**
 * 记忆中枢页签 —— RAG 知识库管理、文档入库、检索测试台与设置。
 * 布局：统一 workspace 滚动根（在 DevforgePanel 的 overflow:hidden 内容区内自行滚动）
 * → 顶部库管理表面 → workbenchGrid 双栏（左文档入库 / 右检索台，≤960px 自动降为单列）
 * → 底部设置表面。样式全部复用 panel.module.css 语义类（深浅色自动适配），
 * 不引入本地布局样式；信息密度优先且守住块间距底线（辉哥排版偏好）。
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

/** 横幅语义色类型：对应 banner[data-kind] 的三种状态样式，无匹配时省略属性用中性样式。 */
type BannerKind = 'success' | 'warning' | 'error'

/** 按消息首位的 emoji 前缀映射横幅语义色（✅成功 / ⚠警告 / ❌错误 / 其余中性），纯展示映射不改文案。 */
function bannerKind(message: string): BannerKind | undefined {
  if (message.startsWith('✅')) return 'success'
  if (message.startsWith('⚠')) return 'warning'
  if (message.startsWith('❌')) return 'error'
  return undefined
}

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
    // 切换守卫：向量渠道/模型变化时由宿主返回受影响切块数，确认后立即全库重嵌
    const data = await api<{ embeddingChanged?: boolean; chunkCount?: number }>(RAG_API.settings, { method: 'PUT', body: JSON.stringify(settings) })
    if (data.embeddingChanged === true && (data.chunkCount ?? 0) > 0) {
      const ok = window.confirm('向量模型已变更：' + data.chunkCount + ' 个切块需重嵌后才能向量检索（期间相关库降级纯关键词）。立即重嵌？')
      if (!ok) { setMessage('⚠️ 已保存设置但未重嵌——检索将降级关键词，可稍后点「重嵌全部」'); return }
      const report = await api<{ reports: Array<{ chunks: number; embedded: number; cached: number; errors: string[] }> }>(RAG_API.reembed, { method: 'POST', body: JSON.stringify({}) })
      const total = report.reports.reduce((sum, item) => sum + item.chunks, 0)
      const failed = report.reports.reduce((sum, item) => sum + item.errors.length, 0)
      setMessage(failed > 0 ? '⚠️ 重嵌完成但有失败：共 ' + total + ' 块，' + failed + ' 个文档失败（详见宿主日志）' : '✅ 重嵌完成：共 ' + total + ' 块已切换到新向量模型')
    } else {
      setMessage('✅ 设置已保存')
    }
  })

  /** 手动全库重嵌（未重嵌就关掉确认框的补救入口）。 */
  const reembedAll = () => run(async () => {
    const report = await api<{ reports: Array<{ chunks: number; embedded: number; cached: number; errors: string[] }> }>(RAG_API.reembed, { method: 'POST', body: JSON.stringify({}) })
    const total = report.reports.reduce((sum, item) => sum + item.chunks, 0)
    const failed = report.reports.reduce((sum, item) => sum + item.errors.length, 0)
    if (total === 0) { setMessage('没有需要重嵌的文档'); return }
    setMessage(failed > 0 ? '⚠️ 重嵌完成但有失败：共 ' + total + ' 块，' + failed + ' 个文档失败' : '✅ 重嵌完成：共 ' + total + ' 块已对齐当前向量模型')
  })

  return (
    <section className={css.workspace}>
      {message !== '' && <div className={css.banner} data-kind={bannerKind(message)}>{message}</div>}

      {/* 顶部库管理表面：库选择/新建/删除 + 统计徽标 + 上传入口，一行工具栏随宽度自动换行 */}
      <section className={css.surface}>
        <div className={css.formRow}>
          <label className={[css.field, css.fieldCompact].join(' ')}>
            <span className={css.fieldLabel}>知识库（{kbs.length}）</span>
            <select className={css.input} value={kbId} onChange={(e) => setKbId(e.target.value)}>
              {kbs.length === 0 && <option value="">（先创建一个库）</option>}
              {kbs.map((kb) => <option key={kb.id} value={kb.id}>{kb.name}</option>)}
            </select>
          </label>
          <label className={[css.field, css.fieldCompact].join(' ')}>
            <span className={css.fieldLabel}>新建库</span>
            <input className={css.input} value={newKbName} placeholder="库名" onChange={(e) => setNewKbName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') createKb() }} />
          </label>
          <button type="button" className={css.ghostButton} disabled={busy} onClick={createKb}>创建</button>
          <button type="button" className={css.dangerButton} disabled={busy || kbId === ''} onClick={deleteKb}>删除库</button>
          <span className={css.toolbarSpacer} />
          <span className={css.badge}>{docs.length} 文档 · {totalChunks} 切块</span>
          {/* 上传入口：视觉上是幽灵按钮，内嵌仅屏幕阅读器可见的文件输入触发选档 */}
          <label className={css.ghostButton}>
            上传文档
            <input type="file" className={css.srOnly} onChange={uploadFile} accept=".md,.txt,.csv,.json,.yaml,.yml,.log,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.sh,.css,.html,.pdf,.docx" />
          </label>
        </div>
      </section>

      {/* 主体双栏：workbenchGrid 左入库右检索，≤960px 自动降为单列 */}
      <div className={css.workbenchGrid}>
        <section className={css.surface}>
          <h3 className={css.surfaceTitle}>文档入库</h3>
          <div className={css.formRow}>
            <input className={[css.input, css.fieldGrow].join(' ')} value={pasteName} placeholder="文件名（如 部署文档.md）" onChange={(e) => setPasteName(e.target.value)} />
            <button type="button" className={css.ghostButton} disabled={busy} onClick={ingestText}>入库并嵌入</button>
          </div>
          <textarea
            className={[css.input, css.textarea].join(' ')}
            value={pasteText}
            placeholder="粘贴 Markdown / 文本内容…（自动标题感知切块 → 智谱向量化）"
            onChange={(e) => setPasteText(e.target.value)}
          />
          {docs.length === 0
            ? <div className={css.empty}>当前库还没有文档——粘贴文本或点右上角「上传文档」。</div>
            : <div className={css.tableScroll}>
              <table className={css.dataTable}>
                <thead><tr><th>文件</th><th>状态</th><th>切块</th><th>操作</th></tr></thead>
                <tbody>
                  {docs.map((doc) => (
                    <tr key={doc.id}>
                      <td className={css.monoText}>{doc.fileName}</td>
                      <td>{doc.status === 'ready' ? '✅' : doc.status}</td>
                      <td>{doc.chunkCount}</td>
                      <td><button type="button" className={css.ghostButton} disabled={busy} onClick={() => deleteDoc(doc.id)}>删除</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
        </section>

        <section className={css.surface}>
          <h3 className={css.surfaceTitle}>检索测试台（hybrid：中文全文 + 向量）</h3>
          <div className={css.formRow}>
            <input
              className={[css.input, css.fieldGrow].join(' ')}
              value={query}
              placeholder="输入问题，如：暂存实例怎么启动？"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') doSearch() }}
            />
            <label className={css.field}>
              <span className={css.fieldLabel}>Top-K</span>
              {/* 数字输入用裸 compactNumber：.input 的 width:100% 在 CSS 中定义在后会覆盖 compactNumber 的定宽 */}
              <input className={css.compactNumber} type="number" min={1} max={50} value={topK} onChange={(e) => setTopK(Number(e.target.value) || 8)} />
            </label>
            <label className={[css.field, css.fieldCompact].join(' ')}>
              <span className={css.fieldLabel}>向量 {vectorWeight.toFixed(2)}</span>
              {/* range 走浏览器原生外观（panel 全局规则刻意排除 range），随字段宽度拉伸 */}
              <input type="range" min={0} max={1} step={0.05} value={vectorWeight} onChange={(e) => setVectorWeight(Number(e.target.value))} />
            </label>
            <button type="button" className={css.ghostButton} disabled={busy || searching} onClick={doSearch}>{searching ? '检索中…' : '检索'}</button>
          </div>
          <div className={css.resultStack}>
            {hits.length === 0
              ? <div className={css.empty}>暂无检索结果——入库后在这里验证召回与排序。</div>
              : hits.map((hit) => (
                <div key={hit.chunkId} className={css.resultItem}>
                  <div className={css.resultMeta}>
                    「{hit.fileName}」{hit.headingPath !== '' ? ' · ' + hit.headingPath : ''}
                    <span className={css.badge}>{hit.score.toFixed(3)}</span>
                  </div>
                  <div className={css.resultText}>{hit.text.length > 360 ? hit.text.slice(0, 360) + '…' : hit.text}</div>
                </div>
              ))}
          </div>
        </section>
      </div>

      {settings !== null && <SettingsRow settings={settings} busy={busy} onChange={setSettings} onSave={saveSettings} onReembed={reembedAll} />}
    </section>
  )
}
/** 渠道中文标签与各渠道默认向量模型提示。 */
const PROVIDER_LABEL: Record<string, string> = { zhipu: '智谱', ark: '火山方舟', 'openai-gateway': 'OpenAI 中转', ollama: '本地 Ollama', custom: '自定义(OpenAI兼容)', siliconflow: '硅基流动' }
const PROVIDER_MODEL_HINT: Record<string, string> = { zhipu: 'embedding-3', ark: 'doubao-embedding', 'openai-gateway': 'text-embedding-3-small', ollama: 'bge-m3', custom: 'BAAI/bge-m3', siliconflow: 'BAAI/bge-m3' }

/** 设置行（子组件：props 类型保证非空，避免闭包窄化失效）。向量渠道/模型可配，重嵌守卫由宿主保存响应驱动。 */
function SettingsRow(props: { settings: RagSettings; busy: boolean; onChange: (next: RagSettings) => void; onSave: (next: RagSettings) => void; onReembed: () => void }): JSX.Element {
  const { settings, busy, onChange } = props
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState('')

  const save = (): void => {
    // 维度守卫在宿主：保存响应返回 embeddingChanged + 受影响切块数，由 saveSettings 弹确认并重嵌
    props.onSave(settings)
  }

  const testConnection = async (): Promise<void> => {
    setTesting(true)
    setTestResult('')
    try {
      const data = await api<{ dim: number }>(RAG_API.settingsTest, { method: 'POST', body: JSON.stringify({ provider: settings.embedding.provider, model: settings.embedding.model }) })
      setTestResult('✅ 连接正常，向量维度 ' + data.dim)
    } catch (error) {
      setTestResult('❌ ' + (error instanceof Error ? error.message : String(error)))
    } finally {
      setTesting(false)
    }
  }

  return (
    <section className={css.surface}>
      <div className={css.formRow}>
        <label className={[css.field, css.fieldCompact].join(' ')}>
          <span className={css.fieldLabel}>向量渠道</span>
          <select className={css.input} value={settings.embedding.provider} onChange={(e) => {
            const provider = e.target.value as RagSettings['embedding']['provider']
            onChange({ ...settings, embedding: { provider, model: PROVIDER_MODEL_HINT[provider] ?? settings.embedding.model } })
          }}>
            {Object.entries(PROVIDER_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        {settings.embedding.provider === 'custom' && (
          <label className={[css.field, css.fieldGrow].join(' ')}>
            <span className={css.fieldLabel}>服务地址（到 /v1）</span>
            <input className={css.input} value={settings.embedding.baseURL ?? ''} placeholder="https://api.siliconflow.cn/v1" onChange={(e) => onChange({ ...settings, embedding: { ...settings.embedding, baseURL: e.target.value } })} />
          </label>
        )}
        {settings.embedding.provider === 'custom' && (
          <label className={[css.field, css.fieldGrow].join(' ')}>
            <span className={css.fieldLabel}>凭据引用名</span>
            <input className={css.input} value={settings.embedding.apiKeyEnv ?? ''} placeholder="RAG_CUSTOM_EMBEDDING_API_KEY" onChange={(e) => onChange({ ...settings, embedding: { ...settings.embedding, apiKeyEnv: e.target.value } })} />
          </label>
        )}
        <label className={[css.field, css.fieldCompact].join(' ')}>
          <span className={css.fieldLabel}>向量模型</span>
          <input className={css.input} value={settings.embedding.model} placeholder={PROVIDER_MODEL_HINT[settings.embedding.provider] ?? '模型名'} onChange={(e) => onChange({ ...settings, embedding: { ...settings.embedding, model: e.target.value } })} />
        </label>
        <button type="button" className={css.ghostButton} disabled={busy || testing} onClick={testConnection}>{testing ? '测试中…' : '测试连接'}</button>
        <button type="button" className={css.ghostButton} disabled={busy} onClick={props.onReembed}>重嵌全部</button>
        <label className={[css.field, css.fieldCompact].join(' ')}>
          <span className={css.fieldLabel}>重排</span>
          <select className={css.input} value={settings.rerank.mode} onChange={(e) => onChange({ ...settings, rerank: { ...settings.rerank, mode: e.target.value as RagSettings['rerank']['mode'] } })}>
            <option value="zhipu">智谱 rerank</option>
            <option value="llm">LLM 兜底</option>
            <option value="off">关闭</option>
          </select>
        </label>
        {/* 四个数字参数：fieldLabel 上置 + compactNumber 定宽输入，随 formRow 换行不再溢出 */}
        <label className={css.field}>
          <span className={css.fieldLabel}>块大小</span>
          <input className={css.compactNumber} type="number" value={settings.chunk.maxSize} onChange={(e) => onChange({ ...settings, chunk: { ...settings.chunk, maxSize: Number(e.target.value) || 512 } })} />
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>重叠</span>
          <input className={css.compactNumber} type="number" value={settings.chunk.overlap} onChange={(e) => onChange({ ...settings, chunk: { ...settings.chunk, overlap: Number(e.target.value) || 64 } })} />
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>默认 Top-K</span>
          <input className={css.compactNumber} type="number" value={settings.search.topK} onChange={(e) => onChange({ ...settings, search: { ...settings.search, topK: Number(e.target.value) || 8 } })} />
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>阈值(0=不过滤)</span>
          <input className={css.compactNumber} type="number" step="0.05" value={settings.search.threshold} onChange={(e) => onChange({ ...settings, search: { ...settings.search, threshold: Number(e.target.value) || 0 } })} />
        </label>
        <span className={css.toolbarSpacer} />
        <button type="button" className={css.ghostButton} disabled={busy} onClick={save}>保存设置</button>
      </div>
      {testResult !== '' && <div className={css.subtleText}>{testResult}</div>}
    </section>
  )
}
