/**
 * 项目索引器单测 —— 扩展名收录、固定排除目录与 .gitignore 语义、单文件上限。
 * 用临时目录构造最小项目树，不触碰任何真实仓库。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { collectFiles } from '../src/rag/project-indexer.ts'

test('collectFiles：收录代码与文档扩展名，排除固定目录与未知扩展', () => {
  const root = mkdtempSync(join(tmpdir(), 'devforge-idx-'))
  try {
    writeFileSync(join(root, 'README.md'), 'docs')
    writeFileSync(join(root, 'Program.cs'), 'class P {}')
    writeFileSync(join(root, 'schema.sql'), 'SELECT 1')
    writeFileSync(join(root, 'app.config'), '<xml/>')
    writeFileSync(join(root, 'logo.png'), 'binary-not-collected')
    mkdirSync(join(root, 'node_modules'))
    writeFileSync(join(root, 'node_modules', 'x.js'), 'ignored')
    mkdirSync(join(root, '.git'))
    writeFileSync(join(root, '.git', 'config'), 'ignored')
    const files = collectFiles(root)
    assert.ok(files.includes('README.md'))
    assert.ok(files.includes('Program.cs'), '.cs 应被收录（0.34.4 起纳入）')
    assert.ok(files.includes('schema.sql'), '.sql 应被收录（0.34.4 起纳入）')
    assert.ok(files.includes('app.config'), '.config 应被收录（0.34.4 起纳入）')
    assert.ok(!files.includes('logo.png'), '未知扩展名不入库')
    assert.ok(!files.some((f) => f.startsWith('node_modules/')), '固定排除目录')
    assert.ok(!files.some((f) => f.startsWith('.git/')), '.git 恒跳过')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('collectFiles：尊重 .gitignore 与相对路径分隔符统一为 /', () => {
  const root = mkdtempSync(join(tmpdir(), 'devforge-idx-git-'))
  try {
    writeFileSync(join(root, '.gitignore'), 'secrets/\n*.log\n')
    mkdirSync(join(root, 'secrets'))
    writeFileSync(join(root, 'secrets', 'key.md'), 'ignored by dir rule')
    writeFileSync(join(root, 'debug.log.md'), 'kept — 规则只匹配 *.log 本体')
    writeFileSync(join(root, 'run.log'), 'ignored by ext rule')
    mkdirSync(join(root, 'docs'))
    writeFileSync(join(root, 'docs', 'guide.md'), 'kept')
    const files = collectFiles(root)
    assert.ok(!files.some((f) => f.startsWith('secrets/')), '.gitignore 目录规则生效')
    assert.ok(!files.includes('run.log'), '.gitignore 扩展名规则生效')
    assert.ok(files.includes('debug.log.md'))
    assert.ok(files.includes('docs/guide.md'), '相对路径统一正斜杠')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('collectFiles：maxFiles 上限生效', () => {
  const root = mkdtempSync(join(tmpdir(), 'devforge-idx-cap-'))
  try {
    for (let i = 0; i < 8; i++) writeFileSync(join(root, `f${i}.md`), 'x')
    const files = collectFiles(root, { maxFiles: 3 })
    assert.equal(files.length, 3)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
