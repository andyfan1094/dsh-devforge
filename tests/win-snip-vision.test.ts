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

test('能力未声明时不再按名字把 deepseek 判成看不了图', async () => {
  // 回归：旧实现有 NO_VISION_HINTS=['deepseek']，模型清单没声明输入能力时会把
  // deepseek 名字的模型降到最后一级，于是输给同档里更慢的模型。
  // 2026-10-19 复测证明 DeepSeek V4.1 Flash 能准确读图，故黑名单已删：
  // 判定只认模型自己声明的 inputModalities，名字不再是能力证据。
  const { ctx, calls } = makeCtx({
    providers: [{ id: 'tiangong' }],
    models: { tiangong: [{ id: 'qwen-max' }, { id: 'DeepSeek V4.1 Flash' }] },
  })
  await new WinSnipVision(ctx as never).run({ kind: 'ocr', imageBytes: new Uint8Array([1]) })
  assert.equal(calls.stream[0]?.['model'], 'DeepSeek V4.1 Flash')
})

test('声明了 image 的模型优先于能力未声明的模型', async () => {
  const { ctx, calls } = makeCtx({
    providers: [{ id: 'tiangong' }],
    models: {
      tiangong: [
        { id: 'DeepSeek V4.1 Flash', inputModalities: ['text', 'image'] },
        { id: 'qwen-max' },
      ],
    },
  })
  await new WinSnipVision(ctx as never).run({ kind: 'ocr', imageBytes: new Uint8Array([1]) })
  assert.equal(calls.stream[0]?.['model'], 'DeepSeek V4.1 Flash')
})

test('能力未声明的模型排在明确声明不带 image 的之前', async () => {
  // 三态排序：声明能看图(0) > 未声明(1) > 声明不含 image(2)；避免"识别成功但一片空白"。
  const { ctx, calls } = makeCtx({
    providers: [{ id: 'p1' }],
    models: { p1: [{ id: 'text-only', inputModalities: ['text'] }, { id: 'mystery-model' }] },
  })
  await new WinSnipVision(ctx as never).run({ kind: 'ocr', imageBytes: new Uint8Array([1]) })
  assert.equal(calls.stream[0]?.['model'], 'mystery-model')
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
test('选区翻译：只发文字不发图片，原文原样回传、译文来自模型', async () => {
  const { ctx, calls } = makeCtx({
    selection: { provider: 'tiangong', model: 'm1' },
    chunks: [
      { type: 'text-delta', text: 'Hello world' },
      { type: 'finish', reason: { kind: 'stop' } },
    ],
  })
  const result = await new WinSnipVision(ctx as never).translateText({ text: '你好，世界', targetLang: 'en' })

  // 选区翻译不登记任何附件：这条路不该碰附件服务。
  assert.equal(calls.saved.length, 0)
  assert.equal(result.text, '你好，世界')
  assert.equal(result.translation, 'Hello world')
  assert.equal(result.model, 'm1')
  const content = ((calls.stream[0]?.['messages'] as Array<Record<string, unknown>>)[0]?.['content']) as Array<Record<string, unknown>>
  assert.equal(content.length, 2, '提示词与正文各占一条 text block')
  assert.equal(content[0]?.['type'], 'text')
  assert.equal(content[1]?.['type'], 'text')
  assert.equal(content[1]?.['text'], '你好，世界')
  assert.equal(String(content[0]?.['text']).includes('英文'), true, '提示词要带上目标语言')
})

test('选区翻译：空选区直接报错，不浪费一次模型调用', async () => {
  const { ctx, calls } = makeCtx({ selection: { provider: 'tiangong', model: 'm1' } })
  await assert.rejects(() => new WinSnipVision(ctx as never).translateText({ text: '   \n  ' }), /没有可翻译的文字/)
  assert.equal(calls.stream.length, 0)
})

test('选区翻译：模型返回空内容时报可读错误，而不是给一个空结果窗', async () => {
  const { ctx } = makeCtx({
    selection: { provider: 'tiangong', model: 'm1' },
    chunks: [{ type: 'finish', reason: { kind: 'stop' } }],
  })
  await assert.rejects(() => new WinSnipVision(ctx as never).translateText({ text: 'abc' }), /没有返回内容/)
})
