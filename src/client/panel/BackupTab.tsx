/**
 * CNB 备份页签：启用向导（选账号 + 填私密仓库 + 设 6 位密码 + 选间隔）、
 * 立即备份、远端备份清单、跨机恢复（粘贴密码 → 预览 → 确认恢复）。
 * 安全：密码只经表单提交，后端存本机 0600；界面绝不回显密码。
 */
import { useCallback, useEffect, useState } from 'react'
import type { BackupStatus } from '../../protocol.ts'
import type { DevforgeApi } from '../api.ts'
import css from './panel.module.css'

export interface BackupTabProps {
  api: DevforgeApi
}

/** 远端备份文件行。 */
interface RemoteBackupRow {
  path: string
  size: number
  modifiedAt?: number
}

export function BackupTab({ api }: BackupTabProps): JSX.Element {
  const [status, setStatus] = useState<BackupStatus | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  // 配置表单
  const [accountAlias, setAccountAlias] = useState('')
  const [repo, setRepo] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [interval, setIntervalChoice] = useState('1h')
  // 恢复流程
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [restorePassword, setRestorePassword] = useState('')
  const [preview, setPreview] = useState<{ machine: string; createdAt: number; files: string[] } | undefined>(undefined)
  const [backups, setBackups] = useState<RemoteBackupRow[]>([])

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setError('')
      const data = await api.backupStatus()
      setStatus(data)
      setAccountAlias(data.settings.accountAlias)
      setRepo(data.settings.repo)
      setIntervalChoice(data.settings.interval)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { void refresh() }, [refresh])

  const saveConfig = useCallback(async (enabled: boolean): Promise<void> => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (password !== '' && password !== confirmPassword) {
        throw new Error('两次输入的密码不一致。')
      }
      const result = await api.backupConfig({
        enabled,
        accountAlias,
        repo,
        interval,
        ...(password !== '' ? { password } : {}),
      })
      if (!result.ok) throw new Error('保存失败。')
      setPassword('')
      setConfirmPassword('')
      setNotice(enabled ? '备份已启用并开始自动同步。' : '备份已停用。')
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [api, accountAlias, repo, interval, password, confirmPassword, refresh])

  const runNow = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await api.backupNow(true)
      if (result.ok) {
        setNotice(result.skipped !== undefined ? '本次无内容变化，已跳过推送。' : '备份已推送到 CNB（' + String(result.size ?? 0) + ' 字节）。')
      } else {
        throw new Error(result.error ?? result.skipped ?? '备份失败。')
      }
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [api, refresh])

  const loadBackups = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const data = await api.backupList()
      setBackups(data.backups)
      setNotice('已拉取远端备份清单。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [api])

  const doPreview = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const data = await api.backupPreview(restorePassword)
      setPreview({ machine: data.machine, createdAt: data.createdAt, files: data.files })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [api, restorePassword])

  const doRestore = useCallback(async (): Promise<void> => {
    if (!window.confirm('恢复会覆盖本机的服务工厂账号、主机与密钥数据（覆盖前自动备份现有文件），确认继续？')) return
    setBusy(true)
    setError('')
    try {
      const data = await api.backupRestore(restorePassword)
      setNotice('已恢复：' + data.restoredFiles.join('、') + '。请重启 DSH 使恢复的数据全部生效。')
      setRestoreOpen(false)
      setPreview(undefined)
      setRestorePassword('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [api, restorePassword])

  const settings = status?.settings
  const state = status?.state

  return (
    <section className={css['tabBody']} data-dsh-part="cnb-backup">
      <div className={css['toolbar']}>
        <span className={css['sectionHint']}>插件数据加密备份到 CNB 私密仓库（store.db + 飞书配置）</span>
        <span className={css['toolbarSpacer']} />
        <button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void runNow() }}>立即备份</button>
        <button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void loadBackups() }}>查看远端备份</button>
        <button type="button" className={css['ghostButton']} onClick={() => { setRestoreOpen(value => !value); setPreview(undefined) }}>从 CNB 恢复</button>
      </div>

      {error !== '' && <div className={css['banner']} data-kind="error">{error}</div>}
      {notice !== '' && <div className={css['banner']} data-kind="info">{notice}</div>}
      {loading && <div className={css['empty']} data-loading="">正在加载备份状态…</div>}

      {!loading && status !== undefined && (
        <>
          <div className={css['securityList']} data-dsh-part="backup-summary">
            <div className={css['resourceRow']}>
              <div className={css['resourceInfo']}>
                <strong className={css['resourceTitle']}>{settings?.enabled === true ? '自动同步已启用' : '自动同步未启用'}</strong>
                <span className={css['resourceMeta']}>
                  {settings?.enabled === true
                    ? '仓库 ' + settings.repo + ' · 间隔 ' + settings.interval + (status.passwordSet ? ' · 密码已设置' : '')
                    : '在下方配置仓库与 6 位密码后启用'}
                </span>
                <span className={css['resourceMessage']}>
                  {state?.lastPushAt !== undefined
                    ? '上次推送：' + new Date(state.lastPushAt).toLocaleString() + (state.lastSize !== undefined ? '（' + String(state.lastSize) + ' 字节）' : '')
                    : '从未推送过备份'}
                  {state?.consecutiveFailures !== undefined && state.consecutiveFailures > 0 ? ' · 连续失败 ' + String(state.consecutiveFailures) + ' 次' : ''}
                </span>
              </div>
              <span className={css['transportBadge']} data-transport={settings?.enabled === true ? 'ssh' : 'winrm'}>{settings?.enabled === true ? '运行中' : '停用'}</span>
            </div>
          </div>

          <div className={css['formGrid']} data-dsh-part="backup-config">
            <label className={css['field']}>
              <span>CNB 账号</span>
              <select value={accountAlias} onChange={event => setAccountAlias(event.target.value)}>
                {(status.accounts.length > 0 ? status.accounts : ['']).map(alias => (
                  <option key={alias} value={alias}>{alias === '' ? '（尚未配置 CNB 账号）' : alias}</option>
                ))}
              </select>
            </label>
            <label className={css['field']}>
              <span>备份仓库（须私密，owner/name）</span>
              <input value={repo} onChange={event => setRepo(event.target.value)} placeholder="andyfan1094/dsh-devforge-backup" />
            </label>
            <label className={css['field']}>
              <span>6 位备份密码{status.passwordSet ? '（已设置，留空则不修改）' : ''}</span>
              <input type="password" value={password} onChange={event => setPassword(event.target.value)} maxLength={6} placeholder="6 位" />
            </label>
            <label className={css['field']}>
              <span>确认密码</span>
              <input type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} maxLength={6} />
            </label>
            <label className={css['field']}>
              <span>同步间隔</span>
              <select value={interval} onChange={event => setIntervalChoice(event.target.value)}>
                <option value="15m">每 15 分钟</option>
                <option value="1h">每 1 小时</option>
                <option value="6h">每 6 小时</option>
                <option value="24h">每 24 小时</option>
              </select>
            </label>
            <div className={css['fieldActions']}>
              {settings?.enabled === true
                ? <button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void saveConfig(false) }}>停用自动同步</button>
                : <button type="button" className={css['primaryButton']} disabled={busy || repo.trim() === ''} onClick={() => { void saveConfig(true) }}>启用自动同步</button>}
            </div>
            <p className={css['resourceMessage']}>
              安全说明：密码仅存本机（0600 权限）用于无人值守自动加密；CNB 仓库只存密文。6 位密码建议混合字母与数字。
              启用前请先在 cnb.cool 网页创建【私密】仓库。
            </p>
          </div>
        </>
      )}

      {backups.length > 0 && (
        <div className={css['tableWrap']}>
          <div className={css['resourceList']}>
            {backups.map(backup => (
              <div key={backup.path} className={css['resourceRow']}>
                <div className={css['resourceInfo']}>
                  <strong className={css['resourceTitle']}>{backup.path}</strong>
                  <span className={css['resourceMeta']}>{String(backup.size)} 字节{backup.modifiedAt !== undefined ? ' · ' + new Date(backup.modifiedAt).toLocaleString() : ''}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {restoreOpen && (
        <div className={css['formGrid']} data-dsh-part="backup-restore">
          <label className={css['field']}>
            <span>6 位备份密码（换电脑恢复时输入）</span>
            <input type="password" value={restorePassword} onChange={event => setRestorePassword(event.target.value)} maxLength={6} placeholder="6 位" />
          </label>
          <div className={css['fieldActions']}>
            <button type="button" className={css['ghostButton']} disabled={busy || restorePassword.length !== 6} onClick={() => { void doPreview() }}>预览远端备份</button>
            {preview !== undefined && (
              <button type="button" className={css['primaryButton']} disabled={busy} onClick={() => { void doRestore() }}>确认恢复</button>
            )}
          </div>
          {preview !== undefined && (
            <p className={css['resourceMessage']}>
              远端备份来自 {preview.machine}，备份时间 {new Date(preview.createdAt).toLocaleString()}，包含：{preview.files.join('、')}。
              恢复会覆盖本机现有数据（自动先备份），完成后需重启 DSH。
            </p>
          )}
        </div>
      )}
    </section>
  )
}
