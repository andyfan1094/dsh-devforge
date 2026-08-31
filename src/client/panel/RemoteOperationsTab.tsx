/**
 * 远程运维首页：统一展示 SSH / WinRM 主机（dsh-devforge SQLite store）的脱敏摘要，
 * 并提供主机的新增与删除入口。执行、传输和终端仍在 adapter 迁入阶段；
 * 这里不渲染任何会触发远程操作的控件。密码等凭据只经表单提交给后端保存，不回显。
 */
import { useCallback, useEffect, useState } from 'react'
import type { RemoteHostSummary } from '../../protocol.ts'
import type { DevforgeApi } from '../api.ts'
import css from './panel.module.css'

export interface RemoteOperationsTabProps {
  api: DevforgeApi
}

/** 新增主机表单的可控字段。 */
interface HostFormState {
  transport: 'ssh' | 'winrm'
  alias: string
  host: string
  port: string
  user: string
  authKind: 'password' | 'key' | 'agent'
  password: string
  keyPath: string
  passphrase: string
  environment: string
  tags: string
}

const EMPTY_FORM: HostFormState = {
  transport: 'ssh',
  alias: '',
  host: '',
  port: '22',
  user: 'root',
  authKind: 'password',
  password: '',
  keyPath: '',
  passphrase: '',
  environment: '',
  tags: '',
}

