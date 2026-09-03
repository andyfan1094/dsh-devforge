import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { OpenAiGatewayConfigPatch, OpenAiGatewayEndpointConfig, OpenAiGatewayEndpointStatus, OpenAiGatewayStatus } from '../../openai/protocol.ts'
import css from './panel.module.css'

type EndpointDraft = OpenAiGatewayEndpointConfig & { keyDraft: string }
type Notice = { kind: 'success' | 'error'; text: string }

/** OpenAI 中转站页签属性。 */
export interface OpenAiGatewayTabProps {
  api: DevforgeApi
  apiKeyEnv: string
  onStatusChange?: (status: OpenAiGatewayStatus) => void
}

function toDraft(endpoint: OpenAiGatewayEndpointConfig, index: number, previous?: EndpointDraft): EndpointDraft {
  return {
    id: endpoint.id || 'endpoint-' + (index + 1),
    name: endpoint.name || '端点 ' + (index + 1),
    baseURL: endpoint.baseURL,
    apiKeyEnv: endpoint.apiKeyEnv,
    ...(endpoint.api !== undefined ? { api: endpoint.api } : {}),
    ...(endpoint.imageModel !== undefined ? { imageModel: endpoint.imageModel } : {}),
    keyDraft: previous?.keyDraft ?? '',
  }
}

function statusEndpoints(next: OpenAiGatewayStatus, fallbackApiKeyEnv: string): OpenAiGatewayEndpointConfig[] {
  if (next.endpoints.length > 0) return next.endpoints.map((endpoint) => ({ id: endpoint.id, name: endpoint.name, baseURL: endpoint.baseURL, apiKeyEnv: endpoint.apiKeyEnv, ...(endpoint.api !== undefined ? { api: endpoint.api } : {}), ...(endpoint.imageModel !== undefined ? { imageModel: endpoint.imageModel } : {}) }))
  if (next.baseURL.trim() === '') return [{ id: 'default', name: '主端点', baseURL: '', apiKeyEnv: next.apiKeyEnv || fallbackApiKeyEnv }]
  return [{ id: 'default', name: '主端点', baseURL: next.baseURL, apiKeyEnv: next.apiKeyEnv || fallbackApiKeyEnv, ...(next.api !== undefined ? { api: next.api } : {}), ...(next.imageModel !== undefined ? { imageModel: next.imageModel } : {}) }]
}

