/**
 * 记忆治理工作台（治理与运维页）。
 *
 * 布局职责（0.29.4 看板化重构）：顶部一条紧凑概览带，下面 3:2 双栏——
 *   左列 = 需要动作的两块（复核队列、任务复盘）；右列 = 只读与运维工具（知识索引、外部迁移、归档、召回轨迹）。
 *   原先把七块内容平均堆进两列，空态与长句各占半屏，扫读路径被拉散，故改为按「要不要动手」分列。
 * 数据职责：治理数据走 DevforgeApi 同源路由，失败逐块降级；运维动作（索引/迁移/镜像）与治理同页自持状态。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import { type MemoryCandidate, type MemoryEpisode, type MemoryQualityStats, type MemoryRecallTrace, type MemorySettings, type MemoryStatus, type MirrorSyncResult, type NativeMemoryEntry, type ProjectIndexResult } from '../../memory/protocol.ts'
import css from './panel.module.css'

const CATEGORY_LABELS: Record<string, string> = { preference: '偏好', decision: '决策', fact: '事实', insight: '洞察', context: '上下文', general: '通用' }
const OUTCOME_LABELS: Record<string, string> = { success: '成功', partial: '部分成功', failure: '失败', unknown: '未判定' }
/** 复盘结果徽标语义色：成功走成功色，失败走错误色，未判定走中性。 */
const OUTCOME_KINDS: Record<string, string> = { success: 'success', partial: 'warning', failure: 'error', unknown: 'neutral' }
const VERDICT_LABELS: Record<string, string> = { useful: '有用', irrelevant: '不相关', incorrect: '有错误', outdated: '已过期' }

function fmtTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '—'
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

/** 候选状态徽标语义：pending=待审，needs-resolution=冲突待裁决，auto-activated=已自动生效。 */
function candidateBadge(candidate: MemoryCandidate): string {
  if (candidate.state === 'needs-resolution') return '冲突 ' + candidate.conflictIds.length
  if (candidate.state === 'deduped') return '重复'
  if (candidate.state === 'auto-activated') return '自动生效'
  if (candidate.state === 'approved') return '已通过'
  if (candidate.state === 'rejected') return '已拒绝'
  return '待处理'
}

