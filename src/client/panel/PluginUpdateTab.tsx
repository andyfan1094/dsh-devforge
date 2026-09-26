/**
 * 天工造梦内的插件更新页（0.40.1 辉哥定稿改版）：
 * - 顶部官网登录态卡：直接复用个人中心的官网登录（session token），下载自动带凭据，
 *   不再要求单独配置账号密码；手动账号表单保留为折叠的备用通道。
 * - 插件行直接显示「更新了什么」（官网清单 notes + 最近版本日志）。
 * - DSH 本体支持一键升级（Host 代跑 npm/pnpm 全局安装，版本由 Host 实时拉官方 tags 决定），
 *   完成后仍须点「重启」生效；复制命令保留为失败兜底。
 * 红点聚合判定在 DevforgePanel：仅当任一项确认 update-available 才亮。
 */
import { useEffect, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import { PLUGIN_UPDATE_DEFAULT_SITE_API, PLUGIN_UPDATE_SITE_USERNAME_RE, type PluginUpdateSiteView } from '../../plugin-update.ts'
import type { UpdateCheckItem } from '../../plugin-update.ts'
import type { HarnessUpdateCheckItem } from '../../harness-update.ts'
import css from './panel.module.css'

/** 插件行状态徽标文案。 */
const STATUS_LABEL: Record<UpdateCheckItem['status'], string> = {
  'up-to-date': '已是最新',
  'update-available': '可更新',
  'installed-unknown': '本机未安装',
  error: '检查失败',
}

/** 本体行状态文案（检查失败带原因，红点判定由父组件按 status 计算）。 */
function harnessStatusLabel(item: HarnessUpdateCheckItem): string {
  if (item.status === 'update-available') return '可更新'
  if (item.status === 'up-to-date') return item.reason !== '' ? item.reason : '已是最新'
  if (item.status === 'installed-unknown') return item.reason !== '' ? item.reason : '未能识别本机版本'
  return item.reason !== '' ? '检查失败：' + item.reason : '检查失败'
}

/** 更新检查聚合状态（DevforgePanel 持有，页签打开即检查、手动刷新复用）。 */
export interface UpdateCheckState {
  /** 任一路检查进行中；期间红点必须熄灭，防止误亮。 */
  loading: boolean
  /** 插件更新能力开关（false 时插件区显示提示）。 */
  enabled: boolean
  /** 插件登记源检查结果。 */
  items: UpdateCheckItem[]
  /** DSH 本体检查结果；接口异常时为带 error 状态的占位项。 */
  harness: HarnessUpdateCheckItem | null
  /** 插件检查通道错误（本体错误在其自身状态里）。 */
  error: string
}

/** 复制文本到剪贴板；优先 navigator.clipboard，失败退回隐藏 textarea + execCommand。 */
function copyText(text: string): boolean {
  const fallback = (): boolean => {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(area)
      return ok
    } catch {
      return false
    }
  }
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
      // localhost 是安全上下文，clipboard API 可用；万一被拒再走兜底。
      void navigator.clipboard.writeText(text).catch(() => fallback())
      return true
    }
  } catch {
    return fallback()
  }
  return fallback()
}

/** 更新日志块：最新版说明 + 最近版本列表（0.40.1 辉哥需求「直接显示更新了什么」）。 */
function changelogBlock(item: UpdateCheckItem): JSX.Element | null {
  const entries = (item.history ?? []).filter((entry) => (entry.notes ?? '') !== '')
  if (entries.length === 0) return null
  return (
    <div className={css['updateLog']}>
      {entries.map((entry, index) => (
        <div key={entry.version} className={css['updateLogRow']}>
          <span className={css['updateLogVersion']}>v{entry.version}{entry.date !== undefined ? ' · ' + entry.date : ''}{index === 0 ? ' · 最新' : ''}</span>
          <span className={css['updateLogNotes']}>{entry.notes}</span>
        </div>
      ))}
    </div>
  )
}

