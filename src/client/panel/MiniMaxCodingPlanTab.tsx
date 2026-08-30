import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { MiniMaxStatus } from '../../minimax/protocol.ts'
import css from './panel.module.css'

/** MiniMax 页签属性。 */
export interface MiniMaxCodingPlanTabProps {
  api: DevforgeApi
}

/**
 * MiniMax Coding Plan 轻量状态页签。
 * 官方未提供 API Key 可用的用量接口，这里只展示可核实的状态：凭据、模型路由与工具开关；
 * 不展示任何估算或伪造的用量数据。
 */
export function MiniMaxCodingPlanTab({ api }: MiniMaxCodingPlanTabProps): JSX.Element {
  const [status, setStatus] = useState<MiniMaxStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [settingUp, setSettingUp] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  const refreshGeneration = useRef(0)
  const refreshController = useRef<AbortController | null>(null)
  const setupController = useRef<AbortController | null>(null)

  /** 读取凭据与模型路由的脱敏状态；Key 永不进入浏览器。 */
  const refresh = useCallback(async (): Promise<void> => {
    const generation = refreshGeneration.current + 1
    refreshGeneration.current = generation
    refreshController.current?.abort()
    const controller = new AbortController()
    refreshController.current = controller
    setLoading(true)
    setError('')
    try {
      const nextStatus = await api.getMiniMaxStatus(controller.signal)
      if (!mounted.current || refreshGeneration.current !== generation) return
      setStatus(nextStatus)
    } catch (cause) {
      if (controller.signal.aborted || !mounted.current || refreshGeneration.current !== generation) return
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mounted.current && refreshGeneration.current === generation) setLoading(false)
    }
  }, [api])

  useEffect(() => {
    mounted.current = true
    void refresh()
    return () => {
      mounted.current = false
      refreshGeneration.current += 1
      refreshController.current?.abort()
      setupController.current?.abort()
    }
  }, [refresh])

  /** 一键补齐 minimax-cn provider 与最新模型，不覆盖已有字段。 */
  const setupModels = async (): Promise<void> => {
    if (settingUp) return
    setupController.current?.abort()
    const controller = new AbortController()
    setupController.current = controller
    setSettingUp(true)
    setError('')
    try {
      const nextStatus = await api.setupMiniMaxModels(controller.signal)
      if (mounted.current) setStatus(nextStatus)
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mounted.current) setSettingUp(false)
    }
  }

  const modelsReady = useMemo(() => status?.providerConfigured === true && status.models.length > 0 && status.models.every((model) => model.configured), [status])

  return (
    <section className={css['zhipuWorkspace']}>
      <div className={css['integrationHeader']}>
        <span className={css['connectionDot']} data-state={status?.credentialConfigured === true ? 'connected' : 'error'} />
        <div className={css['resourceInfo']}>
          <strong className={css['resourceTitle']}>MiniMax Coding Plan</strong>
          <span className={css['resourceMeta']}>{status?.credentialConfigured === true ? '官方凭据已配置' : '等待配置 MINIMAX_CN_API_KEY'} · {modelsReady ? '模型已就绪' : '模型待完善'} · {status?.tools !== false ? '官方工具已启用' : '官方工具已关闭'}</span>
        </div>
        {!modelsReady && <button type="button" className={css['ghostButton']} disabled={settingUp} onClick={() => { void setupModels() }}>{settingUp ? '正在配置…' : '完善模型接入'}</button>}
        <button type="button" className={css['ghostButton']} disabled={loading} onClick={() => { void refresh() }}>{loading ? '刷新中…' : '刷新'}</button>
      </div>

      {error !== '' && <div className={css['banner']} data-kind="error">{error}</div>}
      {loading && status === null && <div className={css['empty']} data-loading="">正在读取 MiniMax 状态…</div>}
      {!loading && status?.credentialConfigured !== true && <div className={css['banner']} data-kind="warning">请先在 DSH 凭据中配置 MINIMAX_CN_API_KEY（国内站 key 须配 api.minimaxi.com）。</div>}

      {status !== null && (
        <div className={css['usageGrid']}>
          <section className={css['usageSection']}>
            <h3 className={css['sectionTitle']}>模型路由（minimax-cn）</h3>
            {status.models.map((model) => (
              <div key={model.id} className={css['metricRow']}>
                <span>{model.id}</span>
                <strong data-state={model.configured ? 'ok' : 'pending'}>{model.configured ? '已就绪' : '待补齐'}</strong>
              </div>
            ))}
          </section>
          <section className={css['usageSection']}>
            <h3 className={css['sectionTitle']}>官方工具</h3>
            <div className={css['metricRow']}><span>minimax_web_search</span><strong>{status.tools ? '已启用' : '已关闭'}</strong></div>
            <div className={css['metricRow']}><span>minimax_understand_image</span><strong>{status.tools ? '已启用' : '已关闭'}</strong></div>
            <div className={css['metricRow']}><span>模型端点</span><strong>api.minimaxi.com</strong></div>
          </section>
        </div>
      )}

      {status !== null && <div className={css['banner']} data-kind="warning">MiniMax 官方暂未提供 API Key 可用的套餐用量接口，用量请在 MiniMax 开放平台控制台查看。</div>}
    </section>
  )
}
