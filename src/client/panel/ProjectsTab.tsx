/**
 * 项目面板 —— 天工造梦操作台「项目」页签。
 *
 * 登记本机维护的项目：项目路径、项目描述、对应代码仓库（CNB / GitHub /
 * 其他 Git）与发布对应的服务器（关联远程运维 SSH/WinRM 主机别名）。
 * 「检测仓库」只读本机 .git 元数据自动回填远端与分支；「扫描登记」在常用
 * 代码根发现未登记仓库后勾选批量登记；路径失效（跨机恢复备份后常见）时
 * 可「重定位」或采纳自动匹配建议；所有请求统一经过 DevforgeApi；本页不
 * 保存任何凭据，服务器只记录主机别名。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { RemoteHostSummary } from '../../protocol.ts'
import type { AutomatchSuggestion, ProjectDetectResult, ProjectEntry, ProjectScanResult, RepoKind, ScannedProject } from '../../projects/protocol.ts'
import css from './panel.module.css'

/** 仓库类型的中文展示与徽标配色。 */
const REPO_KIND_LABEL: Record<RepoKind, string> = {
  none: '未关联',
  cnb: 'CNB',
  github: 'GitHub',
  git: 'Git',
}

/** 将未知异常规整成可展示文本。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 项目表单的可编辑字段集合。 */
interface ProjectFormState {
  id: string
  name: string
  path: string
  description: string
  repoKind: RepoKind
  repoUrl: string
  repoBranch: string
  siteUrl: string
  deployTargets: Array<{ transport: 'ssh' | 'winrm'; alias: string }>
}

/** 空表单。 */
function emptyForm(): ProjectFormState {
  return { id: '', name: '', path: '', description: '', repoKind: 'none', repoUrl: '', repoBranch: '', siteUrl: '', deployTargets: [] }
}

/** 由既有条目构造表单。 */
function formFromEntry(entry: ProjectEntry): ProjectFormState {
  return {
    id: entry.id,
    name: entry.name,
    path: entry.path,
    description: entry.description,
    repoKind: entry.repoKind,
    repoUrl: entry.repoUrl,
    repoBranch: entry.repoBranch,
    siteUrl: entry.siteUrl,
    deployTargets: entry.deployTargets.map((target) => ({ transport: target.transport, alias: target.alias })),
  }
}

/** 内嵌页属性。 */
export interface ProjectsTabProps {
  /** 天工造梦统一 API 客户端。 */
  api: DevforgeApi
}

