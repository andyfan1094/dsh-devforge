/** 抖音直播只读接收侧栏：Host 持有连接，浏览器只负责快照、筛选与显示。 */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { DouyinLiveSnapshot } from '../douyin-live/protocol.ts'
import { isDouyinLiveUrl } from '../douyin-live/link.ts'
import type { DevforgeApi } from './api.ts'
import { IconBrowser, IconMcp, IconUpdate } from './panel/icons.tsx'
import css from './douyin-live-sidebar.module.css'

type MessageType = DouyinLiveSnapshot['messages'][number]['type']
type Action = 'connect' | 'disconnect' | 'clear' | 'autoOn' | 'autoOff' | 'speechOn' | 'speechOff'
const TYPE_LABELS: Record<MessageType, string> = {
  chat: '弹幕', gift: '礼物', like: '点赞', member: '进场', social: '互动', system: '系统', other: '其他',
}
const CONNECTION_LABELS: Record<DouyinLiveSnapshot['connection'], string> = {
  idle: '未连接', connecting: '连接中', connected: '接收器已连接', reconnecting: '重连中', error: '连接异常',
}

/** 侧栏标签页只传递这些字段；真实类型由可选的 dsh-better-sidebar 提供。 */
interface SidebarTab {
  id: string
  path?: string
  meta?: unknown
}

/** 仅声明本面板消费的稳定契约，避免对可选插件增加构建或运行时强依赖。 */
interface SidebarService {
  registerTab(descriptor: {
    id: string; title: string; single: boolean; order: number
    icon: (size: number) => ReactNode
    urlTarget?: (url: URL) => boolean
    onOpen?: (tab: SidebarTab) => void
    onActivate?: (tab: SidebarTab) => void
    component: (props: { visible: boolean; tab: SidebarTab }) => ReactNode
  }): () => void
  updateTab?: (tabId: string, patch: { title?: string; path?: string; meta?: unknown }) => void
}

interface DouyinLinkSeed {
  url: string
  serial: number
}

/** urlTarget 与 openTab 之间的同步种子；只保存公开 URL，不保存任何凭据或页面内容。 */
let pendingDouyinLink: DouyinLinkSeed | undefined
let douyinLinkSerial = 0

/** 记录一次即将打开的抖音链接，供已存在的单例标签页在 onActivate 中切换。 */
function claimDouyinLiveUrl(url: URL): boolean {
  if (!isDouyinLiveUrl(url)) return false
  pendingDouyinLink = { url: url.href, serial: ++douyinLinkSerial }
  return true
}

/** 取出一次性链接种子，避免普通的标签激活误触发连接。 */
function consumeDouyinLink(): DouyinLinkSeed | undefined {
  const seed = pendingDouyinLink
  pendingDouyinLink = undefined
  return seed
}

/** 为同一 URL 的重复点击提供变化标记，让面板重新发起连接。 */
function seedMeta(seed: DouyinLinkSeed): Record<string, string | number> {
  return { source: 'douyin-live-link', serial: seed.serial }
}

/** 注册单例到侧栏加号菜单，并接管白名单抖音链接。 */
export function registerDouyinLiveSidebar(ctx: ClientContext, api: DevforgeApi): () => void {
  const sidebar = ctx.get('betterSidebar') as SidebarService | undefined
  if (!sidebar || typeof sidebar.registerTab !== 'function') return () => {}
  return sidebar.registerTab({
    id: 'dsh-devforge:douyin-live', title: '抖音直播', single: true, order: 160,
    icon: (size) => <IconBrowser size={size} />,
    urlTarget: claimDouyinLiveUrl,
    onOpen: () => { consumeDouyinLink() },
    onActivate: (tab) => {
      const seed = consumeDouyinLink()
      if (seed && sidebar.updateTab) sidebar.updateTab(tab.id, { title: '抖音直播', path: seed.url, meta: seedMeta(seed) })
    },
    component: ({ visible, tab }) => <DouyinLiveSidebar api={api} visible={visible} tabPath={tab.path} tabMeta={tab.meta} />,
  })
}

