/**
 * 服务工厂内嵌 CNB（cnb.cool）工作台。
 *
 * 与 GithubTab 同构：账号、仓库、本地 Git、安全设置四个子页；所有请求统一
 * 经过 DevforgeApi；令牌仅在保存时单向提交，Host 返回的账号摘要永远不含
 * 明文令牌。Push 与 Force Push 还会在 Host 端再次校验安全开关。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { AccountSummary, CnbSettings, GitAction, GitResult, RepoSummary } from '../../cnb/protocol.ts'
import { CNB_API_DEFAULT, CNB_WEB_BASE } from '../../cnb/protocol.ts'
import css from './panel.module.css'

/** CNB 工作台内部视图。 */
type CnbView = 'accounts' | 'repos' | 'git' | 'settings'

/** Host 端配置尚未返回时的安全默认值。 */
const DEFAULT_SETTINGS: CnbSettings = {
  apiUrl: CNB_API_DEFAULT,
  gitExecutable: 'git',
  autoFetchOnOpen: false,
  allowPush: false,
  allowForcePush: false,
}

/** 内嵌页属性。 */
export interface CnbTabProps {
  /** 服务工厂统一 API 客户端。 */
  api: DevforgeApi
}

/** 将未知异常规整成可展示文本。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 格式化 Git 命令结果，stdout/stderr 都保留，便于用户判断失败位置。 */
function formatGitResult(result: GitResult): string {
  const lines = [
    result.action + ' · exit ' + String(result.exitCode) + ' · ' + result.durationMs + 'ms',
    result.repoPath !== undefined ? 'repo: ' + result.repoPath : '',
    result.branch !== undefined ? 'branch: ' + result.branch : '',
    result.stdout.trim(),
    result.stderr.trim(),
  ]
  return lines.filter((line) => line !== '').join('\n')
}

