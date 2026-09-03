/**
 * 天工造梦内的插件更新页：上半区检查 dsh-devforge 自身（官网清单/GitHub 兜底，
 * 一键升级不变），下半区检查 DeepSeek Harness 本体（官方 GitHub Tags）。
 * 本体不做一键升级：官方没有跨安装方式的升级协议，页面只提供「查看官方版本 /
 * 复制升级命令」，由用户在终端执行后点「重启 DSH」生效。
 * 红点聚合判定在 DevforgePanel：仅当任一项确认 update-available 才亮。
 */
import { useState } from 'react'
import type { DevforgeApi } from '../api.ts'
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

  /** 一键升级（仅插件行）：完成后刷新列表并提示重启生效。 */
  const upgrade = (item: UpdateCheckItem): void => {
    if (busy !== '') return
    void (async () => {
      try {
        setBusy(item.packageName)
        setApplyError('')
        setDone('')
        const result = await api.applyPluginUpdate(item.packageName)
        setDone('已升级 ' + result.packageName + ' 到 v' + result.version + '：请点右上角「重启 DSH」生效。')
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
        <span className={css['sectionHint']}>插件对比官网清单（GitHub 兜底）；DSH 本体对比官方 GitHub Tags；升级后需重启 DSH 生效</span>
        <span className={css['toolbarSpacer']} />
        <button type="button" className={css['ghostButton']} disabled={loading} onClick={onRefresh}>检查更新</button>
      </div>
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
          DSH 本体有新版：本体是运行中的宿主进程，本插件不自动替换。请在终端执行复制来的命令（当前安装方式：{harness.upgrade.manager === 'npm' ? 'npm 全局' : harness.upgrade.manager === 'pnpm' ? 'pnpm 全局' : '未识别，按官方 npm 渠道'}；{harness.upgrade.evidence}），完成后点右上角「重启 DSH」生效。
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
                <span className={css['sectionHint']}> {item.via === 'site' ? '官网发布' : item.via === 'github' ? 'GitHub' : ''}</span>
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