/** 接收时间按本机时区显示；非法时间不让消息渲染失败。 */
function eventTime(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return '--:--:--'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '--:--:--' : date.toLocaleTimeString('zh-CN', { hour12: false })
}

/** 保留 API 提供的中文错误；网络异常也必须有可见反馈。 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '请求失败，请重试'
}

/** 只把标签页中的白名单 URL 作为自动连接种子，避免误用其他标签路径。 */
function douyinUrlFromTabPath(path?: string): string | undefined {
  if (!path) return undefined
  try {
    const url = new URL(path)
    return isDouyinLiveUrl(url) ? url.href : undefined
  } catch {
    return undefined
  }
}

/** 读取重复点击标记；旧版本标签没有 meta 时退回 URL 本身。 */
function tabSeedRevision(meta: unknown): string {
  if (!meta || typeof meta !== 'object') return ''
  const serial = (meta as { serial?: unknown }).serial
  return typeof serial === 'number' && Number.isFinite(serial) ? String(serial) : ''
}

/** 紧凑直播面板；关闭或隐藏只暂停快照，不发送断开指令。 */
function DouyinLiveSidebar({ api, visible, tabPath, tabMeta }: { api: DevforgeApi; visible: boolean; tabPath?: string; tabMeta?: unknown }): JSX.Element {
  const [snapshot, setSnapshot] = useState<DouyinLiveSnapshot | null>(null)
  const [roomInput, setRoomInput] = useState('')
  const roomDirty = useRef(false)
  const [filter, setFilter] = useState<MessageType | 'all'>('all')
  const [search, setSearch] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const [pageVisible, setPageVisible] = useState(() => !document.hidden)
  const [busy, setBusy] = useState<Action | null>(null)
  const busyRef = useRef(false)
  const [pollError, setPollError] = useState('')
  const [actionError, setActionError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [loading, setLoading] = useState(false)
  const pollRequest = useRef<AbortController | null>(null)
  const actionRequest = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const handledLink = useRef<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const linkSeed = useMemo(() => douyinUrlFromTabPath(tabPath), [tabPath])
  const linkSeedKey = linkSeed === undefined ? '' : linkSeed + '\n' + tabSeedRevision(tabMeta)

  const applySnapshot = useCallback((next: DouyinLiveSnapshot) => {
    setSnapshot(next)
    if (!roomDirty.current) setRoomInput(next.config.roomInput)
  }, [])

  useEffect(() => {
    const onVisibility = (): void => {
      if (document.hidden) pollRequest.current?.abort()
      setPageVisible(!document.hidden)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      generation.current++
      pollRequest.current?.abort()
      actionRequest.current?.abort()
      actionRequest.current = null
    }
  }, [])

  // 串行轮询：完成后计时；代次屏蔽旧快照，隐藏/切页/操作/卸载均取消在途读取。
  useEffect(() => {
    if (!visible || !pageVisible || busy !== null) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let request: AbortController | undefined
    const epoch = generation.current
    const poll = async (): Promise<void> => {
      if (disposed || document.hidden || busyRef.current) return
      request = new AbortController()
      pollRequest.current = request
      const current = request
      let timedOut = false
      const timeout = setTimeout(() => { timedOut = true; current.abort() }, 15000)
      setLoading(true)
      try {
        const next = await api.getDouyinLiveSnapshot(current.signal)
        if (!disposed && !current.signal.aborted && epoch === generation.current) {
          applySnapshot(next)
          setPollError('')
        }
      } catch (error) {
        if (!disposed && epoch === generation.current && (!current.signal.aborted || timedOut)) {
          setPollError(timedOut ? '读取超时，正在重试' : errorText(error))
        }
      } finally {
        clearTimeout(timeout)
        if (pollRequest.current === current) pollRequest.current = null
        if (!disposed && epoch === generation.current) {
          setLoading(false)
          timer = setTimeout(() => { void poll() }, 1000)
        }
      }
    }
    void poll()
    return () => {
      disposed = true
      clearTimeout(timer)
      request?.abort()
    }
  }, [api, visible, pageVisible, busy, refreshKey, applySnapshot])

  // 写操作互斥且优先于快照；只取消浏览器等待，卸载不会逆向断开 Host。
  const runAction = async (action: Action, roomOverride?: string): Promise<void> => {
    if (busyRef.current) return
    const room = (roomOverride ?? roomInput).trim()
    if (action === 'connect' && !room) { setActionError('请输入直播间链接或房间号'); return }
    busyRef.current = true
    setBusy(action)
    setLoading(false)
    setActionError('')
    setFeedback('')
    generation.current++
    pollRequest.current?.abort()
    const request = new AbortController()
    actionRequest.current = request
    const timeout = setTimeout(() => request.abort(), 30000)
    try {
      const next = action === 'connect' ? await api.connectDouyinLive(room, request.signal)
        : action === 'autoOn' ? await api.setDouyinLiveAutoMonitor(true, request.signal)
          : action === 'autoOff' ? await api.setDouyinLiveAutoMonitor(false, request.signal)
            : action === 'speechOn' ? await api.setDouyinLiveSpeech(true, request.signal)
              : action === 'speechOff' ? await api.setDouyinLiveSpeech(false, request.signal)
                : action === 'disconnect' ? await api.disconnectDouyinLive(request.signal)
                  : await api.clearDouyinLive(request.signal)
      if (actionRequest.current !== request || request.signal.aborted) return
      if (action === 'connect') roomDirty.current = false
      applySnapshot(next)
      setPollError('')
      setFeedback(action === 'clear' ? '消息已清空' : action === 'disconnect' ? '已断开连接' : action === 'autoOn' ? '自动跟随已开启' : action === 'autoOff' ? '自动跟随已关闭' : action === 'speechOn' ? '语音播报已开启' : action === 'speechOff' ? '语音播报已关闭' : '连接请求已受理')
    } catch (error) {
      if (actionRequest.current === request) {
        setActionError(request.signal.aborted ? '请求已中止，连接状态以最新快照为准' : errorText(error))
      }
    } finally {
      clearTimeout(timeout)
      if (actionRequest.current === request) {
        actionRequest.current = null
        busyRef.current = false
        setBusy(null)
      }
    }
  }

  // 外部链接首次打开或更新现有单例时自动连接；手动修改输入框不会被覆盖。
  useEffect(() => {
    if (linkSeedKey === '') {
      handledLink.current = null
      return
    }
    if (handledLink.current === linkSeedKey || linkSeed === undefined) return
    handledLink.current = linkSeedKey
    roomDirty.current = false
    setRoomInput(linkSeed)
    void runAction('connect', linkSeed)
  }, [linkSeed, linkSeedKey, runAction])

  const messages = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    const filtered = (snapshot?.messages ?? []).filter((message) =>
      (filter === 'all' || message.type === filter)
      && (!query || (message.nickname + ' ' + message.text).toLocaleLowerCase().includes(query)))
    // Host 按接收顺序保存，展示层反转后让最新消息固定在列表顶部。
    return [...filtered].reverse()
  }, [snapshot, filter, search])
  const lastMessage = messages.at(-1)
  useEffect(() => {
    if (visible && pageVisible && autoScroll && listRef.current) listRef.current.scrollTop = 0
  }, [visible, pageVisible, autoScroll, lastMessage?.id, lastMessage?.sequence, messages.length, filter, search])

  const connection = snapshot?.connection
  const canDisconnect = snapshot !== null && connection !== 'idle'
  const error = actionError || pollError || snapshot?.error
  return (
    <section className={css.panel} aria-label="抖音直播">
      <header className={css.header}>
        <h2><IconBrowser size={16} />抖音直播</h2>
        <span className={css.status} data-state={connection ?? 'idle'}>{connection ? CONNECTION_LABELS[connection] : '读取状态中'}</span>
      </header>
      <form className={css.roomForm} onSubmit={(event) => { event.preventDefault(); void runAction('connect') }}>
        <label className={css.field}>直播间
          <input aria-label="直播间链接或房间号" placeholder="直播间链接或房间号" value={roomInput} disabled={busy !== null}
            onChange={(event) => { roomDirty.current = true; setRoomInput(event.target.value) }} />
        </label>
        <div className={css.actions}>
          <button className={css.primary} type="submit" disabled={busy !== null || !roomInput.trim()}><IconMcp />{busy === 'connect' ? '连接中' : '连接'}</button>
          <button type="button" disabled={busy !== null || !canDisconnect} onClick={() => { void runAction('disconnect') }}>{busy === 'disconnect' ? '断开中' : '断开'}</button>
          <span className={css.meta}>{snapshot ? (snapshot.upstreamReady ? '上游已就绪' : '等待上游就绪') : '等待服务状态'}</span>
        </div>
      </form>
      {snapshot && <div className={css.autoRow}>
        <label className={css.check}><input type="checkbox" checked={snapshot.config.autoMonitor} disabled={busy !== null} onChange={(event) => { void runAction(event.target.checked ? 'autoOn' : 'autoOff') }} />自动跟随直播伴侣</label>
        <label className={css.check}><input type="checkbox" checked={snapshot.config.welcomeSpeech} disabled={busy !== null} onChange={(event) => { void runAction(event.target.checked ? 'speechOn' : 'speechOff') }} />进场/点赞语音播报</label>
        <span className={css.autoStatus}>伴侣：{snapshot.companion.installed ? snapshot.companion.state === 'live' ? '直播中' : snapshot.companion.state === 'offline' ? '未开播' : '状态未知' : '未安装'}</span>
      </div>}
      {snapshot && <div className={css.summary}>
        <span>房间 {snapshot.roomId || '未选择'}</span>
        <span>{snapshot.roomOnline === true ? '直播中' : snapshot.roomOnline === false ? '未开播' : '开播状态未知'}</span>
        <span>已接收 {snapshot.received.toLocaleString()}</span>
      </div>}
      {error && <div className={css.error} role="alert"><span>{error}</span>
        <button type="button" title="刷新状态" aria-label="刷新状态" disabled={busy !== null}
          onClick={() => { setActionError(''); setRefreshKey((key) => key + 1) }}><IconUpdate /></button>
      </div>}
      {feedback && !error && <div className={css.feedback} role="status">{feedback}</div>}
      <div className={css.toolbar}>
        <select aria-label="消息类型" value={filter} onChange={(event) => setFilter(event.target.value as MessageType | 'all')}>
          <option value="all">全部消息</option>
          {Object.entries(TYPE_LABELS).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
        </select>
        <input type="search" aria-label="搜索昵称或消息" placeholder="搜索昵称或消息" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      <div className={css.listActions}>
        <label className={css.check}><input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} />自动滚动</label>
        <span className={css.meta}>{messages.length} / {snapshot?.messages.length ?? 0} 条</span>
        <button type="button" disabled={busy !== null || !snapshot?.messages.length} onClick={() => { void runAction('clear') }}>{busy === 'clear' ? '清空中' : '清空'}</button>
      </div>
      <div className={css.messages} ref={listRef} aria-label="直播消息列表" tabIndex={0}>
        {messages.length ? <ol>{messages.map((message) => <li key={message.id + ':' + message.sequence} className={css.message}>
          <div className={css.messageMeta}><span className={css.messageType} data-type={message.type}>{TYPE_LABELS[message.type] ?? '其他'}</span>
            <strong>{message.nickname || '系统'}</strong><time>{eventTime(message.receivedAt)}</time></div>
          <p>{message.text}</p>
        </li>)}</ol> : <div className={css.empty}>
          {snapshot === null ? (loading ? '正在读取直播状态…' : '暂无直播状态') : snapshot.messages.length ? '没有匹配的消息' : connection === 'idle' ? '尚未连接直播间' : '暂无消息'}
          {snapshot !== null && snapshot.messages.length > 0 && <button type="button" onClick={() => { setFilter('all'); setSearch('') }}>重置筛选</button>}
        </div>}
      </div>
      <footer className={css.footer}><span>{pollError ? '同步异常' : !visible || !pageVisible ? '同步已暂停' : connection === 'idle' ? '未连接' : snapshot?.upstreamReady ? '已收到直播事件' : '等待直播事件'}</span><span>最近消息 {eventTime(snapshot?.lastEventAt)}</span></footer>
    </section>
  )
}
