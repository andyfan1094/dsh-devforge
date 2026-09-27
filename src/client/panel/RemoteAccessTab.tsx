/** 天工造梦「远程访问」页（0.41.0）：网关开关、端口、密码与运行状态，保存热生效。 */
import { useEffect, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { GatewayRuntimeView, GatewaySettingsView } from '../../remote/protocol.ts'
import css from './panel.module.css'

export function RemoteAccessTab({ api }: { api: DevforgeApi }): JSX.Element {
  const [config, setConfig] = useState<GatewaySettingsView | null>(null)
  const [runtime, setRuntime] = useState<GatewayRuntimeView | null>(null)
  const [draft, setDraft] = useState<{ enabled: boolean; port: string; host: string; password: string; upstreamPort: string; sessionHours: string }>({ enabled: false, port: '19390', host: '0.0.0.0', password: '', upstreamPort: '3080', sessionHours: '12' })
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const apply = (next: GatewaySettingsView, runtimeNext: GatewayRuntimeView): void => {
    setConfig(next)
    setRuntime(runtimeNext)
    setDraft({ enabled: next.enabled, port: String(next.port), host: next.host, password: '', upstreamPort: String(next.upstreamPort), sessionHours: String(next.sessionHours) })
  }
  const refresh = async (): Promise<void> => {
    try {
      setLoading(true); setError(''); setNotice('')
      const data = await api.getGatewaySettings()
      apply(data.config, data.runtime)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])

  const save = async (): Promise<void> => {
    if (busy) return
    try {
      setBusy(true); setError(''); setNotice('')
      const data = await api.putGatewaySettings({
        enabled: draft.enabled,
        port: Number(draft.port),
        host: draft.host.trim(),
        password: draft.password,
        upstreamPort: Number(draft.upstreamPort),
        sessionHours: Number(draft.sessionHours),
      })
      apply(data.config, data.runtime)
      setNotice(data.config.enabled ? `已保存并生效：http://本机:${data.config.port}（员工浏览器输密码即可访问）` : '已保存，网关已停用')
      // PUT 响应里的运行状态是热重建前的快照；稍等网关重建完成后再刷一次真实状态。
      window.setTimeout(() => { void refresh() }, 900)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  return (
    <section className={css['tabBody']}>
      <div className={css['toolbar']}>
        <strong>远程访问网关</strong>
        <span className={css['sectionHint']}>员工浏览器访问本机 DSH Web 的密码大门；配置保存后即时生效，无需重启</span>
        <span className={css['toolbarSpacer']} />
        <button type="button" className={css['ghostButton']} disabled={loading} onClick={() => { void refresh() }}>刷新</button>
        <button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void save() }}>{busy ? '保存中…' : '保存'}</button>
      </div>
      {error !== '' && <div className={css['banner']} data-kind="error">{error}</div>}
      {notice !== '' && <div className={css['banner']} data-kind="info">{notice}</div>}
      <div className={css['metricList']}>
        <div className={css['metricRow']}><span>网关状态</span><strong>{runtime === null ? '正在检查' : runtime.running ? `运行中（端口 ${runtime.listeningPort ?? config?.port ?? '-'}）` : config?.enabled === true ? '已启用但未运行' : '已停用'}</strong></div>
        <div className={css['metricRow']}><span>访问密码</span><strong>{config === null ? '-' : config.hasPassword ? '已设置（保存时留空 = 不修改）' : '未设置'}</strong></div>
      </div>
      <div className={css['formRow']}>
        <label className={css['sectionHint']}><input type="checkbox" checked={draft.enabled} onChange={(event) => { setDraft((d) => ({ ...d, enabled: event.target.checked })) }} /> 启用网关</label>
      </div>
      <div className={css['formRow']}>
        <input className={css['input']} style={{ width: '9em' }} value={draft.port} onChange={(event) => { setDraft((d) => ({ ...d, port: event.target.value.replace(/\D/gu, '') })) }} placeholder="网关端口 19390" spellCheck={false} title="员工浏览器访问的端口" />
        <input className={css['input']} style={{ width: '10em' }} value={draft.host} onChange={(event) => { setDraft((d) => ({ ...d, host: event.target.value })) }} placeholder="监听地址" spellCheck={false} title="0.0.0.0=所有网卡（局域网可访问）；127.0.0.1=仅本机" />
        <input className={css['input']} type="password" autoComplete="new-password" value={draft.password} onChange={(event) => { setDraft((d) => ({ ...d, password: event.target.value })) }} placeholder={config?.hasPassword === true ? '密码已设置，留空不修改' : '访问密码'} />
      </div>
      <div className={css['formRow']}>
        <input className={css['input']} style={{ width: '9em' }} value={draft.upstreamPort} onChange={(event) => { setDraft((d) => ({ ...d, upstreamPort: event.target.value.replace(/\D/gu, '') })) }} placeholder="上游端口 3080" spellCheck={false} title="本机 DSH Web 的端口（生产默认 3080）" />
        <input className={css['input']} style={{ width: '9em' }} value={draft.sessionHours} onChange={(event) => { setDraft((d) => ({ ...d, sessionHours: event.target.value.replace(/\D/gu, '') })) }} placeholder="会话时长(小时)" spellCheck={false} title="员工登录一次的有效时长（1-168 小时）" />
      </div>
      <pre className={css['resultOutput']}>{`使用方法：
1. 启用网关 → 设置端口（默认 19390）与访问密码 → 保存。
2. 员工浏览器打开 http://本机IP:端口，输入密码即可进入 DSH Web。
3. 监听地址 0.0.0.0 = 局域网可访问；127.0.0.1 = 仅本机（调试用）。
4. 安全提示：密码请使用强口令；对外暴露时建议配合防火墙只放行必要端口。`}</pre>
    </section>
  )
}
