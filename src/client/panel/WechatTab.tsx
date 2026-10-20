/**
 * 微信面板 —— 天工造梦操作台「微信」页签。
 *
 * 展示 wx-auto 控制台落盘的 SQLite 内容：联系人、群、消息与会话。
 * 数据来源是 /api/dsh-devforge/wechat/snapshot（只读本机 wechat.db），
 * 本页不直接连接微信，也不做任何写入。
 */
import { useCallback, useEffect, useState } from 'react'
import css from './panel.module.css'

interface Snapshot {
  ok: boolean
  dbPath: string
  dbExists: boolean
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

function fmtTime(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function WechatTab() {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/dsh-devforge/wechat/snapshot', { cache: 'no-store' })
      const data = (await res.json()) as { ok: boolean; snapshot?: Snapshot; error?: string }
      if (!data.ok || !data.snapshot) {
        setError(data.error ?? '读取失败')
      } else {
        setSnap(data.snapshot)
        setError(data.snapshot.ok ? '' : (data.snapshot.error ?? ''))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>微信消息</h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          style={{
            padding: '5px 12px',
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,.18)',
            background: 'rgba(255,255,255,.06)',
            color: 'inherit',
            cursor: loading ? 'default' : 'pointer',
            fontSize: 13,
          }}
        >
          {loading ? '读取中…' : '刷新'}
        </button>
        {snap && (
          <span style={{ opacity: 0.6, fontSize: 12 }}>
            库：{snap.dbPath}
          </span>
        )}
      </div>

      {error && (
        <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(220,60,60,.12)', fontSize: 13 }}>
          {error}
        </div>
      )}

      {snap && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 12 }}>
            {[
              ['联系人', snap.stats.contacts],
              ['群', snap.stats.groups],
              ['消息', snap.stats.messages],
            ].map(([label, value]) => (
              <div key={String(label)} style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--dsh-surface, rgba(255,255,255,.04))' }}>
                <div style={{ fontSize: 12, opacity: 0.65 }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 300px) minmax(0,1fr)', gap: 16 }}>
            <div>
              <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>会话</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {snap.sessions.length === 0 && <div style={{ opacity: 0.5, fontSize: 13 }}>暂无会话</div>}
                {snap.sessions.map((s) => (
                  <div key={s.session} style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--dsh-surface, rgba(255,255,255,.04))' }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div>
                    <div style={{ fontSize: 12, opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.lastText.slice(0, 40)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>消息</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 520, overflowY: 'auto' }}>
                {snap.messages.length === 0 && <div style={{ opacity: 0.5, fontSize: 13 }}>暂无消息</div>}
                {snap.messages.map((m) => (
                  <div key={m.id} style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--dsh-surface, rgba(255,255,255,.04))' }}>
                    <div style={{ display: 'flex', gap: 8, fontSize: 12, opacity: 0.65, marginBottom: 4 }}>
                      <span>{m.session_name}</span>
                      {m.kind === 'sent' ? <span>我</span> : m.sender_name && <span>{m.sender_name}</span>}
                      <span style={{ marginLeft: 'auto' }}>{fmtTime(m.ts)}</span>
                    </div>
                    <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {m.text.length > 200 ? m.text.slice(0, 200) + '…' : m.text}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
