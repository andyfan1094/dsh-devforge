/**
 * 记忆治理工作台：候选审核、质量统计、任务复盘、召回轨迹反馈与归档恢复。
 * 数据职责：全部通过 DevforgeApi 访问同源治理路由；失败逐块降级，不拖垮主面板。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import { type MemoryCandidate, type MemoryEpisode, type MemoryQualityStats, type MemoryRecallTrace, type NativeMemoryEntry } from '../../memory/protocol.ts'
import css from './panel.module.css'

const CATEGORY_LABELS: Record<string, string> = { preference: '偏好', decision: '决策', fact: '事实', insight: '洞察', context: '上下文', general: '通用' }
const OUTCOME_LABELS: Record<string, string> = { success: '成功', partial: '部分成功', failure: '失败', unknown: '未判定' }
const VERDICT_LABELS: Record<string, string> = { useful: '有用', irrelevant: '不相关', incorrect: '有错误', outdated: '已过期' }

function fmtTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '—'
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

/** 候选状态徽标语义：pending=待审，needs-resolution=冲突待裁决。 */
function candidateBadge(candidate: MemoryCandidate): string {
  if (candidate.state === 'needs-resolution') return '冲突 ' + candidate.conflictIds.length
  if (candidate.state === 'deduped') return '重复'
  return '待审核'
}

