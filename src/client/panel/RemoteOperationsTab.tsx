/**
 * 远程运维首页：统一展示旧 SSH / WinRM 配置的脱敏投影。
 * 执行、传输和终端仍在 adapter 迁入阶段；这里不渲染任何会触发远程操作的控件。
 */
import { useCallback, useEffect, useState } from 'react'
import type { RemoteHostSummary } from '../../protocol.ts'
import type { DevforgeApi } from '../api.ts'
import css from './panel.module.css'

export interface RemoteOperationsTabProps {
  api: DevforgeApi
}

/** 服务工厂内的统一远程主机清单。 */
export function RemoteOperationsTab({ api }: RemoteOperationsTabProps): JSX.Element {
  const [hosts, setHosts] = useState<RemoteHostSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  /** 只读刷新主机摘要；接口不会返回密码、私钥口令或 Token。 */
  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setError('')
      setHosts(await api.listRemoteHosts())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { void refresh() }, [refresh])

  return (
    <section className={css['tabBody']} data-dsh-part="remote-operations">
      <div className={css['toolbar']}>
        <span className={css['sectionHint']}>统一主机列表</span>
        <span className={css['toolbarSpacer']} />
        <button type="button" className={css['ghostButton']} onClick={() => { void refresh() }}>刷新</button>
      </div>
      {error !== '' && <div className={css['banner']} data-kind="error">{error}</div>}
      {loading && <div className={css['empty']} data-loading="">正在加载远程主机…</div>}
      {!loading && error === '' && hosts.length === 0 && <div className={css['empty']}>暂无已配置主机</div>}
      {!loading && hosts.length > 0 && (
        <div className={css['tableWrap']}>
          <div className={css['resourceList']}>
            {hosts.map((host) => (
              <div key={host.id} className={css['resourceRow']} data-dsh-part="remote-host-row">
                <div className={css['resourceInfo']}>
                  <strong className={css['resourceTitle']}>{host.alias}</strong>
                  <span className={css['resourceMeta']}>{host.host}:{host.port} · {host.user}{host.environment ? ' · ' + host.environment : ''}</span>
                  {host.tags.length > 0 && <span className={css['resourceMessage']}>{host.tags.join(', ')}</span>}
                </div>
                <span className={css['transportBadge']} data-transport={host.transport}>{host.transport === 'ssh' ? 'SSH' : 'Windows'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
