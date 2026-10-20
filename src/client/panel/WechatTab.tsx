/**
 * 微信面板 —— 天工造梦操作台「微信」页签。
 *
 * 数据来自 wx-auto 控制台落盘的 SQLite（/api/dsh-devforge/wechat/snapshot），
 * 发送经同源代理转发到 wx-auto（/api/dsh-devforge/wechat/send），本页不直接连微信。
 *
 * 交互契约：
 * - 左侧会话列表可点选，右侧只看该会话的消息；
 * - 顶部显示 wx-auto 与微信进程的实时状态（在线 / 离线 / PID）；
 * - 底部输入框发送消息，发送期间禁用并给出结果提示。
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

/** 时间戳 → MM-DD HH:mm。 */
function fmtTime(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 长文本压缩成单行预览。 */
function preview(text: string, max = 32): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max) + '…' : flat
}

export function WechatTab() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const res = await fetch('/api/dsh-devforge/wechat/snapshot', { cache: 'no-store' })
      const data = (await res.json()) as { ok: boolean; snapshot?: Snapshot; error?: string }
      if (!data.ok || !data.snapshot) {
        setError(data.error ?? '读取失败')
        return
      }
      const snap = data.snapshot
      setSnapshot(snap)
      setError(snap.ok ? '' : (snap.error ?? ''))
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
    const timer = window.setInterval(() => {
      void load(true)
    }, 6000)
    return () => window.clearInterval(timer)
  }, [load])

  /** 当前会话的消息。 */
  const messages = useMemo(() => {
    if (!snapshot) return []
    return snapshot.messages.filter((m) => m.session === selected)
  }, [snapshot, selected])

  const current = snapshot?.sessions.find((s) => s.session === selected)

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

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages.length])

  return (
    <div>
      {/* 顶部：状态 + 刷新 */}
      <div className={css['toolbar']}>
        <span className={css['connectionDot']} data-online={snapshot?.online ? '' : undefined} />
        <strong>{snapshot?.online ? '控制台在线' : '控制台离线'}</strong>
        <span className={css['mutedText']}>
          {snapshot?.online
            ? `微信进程 ${snapshot.wechatPid ?? '—'} · 联系人 ${snapshot.stats.contacts} · 群 ${snapshot.stats.groups} · 消息 ${snapshot.stats.messages}`
            : 'wx-auto 控制台（127.0.0.1:8765）未运行，数据为最近一次写入的库内容'}
        </span>
        <span className={css['toolbarSpacer']} />
        <button type="button" className={css['ghostButton']} onClick={() => void load()} disabled={loading}>
          {loading ? '读取中…' : '刷新'}
        </button>
      </div>

      {(error !== '' || notice !== '') && <div className={css['banner']}>{error !== '' ? error : notice}</div>}

      {snapshot === null && <div className={css['empty']}>正在读取微信数据…</div>}
      {snapshot !== null && snapshot.sessions.length === 0 && (
        <div className={css['empty']}>库里还没有消息。先启动 wx-auto 控制台并等微信收到一条消息。</div>
      )}

      {snapshot !== null && snapshot.sessions.length > 0 && (
        <div className={css['dbAdminLayout']}>
          {/* 会话列表 */}
          <aside className={css['dbAdminSidebar']}>
            <div className={css['sectionTitle']}>会话</div>
            <div style={{ display: 'grid', gap: 2, overflowY: 'auto', maxHeight: 520 }}>
              {snapshot.sessions.map((s) => (
                <button
                  key={s.session}
                  type="button"
                  className={css['dbAdminTableItem']}
                  data-active={s.session === selected ? '' : undefined}
                  onClick={() => setSelected(s.session)}
                  style={{ textAlign: 'left', width: '100%' }}
                  title={s.lastText}
                >
                  <span className={css['dbAdminTableName']}>{s.name}</span>
                  <span className={css['dbAdminTableCount']}>{s.isGroup ? '群' : '私'}</span>
                </button>
              ))}
            </div>
          </aside>

          {/* 消息区 */}
          <main className={css['dbAdminMain']}>
            <div className={css['sectionHeader']}>
              <span className={css['sectionTitle']}>{current?.name ?? '选择会话'}</span>
              {current && <span className={css['sectionHint']}>{messages.length} 条消息</span>}
            </div>

            <div ref={listRef} style={{ overflowY: 'auto', maxHeight: 420, display: 'grid', gap: 6, paddingRight: 4 }}>
              {messages.length === 0 && <div className={css['empty']}>这个会话还没有消息</div>}
              {messages.map((m) => (
                <div
                  key={m.id}
                  style={{
                    display: 'grid',
                    gap: 2,
                    padding: '7px 10px',
                    borderRadius: 6,
                    background: m.kind === 'sent' ? 'rgba(120,180,255,.10)' : 'rgba(255,255,255,.04)',
                  }}
                >
                  <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{m.kind === 'sent' ? '我' : (m.sender_name || m.sender || '对方')}</span>
                    <span className={css['mutedText']} style={{ marginLeft: 'auto', fontSize: 11 }}>{fmtTime(m.ts)}</span>
                  </div>
                  <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {m.text.length > 400 ? m.text.slice(0, 400) + '…' : m.text}
                  </div>
                </div>
              ))}
            </div>

            {/* 发送区 */}
            <div className={css['toolbar']} style={{ marginTop: 10 }}>
              <input
                className={css['input']}
                style={{ flex: 1 }}
                placeholder={snapshot.online ? '输入消息，回车发送（发到当前选中会话）' : '控制台离线，无法发送'}
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
            <div className={css['sectionHint']} style={{ marginTop: 6 }}>
              发送会短暂抢占微信窗口焦点 · 库文件 {snapshot.dbPath}
            </div>
          </main>
        </div>
      )}
    </div>
  )
}