/** 服务工厂 CNB 工作台。 */
export function CnbTab({ api }: CnbTabProps): JSX.Element {
  const [view, setView] = useState<CnbView>('accounts')
  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  const [settings, setSettings] = useState<CnbSettings>(DEFAULT_SETTINGS)
  const [repos, setRepos] = useState<RepoSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // 账号表单状态。令牌从不在 Host 回填，避免凭据进入浏览器内存和 DOM。
  const [accountAlias, setAccountAlias] = useState('')
  const [accountToken, setAccountToken] = useState('')
  const [accountApiUrl, setAccountApiUrl] = useState(DEFAULT_SETTINGS.apiUrl)
  const [selectedAccount, setSelectedAccount] = useState('')

  // 仓库与本地 Git 操作状态。
  const [repoSearch, setRepoSearch] = useState('')
  const [action, setAction] = useState<GitAction['action']>('status')
  const [repoPath, setRepoPath] = useState('')
  const [remote, setRemote] = useState('origin')
  const [branch, setBranch] = useState('')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [destination, setDestination] = useState('')
  const [commitMessage, setCommitMessage] = useState('')
  const [stageAll, setStageAll] = useState(true)
  const [forcePush, setForcePush] = useState(false)
  const [gitResult, setGitResult] = useState<GitResult | null>(null)

  /** 当前选中账号；优先用户选择，其次配置默认值，最后取首个账号。 */
  const selected = useMemo(
    () => selectedAccount || settings.defaultAccount || accounts[0]?.alias || '',
    [accounts, selectedAccount, settings.defaultAccount],
  )

  /** 首次与手动刷新同时加载账号和设置，避免页面出现半份状态。 */
  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const [nextAccounts, nextSettings] = await Promise.all([
        api.listCnbAccounts(),
        api.getCnbSettings(),
      ])
      setAccounts(nextAccounts)
      setSettings(nextSettings)
      setSelectedAccount((current) => {
        if (current !== '' && nextAccounts.some((account) => account.alias === current)) return current
        return nextSettings.defaultAccount || nextAccounts[0]?.alias || ''
      })
      setBranch((current) => current || nextSettings.defaultBranch || '')
      setAccountApiUrl((current) => current || nextSettings.apiUrl)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { void refresh() }, [refresh])

  /** 统一处理用户操作，确保错误总在本页呈现且 busy 状态必定释放。 */
  const run = async (operation: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await operation()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  /** 保存账号；编辑已有账号时令牌留空表示保留原值。 */
  const saveAccount = async (): Promise<void> => run(async () => {
    const alias = accountAlias.trim()
    if (alias === '') throw new Error('请输入账号别名')
    await api.saveCnbAccount({
      alias,
      token: accountToken.trim() || undefined,
      apiUrl: accountApiUrl.trim() || undefined,
    })
    setAccountToken('')
    setNotice('账号已保存：' + alias)
    await refresh()
  })

  /** 验证令牌并刷新账号对应的 CNB 用户名。 */
  const testAccount = async (alias: string): Promise<void> => run(async () => {
    const result = await api.testCnbAccount(alias)
    if (!result.ok) throw new Error(result.error || 'CNB 认证失败')
    setNotice('认证成功：' + (result.username || alias))
    await refresh()
  })

  /** 删除账号前二次确认，避免误删本地凭据记录。 */
  const removeAccount = async (alias: string): Promise<void> => {
    if (!window.confirm('删除 CNB 账号 ' + alias + '？')) return
    await run(async () => {
      await api.deleteCnbAccount(alias)
      if (accountAlias === alias) {
        setAccountAlias('')
        setAccountToken('')
        setAccountApiUrl(settings.apiUrl)
      }
      setNotice('账号已删除：' + alias)
      await refresh()
    })
  }

  /** 拉取远端仓库列表；未配置账号时提前阻止无效请求。 */
  const loadRepos = async (): Promise<void> => run(async () => {
    if (selected === '') throw new Error('请先配置 CNB 账号（公开仓库可匿名 Clone，无需账号）')
    setRepos(await api.listCnbRepos(selected, repoSearch.trim() || undefined))
    setNotice('仓库列表已刷新')
  })

  /** 从仓库列表带入 Clone 参数并切换到本地 Git 页。 */
  const prepareClone = (repo: RepoSummary): void => {
    const base = settings.defaultRepoDir?.replace(/[\\/]+$/, '') || ''
    setRemoteUrl(repo.cloneUrl)
    setDestination(base === '' ? '' : base + '/' + repo.name)
    setBranch(repo.defaultBranch || '')
    setAction('clone')
    setView('git')
    setError('')
    setNotice('已带入 ' + repo.fullName + ' 的 Clone 参数')
  }

  /** 执行 Git 操作；Host 会再次校验绝对路径、账号与 Push 权限。 */
  const executeGit = async (): Promise<void> => run(async () => {
    if (action === 'push' && !settings.allowPush) throw new Error('推送尚未授权，请先在安全设置中开启')
    if (action === 'push' && forcePush && !settings.allowForcePush) throw new Error('强制推送尚未授权')
    const result = await api.runCnbGit({
      action,
      account: selected || undefined,
      repoPath: repoPath.trim() || undefined,
      remote: remote.trim() || undefined,
      branch: branch.trim() || undefined,
      remoteUrl: remoteUrl.trim() || undefined,
      destination: destination.trim() || undefined,
      message: commitMessage.trim() || undefined,
      all: stageAll,
      force: forcePush,
    })
    setGitResult(result)
    if (!result.ok) throw new Error(result.error || result.stderr || 'Git 操作失败')
    setNotice(action + ' 执行完成')
  })

  /** 保存设置时同步收紧 Force Push，禁止出现仅开强推但关闭普通推送的矛盾状态。 */
  const saveSettings = async (): Promise<void> => run(async () => {
    const normalized = settings.allowPush ? settings : { ...settings, allowForcePush: false }
    setSettings(await api.saveCnbSettings(normalized))
    setNotice('CNB 设置已保存')
  })

  const accountOptions = accounts.length === 0
    ? <option value="">未配置账号</option>
    : accounts.map((account) => (
      <option key={account.alias} value={account.alias}>
        {account.alias}{account.username ? ' · ' + account.username : ''}
      </option>
    ))

  if (loading) return <div className={css['empty']} data-loading="">正在加载 CNB 配置…</div>

  return (
    <section className={css['githubWorkspace']} aria-label="CNB 工作台">
      <div className={css['subTabBar']} role="tablist" aria-label="CNB 功能">
        <button type="button" role="tab" aria-selected={view === 'accounts'} data-active={view === 'accounts' ? '' : undefined} className={css['subTab']} onClick={() => { setView('accounts') }}>账号</button>
        <button type="button" role="tab" aria-selected={view === 'repos'} data-active={view === 'repos' ? '' : undefined} className={css['subTab']} onClick={() => { setView('repos') }}>仓库</button>
        <button type="button" role="tab" aria-selected={view === 'git'} data-active={view === 'git' ? '' : undefined} className={css['subTab']} onClick={() => { setView('git') }}>本地 Git</button>
        <button type="button" role="tab" aria-selected={view === 'settings'} data-active={view === 'settings' ? '' : undefined} className={css['subTab']} onClick={() => { setView('settings') }}>安全设置</button>
        <span className={css['toolbarSpacer']} />
        <button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void refresh() }}>刷新</button>
      </div>

      {error !== '' && <div className={css['banner']} data-kind="error">{error}</div>}
      {notice !== '' && <div className={css['banner']} data-kind="success">{notice}</div>}

      {view === 'accounts' && (
        <div className={css['githubSplit']}>
          <section className={css['githubSection']}>
            <h3 className={css['sectionTitle']}>添加或更新账号</h3>
            <div className={css['form']}>
              <label className={css['field']}>
                <span className={css['fieldLabel']}>账号别名</span>
                <input className={css['input']} value={accountAlias} onChange={(event) => { setAccountAlias(event.target.value) }} placeholder="例如 cnb-main" autoComplete="off" />
              </label>
              <label className={css['field']}>
                <span className={css['fieldLabel']}>访问令牌</span>
                <input className={css['input']} type="password" value={accountToken} onChange={(event) => { setAccountToken(event.target.value) }} placeholder="cnb.cool → 个人设置 → 访问令牌 创建；编辑时留空保留原值" autoComplete="new-password" />
              </label>
              <label className={css['field']}>
                <span className={css['fieldLabel']}>CNB API 地址</span>
                <input className={css['input']} value={accountApiUrl} onChange={(event) => { setAccountApiUrl(event.target.value) }} />
              </label>
              <div className={css['formFooter']}>
                <button type="button" className={css['primaryButton']} disabled={busy} onClick={() => { void saveAccount() }}>保存账号</button>
                <button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { setAccountAlias(''); setAccountToken(''); setAccountApiUrl(settings.apiUrl) }}>清空</button>
              </div>
            </div>
          </section>

          <section className={css['githubSection']}>
            <h3 className={css['sectionTitle']}>已配置账号</h3>
            {accounts.length === 0 ? (
              <div className={css['empty']}>暂无 CNB 账号（公开仓库可匿名克隆）</div>
            ) : (
              <div className={css['tableScroll']}>
                <table className={css['dataTable']}>
                  <thead><tr><th>别名</th><th>用户</th><th>令牌</th><th>操作</th></tr></thead>
                  <tbody>
                    {accounts.map((account) => (
                      <tr key={account.alias}>
                        <td>{account.alias}</td>
                        <td>{account.username || '未验证'}</td>
                        <td><span className={css['badge']} data-status={account.tokenConfigured ? 'succeeded' : 'failed'}>{account.tokenConfigured ? '已配置' : '未配置'}</span></td>
                        <td>
                          <div className={css['inlineActions']}>
                            <button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { setAccountAlias(account.alias); setAccountApiUrl(account.apiUrl); setAccountToken('') }}>编辑</button>
                            <button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { void testAccount(account.alias) }}>验证</button>
                            <button type="button" className={css['dangerButton']} disabled={busy} onClick={() => { void removeAccount(account.alias) }}>删除</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {view === 'repos' && (
        <section className={css['githubSection']}>
          <div className={css['toolbar']}>
            <label className={css['compactField']}>
              <span className={css['fieldLabel']}>账号</span>
              <select className={css['input']} value={selected} onChange={(event) => { setSelectedAccount(event.target.value) }}>{accountOptions}</select>
            </label>
            <label className={css['compactField']}>
              <span className={css['fieldLabel']}>搜索</span>
              <input className={css['input']} value={repoSearch} onChange={(event) => { setRepoSearch(event.target.value) }} placeholder="仓库名或描述" />
            </label>
            <button type="button" className={css['primaryButton']} disabled={busy || selected === ''} onClick={() => { void loadRepos() }}>查询仓库</button>
          </div>
          {repos.length === 0 ? (
            <div className={css['empty']}>暂无仓库结果</div>
          ) : (
            <div className={css['tableScroll']}>
              <table className={css['dataTable']}>
                <thead><tr><th>仓库</th><th>可见性</th><th>默认分支</th><th>更新时间</th><th>操作</th></tr></thead>
                <tbody>
                  {repos.map((repo) => (
                    <tr key={repo.id}>
                      <td><a className={css['link']} href={repo.htmlUrl} target="_blank" rel="noreferrer">{repo.fullName}</a>{repo.description && <div className={css['resourceMeta']}>{repo.description}</div>}</td>
                      <td>{repo.private ? '私有' : '公开'}</td>
                      <td>{repo.defaultBranch || '—'}</td>
                      <td>{repo.updatedAt || ''}</td>
                      <td><button type="button" className={css['ghostButton']} onClick={() => { prepareClone(repo) }}>准备 Clone</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {view === 'git' && (
        <section className={css['githubSection']}>
          <div className={css['gitGrid']}>
            <label className={css['field']}>
              <span className={css['fieldLabel']}>操作</span>
              <select className={css['input']} value={action} onChange={(event) => { setAction(event.target.value as GitAction['action']); setForcePush(false) }}>
                <option value="status">Status</option><option value="clone">Clone</option><option value="pull">Pull</option><option value="commit">Commit</option><option value="push">Push</option>
              </select>
            </label>
            <label className={css['field']}>
              <span className={css['fieldLabel']}>账号</span>
              <select className={css['input']} value={selected} onChange={(event) => { setSelectedAccount(event.target.value) }}>{accountOptions}</select>
            </label>
            <label className={css['field']}>
              <span className={css['fieldLabel']}>Remote</span>
              <input className={css['input']} value={remote} onChange={(event) => { setRemote(event.target.value) }} />
            </label>
            <label className={css['field']}>
              <span className={css['fieldLabel']}>分支</span>
              <input className={css['input']} value={branch} onChange={(event) => { setBranch(event.target.value) }} placeholder="留空使用当前分支" />
            </label>
          </div>

          {action !== 'clone' && (
            <label className={css['field']}>
              <span className={css['fieldLabel']}>本地仓库绝对路径</span>
              <input className={css['input']} value={repoPath} onChange={(event) => { setRepoPath(event.target.value) }} placeholder="例如 /Users/xxx/Projects/repository" />
            </label>
          )}
          {action === 'clone' && (
            <div className={css['githubSplit']}>
              <label className={css['field']}>
                <span className={css['fieldLabel']}>Clone URL</span>
                <input className={css['input']} value={remoteUrl} onChange={(event) => { setRemoteUrl(event.target.value) }} placeholder={CNB_WEB_BASE + '/组织路径/仓库路径.git（支持多段嵌套）'} />
              </label>
              <label className={css['field']}>
                <span className={css['fieldLabel']}>目标绝对目录</span>
                <input className={css['input']} value={destination} onChange={(event) => { setDestination(event.target.value) }} placeholder="例如 /Users/xxx/Projects/repository" />
              </label>
            </div>
          )}
          {action === 'commit' && (
            <label className={css['field']}>
              <span className={css['fieldLabel']}>提交说明</span>
              <textarea className={[css['input'], css['textarea']].filter(Boolean).join(' ')} value={commitMessage} onChange={(event) => { setCommitMessage(event.target.value) }} />
            </label>
          )}

          <div className={css['formFooter']}>
            {action === 'commit' && <label className={css['checkRow']}><input type="checkbox" checked={stageAll} onChange={(event) => { setStageAll(event.target.checked) }} />提交全部变更</label>}
            {action === 'push' && <label className={css['checkRow']}><input type="checkbox" checked={forcePush} disabled={!settings.allowForcePush} onChange={(event) => { setForcePush(event.target.checked) }} />Force with lease</label>}
            <span className={css['toolbarSpacer']} />
            <button type="button" className={css['primaryButton']} disabled={busy || (action === 'push' && !settings.allowPush)} onClick={() => { void executeGit() }}>执行 {action}</button>
          </div>
          {action === 'push' && !settings.allowPush && <div className={css['banner']} data-kind="warning">推送当前关闭，请先在“安全设置”中显式授权。</div>}
          {gitResult !== null && <pre className={css['resultOutput']}>{formatGitResult(gitResult)}</pre>}
        </section>
      )}

      {view === 'settings' && (
        <div className={css['githubSplit']}>
          <section className={css['githubSection']}>
            <h3 className={css['sectionTitle']}>CNB 与 Git</h3>
            <div className={css['form']}>
              <label className={css['field']}><span className={css['fieldLabel']}>默认 API 地址</span><input className={css['input']} value={settings.apiUrl} onChange={(event) => { setSettings({ ...settings, apiUrl: event.target.value }) }} /></label>
              <label className={css['field']}><span className={css['fieldLabel']}>Git 可执行文件</span><input className={css['input']} value={settings.gitExecutable} onChange={(event) => { setSettings({ ...settings, gitExecutable: event.target.value }) }} /></label>
              <label className={css['field']}><span className={css['fieldLabel']}>默认账号</span><select className={css['input']} value={settings.defaultAccount || ''} onChange={(event) => { setSettings({ ...settings, defaultAccount: event.target.value || undefined }) }}><option value="">自动选择</option>{accountOptions}</select></label>
              <label className={css['field']}><span className={css['fieldLabel']}>默认仓库目录</span><input className={css['input']} value={settings.defaultRepoDir || ''} onChange={(event) => { setSettings({ ...settings, defaultRepoDir: event.target.value }) }} placeholder="例如 /Users/xxx/Projects" /></label>
              <label className={css['field']}><span className={css['fieldLabel']}>默认分支</span><input className={css['input']} value={settings.defaultBranch || ''} onChange={(event) => { setSettings({ ...settings, defaultBranch: event.target.value }) }} /></label>
            </div>
          </section>
          <section className={css['githubSection']}>
            <h3 className={css['sectionTitle']}>操作安全</h3>
            <div className={css['securityList']}>
              <label className={css['checkRow']}><input type="checkbox" checked={settings.autoFetchOnOpen} onChange={(event) => { setSettings({ ...settings, autoFetchOnOpen: event.target.checked }) }} />打开 CNB 工作台时允许自动拉取</label>
              <label className={css['checkRow']}><input type="checkbox" checked={settings.allowPush} onChange={(event) => { setSettings({ ...settings, allowPush: event.target.checked, allowForcePush: event.target.checked ? settings.allowForcePush : false }) }} />允许 Agent 和面板推送</label>
              <label className={css['checkRow']}><input type="checkbox" checked={settings.allowForcePush} disabled={!settings.allowPush} onChange={(event) => { setSettings({ ...settings, allowForcePush: event.target.checked }) }} />允许强制推送</label>
            </div>
            <div className={css['formFooter']}><span className={css['toolbarSpacer']} /><button type="button" className={css['primaryButton']} disabled={busy} onClick={() => { void saveSettings() }}>保存设置</button></div>
          </section>
        </div>
      )}
    </section>
  )
}
