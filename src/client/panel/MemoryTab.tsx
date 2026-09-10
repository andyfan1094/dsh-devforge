/**
 * 记忆工作台：页签化布局（记忆库 / 自动策略 / 治理运维）。
 * 数据职责：全部通过 DevforgeApi 访问同源路由；图谱与列表互联动（点节点看详情/点关键词过滤）。
 * 布局职责：主存储列表带工具栏（本地过滤 + 分类筛选 + 手动新增）与分页；图谱与沉淀原文库折叠收纳。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import { type BrainRouterCatalogProvider } from '../../brain-router/protocol.ts'
import { type MemoryDreamStatus, type MemoryGraph, type MemorySettings, type MemoryStatus, type MemoryUserProfile, type NativeMemoryEntry } from '../../memory/protocol.ts'
import type { RagDocument } from '../../rag/protocol.ts'
import css from './panel.module.css'
import { MemoryGraphView } from './MemoryGraphView.tsx'
import { MemoryGovernance } from './MemoryGovernance.tsx'

type Notice = { kind: 'success' | 'error'; text: string }
type MemoryTabId = 'library' | 'policy' | 'ops'

/** 分类中文展示名（与后端 graph.ts 保持一致）。 */
const CATEGORY_LABELS: Record<string, string> = { preference: '偏好', decision: '决策', fact: '事实', insight: '洞察', context: '上下文', general: '通用' }
const CATEGORY_ORDER = ['preference', 'decision', 'fact', 'insight', 'context', 'general']

/** 主存储列表每页条数：紧凑表格 20 条一页，避免 200+ 条全量平铺。 */
const PAGE_SIZE = 20

function memoryTitle(doc: RagDocument): string {
  return doc.fileName.replace(/^mem-/, '').replace(/\.md$/, '')
}

/** 紧凑时间显示：MM-DD HH:mm（等宽数字）。 */
function fmtTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '—'
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

