/**
 * 天工造梦内的插件更新页：顶部官网账号设置卡（登录制下载凭据，密码脱敏）；
 * 中区检查 dsh-devforge 自身（官网清单，登录制下载）；下区检查 DeepSeek Harness 本体（官方 GitHub Tags）。
 * 本体不做一键升级：官方没有跨安装方式的升级协议，页面只提供「查看官方版本 /
 * 复制升级命令」，由用户在终端执行后点「重启 DSH」生效。
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

/** 插件更新页签组件（检查状态由父组件注入；升级动作仍在本页触发）。 */
export function PluginUpdateTab({ api, state, onRefresh }: { api: DevforgeApi; state: UpdateCheckState; onRefresh: () => void }): JSX.Element {
  const [busy, setBusy] = useState('')
  const [copied, setCopied] = useState('')
  const [applyError, setApplyError] = useState('')
  const [done, setDone] = useState('')
  const { items, harness, enabled, loading, error } = state

  // —— 官网账号设置卡状态（页签打开即读取；保存走 PUT，密码绝不回显）。 ——
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

  // 页签打开即加载一次官网账号配置。
  useEffect(loadSite, [api])

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
        <span className={css['sectionHint']}>插件对比官网清单（登录制下载，账号见下方官网账号卡）；DSH 本体对比官方 GitHub Tags；升级后需重启 DSH 生效</span>
        <span className={css['toolbarSpacer']} />
        <button type="button" className={css['ghostButton']} disabled={loading} onClick={onRefresh}>检查更新</button>
      </div>
      {/* 官网账号设置卡：登录制下载凭据；密码脱敏（仅 hasPassword + 掩码），保存后常驻生效。 */}
      <section className={css['memoryPanel']}>
        <div className={css['panelHeading']}>
          <div>
            <h3 className={css['sectionTitle']}>官网账号</h3>
            <p className={css['sectionHint']}>官网下载已启用登录制，配置后插件检查更新与自动升级可用；账号由管理员分配</p>
          </div>
          <span className={css['badge']}>{site !== null && site.username !== '' && site.hasPassword ? '已配置' : '未配置'}</span>
        </div>
        {siteState === 'loading' && <div className={css['empty']} data-loading="">正在读取官网账号配置…</div>}
        {siteState === 'error' && (
          <div className={css['memoryForm']}>
            <div className={css['banner']} data-kind="error">官网账号配置读取失败：{siteLoadError}</div>
            <div className={css['formFooter']}><span className={css['sectionHint']}></span><button type="button" className={css['ghostButton']} onClick={loadSite}>重新加载</button></div>
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
      </section>
      {bannerError !== '' && <div className={css['banner']} data-kind="error">{bannerError}</div>}
      {done !== '' && <div className={css['banner']} data-kind="success">{done}</div>}
      {loading && <div className={css['empty']} data-loading="">正在检查更新…</div>}
      {!loading && harness !== null && (
        <div className={css['metricList']}>
          {/* DSH 本体行：本地版本 / 官方最新 / GitHub 来源 / 可更新状态。 */}
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
                <a className={css['link']} href={harness.tagUrl} target="_blank" rel="noopener noreferrer">查看官方版本</a>
                <button type="button" className={css['ghostButton']} onClick={() => copyUpgradeCommand(harness.upgrade !== null ? harness.upgrade.command : '')}>
                  {copied === 'harness' ? '已复制 ✓' : '复制升级命令'}
                </button>
              </span>
            )}
          </div>
        </div>
      )}
      {!loading && harness !== null && harness.status === 'update-available' && harness.upgrade !== null && (
        <div className={css['banner']}>
          DSH 本体有新版：本体是运行中的宿主进程，本插件不自动替换。请在终端执行复制来的命令（当前安装方式：{harness.upgrade.manager === 'npm' ? 'npm 全局' : harness.upgrade.manager === 'pnpm' ? 'pnpm 全局' : '未识别，按官方 npm 渠道'}；{harness.upgrade.evidence}），完成后点左下角「设置」旁的「重启」按钮生效。
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
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
