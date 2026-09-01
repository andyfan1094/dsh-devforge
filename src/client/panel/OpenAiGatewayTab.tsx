import { useCallback, useEffect, useRef, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { OpenAiGatewayStatus } from '../../openai/protocol.ts'
import css from './panel.module.css'

/** OpenAI 中转站页签属性。 */
export interface OpenAiGatewayTabProps {
  api: DevforgeApi
  apiKeyEnv: string
  onStatusChange?: (status: OpenAiGatewayStatus) => void
}

/** OpenAI 中转站配置页：地址、受管 Key、模型发现与生图模型选择。 */
export function OpenAiGatewayTab({ api, apiKeyEnv, onStatusChange }: OpenAiGatewayTabProps): JSX.Element {
  const [status, setStatus] = useState<OpenAiGatewayStatus | null>(null)
  const [baseURL, setBaseURL] = useState('')
  const [keyDraft, setKeyDraft] = useState('')
  const [imageModel, setImageModel] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const mounted = useRef(true)
  const controller = useRef<AbortController | null>(null)

  /** 把 Host 脱敏状态同步到表单；Key 原文永不回填浏览器。 */
  const applyStatus = useCallback((next: OpenAiGatewayStatus): void => {
    setStatus(next)
    setBaseURL(next.baseURL)
    setImageModel(next.imageModel ?? '')
    onStatusChange?.(next)
  }, [onStatusChange])

  /** 刷新脱敏状态。 */
  const refresh = useCallback(async (): Promise<void> => {
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    setLoading(true)
    try {
      const next = await api.getOpenAiGatewayStatus(request.signal)
      if (mounted.current && !request.signal.aborted) applyStatus(next)
    } catch (error) {
      if (mounted.current && !request.signal.aborted) setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      if (mounted.current && !request.signal.aborted) setLoading(false)
    }
  }, [api, applyStatus])

  useEffect(() => {
    mounted.current = true
    void refresh()
    return () => { mounted.current = false; controller.current?.abort() }
  }, [refresh])

  /** 保存地址、可选新 Key 和当前生图模型。 */
  const save = async (): Promise<void> => {
    if (baseURL.trim() === '') { setNotice({ kind: 'error', text: '中转站地址不能为空。' }); return }
    setSaving(true)
    setNotice(null)
    try {
      if (keyDraft.trim() !== '') await api.setCredential(status?.apiKeyEnv ?? apiKeyEnv, keyDraft.trim())
      const next = await api.saveOpenAiGatewayConfig({ baseURL: baseURL.trim(), imageModel: imageModel.trim() })
      if (!mounted.current) return
      setKeyDraft('')
      applyStatus(next)
      setNotice({ kind: 'success', text: '中转站配置已保存。' })
    } catch (error) {
      if (mounted.current) setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      if (mounted.current) setSaving(false)
    }
  }

  /** 从 GET /v1/models 获取模型，以中转站返回为准同步目录（保留已有元数据，移除已下线模型）。 */
  const fetchModels = async (): Promise<void> => {
    setFetching(true)
    setNotice(null)
    try {
      const result = await api.fetchOpenAiGatewayModels()
      if (!mounted.current) return
      applyStatus(result.status)
      const suggested = result.status.models.find((model) => /gpt-image|dall-e|imagen|flux|seedream/i.test(model.id))
      if ((result.status.imageModel ?? '') === '' && suggested !== undefined) setImageModel(suggested.id)
      setNotice({ kind: 'success', text: '获取模型成功：新增 ' + result.added.length + '、移除 ' + result.removed.length + '、保留 ' + result.kept.length + '，合计 ' + result.total + '。' })
    } catch (error) {
      if (mounted.current) setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      if (mounted.current) setFetching(false)
    }
  }

  const configured = status?.credentialConfigured === true
  const routeReady = status?.providerConfigured === true && status.models.length > 0

  return (
    <section className={css['zhipuWorkspace']}>
      {notice !== null && <div className={css['banner']} data-kind={notice.kind === 'success' ? 'success' : 'error'}>{notice.text}<button type="button" className={css['ghostButton']} onClick={() => setNotice(null)}>关闭</button></div>}
      {loading && status === null && <div className={css['empty']} data-loading="">正在读取 OpenAI 中转站配置…</div>}

      <section className={css['usageSection']}>
        <h3 className={css['sectionTitle']}>中转站连接</h3>
        <div className={css['metricRow']}><span>聊天模型路由</span><strong data-state={routeReady ? 'ok' : 'pending'}>{routeReady ? 'openai-gateway 已就绪' : '待获取模型'}</strong></div>
        <div className={css['metricRow']}><span>受管凭据引用</span><strong>{status?.apiKeyEnv ?? apiKeyEnv}</strong></div>
        <div className={css['keyInputRow']}>
          <input className={css['keyInput']} type="url" autoComplete="off" placeholder="https://gateway.example.com 或 …/v1" value={baseURL} onChange={(event) => { setBaseURL(event.target.value); setNotice(null) }} spellCheck={false} />
        </div>
        <div className={css['keyInputRow']}>
          <input
            className={css['keyInput']}
            type="password" autoComplete="new-password"
            placeholder={configured ? 'API Key 已配置 · 输入新 Key 可覆盖' : '粘贴中转站 API Key'}
            value={keyDraft}
            onChange={(event) => { setKeyDraft(event.target.value); setNotice(null) }}
            spellCheck={false}
          />
          <button type="button" className={css['ghostButton']} disabled={saving || baseURL.trim() === ''} onClick={() => { void save() }}>{saving ? '保存中…' : '保存配置'}</button>
        </div>
      </section>

      <section className={css['usageSection']}>
        <h3 className={css['sectionTitle']}>模型目录</h3>
        <div className={css['modelToolbar']}>
          <button type="button" className={css['ghostButton']} disabled={fetching || !configured || baseURL.trim() === ''} onClick={() => { void fetchModels() }} title="调用中转站 GET /v1/models 并同步聊天模型路由（以中转站返回为准）">{fetching ? '获取中…' : '从中转站获取模型'}</button>
        </div>
        {status?.models.length === 0 ? <div className={css['empty']}>尚未获取模型。</div> : status?.models.map((model) => (
          <div key={model.id} className={css['metricRow']}>
            <span>{model.name !== undefined && model.name !== model.id ? model.name + ' · ' + model.id : model.id}</span>
            <strong data-state={model.configured ? 'ok' : 'pending'}>{model.configured ? '聊天路由已注册' : '待注册'}</strong>
          </div>
        ))}
      </section>

      <section className={css['usageSection']}>
        <h3 className={css['sectionTitle']}>全局生图工具</h3>
        <div className={css['metricRow']}><span>工具名</span><strong>generate_image</strong></div>
        <div className={css['keyInputRow']}>
          <select className={css['keyInput']} value={imageModel} onChange={(event) => { setImageModel(event.target.value); setNotice(null) }}>
            <option value="">选择生图模型</option>
            {(status?.models ?? []).map((model) => <option key={model.id} value={model.id}>{model.name ?? model.id}</option>)}
          </select>
          <button type="button" className={css['ghostButton']} disabled={saving || baseURL.trim() === '' || imageModel === ''} onClick={() => { void save() }}>保存生图模型</button>
        </div>
        <div className={css['metricRow']}><span>当前模型</span><strong data-state={status?.imageModel !== undefined ? 'ok' : 'pending'}>{status?.imageModel ?? '待选择'}</strong></div>
      </section>
    </section>
  )
}
