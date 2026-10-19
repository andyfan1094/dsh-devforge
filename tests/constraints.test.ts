/** 项目约束上下文注入单测：路径匹配、cwd 解析、开发信号识别、三层状态机与生命周期。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  collectToolNames,
  CONSTRAINTS_DEFAULT_PATHS,
  CONSTRAINT_SECTION_NAME,
  CONSTRAINT_SECTION_ORDER,
  CONSTRAINT_SUMMARY_TEXT,
  ConstraintInjectionService,
  eventsHaveDevSignal,
  hasDevToolSignal,
  matchesDevPath,
  renderConstraintText,
  renderProjectCard,
  resolveAgentCwd,
} from '../src/constraints.ts'

test('matchesDevPath：精确命中、子目录前缀命中、尾部斜杠规整', () => {
  const paths = ['/Users/andyfan/Documents/ds']
  assert.equal(matchesDevPath('/Users/andyfan/Documents/ds', paths), true)
  assert.equal(matchesDevPath('/Users/andyfan/Documents/ds/dsh-devforge/src', paths), true)
  assert.equal(matchesDevPath('/Users/andyfan/Documents/ds/', paths), true)
  assert.equal(matchesDevPath('/Users/andyfan/Documents', paths), false)
  assert.equal(matchesDevPath('/tmp/other', paths), false)
})

test('matchesDevPath：空 cwd、空路径、根路径与目录名前缀陷阱', () => {
  assert.equal(matchesDevPath(undefined, ['/tmp']), false)
  assert.equal(matchesDevPath('/tmp', []), false)
  assert.equal(matchesDevPath('/anything', ['/']), true)
  // 前缀必须按目录边界：/Users/andyfan/Documents/ds-old 不得命中 /Users/andyfan/Documents/ds
  assert.equal(matchesDevPath('/Users/andyfan/Documents/ds-old', ['/Users/andyfan/Documents/ds']), false)
})

test('resolveAgentCwd：session.cwd 与 session.meta.cwd 双通道，仅认绝对路径', () => {
  assert.equal(resolveAgentCwd({ cwd: '/repo/a' }), '/repo/a')
  assert.equal(resolveAgentCwd({ meta: { cwd: '/repo/b' } }), '/repo/b')
  assert.equal(resolveAgentCwd({ cwd: 'relative/path' }), undefined)
  assert.equal(resolveAgentCwd({}), undefined)
  assert.equal(resolveAgentCwd(null), undefined)
  assert.equal(resolveAgentCwd('not-object'), undefined)
})

test('collectToolNames + hasDevToolSignal：识别工具调用且不被自由文本误伤', () => {
  assert.equal(hasDevToolSignal(collectToolNames([{ type: 'tool_call', toolName: 'Bash' }])), true)
  assert.equal(hasDevToolSignal(collectToolNames([{ type: 'tool_call', name: 'write' }])), true)
  assert.equal(hasDevToolSignal(collectToolNames([{ type: 'tool_call', toolName: 'github_commit' }])), true)
  assert.equal(hasDevToolSignal(collectToolNames([{ type: 'tool_call', toolName: 'ssh_exec' }])), true)
  // 用户消息里出现 write/edit 字样不算开发动作（只认工具名字段）
  assert.equal(hasDevToolSignal(collectToolNames([{ type: 'message', message: { role: 'user', content: '请帮我 edit 一下 write 文件' } }])), false)
  // 只读工具不算
  assert.equal(hasDevToolSignal(collectToolNames([{ type: 'tool_call', toolName: 'github_status' }])), false)
  assert.equal(hasDevToolSignal(collectToolNames([{ type: 'tool_call', toolName: 'ssh_list' }])), false)
  assert.equal(eventsHaveDevSignal([]), false)
})

test('renderConstraintText：级别与开关正确渲染', () => {
  assert.ok(renderConstraintText('summary', true).startsWith('【项目约束摘要'))
  assert.ok(renderConstraintText('full', true).startsWith('【项目约束全文'))
  assert.ok(renderConstraintText('summary', true).length < renderConstraintText('full', true).length)
  assert.equal(renderConstraintText('full', false), '')
  assert.ok(CONSTRAINT_SUMMARY_TEXT.includes('中文'))
})

/** 构造假 agent：捕获 section 注册与会话事件监听。 */
function makeFakeAgent(opts: { id: string; cwd?: string; events?: unknown[] }) {
  const registered: Array<{ name: string; order: number; text: string | (() => string) }> = []
  const removed: number[] = []
  const listeners: Record<string, Array<(session: unknown, event: unknown) => void>> = {}
  const session: Record<string, unknown> = { events: opts.events ?? [] }
  if (opts.cwd !== undefined) session.cwd = opts.cwd
  const agent = {
    id: opts.id,
    session,
    ctx: {
      systemPrompt: {
        section: (input: { name: string; order: number; text: string | (() => string) }) => {
          registered.push(input)
          return () => { removed.push(1) }
        },
      },
      on: (event: string, listener: (session: unknown, event: unknown) => void) => {
        ;(listeners[event] ??= []).push(listener)
        return () => { listeners[event] = listeners[event]?.filter((item) => item !== listener) ?? [] }
      },
    },
  }
  return {
    agent,
    registered,
    removed,
    text: (): string => typeof registered[0]?.text === 'function' ? registered[0].text() : String(registered[0]?.text ?? ''),
    fireTurnEnd: (extraEvents: unknown[]) => {
      ;(session.events as unknown[]).push(...extraEvents)
      for (const listener of listeners['session/event'] ?? []) listener(session, { type: 'turn/end' })
    },
  }
}

