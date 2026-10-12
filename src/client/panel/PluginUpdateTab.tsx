/**
 * 天工造梦插件更新页（0.46.0 辉哥定稿重做）：
 * - 单一升级通道：只保留 dsh-devforge 官网渠道，DSH 本体升级整块移除。
 * - 版式按设计技能重做：状态条（本地 → 最新 → 徽标 → 主操作）+ 更新内容时间线，
 *   全部走面板 token（--dsw-* / --dv-*），信任优先、信息密度中上、零装饰动效。
 * - 未登录 / 能力关闭 / 检查失败各有明确空态与错误态；升级完成提示重启生效。
 * 红点聚合判定在 DevforgePanel：仅当插件确认 update-available 才亮。
 */
import { useEffect, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { UpdateCheckItem } from '../../plugin-update.ts'
import css from './panel.module.css'

/** 状态徽标文案。 */
const STATUS_LABEL: Record<UpdateCheckItem['status'], string> = {
  'up-to-date': '已是最新',
  'update-available': '有新版本',
  'installed-unknown': '本机未安装',
  error: '检查失败',
}

/** 更新检查聚合状态（DevforgePanel 持有，页签打开即检查、手动刷新复用）。 */
export interface UpdateCheckState {
  /** 任一路检查进行中；期间红点必须熄灭，防止误亮。 */
  loading: boolean
  /** 插件更新能力开关（false 时页面显示提示）。 */
  enabled: boolean
  /** 插件登记源检查结果。 */
  items: UpdateCheckItem[]
  /** 插件检查通道错误。 */
  error: string
}

/** 单条历史版本时间线项：最新一条默认展开 notes，其余折叠。 */
function HistoryEntry({ entry, latest }: { entry: { version: string; date?: string; notes?: string }; latest: boolean }): JSX.Element {
  const [open, setOpen] = useState(latest)
  const hasNotes = (entry.notes ?? '') !== ''
  return (
    <div className={css['puHistoryRow']} data-latest={latest || undefined}>
      <button
        type="button"
        className={css['puHistoryHead']}
        disabled={!hasNotes}
        aria-expanded={hasNotes ? open : undefined}
        onClick={() => { if (hasNotes) setOpen(!open) }}
      >
        <span className={css['puHistoryVersion']}>v{entry.version}</span>
        {entry.date !== undefined && entry.date !== '' && <span className={css['puHistoryDate']}>{entry.date}</span>}
        {latest && <span className={css['puHistoryBadge']}>最新</span>}
        {hasNotes && <span className={css['puHistoryCaret']} aria-hidden="true">{open ? '▾' : '▸'}</span>}
      </button>
      {hasNotes && open && <p className={css['puHistoryNotes']}>{entry.notes}</p>}
    </div>
  )
}

/** 插件更新页签组件（检查状态由父组件注入；升级动作仍在本页触发）。 */
export function PluginUpdateTab({ api, state, onRefresh }: { api: DevforgeApi; state: UpdateCheckState; onRefresh: () => void }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [applyError, setApplyError] = useState('')
  const [done, setDone] = useState('')
  const { items, enabled, loading, error } = state

  // 官网登录态检测（仅用于未登录提示；已登录不打扰）。
  const [session, setSession] = useState<{ loggedIn: boolean; expired: boolean } | null>(null)

  useEffect(() => {
    void api.getModagentaiStatus().then((status) => {
      setSession({ loggedIn: status.loggedIn, expired: status.expired })
    }).catch(() => { setSession(null) })
  }, [api])

  /** 一键升级：完成后刷新列表并提示重启生效。 */
  const upgrade = (item: UpdateCheckItem): void => {
    if (busy) return
    void (async () => {
      try {
        setBusy(true)
        setApplyError('')
        setDone('')
        const result = await api.applyPluginUpdate(item.packageName)
        setDone('已升级 ' + result.packageName + ' 到 v' + result.version + '：请点左下角「设置」旁的「重启」按钮生效。')
        onRefresh()
      } catch (e) {
        setApplyError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    })()
  }

  const bannerError = [error, applyError].filter((text) => text !== '').join('；')
  const needsLogin = session !== null && (!session.loggedIn || session.expired)
  const item = items.find((entry) => entry.packageName === 'dsh-devforge') ?? items[0]

  return (
    <section className={css['tabBody']}>
      <div className={css['toolbar']}>
        <strong>插件更新</strong>
        <span className={css['sectionHint']}>对比官网下载中心清单，一键升级后重启 DSH 生效</span>
        <span className={css['toolbarSpacer']} />
        <button type="button" className={css['ghostButton']} disabled={loading || busy} onClick={onRefresh}>检查更新</button>
      </div>

      {needsLogin && (
        <div className={css['banner']} data-kind="error">官网未登录：请先到「个人中心」登录官网账号，登录后即可一键升级。</div>
      )}
      {bannerError !== '' && <div className={css['banner']} data-kind="error">{bannerError}</div>}
      {done !== '' && <div className={css['banner']} data-kind="success">{done}</div>}
      {loading && <div className={css['empty']} data-loading="">正在检查更新…</div>}

      {!loading && !enabled && (
        <div className={css['empty']}>插件更新能力已关闭（请在设置中开启）</div>
      )}
      {!loading && enabled && item === undefined && (
        <div className={css['empty']}>更新源登记表为空（可在设置里登记「包名 → 官网清单」）</div>
      )}

      {!loading && enabled && item !== undefined && (
        <div className={css['puCard']}>
          {/* 状态条：本地版本 → 官网最新 → 状态徽标 → 主操作 */}
          <div className={css['puStatusRow']}>
            <div className={css['puStatusCell']}>
              <span className={css['puStatusLabel']}>本地版本</span>
              <span className={css['puStatusValue']}>{item.installed === '' ? '未安装' : 'v' + item.installed}</span>
            </div>
            <span className={css['puStatusArrow']} aria-hidden="true">→</span>
            <div className={css['puStatusCell']}>
              <span className={css['puStatusLabel']}>官网最新</span>
              <span className={css['puStatusValue']}>{item.latest === '' ? '—' : 'v' + item.latest}</span>
            </div>
            <span className={css['puStatusChip']} data-status={item.status}>
              {item.status === 'error' && item.reason !== '' ? item.reason : STATUS_LABEL[item.status]}
            </span>
            <span className={css['toolbarSpacer']} />
            {item.status === 'update-available' && item.assetUrl !== '' && (
              <button type="button" className={css['primaryButton']} disabled={busy || needsLogin === true} onClick={() => { upgrade(item) }}>
                {busy ? '升级中…' : '一键升级'}
              </button>
            )}
          </div>

          {/* 版本元信息：发布日期 + 来源 */}
          {(item.latestDate !== undefined && item.latestDate !== '') && (
            <div className={css['puMetaRow']}>
              <span className={css['sectionHint']}>发布于 {item.latestDate} · 来源：官网下载中心</span>
            </div>
          )}

          {/* 更新内容时间线：最新一条默认展开 */}
          {(item.history ?? []).filter((entry) => (entry.notes ?? '') !== '').length > 0 && (
            <div className={css['puHistory']}>
              <div className={css['puHistoryTitle']}>更新内容</div>
              {(item.history ?? []).map((entry, index) => (
                <HistoryEntry key={entry.version} entry={entry} latest={index === 0} />
              ))}
            </div>
          )}

          {/* 内测提示：本地版本高于官网 */}
          {item.status === 'up-to-date' && item.reason !== '' && (
            <div className={css['banner']} data-kind="info">{item.reason}</div>
          )}
        </div>
      )}
    </section>
  )
}
