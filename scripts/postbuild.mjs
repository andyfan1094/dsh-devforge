/**
 * 构建后处理：把 rolldown 的 CJS client 包裹成 GUI 模块加载器交接格式
 * （window.__ModuleLoader__.load({id, factory})），并补上 rolldown 本代
 * 省略的 CJS 前导（var module/exports），产物 lib/client.js 由加载器
 * 在 /plugins/dsh-devforge/client.js 提供服务。
 */
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const lib = fileURLToPath(new URL('../lib/', import.meta.url))
const id = 'dsh-devforge'

const cjs = readFileSync(join(lib, 'client.cjs'), 'utf8')
const map = join(lib, 'client.cjs.map')
const mapJs = join(lib, 'client.js.map')
try { renameSync(map, mapJs) } catch { /* 可选 */ }

const body = cjs.replace(/\/\/\# sourceMappingURL=client\.cjs\.map\s*$/, '')
const wrapped = [
  'window.__ModuleLoader__.load({',
  '\tid: ' + JSON.stringify(id) + ',',
  '\tfactory: (require) => {',
  '\t\tvar module = { exports: {} };',
  '\t\tvar exports = module.exports;',
  body,
  '\t\treturn module.exports;',
  '\t}',
  '});',
  '',
].join('\n')

writeFileSync(join(lib, 'client.js'), wrapped)
// 中间 CJS 只服务本次包装；删除而不是保留备份，避免进入发布包。
try { unlinkSync(join(lib, 'client.cjs')) } catch { /* 已不存在 */ }
try { unlinkSync(join(lib, 'client.cjs.bak')) } catch { /* 清理旧构建遗留 */ }
console.log('postbuild: wrapped lib/client.js (' + wrapped.length + 'B)')

/**
 * 复制截图小工具的 PowerShell 原生脚本到 lib/native。
 *
 * 为什么必须在构建期补 BOM：这些脚本含中文注释与中文字符串，
 * Windows PowerShell 5.1 读取无 BOM 的文件时按系统 ANSI（GBK）解码，
 * 中文会被拆成乱码字节从而引发语法错误（"表达式或语句中包含意外的标记"）。
 * 源码里带着 BOM，但经 git/编辑器处理有丢失风险，这里统一重写一遍兜底。
 */
const nativeSrc = fileURLToPath(new URL('../src/win-snip/native/', import.meta.url))
const nativeDst = join(lib, 'native')
mkdirSync(nativeDst, { recursive: true })
const BOM = '\uFEFF'
let copied = 0
for (const name of readdirSync(nativeSrc)) {
  // .cs 是剪贴板实现（C# 源码，由 PowerShell 运行时 Add-Type 编译），原样复制即可。
  if (name.toLowerCase().endsWith('.cs')) {
    writeFileSync(join(nativeDst, name), readFileSync(join(nativeSrc, name), 'utf8'), 'utf8')
    continue
  }
  if (!name.toLowerCase().endsWith('.ps1')) continue
  const text = readFileSync(join(nativeSrc, name), 'utf8').replace(new RegExp('^' + BOM), '')
  writeFileSync(join(nativeDst, name), BOM + text, 'utf8')
  copied += 1
}
console.log('postbuild: copied ' + copied + ' native script(s) to lib/native (UTF-8 BOM enforced)')
