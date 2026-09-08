/**
 * 主脑路由页签 —— GPT 系列主模型省钱模式。
 *
 * 语义：主模型（如 openai-gateway 下的 GPT 系列）命中匹配规则时，只当
 * 「大脑/项目管理员」——做计划、找关键问题、指挥；它委派的所有子代理统一
 * 改道便宜的「工人模型」（默认 GLM-5.3-Flash）干活，压低 GPT token 开销。
 * 主模型未命中时保持内核默认行为（子代理继承主模型路由）。
 *
 * 交互：载入设置 + 模型目录 → 表单编辑 → 保存（服务端全量校验）；失败内联横幅。
 */
import { useCallback, useEffect, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { BrainRouterCatalogProvider, BrainRouterSettings, BrainRouterStatus } from '../../brain-router/protocol.ts'
import css from './panel.module.css'

const card = { border: '1px solid rgba(128,128,128,0.3)', borderRadius: 8, padding: '8px 10px', minWidth: 0 } as const
const cardTitle = { fontSize: 12, fontWeight: 600, opacity: 0.85, margin: '0 0 6px' } as const
const row = { display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' } as const
const hint = { fontSize: 11, opacity: 0.65, margin: '2px 0 0' } as const

/** 状态徽标：向用户明示路由当前是否真的在生效。 */
function StatusBadge({ status }: { status: BrainRouterStatus }): JSX.Element {
  if (!status.wrapperInstalled) return <span className={css.badge}>⚠ 拦截器未挂载（重启 Host 后生效）</span>
  if (!status.patternValid) return <span className={css.badge}>⚠ 匹配正则非法（当前永不命中）</span>
  if (status.active) return <span className={css.badge}>● 路由已生效</span>
  return <span className={css.badge}>○ 未生效</span>
}

/** 工人模型下拉：目录缺失当前值时追加兜底选项，避免已存配置显示丢失。 */
function ModelSelect({ value, options, placeholder, onChange }: {
  value: string
  options: Array<{ value: string; label: string }>
  placeholder: string
  onChange: (next: string) => void
}): JSX.Element {
  const known = options.some((option) => option.value === value)
  return (
    <select className={css.input} value={value} onChange={(event) => { onChange(event.target.value) }}>
      <option value="">{placeholder}</option>
      {!known && value !== '' && <option value={value}>{value}（已存，目录中暂无）</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  )
}

export function BrainRouterTab({ api }: { api: DevforgeApi }): JSX.Element {
  const [status, setStatus] = useState<BrainRouterStatus | null>(null)
  const [draft, setDraft] = useState<BrainRouterSettings | null>(null)
  const [providers, setProviders] = useState<BrainRouterCatalogProvider[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const reload = useCallback(async () => {
    try {
      const [next, catalog] = await Promise.all([api.getBrainRouter(), api.getBrainRouterCatalog()])
      setStatus(next)
      setDraft(next.settings)
      setProviders(catalog)
    } catch (error) { setMessage('加载失败：' + (error instanceof Error ? error.message : String(error))) }
  }, [api])

  useEffect(() => { void reload() }, [reload])

  const patch = (partial: Partial<BrainRouterSettings>): void => {
    setDraft((prev) => (prev === null ? prev : { ...prev, ...partial }))
  }

  const save = async (): Promise<void> => {
    if (draft === null) return
    setBusy(true)
    setMessage('')
    try {
      const next = await api.saveBrainRouter(draft)
      setStatus(next)
      setDraft(next.settings)
      setMessage('✅ 已保存' + (next.active ? '，路由已生效' : '，路由未生效'))
    } catch (error) {
      setMessage('❌ ' + (error instanceof Error ? error.message : String(error)))
    } finally { setBusy(false) }
  }

  if (draft === null || status === null) {
    return (
      <div>
        <div className={css.banner}>{message !== '' ? message : '加载中…'}</div>
      </div>
    )
  }

  const providerOptions = providers.map((provider) => ({ value: provider.id, label: provider.name + '（' + provider.id + '）' }))
  const selectedProvider = providers.find((provider) => provider.id === draft.workerProvider)
  const modelOptions = (selectedProvider?.models ?? []).map((model) => ({ value: model.id, label: model.name + '（' + model.id + '）' }))
  // 档位下拉数据源：来自所选模型的元数据；默认档位带标注。
  const selectedModel = selectedProvider?.models.find((model) => model.id === draft.workerModel)
  const effortOptions = (selectedModel?.efforts ?? []).map((effort) => ({ value: effort.id, label: effort.name + (selectedModel?.defaultEffort === effort.id ? '（默认）' : '') }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {message !== '' && <div className={css.banner}>{message}</div>}

      <div style={card}>
        <p style={cardTitle}>主脑路由（GPT 系列省钱模式） <StatusBadge status={status} /></p>
        <div style={{ fontSize: 11.5, opacity: 0.75, lineHeight: 1.6 }}>
          会话主模型命中下方匹配规则时（默认 GPT 系列），主模型只当「大脑/项目管理员」——做计划、找关键问题、指挥；
          它派出去干活的子代理（subagent / workflow / ralph 等全部委派入口）统一改道工人模型执行，省下 GPT 的 token 开销。
          主模型未命中时保持原行为（子代理继承主模型）。设置即改即生效，无需重启。
        </div>
      </div>

      <div style={card}>
        <p style={cardTitle}>规则</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <input type="checkbox" checked={draft.enabled} onChange={(event) => { patch({ enabled: event.target.checked }) }} />
            启用主脑路由
          </label>
          <div style={row}>
            <div>
              <label className={css.fieldLabel}>主模型匹配正则（不区分大小写，匹配 "provider/model"）</label>
              <input className={css.input} value={draft.mainModelPattern} placeholder="gpt"
                onChange={(event) => { patch({ mainModelPattern: event.target.value }) }} />
              <p style={hint}>默认 gpt：openai-gateway/gpt-5.6 这类 GPT 系列命中；zai-coding-cn/glm-… 不命中。</p>
            </div>
          </div>
          <div style={row}>
            <div>
              <label className={css.fieldLabel}>工人模型 provider</label>
              <ModelSelect value={draft.workerProvider} options={providerOptions} placeholder="（未配置）"
                onChange={(next) => { patch({ workerProvider: next, workerModel: '', workerReasoningEffort: '' }) }} />
            </div>
            <div>
              <label className={css.fieldLabel}>工人模型 model</label>
              <ModelSelect value={draft.workerModel} options={modelOptions} placeholder={draft.workerProvider === '' ? '先选 provider' : '（未配置）'}
                onChange={(next) => { patch({ workerModel: next, workerReasoningEffort: '' }) }} />
            </div>
            <div>
              <label className={css.fieldLabel}>推理档位（下拉选择）</label>
              <ModelSelect value={draft.workerReasoningEffort} options={effortOptions} placeholder={draft.workerModel === '' ? '先选模型' : '模型默认档'}
                onChange={(next) => { patch({ workerReasoningEffort: next }) }} />
              <p style={hint}>档位来自所选模型的元数据，换工人模型会自动清空；留空用该模型的默认档。</p>
            </div>
          </div>
          <div style={row}>
            <div>
              <label className={css.fieldLabel}>不改道的委派入口（逗号分隔）</label>
              <input className={css.input} style={{ minWidth: 240 }} value={draft.excludeProviders.join(', ')}
                onChange={(event) => { patch({ excludeProviders: event.target.value.split(/[,,]/).map((item) => item.trim()).filter((item) => item !== '') }) }} />
              <p style={hint}>fork 会复用主模型的会话缓存，改道会破坏复用，服务端强制保留 fork。</p>
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <input type="checkbox" checked={draft.overrideExplicit} onChange={(event) => { patch({ overrideExplicit: event.target.checked }) }} />
            主模型显式为子代理指定模型时仍强制改道（默认尊重显式选择）
          </label>
        </div>
      </div>

      <div style={row}>
        <button type="button" className={css.ghostButton} disabled={busy} onClick={() => { void save() }}>保存设置</button>
        <button type="button" className={css.ghostButton} disabled={busy} onClick={() => { void reload() }}>刷新</button>
      </div>
    </div>
  )
}