export function MemoryGovernance({ api }: { api: DevforgeApi }): JSX.Element {
  const [quality, setQuality] = useState<MemoryQualityStats | null>(null)
  const [candidates, setCandidates] = useState<MemoryCandidate[]>([])
  const [episodes, setEpisodes] = useState<MemoryEpisode[]>([])
  const [recalls, setRecalls] = useState<MemoryRecallTrace[]>([])
  const [archived, setArchived] = useState<NativeMemoryEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const mounted = useRef(true)

  const reload = useCallback(async (): Promise<void> => {
    const settled = await Promise.allSettled([api.getMemoryQuality(), api.listMemoryCandidates(), api.listMemoryEpisodes(20), api.listMemoryRecalls(20), api.listArchivedMemories()])
    if (!mounted.current) return
    setQuality(settled[0].status === 'fulfilled' ? settled[0].value : null)
    setCandidates(settled[1].status === 'fulfilled' ? settled[1].value : [])
    setEpisodes(settled[2].status === 'fulfilled' ? settled[2].value : [])
    setRecalls(settled[3].status === 'fulfilled' ? settled[3].value : [])
    setArchived(settled[4].status === 'fulfilled' ? settled[4].value : [])
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

  return (
    <section className={css['memoryPanel']}>
      <div className={css['panelHeading']}><div><h3 className={css['sectionTitle']}>记忆治理</h3><p className={css['sectionHint']}>模型提炼只产生候选，这里人工转正；任务复盘与召回轨迹可追溯，错误记忆可反馈隔离。</p></div><span className={css['badge']} data-kind={candidates.length > 0 ? 'pending' : 'success'}>{candidates.length > 0 ? candidates.length + ' 条待审核' : '队列清空'}</span></div>

      {notice !== '' && <p className={css['operationReport']}>{notice}<button type="button" className={css['ghostButton']} onClick={() => setNotice('')}>关闭</button></p>}

      {quality !== null && <div className={css['memoryChips']}>
        <span className={css['memoryChip']}>活跃 {quality.active}</span>
        <span className={css['memoryChip']}>候选 {quality.candidates}</span>
        <span className={css['memoryChip']}>已取代 {quality.superseded}</span>
        <span className={css['memoryChip']}>归档 {quality.archived}</span>
        <span className={css['memoryChip']}>隔离 {quality.quarantined}</span>
        <span className={css['memoryChip']}>项目作用域 {quality.scoped}</span>
        <span className={css['memoryChip']}>已确认 {quality.confirmed}</span>
        <span className={css['memoryChip']}>legacy {quality.legacy}</span>
        <span className={css['memoryChip']}>反馈有用 {quality.helpful}</span>
        <span className={css['memoryChip']}>反馈有错 {quality.incorrect}</span>
        <span className={css['memoryChip']}>复盘 {quality.episodes}</span>
        <span className={css['memoryChip']}>召回 {quality.retrievals}</span>
      </div>}

      {candidates.length > 0 ? <div className={css['memoryTable']} data-cols="4">
        <div className={css['memoryTableHead']}><span>候选内容</span><span>来源 · 置信度</span><span>状态</span><span>操作</span></div>
        {candidates.map((candidate) => <div key={candidate.id} className={css['memoryTableRow']}>
          <span className={css['memoryDocTitle']} title={candidate.content + (candidate.reason !== '' ? '｜依据：' + candidate.reason : '')}>{CATEGORY_LABELS[candidate.category] ?? candidate.category} · {candidate.content}</span>
          <span className={css['nativeTime']}>{candidate.source}{candidate.turn !== undefined ? ' · 轮 ' + candidate.turn : ''} · 置信 {candidate.confidence.toFixed(2)}</span>
          <span className={css['categoryBadge']}>{candidateBadge(candidate)}</span>
          <span className={css['inlineActions']}><button type="button" className={css['primaryButton']} disabled={busy} onClick={() => { void approve(candidate) }}>{candidate.conflictIds.length > 0 ? '批准并取代冲突' : '批准'}</button><button type="button" className={css['dangerButton']} disabled={busy} onClick={() => { void reject(candidate) }}>拒绝</button></span>
        </div>)}
      </div> : <div className={css['empty']}>没有待审核候选。会话沉淀中值得长期保存的内容会先进入这里，经确认后才参与召回。</div>}

      {episodes.length > 0 ? <div className={css['memoryTable']} data-cols="4">
        <div className={css['memoryTableHead']}><span>任务复盘</span><span>结果</span><span>工具</span><span>时间</span></div>
        {episodes.slice(0, 8).map((episode) => <div key={episode.id} className={css['memoryTableRow']}>
          <span className={css['memoryDocTitle']} title={episode.summary + (episode.lessons.length > 0 ? '｜教训：' + episode.lessons.join('；') : '')}>{episode.goal !== '' ? episode.goal : episode.summary.slice(0, 60)}{episode.lessons.length > 0 ? '（教训 ' + episode.lessons.length + ' 条）' : ''}</span>
          <span className={css['categoryBadge']}>{OUTCOME_LABELS[episode.outcome] ?? episode.outcome}</span>
          <span className={css['nativeTime']}>{episode.toolNames.length > 0 ? episode.toolNames.slice(0, 3).join('、') + (episode.toolNames.length > 3 ? ' 等' : '') : '无工具'} · {episode.usedMemoryIds.length > 0 ? '用记忆 ' + episode.usedMemoryIds.length : ''}</span>
          <span className={css['nativeTime']}>{fmtTime(episode.createdAt)}</span>
        </div>)}
      </div> : <div className={css['empty']}>暂无任务复盘。开启自动沉淀后，每轮完成都会记录结构化复盘。</div>}

      {recalls.length > 0 ? <div className={css['memoryTable']} data-cols="4">
        <div className={css['memoryTableHead']}><span>召回轨迹（可反馈）</span><span>结果</span><span>命中</span><span>时间</span></div>
        {recalls.slice(0, 6).map((trace) => <div key={trace.id} className={css['memoryTableRow']}>
          <span className={css['memoryDocTitle']} title={trace.queryPreview}>{trace.queryPreview || '（空查询）'}</span>
          <span className={css['categoryBadge']}>{trace.outcome}{trace.degradedLayers.length > 0 ? ' · 降级' : ''} · {trace.latencyMs}ms</span>
          <span className={css['nativeTime']}>{trace.hits.filter((hit) => hit.included).length} 条注入
            {trace.hits.filter((hit) => hit.included && hit.layer !== 'mirror').slice(0, 2).map((hit) => <span key={hit.entryId} className={css['inlineActions']}><button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void feedback(trace.id, hit.entryId, 'useful') }}>有用</button><button type="button" className={css['dangerButton']} disabled={busy} onClick={() => { void feedback(trace.id, hit.entryId, 'incorrect') }}>有错</button></span>)}
          </span>
          <span className={css['nativeTime']}>{fmtTime(trace.createdAt)}</span>
        </div>)}
      </div> : <div className={css['empty']}>暂无召回轨迹。每轮自动注入都会记录查询、命中与降级原因。</div>}

      {archived.length > 0 ? <div className={css['memoryTable']} data-cols="3">
        <div className={css['memoryTableHead']}><span>归档（可恢复）</span><span>状态</span><span>操作</span></div>
        {archived.slice(0, 8).map((entry) => <div key={entry.id} className={css['memoryTableRow']}>
          <span className={css['memoryDocTitle']} title={entry.content}>{entry.content}</span>
          <span className={css['categoryBadge']}>{entry.state === 'archived' ? '人工归档' : entry.state === 'quarantined' ? '已隔离' : '已取代'}</span>
          <span>{entry.state === 'archived' ? <button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void restore(entry.id) }}>恢复</button> : <span className={css['nativeTime']}>需先处理冲突或修订</span>}</span>
        </div>)}
      </div> : null}
    </section>
  )
}
