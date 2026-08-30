/** 闲鱼商品发布 Agent 工具：预览与真实发布分离，真实发布必须显式确认。 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { XIANYU_PUBLISH_CONFIRMATION, type XianyuPublishService } from './xianyu-publish.ts'

function text(value: string): ContentBlock[] { return [{ type: 'text', text: value }] }
function safeError(error: unknown): string { return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 300) }

/** 在用户明确确认后发布一个闲鱼商品。 */
export function xianyuPublishTool(service: XianyuPublishService) {
  return defineTool({
    name: 'xianyu_publish',
    description: '使用同一个可见前台浏览器发布闲鱼商品。会上传图片、填写标题描述和价格，并核验商品详情页；真实发布前 confirmation 必须精确填写“确认发布”。',
    parameters: {
      imagePath: { type: 'string', required: true, description: '商品原图的本机绝对路径。' },
      title: { type: 'string', required: true, description: '商品标题，会作为描述首行提交。' },
      description: { type: 'string', required: true, description: '商品描述，最多 1400 字。' },
      price: { type: 'number', required: true, description: '商品售价，单位元。' },
      confirmation: { type: 'string', required: true, description: '真实发布确认短语，必须精确填写“确认发布”。' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, published: { type: 'boolean' }, itemUrl: { type: 'string' }, title: { type: 'string' }, price: { type: 'number' }, error: { type: 'string' } } }, render: (_args, value) => text(value.ok ? '闲鱼商品已发布：' + (value.itemUrl ?? '已核验') : '发布失败：' + (value.error ?? '未知错误')) },
    async execute(args) {
      try {
        const result = await service.publish({ imagePath: args.imagePath, title: args.title, description: args.description, price: args.price }, args.confirmation)
        return { ok: true, published: result.published, itemUrl: result.itemUrl, title: result.title, price: result.price }
      } catch (error) {
        return { ok: false, published: false, error: safeError(error) }
      }
    },
  })
}
