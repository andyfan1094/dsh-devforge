/**
 * 项目工具 —— devforge_project：智能体在任何会话里识别与解析登记项目。
 *
 * 三个动作：list（清单）、resolve（按名称/路径关键词模糊解析单个项目）、
 * detail（按 id 取详情）。输出为紧凑文本；路径为「本机当前路径」（多端
 * 映射已在 store 层替换），模型拿到即可直接使用。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { listProjects } from './store.ts'
import type { ProjectEntry } from './protocol.ts'

/** 工具输出值类型（与 schema 一一对应）。 */
interface ProjectToolOutput {
  ok: boolean
  message?: string
}

/** 项目条目紧凑渲染（一行一项目）。 */
function renderProject(entry: ProjectEntry): string {
  const parts = [
    entry.name,
    '路径:' + (entry.path || '未登记'),
    '仓库:' + (entry.repoUrl !== '' ? entry.repoKind + ' ' + entry.repoUrl : '未关联'),
  ]
  if (entry.repoBranch !== '') parts.push('分支:' + entry.repoBranch)
  if (entry.deployTargets.length > 0) parts.push('发布:' + entry.deployTargets.map((t) => t.transport + ':' + t.alias).join(','))
  if (entry.pathExists === false) parts.push('⚠️本机路径失效')
  return parts.join(' | ')
}

/** 按关键词模糊解析：名称精确 → 名称包含 → 路径包含 → 仓库地址包含。 */
export function matchProject(entries: ProjectEntry[], keyword: string): ProjectEntry | undefined {
  const key = keyword.trim().toLowerCase()
  if (key === '') return undefined
  return entries.find((entry) => entry.name.toLowerCase() === key)
    ?? entries.find((entry) => entry.name.toLowerCase().includes(key))
    ?? entries.find((entry) => entry.path.toLowerCase().includes(key))
    ?? entries.find((entry) => entry.repoUrl.toLowerCase().includes(key))
}

/** devforge_project 工具定义（无状态，直接读登记表）。 */
export function devforgeProjectTool() {
  return defineTool({
    name: 'devforge_project',
    description: 'Resolve registered projects of this machine: list all, fuzzy-resolve one by name/path keyword, or read details. ' +
      'Triggers: 我的项目, 项目列表, 项目解析, devforge_project, registered projects.',
    parameters: {
      action: { type: 'string', enum: ['list', 'resolve', 'detail'], description: 'list=项目清单；resolve=按关键词解析单个项目；detail=按 id 取详情。默认 list。' },
      keyword: { type: 'string', description: 'resolve：项目名称/路径/仓库地址关键词（如「天工」「dsh-devforge」）。' },
      id: { type: 'string', description: 'detail：项目 id。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string' },
        },
      },
      render: (_args, value: ProjectToolOutput) => [{ type: 'text', text: value.message ?? '' }],
    },
    async execute(args): Promise<ProjectToolOutput> {
      const entries = listProjects()
      const action = args.action ?? 'list'
      if (action === 'list') {
        if (entries.length === 0) return { ok: true, message: '还没有登记项目。可在天工造梦操作台「项目」页签登记，或用 devforge_workspace 的 audit 梳理本机目录。' }
        return { ok: true, message: ['共 ' + entries.length + ' 个登记项目：', ...entries.map(renderProject)].join('\n') }
      }
      if (action === 'resolve') {
        const hit = matchProject(entries, args.keyword ?? '')
        if (hit === undefined) return { ok: false, message: '未找到匹配「' + (args.keyword ?? '') + '」的项目。可用 action=list 查看全部登记。' }
        return { ok: true, message: renderProject(hit) + '\nid:' + hit.id + ' 描述:' + (hit.description !== '' ? hit.description : '（未填写）') }
      }
      // detail
      const hit = entries.find((entry) => entry.id === (args.id ?? ''))
      if (hit === undefined) return { ok: false, message: '项目不存在：' + (args.id ?? '') }
      return {
        ok: true,
        message: [
          '项目：' + hit.name + '（id:' + hit.id + '）',
          '描述：' + (hit.description !== '' ? hit.description : '（未填写）'),
          renderProject(hit),
          '线上地址：' + (hit.siteUrl !== '' ? hit.siteUrl : '—'),
        ].join('\n'),
      }
    },
  })
}