/** OpenAI 中转站配置页：支持多端点、独立凭据、模型发现与端点级生图模型。 */
export function OpenAiGatewayTab({ api, apiKeyEnv, onStatusChange }: OpenAiGatewayTabProps): JSX.Element {
  const [status, setStatus] = useState<OpenAiGatewayStatus | null>(null)
  const [endpoints, setEndpoints] = useState<EndpointDraft[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const mounted = useRef(true)
  const controller = useRef<AbortController | null>(null)

  /** 把 Host 脱敏状态同步到表单；Key 原文永不回填浏览器。 */
  const applyStatus = useCallback((next: OpenAiGatewayStatus): void => {
    setStatus(next)
    setEndpoints((previous) => statusEndpoints(next, apiKeyEnv).map((endpoint, index) => toDraft(endpoint, index, previous.find((item) => item.id === endpoint.id))))
    setSelectedId((current) => {
      const nextItems = statusEndpoints(next, apiKeyEnv)
      return nextItems.some((item) => item.id === current) ? current : nextItems[0]?.id ?? ''
    })
    onStatusChange?.(next)
  }, [apiKeyEnv, onStatusChange])

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

  const selected = endpoints.find((endpoint) => endpoint.id === selectedId) ?? endpoints[0]
  const selectedStatus: OpenAiGatewayEndpointStatus | undefined = status?.endpoints.find((endpoint) => endpoint.id === selected?.id)
  const selectedModels = selectedStatus?.models ?? (status?.endpoints.length === 0 && selected?.id === 'default' ? status.models : [])
  const configuredCount = status?.endpoints.filter((endpoint) => endpoint.credentialConfigured).length ?? 0
  const routeCount = status?.endpoints.filter((endpoint) => endpoint.models.length > 0).length ?? 0
  const allConfigured = endpoints.length > 0 && configuredCount === endpoints.length
  const routeReady = routeCount > 0

  const updateSelected = (patch: Partial<EndpointDraft>): void => {
    if (selected === undefined) return
    if (patch.id !== undefined && patch.id.trim() !== '') setSelectedId(patch.id)
    setEndpoints((current) => current.map((endpoint) => endpoint.id === selected.id ? { ...endpoint, ...patch } : endpoint))
    setNotice(null)
  }

  const addEndpoint = (): void => {
    const used = new Set(endpoints.map((endpoint) => endpoint.id))
    let index = endpoints.length + 1
    let id = 'endpoint-' + index
    while (used.has(id)) { index += 1; id = 'endpoint-' + index }
    const endpoint: EndpointDraft = { id, name: '端点 ' + index, baseURL: '', apiKeyEnv: 'OPENAI_GATEWAY_' + id.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase() + '_API_KEY', imageModel: '', keyDraft: '' }
    setEndpoints((current) => [...current, endpoint])
    setSelectedId(id)
    setNotice(null)
  }

  const removeSelected = (): void => {
    if (selected === undefined) return
    const remaining = endpoints.filter((endpoint) => endpoint.id !== selected.id)
    setEndpoints(remaining)
    setSelectedId(remaining[0]?.id ?? '')
    setNotice(null)
  }

  /** 保存所有端点配置；每个端点的新 Key 先写入受管凭据，再提交引用列表。 */
  const save = async (): Promise<void> => {
    const invalid = endpoints.find((endpoint) => endpoint.baseURL.trim() === '' || endpoint.apiKeyEnv.trim() === '' || endpoint.name.trim() === '')
    if (invalid !== undefined) { setNotice({ kind: 'error', text: '请补齐端点名称、地址和凭据引用。' }); return }
    const envKeys = new Map<string, string>()
    for (const endpoint of endpoints) {
      const key = endpoint.keyDraft.trim()
      if (key === '') continue
      const previous = envKeys.get(endpoint.apiKeyEnv.trim())
      if (previous !== undefined && previous !== key) { setNotice({ kind: 'error', text: '同一凭据引用不能同时保存两枚不同的 Key。' }); return }
      envKeys.set(endpoint.apiKeyEnv.trim(), key)
    }
    setSaving(true)
    setNotice(null)
    try {
      for (const [env, key] of envKeys) await api.setCredential(env, key)
      const patch: OpenAiGatewayConfigPatch = {
        endpoints: endpoints.map((endpoint) => {
          const imageModel = endpoint.imageModel?.trim() ?? ''
          return { id: endpoint.id, name: endpoint.name.trim(), baseURL: endpoint.baseURL.trim(), apiKeyEnv: endpoint.apiKeyEnv.trim(), ...(endpoint.api !== undefined ? { api: endpoint.api } : {}), ...(imageModel !== '' ? { imageModel } : {}) }
        }),
      }
      const next = await api.saveOpenAiGatewayConfig(patch)
      if (!mounted.current) return
      setEndpoints((current) => current.map((endpoint) => ({ ...endpoint, keyDraft: '' })))
      applyStatus(next)
      setNotice({ kind: 'success', text: '已保存 ' + next.endpoints.length + ' 个中转端点。' })
    } catch (error) {
      if (mounted.current) setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      if (mounted.current) setSaving(false)
    }
  }

  /** 保存当前端点；凭据和配置只写入当前端点。 */
  const saveSelected = async (): Promise<void> => {
    if (selected === undefined || selected.baseURL.trim() === '' || selected.apiKeyEnv.trim() === '' || selected.name.trim() === '') { setNotice({ kind: 'error', text: '请补齐当前端点名称、地址和凭据引用。' }); return }
    setSaving(true); setNotice(null)
    try {
      if (selected.keyDraft.trim() !== '') await api.setCredential(selected.apiKeyEnv.trim(), selected.keyDraft.trim())
      const next = await api.saveOpenAiGatewayEndpoint({ id: selected.id.trim(), name: selected.name.trim(), baseURL: selected.baseURL.trim(), apiKeyEnv: selected.apiKeyEnv.trim(), ...(selected.api !== undefined ? { api: selected.api } : {}), ...(selected.imageModel?.trim() ? { imageModel: selected.imageModel.trim() } : {}) })
      if (!mounted.current) return
      applyStatus(next); setNotice({ kind: 'success', text: '已保存当前端点，其他端点未改动。' })
    } catch (error) { if (mounted.current) setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) }) }
    finally { if (mounted.current) setSaving(false) }
  }

  /** 从所有端点获取模型；单个失败时继续并显示端点级结果。 */
  const fetchModels = async (): Promise<void> => {
    if (endpoints.length === 0) { setNotice({ kind: 'error', text: '请先添加至少一个中转端点。' }); return }
    setFetching(true)
    setNotice(null)
    try {
      const result = await api.fetchOpenAiGatewayModels()
      if (!mounted.current) return
      applyStatus(result.status)
      const failed = result.results.filter((item) => !item.ok)
      setNotice({ kind: failed.length === 0 ? 'success' : 'error', text: '端点获取完成：成功 ' + result.succeeded + '、失败 ' + result.failed + '；新增 ' + result.added.length + '、移除 ' + result.removed.length + '、合计 ' + result.total + '。' + (failed.length > 0 ? '失败端点：' + failed.map((item) => item.error ?? item.endpointId).join('；') : '') })
    } catch (error) {
      if (mounted.current) setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      if (mounted.current) setFetching(false)
    }
  }

  /** 只获取当前端点模型，失败时不影响其它端点。 */
  const fetchSelectedModels = async (): Promise<void> => {
    if (selected === undefined) return
    setFetching(true); setNotice(null)
    try {
      const result = await api.fetchOpenAiGatewayModels(selected.id)
      if (!mounted.current) return
      applyStatus(result.status)
      const item = result.results.find((entry) => entry.endpointId === selected.id)
      setNotice({ kind: item?.ok === true ? 'success' : 'error', text: item?.ok === true ? '已获取当前端点 ' + item.modelCount + ' 个模型。' : (item?.error ?? '当前端点获取失败。') })
    } catch (error) { if (mounted.current) setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) }) }
    finally { if (mounted.current) setFetching(false) }
  }

  const modelOptions = useMemo(() => {
    const options = [...selectedModels]
    const imageModel = selected?.imageModel?.trim() ?? ''
    if (imageModel !== '' && !options.some((model) => model.id === imageModel)) options.unshift({ id: imageModel, configured: true })
    return options
  }, [selected?.imageModel, selectedModels])

  return (
    <section className={css['openAiWorkspace']}>
      {notice !== null && <div className={css['banner']} data-kind={notice.kind === 'success' ? 'success' : 'error'}>{notice.text}<button type="button" className={css['ghostButton']} onClick={() => setNotice(null)}>关闭</button></div>}
      {loading && status === null && <div className={css['empty']} data-loading="">正在读取 OpenAI 中转站配置…</div>}

      <section className={css['usageSection']}>
        <div className={css['sectionHeader']}>
          <h3 className={css['sectionTitle']}>中转端点</h3>
          <div className={css['inlineActions']}>
            <span className={css['sectionHint']}>{configuredCount}/{endpoints.length} 个凭据已配置 · {routeCount} 个模型路由</span>
            <button type="button" className={css['ghostButton']} onClick={addEndpoint}>添加端点</button>
            <button type="button" className={css['ghostButton']} disabled={fetching || endpoints.length === 0} onClick={() => { void fetchModels() }}>{fetching ? '获取中…' : '获取全部模型'}</button>
            <button type="button" className={css['primaryButton']} disabled={saving} onClick={() => { void save() }}>{saving ? '保存中…' : '保存全部配置'}</button>
          </div>
        </div>
        <p className={css['sectionHint']}>第一个端点继续使用 openai-gateway，其它端点使用独立 provider；删除后会同步清理旧路由。</p>
        <div className={css['endpointLayout']}>
          <div className={css['endpointList']} role="listbox" aria-label="OpenAI 中转端点">
            {endpoints.length === 0 && <div className={css['empty']}>尚未配置端点，请添加一个中转地址。</div>}
            {endpoints.map((endpoint, index) => {
              const endpointStatus = status?.endpoints.find((item) => item.id === endpoint.id)
              return <button key={endpoint.id} type="button" className={css['endpointItem']} data-active={endpoint.id === selected?.id ? '' : undefined} onClick={() => setSelectedId(endpoint.id)} role="option" aria-selected={endpoint.id === selected?.id}>
                <strong>{endpoint.name || '端点 ' + (index + 1)}</strong>
                <span>{endpoint.baseURL || '未填写地址'}</span>
                <small>{endpointStatus?.models.length ?? 0} 个模型 · {endpointStatus?.credentialConfigured ? '凭据正常' : '待配置凭据'}</small>
              </button>
            })}
          </div>

          {selected !== undefined && <div className={css['endpointEditor']}>
            <div className={css['endpointHeader']}>
              <div><h4>{selected.name || '端点配置'}</h4><span>provider：{selectedStatus?.providerId ?? (selected === endpoints[0] ? 'openai-gateway' : '待保存')}</span></div>
              <div className={css['inlineActions']}>
                <button type="button" className={css['ghostButton']} disabled={saving || fetching} onClick={() => { void saveSelected() }}>{saving ? '保存中…' : '保存当前端点'}</button>
                <button type="button" className={css['ghostButton']} disabled={saving || fetching} onClick={() => { void fetchSelectedModels() }}>{fetching ? '获取中…' : '获取当前模型'}</button>
                <button type="button" className={css['dangerButton']} onClick={removeSelected}>删除端点</button>
              </div>
            </div>
            <div className={css['fieldGrid']}>
              <label className={css['compactField']}><span className={css['fieldLabel']}>显示名称</span><input className={css['input']} value={selected.name} onChange={(event) => updateSelected({ name: event.target.value })} /></label>
              <label className={css['compactField']}><span className={css['fieldLabel']}>稳定 ID</span><input className={css['input']} value={selected.id} onChange={(event) => updateSelected({ id: event.target.value })} spellCheck={false} /></label>
              <label className={css['compactField']}><span className={css['fieldLabel']}>中转地址</span><input className={css['input']} type="url" placeholder="https://gateway.example.com 或 …/v1" value={selected.baseURL} onChange={(event) => updateSelected({ baseURL: event.target.value })} spellCheck={false} /></label>
              <label className={css['compactField']}><span className={css['fieldLabel']}>受管凭据引用</span><input className={css['input']} value={selected.apiKeyEnv} onChange={(event) => updateSelected({ apiKeyEnv: event.target.value })} spellCheck={false} /></label>
              <label className={css['compactField']}><span className={css['fieldLabel']}>聊天协议</span><select className={css['input']} value={selected.api ?? 'openai-responses'} onChange={(event) => updateSelected({ api: event.target.value as OpenAiGatewayEndpointConfig['api'] })}>
                <option value="openai-responses">OpenAI Responses（默认）</option>
                <option value="anthropic-messages">Anthropic Messages（Claude /v1/messages）</option>
              </select></label>
            </div>
            <div className={css['keyInputRow']}>
              <input className={css['keyInput']} type="password" autoComplete="new-password" placeholder={selectedStatus?.credentialConfigured ? 'API Key 已配置 · 输入新 Key 可覆盖' : '粘贴该端点 API Key'} value={selected.keyDraft} onChange={(event) => updateSelected({ keyDraft: event.target.value })} spellCheck={false} />
            </div>
            <div className={css['endpointModelList']}>
              <div className={css['metricRow']}><span>聊天模型路由</span><strong data-state={(selectedStatus?.models.length ?? 0) > 0 ? 'ok' : 'pending'}>{selectedStatus?.models.length ?? 0} 个模型</strong></div>
              {selectedStatus?.models.map((model) => <div key={model.id} className={css['metricRow']}><span>{model.name !== undefined && model.name !== model.id ? model.name + ' · ' + model.id : model.id}</span><strong data-state="ok">已注册</strong></div>)}
            </div>
            <div className={css['imageModelEditor']}>
              <label className={css['compactField']}><span className={css['fieldLabel']}>该端点的生图模型</span><select className={css['input']} value={selected.imageModel ?? ''} onChange={(event) => updateSelected({ imageModel: event.target.value })}>
                <option value="">不作为生图端点</option>
                {modelOptions.map((model) => <option key={model.id} value={model.id}>{model.name !== undefined && model.name !== model.id ? model.name + ' · ' + model.id : model.id}</option>)}
              </select></label>
              <p className={css['sectionHint']}>全局 generate_image 会优先使用已选择生图模型的端点；没有选择时使用主端点。</p>
            </div>
          </div>}
        </div>
      </section>

      <section className={css['usageSection']}>
        <h3 className={css['sectionTitle']}>连接总览</h3>
        <div className={css['metricRow']}><span>聊天路由</span><strong data-state={routeReady ? 'ok' : 'pending'}>{routeReady ? '已就绪' : '待获取模型'}</strong></div>
        <div className={css['metricRow']}><span>凭据状态</span><strong data-state={allConfigured ? 'ok' : 'pending'}>{configuredCount}/{endpoints.length} 个端点已配置</strong></div>
        <div className={css['metricRow']}><span>生图工具</span><strong data-state={endpoints.some((endpoint) => endpoint.imageModel?.trim() !== '') ? 'ok' : 'pending'}>generate_image</strong></div>
      </section>
    </section>
  )
}
