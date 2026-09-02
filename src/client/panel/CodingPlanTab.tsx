import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { ArkStatus } from '../../ark/protocol.ts'
import type { MiniMaxStatus } from '../../minimax/protocol.ts'
import type { ZhipuStatus } from '../../zhipu/protocol.ts'
import type { OpenAiGatewayStatus } from '../../openai/protocol.ts'
import { ArkCodingPlanTab } from './ArkCodingPlanTab.tsx'
import { TokenUsageBoard } from './TokenUsageBoard.tsx'
import { MiniMaxCodingPlanTab } from './MiniMaxCodingPlanTab.tsx'
import { OpenAiGatewayTab } from './OpenAiGatewayTab.tsx'
import { CodingPlanAsideUsage, INITIAL_CARD, arkCard, minimaxCard, zhipuCard } from './CodingPlanAsideUsage.tsx'
import type { OverviewCardState, OverviewCards, OverviewProvider } from './CodingPlanAsideUsage.tsx'
import { ZhipuCodingPlanTab } from './ZhipuCodingPlanTab.tsx'
import css from './panel.module.css'

/** Coding Plan 工作区属性。 */
export interface CodingPlanTabProps {
  api: DevforgeApi
}

type Provider = 'dashboard' | OverviewProvider | 'openai'
type Section = 'config' | 'usage'

/** 三家卡片状态的键名，方便统一 setState。 */
type CardKey = keyof OverviewCards

/** 把单家卡片异常转成卡片错误态的错误文案。 */
function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** 收敛所有 Coding Plan 服务商为一个工作区；默认落在三家用量总览。
 * 三家用量在本组件统一加载：控制面板总览与左侧「用量速览」共享同一份数据，切页签不重复拉取。 */
