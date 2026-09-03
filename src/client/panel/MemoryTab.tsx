/** 记忆工作台：状态、自动化设置、记忆条目，以及未来迁移/搜索入口。 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import { type MemorySettings, type MemoryStatus, type MirrorSyncResult, type NativeMemoryEntry, type ProjectIndexResult } from '../../memory/protocol.ts'
import type { RagDocument } from '../../rag/protocol.ts'
import css from './panel.module.css'

type Notice = { kind: 'success' | 'error'; text: string }

function memoryTitle(doc: RagDocument): string {
  return doc.fileName.replace(/^mem-/, '').replace(/\.md$/, '')
}

function mirrorLabel(status: MemoryStatus | null): string {
  if (status === null) return '读取中'
  const mnemon = status.mirror.mnemonRootExists ? 'Mnemon 可用' : 'Mnemon 未发现'
  const hindsight = status.mirror.hindsightConfigured ? 'Hindsight ' + status.mirror.hindsightServerMode : 'Hindsight 未配置'
  return mnemon + ' · ' + hindsight
}

/** 记忆工作台页签。所有数据请求统一通过 DevforgeApi。 */
export function MemoryTab({ api }: { api: DevforgeApi }): JSX.Element {
  const [status, setStatus] = useState<MemoryStatus | null>(null)
  const [settings, setSettings] = useState<MemorySettings | null>(null)
  const [docs, setDocs] = useState<RagDocument[]>([])
  const [projectPath, setProjectPath] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<NativeMemoryEntry[]>([])
  const [searching, setSearching] = useState(false)
  const [draftContent, setDraftContent] = useState('')
  const [migrationStatus, setMigrationStatus] = useState<{ count: number; migrated: number; lastUpdatedAt: number } | null>(null)
  const [report, setReport] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<Notice | null>(null)
  const mounted = useRef(true)

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [nextStatus, nextSettings] = await Promise.all([api.getMemoryStatus(), api.getMemorySettings()])
      const nextDocs = nextStatus.memoryKbId === '' ? [] : await api.listMemories()
      if (!mounted.current) return
      setStatus(nextStatus)
      setSettings(nextSettings)
      setDocs(nextDocs)
      setNotice(null)
    } catch (error) {
      if (mounted.current) setNotice({ kind: 'error', text: '加载记忆工作台失败：' + (error instanceof Error ? error.message : String(error)) })
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [api])

  useEffect(() => {
    mounted.current = true
    void reload()
    return () => { mounted.current = false }
  }, [reload])

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setNotice(null)
    try { await action() }
    catch (error) { if (mounted.current) setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) }) }
    finally { if (mounted.current) setBusy(false) }
  }

  const saveSettings = (): Promise<void> => run(async () => {
    if (settings === null) return
    const saved = await api.saveMemorySettings(settings)
    if (!mounted.current) return
    setSettings(saved)
    setNotice({ kind: 'success', text: '记忆设置已保存，立即生效。' })
  })

  const deleteMemory = (id: string): Promise<void> => run(async () => {
    await api.deleteMemory(id)
    await reload()
    if (mounted.current) setNotice({ kind: 'success', text: '记忆条目已删除。' })
  })

  const indexProject = (): Promise<void> => run(async () => {
    const path = projectPath.trim()
    if (path === '') throw new Error('项目路径必填，请填写本机绝对路径。')
    const result: ProjectIndexResult = await api.indexMemoryProject(path)
    setReport('项目索引 · 扫描 ' + result.scanned + ' · 新增 ' + result.added + ' · 更新 ' + result.updated + ' · 删除 ' + result.removed + ' · 跳过 ' + result.skipped + (result.errors.length > 0 ? ' · 错误 ' + result.errors.length : ''))
    await reload()
    if (mounted.current) setNotice({ kind: 'success', text: '项目索引完成。' })
  })

  /** 关键词搜索内置长期记忆（空关键词提示先输入）。 */
  const runSearch = (): Promise<void> => run(async () => {
    const query = searchQuery.trim()
    if (query === '') throw new Error('请输入搜索关键词。')
    setSearching(true)
    try {
      const entries = await api.searchNativeMemories(query)
      if (mounted.current) { setSearchResults(entries); setNotice({ kind: 'success', text: '搜索完成，命中 ' + entries.length + ' 条。' }) }
    } finally { if (mounted.current) setSearching(false) }
  })

  /** 手动补录一条长期记忆并清空输入。 */
  const saveNative = (): Promise<void> => run(async () => {
    const content = draftContent.trim()
    if (content === '') throw new Error('内容不能为空。')
    await api.saveNativeMemory({ content, category: 'general', source: 'manual' })
    if (mounted.current) setDraftContent('')
    await reload()
    if (mounted.current) setNotice({ kind: 'success', text: '长期记忆已保存。' })
  })

  /** 删除一条内置长期记忆并刷新搜索结果。 */
  const removeNative = (id: string): Promise<void> => run(async () => {
    await api.deleteNativeMemory(id)
    setSearchResults((current) => current.filter((entry) => entry.id !== id))
    if (mounted.current) setNotice({ kind: 'success', text: '内置记忆已删除。' })
  })

  /** 一键迁移外部记忆到内置主存储（幂等），完成后刷新迁移状态。 */
  const migrateExternal = (kind: 'mnemon' | 'hindsight'): Promise<void> => run(async () => {
    const result = await api.migrateExternalMemory(kind)
    const status = await api.getMemoryMigrationStatus()
    if (mounted.current) {
      setMigrationStatus(status)
      setReport((kind === 'mnemon' ? 'Mnemon' : 'Hindsight') + ' 迁移：扫描 ' + result.scanned + ' · 新增 ' + result.added + ' · 更新 ' + result.updated + ' · 跳过 ' + result.skipped)
      setNotice({ kind: 'success', text: (kind === 'mnemon' ? 'Mnemon' : 'Hindsight') + ' 迁移完成：新增 ' + result.added + '，更新 ' + result.updated + '。' })
    }
  })

  const syncMirror = (kind: 'mnemon' | 'hindsight'): Promise<void> => run(async () => {
    const result: MirrorSyncResult = await api.syncMemoryMirror(kind)
    setReport((kind === 'mnemon' ? 'Mnemon' : 'Hindsight') + ' 镜像 · 扫描 ' + result.scanned + ' · 新增 ' + result.added + ' · 更新 ' + result.updated + ' · 跳过 ' + result.skipped + (result.errors.length > 0 ? ' · 错误 ' + result.errors.length : ''))
    await reload()
    if (mounted.current) setNotice({ kind: 'success', text: (kind === 'mnemon' ? 'Mnemon' : 'Hindsight') + ' 镜像同步完成。' })
  })

  const updateSettings = (patch: Partial<MemorySettings>): void => {
    if (settings !== null) setSettings({ ...settings, ...patch })
  }
  const recentDocs = docs.slice().reverse().slice(0, 30)
  const sourceReady = status?.memoryKbId !== '' && status?.memoryKbId !== undefined

  return (
    <section className={css['memoryWorkspace']}>
      <header className={css['memoryHeader']}>
        <div><h2 className={css['workspaceTitle']}>记忆工作台</h2><p className={css['sectionHint']}>会话记忆、项目知识与外部镜像统一管理；未来可在这里迁移、搜索和治理内置记忆。</p></div>
        <button type="button" className={css['ghostButton']} disabled={busy || loading} onClick={() => { void reload() }}>{loading ? '读取中…' : '刷新状态'}</button>
      </header>

      {notice !== null && <div className={css['banner']} data-kind={notice.kind}>{notice.text}<button type="button" className={css['ghostButton']} onClick={() => setNotice(null)}>关闭</button></div>}

      <div className={css['memoryStats']}>
        <div className={css['memoryStat']}><span>记忆条目</span><strong>{status?.memoryCount ?? '—'}</strong><small>内置会话记忆库</small></div>
        <div className={css['memoryStat']}><span>自动沉淀</span><strong>{status?.sedimentCount ?? '—'}</strong><small>{settings?.autoSediment ? '已开启' : '已关闭'}</small></div>
        <div className={css['memoryStat']}><span>主动注入</span><strong>{status?.injectCount ?? '—'}</strong><small>{settings?.autoInject ? '已开启' : '已关闭'}</small></div>
        <div className={css['memoryStat']}><span>数据源</span><strong>{sourceReady ? '已就绪' : '待初始化'}</strong><small>{mirrorLabel(status)}</small></div>
      </div>

      <div className={css['memoryGrid']}>
        <section className={css['memoryPanel']}>
          <div className={css['panelHeading']}><div><h3 className={css['sectionTitle']}>自动记忆策略</h3><p className={css['sectionHint']}>控制会话结束后的提炼，以及每轮开始时的相关记忆注入。</p></div><span className={css['badge']} data-kind={settings?.enabled ? 'success' : 'pending'}>{settings?.enabled ? '运行中' : '已停用'}</span></div>
          {settings === null ? <div className={css['empty']} data-loading="">正在读取设置…</div> : <div className={css['memoryForm']}>
            <label className={css['toggleRow']}><input type="checkbox" checked={settings.enabled} onChange={(e) => updateSettings({ enabled: e.target.checked })}/><span><strong>启用记忆层</strong><small>关闭后不自动沉淀，也不主动注入。</small></span></label>
            <label className={css['toggleRow']}><input type="checkbox" checked={settings.autoSediment} onChange={(e) => updateSettings({ autoSediment: e.target.checked })}/><span><strong>自动沉淀</strong><small>会话结束后提炼值得长期保存的信息。</small></span></label>
            <label className={css['toggleRow']}><input type="checkbox" checked={settings.autoInject} onChange={(e) => updateSettings({ autoInject: e.target.checked })}/><span><strong>主动注入</strong><small>每轮首步召回与当前问题相关的记忆。</small></span></label>
            <div className={css['compactFields']}>
              <label className={css['compactField']}><span className={css['fieldLabel']}>注入条数</span><input className={css['input']} type="number" min={1} max={20} value={settings.topK} onChange={(e) => updateSettings({ topK: Number(e.target.value) || 4 })}/></label>
              <label className={css['compactField']}><span className={css['fieldLabel']}>相关度阈值</span><input className={css['input']} type="number" min={0} max={1} step={0.05} value={settings.threshold} onChange={(e) => updateSettings({ threshold: Number(e.target.value) || 0 })}/></label>
              <label className={css['compactField']}><span className={css['fieldLabel']}>注入字数上限</span><input className={css['input']} type="number" min={300} max={4000} step={100} value={settings.maxChars} onChange={(e) => updateSettings({ maxChars: Number(e.target.value) || 1200 })}/></label>
            </div>
            <div className={css['formFooter']}><span className={css['sectionHint']}>设置存入本地 store.db，不依赖外部记忆插件。</span><button type="button" className={css['primaryButton']} disabled={busy} onClick={() => { void saveSettings() }}>保存策略</button></div>
          </div>}
        </section>

        <section className={css['memoryPanel']}>
          <div className={css['panelHeading']}><div><h3 className={css['sectionTitle']}>内置记忆搜索与新增</h3><p className={css['sectionHint']}>关键词检索长期记忆主存储；也可以手动补录重要信息。</p></div><span className={css['badge']} data-kind="success">已上线</span></div>
          <div className={css['inlineForm']}><input className={css['input']} value={searchQuery} placeholder="关键词，如：硅基流动 / 偏好 / 决策" onChange={(e) => setSearchQuery(e.target.value)}/><button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void runSearch() }}>{searching ? '搜索中…' : '搜索'}</button></div>
          {searchResults.length > 0 && <div className={css['memoryTable']}>
            <div className={css['memoryTableHead']}><span>命中的长期记忆</span><span>来源</span><span>操作</span></div>
            {searchResults.map((entry) => <div key={entry.id} className={css['memoryTableRow']}><span className={css['memoryDocTitle']} title={entry.content}>{entry.content}</span><span>{entry.source}</span><button type="button" className={css['dangerButton']} disabled={busy} onClick={() => { void removeNative(entry.id) }}>删除</button></div>)}
          </div>}
          <div className={css['inlineForm']}><input className={css['input']} value={draftContent} placeholder="手动补录一条长期记忆…" onChange={(e) => setDraftContent(e.target.value)}/><button type="button" className={css['ghostButton']} disabled={busy || draftContent.trim() === ''} onClick={() => { void saveNative() }}>保存</button></div>
        </section>
      </div>

      <div className={css['memoryGrid']}>
        <section className={css['memoryPanel']}><div className={css['panelHeading']}><div><h3 className={css['sectionTitle']}>会话记忆条目</h3><p className={css['sectionHint']}>最近 30 条 · 自动沉淀内容可删除，不直接修改原始外部记忆。</p></div><span className={css['badge']}>{docs.length} 条</span></div>
          {recentDocs.length === 0 ? <div className={css['empty']}>暂无记忆条目。正常使用几轮会话后，值得长期保存的内容会出现在这里。</div> : <div className={css['memoryTable']}><div className={css['memoryTableHead']}><span>内容</span><span>切块</span><span>操作</span></div>{recentDocs.map((doc) => <div key={doc.id} className={css['memoryTableRow']}><span className={css['memoryDocTitle']} title={memoryTitle(doc)}>{memoryTitle(doc)}</span><span>{doc.chunkCount}</span><button type="button" className={css['dangerButton']} disabled={busy} onClick={() => { void deleteMemory(doc.id) }}>删除</button></div>)}</div>}
        </section>
        <div className={css['memoryStack']}>
          <section className={css['memoryPanel']}><div className={css['panelHeading']}><div><h3 className={css['sectionTitle']}>项目知识索引</h3><p className={css['sectionHint']}>尊重 .gitignore，增量更新到 RAG 知识库。</p></div></div><div className={css['inlineForm']}><input className={css['input']} value={projectPath} placeholder="/Users/andyfan/Documents/ds/项目" onChange={(e) => setProjectPath(e.target.value)}/><button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void indexProject() }}>开始索引</button></div></section>
          <section className={css['memoryPanel']}><div className={css['panelHeading']}><div><h3 className={css['sectionTitle']}>外部记忆迁移（幂等）</h3><p className={css['sectionHint']}>迁移进内置主存储：Mnemon 分条入库、Hindsight 整页入库；重复执行只更新不重复。</p></div>{migrationStatus !== null && <span className={css['badge']}>已迁移 {migrationStatus.migrated}/{migrationStatus.count}</span>}</div>
            <div className={css['inlineActions']}>
              <button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void migrateExternal('mnemon') }}>迁移 Mnemon 记忆</button>
              <button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void migrateExternal('hindsight') }}>迁移 Hindsight 知识</button>
            </div>
            <section className={css['memoryPanel']}><div className={css['panelHeading']}><div><h3 className={css['sectionTitle']}>外部只读镜像</h3><p className={css['sectionHint']}>当前仍保留只读同步，迁移完成前不删除外部数据。</p></div></div><div className={css['inlineActions']}><button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void syncMirror('mnemon') }}>同步 Mnemon</button><button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void syncMirror('hindsight') }}>同步 Hindsight</button></div></section>
            {report !== '' && <p className={css['operationReport']}>{report}</p>}
          </section>
        </div>
      </div>
    </section>
  )
}