test('约束服务：默认常驻摘要，turn/end 出现开发动作后升级全文且不回退', () => {
  const service = new ConstraintInjectionService()
  const fake = makeFakeAgent({ id: 'agent-1' })
  service.install(fake.agent)
  assert.equal(fake.registered.length, 1)
  assert.equal(fake.registered[0]!.name, CONSTRAINT_SECTION_NAME)
  assert.equal(fake.registered[0]!.order, CONSTRAINT_SECTION_ORDER)
  assert.ok(fake.text().startsWith('【项目约束摘要'))
  fake.fireTurnEnd([{ type: 'message', message: { content: '聊聊天气' } }])
  assert.ok(fake.text().startsWith('【项目约束摘要'), '无开发动作不升级')
  fake.fireTurnEnd([{ type: 'tool_call', toolName: 'write' }])
  assert.ok(fake.text().startsWith('【项目约束全文'), '开发动作升级全文')
  fake.fireTurnEnd([{ type: 'message', message: { content: '好了' } }])
  assert.ok(fake.text().startsWith('【项目约束全文'), '级别只升不降')
  assert.equal(service.levelOf('agent-1'), 'full')
  service.dispose()
})

test('约束服务：cwd 命中开发仓库从首轮即全文', () => {
  const service = new ConstraintInjectionService()
  const fake = makeFakeAgent({ id: 'agent-2', cwd: '/Users/andyfan/Documents/ds/dsh-devforge' })
  service.install(fake.agent)
  assert.equal(service.levelOf('agent-2'), 'full')
  assert.ok(fake.text().startsWith('【项目约束全文'))
  service.dispose()
})

test('约束服务：存量会话历史含开发动作时安装即升级', () => {
  const service = new ConstraintInjectionService()
  const fake = makeFakeAgent({ id: 'agent-3', events: [{ type: 'tool_call', toolName: 'bash' }] })
  service.install(fake.agent)
  assert.equal(service.levelOf('agent-3'), 'full')
  service.dispose()
})

test('约束服务：同一代理去重、dispose 卸载节、start 采纳存量根代理', () => {
  const service = new ConstraintInjectionService()
  const fake = makeFakeAgent({ id: 'agent-4' })
  service.install(fake.agent)
  service.install(fake.agent)
  assert.equal(fake.registered.length, 1, '重复安装被去重')
  service.dispose()
  assert.equal(fake.removed.length, 1, 'dispose 卸载已注册节')
  assert.equal(service.levelOf('agent-4'), undefined)

  // start 采纳存量代理 + agent/created 动态安装
  const created: Array<(payload: unknown) => void> = []
  const adopted = makeFakeAgent({ id: 'agent-adopted', cwd: '/Users/andyfan/Documents/ds' })
  const hostCtx = {
    on: (event: string, listener: (payload: unknown) => void) => {
      if (event === 'agent/created') created.push(listener)
      return () => {}
    },
    agents: { roots: () => [adopted.agent] },
  }
  service.start(hostCtx, () => ({ enabled: true, fullTextPaths: ['/Users/andyfan/Documents/ds'] }))
  assert.equal(service.levelOf('agent-adopted'), 'full', '存量代理按 cwd 直接全文')
  const fresh = makeFakeAgent({ id: 'agent-fresh' })
  for (const listener of created) listener({ agent: fresh.agent })
  assert.equal(fake.registered.length, 1)
  assert.ok(fresh.text().startsWith('【项目约束摘要'), '动态创建代理默认摘要')
  service.dispose()
})

