/**
 * 天工造梦操作台 —— 使用 DSH SSH/WinRM 同一套面板壳：返回会话、标题、标准页签
 * 与主题 token。页面聚焦规范与集成管理；服务生成任务继续由 Host 工具接口承载。
 */
import { useCallback, useEffect, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { SkinRuntimeApi } from '../theme/skin-runtime.ts'
import { BrowserTab } from './BrowserTab.tsx'
import { PluginUpdateTab, type UpdateCheckState } from './PluginUpdateTab.tsx'
import { FeishuTab } from './FeishuTab.tsx'
import { SkinTab } from './SkinTab.tsx'
import { ProfileTab } from './ProfileTab.tsx'
import { IconBrowser, IconChart, IconProject, IconFeishu, IconTiangong, IconUpdate, IconSkin, IconProfile, IconMcp } from './icons.tsx'
import { CodingPlanTab } from './CodingPlanTab.tsx'
import { MemoryHubTab } from './MemoryHubTab.tsx'
import { DevHubTab } from './DevHubTab.tsx'
// 工作流软下线（0.39.0）：WorkflowTab 组件保留但页签按钮移除（不可达），恢复时在页签栏加回按钮即可。
import { WorkflowTab } from './WorkflowTab.tsx'
import { McpTab } from './McpTab.tsx'
import { DbAdminTab } from './DbAdminTab.tsx'
import css from './panel.module.css'

/** 面板属性。 */
export interface DevforgePanelProps {
  /** API 客户端。 */
  api: DevforgeApi
  /** 皮肤运行时（官方槽位注入；缺席时皮肤页签自动隐藏）。 */
  skin?: SkinRuntimeApi
  /** 返回会话：把中栏交还官方布局服务（ctx.layout.selectPanel(null)）。 */
  onBack: () => void
}

/** 页签类型（'workflow' 保留用于软下线恢复；'memory' 并入 'rag'、'standards/projects/repos/remote' 并入 'dev'，均为 0.40.x 合并页签）。 */
type Tab = 'profile' | 'browser' | 'codeplan' | 'rag' | 'dev' | 'workflow' | 'mcp' | 'dbadmin' | 'feishu' | 'pluginupdate' | 'skin'

/** 主面板组件。 */
export function DevforgePanel({ api, skin, onBack }: DevforgePanelProps): JSX.Element {
  // 首次打开展示个人中心（辉哥 2026-09-21 定稿：替换教程页）；其它页签保持原有行为。
  const [tab, setTab] = useState<Tab>('profile')
  // 官网账号角色：'admin' 才显示 Coding Plan 页签（辉哥 2026-09-22 定稿，未登录/普通用户隐藏）
  const [siteRole, setSiteRole] = useState<'' | 'admin' | 'user'>('')
  const [error, setError] = useState('')
  /** 信息密度档位：默认紧凑（一屏多信息不拥挤），偏好写入 localStorage。 */
  const [density, setDensity] = useState<'compact' | 'cozy'>(() => (localStorage.getItem('dsh-devforge-density') === 'cozy' ? 'cozy' : 'compact'))
  /** 插件版本号，标题旁展示。 */
  const [version, setVersion] = useState('')
  /** 插件 + DSH 本体更新检查状态：面板打开即检查，聚合驱动「插件更新」页签红点。 */
  const [updateState, setUpdateState] = useState<UpdateCheckState>({ loading: false, enabled: true, items: [], harness: null, error: '' })

  /** 插件版本号，标题旁展示：面板打开即取一次，失败静默（仅影响标题角标）。 */
  useEffect(() => {
    void api.getDevforgeMeta().then((meta) => { if (meta.version !== '') setVersion(meta.version) }).catch(() => { /* 版本展示失败不影响面板 */ })
  }, [api])

  /**
   * 并发检查插件登记源与 DSH 本体；任一路失败只落状态不阻塞另一路。
   * 检查期间 loading=true，红点熄灭，避免慢请求或失败误亮。
   */
  const refreshUpdates = useCallback(async (): Promise<void> => {
    setUpdateState((prev) => ({ ...prev, loading: true, error: '' }))
    const [pluginRes, harnessRes] = await Promise.allSettled([api.checkPluginUpdates(), api.checkHarnessUpdate()])
    const next: UpdateCheckState = { loading: false, enabled: true, items: [], harness: null, error: '' }
    if (pluginRes.status === 'fulfilled') {
      next.enabled = pluginRes.value.enabled
      next.items = pluginRes.value.items
    } else {
      next.error = pluginRes.reason instanceof Error ? pluginRes.reason.message : String(pluginRes.reason)
    }
    if (harnessRes.status === 'fulfilled') {
      next.harness = harnessRes.value
    } else {
      // 本体接口异常时给占位 error 项：红点不亮，但页面能看到失败原因。
      const message = harnessRes.reason instanceof Error ? harnessRes.reason.message : String(harnessRes.reason)
      next.harness = { installed: '', latest: '', latestTag: '', repo: 'deepseek-ai/deepseek-harness', tagUrl: 'https://github.com/deepseek-ai/deepseek-harness/tags', status: 'error', reason: message, upgrade: null }
    }
    setUpdateState(next)
  }, [api])

  // 挂载即自动检查更新（含 DSH 本体）；页签内「检查更新」按钮复用同一回调。
  useEffect(() => {
    void refreshUpdates()
  }, [refreshUpdates])

  /** 红点聚合：插件或 DSH 本体任一确认可更新才亮；加载中与检查失败一律不亮。 */
  const updateDot = !updateState.loading && (updateState.items.some((item) => item.status === 'update-available') || updateState.harness?.status === 'update-available')

  /** 切换密度档并持久化；样式侧由 .panel[data-density] 的 token 覆盖生效。 */
  const applyDensity = (next: 'compact' | 'cozy'): void => {
    setDensity(next)
    try { localStorage.setItem('dsh-devforge-density', next) } catch { /* 存储失败仅影响记忆偏好，不影响当次生效 */ }
  }

  useEffect(() => {
    let cancelled = false
    void api.getModagentaiStatus().then((status) => {
      if (!cancelled) setSiteRole(status.role)
    }).catch(() => {
      if (!cancelled) setSiteRole('')
    })
    return () => { cancelled = true }
  }, [api])

  // 非管理员不留在 Coding Plan：登录态变化时自动回落个人中心
  useEffect(() => {
    if (tab === 'codeplan' && siteRole !== 'admin') setTab('profile')
  }, [tab, siteRole])

  /** 记忆合并页签的分区（0.40.x）：直接点页签默认知识库检索；个人中心「编辑身份」跳入直达长期记忆。 */
  const [memorySection, setMemorySection] = useState<'rag' | 'workbench'>('rag')

  /** 身份卡「编辑身份」等入口只切换现有页签，不重复实现业务逻辑；CodePlan 仅管理员可达。 */
  const navigateFromProfile = (target: 'codeplan' | 'memory' | 'feishu' | 'pluginupdate'): void => {
    if (target === 'codeplan' && siteRole !== 'admin') return
    // 记忆工作台入口（0.40.x）并入合并后的「记忆」页签，直达长期记忆分区
    if (target === 'memory') setMemorySection('workbench')
    setTab(target === 'memory' ? 'rag' : target)
  }

  return (
    <div className={css['panel']} data-dsh-plugin="devforge" data-density={density}>
      <div className={css['panelHeader']}>
        <button
          type="button"
          className={[css['backButton'], css['ghostButton']].filter(Boolean).join(' ')}
          aria-label="返回会话"
          data-dsh-center-view-back=""
          onClick={onBack}
        >
          <span aria-hidden="true">‹</span>
          <span>返回会话</span>
        </button>
        <h2 className={css['panelTitle']}><span className={css['panelTitleIcon']}><IconTiangong size={16} /></span>天工造梦{version !== '' && <span className={css['panelVersion']}>v{version}</span>}</h2>
        <div className={css['panelHeaderActions']}>
          <div className={css['segmented']} role="group" aria-label="信息密度" title="紧凑：一屏多信息不拥挤；舒适：更宽松留白">
            <button type="button" data-active={density === 'compact' || undefined} onClick={() => applyDensity('compact')}>紧凑</button>
            <button type="button" data-active={density === 'cozy' || undefined} onClick={() => applyDensity('cozy')}>舒适</button>
          </div>
        </div>
      </div>

      <div className={css['tabBar']} role="tablist" data-dsh-part="tab-bar">
        {/* 个人中心固定为首个页签（辉哥 2026-09-21 定稿：替换教程页）。 */}
        <button type="button" role="tab" aria-selected={tab === 'profile'} data-active={tab === 'profile' ? '' : undefined} data-dsh-part="tab" className={css['tab']} onClick={() => { setTab('profile') }}><IconProfile />个人中心</button>
        {siteRole === 'admin' && <button type="button" role="tab" aria-selected={tab === 'codeplan'} data-active={tab === 'codeplan' ? '' : undefined} data-dsh-part="tab" className={css['tab']} title="仅官网管理员可见" onClick={() => { setTab('codeplan') }}><IconChart />Coding Plan</button>}
        <button type="button" role="tab" aria-selected={tab === 'rag'} data-active={tab === 'rag' ? '' : undefined} data-dsh-part="tab" className={css['tab']} title="记忆：知识库检索 + 长期记忆管理（0.40.x 合并页签）" onClick={() => { setMemorySection('rag'); setTab('rag') }}><IconTiangong />记忆</button>
        {/* 工作流软下线（0.39.0）：按钮移除，恢复时在此处加回 <IconWorkflow />工作流 按钮。 */}
        <button type="button" role="tab" aria-selected={tab === 'mcp'} data-active={tab === 'mcp' ? '' : undefined} data-dsh-part="tab" className={css['tab']} title="外部 MCP 服务器接入：工具以 mcp__<命名空间>__<工具名> 注册给模型" onClick={() => { setTab('mcp') }}><IconMcp />MCP</button>
        <button type="button" role="tab" aria-selected={tab === 'dbadmin'} data-active={tab === 'dbadmin' ? '' : undefined} data-dsh-part="tab" className={css['tab']} title="数据管理：库表数据全透明可查；密钥只显掩码、复制直达剪贴板" onClick={() => { setTab('dbadmin') }}><IconChart />数据管理</button>
        <button type="button" role="tab" aria-selected={tab === 'dev'} data-active={tab === 'dev' ? '' : undefined} data-dsh-part="tab" className={css['tab']} title="开发：开发规范 + 项目 + 代码仓库 + 服务器管理（0.40.x 合并页签）" onClick={() => { setTab('dev') }}><IconProject />开发</button>
        <button type="button" role="tab" aria-selected={tab === 'browser'} data-active={tab === 'browser' ? '' : undefined} data-dsh-part="tab" className={css['tab']} onClick={() => { setTab('browser') }}><IconBrowser />浏览器</button>
        <button type="button" role="tab" aria-selected={tab === 'feishu'} data-active={tab === 'feishu' ? '' : undefined} data-dsh-part="tab" className={css['tab']} onClick={() => { setTab('feishu') }}><IconFeishu />飞书</button>
        <button type="button" role="tab" aria-selected={tab === 'pluginupdate'} data-active={tab === 'pluginupdate' ? '' : undefined} data-dsh-part="tab" className={css['tab']} title={updateDot ? '插件或 DSH 本体有可用更新' : undefined} onClick={() => { setTab('pluginupdate') }}><IconUpdate />插件更新{updateDot && <span className={css['tabDot']} aria-hidden="true" />}</button>
        {skin !== undefined && <button type="button" role="tab" aria-selected={tab === 'skin'} data-active={tab === 'skin' ? '' : undefined} data-dsh-part="tab" className={css['tab']} onClick={() => { setTab('skin') }}><IconSkin />皮肤</button>}
        <span className={css['toolbarSpacer']} />
        <a className={css['promoLink']} href="https://modagentai.com" target="_blank" rel="noopener noreferrer" title="打开天工造梦官网 modagentai.com（新标签）">进入官网</a>
        <a className={css['promoLink']} href="https://www.rainyun.com/MzkwMTQ0_" target="_blank" rel="noopener noreferrer sponsored" title="雨云服务器购买 · 点击直达（新标签打开）">⚡ 雨云服务器购买</a>
      </div>

      <div className={css['panelContent']}>
        {error !== '' && <div className={css['banner']} data-kind="error">{error}</div>}

        {tab === 'profile' && <ProfileTab api={api} onNavigate={navigateFromProfile} />}

        {tab === 'browser' && <BrowserTab api={api} />}

        {tab === 'codeplan' && <CodingPlanTab api={api} />}
        {tab === 'rag' && <MemoryHubTab api={api} section={memorySection} onSectionChange={setMemorySection} />}
        {tab === 'dev' && <DevHubTab api={api} />}
        {tab === 'workflow' && <WorkflowTab />}

        {tab === 'mcp' && <McpTab api={api} />}

        {tab === 'dbadmin' && <DbAdminTab api={api} />}

        {tab === 'feishu' && <FeishuTab api={api} />}

        {tab === 'pluginupdate' && <PluginUpdateTab api={api} state={updateState} onRefresh={() => { void refreshUpdates() }} />}

        {tab === 'skin' && skin !== undefined && <SkinTab skin={skin} />}

      </div>
    </div>
  )
}
