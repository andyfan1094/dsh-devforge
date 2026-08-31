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
  return defineTool({ name: 'browser_open', description: '在服务工厂托管的本地浏览器中打开 http(s) 地址（独立新标签页），返回页面无障碍快照。浏览器窗口在用户屏幕上实时可见；任务结束后请用 browser_tabs 评估并关闭不再使用的标签页。', parameters: { url: { type: 'string', required: true, description: '要打开的 http(s) 地址。' } }, output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, snapshot: { type: 'string' }, error: { type: 'string' } } }, render: (_args, value) => text(value.ok ? (value.snapshot ?? '') : '打开失败：' + (value.error ?? '未知错误')) }, async execute(args) { try { return { ok: true, snapshot: await service.withExclusive(() => service.openTab(args.url)) } } catch (error) { return { ok: false, error: safeError(error) } } } })
}

/** 读取当前页快照。 */
export function browserSnapshotTool(service: BrowserService) {
  return defineTool({ name: 'browser_snapshot', description: '读取标签页快照。传入该标签页任一旧引用时会自动切回对应页面；返回的新引用已绑定标签身份。', parameters: { ref: { type: 'string', description: '该标签页之前快照中的任一作用域引用；省略时读取当前标签页。' } }, output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, snapshot: { type: 'string' }, error: { type: 'string' } } }, render: (_args, value) => text(value.ok ? (value.snapshot ?? '') : '快照失败：' + (value.error ?? '未知错误')) }, async execute(args) { try { return { ok: true, snapshot: await service.withExclusive(() => service.snapshot(args.ref)) } } catch (error) { return { ok: false, error: safeError(error) } } } })
}

/** 安全元素操作的共同包装。 */
function actionTool(name: string, description: string, parameters: Record<string, any>, execute: (args: any) => Promise<void>) {
  return defineTool({ name, description, parameters, output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, error: { type: 'string' } } }, render: (_args, value) => text(value.ok ? '操作完成' : '操作失败：' + (value.error ?? '未知错误')) }, async execute(args) { try { await execute(args); return { ok: true } } catch (error) { return { ok: false, error: safeError(error) } } } })
}

/** 点击作用域引用并返回操作后的新快照。 */
export function browserClickTool(service: BrowserService) {
  return defineTool({
    name: 'browser_click',
    description: '点击作用域引用所属标签页的元素，并返回操作后的新快照。引用失效时拒绝猜测。',
    parameters: { ref: { type: 'string', required: true, description: '快照里的标签绑定引用，例如 t2g1:e5。' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, snapshot: { type: 'string' }, error: { type: 'string' } } }, render: (_args, value) => text(value.ok ? (value.snapshot ?? '') : '点击失败：' + (value.error ?? '未知错误')) },
    async execute(args) { try { return { ok: true, snapshot: await service.withExclusive(() => service.click(args.ref)) } } catch (error) { return { ok: false, error: safeError(error) } } },
  })
}

/** 输入文本并返回该标签页的刷新快照。 */
export function browserTypeTool(service: BrowserService) {
  return defineTool({
    name: 'browser_type',
    description: '向作用域引用所属标签页输入文本，并返回刷新后的新快照。',
    parameters: { ref: { type: 'string', required: true, description: '快照里的标签绑定引用。' }, text: { type: 'string', required: true, description: '要输入的文本。' }, submit: { type: 'boolean', description: '填写后是否按 Enter。' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, snapshot: { type: 'string' }, error: { type: 'string' } } }, render: (_args, value) => text(value.ok ? (value.snapshot ?? '') : '输入失败：' + (value.error ?? '未知错误')) },
    async execute(args) {
      try {
        const snapshot = await service.withExclusive(async () => { await service.type(args.ref, args.text, args.submit === true); return await service.snapshot(args.ref) })
        return { ok: true, snapshot }
      } catch (error) { return { ok: false, error: safeError(error) } }
    },
  })
}
/** 管理同一可见 Chrome 中的标签页。 */
export function browserTabsTool(service: BrowserService) {
  return defineTool({
    name: 'browser_tabs',
    description: '管理服务工厂可见浏览器中的标签页：列出（附带来源与闲置评估建议）、新建、选择、关闭，以及清理闲置标签页。任务用完的标签页应当评估并及时关闭，避免页面堆积。',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'new', 'select', 'close', 'close_idle'], description: '标签页操作：list 附带来源与闲置评估建议；close_idle 一键清理闲置标签页。' },
      index: { type: 'number', description: '选择或关闭时使用的标签页序号。' },
      url: { type: 'string', description: '新建标签页时打开的 http(s) 地址。' },
      minIdleMinutes: { type: 'number', description: 'close_idle 的闲置阈值（分钟），默认 10。' },
      includeGeneral: { type: 'boolean', description: 'close_idle 是否连同闲置的通用标签页一起关闭；默认只清发布类任务残留。' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, tabs: { type: 'string' }, error: { type: 'string' } } }, render: (_args, value) => text(value.ok ? (value.tabs ?? '') : '标签页操作失败：' + (value.error ?? '未知错误')) },
    async execute(args) {
      try {
        const tabs = await service.withExclusive(async () => {
          if (args.action === 'close_idle') {
            return await service.closeIdleTabs({
              minIdleMs: typeof args.minIdleMinutes === 'number' && args.minIdleMinutes > 0 ? args.minIdleMinutes * 60_000 : undefined,
              includeGeneral: args.includeGeneral === true,
            })
          }
          if (args.action === 'list') return await service.listTabsWithAdvice()
          return await service.tabs(args.action, args.index, args.url)
        })
        return { ok: true, tabs }
      } catch (error) {
        return { ok: false, error: safeError(error) }
      }
    },
  })
}

/** 上传图片到当前页已打开的文件选择器。 */
export function browserUploadTool(service: BrowserService) {
  return defineTool({
    name: 'browser_upload',
    description: '在引用所属标签页点击上传入口并上传本机图片；点击、上传和刷新快照在同一原子操作内完成。',
    parameters: { ref: { type: 'string', required: true, description: '快照中的上传入口作用域引用。' }, filePath: { type: 'string', required: true, description: '本机图片绝对路径。' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, snapshot: { type: 'string' }, error: { type: 'string' } } }, render: (_args, value) => text(value.ok ? (value.snapshot ?? '') : '上传失败：' + (value.error ?? '未知错误')) },
    async execute(args) {
      try {
        const snapshot = await service.withExclusive(async () => { await service.clickAndUpload(args.ref, args.filePath); return await service.snapshot(args.ref) })
        return { ok: true, snapshot }
      } catch (error) { return { ok: false, error: safeError(error) } }
    },
  })
}

export function browserCloseTool(service: BrowserService) { return actionTool('browser_close', '停止本地浏览器会话。用户档案保留，登录状态不丢失。', {}, async args => { await service.withExclusive(async () => { await service.stop() }) }) }