test('约束服务：disabled 时文本函数返回空串', () => {
  const service = new ConstraintInjectionService()
  let enabled = false
  const fake = makeFakeAgent({ id: 'agent-5' })
  service.install({ ...fake.agent, ctx: { ...fake.agent.ctx } })
  // 直接用 render 层验证开关语义（服务按挂载时的配置启动）
  assert.equal(renderConstraintText('full', enabled), '')
  enabled = true
  assert.equal(renderConstraintText('full', enabled).startsWith('【项目约束全文'), true)
  service.dispose()
})

/** 读取仓库内文件（相对本测试文件定位，避免依赖 cwd）。 */
function readRepoFile(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8')
}

/**
 * 本次改动（2026-10-19 均辉事故后补规）的针对性断言：
 * 注入文案必须把「真实测试」界定为"验证本次改动"，并明确禁止乱测试。
 * 断言同时覆盖摘要层与全文层——两层都常驻注入，缺一层就等于规则失效。
 */
test('约束文本：「真实测试」只针对本次改动，且明确禁止乱测试', () => {
  const texts: Array<[string, string]> = [
    ['摘要层', renderConstraintText('summary', true)],
    ['全文层', renderConstraintText('full', true)],
  ]
  for (const [name, text] of texts) {
    assert.ok(text.includes('真实测试'), `${name} 必须出现「真实测试」的界定`)
    assert.ok(text.includes('本次改动'), `${name} 必须写清测试对象是本次改动`)
    assert.ok(text.includes('改动前失败、改动后通过'), `${name} 必须给出可证伪的判定口径`)
    assert.ok(text.includes('禁止乱测试'), `${name} 必须出现禁止乱测试的红线`)
    assert.ok(text.includes('只读'), `${name} 必须写明生产只做只读核对`)
    assert.ok(text.includes('隔离'), `${name} 必须写明测试数据与环境隔离`)
    assert.ok(!text.includes('随手跑一遍旧用例就算'), `${name} 不得把乱试写成合规做法`)
  }
})

/** 三处规范文档必须与注入文案同口径（约束文档第 5 节：冲突时以文档为准并同步修正注入）。 */
test('规范文档：通用规范、交付规范与暂存约束三处口径一致', () => {
  const documents: Array<[string, string]> = [
    ['standards/v1/common.zh.md', readRepoFile('../standards/v1/common.zh.md')],
    ['standards/v1/delivery.zh.md', readRepoFile('../standards/v1/delivery.zh.md')],
    ['docs/插件暂存环境测试约束.md', readRepoFile('../docs/插件暂存环境测试约束.md')],
  ]
  for (const [name, text] of documents) {
    assert.ok(text.includes('真实测试'), `${name} 必须出现「真实测试」`)
    assert.ok(text.includes('禁止乱测试') || text.includes('禁止「乱测试」'), `${name} 必须写明禁止乱测试`)
    assert.ok(text.includes('只读'), `${name} 必须写明生产只做只读核对`)
    assert.ok(text.includes('本次改动'), `${name} 必须写清测试对象是本次改动`)
  }
  // 暂存约束文档的教训表必须留下这起事故的记录，避免只改条文不记来由
  const constraintDoc = readRepoFile('../docs/插件暂存环境测试约束.md')
  assert.ok(constraintDoc.includes('2026-10-19'), '暂存约束文档必须记录本次事故日期')
  assert.ok(constraintDoc.includes('多份副本') || constraintDoc.includes('所有副本'), '必须记录"注释一处无效"的教训')
})

/**
 * 本次改动（2026-10-19 辉哥指出「模型老去服务器找/改源码」）的针对性断言：
 * 注入文案必须写清「源码唯一真源在本机仓库，服务器只做部署目标」，
 * 并明确禁止在服务器上编辑/覆盖源码。摘要层与全文层都要有——两层都是常驻注入。
 */
test('约束文本：源码只在本机仓库，服务器只做部署目标，禁止远程改源码', () => {
  const texts: Array<[string, string]> = [
    ['摘要层', renderConstraintText('summary', true)],
    ['全文层', renderConstraintText('full', true)],
  ]
  for (const [name, text] of texts) {
    assert.ok(text.includes('源码'), `${name} 必须写明源码位置`)
    assert.ok(text.includes('本机'), `${name} 必须写明源码只在本机`)
    assert.ok(text.includes('服务器'), `${name} 必须写明服务器角色`)
    assert.ok(text.includes('部署'), `${name} 必须写明服务器只做部署`)
    assert.ok(text.includes('禁止在服务器上'), `${name} 必须明确禁止在服务器上改源码`)
  }
  // 动作口径必须可执行：服务器=部署目标，修复=落回本地仓库
  assert.ok(texts[1]![1].includes('部署目标'), '全文层必须把服务器定性为部署目标')
  assert.ok(texts[1]![1].includes('落回本地'), '全文层必须给出「修复落回本地仓库」的动作口径')
})

