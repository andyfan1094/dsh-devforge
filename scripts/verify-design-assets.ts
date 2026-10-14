/**
 * 设计资产完整性校验。
 *
 * 用途：资产库靠 frontmatter 与固定目录约定吃饭，一条写错就会导致
 * 检索命中不到、或 Agent 读到空壳。本脚本按层校验这些约定，
 * 交付前跑一次，避免「文件在、但没人能查到」。
 *
 * 校验项：
 *   1. 六层目录存在，资产能被 DesignStore 正常索引（无入口文档的目录会被静默跳过，这里要报出来）
 *   2. frontmatter 齐备：name、description 非空
 *   3. triggers 至少 3 条，且必须含中文触发词（中文资产的第一入口）
 *   4. od.category 与所在层一致
 *   5. templates 正文必须含 html 代码块；prompts 正文必须含可复制的代码块
 *   6. description 长度在 20 到 200 字之间（太短说不清、太长会被目录截断）
 *
 * 运行：node --experimental-strip-types scripts/verify-design-assets.ts
 * 退出码：存在问题时为 1。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DESIGN_KINDS, DesignStore, parseFrontmatter } from '../src/design.ts'

const root = fileURLToPath(new URL('../design/', import.meta.url))
const store = new DesignStore(root)

/** 硬性错误：会让资产查不到或读到空壳，交付前必须清零。 */
const errors: string[] = []

/** 提醒项：原文集成层的既存状况，不阻塞交付但应逐步收敛。 */
const warnings: string[] = []

/** 中文触发词判定：出现任意中日韩统一表意文字即可。 */
const CJK = /[\u4e00-\u9fff]/

/**
 * 取资产正文。
 *
 * 单文件资产 id 不含扩展名，先补 .md；目录型按约定顺序探测入口文件。
 * 关键点：取「第一个带 frontmatter 的候选」，而不是第一个存在的候选——
 * skills 目录里 README.md 往往没有 frontmatter，按存在性取会误报「缺 name」。
 */
function readAssetBody(rel: string): string | undefined {
  const full = join(root, rel)
  try {
    return readFileSync(full + '.md', 'utf8')
  } catch {
    /* 不是单文件资产，落到目录型分支 */
  }
  let fallback: string | undefined
  for (const candidate of ['SKILL.md', 'SKILL.src.md', 'DESIGN.md', 'README.md', 'index.html', 'template.html']) {
    let text: string
    try {
      text = readFileSync(join(full, candidate), 'utf8')
    } catch {
      continue
    }
    if (fallback === undefined) fallback = text
    if (text.startsWith('---')) return text
  }
  return fallback
}

/** 逐层收集磁盘上的资产 id，与 DesignStore 的索引做差集。 */
function diskAssetIds(): string[] {
  const ids: string[] = []
  for (const kind of DESIGN_KINDS) {
    let entries
    try {
      entries = readdirSync(join(root, kind), { withFileTypes: true })
    } catch {
      errors.push('缺少资产层目录：design/' + kind)
      continue
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      if (entry.isFile() && entry.name.endsWith('.md')) ids.push(kind + '/' + entry.name.slice(0, -3))
      else if (entry.isDirectory()) ids.push(kind + '/' + entry.name)
    }
  }
  return ids
}

const indexed = new Set(store.list().map((asset) => asset.id))
const onDisk = diskAssetIds()

for (const id of onDisk) {
  if (!indexed.has(id)) errors.push('未被索引（缺入口文档或文件名不符约定）：' + id)
}

for (const asset of store.list()) {
  const body = readAssetBody(asset.id) ?? ''
  const fm = parseFrontmatter(body)
  const label = asset.id
  /** 自研层（craft/templates/prompts）按完整约定要求；原文集成层（skills/systems/standards）只报提醒。 */
  const isOwn = asset.kind === 'craft' || asset.kind === 'templates' || asset.kind === 'prompts'
  const note = (message: string): void => { (isOwn ? errors : warnings).push(message) }

  if ((fm.name ?? '').trim() === '') errors.push(label + '：frontmatter 缺 name')
  const description = (fm.description ?? '').trim()
  if (description === '') errors.push(label + '：frontmatter 缺 description')
  else if (description.length < 20) note(label + '：description 过短（' + description.length + ' 字），检索与目录都靠它')
  else if (description.length > 200) note(label + '：description 过长（' + description.length + ' 字），目录展示会被截断')

  if (asset.triggers.length === 0) errors.push(label + '：frontmatter 缺 triggers，任何中文查询都命中不到')
  else if (asset.triggers.length < 3) note(label + '：triggers 少于 3 条（当前 ' + asset.triggers.length + '），检索命中率偏低')
  if (asset.triggers.length > 0 && !asset.triggers.some((trigger) => CJK.test(trigger))) {
    note(label + '：triggers 没有中文触发词，中文提问命中不到')
  }

  const expected = asset.kind === 'templates' ? 'template' : asset.kind === 'prompts' ? 'prompt' : asset.kind === 'systems' ? 'system' : undefined
  if (expected !== undefined && asset.category !== '' && asset.category !== expected) {
    warnings.push(label + '：od.category 应为 ' + expected + '，实际为 ' + asset.category)
  }

  if (asset.kind === 'templates' && !/```html/.test(body)) errors.push(label + '：模板正文缺少 ```html 代码块')
  if (asset.kind === 'prompts' && !/```/.test(body)) errors.push(label + '：提示词正文缺少可直接复制的代码块')
}

console.log('资产总数：' + store.count() + '（磁盘 ' + onDisk.length + '）')
for (const kind of DESIGN_KINDS) console.log('  ' + kind.padEnd(10) + store.list(kind as never).length + ' 项')
console.log('错误数：' + errors.length + '；提醒数：' + warnings.length)
for (const error of errors) console.log('  ✗ ' + error)
for (const warning of warnings) console.log('  ! ' + warning)
if (errors.length > 0) process.exitCode = 1
