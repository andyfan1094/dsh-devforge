/** 天工造梦内的本地浏览器控制页：状态、导航、截图与快照。 */
import { useEffect, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { BrowserStatus } from '../../browser/protocol.ts'
import css from './panel.module.css'

export function BrowserTab({ api }: { api: DevforgeApi }): JSX.Element {
  const [status, setStatus] = useState<BrowserStatus | null>(null)
  const [url, setUrl] = useState('https://resend.com/signup')
  const [snapshot, setSnapshot] = useState('')
  const [shot, setShot] = useState('')
  const [busy, setBusy] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const refresh = async (): Promise<void> => { try { setLoading(true); setError(''); setStatus(await api.getBrowserStatus()) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setLoading(false) } }
  useEffect(() => { void refresh() }, [])
  const run = async (label: string, action: () => Promise<void>): Promise<void> => {
    if (busy !== '') return
    try { setBusy(label); setError(''); await action(); await refresh() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy('') }
  }
  const navigate = (): void => { void run('navigate', async () => { const result = await api.browserNavigate(url); setSnapshot(result.snapshot); setShot('') }) }
  const takeShot = (): void => { void run('shot', async () => { const result = await api.browserScreenshot(); setShot(result.image) }) }
  const loadSnapshot = (): void => { void run('snapshot', async () => { const result = await api.getBrowserSnapshot(); setSnapshot(result.snapshot) }) }
  const stopBrowser = (): void => { void run('stop', async () => { await api.browserStop(); setSnapshot(''); setShot('') }) }
  return (
    <section className={css['tabBody']}>
      <div className={css['toolbar']}>
        <strong>本地浏览器</strong>
        <span className={css['sectionHint']}>窗口在本机屏幕实时可见；登录状态保存在固定用户档案</span>
        <span className={css['toolbarSpacer']} />
        <button type="button" className={css['ghostButton']} disabled={loading} onClick={() => { void refresh() }}>刷新</button>
        <button type="button" className={css['ghostButton']} disabled={busy !== '' || status?.running !== true} onClick={stopBrowser}>停止</button>
      </div>
      {error !== '' && <div className={css['banner']} data-kind="error">{error}</div>}
      <div className={css['metricList']}>
        <div className={css['metricRow']}><span>能力</span><strong>{status?.enabled ? '已启用' : status === null ? '正在检查' : '未启用（请在设置中开启）'}</strong></div>
        <div className={css['metricRow']}><span>浏览器进程</span><strong>{status?.running ? '运行中' : status === null ? '-' : '未启动'}</strong></div>
        <div className={css['metricRow']}><span>当前页</span><strong>{status?.currentUrl ?? status?.pageTitle ?? (status === null ? '-' : '无')}</strong></div>
      </div>
      <div className={css['toolbar']}>
        <input value={url} onChange={(event) => { setUrl(event.target.value) }} placeholder="https://..." style={{ flex: '1 1 auto', minWidth: '240px' }} />
        <button type="button" className={css['ghostButton']} disabled={busy !== '' || url.trim() === ''} onClick={navigate}>{busy === 'navigate' ? '打开中…' : '打开'}</button>
        <button type="button" className={css['ghostButton']} disabled={busy !== ''} onClick={takeShot}>{busy === 'shot' ? '截图…' : '截图'}</button>
        <button type="button" className={css['ghostButton']} disabled={busy !== ''} onClick={loadSnapshot}>{busy === 'snapshot' ? '读取…' : '快照'}</button>
      </div>
      {shot !== '' && <img src={shot} alt="浏览器截图" style={{ maxWidth: '100%', border: '1px solid rgba(127,127,127,0.4)', borderRadius: '6px' }} />}
      {snapshot !== '' && <pre className={css['modalContent']} style={{ maxHeight: '320px', overflow: 'auto' }}>{snapshot}</pre>}
    </section>
  )
}