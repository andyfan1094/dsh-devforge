import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { ArkStatus } from '../../ark/protocol.ts'
import css from './panel.module.css'

/** 火山方舟页签属性。 */
export interface ArkCodingPlanTabProps {
  api: DevforgeApi
  apiKeyEnv: string
  section?: 'config' | 'usage'
  embedded?: boolean
  onStatusChange?: (status: ArkStatus) => void
}

const ARK_USAGE_CONSOLE = 'https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement?LLM=%7B%7D&advancedActiveKey=agentPlan'

/** 火山方舟 Agent Plan 的单 Key 配置、模型池与用量入口。 */
export function ArkCodingPlanTab({ api, apiKeyEnv, section = 'config', embedded = false, onStatusChange }: ArkCodingPlanTabProps): JSX.Element {
  const isConfig = section === 'config'
  const [status, setStatus] = useState<ArkStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [savingKey, setSavingKey] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  const refreshGeneration = useRef(0)
  const refreshController = useRef<AbortController | null>(null)

  const applyStatus = useCallback((next: ArkStatus): void => {
    setStatus(next)
    onStatusChange?.(next)
  }, [onStatusChange])

  const refresh = useCallback(async (): Promise<void> => {
    const generation = refreshGeneration.current + 1
    refreshGeneration.current = generation
    refreshController.current?.abort()
    const controller = new AbortController()
    refreshController.current = controller
    setLoading(true)
    setError('')
    try {
      const next = await api.getArkStatus(controller.signal)
      if (!mounted.current || refreshGeneration.current !== generation) return
      applyStatus(next)
    } catch (cause) {
      if (controller.signal.aborted || !mounted.current || refreshGeneration.current !== generation) return
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mounted.current && refreshGeneration.current === generation) setLoading(false)
    }
  }, [api, applyStatus])

  useEffect(() => {
    mounted.current = true
    void refresh()
    return () => {
      mounted.current = false
      refreshGeneration.current += 1
      refreshController.current?.abort()
    }
  }, [refresh])

  const syncModels = async (successText = '官方 Agent Plan 模型池已同步。'): Promise<void> => {
    if (syncing) return
    setSyncing(true)
    setError('')
    try {
      const next = await api.setupArkModels()
      if (!mounted.current) return
      applyStatus(next)
      setNotice({ kind: 'success', text: successText + ' 当前共 ' + next.models.length + ' 个模型路由。' })
    } catch (cause) {
      if (mounted.current) setNotice({ kind: 'error', text: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      if (mounted.current) setSyncing(false)
    }
  }

  const saveKey = async (): Promise<void> => {
    const value = keyDraft.trim()
    if (value === '') { setNotice({ kind: 'error', text: 'Plan API Key 不能为空。' }); return }
    setSavingKey(true)
    setError('')
    try {
      await api.setCredential(apiKeyEnv, value)
      setKeyDraft('')
      const next = await api.setupArkModels()
      if (!mounted.current) return
      applyStatus(next)
      setNotice({ kind: 'success', text: 'Plan API Key 已保存，' + next.models.length + ' 个 Agent Plan 模型已就绪。' })
    } catch (cause) {
      if (mounted.current) setNotice({ kind: 'error', text: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      if (mounted.current) setSavingKey(false)
    }
  }

  const modelsReady = useMemo(() => status?.providerConfigured === true && status.models.length > 1 && status.models.every((model) => model.configured), [status])

  return (
    <section className={css['zhipuWorkspace']}>
      {!embedded && <div className={css['integrationHeader']}>
        <span className={css['connectionDot']} data-state={status?.credentialConfigured === true ? 'connected' : 'error'} />
        <div className={css['resourceInfo']}>
          <strong className={css['resourceTitle']}>火山方舟 Agent Plan</strong>
          <span className={css['resourceMeta']}>{status?.credentialConfigured ? '官方凭据已配置' : '等待配置 Plan API Key'} · {modelsReady ? '模型已就绪' : '模型待同步'}</span>
        </div>
        <button type="button" className={css['ghostButton']} disabled={loading} onClick={() => { void refresh() }}>{loading ? '刷新中…' : '刷新'}</button>
      </div>}

      {error !== '' && <div className={css['banner']} data-kind="error">{error}</div>}
      {notice !== null && <div className={css['banner']} data-kind={notice.kind === 'success' ? 'success' : 'error'}>{notice.text}<button type="button" className={css['ghostButton']} onClick={() => setNotice(null)}>关闭</button></div>}
      {loading && status === null && <div className={css['empty']} data-loading="">正在读取火山方舟{isConfig ? '配置状态' : '套餐状态'}…</div>}

      {isConfig && <>
        <section className={css['usageSection']}>
          <h3 className={css['sectionTitle']}>API Key 配置</h3>
          <div className={css['metricRow']}><span>受管凭据引用</span><strong>{apiKeyEnv}</strong></div>
          <div className={css['keyInputRow']}>
            <input
              type="password"
              className={css['keyInput']}
              placeholder={status?.credentialConfigured ? '已配置 · 输入新 Key 可覆盖' : '粘贴 ark- 开头的 Agent Plan Key'}
              value={keyDraft}
              onChange={(event) => { setKeyDraft(event.target.value); setNotice(null) }}
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" className={css['ghostButton']} disabled={savingKey || keyDraft.trim() === ''} onClick={() => { void saveKey() }}>{savingKey ? '保存中…' : '保存 Key'}</button>
          </div>
          <p className={css['planInfoHint']}>只需要这一枚 Plan Key。模型请求固定走官方 <code>https://ark.cn-beijing.volces.com/api/plan/v3</code>，不会使用可能额外计费的普通 <code>/api/v3</code>。</p>
        </section>

        <section className={css['usageSection']}>
          <h3 className={css['sectionTitle']}>模型路由（volcengine-ark-plan）</h3>
          <div className={css['modelToolbar']}>
            <button type="button" className={css['ghostButton']} disabled={syncing || !status?.credentialConfigured} onClick={() => { void syncModels() }}>{syncing ? '同步中…' : '同步官方模型'}</button>
          </div>
          {status?.models.length === 0 ? <div className={css['empty']}>尚未配置任何模型。</div> : status?.models.map((model) => (
            <div key={model.id} className={css['metricRow']}>
              <span>{model.id}</span>
              <strong data-state={model.configured ? 'ok' : 'pending'}>{model.configured ? '已就绪' : '待同步'}</strong>
            </div>
          ))}
        </section>

        {status !== null && !status.credentialConfigured && <div className={css['banner']} data-kind="warning">请先在上方填写 Agent Plan API Key；保存后会自动同步全部官方文本模型。</div>}
      </>}

      {!isConfig && <section className={css['usageSection']}>
        <h3 className={css['sectionTitle']}>套餐用量</h3>
        <div className={css['metricRow']}><span>模型池</span><strong>{status?.models.length ?? 0} 个</strong></div>
        <div className={css['metricRow']}><span>统计来源</span><strong>火山方舟 Agent Plan 控制台</strong></div>
        <p className={css['planInfoHint']}>Plan API Key 只负责模型调用，官方未向它开放 AFP 用量读取接口。用量页不再要求额外 AK/SK，可直接打开官方控制台查看 5 小时、周和月额度。</p>
        <div className={css['modelToolbar']}>
          <button type="button" className={css['ghostButton']} onClick={() => window.open(ARK_USAGE_CONSOLE, '_blank', 'noopener,noreferrer')}>打开官方用量控制台</button>
        </div>
      </section>}
    </section>
  )
}
