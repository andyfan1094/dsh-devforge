/**
 * 服务工厂操作台 —— 使用 DSH SSH/WinRM 同一套面板壳：返回会话、标题、标准页签
 * 与主题 token。功能仍是规范浏览、生成任务和新建服务，不能因视觉改造改变 API 调用。
 */
import { useCallback, useEffect, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { ForgeJob, ForgeTemplate, StandardDetail, StandardSummary } from '../../protocol.ts'
import type { PanelController } from './controller.ts'
import { FeishuTab } from './FeishuTab.tsx'
import { GithubTab } from './GithubTab.tsx'
import { RemoteOperationsTab } from './RemoteOperationsTab.tsx'
import css from './panel.module.css'

/** 面板属性。 */
export interface DevforgePanelProps {
  /** 与 SSH 一致的面板唯一状态源。 */
  controller: PanelController
  /** API 客户端。 */
  api: DevforgeApi
}

/** 页签类型。 */
type Tab = 'standards' | 'jobs' | 'new' | 'remote' | 'github' | 'feishu'

/** 主面板组件。 */
export function DevforgePanel({ controller, api }: DevforgePanelProps): JSX.Element {
  const [tab, setTab] = useState<Tab>('standards')
  const [standards, setStandards] = useState<StandardSummary[]>([])
  const [templates, setTemplates] = useState<ForgeTemplate[]>([])
  const [jobs, setJobs] = useState<ForgeJob[]>([])
  const [viewing, setViewing] = useState<StandardDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** 首次三个面板数据是否都已返回，避免慢请求期间误报“为空”。 */
  const [loaded, setLoaded] = useState(false)
  /** 仅用于数据刷新与轮询；真正的 view 显隐始终由 mount.tsx 的 html active CSS 接管。 */
  const [panelOpen, setPanelOpen] = useState(() => controller.getSnapshot().panelOpen)

  // 表单状态（新建页）
  const [name, setName] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [targetDir, setTargetDir] = useState('')
  const [requirements, setRequirements] = useState('')

  /**
   * 拉全量数据（规范/模板/任务）。首次慢请求期间维持 loaded=false，不能把未返回
   * 的数组误解释为空库；失败只显示当前面板错误，不影响主 GUI。
   */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      setError('')
      const [s, t, j] = await Promise.all([api.listStandards(), api.listTemplates(), api.listJobs()])
      setStandards(s)
      setTemplates(t)
      setJobs(j)
      if (t.length > 0) setTemplateId((current) => current || t[0]!.id)
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

  // 打开时拉数据；存在排队/运行任务时每 5 秒刷新一次状态。
  useEffect(() => {
    if (!panelOpen) return
    void refresh()
  }, [panelOpen, refresh])
  useEffect(() => {
    if (!panelOpen) return
    if (!jobs.some((j) => j.status === 'running' || j.status === 'queued')) return
    const timer = window.setInterval(() => {
      void api.listJobs().then(setJobs).catch(() => { /* 静默，不打断用户当前操作 */ })
    }, 5000)
    return () => window.clearInterval(timer)
  }, [panelOpen, jobs, api])

  /** 查看规范正文；单项读取失败在面板内呈现，不能抛到宿主 GUI。 */
  const viewStandard = async (id: string): Promise<void> => {
    try {
      setError('')
      setViewing(await api.getStandard(id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  /** 一键生成提交。 */
  const submit = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const job = await api.createJob({
        name: name || templates.find((t) => t.id === templateId)?.name || '未命名',
        templateId,
        targetDir,
        requirements,
      })
      setJobs((prev) => [job, ...prev])
      setTab('jobs')
      setName('')
      setRequirements('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  /** 取消尚未结束的生成任务。 */
  const cancel = async (id: string): Promise<void> => {
    try {
      await api.cancelJob(id)
      void refresh()
    } catch (e) {
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
      </div>

      <div className={css['tabBar']} role="tablist" data-dsh-part="tab-bar">
        <button type="button" role="tab" aria-selected={tab === 'standards'} data-active={tab === 'standards' ? '' : undefined} data-dsh-part="tab" className={css['tab']} onClick={() => { setTab('standards') }}>开发规范</button>
        <button type="button" role="tab" aria-selected={tab === 'jobs'} data-active={tab === 'jobs' ? '' : undefined} data-dsh-part="tab" className={css['tab']} onClick={() => { setTab('jobs') }}>生成任务</button>
        <button type="button" role="tab" aria-selected={tab === 'new'} data-active={tab === 'new' ? '' : undefined} data-dsh-part="tab" className={css['tab']} onClick={() => { setTab('new') }}>新建服务</button>
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

        {tab === 'jobs' && (
          <section className={css['tabBody']}>
            <div className={css['toolbar']}>
              <span className={css['sectionHint']}>服务生成任务</span>
              <span className={css['toolbarSpacer']} />
              <button type="button" className={css['ghostButton']} onClick={() => { void refresh() }}>刷新</button>
            </div>
            {!loaded && <div className={css['empty']} data-loading="">正在加载生成任务…</div>}
            {loaded && jobs.length === 0 && <div className={css['empty']}>暂无生成任务。可切到“新建服务”开始创建。</div>}
            {loaded && jobs.length > 0 && (
              <div className={css['tableWrap']}>
                <div className={css['resourceList']}>
                  {jobs.map((job) => (
                    <div key={job.id} className={css['resourceRow']}>
                      <div className={css['resourceInfo']}>
                        <strong className={css['resourceTitle']}>{job.name}</strong>
                        <span className={css['resourceMeta']}>{job.templateId} · {job.targetDir}</span>
                        {job.lastMessage && <span className={css['resourceMessage']}>{job.lastMessage}</span>}
                      </div>
                      <span className={css['badge']} data-status={job.status}>{job.status}</span>
                      {(job.status === 'running' || job.status === 'queued') && (
                        <button type="button" className={css['ghostButton']} onClick={() => { void cancel(job.id) }}>取消</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {tab === 'remote' && <RemoteOperationsTab api={api} />}

        {tab === 'github' && <GithubTab api={api} />}

        {tab === 'feishu' && <FeishuTab api={api} />}

        {tab === 'new' && (
          <section className={css['tabBody']}>
            {!loaded ? (
              <div className={css['empty']} data-loading="">正在加载服务模板…</div>
            ) : (
              <div className={css['form']}>
                <div className={css['field']}>
                  <label className={css['fieldLabel']}>任务名称</label>
                  <input className={css['input']} value={name} onChange={(e) => { setName(e.target.value) }} placeholder="默认取模板名" />
                </div>
                <div className={css['field']}>
                  <label className={css['fieldLabel']}>服务模板</label>
                  <select className={css['input']} value={templateId} onChange={(e) => { setTemplateId(e.target.value) }}>
                    {templates.map((template) => <option key={template.id} value={template.id}>{template.name}（{template.description}）</option>)}
                  </select>
                </div>
                <div className={css['field']}>
                  <label className={css['fieldLabel']}>目标目录（绝对路径）</label>
                  <input className={css['input']} value={targetDir} onChange={(e) => { setTargetDir(e.target.value) }} placeholder="D:\项目\我的新服务" />
                </div>
                <div className={css['field']}>
                  <label className={css['fieldLabel']}>需求描述</label>
                  <textarea className={[css['input'], css['textarea']].filter(Boolean).join(' ')} value={requirements} onChange={(e) => { setRequirements(e.target.value) }} rows={5} placeholder="说明要生成的服务、接口和约束…" />
                </div>
                <div className={css['formFooter']}>
                  <span className={css['sectionHint']}>模板会自动挂载对应开发规范。</span>
                  <button type="button" className={css['primaryButton']} disabled={busy || templateId === '' || targetDir.trim() === ''} onClick={() => { void submit() }}>
                    {busy ? '创建中…' : '一键生成'}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
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
