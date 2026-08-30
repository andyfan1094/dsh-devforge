/**
 * 服务工厂操作台 —— 使用 DSH SSH/WinRM 同一套面板壳：返回会话、标题、标准页签
 * 与主题 token。页面聚焦规范与集成管理；服务生成任务继续由 Host 工具接口承载。
 */
import { useCallback, useEffect, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { StandardDetail, StandardSummary } from '../../protocol.ts'
import type { PanelController } from './controller.ts'
import { CamofoxTab } from './CamofoxTab.tsx'
import { FeishuTab } from './FeishuTab.tsx'
import { GithubTab } from './GithubTab.tsx'
import { RemoteOperationsTab } from './RemoteOperationsTab.tsx'
import { ZhipuCodingPlanTab } from './ZhipuCodingPlanTab.tsx'
import css from './panel.module.css'

/** 面板属性。 */
export interface DevforgePanelProps {
  /** 与 SSH 一致的面板唯一状态源。 */
  controller: PanelController
  /** API 客户端。 */
  api: DevforgeApi
}

/** 页签类型。 */
type Tab = 'standards' | 'browser' | 'zhipu' | 'remote' | 'github' | 'feishu'

/** 主面板组件。 */
export function DevforgePanel({ controller, api }: DevforgePanelProps): JSX.Element {
  const [tab, setTab] = useState<Tab>('standards')
  const [standards, setStandards] = useState<StandardSummary[]>([])
  const [viewing, setViewing] = useState<StandardDetail | null>(null)
  const [restarting, setRestarting] = useState(false)
  const [error, setError] = useState('')
  /** 规范数据是否已返回，避免慢请求期间误报“为空”。 */
  const [loaded, setLoaded] = useState(false)
  /** 仅用于打开面板时刷新数据；真正的 view 显隐由 mount.tsx 的 html active CSS 接管。 */
  const [panelOpen, setPanelOpen] = useState(() => controller.getSnapshot().panelOpen)

  /**
   * 拉取规范数据。首次慢请求期间维持 loaded=false，不能把未返回的数组误解释为空库；
   * 失败只显示当前面板错误，不影响主 GUI。
   */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      setError('')
      setStandards(await api.listStandards())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoaded(true)
    }
  }, [api])

  // Controller 驱动数据时机；React 不负责中心 view 的显示/隐藏，避免与 SSH 注入层分叉。
  useEffect(() => {
    const sync = (): void => { setPanelOpen(controller.getSnapshot().panelOpen) }
    const unsubscribe = controller.subscribe(sync)
    sync()
    return unsubscribe
  }, [controller])

  // 打开时拉取规范；其它集成页签按各自组件生命周期加载数据。
  useEffect(() => {
    if (!panelOpen) return
    void refresh()
  }, [panelOpen, refresh])
  /** 查看规范正文；单项读取失败在面板内呈现，不能抛到宿主 GUI。 */
  const viewStandard = async (id: string): Promise<void> => {
    try {
      setError('')
      setViewing(await api.getStandard(id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  /** 请求 DSH 重启，并在 Host 恢复后刷新当前 GUI。 */
  const restartDsh = async (): Promise<void> => {
    if (restarting) return
    try {
      setError('')
      setRestarting(true)
      await api.restartDsh()

      const waitForHost = async (attemptsLeft: number): Promise<void> => {
        try {
          await api.listStandards()
          window.location.reload()
        } catch {
          if (attemptsLeft === 0) {
            setRestarting(false)
            setError('DSH 未在预期时间内恢复，请稍后手动刷新页面。')
            return
          }
          window.setTimeout(() => { void waitForHost(attemptsLeft - 1) }, 500)
        }
      }

      // 旧 Host 先退出，独立进程随后启动新 Host；延迟避免仍命中旧服务。
      window.setTimeout(() => { void waitForHost(20) }, 750)
    } catch (e) {
      setRestarting(false)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className={css['panel']} data-dsh-plugin="devforge">
      <div className={css['panelHeader']}>
        <button
          type="button"
          className={[css['backButton'], css['ghostButton']].filter(Boolean).join(' ')}
          aria-label="返回会话"
          data-dsh-center-view-back=""
          onClick={() => controller.close()}
        >
          <span aria-hidden="true">‹</span>
          <span>返回会话</span>
        </button>
        <h2 className={css['panelTitle']}>服务工厂</h2>
        <button
          type="button"
          className={css['ghostButton']}
          title="重启本机 DSH Web 服务"
          disabled={restarting}
          onClick={() => { void restartDsh() }}
        >
          {restarting ? '正在重启…' : '重启 DSH'}
        </button>
      </div>

      <div className={css['tabBar']} role="tablist" data-dsh-part="tab-bar">
        <button type="button" role="tab" aria-selected={tab === 'standards'} data-active={tab === 'standards' ? '' : undefined} data-dsh-part="tab" className={css['tab']} onClick={() => { setTab('standards') }}>开发规范</button>
        <button type="button" role="tab" aria-selected={tab === 'browser'} data-active={tab === 'browser' ? '' : undefined} data-dsh-part="tab" className={css['tab']} onClick={() => { setTab('browser') }}>运营浏览器</button>
        <button type="button" role="tab" aria-selected={tab === 'zhipu'} data-active={tab === 'zhipu' ? '' : undefined} data-dsh-part="tab" className={css['tab']} onClick={() => { setTab('zhipu') }}>智谱 Coding Plan</button>
        <button type="button" role="tab" aria-selected={tab === 'remote'} data-active={tab === 'remote' ? '' : undefined} data-dsh-part="tab" className={css['tab']} onClick={() => { setTab('remote') }}>远程运维</button>
        <button type="button" role="tab" aria-selected={tab === 'github'} data-active={tab === 'github' ? '' : undefined} data-dsh-part="tab" className={css['tab']} onClick={() => { setTab('github') }}>GitHub</button>
        <button type="button" role="tab" aria-selected={tab === 'feishu'} data-active={tab === 'feishu' ? '' : undefined} data-dsh-part="tab" className={css['tab']} onClick={() => { setTab('feishu') }}>飞书</button>
      </div>

      <div className={css['panelContent']}>
        {error !== '' && <div className={css['banner']} data-kind="error">{error}</div>}

        {tab === 'standards' && (
          <section className={css['tabBody']}>
            <div className={css['toolbar']}>
              <span className={css['sectionHint']}>内置开发规范</span>
              <span className={css['toolbarSpacer']} />
              <button type="button" className={css['ghostButton']} onClick={() => { void refresh() }}>刷新</button>
            </div>
            {!loaded && <div className={css['empty']} data-loading="">正在加载规范库…</div>}
            {loaded && standards.length === 0 && <div className={css['empty']}>规范库为空（standards/ 目录无 md 文件）</div>}
            {loaded && standards.length > 0 && (
              <div className={css['tableWrap']}>
                <div className={css['resourceList']}>
                  {standards.map((standard) => (
                    <div key={standard.id} className={css['resourceRow']}>
                      <div className={css['resourceInfo']}>
                        <strong className={css['resourceTitle']}>{standard.title}</strong>
                        <span className={css['resourceMeta']}>{standard.id} · {standard.tags.join(', ') || '无标签'}</span>
                      </div>
                      <button type="button" className={css['ghostButton']} onClick={() => { void viewStandard(standard.id) }}>查看</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {tab === 'browser' && <CamofoxTab api={api} />}

        {tab === 'zhipu' && <ZhipuCodingPlanTab api={api} />}

        {tab === 'remote' && <RemoteOperationsTab api={api} />}

        {tab === 'github' && <GithubTab api={api} />}

        {tab === 'feishu' && <FeishuTab api={api} />}

      </div>

      {viewing && (
        <div className={css['modalBackdrop']} onClick={() => { setViewing(null) }}>
          <div className={css['modal']} role="dialog" aria-modal="true" aria-label={viewing.title} onClick={(event) => { event.stopPropagation() }}>
            <h3 className={css['modalTitle']}>{viewing.title}</h3>
            <pre className={css['modalContent']}>{viewing.content}</pre>
            <div className={css['modalActions']}>
              <button type="button" className={css['ghostButton']} onClick={() => { setViewing(null) }}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
