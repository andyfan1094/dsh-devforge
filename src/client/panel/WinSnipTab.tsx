/**
 * 「小工具」设置页（Windows 截图 + 剪贴板历史）：开关、热键、保存目录、模型通道与翻译方向。
 *
 * 交互约定：所有改动点一下即存（保存由 Host 落库并即时重启原生助手），
 * 不做"改完再点保存"，避免用户以为已经生效其实没生效。
 * 状态区是唯一区分"开关打开"和"进程真的在跑"的地方——
 * 这两件事会脱节（原生进程崩溃、热键被占用），所以必须分开显示。
 *
 * 版面约定（2026-10-19 重排，只动视觉与文案，不动任何接口与状态流转）：
 * 四张 `.formGrid` 分组卡片——助手状态 / 截图行为 / 识别与翻译 / 剪贴板历史。
 * 重组前这一页是 8 行扁平 `.formRow`：字段、说明、按钮同一个重量地平铺下来，
 * 组内间距等于组间间距（都是 --dv-gap），用户看不出"这是几件事"，
 * 而"进程在不在跑"这条最该先看到的事实被埋在页尾的说明文字里。
 * 现在：标题行右侧直接挂状态徽章；分组边界由卡片给出；每个字段的说明降到
 * 字段下方的三级文字（原来与控件同行，抢标签的视线）。
 *
 * 剪贴板历史卡（2026-10-19 新增）：开关、保留天数与"存在哪/多少条/最后一条何时"
 * 放在同一张卡里——只读信息是用户判断"功能是否真的在工作"的唯一依据，
 * 拆到别处就又回到"勾了没反应"的困惑里。
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

/** 进行中的动作 → 中文反馈：按钮被禁用期间必须说清在等什么，否则用户会重复点。 */
const BUSY_TEXT: Readonly<Record<string, string>> = {
  save: '保存中…',
  capture: '截图中…',
  clipboard: '打开中…',
  start: '启动后台中…',
  stop: '停止后台中…',
}

/** 保留天数的允许区间：与宿主侧 WIN_SNIP_CLIPBOARD_DAYS 保持一致。 */
const DAYS_MIN = 1
const DAYS_MAX = 90
const DAYS_FALLBACK = 15

/**
 * 保留天数前端夹取。
 *
 * 输入框允许用户中途敲出空值或越界值（否则删数字都会被打断），
 * 所以在这里统一收敛：非法输入回落 15 天，越界夹到 1/90。
 */
function clampDays(value: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return DAYS_FALLBACK
  return Math.min(DAYS_MAX, Math.max(DAYS_MIN, parsed))
}

