/** Camofox 跨会话原生 Agent 工具。视觉入口仅由面板路由提供，工具绝不返回 URL 或端口。 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { CamofoxService } from './service.ts'

function text(value: string): ContentBlock[] { return [{ type: 'text', text: value }] }
function safeError(error: unknown): string { return (error instanceof Error ? error.message : String(error)).replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]').slice(0, 300) }

/** 浏览器状态。 */
export function camofoxStatusTool(service: CamofoxService) {
  return defineTool({ name: 'camofox_status', description: '读取服务工厂托管的 Camofox 运营浏览器状态。它保留 my 服务器上 social-main 的登录档案；不会显示 Cookie、令牌、端口或可视化地址。', parameters: {}, output: { schema: { type: 'object', additionalProperties: false, properties: { configured: { type: 'boolean', required: true }, reachable: { type: 'boolean', required: true }, browserRunning: { type: 'boolean', required: true }, activeTabs: { type: 'integer', required: true }, activeSessions: { type: 'integer', required: true }, visualReady: { type: 'boolean', required: true }, message: { type: 'string' } } }, render: (_args, value) => text(JSON.stringify(value)) }, async execute() { return await service.status() } })
}

/** 打开一个运营标签页。 */
export function camofoxOpenTool(service: CamofoxService) {
  return defineTool({ name: 'camofox_open', description: '在服务工厂托管的 Camofox 浏览器中打开 URL。最多同时保留 3 个标签页，登录状态使用持久化的 social-main 档案。', parameters: { url: { type: 'string', required: true, description: '要打开的 http(s) 地址。' } }, output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, tabId: { type: 'string' }, url: { type: 'string' }, title: { type: 'string' }, error: { type: 'string' } } }, render: (_args, value) => text(value.ok ? '浏览器标签已打开' : '打开失败：' + (value.error ?? '未知错误')) }, async execute(args) { try { const tab = await service.open(args.url); return { ok: true, ...tab } } catch (error) { return { ok: false, error: safeError(error) } } } })
}

/** 读取当前运营标签页。 */
export function camofoxListTabsTool(service: CamofoxService) {
  return defineTool({ name: 'camofox_list_tabs', description: '列出 Camofox 运营会话中的标签页，不返回浏览器凭据或可视化入口。', parameters: {}, output: { schema: { type: 'object', additionalProperties: false, properties: { tabs: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { tabId: { type: 'string', required: true }, url: { type: 'string' }, title: { type: 'string' } } } }, error: { type: 'string' } } }, render: (_args, value) => text(value.error === undefined ? JSON.stringify(value.tabs) : '读取失败：' + value.error) }, async execute() { try { return { tabs: await service.listTabs() } } catch (error) { return { tabs: [], error: safeError(error) } } } })
}

/** 快照后点击。 */
export function camofoxSnapshotTool(service: CamofoxService) {
  return defineTool({ name: 'camofox_snapshot', description: '读取标签页无障碍文本快照和稳定元素引用。必须先快照再用引用点击或输入。', parameters: { tabId: { type: 'string', required: true, description: 'camofox_open 或 camofox_list_tabs 返回的标签 ID。' } }, output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, snapshot: { type: 'string' }, error: { type: 'string' } } }, render: (_args, value) => text(value.ok ? (value.snapshot ?? '') : '快照失败：' + (value.error ?? '未知错误')) }, async execute(args) { try { return { ok: true, snapshot: await service.snapshot(args.tabId) } } catch (error) { return { ok: false, error: safeError(error) } } } })
}

/** 安全元素操作的共同包装。 */
function actionTool(name: string, description: string, parameters: Record<string, any>, execute: (args: any) => Promise<void>) {
  return defineTool({ name, description, parameters, output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, error: { type: 'string' } } }, render: (_args, value) => text(value.ok ? '操作完成' : '操作失败：' + (value.error ?? '未知错误')) }, async execute(args) { try { await execute(args); return { ok: true } } catch (error) { return { ok: false, error: safeError(error) } } } })
}

export function camofoxNavigateTool(service: CamofoxService) { return actionTool('camofox_navigate', '跳转已有 Camofox 标签页到指定 URL。', { tabId: { type: 'string', required: true }, url: { type: 'string', required: true } }, args => service.navigate(args.tabId, args.url)) }
export function camofoxClickTool(service: CamofoxService) { return actionTool('camofox_click', '点击最近一次快照中的元素引用。', { tabId: { type: 'string', required: true }, ref: { type: 'string', required: true } }, args => service.click(args.tabId, args.ref)) }
export function camofoxTypeTool(service: CamofoxService) { return actionTool('camofox_type', '向最近一次快照中的输入元素填写文本。', { tabId: { type: 'string', required: true }, ref: { type: 'string', required: true }, text: { type: 'string', required: true }, submit: { type: 'boolean', description: '填写后是否按 Enter。' } }, args => service.type(args.tabId, args.ref, args.text, args.submit === true)) }
export function camofoxScrollTool(service: CamofoxService) { return actionTool('camofox_scroll', '滚动 Camofox 标签页以加载更多内容。', { tabId: { type: 'string', required: true }, direction: { type: 'string', enum: ['up', 'down'], description: '滚动方向，默认 down。' }, amount: { type: 'integer', description: '滚动像素，默认 700。' } }, args => service.scroll(args.tabId, args.direction === 'up' ? 'up' : 'down', Number.isInteger(args.amount) ? args.amount : 700)) }
export function camofoxCloseTool(service: CamofoxService) { return actionTool('camofox_close', '关闭一个 Camofox 标签页。关闭标签不会删除持久化登录档案。', { tabId: { type: 'string', required: true } }, args => service.close(args.tabId)) }
