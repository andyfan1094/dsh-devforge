/**
 * 截图识别/翻译走 DSH 模型服务的行为测试。
 *
 * 这里不打真实模型：用桩替身断言"选哪个模型、发什么消息、怎么解析输出"，
 * 因为这三件事一旦错了，用户看到的就是结果窗里一句莫名其妙的失败。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeLayout, parseTranslateOutput, readModelTarget, WinSnipVision } from '../src/win-snip/vision.ts'

/** 构造一个只满足 WinSnipVision 需要的最小上下文。 */
function makeCtx(options: {
  selection?: unknown
  providers?: Array<{ id: string }>
  models?: Record<string, Array<{ id: string; inputModalities?: string[] }>>
  chunks?: unknown[]
}): { ctx: unknown; calls: { stream: Array<Record<string, unknown>>; saved: unknown[] } } {
  const calls = { stream: [] as Array<Record<string, unknown>>, saved: [] as unknown[] }
  const attachments = {
    saveImage: async (input: unknown) => {
      calls.saved.push(input)
      return { id: 'att-1', mediaType: 'image/png', bytes: 3, width: 1, height: 1 }
    },
  }
  const llm = {
    listProviders: () => options.providers ?? [{ id: 'tiangong' }],
    // 默认给一个模型：新实现要遍历模型清单按"快且能看图"排序，空清单会直接报"没有可用模型"。
    listModels: async (provider: string) => options.models?.[provider] ?? [{ id: 'm1' }],
    stream: (args: Record<string, unknown>) => {
      calls.stream.push(args)
      const chunks = options.chunks ?? [{ type: 'text-delta', text: '识别结果' }, { type: 'finish', reason: { kind: 'stop' } }]
      return (async function* generate() { for (const chunk of chunks) yield chunk })()
    },
  }
  const ctx = {
    get: (name: string) => {
      if (name === 'llm') return llm
      if (name === 'attachments') return attachments
      if (name === 'agentDefaultModel') return { currentSelection: () => options.selection }
      return undefined
    },
  }
  return { ctx, calls }
}

test('识别：把截图登记为附件后交给模型，并拼出文本', async () => {
  const { ctx, calls } = makeCtx({ selection: { provider: 'tiangong', model: 'm1' } })
  const vision = new WinSnipVision(ctx as never)
  const result = await vision.run({ kind: 'ocr', imageBytes: new Uint8Array([1, 2, 3]) })

  assert.equal(result.text, '识别结果')
  assert.equal(calls.saved.length, 1, '应登记一次附件')
  assert.equal(calls.stream.length, 1)
  const sent = calls.stream[0]
  assert.equal(sent['provider'], 'tiangong')
  assert.equal(sent['model'], 'm1')
  const messages = sent['messages'] as Array<Record<string, unknown>>
  assert.equal(messages[0]?.['role'], 'user')
  assert.equal(messages[0]?.['source'] !== undefined, true, '消息必须带 source')
  assert.equal(typeof messages[0]?.['id'], 'string', '消息必须带 id')
  const content = messages[0]?.['content'] as Array<Record<string, unknown>>
  assert.equal(content[0]?.['type'], 'text')
  assert.equal(content[1]?.['type'], 'image')
})

test('翻译：解析模型返回的 JSON，原文与译文都要拿到', async () => {
  const { ctx } = makeCtx({
    selection: { provider: 'tiangong', model: 'm1' },
    chunks: [
      { type: 'text-delta', text: '{"text":"Hello","translation":"你好"}' },
      { type: 'finish', reason: { kind: 'stop' } },
    ],
  })
  const result = await new WinSnipVision(ctx as never).run({ kind: 'translate', imageBytes: new Uint8Array([1]), targetLang: 'zh' })
  assert.equal(result.text, 'Hello')
  assert.equal(result.translation, '你好')
})

test('默认模型不能看图时，自动换成能看图的模型', async () => {
  const { ctx, calls } = makeCtx({
    selection: { provider: 'p1', model: 'text-only' },
    providers: [{ id: 'p1' }, { id: 'p2' }],
    models: {
      p1: [{ id: 'text-only', inputModalities: ['text'] }],
      p2: [{ id: 'vision-model', inputModalities: ['text', 'image'] }],
    },
  })
  await new WinSnipVision(ctx as never).run({ kind: 'ocr', imageBytes: new Uint8Array([1]) })
  assert.equal(calls.stream[0]?.['provider'], 'p2')
  assert.equal(calls.stream[0]?.['model'], 'vision-model')
})