/** 记忆工作台。 */
export function MemoryTab({ api }: { api: DevforgeApi }): JSX.Element {
  const [status, setStatus] = useState<MemoryStatus | null>(null)
  const [settings, setSettings] = useState<MemorySettings | null>(null)
  const [docs, setDocs] = useState<RagDocument[]>([])
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [nativeEntries, setNativeEntries] = useState<NativeMemoryEntry[]>([])
  const [graph, setGraph] = useState<MemoryGraph | null>(null)
  const [activeTag, setActiveTag] = useState('')
  const [selectedEntryId, setSelectedEntryId] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [softError, setSoftError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [profile, setProfile] = useState<MemoryUserProfile | null>(null)
  const [habitsText, setHabitsText] = useState('')
  const [dream, setDream] = useState<MemoryDreamStatus | null>(null)
  const [catalog, setCatalog] = useState<BrainRouterCatalogProvider[]>([])
  // 布局状态：页签、工具栏过滤、分页、折叠面板。
  const [tab, setTab] = useState<MemoryTabId>('library')
  const [filterQuery, setFilterQuery] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [page, setPage] = useState(1)
  const [graphOpen, setGraphOpen] = useState(false)
  const [docsOpen, setDocsOpen] = useState(false)
  const mounted = useRef(true)

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [nextStatus, nextSettings, nextCatalog] = await Promise.all([api.getMemoryStatus(), api.getMemorySettings(), api.getBrainRouterCatalog().catch(() => [] as BrainRouterCatalogProvider[])])
      setCatalog(nextCatalog)
      const nextDocs = nextStatus.memoryKbId === '' ? [] : await api.listMemories()
      // 预览最近 30 条的首块内容：沉淀条目文件名是时间戳，必须给可读内容（单条失败回退文件名）
      const recentIds = nextDocs.slice().reverse().slice(0, 30)
      const previewMap: Record<string, string> = {}
      await Promise.all(recentIds.map(async (doc) => {
        try { previewMap[doc.id] = await api.previewMemoryDoc(doc.id) } catch { /* 回退展示文件名 */ }
      }))
      // 图谱与主存储列表是补充视图：单独失败不拖垮整页，错误以 softError 提示
      const settled = await Promise.allSettled([api.listNativeMemories(), api.getMemoryGraph(), api.getUserProfile(), api.getMemoryDreamStatus()])
      if (!mounted.current) return
      setStatus(nextStatus)
      setSettings(nextSettings)
      setDocs(nextDocs)
      setPreviews(previewMap)
      setNativeEntries(settled[0].status === 'fulfilled' ? settled[0].value : [])
      setGraph(settled[1].status === 'fulfilled' ? settled[1].value : null)
      setDream(settled[3].status === 'fulfilled' ? settled[3].value : null)
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
    if (selectedEntryId === id) setSelectedEntryId('')
    await reload()
    if (mounted.current) setNotice({ kind: 'success', text: '内置记忆已删除。' })
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

  /** 手动触发一轮做梦整理：裁决在服务端异步执行（数十秒），轮询刷新直到出结果。 */
  const runDream = (): Promise<void> => run(async () => {
    const result = await api.runMemoryDream()
    if (!result.started) throw new Error(result.message)
    if (mounted.current) setNotice({ kind: 'success', text: result.message })
    await reload()
    // 每 20s 补一次刷新（最多 9 次 ≈ 3 分钟），让「整理中」标记与运行记录自动落位。
    const poll = (attempt: number): void => {
      if (!mounted.current || attempt > 9) return
      setTimeout(() => { void reload(); poll(attempt + 1) }, 20_000)
    }
    poll(1)
  })

  const updateSettings = (patch: Partial<MemorySettings>): void => {
    if (settings !== null) setSettings({ ...settings, ...patch })
  }

  const recentDocs = docs.slice().reverse().slice(0, 30)
  const sourceReady = status?.memoryKbId !== '' && status?.memoryKbId !== undefined

  // 图谱聚焦：优先选中条目，其次激活关键词；列表过滤直接复用图谱边（entry→term），不重复抽关键词
  const focusId = selectedEntryId !== '' ? 'entry:' + selectedEntryId : activeTag !== '' ? 'term:' + activeTag : ''
  const tagFilteredIds = useMemo(() => {
    if (activeTag === '' || graph === null) return undefined
    const ids = new Set<string>()
    for (const edge of graph.edges) {
      if (edge.target === 'term:' + activeTag && edge.source.startsWith('entry:')) ids.add(edge.source.slice('entry:'.length))
    }
    return ids
  }, [activeTag, graph])

  /** 工具栏过滤：本地即时过滤（关键词 + 分类），叠加图谱关键词 chip 过滤。 */
  const filtered = useMemo(() => {
    const q = filterQuery.trim().toLocaleLowerCase()
    return nativeEntries.filter((entry) => {
      if (tagFilteredIds !== undefined && !tagFilteredIds.has(entry.id)) return false
      if (filterCategory !== '' && entry.category !== filterCategory) return false
      if (q === '') return true
      return entry.content.toLocaleLowerCase().includes(q) || entry.tags.some((tag) => tag.toLocaleLowerCase().includes(q))
    })
  }, [nativeEntries, tagFilteredIds, filterQuery, filterCategory])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageClamped = Math.min(page, totalPages)
  const pageEntries = filtered.slice((pageClamped - 1) * PAGE_SIZE, pageClamped * PAGE_SIZE)
  const selectedEntry = selectedEntryId === '' ? undefined : nativeEntries.find((entry) => entry.id === selectedEntryId)

  const toggleTag = (tag: string): void => {
    setActiveTag((current) => (current === tag ? '' : tag))
    setPage(1)
  }

  const onFilterChange = (query: string, category: string): void => {
    setFilterQuery(query)
    setFilterCategory(category)
    setPage(1)
  }

  /** 统计卡副行：只留开关态与最近时间，长状态串收敛进 title 悬停查看。 */
  const sedimentTitle = status !== null && status.lastSedimentAt > 0 ? '最近沉淀：' + fmtTime(status.lastSedimentAt) + (status.sedimentLastOutcome !== '' ? ' · 判定 ' + status.sedimentLastOutcome : '') + (status.sedimentLastError !== '' ? ' · 最近失败：' + status.sedimentLastError : '') : '本版启用后尚未沉淀'
  const injectTitle = status !== null && status.lastInjectPreview !== '' ? '最近注入：' + status.lastInjectPreview : '尚未注入过；每轮对话第一步检索命中才注入'
  const dreamTitle = status !== null && status.lastDreamSummary !== '' ? '最近做梦：' + status.lastDreamSummary : '尚未做梦；开启后按静默窗口自动整理'

  return (
    <section className={css['memoryWorkspace']}>
      <header className={css['memoryHeader']}>
        <div><h2 className={css['workspaceTitle']}>记忆工作台</h2><p className={css['sectionHint']}>内置长期记忆主存储 + 会话沉淀库统一管理；图谱可视化、迁移与治理都在这里。</p></div>
        <span className={css['inlineActions']}><span className={css['badge']} data-kind="success">{nativeEntries.length} 条活跃记忆</span><button type="button" className={css['ghostButton']} disabled={busy || loading} onClick={() => { void reload() }}>{loading ? '读取中…' : '刷新状态'}</button></span>
      </header>

      {notice !== null && <div className={css['banner']} data-kind={notice.kind}>{notice.text}<button type="button" className={css['ghostButton']} onClick={() => setNotice(null)}>关闭</button></div>}

      <div className={css['memoryStats']}>
        <div className={css['memoryStat']}><span>内置长期记忆</span><strong>{nativeEntries.length || (status === null ? '—' : 0)}</strong><small>主存储活跃条数</small></div>
        <div className={css['memoryStat']}><span>会话沉淀库</span><strong>{status?.memoryCount ?? '—'}</strong><small>RAG 沉淀文档数</small></div>
        <div className={css['memoryStat']} title={sedimentTitle}><span>自动沉淀</span><strong>{status?.sedimentCount ?? '—'} 条</strong><small>{settings?.autoSediment ? '已开启' : '已关闭'} · 最近 {status !== null && status.lastSedimentAt > 0 ? fmtTime(status.lastSedimentAt) : '—'}</small></div>
        <div className={css['memoryStat']} title={injectTitle}><span>主动注入</span><strong>{status?.injectCount ?? '—'} 次</strong><small>{settings?.autoInject ? '已开启' : '已关闭'} · 最近 {status !== null && status.lastInjectAt > 0 ? fmtTime(status.lastInjectAt) : '—'}</small></div>
        <div className={css['memoryStat']} title={dreamTitle}><span>做梦整理</span><strong>{status?.dreamTotal ?? '—'} 次</strong><small>{settings?.dreamEnabled ? '自动运行' : '已关闭'}{dream?.running === true ? ' · 整理中…' : ''}</small></div>
      </div>

      <nav className={css['tabBar']}>
        <button type="button" className={css['tabItem']} data-active={tab === 'library' ? '' : undefined} onClick={() => setTab('library')}>记忆库</button>
        <button type="button" className={css['tabItem']} data-active={tab === 'policy' ? '' : undefined} onClick={() => setTab('policy')}>自动策略</button>
        <button type="button" className={css['tabItem']} data-active={tab === 'ops' ? '' : undefined} onClick={() => setTab('ops')}>治理与运维</button>
      </nav>

      {tab === 'library' && <div className={css['memoryStack']}>
        <section className={css['memoryPanel']}>
          <div className={css['panelHeading']}><div><h3 className={css['sectionTitle']}>内置长期记忆（主存储）</h3><p className={css['sectionHint']}>点击行查看详情与标签过滤；工具栏支持即时搜索、分类筛选与手动新增。</p></div><span className={css['badge']}>{filtered.length} 条{tagFilteredIds !== undefined ? '（已过滤）' : ''}</span></div>
          <div className={css['toolbar']}>
            <input className={css['input']} value={filterQuery} placeholder="搜索内容或标签…" onChange={(e) => onFilterChange(e.target.value, filterCategory)} />
            <select className={css['input']} value={filterCategory} onChange={(e) => onFilterChange(filterQuery, e.target.value)}>
              <option value="">全部分类</option>
              {CATEGORY_ORDER.map((cat) => <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>)}
            </select>
            {activeTag !== '' && <span className={css['memoryChip']} data-active="">#{activeTag}<button type="button" className={css['chipClear']} onClick={() => toggleTag(activeTag)}>×</button></span>}
            <span style={{ flex: 1 }} />
            <input className={css['input']} value={draftContent} placeholder="手动补录一条长期记忆…" onChange={(e) => setDraftContent(e.target.value)} />
            <button type="button" className={css['primaryButton']} disabled={busy || draftContent.trim() === ''} onClick={() => { void saveNative() }}>新增</button>
          </div>
          {softError !== '' && <p className={css['operationReport']}>{softError}</p>}
          {filtered.length === 0 ? <div className={css['empty']}>{nativeEntries.length === 0 ? '暂无内置长期记忆。正常使用几轮会话会自动沉淀，或在上方工具栏手动补录。' : '当前筛选下没有条目。'}</div> : <div className={css['memoryTable']} data-cols="5">
            <div className={css['memoryTableHead']}><span>内容</span><span>分类</span><span>来源 · 重要度</span><span>更新时间</span><span>操作</span></div>
            {pageEntries.map((entry) => <div key={entry.id} className={css['memoryTableRow']} data-selected={selectedEntryId === entry.id ? '' : undefined} onClick={() => setSelectedEntryId(selectedEntryId === entry.id ? '' : entry.id)}>
              <span className={css['memoryDocTitle']} title={entry.content}>{entry.content}</span>
              <span><span className={css['categoryBadge']}>{CATEGORY_LABELS[entry.category] ?? entry.category}</span></span>
              <span className={css['nativeTime']}>{entry.source} · {entry.importance}</span>
              <span className={css['nativeTime']}>{fmtTime(entry.updatedAt)}</span>
              <span className={css['inlineActions']} onClick={(e) => e.stopPropagation()}><button type="button" className={css['dangerButton']} disabled={busy} onClick={() => { void removeNative(entry.id) }}>删除</button></span>
            </div>)}
          </div>}
          {selectedEntry !== undefined && <div className={css['rowDetail']}>
            <div className={css['memoryChips']}><span className={css['categoryBadge']}>{CATEGORY_LABELS[selectedEntry.category] ?? selectedEntry.category}</span>{selectedEntry.tags.map((tag) => <button key={tag} type="button" className={css['memoryChip']} data-active={activeTag === tag ? '' : undefined} onClick={() => toggleTag(tag)}>{tag}</button>)}</div>
            <div className={css['rowDetailContent']}>{selectedEntry.content}</div>
            <div className={css['nativeRowMain']}><span className={css['nativeTime']}>{fmtTime(selectedEntry.updatedAt)} · {selectedEntry.source} · 重要度 {selectedEntry.importance} · 信任 {selectedEntry.trust}</span><span style={{ flex: 1 }} /><button type="button" className={css['dangerButton']} disabled={busy} onClick={() => { void removeNative(selectedEntry.id) }}>删除</button><button type="button" className={css['ghostButton']} onClick={() => setSelectedEntryId('')}>关闭</button></div>
          </div>}
          {filtered.length > PAGE_SIZE && <div className={css['pagination']}><button type="button" className={css['ghostButton']} disabled={pageClamped <= 1} onClick={() => setPage(pageClamped - 1)}>上一页</button><span>第 {pageClamped} / {totalPages} 页 · 共 {filtered.length} 条</span><button type="button" className={css['ghostButton']} disabled={pageClamped >= totalPages} onClick={() => setPage(pageClamped + 1)}>下一页</button></div>}
        </section>

        <section className={css['memoryPanel']}>
          <div className={css['panelHeading']}><div><h3 className={css['sectionTitle']}>知识图谱</h3><p className={css['sectionHint']}>由内置长期记忆现算：条目-关键词-分类关联；点条目看详情，点关键词过滤列表。</p></div><span className={css['inlineActions']}><span className={css['badge']}>{graph === null ? '—' : graph.nodes.length + ' 节点 · ' + graph.edges.length + ' 边'}</span><button type="button" className={css['ghostButton']} onClick={() => setGraphOpen((open) => !open)}>{graphOpen ? '收起' : '展开'}</button></span></div>
          {graphOpen && <MemoryGraphView graph={graph} focusId={focusId} onSelectEntry={(id) => setSelectedEntryId(id)} onToggleTag={toggleTag} />}
        </section>

        <section className={css['memoryPanel']}>
          <div className={css['panelHeading']}><div><h3 className={css['sectionTitle']}>会话沉淀原文库</h3><p className={css['sectionHint']}>最近 30 条 · 自动提炼的会话记忆，随 RAG 检索参与每轮注入。</p></div><span className={css['inlineActions']}><span className={css['badge']}>{docs.length} 条</span><button type="button" className={css['ghostButton']} onClick={() => setDocsOpen((open) => !open)}>{docsOpen ? '收起' : '展开'}</button></span></div>
          {docsOpen && (recentDocs.length === 0 ? <div className={css['empty']}>暂无会话沉淀。正常使用几轮会话后，值得长期保存的内容会出现在这里。</div> : <div className={css['memoryTable']} data-cols="4"><div className={css['memoryTableHead']}><span>内容</span><span>切块</span><span>时间</span><span>操作</span></div>{recentDocs.map((doc) => { const preview = (previews[doc.id] ?? '').trim(); return <div key={doc.id} className={css['memoryTableRow']}><span className={css['memoryDocTitle']} title={preview !== '' ? preview : memoryTitle(doc)}>{preview !== '' ? preview : memoryTitle(doc)}</span><span>{doc.chunkCount}</span><span className={css['nativeTime']}>{fmtTime(doc.createdAt)}</span><button type="button" className={css['dangerButton']} disabled={busy} onClick={() => { void deleteMemory(doc.id) }}>删除</button></div> })}</div>)}
        </section>
      </div>}

      {tab === 'policy' && <div className={css['policyGrid']}>
        <section className={css['memoryPanel']}>
          <div className={css['panelHeading']}><div><h3 className={css['sectionTitle']}>自动记忆策略</h3><p className={css['sectionHint']}>控制会话结束后的提炼、每轮开始时的相关记忆注入，以及候选自动激活。</p></div><span className={css['badge']} data-kind={settings?.enabled ? 'success' : 'pending'}>{settings?.enabled ? '运行中' : '已停用'}</span></div>
          {settings === null ? <div className={css['empty']} data-loading="">正在读取设置…</div> : <div className={css['memoryForm']}>
            <label className={css['toggleRow']}><input type="checkbox" checked={settings.enabled} onChange={(e) => updateSettings({ enabled: e.target.checked })}/><span><strong>启用记忆层</strong><small>关闭后不自动沉淀，也不主动注入。</small></span></label>
            <label className={css['toggleRow']}><input type="checkbox" checked={settings.autoSediment} onChange={(e) => updateSettings({ autoSediment: e.target.checked })}/><span><strong>自动沉淀</strong><small>会话结束后提炼值得长期保存的信息。</small></span></label>
            <label className={css['toggleRow']}><input type="checkbox" checked={settings.autoInject} onChange={(e) => updateSettings({ autoInject: e.target.checked })}/><span><strong>主动注入</strong><small>每轮首步召回与当前问题相关的记忆。</small></span></label>
            <label className={css['toggleRow']}><input type="checkbox" checked={settings.autoActivate} onChange={(e) => updateSettings({ autoActivate: e.target.checked })}/><span><strong>候选自动激活</strong><small>沉淀与工具写入直接生效，无需人工审核；关闭则回退到工作台审核流程。</small></span></label>
            <label className={css['toggleRow']}><input type="checkbox" checked={settings.projectProfile} onChange={(e) => updateSettings({ projectProfile: e.target.checked })}/><span><strong>项目档案卡</strong><small>工作目录命中登记项目时，全量注入该项目已沉淀记忆。</small></span></label>
            <label className={css['toggleRow']}><input type="checkbox" checked={settings.dreamEnabled} onChange={(e) => updateSettings({ dreamEnabled: e.target.checked })}/><span><strong>做梦整理</strong><small>库静默后自动整理重复与过期记忆（软删除可恢复）。</small></span></label>
            <label className={css['toggleRow']}><input type="checkbox" checked={!settings.dreamProposalOnly} onChange={(e) => updateSettings({ dreamProposalOnly: !e.target.checked })}/><span><strong>治理建议自动应用</strong><small>做梦裁决通过的合并/归档直接生效（软删除可恢复、审计可回滚）；关闭则仅出建议等待人工审核。</small></span></label>
            <div className={css['compactFields']}>
              <label className={css['compactField']}><span className={css['fieldLabel']}>注入条数</span><input className={css['input']} type="number" min={1} max={20} value={settings.topK} onChange={(e) => updateSettings({ topK: Number(e.target.value) || 4 })}/></label>
              <label className={css['compactField']}><span className={css['fieldLabel']}>相关度阈值</span><input className={css['input']} type="number" min={0} max={1} step={0.05} value={settings.threshold} onChange={(e) => updateSettings({ threshold: Number(e.target.value) || 0 })}/></label>
              <label className={css['compactField']}><span className={css['fieldLabel']}>注入字数上限</span><input className={css['input']} type="number" min={300} max={4000} step={100} value={settings.maxChars} onChange={(e) => updateSettings({ maxChars: Number(e.target.value) || 1200 })}/></label>
              <label className={css['compactField']}><span className={css['fieldLabel']}>做梦静默分钟</span><input className={css['input']} type="number" min={1} max={120} value={settings.dreamIdleMinutes} onChange={(e) => updateSettings({ dreamIdleMinutes: Number(e.target.value) || 10 })}/></label>
              <label className={css['compactField']}><span className={css['fieldLabel']}>做梦最小间隔（小时）</span><input className={css['input']} type="number" min={1} max={168} value={settings.dreamMinIntervalHours} onChange={(e) => updateSettings({ dreamMinIntervalHours: Number(e.target.value) || 6 })}/></label>
              <label className={css['compactField']}><span className={css['fieldLabel']}>沉淀服务商（空=跟随默认路由）</span><select className={css['input']} value={settings.sedimentProvider} onChange={(e) => updateSettings({ sedimentProvider: e.target.value, sedimentModel: '' })}><option value="">跟随默认路由</option>{catalog.map((provider) => <option key={provider.id} value={provider.id}>{provider.name || provider.id}</option>)}{settings.sedimentProvider !== '' && !catalog.some((provider) => provider.id === settings.sedimentProvider) && <option value={settings.sedimentProvider}>{settings.sedimentProvider}（已存，目录中暂无）</option>}</select></label>
              <label className={css['compactField']}><span className={css['fieldLabel']}>沉淀模型（空=跟随默认）</span><select className={css['input']} value={settings.sedimentModel} disabled={settings.sedimentProvider === ''} onChange={(e) => updateSettings({ sedimentModel: e.target.value })}><option value="">跟随默认</option>{(catalog.find((provider) => provider.id === settings.sedimentProvider)?.models ?? []).map((model) => <option key={model.id} value={model.id}>{model.name || model.id}</option>)}{settings.sedimentProvider !== '' && settings.sedimentModel !== '' && !(catalog.find((provider) => provider.id === settings.sedimentProvider)?.models ?? []).some((model) => model.id === settings.sedimentModel) && <option value={settings.sedimentModel}>{settings.sedimentModel}（已存，目录中暂无）</option>}</select></label>
              <label className={css['compactField']}><span className={css['fieldLabel']}>裁决服务商（空=跟随默认路由）</span><select className={css['input']} value={settings.dreamProvider} onChange={(e) => updateSettings({ dreamProvider: e.target.value, dreamModel: '' })}><option value="">跟随默认路由</option>{catalog.map((provider) => <option key={provider.id} value={provider.id}>{provider.name || provider.id}</option>)}{settings.dreamProvider !== '' && !catalog.some((provider) => provider.id === settings.dreamProvider) && <option value={settings.dreamProvider}>{settings.dreamProvider}（已存，目录中暂无）</option>}</select></label>
              <label className={css['compactField']}><span className={css['fieldLabel']}>裁决模型（空=跟随默认）</span><select className={css['input']} value={settings.dreamModel} disabled={settings.dreamProvider === ''} onChange={(e) => updateSettings({ dreamModel: e.target.value })}><option value="">跟随默认</option>{(catalog.find((provider) => provider.id === settings.dreamProvider)?.models ?? []).map((model) => <option key={model.id} value={model.id}>{model.name || model.id}</option>)}{settings.dreamProvider !== '' && settings.dreamModel !== '' && !(catalog.find((provider) => provider.id === settings.dreamProvider)?.models ?? []).some((model) => model.id === settings.dreamModel) && <option value={settings.dreamModel}>{settings.dreamModel}（已存，目录中暂无）</option>}</select></label>
            </div>
            <div className={css['formFooter']}><span className={css['sectionHint']}>设置存入本地 store.db，不依赖外部记忆插件。</span><button type="button" className={css['primaryButton']} disabled={busy} onClick={() => { void saveSettings() }}>保存策略</button></div>
          </div>}
        </section>
        <div className={css['memoryStack']}>
          <section className={css['memoryPanel']}>
            <div className={css['panelHeading']}><div><h3 className={css['sectionTitle']}>记忆做梦整理</h3><p className={css['sectionHint']}>库静默后自动合并重复、归档过期（软删除可恢复）；裁决模型在上方策略里指定。</p></div><span className={css['badge']} data-kind={settings?.dreamEnabled ? 'success' : 'pending'}>{dream?.running === true ? '整理中…' : settings?.dreamEnabled ? '自动运行' : '已关闭'}</span></div>
            <div className={css['inlineActions']}><button type="button" className={css['primaryButton']} disabled={busy || dream?.running === true} onClick={() => { void runDream() }}>{dream?.running === true ? '整理中…' : '立即整理一次'}</button></div>
            {dream !== null && dream.runs.length > 0 ? <div className={css['memoryTable']}>
              <div className={css['memoryTableHead']}><span>时间</span><span>状态</span><span>结果</span></div>
              {dream.runs.slice(0, 6).map((run) => <div key={run.id} className={css['memoryTableRow']}>
                <span className={css['nativeTime']}>{fmtTime(run.finishedAt)}{run.manual ? ' · 手动' : ''}</span>
                <span className={css['categoryBadge']}>{run.status}</span>
                <span className={css['memoryDocTitle']} title={run.error ?? ''}>{run.status === 'failed' ? (run.error ?? '失败') : run.status === 'skipped' ? (run.error ?? '未达触发条件') : Array.isArray(run.proposals) ? '快照 ' + run.snapshot + ' · 治理建议 ' + run.proposals.length + ' 条（待人工审核）' : '快照 ' + run.snapshot + ' · 归档 ' + run.archived + ' · 合并 ' + run.merged + ' 组 · 修订 ' + run.updated + (run.skipped.length > 0 ? ' · 跳过 ' + run.skipped.length : '')}</span>
              </div>)}
            </div> : <div className={css['empty']}>还没有做梦记录。开启后按静默窗口自动整理，或点上方按钮立即整理。</div>}
          </section>
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
        </div>
      </div>}

      {tab === 'ops' && <MemoryGovernance api={api} />}
    </section>
  )
}
