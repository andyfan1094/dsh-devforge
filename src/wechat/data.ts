/**
 * 微信消息数据源 —— 读取 wx-auto 控制台落盘的 SQLite。
 *
 * 背景：微信 4.x 的联系人对象登录后即被回收，昵称只能靠消息自带的 field11
 * 一点点学到，消息本身在内存中也只存活很短时间。所以 wx-auto 侧会把
 * 联系人 / 群 / 消息全部落进 wechat.db，这里只读这份库给面板展示。
 *
 * 库路径优先级：设置项 devforge.config.wechat.dbPath > 默认项目路径。
 */

import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'

/** 默认库位置（wx-auto 项目内）。 */
export const DEFAULT_WECHAT_DB = 'D:/项目/projects/wx-auto/wechat.db'

export interface WechatContact {
  wxid: string
  nickname: string
  remark: string
  alias: string
}

export interface WechatGroup {
  gid: string
  name: string
}

export interface WechatMessage {
  id: number
  msg_id: number | null
  session: string
  session_name: string
  sender: string
  sender_name: string
  text: string
  ts: number
  kind: string
  is_group: number
}

export interface WechatSnapshot {
  ok: boolean
  dbPath: string
  dbExists: boolean
  error?: string
  stats: { contacts: number; groups: number; messages: number }
  contacts: WechatContact[]
  groups: WechatGroup[]
  messages: WechatMessage[]
  sessions: Array<{ session: string; name: string; lastText: string; lastTs: number; isGroup: boolean }>
}

function resolveDbPath(dbPath?: string): string {
  const p = (dbPath ?? '').trim()
  return p || DEFAULT_WECHAT_DB
}

function emptySnapshot(dbPath: string, dbExists: boolean, error?: string): WechatSnapshot {
  return {
    ok: false,
    dbPath,
    dbExists,
    error,
    stats: { contacts: 0, groups: 0, messages: 0 },
    contacts: [],
    groups: [],
    messages: [],
    sessions: [],
  }
}

/**
 * 读取微信库快照。只读打开，库不存在时返回空快照而不抛错，
 * 方便面板显示「等待 wx-auto 启动」这类提示。
 */
export function readWechatSnapshot(dbPath?: string, limit = 300): WechatSnapshot {
  const path = resolveDbPath(dbPath)
  if (!existsSync(path)) {
    return emptySnapshot(path, false, '数据库不存在，请先启动 wx-auto 控制台')
  }
  let db: DatabaseSync | null = null
  try {
    db = new DatabaseSync(path, { readOnly: true })
    const contacts = db
      .prepare('SELECT wxid, nickname, remark, alias FROM contacts ORDER BY updated_at DESC')
      .all() as unknown as WechatContact[]
    const groups = db
      .prepare('SELECT gid, name FROM groups ORDER BY updated_at DESC')
      .all() as unknown as WechatGroup[]
    const messages = db
      .prepare(
        `SELECT * FROM (
           SELECT id, msg_id, session, sender, sender_name, text, ts, kind, is_group
           FROM messages ORDER BY ts DESC LIMIT ?
         ) ORDER BY ts ASC`,
      )
      .all(limit) as unknown as Array<Omit<WechatMessage, 'session_name'>>

    const nickOf = new Map<string, string>()
    for (const c of contacts) nickOf.set(c.wxid, c.remark || c.nickname)
    for (const g of groups) nickOf.set(g.gid, g.name)

    const withNames: WechatMessage[] = messages.map((m) => ({
      ...m,
      session_name: nickOf.get(m.session) || m.session,
    }))

    // 会话汇总：取每个会话最后一条
    const lastBySession = new Map<string, WechatMessage>()
    for (const m of withNames) lastBySession.set(m.session, m)
    const sessions = [...lastBySession.values()]
      .sort((a, b) => b.ts - a.ts)
      .map((m) => ({
        session: m.session,
        name: m.session_name,
        lastText: m.text,
        lastTs: m.ts,
        isGroup: Boolean(m.is_group),
      }))

    return {
      ok: true,
      dbPath: path,
      dbExists: true,
      stats: { contacts: contacts.length, groups: groups.length, messages: withNames.length },
      contacts,
      groups,
      messages: withNames,
      sessions,
    }
  } catch (err) {
    return emptySnapshot(path, true, err instanceof Error ? err.message : String(err))
  } finally {
    try {
      db?.close()
    } catch {
      /* 忽略关闭异常 */
    }
  }
}
