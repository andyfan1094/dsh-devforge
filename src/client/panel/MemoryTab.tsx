/**
 * 记忆工作台：状态、自动化设置、知识图谱、内置长期记忆主存储列表，以及迁移/搜索入口。
 * 数据职责：全部通过 DevforgeApi 访问同源路由；图谱与列表互联动（点节点看详情/点关键词过滤）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import { type MemoryGraph, type MemorySettings, type MemoryStatus, type MemoryUserProfile, type MirrorSyncResult, type NativeMemoryEntry, type ProjectIndexResult } from '../../memory/protocol.ts'
import type { RagDocument } from '../../rag/protocol.ts'
import css from './panel.module.css'
import { MemoryGraphView } from './MemoryGraphView.tsx'

type Notice = { kind: 'success' | 'error'; text: string }

/** 分类中文展示名（与后端 graph.ts 保持一致）。 */
const CATEGORY_LABELS: Record<string, string> = { preference: '偏好', decision: '决策', fact: '事实', insight: '洞察', context: '上下文', general: '通用' }

function memoryTitle(doc: RagDocument): string {
  return doc.fileName.replace(/^mem-/, '').replace(/\.md$/, '')
}

function mirrorLabel(status: MemoryStatus | null): string {
  if (status === null) return '读取中'
  const mnemon = status.mirror.mnemonRootExists ? 'Mnemon 可用' : 'Mnemon 未发现'
  const hindsight = status.mirror.hindsightConfigured ? 'Hindsight ' + status.mirror.hindsightServerMode : 'Hindsight 未配置'
  return mnemon + ' · ' + hindsight
}

/** 紧凑时间显示：MM-DD HH:mm（等宽数字，年跨度过大时前端提示略）。 */
function fmtTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '—'
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

