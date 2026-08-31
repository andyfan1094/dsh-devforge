import { useCallback, useMemo, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { MiniMaxStatus } from '../../minimax/protocol.ts'
import type { ZhipuStatus } from '../../zhipu/protocol.ts'
import { MiniMaxCodingPlanTab } from './MiniMaxCodingPlanTab.tsx'
import { ZhipuCodingPlanTab } from './ZhipuCodingPlanTab.tsx'
import css from './panel.module.css'

/** Coding Plan 工作区属性。 */
export interface CodingPlanTabProps {
  api: DevforgeApi
}

type Provider = 'zhipu' | 'minimax'
type Section = 'config' | 'usage'

/** 收敛所有 Coding Plan 服务商为一个工作区。 */
export function CodingPlanTab({ api }: CodingPlanTabProps): JSX.Element {
  const [provider, setProvider] = useState<Provider>('zhipu')
  const [section, setSection] = useState<Section>('config')
  const [zhipuStatus, setZhipuStatus] = useState<ZhipuStatus | null>(null)
  const [minimaxStatus, setMiniMaxStatus] = useState<MiniMaxStatus | null>(null)

  const active = provider === 'zhipu' ? zhipuStatus : minimaxStatus
  const providerLabel = provider === 'zhipu' ? '智谱 GLM' : 'MiniMax'
  const toolsCount = provider === 'zhipu' ? 5 : 5
  const statusLabel = active === null ? '正在读取' : active.credentialConfigured ? '已配置' : '待配置'
  const modelsReady = active !== null && active.providerConfigured && active.models.length > 0 && active.models.every((model) => model.configured)

  const onZhipuStatus = useCallback((next: ZhipuStatus): void => setZhipuStatus(next), [])
  const onMiniMaxStatus = useCallback((next: MiniMaxStatus): void => setMiniMaxStatus(next), [])
  const providerMeta = useMemo(() => active?.credentialConfigured ? '官方凭据已配置' : '需要填写 API Key', [active])

  return (
    <section className={css['codePlanWorkspace']}>
      <aside className={css['codePlanSidebar']} aria-label="套餐信息">
        <div className={css['codePlanAsideHeading']}>
          <span className={css['sectionHint']}>套餐信息</span>
          <strong>Coding Plan</strong>
        </div>
        <dl className={css['planInfoList']}>
          <div><dt>服务商</dt><dd>{providerLabel}</dd></div>
          <div><dt>订阅状态</dt><dd data-state={active?.credentialConfigured ? 'ok' : 'pending'}>{statusLabel}</dd></div>
          <div><dt>模型数量</dt><dd>{active?.models.length ?? 0} 个</dd></div>
          <div><dt>模型路由</dt><dd data-state={modelsReady ? 'ok' : 'pending'}>{modelsReady ? '已就绪' : '待完善'}</dd></div>
          <div><dt>官方工具</dt><dd>{toolsCount} 个</dd></div>
        </dl>
        <p className={css['planInfoHint']}>{providerMeta}</p>
      </aside>

      <div className={css['codePlanMain']}>
        <header className={css['codePlanHeader']}>
          <div>
            <h3>Coding Plan</h3>
            <p>统一管理智谱与 MiniMax 的 API Key、模型路由、官方工具和套餐用量。</p>
          </div>
        </header>

        <div className={css['providerTabs']} role="tablist" aria-label="Coding Plan 服务商">
          <button type="button" role="tab" data-active={provider === 'zhipu' ? '' : undefined} aria-selected={provider === 'zhipu'} onClick={() => setProvider('zhipu')}>智谱 GLM</button>
          <button type="button" role="tab" data-active={provider === 'minimax' ? '' : undefined} aria-selected={provider === 'minimax'} onClick={() => setProvider('minimax')}>MiniMax</button>
        </div>

        <div className={css['codePlanSectionTabs']} role="tablist" aria-label="Coding Plan 内容">
          <button type="button" role="tab" data-active={section === 'config' ? '' : undefined} aria-selected={section === 'config'} onClick={() => setSection('config')}>使用配置</button>
          <button type="button" role="tab" data-active={section === 'usage' ? '' : undefined} aria-selected={section === 'usage'} onClick={() => setSection('usage')}>用量统计</button>
        </div>

        <div className={css['codePlanContent']}>
          {provider === 'zhipu' && <ZhipuCodingPlanTab api={api} apiKeyEnv="ZAI_CODING_CN_API_KEY" section={section} embedded onStatusChange={onZhipuStatus} />}
          {provider === 'minimax' && <MiniMaxCodingPlanTab api={api} apiKeyEnv="MINIMAX_CN_API_KEY" section={section} embedded onStatusChange={onMiniMaxStatus} />}
        </div>
      </div>
    </section>
  )
}
