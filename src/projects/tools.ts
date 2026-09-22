/**
 * 项目工具 —— devforge_project：智能体在任何会话里识别、解析登记项目并沉淀项目事实。
 *
 * 动作：list（清单）、resolve（按名称/路径关键词模糊解析单个项目）、
 * detail（按 id 取详情，含项目事实）、register（按本机路径登记/更新项目，自动检测 Git）、
 * note（向项目追加一条事实：数据库位置、发布方式、关键路径、踩过的坑等）。
 * 输出为紧凑文本；路径为「本机当前路径」（多端映射已在 store 层替换），
 * 模型拿到即可直接使用。register 让智能体交付项目后能顺手登记，
 * note 让智能体把会话中确认的项目事实沉淀下来——项目卡随会话自动注入，越用越懂。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { appendProjectFact, listProjects, registerProjectFromPath } from './store.ts'
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

/** 项目事实紧凑渲染（最近在前，最多 10 条）。 */
function renderFacts(entry: ProjectEntry): string {
  const facts = entry.facts ?? []
  if (facts.length === 0) return ''
  const recent = facts.slice(-10).reverse()
  return ['项目事实（最近在前）：', ...recent.map((fact) => '- ' + new Date(fact.at).toISOString().slice(0, 10) + '：' + fact.text)].join('\n')
}

/** devforge_project 工具定义（无状态，直接读登记表）。 */
export function devforgeProjectTool() {
  return defineTool({
    name: 'devforge_project',
    description: 'Resolve registered projects of this machine: list all, fuzzy-resolve one by name/path keyword, read details (with accumulated project facts), register a local project path (auto-detects Git), or note a project fact for future sessions. ' +
      'Triggers: 我的项目, 项目列表, 项目解析, 项目登记, 项目笔记, devforge_project, registered projects.',
    parameters: {
      action: { type: 'string', enum: ['list', 'resolve', 'detail', 'register', 'note'], description: 'list=项目清单；resolve=按关键词解析单个项目；detail=按 id 取详情；register=按本机路径登记/更新项目（自动检测 Git）；note=向项目追加一条事实（数据库位置/发布方式/关键路径/坑），后续会话自动注入。默认 list。' },
      keyword: { type: 'string', description: 'resolve：项目名称/路径/仓库地址关键词（如「天工」「dsh-devforge」）。' },
      id: { type: 'string', description: 'detail/note：项目 id。' },
      path: { type: 'string', description: 'register：项目本机绝对路径。' },
      name: { type: 'string', description: 'register：项目名，缺省用目录名。' },
      description: { type: 'string', description: 'register：项目描述（可选）。' },
      text: { type: 'string', description: 'note：要记录的项目事实（一句话，如「MySQL 在 my 服务器的 /var/lib/mysql，库名 modagentai」）。' },
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
        if (entries.length === 0) return { ok: true, message: '还没有登记项目。可在天工造梦操作台「项目」页签登记，或用 devforge_project 的 register 动作按路径登记，也可用 devforge_workspace 的 audit 梳理本机目录。' }
        return { ok: true, message: ['共 ' + entries.length + ' 个登记项目：', ...entries.map(renderProject)].join('\n') }
      }
      if (action === 'resolve') {
        const hit = matchProject(entries, args.keyword ?? '')
        if (hit === undefined) return { ok: false, message: '未找到匹配「' + (args.keyword ?? '') + '」的项目。可用 action=list 查看全部登记，或用 register 动作按路径登记新项目。' }
        return { ok: true, message: [renderProject(hit) + '\nid:' + hit.id + ' 描述:' + (hit.description !== '' ? hit.description : '（未填写）'), renderFacts(hit)].filter((block) => block !== '').join('\n') }
      }
      if (action === 'register') {
        return registerProjectFromPath({ path: args.path ?? '', name: args.name, description: args.description })
      }
      if (action === 'note') {
        const text = (args.text ?? '').trim()
        if (text === '') return { ok: false, message: 'text 不能为空：请写一句话事实，如「数据库在 my 服务器 /var/lib/mysql」' }
        let target = entries.find((entry) => entry.id === (args.id ?? ''))
        if (target === undefined && (args.keyword ?? '').trim() !== '') target = matchProject(entries, args.keyword ?? '')
        if (target === undefined) {
          return { ok: false, message: '未定位到项目：请先 resolve 或 list 拿到 id，再用 action=note + id + text 记录。' }
        }
        return appendProjectFact(target.id, text, 'agent')
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
          renderFacts(hit),
        ].filter((block) => block !== '').join('\n'),
      }
    },
  })
}