export function CodingPlanTab({ api }: CodingPlanTabProps): JSX.Element {
  const [provider, setProvider] = useState<Provider>('dashboard')
  const [section, setSection] = useState<Section>('config')
  const [zhipuStatus, setZhipuStatus] = useState<ZhipuStatus | null>(null)
  const [minimaxStatus, setMiniMaxStatus] = useState<MiniMaxStatus | null>(null)
  const [arkStatus, setArkStatus] = useState<ArkStatus | null>(null)
  const [openAiStatus, setOpenAiStatus] = useState<OpenAiGatewayStatus | null>(null)
  // 三家用量卡片：父层单一数据源，初始全部处于加载态。
  const [cards, setCards] = useState<OverviewCards>({ zhipu: INITIAL_CARD, minimax: INITIAL_CARD, ark: INITIAL_CARD })
  // 正在刷新的商家；'all' = 侧栏整体刷新；null = 空闲。
  const [refreshing, setRefreshing] = useState<OverviewProvider | 'all' | null>(null)
  // 每分钟心跳：驱动重置倒计时文案刷新。
  const [now, setNow] = useState(() => Date.now())
  const usageMounted = useRef(false)

  const isDashboard = provider === 'dashboard'
  const active = provider === 'zhipu' ? zhipuStatus : provider === 'minimax' ? minimaxStatus : provider === 'ark' ? arkStatus : provider === 'openai' ? openAiStatus : null
  const providerLabel = isDashboard ? '三家用量总览' : provider === 'zhipu' ? '智谱 GLM' : provider === 'minimax' ? 'MiniMax' : provider === 'ark' ? '火山方舟' : 'OpenAI 中转'
  const toolsCount = provider === 'zhipu' ? 5 : provider === 'minimax' ? 5 : provider === 'openai' ? 1 : 0
  const statusLabel = active === null ? '正在读取' : active.credentialConfigured ? '已配置' : '待配置'
  const modelsReady = active !== null && active.providerConfigured && active.models.length > 0 && active.models.every((model) => model.configured)

  // 侧栏单家状态：直接读用量卡片（父层持有，任何页签下都有数据）。
  const sideInfo = (card: OverviewCardState): { loaded: boolean; configured: boolean } => ({ loaded: card.phase !== 'loading', configured: card.configured })
  const zhipuInfo = sideInfo(cards.zhipu)
  const minimaxInfo = sideInfo(cards.minimax)
  const arkInfo = sideInfo(cards.ark)
  const configuredCount = [zhipuInfo, minimaxInfo, arkInfo].filter((info) => info.loaded && info.configured).length
  const allLoaded = zhipuInfo.loaded && minimaxInfo.loaded && arkInfo.loaded

  const onZhipuStatus = useCallback((next: ZhipuStatus): void => setZhipuStatus(next), [])
  const onMiniMaxStatus = useCallback((next: MiniMaxStatus): void => setMiniMaxStatus(next), [])
  const onArkStatus = useCallback((next: ArkStatus): void => setArkStatus(next), [])
  const onOpenAiStatus = useCallback((next: OpenAiGatewayStatus): void => setOpenAiStatus(next), [])
  const providerMeta = useMemo(() => {
    if (isDashboard) return ''
    if (provider === 'ark') return active?.credentialConfigured ? 'Agent Plan 单 Key 已配置' : '需要填写 Agent Plan API Key'
    if (provider === 'openai') return active?.credentialConfigured ? 'OpenAI 兼容中转站已配置' : '需要填写中转站地址和 API Key'
    return active?.credentialConfigured ? '官方凭据已配置' : '需要填写 API Key'
  }, [active, provider, isDashboard])

  // ---- 三家用量加载：原先在 UsageOverviewTab 内部，提升到本组件供侧栏速览共用 ----
  const loadZhipu = useCallback(async (): Promise<void> => {
    try {
      const [status, dashboard] = await Promise.all([api.getZhipuStatus(), api.getZhipuDashboard('day')])
      if (usageMounted.current) setCards((prev) => ({ ...prev, zhipu: zhipuCard(status, dashboard) }))
    } catch (cause) {
      if (usageMounted.current) setCards((prev) => ({ ...prev, zhipu: { ...INITIAL_CARD, phase: 'error', error: errorMessage(cause) } }))
    }
  }, [api])
  const loadMiniMax = useCallback(async (): Promise<void> => {
    try {
      const [status, dashboard] = await Promise.all([api.getMiniMaxStatus(), api.getMiniMaxDashboard()])
      if (usageMounted.current) setCards((prev) => ({ ...prev, minimax: minimaxCard(status, dashboard) }))
    } catch (cause) {
      if (usageMounted.current) setCards((prev) => ({ ...prev, minimax: { ...INITIAL_CARD, phase: 'error', error: errorMessage(cause) } }))
    }
  }, [api])
  const loadArk = useCallback(async (live: boolean): Promise<void> => {
    try {
      const status = await api.getArkStatus()
      const dashboard = live ? await api.refreshArkUsage() : await api.getArkDashboard()
      if (usageMounted.current) setCards((prev) => ({ ...prev, ark: arkCard(status, dashboard) }))
    } catch (cause) {
      if (usageMounted.current) setCards((prev) => ({ ...prev, ark: { ...INITIAL_CARD, phase: 'error', error: errorMessage(cause) } }))
    }
  }, [api])

  /** 刷新用量：单家串行防抖，'all' 并行刷三家（方舟走实时刷新绕过缓存）。 */
  const refreshUsage = useCallback(async (target: OverviewProvider | 'all'): Promise<void> => {
    if (refreshing !== null) return
    setRefreshing(target)
    try {
      if (target === 'all') await Promise.all([loadZhipu(), loadMiniMax(), loadArk(true)])
      else if (target === 'zhipu') await loadZhipu()
      else if (target === 'minimax') await loadMiniMax()
      else await loadArk(true)
    } finally {
      if (usageMounted.current) setRefreshing(null)
    }
  }, [refreshing, loadZhipu, loadMiniMax, loadArk])

  // 挂载即拉一次三家用量 + 每分钟心跳；卸载后丢弃一切 setState。
  useEffect(() => {
    usageMounted.current = true
    void loadZhipu()
    void loadMiniMax()
    void loadArk(false)
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => {
      usageMounted.current = false
      window.clearInterval(timer)
    }
  }, [loadZhipu, loadMiniMax, loadArk])

  /** 未配置商家跳转到对应使用配置页。 */
  const navigateToProvider = useCallback((target: OverviewProvider): void => {
    setProvider(target)
    setSection('config')
  }, [])

  return (
    <section className={css['codePlanWorkspace']}>
      <aside className={css['codePlanSidebar']} aria-label="套餐信息">
        <div className={css['codePlanAsideHeading']}>
          <span className={css['sectionHint']}>套餐信息</span>
          <strong>Coding Plan</strong>
        </div>
        <dl className={css['planInfoList']}>
          {isDashboard ? (
            <>
              <div><dt>服务商</dt><dd>3 家</dd></div>
              <div><dt>凭据已配置</dt><dd data-state={allLoaded && configuredCount === 3 ? 'ok' : 'pending'}>{allLoaded ? configuredCount + '/3' : '读取中'}</dd></div>
              <div><dt>智谱 GLM</dt><dd data-state={zhipuInfo.loaded && zhipuInfo.configured ? 'ok' : 'pending'}>{zhipuInfo.loaded ? (zhipuInfo.configured ? '已配置' : '待配置') : '读取中'}</dd></div>
              <div><dt>MiniMax</dt><dd data-state={minimaxInfo.loaded && minimaxInfo.configured ? 'ok' : 'pending'}>{minimaxInfo.loaded ? (minimaxInfo.configured ? '已配置' : '待配置') : '读取中'}</dd></div>
              <div><dt>火山方舟</dt><dd data-state={arkInfo.loaded && arkInfo.configured ? 'ok' : 'pending'}>{arkInfo.loaded ? (arkInfo.configured ? '已配置' : '待配置') : '读取中'}</dd></div>
            </>
          ) : (
            <>
              <div><dt>服务商</dt><dd>{providerLabel}</dd></div>
              <div><dt>订阅状态</dt><dd data-state={active?.credentialConfigured ? 'ok' : 'pending'}>{statusLabel}</dd></div>
              <div><dt>模型数量</dt><dd>{active?.models.length ?? 0} 个</dd></div>
              <div><dt>模型路由</dt><dd data-state={modelsReady ? 'ok' : 'pending'}>{modelsReady ? '已就绪' : '待完善'}</dd></div>
              <div><dt>{provider === 'ark' ? '凭据模式' : '工具能力'}</dt><dd data-state="ok">{provider === 'ark' ? '单 Key' : toolsCount + ' 个'}</dd></div>
            </>
          )}
        </dl>
        {providerMeta !== '' && <p className={css['planInfoHint']}>{providerMeta}</p>}
        {/* 辉哥定稿：三家用量卡片挪到左侧栏，默认全部展开；右区只留模型 token 计量看板。 */}
        <CodingPlanAsideUsage cards={cards} refreshing={refreshing} now={now} onRefresh={(target) => void refreshUsage(target)} onNavigate={navigateToProvider} />
      </aside>

      <div className={css['codePlanMain']}>
        <header className={css['codePlanHeader']}>
          <div>
            <h3>Coding Plan</h3>
            <p>统一管理智谱、MiniMax、火山方舟与 OpenAI 中转站的 API Key、模型路由、工具和套餐用量。</p>
          </div>
        </header>

        <div className={css['providerTabs']} role="tablist" aria-label="Coding Plan 服务商">
          <button type="button" role="tab" data-active={isDashboard ? '' : undefined} aria-selected={isDashboard} onClick={() => setProvider('dashboard')}>控制面板</button>
          <button type="button" role="tab" data-active={provider === 'zhipu' ? '' : undefined} aria-selected={provider === 'zhipu'} onClick={() => setProvider('zhipu')}>智谱 GLM</button>
          <button type="button" role="tab" data-active={provider === 'minimax' ? '' : undefined} aria-selected={provider === 'minimax'} onClick={() => setProvider('minimax')}>MiniMax</button>
          <button type="button" role="tab" data-active={provider === 'ark' ? '' : undefined} aria-selected={provider === 'ark'} onClick={() => setProvider('ark')}>火山方舟</button>
          <button type="button" role="tab" data-active={provider === 'openai' ? '' : undefined} aria-selected={provider === 'openai'} onClick={() => { setProvider('openai'); setSection('config') }}>OpenAI 中转</button>
        </div>

        {!isDashboard && provider !== 'openai' && (
          <div className={css['codePlanSectionTabs']} role="tablist" aria-label="Coding Plan 内容">
            <button type="button" role="tab" data-active={section === 'config' ? '' : undefined} aria-selected={section === 'config'} onClick={() => setSection('config')}>使用配置</button>
            <button type="button" role="tab" data-active={section === 'usage' ? '' : undefined} aria-selected={section === 'usage'} onClick={() => setSection('usage')}>用量统计</button>
          </div>
        )}

        <div className={css['codePlanContent']}>
          {isDashboard && (
            <div className={css['codePlanDashboard']}>
              {/* 右区只放模型用量（token 计量）；套餐用量卡片在左侧栏。 */}
              <TokenUsageBoard api={api} />
            </div>
          )}
          {provider === 'zhipu' && <ZhipuCodingPlanTab api={api} apiKeyEnv="ZAI_CODING_CN_API_KEY" section={section} embedded onStatusChange={onZhipuStatus} />}
          {provider === 'minimax' && <MiniMaxCodingPlanTab api={api} apiKeyEnv="MINIMAX_CN_API_KEY" section={section} embedded onStatusChange={onMiniMaxStatus} />}
          {provider === 'ark' && <ArkCodingPlanTab api={api} apiKeyEnv="ARK_CODING_PLAN_API_KEY" section={section} embedded onStatusChange={onArkStatus} />}
          {provider === 'openai' && <OpenAiGatewayTab api={api} apiKeyEnv="OPENAI_GATEWAY_API_KEY" onStatusChange={onOpenAiStatus} />}
        </div>
      </div>
    </section>
  )
}
