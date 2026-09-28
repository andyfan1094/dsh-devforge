/** 天工造梦内的本地浏览器控制页：开关、状态、导航、截图与快照。 */
import { useEffect, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { BrowserSettingsView, BrowserStatus } from '../../browser/protocol.ts'
import css from './panel.module.css'

export function BrowserTab({ api }: { api: DevforgeApi }): JSX.Element {
  const [status, setStatus] = useState<BrowserStatus | null>(null)
  const [settings, setSettings] = useState<BrowserSettingsView | null>(null)
  const [url, setUrl] = useState('https://resend.com/signup')
  const [snapshot, setSnapshot] = useState('')
  const [shot, setShot] = useState('')
  const [busy, setBusy] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  /** 一次刷新同时拉状态与开关：状态回答"现在能不能用"，开关决定"要不要注册工具"。 */
  const refresh = async (): Promise<void> => {
    try {
      setLoading(true); setError('')
      const [nextStatus, nextSettings] = await Promise.all([api.getBrowserStatus(), api.getBrowserSettings()])
      setStatus(nextStatus); setSettings(nextSettings)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])
  const run = async (label: string, action: () => Promise<void>): Promise<void> => {
    if (busy !== '') return
    try { setBusy(label); setError(''); await action(); await refresh() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy('') }
  }
  const navigate = (): void => { void run('navigate', async () => { const result = await api.browserNavigate(url); setSnapshot(result.snapshot); setShot('') }) }
  const takeShot = (): void => { void run('shot', async () => { const result = await api.browserScreenshot(); setShot(result.image) }) }
  const loadSnapshot = (): void => { void run('snapshot', async () => { const result = await api.getBrowserSnapshot(); setSnapshot(result.snapshot) }) }
  const stopBrowser = (): void => { void run('stop', async () => { await api.browserStop(); setSnapshot(''); setShot('') }) }
  /** 保存开关：Host 侧落库后立即热重建工具注册，无需重启 DSH。 */
  const toggle = (patch: Partial<BrowserSettingsView>): void => {
    void run('settings', async () => { setSettings(await api.putBrowserSettings(patch)) })
  }
  /** 关掉基础能力时顺带关掉发布类工具：发布工具依赖浏览器能力，单独留着没有意义且容易被误解为仍可用。 */
  const onToggleEnabled = (enabled: boolean): void => { toggle(enabled ? { enabled: true } : { enabled: false, publish: false }) }
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
      {/* 开关区（2026-09-28 新增）：此前本页只显示「未启用（请在设置中开启）」，而那个设置并不存在——
          新装用户既没有开关也没有默认值。现在两个开关直接放在这里，保存即热生效。 */}
      <div className={css['formRow']}>
        <label className={css['checkLabel']}>
          <input
            type="checkbox"
            checked={settings?.enabled === true}
            disabled={busy !== '' || settings === null}
            onChange={(event) => { onToggleEnabled(event.target.checked) }}
          />
          浏览器工具（打开网页 / 截图 / 点按钮）
        </label>
        <label className={css['checkLabel']}>
          <input
            type="checkbox"
            checked={settings?.publish === true}
            disabled={busy !== '' || settings === null || settings.enabled !== true}
            onChange={(event) => { toggle({ publish: event.target.checked }) }}
          />
          闲鱼 / 小红书发布工具（会真实发布内容）
        </label>
        {busy === 'settings' && <span className={css['sectionHint']}>保存中…</span>}
      </div>
      <div className={css['metricList']}>
        <div className={css['metricRow']}><span>能力</span><strong>{status?.enabled ? '已启用' : status === null ? '正在检查' : '未启用'}</strong></div>
        <div className={css['metricRow']}><span>发布类工具</span><strong>{settings?.publish === true ? '已开启' : '未开启（需显式开启）'}</strong></div>
        <div className={css['metricRow']}><span>浏览器进程</span><strong>{status?.running ? '运行中' : status === null ? '-' : '未启动'}</strong></div>
        <div className={css['metricRow']}><span>当前页</span><strong>{status?.currentUrl ?? status?.pageTitle ?? (status === null ? '-' : '无')}</strong></div>
      </div>
      {/* 地址与操作行：统一表单规格（formRow + fieldGrow + input），与其他页签控件同高、可收缩、窄屏自动换行，去除行内 flex/minWidth 魔法值。 */}
      <div className={css['formRow']}>
        <input className={[css['input'], css['fieldGrow']].filter(Boolean).join(' ')} value={url} onChange={(event) => { setUrl(event.target.value) }} placeholder="https://..." spellCheck={false} />
        <button type="button" className={css['ghostButton']} disabled={busy !== '' || url.trim() === ''} onClick={navigate}>{busy === 'navigate' ? '打开中…' : '打开'}</button>
        <button type="button" className={css['ghostButton']} disabled={busy !== ''} onClick={takeShot}>{busy === 'shot' ? '截图…' : '截图'}</button>
        <button type="button" className={css['ghostButton']} disabled={busy !== ''} onClick={loadSnapshot}>{busy === 'snapshot' ? '读取…' : '快照'}</button>
      </div>
      {/* 截图：统一图形容器（graphWrap 提供主题边框/圆角/底色），img 只保留等比缩放所需 inline 样式，替代原先散写的 rgba 边框魔法值。 */}
      {shot !== '' && (
        <div className={css['graphWrap']}>
          <img src={shot} alt="浏览器截图" style={{ display: 'block', maxWidth: '100%', height: 'auto' }} />
        </div>
      )}
      {/* 快照：统一结果输出（resultOutput 等宽字体 + 固定 min/max 高度 + 滚动），长文本受控滚动不再撑破面板，替代 modalContent + 行内 maxHeight。 */}
      {snapshot !== '' && <pre className={css['resultOutput']}>{snapshot}</pre>}
    </section>
  )
}
