/**
 * 构建后处理：把 rolldown 的 CJS client 包裹成 GUI 模块加载器交接格式
 * （window.__ModuleLoader__.load({id, factory})），并补上 rolldown 本代
 * 省略的 CJS 前导（var module/exports），产物 lib/client.js 由加载器
 * 在 /plugins/dsh-devforge/client.js 提供服务。
 */
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
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
