// 飞书帮助卡与模型切换卡：/help 与 /model 命令的互动卡片构建。
// 纯函数模块：同样的输入永远产出同样的卡片，方便单测断言；
// 卡片按钮回调统一走 feishu_help / feishu_model_pick / feishu_model_apply 动作，
// 由 index.mjs 的卡片回调路由分发（问答卡片仍归答题器）。
import { sendCard } from './outbound.mjs'

/** 卡片容量护栏：飞书单卡 30 KB 上限，模型数量与文本长度都要截断。 */
const MAX_TEXT_CHARS = 1_500
/** 模型全量展示（辉哥定稿）：上限只是 30KB 护栏，双列网格下 60 个模型约 18KB，正常规模全放得下。 */
export const MAX_HELP_MODEL_BUTTONS = 60
export const MAX_HELP_EFFORT_BUTTONS = 8

/** 回调动作名：帮助卡快捷命令、模型挑选、思考强度应用。 */
export const HELP_ACTIONS = {
  CMD: 'feishu_help_cmd',
  MODEL_PICK: 'feishu_model_pick',
  MODEL_APPLY: 'feishu_model_apply',
}

/** 卡片文本截断：过长内容进卡片会被飞书整卡拒绝，宁可截断保可用。 */
function clip(text, max = MAX_TEXT_CHARS) {
  const value = String(text ?? '').trim()
  return value.length <= max ? value : value.slice(0, max) + '…'
}

function md(content) {
  return { tag: 'div', text: { tag: 'lark_md', content: clip(content) } }
}

function button(text, value, type = 'default', size = 'medium') {
  return { tag: 'button', size, type, text: { tag: 'plain_text', content: clip(text, 40) }, behaviors: [{ type: 'callback', value }] }
}

/**
 * 帮助卡：命令清单 + 快捷操作按钮。
 * 快捷按钮不直接嵌命令文本，而是发回调让宿主代为执行（保持与手输命令同一入口）。
 */
export function buildHelpCard() {
  const elements = [
    md('**常用命令**（直接在会话输入框发送）'),
    md('• /status — 查看当前模型、思考强度与会话状态'),
    md('• /model — 切换模型与思考强度（点卡片按钮即可切换）'),
    md('• /stop — 停止当前正在运行的任务'),
    md('• /whoami — 查看当前飞书身份'),
    md('• /help — 显示本帮助卡片'),
    { tag: 'hr' },
    md('**使用小贴士**'),
    md('• 任务运行中再发消息会**插入当前任务**继续处理；用 **!** 开头发送为显式插话'),
    md('• 长会话由 DSH **自动压缩**上下文，无需手动操作；压缩后通道提示仍每轮保留'),
    md('• 生成的文件/图片会直接发到本会话，手机上直接打开'),
    md('• 提问卡片 **30 分钟**未作答自动取消，改用文字继续沟通'),
    { tag: 'hr' },
    button('📊 查看当前状态', { action: HELP_ACTIONS.CMD, cmd: 'status' }),
    button('🔁 切换模型 / 思考强度', { action: HELP_ACTIONS.CMD, cmd: 'model' }, 'primary'),
  ]
  return {
    schema: '2.0',
    header: { template: 'blue', title: { tag: 'plain_text', content: '📖 飞书通道帮助' } },
    body: { elements },
  }
}

/**
 * 双列按钮网格：把按钮按每行 2 个包进 column_set，密度高、手机上不用无限下滑。
 * 尾行奇数时用空列补位保持两列等宽。辉哥定稿：可以挤一点，但模型要全部展示。
 */
function gridRows(buttons, perRow = 2) {
  const rows = []
  for (let index = 0; index < buttons.length; index += perRow) {
    const chunk = buttons.slice(index, index + perRow)
    const columns = chunk.map((element) => ({ tag: 'column', width: 'weighted', weight: 1, elements: [element] }))
    while (columns.length < perRow) columns.push({ tag: 'column', width: 'weighted', weight: 1, elements: [md('')] })
    rows.push({ tag: 'column_set', flex_mode: 'bisect', columns })
  }
  return rows
}

/**
 * 模型选择卡：当前选中值 + 按提供商分组的双列模型网格，全量展示不截断。
 * current: { provider, model, reasoningEffort }；models: [{ provider, model, name, reasoningEfforts }]。
 * 点模型按钮发 feishu_model_pick，由宿主回一张思考强度选择卡。
 * 默认上限只是 30KB 护栏（正常规模全量展示），真超限才截断并提示。
 */
