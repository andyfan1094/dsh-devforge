/**
 * 记忆管家卡片：价值预演 + 一键整理 + 误删恢复。
 *
 * 设计取向：所有自动化动作都必须先看得见再执行。
 * 预演列表逐条给出「为什么该淘汰」的原因，用户点确认才落库；
 * 落库也只是软归档，旁边永远留着「恢复」入口。
 */
import { useCallback, useEffect, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { CuratorPlan, CuratorRunSummary, CuratorScore } from '../../memory/curator.ts'
import css from './panel.module.css'

/** 分类中文名（与治理卡片口径一致）。 */
const CATEGORY_LABELS: Record<string, string> = {
  preference: '偏好', decision: '决策', fact: '事实', insight: '洞察', context: '上下文', general: '通用',
}

function scoreTone(score: number): 'error' | 'warning' | 'succeeded' {
  if (score < 25) return 'error'
  if (score < 40) return 'warning'
  return 'succeeded'
}

/** 只把扣分/关键理由显示出来，避免每行塞满加分明细。 */
function shortReasons(item: CuratorScore): string {
  const keep = item.reasons.filter((line) => !line.includes('+0）') && !line.includes('（+'))
  const chosen = keep.length > 0 ? keep : item.reasons
  return chosen.slice(0, 3).join('；')
}

export function MemoryCuratorCard({ api }: { api: DevforgeApi }): JSX.Element {
  const [plan, setPlan] = useState<CuratorPlan | null>(null)
  const [summary, setSummary] = useState<CuratorRunSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [open, setOpen] = useState(false)
  const [selectedEvict, setSelectedEvict] = useState<Set<string>>(new Set())
  const [restoreIds, setRestoreIds] = useState('')

  const load = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const next = await api.getMemoryCuratorPlan()
      setPlan(next)
      // 默认全选建议项：绝大多数时候用户就是想"按建议清一批"
      setSelectedEvict(new Set(next.evict.map((item) => item.id)))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [api])

  useEffect(() => { void load() }, [load])

  const toggle = (id: string): void => {
    setSelectedEvict((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const apply = (mergeToo: boolean): void => {
    void (async () => {
      setBusy(true)
      setError('')
      setNotice('')
      try {
        const result = await api.runMemoryCurator({
          dryRun: false,
          evict: [...selectedEvict],
          ...(mergeToo ? {} : { merge: [] }),
        })
        setSummary(result.summary)
        setNotice('已归档 ' + result.summary.evicted + ' 条，合并 ' + result.summary.mergedGroups + ' 组（' + result.summary.mergedEntries + ' 条）' + (result.summary.errors.length > 0 ? '；失败 ' + result.summary.errors.length + ' 条' : ''))
        await load()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setBusy(false)
      }
    })()
  }

  const restore = (): void => {
    const ids = restoreIds.split(/[\s,，]+/u).map((id) => id.trim()).filter((id) => id !== '')
    if (ids.length === 0) return
    void (async () => {
      setBusy(true)
      setError('')
      try {
        const count = await api.restoreCuratedMemory(ids)
        setNotice('已恢复 ' + count + ' 条')
        setRestoreIds('')
        await load()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setBusy(false)
      }
    })()
  }

  const evictCount = plan?.evict.length ?? 0
  const mergeCount = plan?.merge.length ?? 0
  const overBy = plan?.overCapacity ?? 0

  return (
    <section className={css['memoryPanel']}>
      <div className={css['panelHeading']}>
        <div>
          <h3 className={css['sectionTitle']}>记忆管家</h3>
          <p className={css['sectionHint']}>
            按使用价值自动整理：留下被用过的、归档从没用过的、同类合并成一条。
            淘汰只做归档，随时可恢复；钉选、身份设定、带记忆键的事实槽位永不触碰。
          </p>
        </div>
        <span className={css['inlineActions']}>
          <span className={css['badge']} data-status={overBy > 0 ? 'warning' : 'succeeded'}>
            {plan === null ? '—' : plan.liveCount + ' 条 / 上限 ' + (plan.maxEntries === 0 ? '不限' : plan.maxEntries)}
          </span>
          <button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void load() }}>重新评估</button>
          <button type="button" className={css['ghostButton']} onClick={() => setOpen((value) => !value)}>{open ? '收起' : '查看建议'}</button>
        </span>
      </div>

      {plan !== null && (
        <div className={css['govStats']}>
          <div><strong>{plan.liveCount}</strong><span>活跃记忆</span></div>
          <div><strong>{plan.protectedCount}</strong><span>受保护</span></div>
          <div><strong>{plan.zeroAccess}</strong><span>从未被召回</span></div>
          <div><strong>{plan.averageScore}</strong><span>平均价值分</span></div>
          <div><strong>{evictCount}</strong><span>建议归档</span></div>
          <div><strong>{mergeCount}</strong><span>建议合并</span></div>
        </div>
      )}

      {overBy > 0 && (
        <p className={css['sectionHint']}>
          已超出库容上限 {overBy} 条：开启「自动止损」后，管家会在每次巡检时把这部分最差的条目归档。
        </p>
      )}
      {error !== '' && <p className={css['sectionHint']} data-status="error">操作失败：{error}</p>}
      {notice !== '' && <p className={css['sectionHint']}>{notice}</p>}

      {open && plan !== null && (
        <div className={css['govBoard']}>
          <div className={css['govColumn']}>
            <h4 className={css['sectionTitle']}>建议归档（{evictCount}）</h4>
            {evictCount === 0
              ? <div className={css['govEmpty']}><span>没有需要归档的条目：库里的记忆都还被用着，或处在保护期内。</span></div>
              : <div className={css['govCandidateList']}>
                {plan.evict.map((item) => (
                  <div key={item.id} className={css['govCandidate']}>
                    <div className={css['govCandidateMain']}>
                      <label className={css['govCandidateText']}>
                        <input type="checkbox" checked={selectedEvict.has(item.id)} disabled={busy} onChange={() => toggle(item.id)} /> {item.preview}
                      </label>
                      <span className={css['govCandidateMeta']}>
                        <span className={css['categoryBadge']}>{CATEGORY_LABELS[item.category] ?? item.category}</span>
                        <span className={css['badge']} data-status={scoreTone(item.score)}>{item.score} 分</span>
                        <span className={css['sectionHint']}>{shortReasons(item)}</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>}
          </div>

          <div className={css['govColumn']}>
            <h4 className={css['sectionTitle']}>建议合并（{mergeCount} 组）</h4>
            {mergeCount === 0
              ? <div className={css['govEmpty']}><span>没有高度重复的同类记忆。宁可不合并，也不把两条不同事实揉成一条。</span></div>
              : <div className={css['govCandidateList']}>
                {plan.merge.map((group) => (
                  <div key={group.keeperId} className={css['govCandidate']}>
                    <div className={css['govCandidateMain']}>
                      <span className={css['govCandidateText']}>{group.preview}</span>
                      <span className={css['govCandidateMeta']}>
                        <span className={css['badge']} data-status="succeeded">相似度 {group.similarity}</span>
                        <span className={css['sectionHint']}>合并 {group.loserIds.length} 条为 1 条，补充事实会拼进新条目</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>}
          </div>
        </div>
      )}

      <div className={css['inlineActions']}>
        <button type="button" className={css['primaryButton']} disabled={busy || (selectedEvict.size === 0 && mergeCount === 0)} onClick={() => apply(true)}>
          {busy ? '处理中…' : '执行归档 + 合并'}
        </button>
        <button type="button" className={css['ghostButton']} disabled={busy || selectedEvict.size === 0} onClick={() => apply(false)}>只归档勾选</button>
      </div>

      <div className={css['inlineActions']}>
        <input
          className={css['govCandidateText']}
          placeholder="误被归档？粘贴条目 id（多个用空格或逗号分隔）后恢复"
          value={restoreIds}
          onChange={(event) => setRestoreIds(event.target.value)}
        />
        <button type="button" className={css['ghostButton']} disabled={busy || restoreIds.trim() === ''} onClick={restore}>恢复</button>
      </div>

      {summary !== null && (
        <p className={css['sectionHint']}>
          最近一次执行：扫描 {summary.scanned} 条，保护 {summary.protectedCount} 条，归档 {summary.evicted} 条，
          合并 {summary.mergedGroups} 组（{summary.mergedEntries} 条）{summary.errors.length > 0 ? '，失败 ' + summary.errors.length + ' 条' : ''}
        </p>
      )}
    </section>
  )
}
