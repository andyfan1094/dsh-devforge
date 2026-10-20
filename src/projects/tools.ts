/**
 * 项目工具 —— devforge_project：智能体在任何会话里识别、解析登记项目、沉淀项目事实，
 * 并把「线上地址 / 测试地址 / 发布服务器 / 仓库」等结构化资料主动回填（0.65.0）。
 *
 * 动作：list（清单）、resolve（按名称/路径关键词模糊解析单个项目）、
 * detail（按 id 取详情，含项目事实）、register（按本机路径登记/更新项目，自动检测 Git）、
 * note（向项目追加一条事实：数据库位置、发布方式、关键路径、踩过的坑等）、
 * update（回填结构化字段：线上/测试地址、发布服务器、发布命令、仓库与描述）、
 * probe（远程只读探测，自动绑定站点地址与发布服务器）。
 * 输出为紧凑文本；路径为「本机当前路径」（多端映射已在 store 层替换），
 * 模型拿到即可直接使用。register 让智能体交付项目后能顺手登记，
 * note/update 让智能体把会话中确认的资料沉淀下来——项目卡随会话自动注入，越用越懂。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  appendProjectFact,
  listProjects,
  projectMissingFields,
  registerProjectFromPath,
  updateProjectFields,
} from './store.ts'
import type { ProjectEntry, ProjectProbeResult } from './protocol.ts'

/** 工具输出值类型（与 schema 一一对应）。 */
interface ProjectToolOutput {
  ok: boolean
  message?: string
}

/** 探测执行器（index.ts 注入；与面板 probe 路由共用同一闭包）。 */
export type ProjectProbeRunner = (id: string) => Promise<ProjectProbeResult>

/** 待补字段的紧凑描述（core 标 ★，optional 标 ·）。 */
function renderMissing(entry: ProjectEntry): string {
  const missing = projectMissingFields(entry)
  if (missing.length === 0) return ''
  return missing.map((field) => (field.level === 'core' ? '★' : '') + field.label).join('/')
}

/** id 短码：面板与工具消息用前 8 位，模型不必复制 36 字符 UUID。 */
function shortId(id: string): string {
  return id.slice(0, 8)
}

/** 按 id（完整或前缀）定位项目。 */
function findByIdOrPrefix(entries: ProjectEntry[], key: string): ProjectEntry | undefined {
  const trimmed = key.trim()
  if (trimmed === '') return undefined
  return entries.find((entry) => entry.id === trimmed)
    ?? (trimmed.length >= 4 ? entries.find((entry) => entry.id.startsWith(trimmed)) : undefined)
}