export function buildModelCard(current, models, { maxModels = MAX_HELP_MODEL_BUTTONS } = {}) {
  const list = (Array.isArray(models) ? models : []).filter((item) => String(item?.provider ?? '').trim() !== '' && String(item?.model ?? '').trim() !== '')
  const shown = list.slice(0, maxModels)
  const currentLabel = current?.model ? clip(String(current.model), 60) : '（跟随默认配置）'
  const effortLabel = current?.reasoningEffort ? clip(String(current.reasoningEffort), 40) : '默认'
  const elements = [
    md('**当前选中**：' + currentLabel + '（思考强度：' + effortLabel + '）'),
    md('点击模型进入思考强度选择；切换会**重建当前会话**（上下文清空），任务运行中请先 /stop。'),
    { tag: 'hr' },
  ]
  let lastProvider = ''
  let group = []
  const flushGroup = () => {
    if (group.length === 0) return
    elements.push(...gridRows(group))
    group = []
  }
  for (const item of shown) {
    const provider = String(item.provider)
    if (provider !== lastProvider) {
      flushGroup()
      elements.push(md('**' + clip(provider, 40) + '**'))
      lastProvider = provider
    }
    const label = clip(String(item.name ?? item.model), 32)
    const picked = current?.provider === provider && current?.model === item.model
    group.push(button(label + (picked ? '（当前）' : ''), { action: HELP_ACTIONS.MODEL_PICK, provider, model: String(item.model) }, picked ? 'primary' : 'default'))
  }
  flushGroup()
  if (list.length > shown.length) {
    elements.push(md('（模型数量超过 ' + maxModels + ' 上限，仅展示前 ' + shown.length + ' 个；完整列表请在电脑端「天工造梦 → 飞书」面板选择）'))
  }
  if (shown.length === 0) elements.push(md('暂无可用模型：请先在电脑端「天工造梦 → 飞书」面板配置模型。'))
  return {
    schema: '2.0',
    header: { template: 'turquoise', title: { tag: 'plain_text', content: '🔁 模型与思考强度' } },
    body: { elements },
  }
}

/**
 * 思考强度选择卡：picked = { provider, model, name, reasoningEfforts }。
 * 「跟随默认」按钮 effort 传空串，应用时清除显式思考强度。
 */
export function buildEffortCard(picked) {
  const provider = clip(picked?.provider ?? '', 60)
  const model = clip(picked?.model ?? '', 80)
  const name = clip(picked?.name ?? model, 60)
  const efforts = (Array.isArray(picked?.reasoningEfforts) ? picked.reasoningEfforts : [])
    .map((item) => ({ id: String(item?.id ?? item ?? '').trim(), name: String(item?.name ?? item?.id ?? item ?? '').trim() }))
    .filter((item) => item.id !== '')
    .slice(0, MAX_HELP_EFFORT_BUTTONS)
  const elements = [
    md('**' + name + '**（' + clip(provider, 40) + '）'),
    md('选择思考强度；「跟随默认」表示不显式指定，由默认配置决定。'),
    { tag: 'hr' },
    button('跟随默认', { action: HELP_ACTIONS.MODEL_APPLY, provider, model, effort: '' }, 'primary'),
  ]
  for (const effort of efforts) {
    elements.push(button(clip(effort.name === '' ? effort.id : effort.name, 32), { action: HELP_ACTIONS.MODEL_APPLY, provider, model, effort: effort.id }))
  }
  if (efforts.length === 0) elements.push(md('（该模型没有可选思考强度，点「跟随默认」直接应用）'))
  return {
    schema: '2.0',
    header: { template: 'turquoise', title: { tag: 'plain_text', content: '🧠 思考强度 · ' + name } },
    body: { elements },
  }
}

/**
 * 帮助卡的宿主侧动作处理依赖会话上下文，这里只提供与 questions.mjs 同风格的
 * 发送辅助：拿到桥客户端就把卡发出去，客户端未连接时报错由调用方兜底为文字回复。
 */
export async function sendCardToChat(getClient, chatId, card) {
  const client = getClient?.()
  if (client === null || client === undefined) throw new Error('飞书客户端未连接，无法投递卡片')
  return await sendCard(client, chatId, card)
}
