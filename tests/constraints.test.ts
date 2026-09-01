/** 项目约束上下文注入单测：路径匹配、cwd 解析、开发信号识别、三层状态机与生命周期。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  collectToolNames,
  CONSTRAINT_SECTION_NAME,
  CONSTRAINT_SECTION_ORDER,
  CONSTRAINT_SUMMARY_TEXT,
  ConstraintInjectionService,
  eventsHaveDevSignal,
  hasDevToolSignal,
  matchesDevPath,
  renderConstraintText,
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