export function MemoryGovernance({ api }: { api: DevforgeApi }): JSX.Element {
  const [quality, setQuality] = useState<MemoryQualityStats | null>(null)
  const [candidates, setCandidates] = useState<MemoryCandidate[]>([])
  const [episodes, setEpisodes] = useState<MemoryEpisode[]>([])
  const [recalls, setRecalls] = useState<MemoryRecallTrace[]>([])
  const [archived, setArchived] = useState<NativeMemoryEntry[]>([])
  const [settings, setSettings] = useState<MemorySettings | null>(null)
  const [status, setStatus] = useState<MemoryStatus | null>(null)
  const [projectPath, setProjectPath] = useState('')
  const [migrationStatus, setMigrationStatus] = useState<{ count: number; migrated: number; lastUpdatedAt: number } | null>(null)
  const [showAll, setShowAll] = useState<{ episodes: boolean; recalls: boolean; archived: boolean }>({ episodes: false, recalls: false, archived: false })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const mounted = useRef(true)

  const reload = useCallback(async (): Promise<void> => {
    const settled = await Promise.allSettled([api.getMemoryQuality(), api.listMemoryCandidates(), api.listMemoryEpisodes(20), api.listMemoryRecalls(20), api.listArchivedMemories(), api.getMemorySettings(), api.getMemoryStatus(), api.getMemoryMigrationStatus()])
    if (!mounted.current) return
    setQuality(settled[0].status === 'fulfilled' ? settled[0].value : null)
    setCandidates(settled[1].status === 'fulfilled' ? settled[1].value : [])
    setEpisodes(settled[2].status === 'fulfilled' ? settled[2].value : [])
    setRecalls(settled[3].status === 'fulfilled' ? settled[3].value : [])
    setArchived(settled[4].status === 'fulfilled' ? settled[4].value : [])
    setSettings(settled[5].status === 'fulfilled' ? settled[5].value : null)
    setStatus(settled[6].status === 'fulfilled' ? settled[6].value : null)
    setMigrationStatus(settled[7].status === 'fulfilled' ? settled[7].value : null)
  }, [api])

  useEffect(() => {
    mounted.current = true
    void reload()
    return () => { mounted.current = false }
  }, [reload])

  const run = async (action: () => Promise<string>): Promise<void> => {
    setBusy(true)
    setNotice('')
    try { setNotice(await action()) }
    catch (error) { if (mounted.current) setNotice('操作失败：' + (error instanceof Error ? error.message : String(error))) }
    finally { if (mounted.current) setBusy(false) }
  }

  /** 批准候选：无冲突直接激活；有冲突一次性取代全部已标记冲突条目（逐条勾选过重，冲突集由服务端硬校验）。 */
  const approve = (candidate: MemoryCandidate): Promise<void> => run(async () => {
    const result = await api.decideMemoryCandidate({ id: candidate.id, action: 'approve', ...(candidate.conflictIds.length > 0 ? { supersedesIds: candidate.conflictIds } : {}) })
    await reload()
    return '候选已激活为可信记忆' + (result.entry !== undefined ? '：' + result.entry.content.slice(0, 60) : '')
  })

  const reject = (candidate: MemoryCandidate): Promise<void> => run(async () => {
    await api.decideMemoryCandidate({ id: candidate.id, action: 'reject' })
    await reload()
    return '候选已拒绝，不会进入召回。'
  })

  const restore = (id: string): Promise<void> => run(async () => {
    await api.restoreArchivedMemory(id)
    await reload()
    return '记忆已恢复为活跃状态。'
  })

  const feedback = (recallId: string, entryId: string, verdict: 'useful' | 'irrelevant' | 'incorrect' | 'outdated'): Promise<void> => run(async () => {
    await api.submitMemoryFeedback({ recallId, entryId, verdict })
    await reload()
    return '反馈已记录：' + VERDICT_LABELS[verdict]
  })

  /** 项目知识索引：尊重 .gitignore 的增量更新，结果以报告行就地回显。 */
  const indexProject = (): Promise<void> => run(async () => {
    const path = projectPath.trim()
    if (path === '') throw new Error('项目路径必填，请填写本机绝对路径。')
    const result: ProjectIndexResult = await api.indexMemoryProject(path)
    await reload()
    return '项目索引 · 扫描 ' + result.scanned + ' · 新增 ' + result.added + ' · 更新 ' + result.updated + ' · 删除 ' + result.removed + ' · 跳过 ' + result.skipped + (result.errors.length > 0 ? ' · 错误 ' + result.errors.length : '')
  })

  /** 一键迁移外部记忆到内置主存储（幂等）：重复执行只更新不重复。 */
  const migrateExternal = (kind: 'mnemon' | 'hindsight' | 'mneme'): Promise<void> => run(async () => {
    const result = await api.migrateExternalMemory(kind)
    await reload()
    const label = kind === 'mneme' ? 'Mneme' : kind === 'mnemon' ? 'Mnemon' : 'Hindsight'
    return label + ' 迁移：扫描 ' + result.scanned + ' · 新增 ' + result.added + ' · 更新 ' + result.updated + ' · 跳过 ' + result.skipped
  })

  const syncMirror = (kind: 'mnemon' | 'hindsight'): Promise<void> => run(async () => {
    const result: MirrorSyncResult = await api.syncMemoryMirror(kind)
    await reload()
    return (kind === 'mnemon' ? 'Mnemon' : 'Hindsight') + ' 镜像 · 扫描 ' + result.scanned + ' · 新增 ' + result.added + ' · 更新 ' + result.updated + ' · 跳过 ' + result.skipped + (result.errors.length > 0 ? ' · 错误 ' + result.errors.length : '')
  })

  /** 复盘开关就地切换：改设置即保存，避免「开关在另一页签、状态在这一页」的来回跳。 */
  const toggleReflect = (): Promise<void> => run(async () => {
    if (settings === null) return '设置尚未读取完成，请稍后重试。'
    const saved = await api.saveMemorySettings({ ...settings, autoReflect: !settings.autoReflect })
    if (!mounted.current) return ''
    setSettings(saved)
    return saved.autoReflect ? '自动复盘已开启：每轮结束都会写结构化任务复盘。' : '自动复盘已关闭：只保留记忆沉淀，不再写任务复盘。'
  })

  // 渐进披露：默认只展示最近几条，需要时再展开全量（避免单页超长滚动）。
  const EPISODE_PREVIEW = 6
  const RECALL_PREVIEW = 5
  const ARCHIVE_PREVIEW = 6
  const shownEpisodes = showAll.episodes ? episodes : episodes.slice(0, EPISODE_PREVIEW)
  const shownRecalls = showAll.recalls ? recalls : recalls.slice(0, RECALL_PREVIEW)
  const shownArchived = showAll.archived ? archived : archived.slice(0, ARCHIVE_PREVIEW)
  const reflectOn = settings?.autoReflect !== false
  const reflectBroken = reflectOn && status !== null && (status.sedimentLastOutcome === 'failed' || status.sedimentFailureCount > 0)

  return <>
    {/* 概览带：一眼看清「有没有要处理的」，比首屏放五张大卡片更省地方。 */}
    {quality !== null && <div className={css['govStats']}>
      <span data-kind={candidates.length > 0 ? 'warning' : 'success'}><b>{candidates.length}</b>待处理候选</span>
      <span data-kind={quality.episodes > 0 ? 'muted' : 'warning'}><b>{quality.episodes}</b>任务复盘</span>
      <span><b>{quality.active}</b>活跃记忆</span>
      <span><b>{quality.archived}</b>归档</span>
      <span data-kind={quality.quarantined > 0 ? 'warning' : 'muted'}><b>{quality.quarantined}</b>隔离</span>
      <span data-kind={quality.incorrect > 0 ? 'warning' : 'muted'}><b>{quality.helpful}</b>反馈有用 / <b>{quality.incorrect}</b>有错</span>
      <span data-kind="muted"><b>{quality.retrievals}</b>召回轨迹</span>
    </div>}

    <div className={css['govBoard']}>
      {/* 左列：复核队列 + 任务复盘——两件事都需要人动手或需要人看结论。 */}
      <div className={css['govColumn']}>
        <section className={css['memoryPanel']}>
          <div className={css['panelHeading']}>
            <div><h3 className={css['sectionTitle']}>复核队列</h3><p className={css['sectionHint']}>自动沉淀直接生效；只有候选之间冲突（同一记忆键内容不一致）才会排到这里等待裁决。</p></div>
            <span className={css['badge']} data-status={candidates.length > 0 ? 'running' : 'succeeded'}>{candidates.length > 0 ? candidates.length + ' 条待处理' : '队列清空'}</span>
          </div>
          {candidates.length === 0
            ? <div className={css['govEmpty']}><span>没有待裁决候选：新记忆自动生效，冲突时自动取代旧事实。</span></div>
            : <div className={css['govCandidateList']}>{candidates.map((candidate) => <div key={candidate.id} className={css['govCandidate']}>
              <div className={css['govCandidateMain']}>
                <span className={css['govCandidateText']}>{candidate.content}</span>
                <span className={css['govCandidateMeta']}>
                  <span className={css['categoryBadge']}>{CATEGORY_LABELS[candidate.category] ?? candidate.category}</span>
                  <span>{candidate.source}{candidate.turn !== undefined ? ' · 轮 ' + candidate.turn : ''}</span>
                  <span>置信 {candidate.confidence.toFixed(2)}</span>
                  <span>{candidateBadge(candidate)}</span>
                  {candidate.reason !== '' && <span title={candidate.reason}>依据：{candidate.reason}</span>}
                </span>
              </div>
              <span className={css['govCandidateAction']}>
                <button type="button" className={css['primaryButton']} disabled={busy} onClick={() => { void approve(candidate) }}>{candidate.conflictIds.length > 0 ? '批准并取代冲突' : '批准'}</button>
                <button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void reject(candidate) }}>拒绝</button>
              </span>
            </div>)}</div>}
        </section>

        <section className={css['memoryPanel']}>
          <div className={css['panelHeading']}>
            <div><h3 className={css['sectionTitle']}>任务复盘</h3><p className={css['sectionHint']}>每轮结束自动记录目标、结果、工具证据与教训；失败的复盘同样留痕，便于定位模型或流程问题。</p></div>
            <span className={css['inlineActions']}>
              <span className={css['badge']} data-status={reflectBroken ? 'failed' : reflectOn ? 'succeeded' : 'queued'}>{reflectBroken ? '复盘异常' : reflectOn ? '自动运行' : '已关闭'}</span>
              <button type="button" className={css['ghostButton']} disabled={busy || settings === null} onClick={() => { void toggleReflect() }}>{reflectOn ? '关闭自动复盘' : '开启自动复盘'}</button>
            </span>
          </div>
          {episodes.length === 0
            ? <div className={css['govEmpty']}><span>{reflectOn ? '还没有任务复盘：本版启用后每轮结束都会记录；若沉淀模型持续失败，这里会先出现失败复盘。' : '自动复盘已关闭，开启后每轮结束都会写一条结构化复盘。'}</span>
              {status !== null && status.sedimentLastError !== '' && <span className={css['nativeTime']} title={status.sedimentLastError}>最近沉淀失败：{status.sedimentLastError.slice(0, 40)}…</span>}</div>
            : <><div className={css['govEpisodeList']}>{shownEpisodes.map((episode) => <div key={episode.id} className={css['govEpisode']}>
              <span className={css['categoryBadge']} data-kind={OUTCOME_KINDS[episode.outcome] ?? 'neutral'}>{OUTCOME_LABELS[episode.outcome] ?? episode.outcome}</span>
              <span className={css['govEpisodeBody']}>
                <span className={css['govEpisodeGoal']} title={episode.summary}>{episode.goal !== '' ? episode.goal : episode.summary.slice(0, 80)}</span>
                <span className={css['govEpisodeMeta']}>
                  <span>{episode.toolNames.length > 0 ? '工具 ' + episode.toolNames.slice(0, 3).join('、') + (episode.toolNames.length > 3 ? ' 等' : '') + '（成功 ' + episode.toolSuccesses + ' / 失败 ' + episode.toolFailures + '）' : '无工具调用'}</span>
                  {episode.lessons.length > 0 && <span title={episode.lessons.join('；')}>教训 {episode.lessons.length} 条</span>}
                  {episode.usedMemoryIds.length > 0 && <span>实际用上记忆 {episode.usedMemoryIds.length} 条</span>}
                  {episode.injectedMemoryIds.length > 0 && <span>注入 {episode.injectedMemoryIds.length} 条</span>}
                  <span>{fmtTime(episode.createdAt)}</span>
                </span>
              </span>
            </div>)}</div>
            {episodes.length > EPISODE_PREVIEW && <div className={css['pagination']}><span>共 {episodes.length} 条</span><button type="button" className={css['ghostButton']} onClick={() => setShowAll((prev) => ({ ...prev, episodes: !prev.episodes }))}>{showAll.episodes ? '收起' : '查看全部 ' + episodes.length + ' 条'}</button></div>}</>}
        </section>
      </div>

      {/* 右列：运维工具与只读回溯——平时不用动，需要时才展开。 */}
      <div className={css['govColumn']}>
        <section className={css['memoryPanel']}>
          <div className={css['panelHeading']}><div><h3 className={css['sectionTitle']}>项目知识索引</h3><p className={css['sectionHint']}>尊重 .gitignore，增量更新到 RAG 知识库。</p></div></div>
          <div className={css['inlineForm']}>
            <input className={css['input']} value={projectPath} placeholder="/Users/andyfan/Documents/ds/项目" onChange={(e) => setProjectPath(e.target.value)}/>
            <button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void indexProject() }}>开始索引</button>
          </div>
        </section>

        <section className={css['memoryPanel']}>
          <div className={css['panelHeading']}><div><h3 className={css['sectionTitle']}>外部记忆迁移</h3><p className={css['sectionHint']}>幂等迁入内置主存储：Mneme 整库搬家、Mnemon 分条入库、Hindsight 整页入库。</p></div>{migrationStatus !== null && <span className={css['badge']}>已迁移 {migrationStatus.migrated}/{migrationStatus.count}</span>}</div>
          <div className={css['memoryChips']}>
            <button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void migrateExternal('mneme') }}>迁移 Mneme</button>
            <button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void migrateExternal('mnemon') }}>迁移 Mnemon</button>
            <button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void migrateExternal('hindsight') }}>迁移 Hindsight</button>
            <button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void syncMirror('mnemon') }}>同步 Mnemon 镜像</button>
            <button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void syncMirror('hindsight') }}>同步 Hindsight 镜像</button>
          </div>
          <p className={css['sectionHint']}>迁移前保留外部数据只读镜像，不删除来源。</p>
        </section>

        <section className={css['memoryPanel']}>
          <div className={css['panelHeading']}>
            <div><h3 className={css['sectionTitle']}>归档与恢复</h3><p className={css['sectionHint']}>被取代、隔离或人工归档的记忆在这里可追溯，人工归档可直接恢复。</p></div>
            <span className={css['badge']}>{archived.length} 条</span>
          </div>
          {archived.length === 0
            ? <div className={css['govEmpty']}><span>暂无归档记忆：取代与隔离都会先落到这里，不会直接删除。</span></div>
            : <><div className={css['govArchiveList']}>{shownArchived.map((entry) => <div key={entry.id} className={css['govArchive']}>
              <span className={css['govArchiveText']} title={entry.content}>{entry.content}</span>
              <span className={css['categoryBadge']}>{entry.state === 'archived' ? '人工归档' : entry.state === 'quarantined' ? '已隔离' : '已取代'}</span>
              {entry.state === 'archived'
                ? <button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void restore(entry.id) }}>恢复</button>
                : <span className={css['nativeTime']}>需先处理冲突</span>}
            </div>)}</div>
            {archived.length > ARCHIVE_PREVIEW && <div className={css['pagination']}><span>共 {archived.length} 条</span><button type="button" className={css['ghostButton']} onClick={() => setShowAll((prev) => ({ ...prev, archived: !prev.archived }))}>{showAll.archived ? '收起' : '查看全部'}</button></div>}</>}
        </section>

        <section className={css['memoryPanel']}>
          <div className={css['panelHeading']}>
            <div><h3 className={css['sectionTitle']}>召回轨迹</h3><p className={css['sectionHint']}>每轮注入的查询、命中与降级都在这里；对真实注入过的记忆可直接反馈。</p></div>
            <span className={css['badge']}>{recalls.length} 条</span>
          </div>
          {recalls.length === 0
            ? <div className={css['govEmpty']}><span>暂无召回轨迹：开启主动注入后，每轮首步都会记录。</span></div>
            : <><div className={css['govRecallList']}>{shownRecalls.map((trace) => <div key={trace.id} className={css['govRecall']}>
              <span className={css['govRecallTop']}>
                <span className={css['memoryDocTitle']} title={trace.queryPreview}>{trace.queryPreview || '（空查询）'}</span>
                <span className={css['categoryBadge']} data-kind={trace.outcome === 'hit' ? 'success' : 'neutral'}>{trace.outcome}{trace.degradedLayers.length > 0 ? ' · 降级' : ''}</span>
              </span>
              <span className={css['govRecallMeta']}>
                <span>{trace.hits.filter((hit) => hit.included).length} 条注入 · {trace.latencyMs}ms · {fmtTime(trace.createdAt)}</span>
                {trace.hits.filter((hit) => hit.included && hit.layer !== 'mirror').slice(0, 2).map((hit) => <span key={hit.entryId} className={css['inlineActions']}>
                  <button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void feedback(trace.id, hit.entryId, 'useful') }}>有用</button>
                  <button type="button" className={css['dangerButton']} disabled={busy} onClick={() => { void feedback(trace.id, hit.entryId, 'incorrect') }}>有错</button>
                </span>)}
              </span>
            </div>)}</div>
            {recalls.length > RECALL_PREVIEW && <div className={css['pagination']}><span>共 {recalls.length} 条</span><button type="button" className={css['ghostButton']} onClick={() => setShowAll((prev) => ({ ...prev, recalls: !prev.recalls }))}>{showAll.recalls ? '收起' : '查看全部'}</button></div>}</>}
        </section>
      </div>
    </div>

    {notice !== '' && <p className={css['operationReport']}>{notice}<button type="button" className={css['ghostButton']} onClick={() => setNotice('')}>关闭</button></p>}
  </>
}
