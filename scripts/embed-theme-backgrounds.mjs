/**
 * 主题背景内嵌生成器：把源码目录中的 JPEG 资源转成可被 Node 单测与
 * 浏览器 bundle 共同读取的 data URL 模块，运行时不依赖额外静态路由。
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 主题 id 与素材文件名的固定映射，保持生成结果稳定且可审查。 */
const ASSETS = [
  ['devforge-dawn-mist', 'devforge-dawn-mist.jpg'],
  ['devforge-sakura', 'devforge-sakura.jpg'],
  ['devforge-paper', 'devforge-paper.jpg'],
  ['devforge-forest', 'devforge-forest.jpg'],
  ['devforge-citrus', 'devforge-citrus.jpg'],
  ['devforge-midnight', 'devforge-midnight.jpg'],
  ['devforge-graphite', 'devforge-graphite.jpg'],
  ['devforge-violet-night', 'devforge-violet-night.jpg'],
  ['devforge-pine-night', 'devforge-pine-night.jpg'],
  ['devforge-jade-ink', 'devforge-jade-ink.jpg'],
  ['devforge-lavender', 'devforge-lavender.jpg'],
  ['devforge-wisteria', 'devforge-wisteria.jpg'],
  ['devforge-crystal-violet', 'devforge-crystal-violet.jpg'],
  ['devforge-china-red', 'devforge-china-red.jpg'],
]

const root = fileURLToPath(new URL('../', import.meta.url))
const assetDir = join(root, 'src/client/theme/assets')
const output = join(root, 'src/client/theme/backgrounds.ts')

/** 读取并编码单张主题背景，缺失资源直接失败，避免生成半套主题。 */
async function encodeAsset(fileName) {
  const bytes = await readFile(join(assetDir, fileName))
  return 'data:image/jpeg;base64,' + bytes.toString('base64')
}

const entries = []
for (const [id, fileName] of ASSETS) {
  const dataUrl = await encodeAsset(fileName)
  entries.push(`  ${JSON.stringify(id)}: ${JSON.stringify(dataUrl)},`)
}

const source = [
  '/**',
  ' * 由 scripts/embed-theme-backgrounds.mjs 生成。',
  ' *',
  ' * 背景是主题的一部分而不是用户手动壁纸：客户端 bundle 自带 data URL，',
  ' * 既保留离线可用性，也避免从 GUI 的插件路由读取任意文件。',
  ' */',
  '',
  'export const THEME_BACKGROUNDS = {',
  ...entries,
  '} as const',
  '',
].join('\n')

await writeFile(output, source, 'utf8')
console.log('embedded theme backgrounds: ' + ASSETS.length + ' assets -> ' + output)
