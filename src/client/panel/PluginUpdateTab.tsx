/**
 * 天工造梦内的插件更新页：对比 GitHub Latest Release 检查已登记插件，
 * 一键升级（下载 tgz → dsh plugin add），升级后提示重启 DSH 生效。
 * 升级走登记表白名单，重启仍由面板右上角「重启 DSH」（用户确认）触发。
 */
import { useEffect, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { UpdateCheckItem } from '../../plugin-update.ts'
import css from './panel.module.css'

/** 状态徽标文案。 */
const STATUS_LABEL: Record<UpdateCheckItem['status'], string> = {
  'up-to-date': '已是最新',
  'update-available': '可更新',
  'installed-unknown': '本机未安装',
  error: '检查失败',
}

/** 插件更新页签组件。 */
export function PluginUpdateTab({ api }: { api: DevforgeApi }): JSX.Element {
  const [items, setItems] = useState<UpdateCheckItem[]>([])
  const [enabled, setEnabled] = useState(true)
  const [busy, setBusy] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  /** 拉取检查结果；失败只落在页签横幅，不影响面板其他页签。 */
  const refresh = async (): Promise<void> => {
    try {
      setLoading(true)
      setError('')
      setDone('')
      const result = await api.checkPluginUpdates()
      setEnabled(result.enabled)
      setItems(result.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void refresh() }, [])

  /** 一键升级：升级完成后刷新列表并提示重启生效。 */
  const upgrade = (item: UpdateCheckItem): void => {
    if (busy !== '') return
    void (async () => {
      try {
        setBusy(item.packageName)
        setError('')
        setDone('')
        const result = await api.applyPluginUpdate(item.packageName)
        setDone('已升级 ' + result.packageName + ' 到 v' + result.version + '：请点右上角「重启 DSH」生效。')
        await refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy('')
      }
    })()
  }

  return (
    <section className={css['tabBody']}>
      <div className={css['toolbar']}>
        <strong>插件更新</strong>
        <span className={css['sectionHint']}>对比官网最新版本（modagentai.com，GitHub 兜底）；升级后需重启 DSH 生效</span>
        <span className={css['toolbarSpacer']} />
        <button type="button" className={css['ghostButton']} disabled={loading} onClick={() => { void refresh() }}>检查更新</button>
      </div>
      {error !== '' && <div className={css['banner']} data-kind="error">{error}</div>}
      {done !== '' && <div className={css['banner']} data-kind="success">{done}</div>}
      {!enabled && <div className={css['empty']}>插件更新能力已关闭（请在设置中开启）</div>}
      {enabled && loading && items.length === 0 && <div className={css['empty']} data-loading="">正在检查更新…</div>}
      {enabled && !loading && items.length === 0 && <div className={css['empty']}>更新源登记表为空（可在设置里登记「包名 → 官网清单或 GitHub 仓库」）</div>}
      {enabled && items.length > 0 && (
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
