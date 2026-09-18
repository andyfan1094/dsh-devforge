/**
 * 天工造梦官方槽位接入 —— 与官方插件管理器（ui-plugin-manager）完全同款的两处注册：
 *
 *   1. `sidebar.panellist`（list 槽位）：侧栏图标行。按钮节点、文字排版、颜色 token、
 *      折叠轨图标态全部由壳统一渲染，与官方「插件」入口同构，不再自建 DOM 注入；
 *   2. `main`（keyed 槽位，key=devforge）：中栏页面。壳按 activePanelId 决定渲染哪个
 *      全局面板，显示/隐藏、多面板互斥、返回会话全部走官方布局服务（ctx.layout）。
 *
 * 生命周期：ctx.slots.inject 的回调挂在调用方 fiber 上（官方同款直接在 apply 中调用），
 * 插件卸载时级联注销；本函数返回的幂等 disposer 供 ctx.effect 兜底。
 */
import type { JSX } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { IconSparkle16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DevforgeApi } from './api.ts'
import { DevforgePanel } from './panel/DevforgePanel.tsx'
import { tt } from './panel/helpers.ts'
import type { SkinRuntimeApi } from './theme/skin-runtime.ts'

/** 中栏面板 id：sidebar.panellist 列表 id 与 main 键控 key 同值（官方契约）。 */
const PANEL_ID = 'devforge'

/** locale 命名空间（侧栏行 label 经字典跟随界面语言）。 */
const NS = 'dsh-devforge'

/** 侧栏行排序：官方「插件」为 0，天工造梦排其后（升序展示）。 */
const PANEL_ORDER = 1

/** 注入给 main 页面组件的业务面（官方 inject 契约）。 */
interface DevforgePageShare {
  /** 天工造梦 HTTP API。 */
  api: DevforgeApi
  /** 皮肤运行时（可选：缺席时皮肤页签自动隐藏）。 */
  skin?: SkinRuntimeApi
  /** 把中栏交还给当前会话（走官方布局服务）。 */
  backToSession: () => void
}

/**
 * 侧栏图标：官方图标集的 16 网格线性图标 + currentColor。
 * 尺寸由壳按行规格传入，颜色跟随壳的导航 token（默认灰、选中蓝），与官方行完全一致。
 * 选 IconSparkle16（造梦/灵感）而非官方插件的风车叶，保持品牌区分度。
 */
function DevforgePanelIcon({ size }: { size: number }): JSX.Element {
  return <IconSparkle16 size={size} />
}

/** 官方 main 槽位页面：仅在被选中时挂载；「返回会话」把中栏交还官方布局。 */
function DevforgeSlotPage(props: DevforgePageShare): JSX.Element {
  return <DevforgePanel api={props.api} skin={props.skin} onBack={props.backToSession} />
}

/**
 * 注册官方槽位；返回幂等 disposer（fiber 卸载亦会级联）。
 * @param ctx 客户端根上下文（需已注入 slots 与 layout 服务）。
 * @param api 天工造梦 HTTP API。
 * @param skin 皮肤运行时（可选）。
 */
export function registerSlotPanel(ctx: ClientContext, api: DevforgeApi, skin?: SkinRuntimeApi): () => void {
  // 侧栏行的选中由壳内部调用 selectPanel(id) 完成；本插件只需要「返回会话」方向。
  const backToSession = (): void => { ctx.layout.selectPanel(null) }
  const disposeMain = ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: () => ({ api, skin, backToSession }),
  }, DevforgeSlotPage))
  const disposeSidebar = ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: PANEL_ORDER,
    label: () => tt('entry.label'),
    locale: NS,
  }, DevforgePanelIcon))
  return () => { disposeMain(); disposeSidebar() }
}
