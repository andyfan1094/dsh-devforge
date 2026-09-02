/**
 * 硅基流动 Coding Plan 页签 —— 凭据、模型目录和记忆向量入口。
 *
 * 上游已停用余额查询接口，因此本页不显示余额字段，控制台链接只用于账户管理；
 * 模型列表通过 Host 端拉取并写入 llm-pi-ai，浏览器不接触 API Key。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { SiliconFlowStatus } from '../../siliconflow/protocol.ts'
import css from './panel.module.css'

/** 硅基流动控制台入口（账户余额请在官网查看）。 */
const SILICONFLOW_CONSOLE = 'https://cloud.siliconflow.cn'

/** 硅基流动配置页签。 */
export function SiliconFlowCodingPlanTab(props: { api: DevforgeApi; apiKeyEnv: string; onStatusChange?: (status: SiliconFlowStatus) => void }): JSX.Element {
  const { api, apiKeyEnv, onStatusChange } = props
  const [status, setStatus] = useState<SiliconFlowStatus | null>(null)
  const [keyDraft, setKeyDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const mounted = useRef(true)
  const controller = useRef<AbortController | null>(null)

  const applyStatus = useCallback((next: SiliconFlowStatus): void => {
    setStatus(next)
    onStatusChange?.(next)
  }, [onStatusChange])

  const refresh = useCallback(async (): Promise<void> => {
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    setLoading(true)
    try {
      const next = await api.getSiliconFlowStatus(request.signal)
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

  const saveKey = async (): Promise<void> => {
    const value = keyDraft.trim()
    if (value === '') { setNotice({ kind: 'error', text: 'API Key 不能为空。' }); return }
    setSavingKey(true)
    setNotice(null)
    try {
      await api.setCredential(apiKeyEnv, value)
      setKeyDraft('')
      setNotice({ kind: 'success', text: 'API Key 已保存到受管凭据 ' + apiKeyEnv + '。' })
      await refresh()
    } catch (error) {
      if (mounted.current) setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally { if (mounted.current) setSavingKey(false) }
  }

  const syncModels = async (): Promise<void> => {
    if (syncing) return
    setSyncing(true)
    setNotice(null)
    try {
      const next = await api.setupSiliconFlowModels()
      if (!mounted.current) return
      applyStatus(next)
      setNotice({ kind: 'success', text: '已按系列精选同步硅基流动模型：共 ' + next.models.length + ' 个对话模型写入 DSH 模型设置。' })
    } catch (error) {
      if (mounted.current) setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally { if (mounted.current) setSyncing(false) }
  }

  const models = status?.models ?? []
  const routeReady = status?.providerConfigured === true && status.models.length > 0 && status.models.every((model) => model.configured)

  return (
    <section className={css['zhipuWorkspace']}>
      {notice !== null && <div className={css['banner']} data-kind={notice.kind === 'success' ? 'success' : 'error'}>{notice.text}<button type="button" className={css['ghostButton']} onClick={() => setNotice(null)}>关闭</button></div>}
      {loading && status === null && <div className={css['empty']} data-loading="">正在读取硅基流动配置…</div>}

      <section className={css['usageSection']}>
        <h3 className={css['sectionTitle']}>硅基流动接入</h3>
        <div className={css['metricRow']}><span>服务地址</span><strong>https://api.siliconflow.cn/v1</strong></div>
        <div className={css['metricRow']}><span>受管凭据引用</span><strong>{apiKeyEnv}</strong></div>
        <div className={css['metricRow']}><span>模型路由</span><strong data-state={routeReady ? 'ok' : 'pending'}>{routeReady ? '已就绪' : '待同步'}</strong></div>
        <div className={css['keyInputRow']}>
          <input className={css['keyInput']} type="password" autoComplete="new-password" placeholder={status?.credentialConfigured === true ? 'API Key 已配置 · 输入新 Key 可覆盖' : '粘贴 SILICONFLOW_API_KEY'} value={keyDraft} onChange={(event) => { setKeyDraft(event.target.value); setNotice(null) }} spellCheck={false} />
          <button type="button" className={css['ghostButton']} disabled={savingKey || keyDraft.trim() === ''} onClick={() => { void saveKey() }}>{savingKey ? '保存中…' : '保存 Key'}</button>
        </div>
      </section>

      <section className={css['usageSection']}>
        <div className={css['usageToolbar']}>
          <h3 className={css['sectionTitle']}>模型目录</h3>
          <div className={css['toolbarSpacer']} />
          <span className={css['sectionHint']}>已收录 {models.length} 个（各系列最新版）</span>
          <button type="button" className={css['ghostButton']} disabled={syncing || status?.credentialConfigured !== true} onClick={() => { void syncModels() }}>{syncing ? '同步中…' : '从硅基流动同步'}</button>
        </div>
        <p className={css['sectionHint']}>同步按系列精选：每个系列只保留版本最高的对话模型；图片/视频/语音/OCR/向量/重排等非对话模型与 Pro/LoRA 变体自动跳过，以在线清单为准。</p>
        {models.length === 0 ? <div className={css['empty']}>暂无模型。先保存 Key，再点击「从硅基流动同步」。</div> : (
          <div className={css['tableWrap']} style={{ maxHeight: 430, overflow: 'auto' }}>
            <div className={css['resourceList']}>
              {models.map((model) => <div key={model.id} className={css['resourceRow']}>
                <div className={css['resourceInfo']}><strong className={css['resourceTitle']}>{model.id}</strong><span className={css['resourceMeta']}>{model.configured ? '已写入 DSH 模型路由' : '待同步到 DSH'}</span></div>
                {model.free && <span className={css['badge']} data-kind="success">免费</span>}
                <span className={css['badge']} data-kind={model.configured ? 'success' : 'pending'}>{model.configured ? '已接入' : '待接入'}</span>
              </div>)}
            </div>
          </div>
        )}
      </section>

      <section className={css['usageSection']}>
        <h3 className={css['sectionTitle']}>记忆中枢向量</h3>
        <div className={css['metricRow']}><span>推荐模型</span><strong>BAAI/bge-m3 · 1024 维</strong></div>
        <div className={css['metricRow']}><span>使用方式</span><strong>在「记忆中枢」设置中选择「硅基流动」</strong></div>
        <a className={css['link']} href={SILICONFLOW_CONSOLE} target="_blank" rel="noopener noreferrer">打开硅基流动控制台</a>
      </section>
    </section>
  )
}
