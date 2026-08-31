/** 小红书笔记发布 Agent 工具：真实发布必须显式确认。 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { XHS_PUBLISH_CONFIRMATION, type XiaohongshuPublishService } from './xhs-publish.ts'

function text(value: string): ContentBlock[] { return [{ type: 'text', text: value }] }
function safeError(error: unknown): string { return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 300) }

/** 把“人工智能, #AI工具”样式的话题串规整为干净标签数组。 */
export function parseTagList(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return []
  return [...new Set(raw.split(/[,，]/).map((value) => value.trim().replace(/^#/, '')).filter((value) => value !== ''))]
}

/** 在用户明确确认后发布一篇小红书图文笔记。 */
export function xiaohongshuPublishTool(service: XiaohongshuPublishService) {
  return defineTool({
    name: 'xiaohongshu_publish',
    description: '使用同一个可见前台浏览器在小红书创作服务平台发布图文笔记。会上传封面、填写标题正文并尽量插入话题标签，最后核验发布成功标志；真实发布前 confirmation 必须精确填写“确认发布”。笔记发布页需要已登录小红书账号。',
    parameters: {
      imagePath: { type: 'string', required: true, description: '笔记封面的本机绝对路径（png/jpg/jpeg/webp）。' },
      title: { type: 'string', required: true, description: '笔记标题，最多 20 个字符。' },
      content: { type: 'string', required: true, description: '笔记正文，最多 1000 个字符。' },
      tags: { type: 'string', required: true, description: '话题标签，逗号分隔（如：人工智能,AI工具）；没有话题时传空字符串。页面联想列表没有的话题会被跳过，不会中断发布。' },
      confirmation: { type: 'string', required: true, description: '真实发布确认短语，必须精确填写“确认发布”。' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, published: { type: 'boolean' }, noteUrl: { type: 'string' }, title: { type: 'string' }, tags: { type: 'array' }, error: { type: 'string' } } }, render: (_args, value) => text(value.ok ? '小红书笔记已发布：' + (value.noteUrl ?? '已核验发布成功') : '发布失败：' + (value.error ?? '未知错误')) },
    async execute(rawArgs) {
      const imagePath = String(rawArgs.imagePath ?? '')
      const title = String(rawArgs.title ?? '')
      const content = String(rawArgs.content ?? '')
      const confirmation = String(rawArgs.confirmation ?? '')
      const tags = parseTagList(typeof rawArgs.tags === 'string' ? rawArgs.tags : undefined)
      try {
        const result = await service.publish({ imagePath, title, content, tags }, confirmation)
        return { ok: true, published: result.published, noteUrl: result.noteUrl, title: result.title, tags: result.tags }
      } catch (error) {
        return { ok: false, published: false, title, tags: [], error: safeError(error) }
      }
    },
  })
}
