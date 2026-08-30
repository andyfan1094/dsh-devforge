/** 闲鱼消息 Agent 工具：读取默认安全，真实发送必须显式确认。 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { XianyuMessageService } from './xianyu.ts'

function text(value: string): ContentBlock[] { return [{ type: 'text', text: value }] }
function safeError(error: unknown): string { return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 300) }

/** 获取闲鱼会话列表及稳定元素引用。 */
export function xianyuMessagesListTool(service: XianyuMessageService) {
  return defineTool({
    name: 'xianyu_messages_list',
    description: '读取当前登录闲鱼账号的会话列表。使用服务工厂托管的可见浏览器，不会发送消息。',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, snapshot: { type: 'string' }, error: { type: 'string' } } }, render: (_args, value) => text(value.ok ? (value.snapshot ?? '') : '读取失败：' + (value.error ?? '未知错误')) },
    async execute() { try { return { ok: true, snapshot: await service.list() } } catch (error) { return { ok: false, error: safeError(error) } } },
  })
}

/** 读取指定联系人的完整可见对话。打开未读会话会触发闲鱼自身的已读状态。 */
export function xianyuConversationReadTool(service: XianyuMessageService) {
  return defineTool({
    name: 'xianyu_conversation_read',
    description: '按联系人显示名打开并读取闲鱼对话。打开未读会话会将其标为已读，但不会发送消息。',
    parameters: { contact: { type: 'string', required: true, description: '会话列表中显示的联系人名称，必须精确匹配。' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, snapshot: { type: 'string' }, error: { type: 'string' } } }, render: (_args, value) => text(value.ok ? (value.snapshot ?? '') : '读取失败：' + (value.error ?? '未知错误')) },
    async execute(args) { try { return { ok: true, snapshot: await service.read(args.contact) } } catch (error) { return { ok: false, error: safeError(error) } } },
  })
}

/** 经用户明确确认后发送一条闲鱼回复。 */
export function xianyuReplyTool(service: XianyuMessageService) {
  return defineTool({
    name: 'xianyu_reply',
    description: '向指定闲鱼联系人真实发送回复。只有用户已确认联系人和完整回复内容时才能调用，confirmation 必须精确填写“确认发送给「联系人」”，其中使用中文弯引号。',
    parameters: {
      contact: { type: 'string', required: true, description: '会话列表中显示的联系人名称，必须精确匹配。' },
      message: { type: 'string', required: true, description: '经用户确认的完整回复正文，最多 500 字。' },
      confirmation: { type: 'string', required: true, description: '绑定联系人的确认短语，例如：确认发送给“张三”。' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, sent: { type: 'boolean', required: true }, contact: { type: 'string' }, error: { type: 'string' } } }, render: (_args, value) => text(value.ok ? '已发送给 ' + (value.contact ?? '指定联系人') : '发送失败：' + (value.error ?? '未知错误')) },
    async execute(args) {
      try { const result = await service.reply(args.contact, args.message, args.confirmation); return { ok: true, sent: result.sent, contact: result.contact } }
      catch (error) { return { ok: false, sent: false, error: safeError(error) } }
    },
  })
}