test('没有默认模型时也能挑到能看图的模型', async () => {
  const { ctx, calls } = makeCtx({
    providers: [{ id: 'p1' }],
    models: { p1: [{ id: 'only-vision', inputModalities: ['image', 'text'] }] },
  })
  await new WinSnipVision(ctx as never).run({ kind: 'ocr', imageBytes: new Uint8Array([1]) })
  assert.equal(calls.stream[0]?.['model'], 'only-vision')
})

test('模型返回 error 结束原因时抛出可读错误', async () => {
  const { ctx } = makeCtx({
    selection: { provider: 'tiangong', model: 'm1' },
    chunks: [{ type: 'finish', reason: { kind: 'error', failure: { message: '额度不足' } } }],
  })
  await assert.rejects(
    () => new WinSnipVision(ctx as never).run({ kind: 'ocr', imageBytes: new Uint8Array([1]) }),
    /额度不足/,
  )
})

test('正常 stop 结束不能被误判为失败', async () => {
  const { ctx } = makeCtx({
    selection: { provider: 'tiangong', model: 'm1' },
    chunks: [{ type: 'text-delta', text: 'ok' }, { type: 'finish', reason: { kind: 'stop' } }],
  })
  const result = await new WinSnipVision(ctx as never).run({ kind: 'ocr', imageBytes: new Uint8Array([1]) })
  assert.equal(result.text, 'ok')
})

test('模型什么都没返回时给出明确错误', async () => {
  const { ctx } = makeCtx({ selection: { provider: 'tiangong', model: 'm1' }, chunks: [{ type: 'finish', reason: { kind: 'stop' } }] })
  await assert.rejects(
    () => new WinSnipVision(ctx as never).run({ kind: 'ocr', imageBytes: new Uint8Array([1]) }),
    /没有返回内容/,
  )
})

test('parseTranslateOutput 容忍代码块围栏与非 JSON 返回', () => {
  assert.deepEqual(parseTranslateOutput('```json\n{"text":"a","translation":"b"}\n```'), { text: 'a', translation: 'b' })
  assert.deepEqual(parseTranslateOutput('纯文本译文'), { text: '', translation: '纯文本译文' })
})

test('readModelTarget 只接受字符串形式的 provider/model', () => {
  assert.deepEqual(readModelTarget({ provider: 'a', model: 'b' }), { provider: 'a', model: 'b' })
  assert.equal(readModelTarget({ provider: '', model: 'b' }), undefined)
  assert.equal(readModelTarget(null), undefined)
})

test('排版归一化：全角空格、制表符、不换行空格统一成半角空格', () => {
  // 全角空格等于一个汉字宽，换算成两个半角空格才能在等宽字体里对齐。
  assert.equal(normalizeLayout('名称\u3000\u3000数量'), '名称    数量')
  assert.equal(normalizeLayout('a\tb'), 'a    b')
  assert.equal(normalizeLayout('a\u00a0b'), 'a b')
})

test('排版归一化：保留换行与缩进，只去掉行尾空格', () => {
  assert.equal(normalizeLayout('  缩进一行  \n第二行\n\n第三行'), '  缩进一行\n第二行\n\n第三行')
})

test('排版归一化：连续空行压成一个空行，不改列对齐', () => {
  assert.equal(normalizeLayout('a   b\n\n\n\nc   d'), 'a   b\n\nc   d')
})

test('识别结果按原排版返回：行数与列对齐都不被压平', async () => {
  const layout = '名称        数量\n苹果         12\nbanana       7'
  const { ctx } = makeCtx({
    selection: { provider: 'tiangong', model: 'm1' },
    chunks: [{ type: 'text-delta', text: layout }, { type: 'finish', reason: { kind: 'stop' } }],
  })
  const result = await new WinSnipVision(ctx as never).run({ kind: 'ocr', imageBytes: new Uint8Array([1]) })
  assert.equal(result.text, layout, '空格与换行必须原样保留')
})