/** 天工造梦项目面板。 */
export function ProjectsTab({ api }: ProjectsTabProps): JSX.Element {
  const [projects, setProjects] = useState<ProjectEntry[]>([])
  const [hosts, setHosts] = useState<RemoteHostSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  /** null=列表视图；否则为新建/编辑表单。 */
  const [editing, setEditing] = useState<ProjectFormState | null>(null)
  const [detecting, setDetecting] = useState(false)
  /** 扫描登记视图：null=关闭；否则为扫描结果。 */
  const [scan, setScan] = useState<ProjectScanResult | null>(null)
  /** 扫描结果里勾选待登记的候选路径集合。 */
  const [selected, setSelected] = useState<Set<string>>(new Set())
  /** 失效项目的自动匹配建议（id → 建议路径）。 */
  const [suggestions, setSuggestions] = useState<Map<string, AutomatchSuggestion>>(new Map())
  /** 挂载后是否已完成过一次静默分支刷新（防重复写库）。 */
  const refreshedOnce = useRef(false)

  /** 加载项目清单与远程主机（主机失败不阻塞项目列表）。 */
  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const [nextProjects, nextHosts] = await Promise.all([
        api.listProjects(),
        api.listRemoteHosts().catch(() => [] as RemoteHostSummary[]),
      ])
      setProjects(nextProjects)
      setHosts(nextHosts)
      // 有路径失效的登记项时，顺带取一次自动匹配建议（失败不阻塞列表）。
      if (nextProjects.some((entry) => entry.pathExists === false)) {
        const list = await api.automatchProjects().catch(() => [] as AutomatchSuggestion[])
        setSuggestions(new Map(list.map((item) => [item.id, item])))
      } else {
        setSuggestions(new Map())
      }
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { void refresh() }, [refresh])

  /** 打开面板后静默刷新一次分支/远端（主动保鲜；失败静默，不打扰首屏）。 */
  useEffect(() => {
    if (refreshedOnce.current) return
    refreshedOnce.current = true
    void api.refreshProjects().then((next) => { setProjects(next) }).catch(() => { /* 静默 */ })
  }, [api])

  /** 统一处理用户操作，错误总在本页呈现且 busy 必定释放。 */
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

  /** 检测项目路径：只读 .git 元数据，自动回填名称/远端/分支。 */
  const detect = async (): Promise<void> => {
    if (editing === null) return
    const path = editing.path.trim()
    if (path === '') {
      setError('请先填写项目路径，再检测仓库。')
      return
    }
    setDetecting(true)
    setError('')
    setNotice('')
    try {
      const result: ProjectDetectResult = await api.detectProject(path)
      setEditing((current) => {
        if (current === null) return current
        const originRemote = result.remotes[0]
        return {
          ...current,
          name: current.name.trim() === '' && result.name !== undefined ? result.name : current.name,
          repoKind: originRemote !== undefined ? originRemote.kind : 'none',
          repoUrl: originRemote !== undefined ? originRemote.url : '',
          repoBranch: result.branch ?? '',
        }
      })
      if (!result.exists) {
        setError(result.error ?? '路径不存在。')
      } else if (!result.isGitRepo) {
        setNotice('目录存在，但不是 Git 仓库（未找到 .git）。')
      } else {
        setNotice('检测成功：已回填仓库信息（远端 origin 优先）。')
      }
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setDetecting(false)
    }
  }

  /** 提取描述：从 package.json / README 取建议文本回填（已有描述时覆盖前请确认）。 */
  const extractDescription = async (): Promise<void> => {
    if (editing === null) return
    const path = editing.path.trim()
    if (path === '') {
      setError('请先填写项目路径，再提取描述。')
      return
    }
    setDetecting(true)
    setError('')
    setNotice('')
    try {
      const result = await api.describeProject(path)
      if (!result.ok || result.description === undefined) {
        setError(result.error ?? '未能提取到描述。')
        return
      }
      if (editing.description.trim() !== '' && !window.confirm('已有描述将被覆盖为提取结果，继续？')) return
      setEditing((current) => (current === null ? current : { ...current, description: result.description ?? current.description }))
      setNotice('已提取描述（来源：' + (result.source ?? '未知') + '），可修改后保存。')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setDetecting(false)
    }
  }

  /** 保存项目（新增或更新）。 */
  const save = async (): Promise<void> => run(async () => {
    if (editing === null) return
    await api.saveProject({
      id: editing.id === '' ? undefined : editing.id,
      name: editing.name,
      path: editing.path,
      description: editing.description,
      repoKind: editing.repoKind,
      repoUrl: editing.repoUrl,
      repoBranch: editing.repoBranch,
      siteUrl: editing.siteUrl,
      deployTargets: editing.deployTargets,
    })
    setEditing(null)
    setNotice('项目已保存。')
    await refresh()
  })

  /** 删除项目（原生确认框）。 */
  const remove = (entry: ProjectEntry): void => {
    void run(async () => {
      if (!window.confirm('确认删除项目「' + entry.name + '」？此操作只删除登记信息，不删除本机文件。')) return
      await api.deleteProject(entry.id)
      setNotice('项目已删除。')
      await refresh()
    })
  }

  /** 扫描本机常用代码根，发现 Git 项目供批量登记。 */
  const startScan = (): void => {
    void run(async () => {
      const result = await api.scanProjects()
      setScan(result)
      setSelected(new Set(result.found.filter((item) => item.registeredId === undefined).map((item) => item.path)))
      if (result.found.length === 0) setNotice('扫描完成：常用目录里没有发现新的 Git 项目。')
    })
  }

  /** 登记勾选的扫描候选（逐个保存；单个失败不中断整批）。 */
  const registerSelected = (): void => {
    void run(async () => {
      if (scan === null) return
      const picked: ScannedProject[] = scan.found.filter((item) => selected.has(item.path))
      let okCount = 0
      const failures: string[] = []
      for (const item of picked) {
        const origin = item.detect.remotes[0]
        try {
          await api.saveProject({
            name: item.name,
            path: item.path,
            repoKind: origin !== undefined ? origin.kind : 'none',
            repoUrl: origin !== undefined ? origin.url : '',
            repoBranch: item.detect.branch ?? '',
          })
          okCount += 1
        } catch (cause) {
          failures.push(item.name + '：' + errorMessage(cause))
        }
      }
      setScan(null)
      setSelected(new Set())
      setNotice('已登记 ' + okCount + ' 个项目。' + (failures.length > 0 ? '失败：' + failures.join('；') : ''))
      await refresh()
    })
  }

  /** 重定位：输入本机新路径并更新映射（prompt 预填自动匹配建议）。 */
  const relocate = (entry: ProjectEntry): void => {
    const suggestion = suggestions.get(entry.id)?.candidatePath ?? ''
    const input = window.prompt('项目「' + entry.name + '」在本机的新路径：', suggestion || entry.path)
    if (input === null) return
    const newPath = input.trim()
    if (newPath === '') return
    void run(async () => {
      const result = await api.relocateProject(entry.id, newPath)
      if (!result.ok) {
        setError(result.error ?? '重定位失败。')
        return
      }
      setNotice('已重定位到 ' + newPath + (result.warn !== undefined ? '。' + result.warn : '。'))
      await refresh()
    })
  }

  /** 勾选/取消一台发布服务器。 */
  const toggleHost = (transport: 'ssh' | 'winrm', alias: string): void => {
    setEditing((current) => {
      if (current === null) return current
      const exists = current.deployTargets.some((target) => target.transport === transport && target.alias === alias)
      return {
        ...current,
        deployTargets: exists
          ? current.deployTargets.filter((target) => !(target.transport === transport && target.alias === alias))
          : [...current.deployTargets, { transport, alias }],
      }
    })
  }

  /** 勾选/取消一个扫描候选。 */
  const toggleCandidate = (path: string): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const inputProps = { autoComplete: 'off' } as const

  return (
    <section className={css['githubWorkspace']} aria-label="项目面板">
      {error !== '' && <div className={css['banner']} data-kind="error">{error}</div>}
      {notice !== '' && <div className={css['banner']} data-kind="info">{notice}</div>}

      {editing === null && scan === null && (
        <div className={css['toolbar']}>
          <span className={css['sectionHint']}>本机项目登记（路径 · 描述 · 仓库 · 发布服务器）</span>
          <span className={css['toolbarSpacer']} />
          <button type="button" className={css['ghostButton']} onClick={() => { void refresh() }}>刷新</button>
          <button type="button" className={css['ghostButton']} disabled={busy} onClick={startScan}>
            {busy ? '处理中…' : '扫描登记'}
          </button>
          <button type="button" className={css['primaryButton']} onClick={() => { setEditing(emptyForm()) }}>新建项目</button>
        </div>
      )}

      {editing === null && scan === null && loading && <div className={css['empty']} data-loading="">正在加载项目清单…</div>}
      {editing === null && scan === null && !loading && projects.length === 0 && (
        <div className={css['empty']}>还没有登记项目：点「扫描登记」自动发现，或「新建项目」手动登记。</div>
      )}

      {editing === null && scan === null && projects.length > 0 && (
        <div className={css['tableWrap']}>
          <div className={css['resourceList']}>
            {projects.map((entry) => (
              <div key={entry.id} className={css['resourceRow']}>
                <div className={css['resourceInfo']}>
                  <strong className={css['resourceTitle']}>{entry.name}</strong>
                  {entry.pathExists === false && (
                    <span className={css['badge']} data-status="failed">路径失效</span>
                  )}
                  {entry.description.trim() !== '' && (
                    <span className={css['resourceMeta']}>{entry.description}</span>
                  )}
                  <span className={css['resourceMeta']}>路径：{entry.path}</span>
                  <span className={css['resourceMeta']}>
                    仓库：<span className={css['badge']} data-kind={entry.repoKind}>{REPO_KIND_LABEL[entry.repoKind]}</span>{' '}
                    {entry.repoUrl !== '' ? entry.repoUrl : '—'}
                    {entry.repoBranch !== '' && ' · ' + entry.repoBranch}
                  </span>
                  {entry.siteUrl.trim() !== '' && (
                    <span className={css['resourceMeta']}>
                      网址：<a className={css['link']} href={entry.siteUrl} target="_blank" rel="noopener noreferrer">{entry.siteUrl}</a>
                    </span>
                  )}
                  <span className={css['resourceMeta']}>
                    发布服务器：
                    {entry.deployTargets.length === 0
                      ? '—'
                      : entry.deployTargets.map((target) => target.transport + ':' + target.alias).join('、')}
                  </span>
                </div>
                <div className={css['inlineActions']}>
                  {entry.pathExists === false && (
                    <button type="button" className={css['ghostButton']} onClick={() => { relocate(entry) }}>重定位</button>
                  )}
                  <button type="button" className={css['ghostButton']} onClick={() => { setEditing(formFromEntry(entry)) }}>编辑</button>
                  <button type="button" className={css['dangerButton']} onClick={() => { void remove(entry) }}>删除</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {editing === null && scan !== null && (
        <div>
          <div className={css['toolbar']}>
            <span className={css['sectionHint']}>
              扫描结果：{scan.found.length} 个 Git 项目（根：{scan.roots.join('、')}）
            </span>
            <span className={css['toolbarSpacer']} />
            <button type="button" className={css['ghostButton']} onClick={() => { setScan(null) }}>取消</button>
            <button type="button" className={css['primaryButton']} disabled={busy || selected.size === 0} onClick={() => { void registerSelected() }}>
              登记选中（{selected.size}）
            </button>
          </div>
          {scan.found.length === 0 && <div className={css['empty']}>常用目录里没有发现 Git 项目。</div>}
          <div className={css['tableWrap']}>
            <div className={css['resourceList']}>
              {scan.found.map((item) => (
                <div key={item.path} className={css['resourceRow']}>
                  <div className={css['resourceInfo']}>
                    <label className={css['checkRow']}>
                      <input
                        type="checkbox"
                        checked={selected.has(item.path)}
                        disabled={item.registeredId !== undefined}
                        onChange={() => { toggleCandidate(item.path) }}
                      />
                      <strong className={css['resourceTitle']}>{item.name}</strong>
                    </label>
                    <span className={css['resourceMeta']}>{item.path}</span>
                    <span className={css['resourceMeta']}>
                      {item.registeredId !== undefined && <span className={css['badge']} data-status="succeeded">已登记</span>}
                      {' '}
                      {item.detect.remotes.length > 0
                        ? item.detect.remotes[0].kind.toUpperCase() + ' · ' + item.detect.remotes[0].url
                        : '未配置远端'}
                      {item.detect.branch !== undefined && ' · ' + item.detect.branch}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {editing !== null && (
        <div className={css['form']}>
          <div className={css['field']}>
            <label className={css['fieldLabel']} htmlFor="project-name">项目名称</label>
            <input
              id="project-name"
              className={css['input']}
              value={editing.name}
              placeholder="如：天工造梦插件"
              {...inputProps}
              onChange={(event) => { setEditing({ ...editing, name: event.target.value }) }}
            />
          </div>
          <div className={css['field']}>
            <label className={css['fieldLabel']} htmlFor="project-path">项目路径（本机绝对路径，建议统一放 projects/ 目录下）</label>
            <div className={css['inlineActions']}>
              <input
                id="project-path"
                className={css['input']}
                value={editing.path}
                placeholder="/Users/andyfan/Documents/ds/projects/my-project"
                {...inputProps}
                onChange={(event) => { setEditing({ ...editing, path: event.target.value }) }}
              />
              <button type="button" className={css['ghostButton']} disabled={detecting} onClick={() => { void detect() }}>
                {detecting ? '检测中…' : '检测仓库'}
              </button>
            </div>
          </div>
          <div className={css['field']}>
            <label className={css['fieldLabel']} htmlFor="project-desc">项目描述</label>
            <div className={css['inlineActions']}>
              <textarea
                id="project-desc"
                className={css['textarea']}
                rows={3}
                value={editing.description}
                placeholder="这个项目是做什么的（可自动提取）"
                {...inputProps}
                onChange={(event) => { setEditing({ ...editing, description: event.target.value }) }}
              />
              <button type="button" className={css['ghostButton']} disabled={detecting} onClick={() => { void extractDescription() }}>
                提取描述
              </button>
            </div>
          </div>
          <div className={css['formGrid']}>
            <div className={css['field']}>
              <label className={css['fieldLabel']} htmlFor="project-repo-kind">仓库类型</label>
              <select
                id="project-repo-kind"
                className={css['input']}
                value={editing.repoKind}
                onChange={(event) => { setEditing({ ...editing, repoKind: event.target.value as RepoKind }) }}
              >
                <option value="none">未关联</option>
                <option value="cnb">CNB（cnb.cool）</option>
                <option value="github">GitHub</option>
                <option value="git">其他 Git</option>
              </select>
            </div>
            <div className={css['field']}>
              <label className={css['fieldLabel']} htmlFor="project-repo-branch">分支（可选）</label>
              <input
                id="project-repo-branch"
                className={css['input']}
                value={editing.repoBranch}
                placeholder="main"
                {...inputProps}
                onChange={(event) => { setEditing({ ...editing, repoBranch: event.target.value }) }}
              />
            </div>
          </div>
          <div className={css['field']}>
            <label className={css['fieldLabel']} htmlFor="project-repo-url">仓库地址</label>
            <input
              id="project-repo-url"
              className={css['input']}
              value={editing.repoUrl}
              placeholder="https://cnb.cool/owner/repo 或 https://github.com/owner/repo"
              {...inputProps}
              onChange={(event) => { setEditing({ ...editing, repoUrl: event.target.value }) }}
            />
          </div>
          <div className={css['field']}>
            <label className={css['fieldLabel']} htmlFor="project-site">线上地址（发布后的访问网址，可选）</label>
            <input
              id="project-site"
              className={css['input']}
              value={editing.siteUrl}
              placeholder="https://modagentai.com"
              {...inputProps}
              onChange={(event) => { setEditing({ ...editing, siteUrl: event.target.value }) }}
            />
          </div>
          <div className={css['field']}>
            <span className={css['fieldLabel']}>发布对应的服务器（远程运维主机）</span>
            {hosts.length === 0 && <div className={css['resourceMeta']}>远程运维还没有配置主机，可稍后在「远程运维」页签添加。</div>}
            <div className={css['checkRow']}>
              {hosts.map((host) => {
                const checked = editing.deployTargets.some((target) => target.transport === host.transport && target.alias === host.alias)
                return (
                  <label key={host.transport + ':' + host.alias} className={css['checkRow']}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => { toggleHost(host.transport, host.alias) }}
                    />
                    <span className={css['badge']} data-kind={host.transport}>{host.transport.toUpperCase()}</span>
                    {' '}{host.alias}
                  </label>
                )
              })}
            </div>
          </div>
          <div className={css['formFooter']}>
            <button type="button" className={css['ghostButton']} disabled={busy} onClick={() => { setEditing(null) }}>取消</button>
            <button type="button" className={css['primaryButton']} disabled={busy} onClick={() => { void save() }}>
              {busy ? '保存中…' : '保存项目'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