/** 天工造梦内的统一远程主机清单与配置入口。 */
export function RemoteOperationsTab({ api }: RemoteOperationsTabProps): JSX.Element {
  const [hosts, setHosts] = useState<RemoteHostSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<HostFormState>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)

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

  /** 提交新增主机：按 transport 组织 payload，成功后关表单并刷新。 */
  const submit = useCallback(async (): Promise<void> => {
    setSubmitting(true)
    setError('')
    setNotice('')
    try {
      const payload: { transport: 'ssh' | 'winrm' } & Record<string, unknown> = {
        transport: form.transport,
        alias: form.alias.trim(),
        host: form.host.trim(),
        user: form.user.trim(),
        ...(form.transport === 'ssh' ? { port: Number.parseInt(form.port, 10) || 22 } : { port: Number.parseInt(form.port, 10) || 5985 }),
      }
      if (form.transport === 'ssh') {
        payload.auth = form.authKind === 'password'
          ? { kind: 'password', password: form.password }
          : form.authKind === 'key'
            ? { kind: 'key', keyPath: form.keyPath.trim(), ...(form.passphrase !== '' ? { passphrase: form.passphrase } : {}) }
            : { kind: 'agent' }
      } else {
        payload.auth = { kind: 'password', password: form.password }
        payload.transportHttp = form.port === '5986' ? 'https' : 'http'
      }
      if (form.environment.trim() !== '') payload.environment = form.environment.trim()
      const tags = form.tags.split(',').map(tag => tag.trim()).filter(tag => tag !== '')
      if (tags.length > 0) payload.tags = tags
      await api.createRemoteHost(payload)
      setNotice('主机 ' + form.alias.trim() + ' 已保存。')
      setForm(EMPTY_FORM)
      setFormOpen(false)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSubmitting(false)
    }
  }, [api, form, refresh])

  /** 删除主机（确认后执行）。 */
  const remove = useCallback(async (host: RemoteHostSummary): Promise<void> => {
    if (!window.confirm('确认删除主机 ' + host.alias + '（' + host.host + '）？该操作不可撤销。')) return
    setError('')
    setNotice('')
    try {
      await api.deleteRemoteHost(host.transport, host.alias)
      setNotice('主机 ' + host.alias + ' 已删除。')
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [api, refresh])

  const updateForm = (patch: Partial<HostFormState>): void => { setForm(prev => ({ ...prev, ...patch })) }

  return (
    <section className={css['tabBody']} data-dsh-part="remote-operations">
      <div className={css['toolbar']}>
        <span className={css['sectionHint']}>统一主机列表</span>
        <span className={css['toolbarSpacer']} />
        <button type="button" className={css['ghostButton']} onClick={() => { setFormOpen(value => !value); setNotice('') }}>
          {formOpen ? '收起表单' : '新增主机'}
        </button>
        <button type="button" className={css['ghostButton']} onClick={() => { void refresh() }}>刷新</button>
        <a className={css['promoLink']} href="https://www.rainyun.com/MzkwMTQ0_" target="_blank" rel="noopener noreferrer sponsored" title="雨云云服务器 · 新用户优惠，点击直达（新标签打开）">☁ 云服务器 · 雨云</a>
      </div>
      {error !== '' && <div className={css['banner']} data-kind="error">{error}</div>}
      {notice !== '' && <div className={css['banner']} data-kind="info">{notice}</div>}

      {formOpen && (
        <div className={css['formGrid']} data-dsh-part="remote-host-form">
          <label className={css['field']}>
            <span>类型</span>
            <select value={form.transport} onChange={event => updateForm({ transport: event.target.value as 'ssh' | 'winrm', port: event.target.value === 'ssh' ? '22' : '5985', authKind: event.target.value === 'ssh' ? form.authKind : 'password' })}>
              <option value="ssh">SSH (Linux/Unix)</option>
              <option value="winrm">WinRM (Windows)</option>
            </select>
          </label>
          <label className={css['field']}>
            <span>别名 *</span>
            <input value={form.alias} onChange={event => updateForm({ alias: event.target.value })} placeholder="web1" />
          </label>
          <label className={css['field']}>
            <span>主机 *</span>
            <input value={form.host} onChange={event => updateForm({ host: event.target.value })} placeholder="192.168.1.10 或 host.example.com" />
          </label>
          <label className={css['field']}>
            <span>端口</span>
            <input value={form.port} onChange={event => updateForm({ port: event.target.value })} placeholder={form.transport === 'ssh' ? '22' : '5985'} />
          </label>
          <label className={css['field']}>
            <span>用户名 *</span>
            <input value={form.user} onChange={event => updateForm({ user: event.target.value })} placeholder="root / administrator" />
          </label>
          {form.transport === 'ssh' ? (
            <label className={css['field']}>
              <span>认证方式</span>
              <select value={form.authKind} onChange={event => updateForm({ authKind: event.target.value as HostFormState['authKind'] })}>
                <option value="password">密码</option>
                <option value="key">私钥文件</option>
                <option value="agent">SSH Agent</option>
              </select>
            </label>
          ) : (
            <label className={css['field']}>
              <span>认证方式</span>
              <input value="密码" disabled />
            </label>
          )}
          {form.transport === 'ssh' && form.authKind === 'password' && (
            <label className={css['field']}>
              <span>密码</span>
              <input type="password" value={form.password} onChange={event => updateForm({ password: event.target.value })} />
            </label>
          )}
          {form.transport === 'winrm' && (
            <label className={css['field']}>
              <span>密码</span>
              <input type="password" value={form.password} onChange={event => updateForm({ password: event.target.value })} />
            </label>
          )}
          {form.transport === 'ssh' && form.authKind === 'key' && (
            <>
              <label className={css['field']}>
                <span>私钥路径 *</span>
                <input value={form.keyPath} onChange={event => updateForm({ keyPath: event.target.value })} placeholder="~/.ssh/id_ed25519" />
              </label>
              <label className={css['field']}>
                <span>私钥口令（可选）</span>
                <input type="password" value={form.passphrase} onChange={event => updateForm({ passphrase: event.target.value })} />
              </label>
            </>
          )}
          <label className={css['field']}>
            <span>环境（可选）</span>
            <input value={form.environment} onChange={event => updateForm({ environment: event.target.value })} placeholder="production / staging" />
          </label>
          <label className={css['field']}>
            <span>标签（逗号分隔，可选）</span>
            <input value={form.tags} onChange={event => updateForm({ tags: event.target.value })} placeholder="prod, web" />
          </label>
          <div className={css['fieldActions']}>
            <button type="button" className={css['primaryButton']} disabled={submitting || form.alias.trim() === '' || form.host.trim() === '' || form.user.trim() === ''} onClick={() => { void submit() }}>
              {submitting ? '保存中…' : '保存主机'}
            </button>
            <button type="button" className={css['ghostButton']} onClick={() => { setForm(EMPTY_FORM); setFormOpen(false) }}>取消</button>
          </div>
        </div>
      )}

      {loading && <div className={css['empty']} data-loading="">正在加载远程主机…</div>}
      {!loading && error === '' && hosts.length === 0 && <div className={css['empty']}>暂无已配置主机，点右上角「新增主机」添加。</div>}
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
                <button type="button" className={css['ghostButton']} onClick={() => { void remove(host) }}>删除</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
