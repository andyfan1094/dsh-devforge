import { useCallback, useMemo, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { ArkStatus } from '../../ark/protocol.ts'
import type { MiniMaxStatus } from '../../minimax/protocol.ts'
import type { ZhipuStatus } from '../../zhipu/protocol.ts'
import type { OpenAiGatewayStatus } from '../../openai/protocol.ts'
import { ArkCodingPlanTab } from './ArkCodingPlanTab.tsx'
import { MiniMaxCodingPlanTab } from './MiniMaxCodingPlanTab.tsx'
import { OpenAiGatewayTab } from './OpenAiGatewayTab.tsx'
import { UsageOverviewTab, type OverviewProvider } from './UsageOverviewTab.tsx'
import { ZhipuCodingPlanTab } from './ZhipuCodingPlanTab.tsx'
import css from './panel.module.css'

/** Coding Plan 工作区属性。 */
export interface CodingPlanTabProps {
  api: DevforgeApi
}

type Provider = 'dashboard' | OverviewProvider | 'openai'
type Section = 'config' | 'usage'

/** 收敛所有 Coding Plan 服务商为一个工作区；默认落在三家用量总览。 */
export function CodingPlanTab({ api }: CodingPlanTabProps): JSX.Element {
  const [provider, setProvider] = useState<Provider>('dashboard')
  const [section, setSection] = useState<Section>('config')
  const [zhipuStatus, setZhipuStatus] = useState<ZhipuStatus | null>(null)
  const [minimaxStatus, setMiniMaxStatus] = useState<MiniMaxStatus | null>(null)
  const [arkStatus, setArkStatus] = useState<ArkStatus | null>(null)
  const [openAiStatus, setOpenAiStatus] = useState<OpenAiGatewayStatus | null>(null)

  const isDashboard = provider === 'dashboard'
  const active = provider === 'zhipu' ? zhipuStatus : provider === 'minimax' ? minimaxStatus : provider === 'ark' ? arkStatus : provider === 'openai' ? openAiStatus : null
  const providerLabel = isDashboard ? '三家用量总览' : provider === 'zhipu' ? '智谱 GLM' : provider === 'minimax' ? 'MiniMax' : provider === 'ark' ? '火山方舟' : 'OpenAI 中转'
  const toolsCount = provider === 'zhipu' ? 5 : provider === 'minimax' ? 5 : provider === 'openai' ? 1 : 0
  const statusLabel = active === null ? '正在读取' : active.credentialConfigured ? '已配置' : '待配置'
  const modelsReady = active !== null && active.providerConfigured && active.models.length > 0 && active.models.every((model) => model.configured)
  const configuredCount = [zhipuStatus, minimaxStatus, arkStatus].filter((status) => status?.credentialConfigured).length

  const onZhipuStatus = useCallback((next: ZhipuStatus): void => setZhipuStatus(next), [])
  const onMiniMaxStatus = useCallback((next: MiniMaxStatus): void => setMiniMaxStatus(next), [])
  const onArkStatus = useCallback((next: ArkStatus): void => setArkStatus(next), [])
  const onOpenAiStatus = useCallback((next: OpenAiGatewayStatus): void => setOpenAiStatus(next), [])
  const providerMeta = useMemo(() => {
    if (isDashboard) return '一屏查看智谱、MiniMax、火山方舟的套餐用量；单家失败互不影响。'
    if (provider === 'ark') return active?.credentialConfigured ? 'Agent Plan 单 Key 已配置' : '需要填写 Agent Plan API Key'
    if (provider === 'openai') return active?.credentialConfigured ? 'OpenAI 兼容中转站已配置' : '需要填写中转站地址和 API Key'
    return active?.credentialConfigured ? '官方凭据已配置' : '需要填写 API Key'
  }, [active, provider, isDashboard])

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
              <div><dt>凭据已配置</dt><dd data-state={configuredCount === 3 ? 'ok' : 'pending'}>{configuredCount}/3</dd></div>
              <div><dt>智谱 GLM</dt><dd data-state={zhipuStatus?.credentialConfigured ? 'ok' : 'pending'}>{zhipuStatus === null ? '读取中' : zhipuStatus.credentialConfigured ? '已配置' : '待配置'}</dd></div>
              <div><dt>MiniMax</dt><dd data-state={minimaxStatus?.credentialConfigured ? 'ok' : 'pending'}>{minimaxStatus === null ? '读取中' : minimaxStatus.credentialConfigured ? '已配置' : '待配置'}</dd></div>
              <div><dt>火山方舟</dt><dd data-state={arkStatus?.credentialConfigured ? 'ok' : 'pending'}>{arkStatus === null ? '读取中' : arkStatus.credentialConfigured ? '已配置' : '待配置'}</dd></div>
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
        <p className={css['planInfoHint']}>{providerMeta}</p>
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
          {isDashboard && <UsageOverviewTab api={api} onNavigate={(target) => { setProvider(target); setSection('config') }} />}
          {provider === 'zhipu' && <ZhipuCodingPlanTab api={api} apiKeyEnv="ZAI_CODING_CN_API_KEY" section={section} embedded onStatusChange={onZhipuStatus} />}
          {provider === 'minimax' && <MiniMaxCodingPlanTab api={api} apiKeyEnv="MINIMAX_CN_API_KEY" section={section} embedded onStatusChange={onMiniMaxStatus} />}
          {provider === 'ark' && <ArkCodingPlanTab api={api} apiKeyEnv="ARK_CODING_PLAN_API_KEY" section={section} embedded onStatusChange={onArkStatus} />}
          {provider === 'openai' && <OpenAiGatewayTab api={api} apiKeyEnv="OPENAI_GATEWAY_API_KEY" onStatusChange={onOpenAiStatus} />}
        </div>
      </div>
    </section>
  )
}
