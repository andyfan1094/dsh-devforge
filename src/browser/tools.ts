/** 本地浏览器跨会话 Agent 工具。操作在本机屏幕实时可见；工具绝不返回系统路径或进程参数。 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { BrowserService } from './service.ts'

function text(value: string): ContentBlock[] { return [{ type: 'text', text: value }] }
function safeError(error: unknown): string { return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 300) }

/** 浏览器状态（被动读取，不拉起进程）。 */
export function browserStatusTool(service: BrowserService) {
  return defineTool({ name: 'browser_status', description: '读取服务工厂托管的本地浏览器状态。浏览器运行在本机屏幕上实时可见，固定用户档案保存登录状态；不返回任何系统路径。', parameters: {}, output: { schema: { type: 'object', additionalProperties: false, properties: { enabled: { type: 'boolean', required: true }, running: { type: 'boolean', required: true }, ready: { type: 'boolean', required: true }, currentUrl: { type: 'string' }, pageTitle: { type: 'string' }, message: { type: 'string' } } }, render: (_args, value) => text(JSON.stringify(value)) }, async execute() { const { profileDir: _profileDir, ...status } = await service.status(); return status } })
}

/** 打开或跳转页面，并返回页面快照。 */
export function browserOpenTool(service: BrowserService) {
  return defineTool({ name: 'browser_open', description: '在服务工厂托管的本地浏览器中打开 http(s) 地址，返回页面无障碍快照。浏览器窗口在用户屏幕上实时可见。', parameters: { url: { type: 'string', required: true, description: '要打开的 http(s) 地址。' } }, output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, snapshot: { type: 'string' }, error: { type: 'string' } } }, render: (_args, value) => text(value.ok ? (value.snapshot ?? '') : '打开失败：' + (value.error ?? '未知错误')) }, async execute(args) { try { return { ok: true, snapshot: await service.withExclusive(() => service.navigate(args.url)) } } catch (error) { return { ok: false, error: safeError(error) } } } })
}

/** 读取当前页快照。 */
export function browserSnapshotTool(service: BrowserService) {
  return defineTool({ name: 'browser_snapshot', description: '读取本地浏览器当前页的无障碍文本快照和稳定元素引用。必须先快照再用引用点击或输入。', parameters: {}, output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, snapshot: { type: 'string' }, error: { type: 'string' } } }, render: (_args, value) => text(value.ok ? (value.snapshot ?? '') : '快照失败：' + (value.error ?? '未知错误')) }, async execute() { try { return { ok: true, snapshot: await service.withExclusive(() => service.snapshot()) } } catch (error) { return { ok: false, error: safeError(error) } } } })
}

/** 安全元素操作的共同包装。 */
function actionTool(name: string, description: string, parameters: Record<string, any>, execute: (args: any) => Promise<void>) {
  return defineTool({ name, description, parameters, output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, error: { type: 'string' } } }, render: (_args, value) => text(value.ok ? '操作完成' : '操作失败：' + (value.error ?? '未知错误')) }, async execute(args) { try { await execute(args); return { ok: true } } catch (error) { return { ok: false, error: safeError(error) } } } })
}

export function browserClickTool(service: BrowserService) { return actionTool('browser_click', '点击最近一次快照中的元素引用。', { ref: { type: 'string', required: true, description: '快照里的元素引用，例如 e5。' } }, async args => { await service.withExclusive(() => service.click(args.ref)) }) }
export function browserTypeTool(service: BrowserService) { return actionTool('browser_type', '向最近一次快照中的输入元素填写文本。', { ref: { type: 'string', required: true, description: '快照里的元素引用。' }, text: { type: 'string', required: true, description: '要输入的文本。' }, submit: { type: 'boolean', description: '填写后是否按 Enter。' } }, async args => { await service.withExclusive(() => service.type(args.ref, args.text, args.submit === true)) }) }
/** 管理同一可见 Chrome 中的标签页。 */
export function browserTabsTool(service: BrowserService) {
  return defineTool({
    name: 'browser_tabs',
    description: '管理服务工厂可见浏览器中的标签页：列出、新建、选择或关闭。多个任务可保留各自页面，页面操作会安全排队。',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'new', 'select', 'close'], description: '标签页操作。' },
      index: { type: 'number', description: '选择或关闭时使用的标签页序号。' },
      url: { type: 'string', description: '新建标签页时打开的 http(s) 地址。' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, tabs: { type: 'string' }, error: { type: 'string' } } }, render: (_args, value) => text(value.ok ? (value.tabs ?? '') : '标签页操作失败：' + (value.error ?? '未知错误')) },
    async execute(args) {
      try {
        const tabs = await service.withExclusive(() => service.tabs(args.action, args.index, args.url))
        return { ok: true, tabs }
      } catch (error) {
        return { ok: false, error: safeError(error) }
      }
    },
  })
}

/** 上传图片到当前页已打开的文件选择器。 */
export function browserUploadTool(service: BrowserService) {
  return actionTool('browser_upload', '上传本机图片到当前页已打开的文件选择器。会校验类型、大小并暂存到 MCP 允许目录。', { filePath: { type: 'string', required: true, description: '本机图片绝对路径。' } }, async args => { await service.withExclusive(() => service.upload(args.filePath)) })
}

export function browserCloseTool(service: BrowserService) { return actionTool('browser_close', '停止本地浏览器会话。用户档案保留，登录状态不丢失。', {}, async args => { await service.withExclusive(async () => { await service.stop() }) }) }
