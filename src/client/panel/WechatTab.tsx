/**
 * 微信面板 —— 天工造梦操作台「微信」页签。
 *
 * 三块能力：
 * 1. 会话浏览：左栏会话（头像 + 名字 + 预览），右栏消息流；
 * 2. 手动发送：底部输入框，回车即发到当前会话；
 * 3. AI 自动回复：顶部开关，打开后微信收到私聊消息由模型自动应答。
 *
 * 数据与动作全部走同源路由（/api/dsh-devforge/wechat/*），不直连微信进程。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import css from './panel.module.css'

interface Snapshot {
  ok: boolean
  dbPath: string
  dbExists: boolean
  online: boolean
  wechatPid: number | null
  error?: string
  stats: { contacts: number; groups: number; messages: number }
  contacts: Array<{ wxid: string; nickname: string; remark: string; alias: string }>
  groups: Array<{ gid: string; name: string }>
  messages: Array<{
    id: number
    session: string
    session_name: string
    sender: string
    sender_name: string
    text: string
    ts: number
    kind: string
    is_group: number
  }>
  sessions: Array<{ session: string; name: string; lastText: string; lastTs: number; isGroup: boolean }>
}

interface BotState {
  enabled: boolean
  replied: number
  pending: number
  lastError: string
  lastActivity: number
}

/** 时间戳 → 今天 HH:mm / MM-DD HH:mm。 */
function fmtTime(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (d.toDateString() === now.toDateString()) return hm
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`
}

/** 首字母/首字，用作头像。 */
function initial(name: string): string {
  const trimmed = name.trim()
  if (trimmed === '') return '?'
  return /^[A-Za-z]/.test(trimmed) ? trimmed[0]!.toUpperCase() : trimmed[0]!
}

export function WechatTab() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [bot, setBot] = useState<BotState | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [busyService, setBusyService] = useState(false)
  const [busyBot, setBusyBot] = useState(false)
  const [search, setSearch] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const [snapRes, botRes] = await Promise.all([
        fetch('/api/dsh-devforge/wechat/snapshot', { cache: 'no-store' }),
        fetch('/api/dsh-devforge/wechat/bot', { cache: 'no-store' }),
      ])
      const snapData = (await snapRes.json()) as { ok: boolean; snapshot?: Snapshot; error?: string }
      const botData = (await botRes.json()) as { ok: boolean; bot?: BotState }
      if (!snapData.ok || !snapData.snapshot) {
        setError(snapData.error ?? '读取失败')
        return
      }
      const snap = snapData.snapshot
      setSnapshot(snap)
      setError(snap.ok ? '' : (snap.error ?? ''))
      if (botData.ok && botData.bot) setBot(botData.bot)
      setSelected((current) => {
        if (current !== '' && snap.sessions.some((s) => s.session === current)) return current
        return snap.sessions[0]?.session ?? ''
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => { void load(true) }, 6000)
    return () => window.clearInterval(timer)
  }, [load])

  /** 按搜索词过滤会话。 */
  const sessions = useMemo(() => {
    if (!snapshot) return []
    const q = search.trim().toLowerCase()
    if (q === '') return snapshot.sessions
    return snapshot.sessions.filter((s) => s.name.toLowerCase().includes(q) || s.lastText.toLowerCase().includes(q))
  }, [snapshot, search])

  const messages = useMemo(() => {
    if (!snapshot) return []
    return snapshot.messages.filter((m) => m.session === selected)
  }, [snapshot, selected])

  const current = snapshot?.sessions.find((s) => s.session === selected)

  /** 发送消息。 */
  const send = useCallback(async () => {
    const text = draft.trim()
    if (text === '' || sending) return
    setSending(true)
    setNotice('')
    try {
      const res = await fetch('/api/dsh-devforge/wechat/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, session: selected }),
      })
      const data = (await res.json()) as { ok: boolean; error?: string }
      if (!data.ok) {
        setNotice('发送失败：' + (data.error ?? '未知错误'))
      } else {
        setDraft('')
        setNotice('已发送')
        window.setTimeout(() => void load(true), 1200)
      }
    } catch (e) {
      setNotice('发送失败：' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSending(false)
      window.setTimeout(() => setNotice(''), 4000)
    }
  }, [draft, selected, sending, load])

  /** 启停 wx-auto 控制台。 */
  const controlService = useCallback(async (action: 'start' | 'stop') => {
    setBusyService(true)
    setNotice(action === 'start' ? '正在启动控制台…' : '正在停止…')
    try {
      const res = await fetch('/api/dsh-devforge/wechat/service', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = (await res.json()) as { ok: boolean; message?: string; error?: string }
      setNotice(data.message ?? data.error ?? (data.ok ? '完成' : '操作失败'))
      window.setTimeout(() => void load(true), 1000)
    } catch (e) {
      setNotice('操作失败：' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setBusyService(false)
      window.setTimeout(() => setNotice(''), 5000)
    }
  }, [load])

  /** 启停 AI 自动回复。 */
  const controlBot = useCallback(async (action: 'start' | 'stop') => {
    setBusyBot(true)
    setNotice(action === 'start' ? '正在开启 AI 自动回复…' : '正在关闭…')
    try {
      const res = await fetch('/api/dsh-devforge/wechat/bot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = (await res.json()) as { ok: boolean; bot?: BotState; error?: string }
      if (data.ok && data.bot) setBot(data.bot)
      setNotice(data.ok ? (action === 'start' ? 'AI 自动回复已开启（仅私聊）' : 'AI 自动回复已关闭') : (data.error ?? '操作失败'))
    } catch (e) {
      setNotice('操作失败：' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setBusyBot(false)
      window.setTimeout(() => setNotice(''), 5000)
    }
  }, [])

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages.length, selected])

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {/* 顶部状态条 */}
      <div className={css['toolbar']} style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className={css['connectionDot']} data-online={snapshot?.online ? '' : undefined} />
        <strong style={{ fontSize: 13 }}>{snapshot?.online ? '在线' : '离线'}</strong>
        <span className={css['mutedText']} style={{ fontSize: 12 }}>
          {snapshot?.online ? `托管中 · 微信 ${snapshot.wechatPid ?? '—'} · ${snapshot.stats.contacts} 联系人 · ${snapshot.stats.messages} 消息` : '控制台未运行'}
        </span>
        <span className={css['toolbarSpacer']} />
        {bot?.enabled ? (
          <span className={css['badge']} title={`已回复 ${bot.replied} 条${bot.pending > 0 ? `，等待中 ${bot.pending}` : ''}`}>
            AI 已开 · {bot.replied} 回复
          </span>
        ) : (
          <span className={css['mutedText']} style={{ fontSize: 12 }}>AI 关</span>
        )}
        <button
          type="button"
          className={bot?.enabled ? css['dangerButton'] : css['primaryButton']}
          disabled={busyBot || !snapshot?.online}
          onClick={() => void controlBot(bot?.enabled ? 'stop' : 'start')}
          title="自动回复微信私聊消息（群聊不回复）"
        >
          {busyBot ? '…' : bot?.enabled ? '关 AI' : '开 AI'}
        </button>
        {!snapshot?.online && (
          <button type="button" className={css['ghostButton']} disabled={busyService} onClick={() => void controlService('start')}>
            启动控制台
          </button>
        )}
        <button type="button" className={css['ghostButton']} onClick={() => void load()} disabled={loading}>
          {loading ? '读取中…' : '刷新'}
        </button>
      </div>

      {(error !== '' || notice !== '') && <div className={css['banner']}>{error !== '' ? error : notice}</div>}

      {bot?.lastError && bot.lastError !== '' && (
        <div className={css['banner']} style={{ fontSize: 12 }}>AI 最近错误：{bot.lastError}</div>
      )}

      {snapshot === null && <div className={css['empty']}>正在读取微信数据…</div>}
      {snapshot !== null && snapshot.sessions.length === 0 && (
        <div className={css['empty']}>库里还没有消息。等微信收到一条消息，或点「启动控制台」。</div>
      )}

      {snapshot !== null && snapshot.sessions.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 280px) minmax(0, 1fr)', gap: 12, minHeight: 420 }}>
          {/* 会话栏 */}
          <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', gap: 8, alignContent: 'start' }}>
            <input
              className={css['input']}
              placeholder="搜索会话"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div style={{ display: 'grid', gap: 2, overflowY: 'auto', maxHeight: 460, alignContent: 'start' }}>
              {sessions.map((s) => (
                <button
                  key={s.session}
                  type="button"
                  onClick={() => setSelected(s.session)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '32px 1fr auto',
                    gap: 8,
                    alignItems: 'center',
                    padding: '7px 8px',
                    border: 'none',
                    borderRadius: 7,
                    cursor: 'pointer',
                    textAlign: 'left',
                    background: s.session === selected ? 'rgba(120,180,255,.14)' : 'transparent',
                    color: 'inherit',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      display: 'grid',
                      placeItems: 'center',
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: s.isGroup ? 'rgba(255,190,90,.20)' : 'rgba(120,180,255,.20)',
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    {initial(s.name)}
                  </span>
                  <span style={{ display: 'grid', gap: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                    <span className={css['mutedText']} style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.lastText.replace(/\s+/g, ' ').slice(0, 28)}
                    </span>
                  </span>
                  <span className={css['mutedText']} style={{ fontSize: 10 }}>{fmtTime(s.lastTs)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 消息区 */}
          <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr auto', gap: 8, minWidth: 0 }}>
            <div className={css['sectionHeader']} style={{ margin: 0 }}>
              <span className={css['sectionTitle']}>{current?.name ?? '选择会话'}</span>
              {current && <span className={css['sectionHint']}>{messages.length} 条</span>}
            </div>

            <div
              ref={listRef}
              style={{
                overflowY: 'auto',
                maxHeight: 400,
                display: 'grid',
                gap: 8,
                paddingRight: 6,
                alignContent: 'start',
              }}
            >
              {messages.length === 0 && <div className={css['empty']}>这个会话还没有消息</div>}
              {messages.map((m) => {
                const mine = m.kind === 'sent'
                return (
                  <div key={m.id} style={{ display: 'flex', flexDirection: mine ? 'row-reverse' : 'row', gap: 8, alignItems: 'flex-end' }}>
                    <span
                      aria-hidden="true"
                      style={{
                        display: 'grid',
                        placeItems: 'center',
                        width: 26,
                        height: 26,
                        borderRadius: 7,
                        fontSize: 11,
                        fontWeight: 600,
                        flexShrink: 0,
                        background: mine ? 'rgba(120,180,255,.25)' : 'rgba(255,255,255,.10)',
                      }}
                    >
                      {initial(mine ? '我' : (m.sender_name || m.sender || '对方'))}
                    </span>
                    <div style={{ display: 'grid', gap: 3, maxWidth: '72%' }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                        <span style={{ fontSize: 11, fontWeight: 600 }}>{mine ? '我' : (m.sender_name || m.sender || '对方')}</span>
                        <span className={css['mutedText']} style={{ fontSize: 10 }}>{fmtTime(m.ts)}</span>
                      </div>
                      <div
                        style={{
                          padding: '7px 11px',
                          borderRadius: 9,
                          fontSize: 13,
                          lineHeight: '1.55',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          background: mine ? 'rgba(120,180,255,.14)' : 'rgba(255,255,255,.06)',
                          border: '1px solid ' + (mine ? 'rgba(120,180,255,.22)' : 'rgba(255,255,255,.07)'),
                        }}
                      >
                        {m.text.length > 500 ? m.text.slice(0, 500) + '…' : m.text}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* 输入区 */}
            <div className={css['toolbar']} style={{ margin: 0 }}>
              <input
                className={css['input']}
                style={{ flex: 1 }}
                placeholder={snapshot.online ? '输入消息，回车发送' : '控制台离线，无法发送'}
                value={draft}
                disabled={!snapshot.online || sending}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    void send()
                  }
                }}
              />
              <button
                type="button"
                className={css['primaryButton']}
                disabled={!snapshot.online || sending || draft.trim() === ''}
                onClick={() => void send()}
              >
                {sending ? '发送中…' : '发送'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