/** 最近记录时间转成可读文案；空值或脏值一律「暂无记录」，不把 Invalid Date 摆给用户。 */
function formatRecordedAt(iso: string | undefined): string {
  if (iso === undefined || iso === '') return '暂无记录'
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return '暂无记录'
  // 精确到分钟即可：秒对"最近一次记录"没有信息量，只会把这一行撑长。
  return at.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function WinSnipTab({ api }: { api: DevforgeApi }): JSX.Element {
  const [status, setStatus] = useState<WinSnipStatus | null>(null)
  const [settings, setSettings] = useState<WinSnipSettings | null>(null)
  const [models, setModels] = useState<ReadonlyArray<{ id: string; name: string; provider: string }>>([])
  const [hotkeyDraft, setHotkeyDraft] = useState('')
  const [saveDirDraft, setSaveDirDraft] = useState('')
  // 保留天数用草稿 + 「应用天数」：数字框每敲一位就存会把 15 改成 1 再改 15，中间态会真落库。
  const [daysDraft, setDaysDraft] = useState(String(DAYS_FALLBACK))
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
      setDaysDraft(String(nextSettings.clipboardDays))
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
  // 识别模型存的是具体模型 id，空串表示自动；下拉直接跟配置走，不另存草稿。
  const ocrModel = settings?.ocrModel ?? ''
  // 每屏只留一个实心主按钮，且它永远指向当下最有用的那件事：
  // 没跑 → 启动后台；在跑 → 立即截图（此时停止后台退成次级按钮）。
  const busyText = BUSY_TEXT[busy] ?? (busy !== '' ? '处理中…' : '')

  return (
    <section className={css['tabBody']} data-dsh-part="win-snip">
      {/* 页头：标题 + 状态徽章同排。助手在不在跑是进页最该先知道的事实，
          放在这里就不必滚到页尾、也不必把开关和进程状态来回对照。 */}
      <div className={css['toolbar']}>
        <strong className={css['panelTitle']}>小工具</strong>
        <span className={css['badge']} data-status={running ? 'running' : 'idle'}>{running ? '运行中' : '未运行'}</span>
        <span className={css['sectionHint']}>Windows 全局热键截图与标注 · 剪贴板历史</span>
        {busyText !== '' && <span className={css['sectionHint']}>{busyText}</span>}
        <button type="button" className={css['ghostButton']} disabled={loading} onClick={() => { void refresh() }}>刷新</button>
        <button
          type="button"
          className={running ? css['primaryButton'] : css['ghostButton']}
          disabled={busy !== '' || !supported || !running}
          onClick={() => { void run('capture', async () => { await api.winSnipCapture() }) }}
        >
          立即截图
        </button>
        {/* 剪贴板入口与截图同排但退成次级：主按钮永远指向"当下最常用的那件事"，
            而它只有在助手真的在跑时才有意义（命令要靠原生助手消费）。 */}
        <button
          type="button"
          className={css['ghostButton']}
          disabled={busy !== '' || !supported || !running}
          onClick={() => { void run('clipboard', async () => { await api.winSnipClipboard() }) }}
        >
          打开剪贴板
        </button>
      </div>

      {error !== '' && <div className={css['banner']} data-kind="error">{error}</div>}
      {!supported && (
        <div className={css['banner']} data-kind="warning">
          当前系统不是 Windows，截图小工具不可用；本页配置仍会保留。
        </div>
      )}
      {/* 热键被占用、脚本缺失这类异常由宿主写在 status.message 里，属警告而非普通说明。 */}
      {supported && status?.message !== undefined && status.message !== '' && (
        <div className={css['banner']} data-kind="warning">{status.message}</div>
      )}

      {/* 卡片一 · 助手状态：把"开关"（配置）与"进程"（事实）放在同一张卡里对照，
          它们会脱节（进程崩了、热键被占），所以既要有开关，也要有真实运行状态。 */}
      <div className={css['formGrid']} data-layout="stacked" data-dsh-part="win-snip-state">
        <div className={css['surfaceHeader']}>
          <h3 className={css['sectionTitle']}>助手状态</h3>
          <span className={css['toolbarSpacer']} />
          {running ? (
            <button
              type="button"
              className={css['ghostButton']}
              disabled={busy !== ''}
              onClick={() => { void run('stop', async () => { await api.winSnipStop() }) }}
            >
              停止后台
            </button>
          ) : (
            <button
              type="button"
              className={css['primaryButton']}
              disabled={busy !== '' || !supported}
              onClick={() => { void run('start', async () => { await api.winSnipStart() }) }}
            >
              启动后台
            </button>
          )}
        </div>
        <p className={css['subtleText']}>
          {running
            ? `后台进程运行中（PID ${status?.pid ?? '-'}）· 热键 ${status?.hotkey ?? ''} · 累计截图 ${status?.captures ?? 0} 次 · 剪贴板历史 ${status?.clipboardItems ?? 0} 条 · 保留最近 ${status?.clipboardDays ?? DAYS_FALLBACK} 天`
            : '后台进程未运行，按热键不会有反应；点右侧「启动后台」开始。'}
        </p>
        <div className={css['field']}>
          <label className={css['checkLabel']}>
            <input
              type="checkbox"
              checked={settings?.enabled === true}
              disabled={busy !== '' || settings === null}
              onChange={(event) => { save({ enabled: event.target.checked }) }}
            />
            随 DSH 启动常驻后台（占用全局热键）
          </label>
          <span className={css['mutedText']}>勾选即存，重启后台进程后生效。</span>
        </div>
      </div>

      {/* 卡片二 · 截图行为：热键与保存目录各带一个"应用"按钮，按钮紧贴它作用的字段——
          拉到别处或与另一个字段共用一行，用户就不知道这个按钮改的是哪一个。 */}
      <div className={css['formGrid']} data-layout="stacked" data-dsh-part="win-snip-capture">
        <h3 className={css['sectionTitle']}>截图行为</h3>
        {/* 同一分区不混用两种保存语义；这里两种都要有，就把语义写在分区说明里。 */}
        <p className={css['subtleText']}>
          热键与目录改完点「应用」生效（会重启后台进程）；下面勾选项勾选即存。
          「先弹功能选择框」关掉后，热键直接进入截图，剪贴板历史只能从页面按钮打开。
        </p>

        {/* 热键行为的第一个决定：按下去先弹选择框，还是直接进截图。
            放在热键字段之前，因为它是"热键按下之后发生什么"的上位选择。 */}
        <div className={css['fieldActions']}>
          <label className={css['checkLabel']}>
            <input
              type="checkbox"
              checked={settings?.hotkeyMenu === true}
              disabled={busy !== '' || settings === null}
              onChange={(event) => { save({ hotkeyMenu: event.target.checked }) }}
            />
            按热键先弹出功能选择框（截图 / 剪贴板）
          </label>
        </div>

        <div className={css['field']} data-width="short">
          <label className={css['fieldLabel']} htmlFor="win-snip-hotkey">全局热键</label>
          <span className={css['inlineAction']}>
            <input
              id="win-snip-hotkey"
              type="text"
              value={hotkeyDraft}
              disabled={busy !== ''}
              placeholder="Alt+A"
              onChange={(event) => { setHotkeyDraft(event.target.value) }}
            />
            <button
              type="button"
              className={css['ghostButton']}
              disabled={busy !== '' || hotkeyDraft.trim() === '' || hotkeyDraft === settings?.hotkey}
              onClick={() => { save({ hotkey: hotkeyDraft.trim() }) }}
            >
              应用热键
            </button>
          </span>
          <span className={css['mutedText']}>
            写法：修饰键 + 主键，例如 <code>Alt+A</code>、<code>Ctrl+Shift+S</code>、<code>Win+PrintScreen</code>
          </span>
        </div>

        <div className={css['field']}>
          <label className={css['fieldLabel']} htmlFor="win-snip-save-dir">保存目录</label>
          <span className={css['inlineAction']}>
            <input
              id="win-snip-save-dir"
              type="text"
              value={saveDirDraft}
              disabled={busy !== ''}
              placeholder={status?.saveDir ?? ''}
              onChange={(event) => { setSaveDirDraft(event.target.value) }}
            />
            <button
              type="button"
              className={css['ghostButton']}
              disabled={busy !== '' || saveDirDraft === settings?.saveDir}
              onClick={() => { save({ saveDir: saveDirDraft.trim() }) }}
            >
              应用目录
            </button>
          </span>
          <span className={css['mutedText']}>留空即用默认目录（图片\DSH截图）</span>
        </div>

        <div className={css['fieldActions']}>
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
      </div>

      {/* 卡片三 · 识别与翻译：模型跑分是"选型依据"，保留但降到字段下方的三级说明，
          不再像原来那样在页面上平铺成独立一行、把字段和说明割开。 */}
      <div className={css['formGrid']} data-layout="stacked" data-dsh-part="win-snip-vision">
        <h3 className={css['sectionTitle']}>识别与翻译</h3>
        <p className={css['subtleText']}>下拉框改完即存；识别模型在每次识别时现读，不用重启。</p>

        <div className={css['field']}>
          <label className={css['fieldLabel']} htmlFor="win-snip-ocr-model">识别模型</label>
          <select
            id="win-snip-ocr-model"
            value={ocrModel}
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
          <span className={css['mutedText']}>
            走插件里已配好的模型与凭据，不用单独填 Key。实测同一张图：GLM-Flash 4.2 秒、gpt-6.1-sol 4.5 秒、
            Kimi-K3 10.9 秒、gpt-5.6-terra 34.7 秒；重的推理模型慢但更准。
          </span>
        </div>

        <div className={css['field']}>
          <label className={css['fieldLabel']} htmlFor="win-snip-translate-target">翻译方向</label>
          <select
            id="win-snip-translate-target"
            value={settings?.translateTarget ?? 'auto'}
            disabled={busy !== '' || settings === null}
            onChange={(event) => { save({ translateTarget: event.target.value as WinSnipSettings['translateTarget'] }) }}
          >
            {TARGETS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>

        {/* 选区翻译（0.67.0，辉哥 2026-10-22 需求）：选中文字按热键直接翻译。
            两个开关叠在一起才有意义：关掉兜底时，UIA 读不到选区的窗口（微信/终端）会退回老行为。 */}
        <div className={css['fieldActions']}>
          <label className={css['checkLabel']}>
            <input
              type="checkbox"
              checked={settings?.translateSelection === true}
              disabled={busy !== '' || settings === null}
              onChange={(event) => { save({ translateSelection: event.target.checked }) }}
            />
            选中文字后按热键直接翻译（没有选区时照旧弹选择框 / 截图）
          </label>
        </div>

        <div className={css['fieldActions']}>
          <label className={css['checkLabel']}>
            <input
              type="checkbox"
              checked={settings?.selectionCopyFallback === true}
              disabled={busy !== '' || settings === null}
              onChange={(event) => { save({ selectionCopyFallback: event.target.checked }) }}
            />
            读不到系统选区时用 Ctrl+C 兜底
          </label>
          <span className={css['mutedText']}>
            兜底会临时读写剪贴板取选中文字、取完还原原内容；资源管理器里选中文件时自动跳过，
            以免把文件复制进剪贴板。关掉后只有系统能报告选区的窗口（浏览器 / Office / 多数编辑器）才生效。
          </span>
        </div>
      </div>

      {/* 卡片四 · 剪贴板历史：开关、保留天数与"存在哪/多少条/最后一条何时"同卡。
          只读信息是用户判断"功能到底有没有在工作"的唯一依据，单独拆卡就又变成
          "勾了却没反应、也无从核对"的困惑。 */}
      <div className={css['formGrid']} data-layout="stacked" data-dsh-part="win-snip-clipboard">
        <h3 className={css['sectionTitle']}>剪贴板历史</h3>
        <p className={css['subtleText']}>
          复制过的文字与图片记在本机，超过保留天数的自动清理；不联网、不上传。
          按热键选「剪贴板」查看，或用页头的「打开剪贴板」。
        </p>

        <div className={css['fieldActions']}>
          <label className={css['checkLabel']}>
            <input
              type="checkbox"
              checked={settings?.clipboardEnabled === true}
              disabled={busy !== '' || settings === null}
              onChange={(event) => { save({ clipboardEnabled: event.target.checked }) }}
            />
            记录复制内容到本机历史
          </label>
        </div>

        <div className={css['field']} data-width="short">
          <label className={css['fieldLabel']} htmlFor="win-snip-clipboard-days">保留天数</label>
          <span className={css['inlineAction']}>
            <input
              id="win-snip-clipboard-days"
              type="number"
              min={DAYS_MIN}
              max={DAYS_MAX}
              value={daysDraft}
              disabled={busy !== ''}
              onChange={(event) => { setDaysDraft(event.target.value) }}
            />
            <button
              type="button"
              className={css['ghostButton']}
              disabled={busy !== '' || settings === null || (daysDraft.trim() !== '' && clampDays(daysDraft) === settings?.clipboardDays)}
              onClick={() => {
                // 前端先夹取再提交，宿主侧还会再夹一次：两边都夹是冗余，但能防手工改库/旧客户端。
                const days = clampDays(daysDraft)
                setDaysDraft(String(days))
                save({ clipboardDays: days })
              }}
            >
              应用天数
            </button>
          </span>
          <span className={css['mutedText']}>范围 1–90 天，改完点「应用天数」生效（不用重启后台）。</span>
        </div>

        {/* 只读信息：宿主 status 里一定给数字，lastClipboardAt 可能缺省，统一走空值兜底文案。 */}
        <p className={css['subtleText']}>
          存储目录：{status?.clipboardDir ?? '-'} · 当前 {status?.clipboardItems ?? 0} 条 ·
          最近一次记录 {formatRecordedAt(status?.lastClipboardAt)}
        </p>
      </div>

      {/* 用法：读一次就够的引导，放页尾，不占用设置分组。
          "改动何时生效"已分别下沉到各分区的说明里（就地比集中在页尾更近）。 */}
      <p className={css['subtleText']}>
        用法：按 {settings?.hotkey ?? 'Alt+A'} → 选择「截图」或「剪贴板」→
        截图走框选与标注（矩形/箭头/文字/马赛克，或「识别」「翻译」走模型视觉、「钉图」钉在最上层）；
        剪贴板历史可搜索，回车 / 双击 / 「复制」复制回剪贴板后窗口自动关闭，Delete 删除。
      </p>
    </section>
  )
}
