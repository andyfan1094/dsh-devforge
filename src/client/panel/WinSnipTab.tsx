/**
 * 截图小工具设置页：开关、热键、保存目录、模型通道与翻译方向。
 *
 * 交互约定：所有改动点一下即存（保存由 Host 落库并即时重启原生助手），
 * 不做"改完再点保存"，避免用户以为已经生效其实没生效。
 * 状态区是唯一区分"开关打开"和"进程真的在跑"的地方——
 * 这两件事会脱节（原生进程崩溃、热键被占用），所以必须分开显示。
 */
import { useEffect, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { WinSnipSettings, WinSnipStatus } from '../../win-snip/protocol.ts'
import type { ModelCatalogProvider } from '../../model-catalog.ts'
import css from './panel.module.css'


/** 翻译方向：识别文字后要译成什么语言。 */
const TARGETS: ReadonlyArray<{ value: WinSnipSettings['translateTarget']; label: string }> = [
  { value: 'auto', label: '自动（中文原文译英文，其它译中文）' },
  { value: 'zh', label: '译成中文' },
  { value: 'en', label: '译成英文' },
]

export function WinSnipTab({ api }: { api: DevforgeApi }): JSX.Element {
  const [status, setStatus] = useState<WinSnipStatus | null>(null)
  const [settings, setSettings] = useState<WinSnipSettings | null>(null)
  const [models, setModels] = useState<ReadonlyArray<{ id: string; name: string; provider: string }>>([])
  const [hotkeyDraft, setHotkeyDraft] = useState('')
  const [saveDirDraft, setSaveDirDraft] = useState('')
  const [busy, setBusy] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  /** 一次刷新同时拉状态与配置：状态回答"进程在不在"，配置决定"按什么参数跑"。 */
  const refresh = async (): Promise<void> => {
    try {
      setLoading(true); setError('')
      const [nextStatus, nextSettings] = await Promise.all([api.getWinSnipStatus(), api.getWinSnipSettings()])
      setStatus(nextStatus)
      setSettings(nextSettings)
      // 模型目录用于识别模型下拉：列出模型来源与名称，用户自己决定用快的还是聪明的。
      try {
        const catalog: ModelCatalogProvider[] = await api.getModelCatalog()
        const flat: Array<{ id: string; name: string; provider: string }> = []
        for (const provider of catalog) {
          for (const model of provider.models ?? []) {
            flat.push({ id: model.id, name: model.name ?? model.id, provider: provider.id })
          }
        }
        setModels(flat)
      } catch { setModels([]) }
      setHotkeyDraft(nextSettings.hotkey)
      setSaveDirDraft(nextSettings.saveDir)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])

  /** 统一包装：任何保存动作都先禁用其它按钮，失败把原因摆到页面上。 */
  const run = async (label: string, action: () => Promise<void>): Promise<void> => {
    if (busy !== '') return
    try { setBusy(label); setError(''); await action(); await refresh() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy('') }
  }

  const save = (patch: Partial<WinSnipSettings>): void => {
    void run('save', async () => { setSettings(await api.putWinSnipSettings(patch)) })
  }

  // 原生助手没跑起来时，热键和截图按钮都不该给用户"能用"的错觉。
  const running = status?.running === true
  const supported = status?.supported !== false

  return (
    <section className={css['tabBody']}>
      <div className={css['toolbar']}>
        <strong>截图小工具</strong>
        <span className={css['sectionHint']}>Windows 全局热键截图 · 框选标注 · 识别与翻译 · 钉图悬浮</span>
        <span className={css['toolbarSpacer']} />
        <button type="button" className={css['ghostButton']} disabled={loading} onClick={() => { void refresh() }}>刷新</button>
        <button
          type="button"
          className={css['ghostButton']}
          disabled={busy !== '' || !supported || !running}
          onClick={() => { void run('capture', async () => { await api.winSnipCapture() }) }}
        >
          立即截图
        </button>
      </div>

      {error !== '' && <div className={css['banner']} data-kind="error">{error}</div>}
      {!supported && (
        <div className={css['banner']} data-kind="warn">
          当前系统不是 Windows，截图小工具不可用；本页配置仍会保留。
        </div>
      )}

      <div className={css['formRow']}>
        <label className={css['checkLabel']}>
          <input
            type="checkbox"
            checked={settings?.enabled === true}
            disabled={busy !== '' || settings === null}
            onChange={(event) => { save({ enabled: event.target.checked }) }}
          />
          启用截图小工具（常驻后台，占用全局热键）
        </label>
        {busy === 'save' && <span className={css['sectionHint']}>保存中…</span>}
      </div>

      <div className={css['formRow']}>
        <label className={css['fieldLabel']}>
          全局热键
          <input
            type="text"
            value={hotkeyDraft}
            disabled={busy !== ''}
            placeholder="Alt+A"
            onChange={(event) => { setHotkeyDraft(event.target.value) }}
          />
        </label>
        <button
          type="button"
          className={css['ghostButton']}
          disabled={busy !== '' || hotkeyDraft.trim() === '' || hotkeyDraft === settings?.hotkey}
          onClick={() => { save({ hotkey: hotkeyDraft.trim() }) }}
        >
          应用热键
        </button>
        <span className={css['sectionHint']}>
          写法：修饰键 + 主键，例如 <code>Alt+A</code>、<code>Ctrl+Shift+S</code>、<code>Win+PrintScreen</code>
        </span>
      </div>

      <div className={css['formRow']}>
        <label className={css['fieldLabel']}>
          保存目录
          <input
            type="text"
            value={saveDirDraft}
            disabled={busy !== ''}
            placeholder={status?.saveDir ?? ''}
            onChange={(event) => { setSaveDirDraft(event.target.value) }}
          />
        </label>
        <button
          type="button"
          className={css['ghostButton']}
          disabled={busy !== '' || saveDirDraft === settings?.saveDir}
          onClick={() => { save({ saveDir: saveDirDraft.trim() }) }}
        >
          应用目录
        </button>
        <span className={css['sectionHint']}>留空即用默认目录（图片\DSH截图）</span>
      </div>

      {/* 识别模型：默认自动挑快且能看图的；实测模型之间差好几倍，所以允许手动改。 */}
      <div className={css['formRow']}>
        <label className={css['fieldLabel']}>
          识别模型
          <select
            value={settings?.ocrModel ?? ''}
            disabled={busy !== '' || settings === null}
            onChange={(event) => { save({ ocrModel: event.target.value }) }}
          >
            <option value="">自动（优先快且能看图，约 4 秒）</option>
            {models.map((model) => (
              <option key={model.provider + '/' + model.id} value={model.id}>
                {model.name}（{model.provider}）
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={css['formRow']}>
        <span className={css['sectionHint']}>
          走插件里已配好的模型与凭据，不用单独填 Key。实测同一张图：GLM-Flash 4.2 秒、gpt-6.1-sol 4.5 秒、
          Kimi-K3 10.9 秒、gpt-5.6-terra 34.7 秒；DeepSeek V4.1 Flash 看不了图（返回空）。
        </span>
      </div>

      <div className={css['formRow']}>
        <label className={css['fieldLabel']}>
          翻译方向
          <select
            value={settings?.translateTarget ?? 'auto'}
            disabled={busy !== '' || settings === null}
            onChange={(event) => { save({ translateTarget: event.target.value as WinSnipSettings['translateTarget'] }) }}
          >
            {TARGETS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className={css['checkLabel']}>
          <input
            type="checkbox"
            checked={settings?.copyOnFinish === true}
            disabled={busy !== '' || settings === null}
            onChange={(event) => { save({ copyOnFinish: event.target.checked }) }}
          />
          截图完成后直接复制到剪贴板
        </label>
      </div>

      {/* 状态区：把「开关打开」和「进程在跑」分开显示，避免用户以为已经生效。 */}
      <div className={css['formRow']}>
        <span className={css['sectionHint']}>
          后台进程：{running ? `运行中（PID ${status?.pid ?? '-'}）` : '未运行'}
          {status?.hotkey !== undefined && status.hotkey !== '' ? ` · 热键 ${status.hotkey}` : ''}
          {status?.captures !== undefined ? ` · 累计截图 ${status.captures} 次` : ''}
        </span>
        {status?.message !== undefined && status.message !== '' && <span className={css['sectionHint']}>{status.message}</span>}
      </div>

      <div className={css['formRow']}>
        <button
          type="button"
          className={css['ghostButton']}
          disabled={busy !== '' || !supported || running}
          onClick={() => { void run('start', async () => { await api.winSnipStart() }) }}
        >
          启动后台
        </button>
        <button
          type="button"
          className={css['ghostButton']}
          disabled={busy !== '' || !running}
          onClick={() => { void run('stop', async () => { await api.winSnipStop() }) }}
        >
          停止后台
        </button>
        <span className={css['sectionHint']}>
          热键、保存目录、开关的改动会重启后台进程后才生效；识别模型在每次识别时现读，改完立刻生效。
        </span>
      </div>

      <div className={css['formRow']}>
        <span className={css['sectionHint']}>
          用法：按 {settings?.hotkey ?? 'Alt+A'} 起手 → 拖动框选 → 松开进入标注 →
          工具条上可画矩形/箭头/文字/马赛克，或点「识别」「翻译」走模型视觉 →「钉图」把结果钉在屏幕最上层（Esc 关闭）。
        </span>
      </div>
    </section>
  )
}