/** 项目条目紧凑渲染（一行一项目，含 id 短码与待补字段）。 */
function renderProject(entry: ProjectEntry): string {
  const parts = [
    entry.name,
    'id:' + shortId(entry.id),
    '路径:' + (entry.path || '未登记'),
    '源码:本机(服务器只部署)',
    '仓库:' + (entry.repoUrl !== '' ? entry.repoKind + ' ' + entry.repoUrl : '未关联'),
  ]
  if (entry.repoBranch !== '') parts.push('分支:' + entry.repoBranch)
  if (entry.siteUrl !== '') parts.push('线上:' + entry.siteUrl)
  if ((entry.testUrl ?? '') !== '') parts.push('测试:' + entry.testUrl!)
  if (entry.deployTargets.length > 0) parts.push('发布:' + entry.deployTargets.map((t) => t.transport + ':' + t.alias).join(','))
  const missing = renderMissing(entry)
  if (missing !== '') parts.push('待补:' + missing)
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

/** 待补字段清单 + 具体动作建议（模型据此就知道下一步干什么，而不是只看到「未绑定」）。 */
function renderMissingAdvice(entry: ProjectEntry): string {
  const missing = projectMissingFields(entry)
  if (missing.length === 0) return '资料完整度：登记字段已齐全（线上/测试地址、发布服务器、仓库、描述）。'
  const lines = ['资料缺口（主动补齐，禁止编造）：']
  const core = missing.filter((field) => field.level === 'core')
  const optional = missing.filter((field) => field.level === 'optional')
  if (core.length > 0) {
    lines.push('  ★ 交付必需：' + core.map((field) => field.label).join('、')
      + ' —— 先 action=probe（id=' + shortId(entry.id) + '，只读探测）自动绑定；探测不到再向辉哥确认后用 action=update 回填。')
  }
  if (optional.length > 0) {
    lines.push('  · 有则更好：' + optional.map((field) => field.label).join('、')
      + ' —— 会话中一旦确认就用 action=update 写入（测试环境不存在则不必强补）。')
  }
  lines.push('  规则：地址/服务器等事实性资料必须来自探测证据或辉哥明确确认；update 后在后续会话自动随项目卡注入。')
  return lines.join('\n')
}

/** devforge_project 工具定义（无状态，直接读登记表；probe 动作经注入的执行器走远程探测）。 */
export function devforgeProjectTool(probe?: { run: ProjectProbeRunner }) {
  return defineTool({
    name: 'devforge_project',
    description: 'Registered projects of this machine: list all (with id short code and missing-field marks), fuzzy-resolve one, read details with accumulated project facts, register a local path (auto-detects Git), note a project fact, update structured fields (site URL / test URL / deploy servers / deploy command / repo / description), or probe remote servers to auto-bind URLs and deploy targets. ' +
      'Use update whenever a session confirms a project URL, test environment, deploy host or deploy command — do not leave those fields empty and do not only bury them in facts. ' +
      'Triggers: 我的项目, 项目列表, 项目解析, 项目登记, 项目笔记, 项目资料更新, 补录地址, 绑定发布服务器, 项目探测, 自动绑定, devforge_project, registered projects.',
    parameters: {
      action: { type: 'string', enum: ['list', 'resolve', 'detail', 'register', 'note', 'update', 'probe'], description: 'list=项目清单（含 id 短码与待补字段）；resolve=按关键词解析单个项目；detail=按 id 取详情；register=按本机路径登记/更新项目（自动检测 Git）；note=追加一条事实（数据库位置/发布方式/关键路径/坑）；update=回填结构化资料（线上地址/测试地址/发布服务器/发布命令/仓库/描述）；probe=远程只读探测并自动绑定地址与发布服务器。默认 list。' },
      keyword: { type: 'string', description: 'resolve：项目名称/路径/仓库地址关键词（如「天工」「dsh-devforge」）。update/note/probe 也可用 keyword 定位。' },
      id: { type: 'string', description: 'detail/note/update/probe：项目 id（完整 UUID 或前 8 位短码均可）。' },
      path: { type: 'string', description: 'register：项目本机绝对路径。' },
      name: { type: 'string', description: 'register/update：项目名（update 时用于改名，不能为空）。' },
      description: { type: 'string', description: 'register/update：项目描述（一句话说明这个项目是干什么的）。' },
      text: { type: 'string', description: 'note：要记录的项目事实（一句话，如「MySQL 在 my 服务器的 /var/lib/mysql，库名 modagentai」）。' },
      siteUrl: { type: 'string', description: 'update：线上地址（必须是 http(s):// 完整地址；传空字符串表示清空该字段）。' },
      testUrl: { type: 'string', description: 'update：测试/预发地址（必须是 http(s):// 完整地址；传空字符串表示清空）。' },
      deployTargets: { type: 'array', items: { type: 'string' }, description: 'update：发布服务器列表，元素形如 "ssh:my"、"winrm:13" 或 "ssh:my@/opt/modagentai-site"（transport:别名[@远程路径]）；传空数组表示清空。' },
      deployCommand: { type: 'string', description: 'update：发布命令（在项目目录内执行，如 pnpm run deploy）。' },
      repoUrl: { type: 'string', description: 'update：仓库地址（非空时自动识别 cnb/github/git）。' },
      repoBranch: { type: 'string', description: 'update：跟踪分支，如 main。' },
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
      // 统一定位：完整 id 或短码优先，其次 keyword 模糊匹配。
      const locate = (): ProjectEntry | undefined => {
        const byId = findByIdOrPrefix(entries, args.id ?? '')
        if (byId !== undefined) return byId
        if ((args.keyword ?? '').trim() !== '') return matchProject(entries, args.keyword ?? '')
        return undefined
      }
      if (action === 'list') {
        if (entries.length === 0) return { ok: true, message: '还没有登记项目。可在天工造梦操作台「项目」页签登记，或用 devforge_project 的 register 动作按路径登记，也可用 devforge_workspace 的 audit 梳理本机目录。' }
        const incomplete = entries.filter((entry) => projectMissingFields(entry).some((field) => field.level === 'core'))
        const blocks = [
          '共 ' + entries.length + ' 个登记项目：',
          ...entries.map(renderProject),
          incomplete.length > 0
            ? '资料缺口：' + String(incomplete.length) + ' 个项目缺交付必需字段（★ 标记）。补法：action=probe 只读探测自动绑定，或与辉哥确认后 action=update 回填；字段一旦补上，后续会话随项目卡自动注入。'
            : '全部项目登记字段已齐全。',
        ]
        return { ok: true, message: blocks.join('\n') }
      }
      if (action === 'resolve') {
        const hit = matchProject(entries, args.keyword ?? '')
        if (hit === undefined) return { ok: false, message: '未找到匹配「' + (args.keyword ?? '') + '」的项目。可用 action=list 查看全部登记，或用 register 动作按路径登记新项目。' }
        return { ok: true, message: [renderProject(hit) + '\nid:' + hit.id + ' 描述:' + (hit.description !== '' ? hit.description : '（未填写）'), renderMissingAdvice(hit), renderFacts(hit)].filter((block) => block !== '').join('\n') }
      }
      if (action === 'register') {
        return registerProjectFromPath({ path: args.path ?? '', name: args.name, description: args.description })
      }
      if (action === 'note') {
        const text = (args.text ?? '').trim()
        if (text === '') return { ok: false, message: 'text 不能为空：请写一句话事实，如「数据库在 my 服务器 /var/lib/mysql」' }
        const target = locate()
        if (target === undefined) {
          return { ok: false, message: '未定位到项目：请先 resolve 或 list 拿到 id，再用 action=note + id + text 记录。' }
        }
        return appendProjectFact(target.id, text, 'agent')
      }
      if (action === 'update') {
        const target = locate()
        if (target === undefined) return { ok: false, message: '未定位到项目：请先 resolve 或 list 拿到 id（短码即可），再 action=update。' }
        const hasField = [args.name, args.description, args.siteUrl, args.testUrl, args.deployTargets, args.deployCommand, args.repoUrl, args.repoBranch]
          .some((value) => value !== undefined)
        if (!hasField) {
          return { ok: false, message: 'update 至少传一个字段：siteUrl / testUrl / deployTargets / deployCommand / repoUrl / repoBranch / description / name。' }
        }
        const result = updateProjectFields(target.id, {
          ...(args.name !== undefined ? { name: args.name } : {}),
          ...(args.description !== undefined ? { description: args.description } : {}),
          ...(args.siteUrl !== undefined ? { siteUrl: args.siteUrl } : {}),
          ...(args.testUrl !== undefined ? { testUrl: args.testUrl } : {}),
          ...(args.deployTargets !== undefined ? { deployTargets: args.deployTargets } : {}),
          ...(args.deployCommand !== undefined ? { deployCommand: args.deployCommand } : {}),
          ...(args.repoUrl !== undefined ? { repoUrl: args.repoUrl } : {}),
          ...(args.repoBranch !== undefined ? { repoBranch: args.repoBranch } : {}),
        })
        if (!result.ok) return { ok: false, message: result.message }
        const updated = listProjects().find((entry) => entry.id === target.id)
        const missing = updated !== undefined ? renderMissing(updated) : ''
        const followUp = missing !== '' ? '\n仍需补齐：' + missing + '（probe 只读探测可自动绑定地址与发布服务器）' : '\n登记字段已齐全。'
        return { ok: true, message: result.message + followUp }
      }
      if (action === 'probe') {
        if (probe === undefined) return { ok: false, message: '探测能力未启用（远程运维 remote.enabled=false 或插件未注入执行器）。' }
        const target = locate()
        if (target === undefined) return { ok: false, message: '未定位到项目：请先 resolve 或 list 拿到 id，再 action=probe。' }
        const result = await probe.run(target.id)
        if (!result.ok) return { ok: false, message: '探测失败：' + (result.error ?? '未知原因') }
        const blocks = [
          '项目「' + target.name + '」探测完成：',
          ...result.hits.map((hit) => '- ' + hit.transport + ':' + hit.alias
            + (hit.domain !== undefined ? ' · 域名 ' + hit.domain : '')
            + (hit.siteUrl !== undefined ? ' · 地址 ' + hit.siteUrl : '')
            + (hit.testUrl !== undefined ? ' · [测试]' : '')
            + (hit.deployDir !== undefined ? ' · 目录 ' + hit.deployDir : '')
            + (hit.serviceName !== undefined ? ' · 服务 ' + hit.serviceName : '')),
          ...result.applied.map((item) => '✔ ' + item),
          ...result.skipped.map((item) => '⏭ ' + item),
        ]
        if (result.hits.length === 0) blocks.push('（未发现站点配置；可在服务器上确认 nginx/Caddy/IIS 是否有该项目的站点）')
        blocks.push('回填结果会自动写入项目登记，后续会话随项目卡注入；证据不足的字段请与辉哥确认后再 update。')
        return { ok: true, message: blocks.join('\n') }
      }
      // detail
      const hit = findByIdOrPrefix(entries, args.id ?? '')
      if (hit === undefined) return { ok: false, message: '项目不存在：' + (args.id ?? '') }
      return {
        ok: true,
        message: [
          '项目：' + hit.name + '（id:' + hit.id + '，短码 ' + shortId(hit.id) + '）',
          '描述：' + (hit.description !== '' ? hit.description : '（未填写）'),
          renderProject(hit),
          '源码位置：本机 ' + hit.path + '（唯一可编辑源；服务器只做部署目标，禁止在服务器上改源码或直接改线上文件）',
          '线上地址：' + (hit.siteUrl !== '' ? hit.siteUrl : '—'),
          '测试地址：' + ((hit.testUrl ?? '') !== '' ? hit.testUrl! : '—'),
          '发布服务器：' + (hit.deployTargets.length > 0 ? hit.deployTargets.map((t) => t.transport + ':' + t.alias + (t.remotePath !== undefined ? '（' + t.remotePath + '）' : '')).join('、') : '—'),
          '发布命令：' + ((hit.deployCommand ?? '') !== '' ? hit.deployCommand! : '—'),
          renderMissingAdvice(hit),
          renderFacts(hit),
        ].filter((block) => block !== '').join('\n'),
      }
    },
  })
}
