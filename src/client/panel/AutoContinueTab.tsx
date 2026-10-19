/**
 * 失败自动续跑设置页（0.62.0）。
 *
 * 为什么需要这一页：DSH 一轮跑失败（GUI 显示「本轮运行失败」）后不会自己接着干，
 * 用户得手动再发一条消息。本页打开后，模型报错时会由插件自动补发一条「继续」。
 *
 * 版面：
 * - 页头徽章回答"现在开没开"；
 * - 卡片一放规则（开关、补发正文、连续上限、延迟）；
 * - 卡片二放运行统计——「配了」和「真的补发过」是两件事，必须有计数区分；
 * - 卡片三把边界写清楚（哪些失败不补、哪些会话不管），避免用户以为功能坏了。
 *
 * 交互约定：开关勾选即存；正文/上限/延迟是输入框，改完点「保存规则」，避免每个字符都写库。
 */
import { useEffect, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { AutoContinueSettings, AutoContinueStats } from '../../auto-continue/protocol.ts'
import css from './panel.module.css'

/** 时间戳 → 本地可读时间；0 显示「从未」。 */
function whenText(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return '从未'
  try { return new Date(at).toLocaleString('zh-CN', { hour12: false }) } catch { return String(at) }
}

/** 连续补发上限的候选值：0 等于关闭自动补发，保留以便用户临时停用而不动总开关。 */
const ATTEMPT_OPTIONS = [0, 1, 2, 3, 4, 5] as const

export function AutoContinueTab({ api }: { api: DevforgeApi }): JSX.Element {
  const [settings, setSettings] = useState<AutoContinueSettings | null>(null)
  const [stats, setStats] = useState<AutoContinueStats | null>(null)
  const [textDraft, setTextDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  /** 保存成功的一次性反馈：面板无 toast 通道，就地给一行提示。 */
  const [saved, setSaved] = useState(false)

  const refresh = async (): Promise<void> => {
    try {
      setLoading(true); setError('')
      const next = await api.getAutoContinueStatus()
      setSettings(next.settings)
      setStats(next.stats)
      setTextDraft(next.settings.text)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])

  /** 统一保存动作：失败把原因摆到页面上，成功给一行「已保存」。 */
  const save = async (patch: Partial<AutoContinueSettings>): Promise<void> => {
    if (busy) return
    try {
      setBusy(true); setError(''); setSaved(false)
      const next = await api.putAutoContinueSettings(patch)
      setSettings(next.settings)
      setStats(next.stats)
      setTextDraft(next.settings.text)
      setSaved(true)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const enabled = settings?.enabled === true
  const dirty = settings !== null && textDraft.trim() !== settings.text

  return (
    <section className={css['tabBody']} data-dsh-part="auto-continue">
      <div className={css['toolbar']}>
        <strong className={css['panelTitle']}>失败自动续跑</strong>
        <span className={css['badge']} data-status={enabled ? 'running' : 'idle'}>{enabled ? '已开启' : '已关闭'}</span>
        <span className={css['sectionHint']}>模型报错后自动补一条「继续」</span>
        {saved && <span className={css['sectionHint']}>已保存</span>}
        <button type="button" className={css['ghostButton']} disabled={loading || busy} onClick={() => { void refresh() }}>刷新</button>
      </div>

      {error !== '' && <div className={css['banner']} data-kind="error">{error}</div>}

      {/* 卡片一 · 规则 */}
      <div className={css['formGrid']} data-layout="stacked" data-dsh-part="auto-continue-rules">
        <div className={css['surfaceHeader']}>
          <h3 className={css['sectionTitle']}>续跑规则</h3>
        </div>
        <p className={css['subtleText']}>
          一轮以「模型报错」结束时（GUI 上的「本轮运行失败」），插件替你补发一条消息并开启新一轮。
          默认只补一次：补完的那一轮如果再失败就停手，不会连环烧额度。
        </p>

        <div className={css['field']}>
          <label className={css['checkLabel']}>
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy || settings === null}
              onChange={(event) => { void save({ enabled: event.target.checked }) }}
            />
            启用失败自动续跑
          </label>
          <span className={css['mutedText']}>勾选即存，下一轮失败立即生效，不用重启。</span>
        </div>

        <div className={css['field']}>
          <label className={css['fieldLabel']} htmlFor="auto-continue-text">补发的正文</label>
          <span className={css['inlineAction']}>
            <input
              id="auto-continue-text"
              type="text"
              value={textDraft}
              maxLength={200}
              disabled={busy || settings === null}
              placeholder="继续"
              onChange={(event) => { setTextDraft(event.target.value) }}
            />
            <button
              type="button"
              className={css['ghostButton']}
              disabled={busy || !dirty || textDraft.trim() === ''}
              onClick={() => { void save({ text: textDraft.trim() }) }}
            >
              保存正文
            </button>
          </span>
          <span className={css['mutedText']}>留空无效：空正文会被回退成「继续」，不会发一条空白消息。</span>
        </div>

        <div className={css['field']} data-width="short">
          <label className={css['fieldLabel']} htmlFor="auto-continue-max">同一会话连续补发上限</label>
          <select
            id="auto-continue-max"
            value={String(settings?.maxAttempts ?? 1)}
            disabled={busy || settings === null}
            onChange={(event) => { void save({ maxAttempts: Number(event.target.value) }) }}
          >
            {ATTEMPT_OPTIONS.map((value) => (
              <option key={value} value={String(value)}>
                {value === 0 ? '0（不自动补发）' : value === 1 ? '1 次（推荐）' : value + ' 次'}
              </option>
            ))}
          </select>
          <span className={css['mutedText']}>
            连续失败计数在一轮正常完成后清零；一轮补完又失败就累计，达到上限不再补。
          </span>
        </div>

        <div className={css['field']} data-width="short">
          <label className={css['fieldLabel']} htmlFor="auto-continue-delay">补发前等待（秒）</label>
          <select
            id="auto-continue-delay"
            value={String(Math.round((settings?.delayMs ?? 3000) / 1000))}
            disabled={busy || settings === null}
            onChange={(event) => { void save({ delayMs: Number(event.target.value) * 1000 }) }}
          >
            {[0, 1, 3, 5, 10, 30].map((value) => (
              <option key={value} value={String(value)}>{value} 秒</option>
            ))}
          </select>
          <span className={css['mutedText']}>
            上游限流、网关抖动这类瞬态故障，等几秒再补成功率更高；等待期间关掉开关或结束会话都不会补。
          </span>
        </div>
      </div>

      {/* 卡片二 · 运行统计 */}
      <div className={css['formGrid']} data-layout="stacked" data-dsh-part="auto-continue-stats">
        <h3 className={css['sectionTitle']}>运行统计</h3>
        <p className={css['subtleText']}>进程内计数，DSH 重启清零；用来区分「配了但没遇到失败」和「真的补发过」。</p>
        <p className={css['subtleText']}>
          已补发 <strong>{stats?.attemptCount ?? 0}</strong> 次 · 跳过 <strong>{stats?.skipCount ?? 0}</strong> 次
          · 最近补发：{whenText(stats?.lastAt ?? 0)}
        </p>
        {stats !== null && stats.lastSessionId !== '' && (
          <p className={css['subtleText']}>最近补发会话：<code>{stats.lastSessionId}</code> · 正文「{stats.lastText}」</p>
        )}
        {(stats?.lastSkipReason ?? '') !== '' && (
          <p className={css['subtleText']}>最近一次跳过原因：{stats?.lastSkipReason}</p>
        )}
        {(stats?.lastError ?? '') !== '' && (
          <div className={css['banner']} data-kind="warning">最近一次补发失败：{stats?.lastError}</div>
        )}
      </div>

      {/* 卡片三 · 边界 */}
      <div className={css['formGrid']} data-layout="stacked" data-dsh-part="auto-continue-scope">
        <h3 className={css['sectionTitle']}>生效范围</h3>
        <p className={css['subtleText']}>
          只处理本机 GUI 会话里的「模型报错」。以下情况一律不自动补发：你主动点了停止、会话被系统中断、
          输出被截断（max-tokens）、被策略拦截；飞书桥的独立会话与子代理会话也不接管，避免重复打扰和额外费用。
        </p>
        <p className={css['subtleText']}>
          补发的消息来源标记为天工造梦（不是冒充你发言），内容就是上面那条正文，会正常进入会话历史。
        </p>
      </div>
    </section>
  )
}
