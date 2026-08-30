/** 服务工厂内的运营浏览器状态和可视化入口。 */
import { useEffect, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { CamofoxStatus } from '../../camofox/protocol.ts'
import css from './panel.module.css'

export function CamofoxTab({ api }: { api: DevforgeApi }): JSX.Element {
  const [status, setStatus] = useState<CamofoxStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const refresh = async (): Promise<void> => { try { setLoading(true); setError(''); setStatus(await api.getCamofoxStatus()) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setLoading(false) } }
  useEffect(() => { void refresh() }, [])
  const open = async (): Promise<void> => { try { setError(''); const url = await api.openCamofoxVisual(); window.open(url, '_blank', 'noopener,noreferrer') } catch (e) { setError(e instanceof Error ? e.message : String(e)) } }
  return <section className={css['tabBody']}><div className={css['toolbar']}><strong>运营浏览器</strong><span className={css['toolbarSpacer']} /><button type="button" className={css['ghostButton']} disabled={loading} onClick={() => { void refresh() }}>刷新</button><button type="button" className={css['ghostButton']} disabled={status?.visualReady !== true} onClick={() => { void open() }}>打开可视化</button></div>{error !== '' && <div className={css['banner']} data-kind="error">{error}</div>}<div className={css['metricList']}><div className={css['metricRow']}><span>连接状态</span><strong>{status?.reachable ? '已连接' : status === null ? '正在检查' : '不可用'}</strong></div><div className={css['metricRow']}><span>浏览器</span><strong>{status?.browserRunning ? '运行中' : '空闲'}</strong></div><div className={css['metricRow']}><span>标签页 / 会话</span><strong>{status === null ? '-' : `${status.activeTabs} / ${status.activeSessions}`}</strong></div></div></section>
}