/** 记忆工作台页签。所有数据请求统一通过 DevforgeApi。 */
export function MemoryTab({ api }: { api: DevforgeApi }): JSX.Element {
  const [status, setStatus] = useState<MemoryStatus | null>(null)
  const [settings, setSettings] = useState<MemorySettings | null>(null)
  const [docs, setDocs] = useState<RagDocument[]>([])
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [nativeEntries, setNativeEntries] = useState<NativeMemoryEntry[]>([])
  const [graph, setGraph] = useState<MemoryGraph | null>(null)
  const [activeTag, setActiveTag] = useState('')
  const [selectedEntryId, setSelectedEntryId] = useState('')
  const [projectPath, setProjectPath] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<NativeMemoryEntry[]>([])
  const [searching, setSearching] = useState(false)
  const [draftContent, setDraftContent] = useState('')
  const [migrationStatus, setMigrationStatus] = useState<{ count: number; migrated: number; lastUpdatedAt: number } | null>(null)
  const [report, setReport] = useState('')
  const [softError, setSoftError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [profile, setProfile] = useState<MemoryUserProfile | null>(null)
  const [habitsText, setHabitsText] = useState('')
  const mounted = useRef(true)

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [nextStatus, nextSettings] = await Promise.all([api.getMemoryStatus(), api.getMemorySettings()])
      const nextDocs = nextStatus.memoryKbId === '' ? [] : await api.listMemories()
      // 预览最近 30 条的首块内容：沉淀条目文件名是时间戳，必须给可读内容（单条失败回退文件名）
      const recentIds = nextDocs.slice().reverse().slice(0, 30)
      const previewMap: Record<string, string> = {}
      await Promise.all(recentIds.map(async (doc) => {
        try { previewMap[doc.id] = await api.previewMemoryDoc(doc.id) } catch { /* 回退展示文件名 */ }
      }))
      // 图谱与主存储列表是补充视图：单独失败不拖垮整页，错误以 softError 提示
      const settled = await Promise.allSettled([api.listNativeMemories(), api.getMemoryGraph(), api.getUserProfile()])
      if (!mounted.current) return
      setStatus(nextStatus)
      setSettings(nextSettings)
      setDocs(nextDocs)
      setPreviews(previewMap)
      setNativeEntries(settled[0].status === 'fulfilled' ? settled[0].value : [])
      setGraph(settled[1].status === 'fulfilled' ? settled[1].value : null)
      if (settled[2].status === 'fulfilled') {
        setProfile(settled[2].value)
        setHabitsText(settled[2].value.habits.join('\n'))
      }
      setSoftError(settled.filter((item) => item.status === 'rejected').map((item) => (item.reason instanceof Error ? item.reason.message : String(item.reason))).join('；'))
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

  /** 保存用户身份卡：常驻注入的 section 文本动态求值，保存即时生效无需重启。 */
  const saveProfile = (): Promise<void> => run(async () => {
    if (profile === null) return
    const habits = habitsText.split('\n').map((line) => line.trim()).filter((line) => line !== '')
    const saved = await api.saveUserProfile({ ...profile, habits })
    if (!mounted.current) return
    setProfile(saved)
    setHabitsText(saved.habits.join('\n'))
    setNotice({ kind: 'success', text: '用户身份卡已保存，常驻注入即时生效。' })
  })

  const deleteMemory = (id: string): Promise<void> => run(async () => {
    await api.deleteMemory(id)
    await reload()
    if (mounted.current) setNotice({ kind: 'success', text: '记忆条目已删除。' })
  })

  /** 删除内置长期记忆：清掉可能指向它的选中态后整体刷新（图谱/列表联动）。 */
  const removeNative = (id: string): Promise<void> => run(async () => {
    await api.deleteNativeMemory(id)
    setSearchResults((current) => current.filter((entry) => entry.id !== id))
    if (selectedEntryId === id) setSelectedEntryId('')
    await reload()
    if (mounted.current) setNotice({ kind: 'success', text: '内置记忆已删除。' })
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

  /** 一键迁移外部记忆到内置主存储（幂等），完成后刷新迁移状态。 */
  const migrateExternal = (kind: 'mnemon' | 'hindsight'): Promise<void> => run(async () => {
    const result = await api.migrateExternalMemory(kind)
    const status = await api.getMemoryMigrationStatus()
    if (mounted.current) {
      setMigrationStatus(status)
      setReport((kind === 'mnemon' ? 'Mnemon' : 'Hindsight') + ' 迁移：扫描 ' + result.scanned + ' · 新增 ' + result.added + ' · 更新 ' + result.updated + ' · 跳过 ' + result.skipped)
      setNotice({ kind: 'success', text: (kind === 'mnemon' ? 'Mnemon' : 'Hindsight') + ' 迁移完成：新增 ' + result.added + '，更新 ' + result.updated + '。' })
      await reload()
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
  const selectedEntry = selectedEntryId === '' ? undefined : nativeEntries.find((entry) => entry.id === selectedEntryId)

  // 图谱聚焦：优先选中条目，其次激活关键词；列表过滤直接复用图谱边（entry→term），不重复抽关键词
  const focusId = selectedEntryId !== '' ? 'entry:' + selectedEntryId : activeTag !== '' ? 'term:' + activeTag : ''
  const visibleNative = useMemo(() => {
    if (activeTag === '') return nativeEntries
    if (graph === null) return nativeEntries
    const ids = new Set<string>()
    for (const edge of graph.edges) {
      if (edge.target === 'term:' + activeTag && edge.source.startsWith('entry:')) ids.add(edge.source.slice('entry:'.length))
    }
    return nativeEntries.filter((entry) => ids.has(entry.id))
  }, [activeTag, graph, nativeEntries])

  const toggleTag = (tag: string): void => {
    setActiveTag((current) => (current === tag ? '' : tag))
  }

  return (
    <section className={css['memoryWorkspace']}>
      <header className={css['memoryHeader']}>
        <div><h2 className={css['workspaceTitle']}>记忆工作台</h2><p className={css['sectionHint']}>内置长期记忆主存储 + 会话沉淀库统一管理；图谱可视化、搜索、迁移与治理都在这里。</p></div>
        <button type="button" className={css['ghostButton']} disabled={busy || loading} onClick={() => { void reload() }}>{loading ? '读取中…' : '刷新状态'}</button>
      </header>

      {notice !== null && <div className={css['banner']} data-kind={notice.kind}>{notice.text}<button type="button" className={css['ghostButton']} onClick={() => setNotice(null)}>关闭</button></div>}

      <div className={css['memoryStats']}>
        <div className={css['memoryStat']}><span>会话沉淀库</span><strong>{status?.memoryCount ?? '—'}</strong><small>自动提炼 · RAG 全文可召回</small></div>
        <div className={css['memoryStat']}><span>内置长期记忆</span><strong>{nativeEntries.length || (status === null ? '—' : 0)}</strong><small>主存储 · 手动/迁移/沉淀</small></div>
        <div className={css['memoryStat']}><span>自动沉淀</span><strong>{status?.sedimentCount ?? '—'}</strong><small>{settings?.autoSediment ? '已开启' : '已关闭'}</small></div>
        <div className={css['memoryStat']}><span>主动注入</span><strong>{status?.injectCount ?? '—'} 次</strong><small>{settings?.autoInject ? '已开启' : '已关闭'} · {sourceReady ? '数据源就绪' : '待初始化'}</small></div>
      </div>

      <div className={css['memoryGrid']}>
        <section className={css['memoryPanel']}>
          <div className={css['panelHeading']}><div><h3 className={css['sectionTitle']}>知识图谱</h3><p className={css['sectionHint']}>由内置长期记忆现算：条目-关键词-分类关联；悬停高亮关联，点条目看详情，点关键词过滤下方列表。</p></div><span className={css['badge']}>{graph === null ? '—' : graph.nodes.length + ' 节点 · ' + graph.edges.length + ' 边'}</span></div>
          {softError !== '' && <p className={css['operationReport']}>图谱加载失败：{softError}</p>}
          <MemoryGraphView graph={graph} focusId={focusId} onSelectEntry={(id) => { setSelectedEntryId(id) }} onToggleTag={toggleTag} />
          <div className={css['graphLegend']}><span><i style={{ background: 'var(--dsw-alias-state-business-primary, #2563eb)' }} />记忆条目</span><span><i style={{ background: '#7c3aed' }} />关键词</span><span><i style={{ background: '#ea580c' }} />分类</span><span>半径 = 关联度</span></div>
          {selectedEntry !== undefined && <div className={css['graphDetail']}>
            <div className={css['memoryChips']}><span className={css['categoryBadge']}>{CATEGORY_LABELS[selectedEntry.category] ?? selectedEntry.category}</span>{selectedEntry.tags.map((tag) => <span key={tag} className={css['memoryChip']} onClick={() => toggleTag(tag)}>{tag}</span>)}</div>
            <div>{selectedEntry.content}</div>
            <div className={css['nativeRowMain']}><span className={css['nativeTime']}>{fmtTime(selectedEntry.updatedAt)} · {selectedEntry.source} · 重要度 {selectedEntry.importance}</span><span style={{ flex: 1 }} /><button type="button" className={css['dangerButton']} disabled={busy} onClick={() => { void removeNative(selectedEntry.id) }}>删除</button><button type="button" className={css['ghostButton']} onClick={() => setSelectedEntryId('')}>关闭</button></div>
          </div>}
        </section>

        <div className={css['memoryStack']}>
          <section className={css['memoryPanel']}>
            <div className={css['panelHeading']}><div><h3 className={css['sectionTitle']}>用户身份卡</h3><p className={css['sectionHint']}>常驻注入每轮对话（不靠召回，必达）；插件给别人用时，每人填自己的身份与习惯。</p></div><span className={css['badge']} data-kind={profile?.enabled === true && (profile.alias !== '' || profile.identity !== '' || habitsText.trim() !== '') ? 'success' : 'pending'}>{profile?.enabled === false ? '已停用' : '常驻注入'}</span></div>
            {profile === null ? <div className={css['empty']} data-loading="">正在读取身份卡…</div> : <div className={css['memoryForm']}>
              <label className={css['toggleRow']}><input type="checkbox" checked={profile.enabled} onChange={(e) => setProfile({ ...profile, enabled: e.target.checked })}/><span><strong>常驻注入</strong><small>每轮对话自动附带身份卡，截断到 {profile.maxChars} 字。</small></span></label>
              <label className={css['compactField']}><span className={css['fieldLabel']}>称呼</span><input className={css['input']} value={profile.alias} placeholder="如：辉哥" onChange={(e) => setProfile({ ...profile, alias: e.target.value })}/></label>
              <label className={css['compactField']}><span className={css['fieldLabel']}>身份简介</span><input className={css['input']} value={profile.identity} placeholder="是谁、在做什么（一句话）" onChange={(e) => setProfile({ ...profile, identity: e.target.value })}/></label>
              <label className={css['compactField']}><span className={css['fieldLabel']}>习惯与偏好（每行一条，最多 20 条）</span><textarea className={css['input']} rows={4} value={habitsText} placeholder={'如：项目文档一律使用中文' + '\n' + '界面排版紧凑信息密度优先'} onChange={(e) => setHabitsText(e.target.value)}/></label>
              <label className={css['compactField']}><span className={css['fieldLabel']}>注入字数上限（300-2000）</span><input className={css['input']} type="number" min={300} max={2000} step={100} value={profile.maxChars} onChange={(e) => setProfile({ ...profile, maxChars: Number(e.target.value) || 800 })}/></label>
              <div className={css['formFooter']}><span className={css['sectionHint']}>保存在本地 store.db，保存即时生效。</span><button type="button" className={css['primaryButton']} disabled={busy} onClick={() => { void saveProfile() }}>保存身份卡</button></div>
            </div>}
          </section>
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
      </div>

      <div className={css['memoryGrid']}>
        <section className={css['memoryPanel']}>
          <div className={css['panelHeading']}><div><h3 className={css['sectionTitle']}>内置长期记忆（主存储）</h3><p className={css['sectionHint']}>点内容查看详情；点关键词 chip 可过滤。{activeTag !== '' ? '当前过滤：' + activeTag : ''}</p></div><span className={css['badge']}>{activeTag === '' ? nativeEntries.length + ' 条' : visibleNative.length + '/' + nativeEntries.length} 条{activeTag !== '' && <button type="button" className={css['ghostButton']} onClick={() => setActiveTag('')}>清除过滤</button>}</span></div>
          {nativeEntries.length === 0 ? <div className={css['empty']}>暂无内置长期记忆。点右侧「迁移」导入 Mnemon/Hindsight，或正常使用几轮会话自动沉淀。</div> : <div className={css['nativeList']}>
            {visibleNative.map((entry) => <div key={entry.id} className={css['nativeRow']} data-selected={selectedEntryId === entry.id ? '' : undefined}>
              <div className={css['nativeRowMain']}><span className={css['nativeContent']} title={entry.content} onClick={() => { setSelectedEntryId(entry.id) }}>{entry.content}</span><span className={css['nativeTime']}>{fmtTime(entry.updatedAt)}</span><button type="button" className={css['dangerButton']} disabled={busy} onClick={() => { void removeNative(entry.id) }}>删除</button></div>
              <div className={css['memoryChips']}><span className={css['categoryBadge']}>{CATEGORY_LABELS[entry.category] ?? entry.category}</span><span className={css['nativeTime']}>{entry.source} · 重要度 {entry.importance}</span>{entry.tags.map((tag) => <button key={tag} type="button" className={css['memoryChip']} data-active={activeTag === tag.toLocaleLowerCase() ? '' : undefined} onClick={() => toggleTag(tag.toLocaleLowerCase())}>{tag}</button>)}</div>
            </div>)}
            {visibleNative.length === 0 && <div className={css['empty']}>该关键词下暂无条目。</div>}
          </div>}
        </section>

        <div className={css['memoryStack']}>
          <section className={css['memoryPanel']}><div className={css['panelHeading']}><div><h3 className={css['sectionTitle']}>会话记忆条目（沉淀原文库）</h3><p className={css['sectionHint']}>最近 30 条 · 自动提炼的会话记忆，随 RAG 检索参与每轮注入。</p></div><span className={css['badge']}>{docs.length} 条</span></div>
            {recentDocs.length === 0 ? <div className={css['empty']}>暂无会话沉淀。正常使用几轮会话后，值得长期保存的内容会出现在这里。</div> : <div className={css['memoryTable']} data-cols="4"><div className={css['memoryTableHead']}><span>内容</span><span>切块</span><span>时间</span><span>操作</span></div>{recentDocs.map((doc) => { const preview = (previews[doc.id] ?? '').trim(); return <div key={doc.id} className={css['memoryTableRow']}><span className={css['memoryDocTitle']} title={preview !== '' ? preview : memoryTitle(doc)}>{preview !== '' ? preview : memoryTitle(doc)}</span><span>{doc.chunkCount}</span><span className={css['nativeTime']}>{fmtTime(doc.createdAt)}</span><button type="button" className={css['dangerButton']} disabled={busy} onClick={() => { void deleteMemory(doc.id) }}>删除</button></div> })}</div>}
          </section>
          <section className={css['memoryPanel']}><div className={css['panelHeading']}><div><h3 className={css['sectionTitle']}>项目知识索引</h3><p className={css['sectionHint']}>尊重 .gitignore，增量更新到 RAG 知识库。</p></div></div><div className={css['inlineForm']}><input className={css['input']} value={projectPath} placeholder="/Users/andyfan/Documents/ds/项目" onChange={(e) => setProjectPath(e.target.value)}/><button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void indexProject() }}>开始索引</button></div></section>
          <section className={css['memoryPanel']}><div className={css['panelHeading']}><div><h3 className={css['sectionTitle']}>外部记忆迁移（幂等）</h3><p className={css['sectionHint']}>迁移进内置主存储：Mnemon 分条入库、Hindsight 整页入库；重复执行只更新不重复。</p></div>{migrationStatus !== null && <span className={css['badge']}>已迁移 {migrationStatus.migrated}/{migrationStatus.count}</span>}</div>
            <div className={css['inlineActions']}>
              <button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void migrateExternal('mnemon') }}>迁移 Mnemon 记忆</button>
              <button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void migrateExternal('hindsight') }}>迁移 Hindsight 知识</button>
            </div>
            {report !== '' && <p className={css['operationReport']}>{report}</p>}
          </section>
          {/* 卡片一律平级，禁止嵌套：只读镜像是独立能力，不再塞进迁移卡片内部造成双层边框。 */}
          <section className={css['memoryPanel']}><div className={css['panelHeading']}><div><h3 className={css['sectionTitle']}>外部只读镜像</h3><p className={css['sectionHint']}>当前仍保留只读同步，迁移完成前不删除外部数据。</p></div></div><div className={css['inlineActions']}><button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void syncMirror('mnemon') }}>同步 Mnemon</button><button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void syncMirror('hindsight') }}>同步 Hindsight</button></div></section>
        </div>
      </div>
    </section>
  )
}