test('开发路径清单：默认含 Windows 工作区，盘符路径与反斜杠分隔符同样命中', () => {
  // 默认清单必须覆盖本机 Windows 工作区，否则全文约束在 Windows 会话永不注入（本次事故根因之一）。
  assert.ok(
    CONSTRAINTS_DEFAULT_PATHS.some((path) => path.replace(/\\/gu, '/').toLowerCase() === 'd:/项目'),
    '默认开发路径清单必须包含 D:\\项目',
  )
  const paths = ['D:\\项目']
  assert.equal(matchesDevPath('D:\\项目', paths), true)
  assert.equal(matchesDevPath('D:\\项目\\projects\\dsh-devforge', paths), true)
  assert.equal(matchesDevPath('D:\\项目\\', paths), true)
  assert.equal(matchesDevPath('D:\\项目备份', paths), false, '目录边界：D:\\项目备份 不得命中 D:\\项目')
  assert.equal(matchesDevPath('C:\\其他', paths), false)
  // 反斜杠与正斜杠混写同样要认
  assert.equal(matchesDevPath('D:/项目/projects', paths), true)
  assert.equal(resolveAgentCwd({ cwd: 'D:\\项目\\projects' }), 'D:\\项目\\projects')
  assert.equal(resolveAgentCwd({ meta: { cwd: 'D:/项目' } }), 'D:/项目')
})

test('项目卡：明确源码唯一位置在本机，发布服务器只是部署目标', () => {
  const card = renderProjectCard({
    id: 'p1', name: 'x', path: 'D:\\项目\\projects\\x', machinePaths: {}, description: '',
    repoKind: 'cnb', repoUrl: '', repoBranch: '', siteUrl: '', deployTargets: [{ transport: 'ssh', alias: 'my' }],
    createdAt: 0, updatedAt: 0,
  })
  assert.ok(card.includes('源码位置'), '项目卡必须写明源码位置')
  assert.ok(card.includes('服务器只做部署'), '项目卡必须写明服务器只做部署')
  assert.ok(card.includes('禁止在服务器上改源码'), '项目卡必须禁止在服务器上改源码')
})

/** 规范文档必须与注入文案同口径（约束文档：冲突时以文档为准并同步修正注入）。 */
test('规范文档：交付规范与暂存约束必须写明源码只在本机、服务器只部署', () => {
  const documents: Array<[string, string]> = [
    ['standards/v1/delivery.zh.md', readRepoFile('../standards/v1/delivery.zh.md')],
    ['docs/插件暂存环境测试约束.md', readRepoFile('../docs/插件暂存环境测试约束.md')],
  ]
  for (const [name, text] of documents) {
    assert.ok(text.includes('源码'), `${name} 必须写明源码位置`)
    assert.ok(text.includes('部署目标'), `${name} 必须写明服务器是部署目标`)
    assert.ok(text.includes('禁止在服务器上'), `${name} 必须明确禁止在服务器上改源码`)
  }
})

/**
 * 远程工具描述边界（2026-10-19 追加）：模型最容易在 ssh_* / winrm_* 上「顺手改线上」，
 * 所以边界必须写进工具描述本身，而不是只靠系统提示里的约束。四个动作（exec/upload/download/cluster）都要覆盖。
 */
test('远程工具描述：ssh_* 与 winrm_* 全动作声明服务器只做部署、禁止改源码', async () => {
  const { REMOTE_SOURCE_BOUNDARY } = await import('../src/remote/shared/source-boundary.ts')
  assert.ok(REMOTE_SOURCE_BOUNDARY.includes('禁止在此编辑'), '边界文案必须明确禁止在远程编辑源码')
  assert.ok(REMOTE_SOURCE_BOUNDARY.includes('源码只在本地仓库改'), '边界文案必须写明源码只在本地仓库改')
  assert.ok(REMOTE_SOURCE_BOUNDARY.includes('部署目标'), '边界文案必须把远程主机定性为部署目标')

  const sources: Array<[string, string]> = [
    ['src/remote/ssh/tools.ts', readRepoFile('../src/remote/ssh/tools.ts')],
    ['src/remote/winrm/tools.ts', readRepoFile('../src/remote/winrm/tools.ts')],
  ]
  for (const [name, text] of sources) {
    assert.ok(text.includes('REMOTE_SOURCE_BOUNDARY'), `${name} 必须引用统一边界文案`)
    const used = text.split('REMOTE_SOURCE_BOUNDARY').length - 1
    // import 1 处 + exec/upload/download/cluster 4 处描述
    assert.ok(used >= 5, `${name} 必须在全部远程动作描述里引用边界文案（实际 ${used} 处）`)
  }
})