/** 插件更新页签组件（检查状态由父组件注入；升级动作仍在本页触发）。 */
export function PluginUpdateTab({ api, state, onRefresh }: { api: DevforgeApi; state: UpdateCheckState; onRefresh: () => void }): JSX.Element {
  const [busy, setBusy] = useState('')
  const [copied, setCopied] = useState('')
  const [applyError, setApplyError] = useState('')
  const [done, setDone] = useState('')
  const { items, harness, enabled, loading, error } = state

  // —— 官网登录态（0.40.1：复用个人中心登录，不再强制单独配账号）。 ——
  const [session, setSession] = useState<{ loggedIn: boolean; username: string; role: '' | 'admin' | 'user'; expired: boolean } | null>(null)

  useEffect(() => {
    void api.getModagentaiStatus().then((status) => {
      setSession({ loggedIn: status.loggedIn, username: status.username, role: status.role, expired: status.expired })
    }).catch(() => { setSession(null) })
  }, [api])

  // —— 手动账号备用表单（折叠；登录态失效且无法重登时才需要）。 ——
  const [siteState, setSiteState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [site, setSite] = useState<PluginUpdateSiteView | null>(null)
  const [siteLoadError, setSiteLoadError] = useState('')
  const [formApiUrl, setFormApiUrl] = useState('')
  const [formUsername, setFormUsername] = useState('')
  const [formPassword, setFormPassword] = useState('')
  const [siteSaving, setSiteSaving] = useState(false)
  const [siteSaveError, setSiteSaveError] = useState('')
  const [siteSaved, setSiteSaved] = useState('')

  /** 读取官网账号设置（脱敏视图）；失败进错误态可重试。 */
  const loadSite = (): void => {
    void (async () => {
      try {
        setSiteState('loading')
        setSiteLoadError('')
        const view = await api.getPluginUpdateSite()
        setSite(view)
        setFormApiUrl(view.apiUrl)
        setFormUsername(view.username)
        setFormPassword('')
        setSiteState('ready')
      } catch (e) {
        setSiteLoadError(e instanceof Error ? e.message : String(e))
        setSiteState('error')
      }
    })()
  }

  /** 保存官网账号：先做前置校验（用户名格式/密码长度/地址协议），通过后 PUT。 */
  const saveSite = (): void => {
    if (siteSaving) return
    const username = formUsername.trim()
    const apiUrl = formApiUrl.trim()
    if (!PLUGIN_UPDATE_SITE_USERNAME_RE.test(username)) {
      setSiteSaveError('用户名格式不正确：3-32 位字母、数字或下划线')
      return
    }
    if (formPassword !== '' && formPassword.length < 8) {
      setSiteSaveError('密码至少 8 位')
      return
    }
    if (apiUrl !== '' && !apiUrl.startsWith('https://')) {
      setSiteSaveError('官网地址必须以 https:// 开头（留空使用默认官网）')
      return
    }
    void (async () => {
      try {
        setSiteSaving(true)
        setSiteSaveError('')
        setSiteSaved('')
        // password 空串 = 不修改已存密码（Host 侧规则，首次设置必须非空）。
        const view = await api.putPluginUpdateSite({ apiUrl, username, password: formPassword })
        setSite(view)
        setFormPassword('')
        setSiteSaved('已保存，常驻生效')
      } catch (e) {
        setSiteSaveError(e instanceof Error ? e.message : String(e))
      } finally {
        setSiteSaving(false)
      }
    })()
  }

  /** 一键升级（仅插件行）：完成后刷新列表并提示重启生效。 */
  const upgrade = (item: UpdateCheckItem): void => {
    if (busy !== '') return
    void (async () => {
      try {
        setBusy(item.packageName)
        setApplyError('')
        setDone('')
        const result = await api.applyPluginUpdate(item.packageName)
        setDone('已升级 ' + result.packageName + ' 到 v' + result.version + '：请点左下角「设置」旁的「重启」按钮生效。')
        onRefresh()
      } catch (e) {
        setApplyError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy('')
      }
    })()
  }

  /** DSH 本体一键升级（0.40.1）：Host 代跑 npm/pnpm 全局安装，完成后提示重启。 */
  const upgradeHarness = (): void => {
    if (busy !== '') return
    void (async () => {
      try {
        setBusy('harness')
        setApplyError('')
        setDone('')
        const result = await api.applyHarnessUpgrade()
        setDone('DSH 本体已升级到 v' + result.version + '：请点左下角「设置」旁的「重启」按钮生效。')
        onRefresh()
      } catch (e) {
        setApplyError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy('')
      }
    })()
  }

  /** 复制本体升级命令并短暂回显「已复制」。 */
  const copyUpgradeCommand = (command: string): void => {
    if (copyText(command)) {
      setCopied('harness')
      window.setTimeout(() => { setCopied('') }, 2000)
    } else {
      setApplyError('复制失败，请手动复制：' + command)
    }
  }

  const bannerError = [error, applyError].filter((text) => text !== '').join('；')

  return (
    <section className={css['tabBody']}>
      <div className={css['toolbar']}>
        <strong>插件更新</strong>
        <span className={css['sectionHint']}>插件对比官网清单（下载自动复用面板登录态）；DSH 本体对比官方 GitHub Tags，可一键升级；升级后需重启 DSH 生效</span>
        <span className={css['toolbarSpacer']} />
        <button type="button" className={css['ghostButton']} disabled={loading} onClick={onRefresh}>检查更新</button>
      </div>
      {/* 官网登录态卡：复用个人中心登录（session token），下载自动带凭据；手动账号收进折叠备用。 */}
      <section className={css['memoryPanel']}>
        <div className={css['panelHeading']}>
          <div>
            <h3 className={css['sectionTitle']}>官网登录态</h3>
            <p className={css['sectionHint']}>与个人中心共用同一份登录：已登录时插件下载自动带凭据，无需再配账号密码</p>
          </div>
          {session === null ? (
            <span className={css['badge']} data-status="unknown">状态未知</span>
          ) : session.loggedIn && !session.expired ? (
            <span className={css['badge']} data-status="ok">已登录 · {session.username}{session.role === 'admin' ? '（管理员）' : ''}</span>
          ) : (
            <span className={css['badge']} data-status="error">未登录或已失效</span>
          )}
        </div>
        {session !== null && session.loggedIn && !session.expired && (
          <div className={css['sectionHint']}>下载与检查更新将携带此登录态（Bearer 会话令牌）；令牌只存本机 store.db，绝不回显。</div>
        )}
        {session !== null && (!session.loggedIn || session.expired) && (
          <div className={css['banner']} data-kind="error">官网未登录或会话已失效：请到「个人中心」重新登录官网账号后再升级插件；也可在下方展开配置手动账号。</div>
        )}
        <details className={css['siteFallback']}>
          <summary className={css['sectionHint']}>备用：手动配置官网账号（一般无需填写）</summary>
          {siteState === 'loading' && <div className={css['empty']} data-loading="">正在读取官网账号配置…</div>}
          {siteState === 'error' && (
            <div className={css['memoryForm']}>
              <div className={css['banner']} data-kind="error">官网账号配置读取失败：{siteLoadError}</div>
              <div className={css['formFooter']}><button type="button" className={css['ghostButton']} onClick={loadSite}>重新加载</button></div>
            </div>
          )}
          {siteState === 'ready' && site !== null && (
            <div className={css['memoryForm']}>
              {siteSaveError !== '' && <div className={css['banner']} data-kind="error">{siteSaveError}</div>}
              {siteSaved !== '' && <div className={css['banner']} data-kind="success">{siteSaved}</div>}
              <div className={css['compactFields']}>
                <label className={css['compactField']}>
                  <span className={css['fieldLabel']}>官网地址（留空用默认）</span>
                  <input className={css['input']} value={formApiUrl} placeholder={PLUGIN_UPDATE_DEFAULT_SITE_API} onChange={(e) => { setFormApiUrl(e.target.value); setSiteSaved('') }}/>
                </label>
                <label className={css['compactField']}>
                  <span className={css['fieldLabel']}>用户名</span>
                  <input className={css['input']} value={formUsername} placeholder="官网账号（管理员分配）" onChange={(e) => { setFormUsername(e.target.value); setSiteSaved('') }}/>
                </label>
                <label className={css['compactField']}>
                  <span className={css['fieldLabel']}>密码{site.hasPassword ? <span className={css['sectionHint']}> {site.passwordMask}</span> : null}</span>
                  <input className={css['input']} type="password" autoComplete="new-password" value={formPassword} placeholder={site.hasPassword ? '已设置——留空表示不修改' : '未设置'} onChange={(e) => { setFormPassword(e.target.value); setSiteSaved('') }}/>
                </label>
              </div>
              <div className={css['formFooter']}>
                <span className={css['sectionHint']}>密码仅存本机 store.db（随 CNB 加密备份），接口只回传「是否已设置」，不回显明文。</span>
                <button type="button" className={css['primaryButton']} disabled={siteSaving} onClick={saveSite}>{siteSaving ? '保存中…' : '保存官网账号'}</button>
              </div>
            </div>
          )}
        </details>
      </section>
      {bannerError !== '' && <div className={css['banner']} data-kind="error">{bannerError}</div>}
      {done !== '' && <div className={css['banner']} data-kind="success">{done}</div>}
      {loading && <div className={css['empty']} data-loading="">正在检查更新…</div>}
      {!loading && harness !== null && (
        <div className={css['metricList']}>
          {/* DSH 本体行：本地版本 / 官方最新 / GitHub 来源 / 可更新状态 + 一键升级（0.40.1）。 */}
          <div className={css['metricRow']}>
            <span>
              <strong>DeepSeek Harness（DSH 本体）</strong>
              <span className={css['sectionHint']}> GitHub Tags</span>
            </span>
            <strong>
              本地 {harness.installed === '' ? '未识别' : 'v' + harness.installed}
              {harness.latest !== '' ? ' · 官方最新 v' + harness.latest + '（' + harness.latestTag + '）' : ''}
              {' · GitHub'}
              {' · ' + harnessStatusLabel(harness)}
            </strong>
            {harness.status === 'update-available' && harness.upgrade !== null && (
              <span className={css['inlineActions']}>
                <button type="button" className={css['primaryButton']} disabled={busy !== ''} onClick={upgradeHarness}>
                  {busy === 'harness' ? '升级中…（约 1-3 分钟）' : '一键升级'}
                </button>
                <a className={css['link']} href={harness.tagUrl} target="_blank" rel="noopener noreferrer">查看官方版本</a>
                <button type="button" className={css['ghostButton']} onClick={() => copyUpgradeCommand(harness.upgrade !== null ? harness.upgrade.command : '')}>
                  {copied === 'harness' ? '已复制 ✓' : '复制命令兜底'}
                </button>
              </span>
            )}
          </div>
        </div>
      )}
      {!loading && harness !== null && harness.status === 'update-available' && harness.upgrade !== null && (
        <div className={css['banner']}>
          DSH 本体有新版：点「一键升级」由面板代为执行 npm 升级（当前安装方式：{harness.upgrade.manager === 'npm' ? 'npm 全局' : harness.upgrade.manager === 'pnpm' ? 'pnpm 全局' : '未识别，请用复制命令'}；{harness.upgrade.evidence}），完成后点左下角「设置」旁的「重启」按钮生效。升级失败时用「复制命令兜底」在终端手动执行。
        </div>
      )}
      {!loading && !enabled && <div className={css['empty']}>插件更新能力已关闭（请在设置中开启）；DSH 本体检查不受此开关影响</div>}
      {!loading && enabled && items.length === 0 && <div className={css['empty']}>更新源登记表为空（可在设置里登记「包名 → 官网清单或 GitHub 仓库」）</div>}
      {!loading && enabled && items.length > 0 && (
        <div className={css['metricList']}>
          {items.map((item) => (
            <div key={item.packageName} className={css['metricRow']}>
              <span>
                <strong>{item.packageName}</strong>
                <span className={css['sectionHint']}> {item.via === 'site' ? '官网发布' : ''}</span>
              </span>
              <strong>
                本地 {item.installed === '' ? '未装' : 'v' + item.installed}
                {item.latest !== '' ? ' · 最新 v' + item.latest : ''}
                {item.via !== 'none' ? ' · ' + (item.via === 'site' ? '官网' : 'GitHub') : ''}
                {item.status === 'update-available' ? ' · 可更新' : item.reason !== '' ? ' · ' + item.reason : ' · ' + STATUS_LABEL[item.status]}
              </strong>
              <button
                type="button"
                className={css['ghostButton']}
                disabled={busy !== '' || item.status !== 'update-available' || item.assetUrl === ''}
                onClick={() => upgrade(item)}
              >
                {busy === item.packageName ? '升级中…' : '一键升级'}
              </button>
              {changelogBlock(item)}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
