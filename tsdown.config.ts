/**
 * dsh-devforge 构建配置 —— 镜像 dsh-winrm 实证配置（dsh-web-ui 家族预设的
 * 独立版）：
 *   - 宿主半边 lib/index.js（ESM，SDK external）；
 *   - 浏览器半边 lib/client.js：闭包工厂产物（window.__ModuleLoader__ 交接），
 *     CSS Modules 由 lightningcss 编译成哈希类映射 + 自动注入 <style data-plugin>。
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, relative, resolve as resolvePath, sep } from 'node:path'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

/** 插件 id（烙进 loader 交接与样式标签）。 */
const PKG_ID = 'dsh-devforge'

/** 壳共享进冻结模块表的浏览器平台模块。 */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives',
] as const

/** 运行时豁免（快照存储引擎，预设文档记录）。 */
const RUNTIME_STORE_EXEMPTION = '@deepseek-ai/dsh-client-runtime/client'

/** loader 模块表应答的 externals。 */
const CLIENT_EXTERNALS: readonly string[] = [...PLATFORM_MODULES, RUNTIME_STORE_EXEMPTION]

/** 宿主半边运行时从 profile 依赖树解析的 SDK 包。 */
const HOST_EXTERNALS = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-host-webserver',
  '@deepseek-ai/dsh-credentials',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-tools',
  'schemastery',
  // 远程运维引擎的原生/网络依赖：原生模块必须运行时解析，不能打进 bundle。
  'ssh2',
  'ws',
]

/** 虚拟 id 包装：把 module CSS 挡在 tsdown 自带 css 管线之外。 */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** 把一个 *.module.css 编译成 JS 模块：哈希类映射 + 注入 style。 */
const cssModulePlugin = {
  name: 'dsh-devforge-css-modules',
  resolveId(source: string, importer?: string): string | null {
    if (!source.endsWith('.module.css')) return null
    const physical = resolvePath(dirname(importer ?? process.cwd()), source)
    return CSS_VIRTUAL_PREFIX + physical + CSS_VIRTUAL_SUFFIX
  },
  async load(id: string): Promise<string | null> {
    if (!id.startsWith(CSS_VIRTUAL_PREFIX)) return null
    const physical = id.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
    const code = await readFile(physical, 'utf8')
    const result = transform({
      filename: physical,
      code: Buffer.from(code),
      minify: true,
      cssModules: true,
    })
    const cssText = result.code.toString()
    const map: Record<string, string> = {}
    for (const [key, value] of Object.entries(result.exports ?? {})) {
      map[key] = String((value as { name?: unknown }).name ?? '')
    }
    const tagId = PKG_ID + '/' + relative(process.cwd(), physical).split(sep).join('/')
    return [
      'const css = ' + JSON.stringify(cssText) + ';',
      'const tagId = ' + JSON.stringify(tagId) + ';',
      'if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {',
      '  const tag = document.createElement("style");',
      '  tag.dataset.plugin = ' + JSON.stringify(PKG_ID) + ';',
      '  tag.dataset.pluginCss = tagId;',
      '  tag.textContent = css;',
      '  document.head.appendChild(tag);',
      '}',
      'export default ' + JSON.stringify(map) + ';',
      '',
    ].join('\n')
  },
}

/** 宿主半边：引擎 + 路由 + 工具（ESM，SDK external）。 */
const lib: UserConfig = {
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  external: HOST_EXTERNALS,
  // 方舟 AFP 管控面使用官方 SDK；插件可脱离 profile 依赖树安装，因此必须随宿主产物打包。
  noExternal: ['@volcengine/openapi'],
}

/** 浏览器半边：GUI 模块加载器消费的闭包工厂产物。 */
const client: UserConfig = {
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: false,
  clean: false,
  external: [...CLIENT_EXTERNALS],
  noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: [cssModulePlugin],
  outputOptions: { entryFileNames: 'client.cjs' },
}

export default existsSync('src/client/index.ts') ? [lib, client] : [lib]
