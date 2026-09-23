/**
 * 凭据双向同步测试：yaml ⇄ store.db credential 镜像。
 * 覆盖：共享解析、正向全量镜像（不限白名单）+ 同值跳过保 updated_at 稳定、
 * prune 语义、反向补缺（新机）与 overwrite 覆盖语义、restoreFromContainer 恢复
 * 后全量回写 yaml（临时 HOME 全链路）、snapshot 备份前刷新全量化、服务编排与日志红线。
 * 全部使用独立临时目录，不触碰生产 ~/.dsh。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CredentialSyncService,
  mirrorYamlToDb,
  readYamlCredentialValues,
  restoreMirrorsToYaml,
} from '../src/store/credential-sync.ts'
import { closeDb, getCredentialMirror, getDb, listCredentialMirrorRefs, putCredentialMirror } from '../src/store/db.ts'
import { refreshCredentialMirrors } from '../src/backup/snapshot.ts'
import { restoreFromContainer } from '../src/backup/backup.ts'

const SAVED_HOME = process.env.DSH_HOME

/** 写一个最小合法 yaml 主存（refs 段）。 */
function writeYaml(path: string, entries: Array<[string, string]>, prologue = 'version: 1\n'): void {
  const lines = prologue === '' ? [] : prologue.split('\n').filter(line => line !== '')
  if (entries.length > 0) {
    lines.push('refs:')
    for (const [ref, value] of entries) lines.push('  ' + ref + ': ' + value)
  }
  writeFileSync(path, lines.join('\n') + '\n', 'utf8')
}

test('readYamlCredentialValues：解析 refs 段全部条目，遇下一顶格 key 停止', () => {
  const home = mkdtempSync(join(tmpdir(), 'cred-sync-parse-'))
  try {
    const yamlPath = join(home, '.credentials.yaml')
    writeFileSync(yamlPath, [
      'version: 1',
      'refs:',
      '  AAA_KEY: value-aaa',
      '  BBB_KEY: value-bbb',
      'other:',
      '  notARef: skip',
      '',
    ].join('\n'), 'utf8')
    const values = readYamlCredentialValues(yamlPath)
    assert.equal(values.size, 2)
    assert.equal(values.get('AAA_KEY'), 'value-aaa')
    assert.equal(values.get('BBB_KEY'), 'value-bbb')
    assert.equal(values.has('notARef'), false) // 顶格 key 之后的条目不属于 refs 段

    // 无 refs 段 / 文件不存在 → 空 Map
    writeFileSync(yamlPath, 'version: 1\nother: x\n', 'utf8')
    assert.equal(readYamlCredentialValues(yamlPath).size, 0)
    assert.equal(readYamlCredentialValues(join(home, 'missing.yaml')).size, 0)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('mirrorYamlToDb：全量镜像（非白名单 ref 也入库）、同值跳过保 updated_at 稳定', () => {
  const home = mkdtempSync(join(tmpdir(), 'cred-sync-mirror-'))
  const dbPath = join(home, 'store.db')
  try {
    const yamlPath = join(home, '.credentials.yaml')
    writeYaml(yamlPath, [
      ['ZAI_CODING_CN_API_KEY', 'key-a'],
      ['MY_CUSTOM_TOKEN', 'custom-xyz'], // 不在 DEVFORGE_CREDENTIAL_REFS 白名单内
    ])
    const db = getDb(dbPath)

    const first = mirrorYamlToDb({ db, yamlPath })
    assert.deepEqual(first, { mirrored: ['ZAI_CODING_CN_API_KEY', 'MY_CUSTOM_TOKEN'], skipped: 0, pruned: [] })
    assert.equal(getCredentialMirror(db, 'MY_CUSTOM_TOKEN'), 'custom-xyz')

    // 同值再镜像：全部跳过、不写库 → updated_at 保持原值（备份内容 hash 不被扰动）
    const before = Number(db.prepare("SELECT updated_at FROM credential WHERE ref = 'MY_CUSTOM_TOKEN'").get()?.['updated_at'])
    const second = mirrorYamlToDb({ db, yamlPath })
    assert.deepEqual(second, { mirrored: [], skipped: 2, pruned: [] })
    const after = Number(db.prepare("SELECT updated_at FROM credential WHERE ref = 'MY_CUSTOM_TOKEN'").get()?.['updated_at'])
    assert.equal(after, before)
  } finally {
    closeDb(dbPath)
    rmSync(home, { recursive: true, force: true })
  }
})

test('mirrorYamlToDb：prune 默认 false 永不删除，显式开启才清理镜像中 yaml 已无的 ref', () => {
  const home = mkdtempSync(join(tmpdir(), 'cred-sync-prune-'))
  const dbPath = join(home, 'store.db')
  try {
    const yamlPath = join(home, '.credentials.yaml')
    writeYaml(yamlPath, [['ZAI_CODING_CN_API_KEY', 'key-a']])
    const db = getDb(dbPath)
    putCredentialMirror(db, 'OLD_REF', 'old-value') // 库有、yaml 无

    const kept = mirrorYamlToDb({ db, yamlPath })
    assert.deepEqual(kept.pruned, [])
    assert.equal(listCredentialMirrorRefs(db).includes('OLD_REF'), true) // 默认不删（删除只由官方 unset 联动）

    const prunedRun = mirrorYamlToDb({ db, yamlPath, prune: true })
    assert.deepEqual(prunedRun.pruned, ['OLD_REF'])
    assert.equal(listCredentialMirrorRefs(db).includes('OLD_REF'), false)
    assert.equal(getCredentialMirror(db, 'ZAI_CODING_CN_API_KEY'), 'key-a') // yaml 仍在的 ref 不受影响
  } finally {
    closeDb(dbPath)
    rmSync(home, { recursive: true, force: true })
  }
})

test('restoreMirrorsToYaml：新机补缺（yaml 无 refs 段）→ 库镜像值全部写入且幂等', async () => {
  const home = mkdtempSync(join(tmpdir(), 'cred-sync-restore-'))
  const dbPath = join(home, 'store.db')
  try {
    const yamlPath = join(home, '.credentials.yaml')
    writeFileSync(yamlPath, 'version: 1\n', 'utf8') // 新机：yaml 存在但没有 refs 段
    const db = getDb(dbPath)
    putCredentialMirror(db, 'ZAI_CODING_CN_API_KEY', 'key-from-db')
    putCredentialMirror(db, 'ARK_CODING_PLAN_API_KEY', 'ark-from-db')

    const result = await restoreMirrorsToYaml({ db, yamlPath })
    assert.deepEqual(result.restored, ['ARK_CODING_PLAN_API_KEY', 'ZAI_CODING_CN_API_KEY'])

    const raw = readFileSync(yamlPath, 'utf8')
    assert.match(raw, /refs:\n {2}ZAI_CODING_CN_API_KEY: key-from-db/)
    assert.match(raw, /ARK_CODING_PLAN_API_KEY: ark-from-db/)
    assert.match(raw, /^version: 1$/m) // yaml 原有内容保留（credentials-writer 原子 upsert）

    // 再跑一次：值已一致 → 全部跳过
    const again = await restoreMirrorsToYaml({ db, yamlPath })
    assert.deepEqual(again, { restored: [], skipped: 2 })
  } finally {
    closeDb(dbPath)
    rmSync(home, { recursive: true, force: true })
  }
})

test('restoreMirrorsToYaml：默认不覆盖本机已有值，overwrite=true 才覆盖', async () => {
  const home = mkdtempSync(join(tmpdir(), 'cred-sync-overwrite-'))
  const dbPath = join(home, 'store.db')
  try {
    const yamlPath = join(home, '.credentials.yaml')
    writeYaml(yamlPath, [['ZAI_CODING_CN_API_KEY', 'local-value']])
    const db = getDb(dbPath)
    putCredentialMirror(db, 'ZAI_CODING_CN_API_KEY', 'remote-value')

    // 启动对账语义（overwrite=false）：本机已配置值绝不覆盖
    const noOverwrite = await restoreMirrorsToYaml({ db, yamlPath })
    assert.deepEqual(noOverwrite, { restored: [], skipped: 1 })
    assert.match(readFileSync(yamlPath, 'utf8'), /ZAI_CODING_CN_API_KEY: local-value/)

    // 恢复场景语义（overwrite=true）：以库为准覆盖式回写
    const overwrite = await restoreMirrorsToYaml({ db, yamlPath, overwrite: true })
    assert.deepEqual(overwrite.restored, ['ZAI_CODING_CN_API_KEY'])
    assert.match(readFileSync(yamlPath, 'utf8'), /ZAI_CODING_CN_API_KEY: remote-value/)

    // 覆盖后值已一致：再次覆盖式回写也全部跳过（不产生无谓 .bak）
    const settled = await restoreMirrorsToYaml({ db, yamlPath, overwrite: true })
    assert.deepEqual(settled, { restored: [], skipped: 1 })
  } finally {
    closeDb(dbPath)
    rmSync(home, { recursive: true, force: true })
  }
})

test('restoreFromContainer：恢复后凭据镜像全量回写 yaml（临时 HOME 全链路）', async () => {
  const home = mkdtempSync(join(tmpdir(), 'cred-sync-restore-e2e-'))
  process.env.DSH_HOME = home
  try {
    // 本机现状：yaml 有旧值（模拟旧机器残留），库已初始化（进程内单例持有连接）
    const yamlPath = join(home, '.credentials.yaml')
    writeYaml(yamlPath, [['ZAI_CODING_CN_API_KEY', 'local-stale']])
    getDb()

    // 远端库（备份来源）：镜像含「本机 yaml 旧值 ref」+「本机没有的 ref」
    const remoteDbPath = join(home, 'remote-store.db')
    const remoteDb = getDb(remoteDbPath)
    putCredentialMirror(remoteDb, 'ZAI_CODING_CN_API_KEY', 'remote-fresh')
    putCredentialMirror(remoteDb, 'MY_CUSTOM_TOKEN', 'custom-remote')
    closeDb(remoteDbPath)

    const result = await restoreFromContainer({
      magic: 'DFB1-JSON',
      created_at: Date.now(),
      machine: 'peer-machine',
      files: { 'store.db': readFileSync(remoteDbPath).toString('base64') },
    })

    assert.ok(result.restoredFiles.includes('store.db'))
    assert.ok(result.restoredFiles.includes('credentials:ZAI_CODING_CN_API_KEY'))
    assert.ok(result.restoredFiles.includes('credentials:MY_CUSTOM_TOKEN'))
    const raw = readFileSync(yamlPath, 'utf8')
    assert.match(raw, /ZAI_CODING_CN_API_KEY: remote-fresh/) // 旧值被覆盖
    assert.match(raw, /MY_CUSTOM_TOKEN: custom-remote/)       // 缺失 ref 补进
    assert.doesNotMatch(raw, /local-stale/)
    assert.deepEqual(result.credentialSync?.restored, ['MY_CUSTOM_TOKEN', 'ZAI_CODING_CN_API_KEY'])
    assert.equal(result.restarted, false)
  } finally {
    // Windows 下必须先关闭 SQLite 单例连接，否则句柄会导致临时目录删除报 EBUSY。
    closeDb()
    rmSync(home, { recursive: true, force: true })
    process.env.DSH_HOME = SAVED_HOME
  }
})

test('refreshCredentialMirrors：备份前刷新已全量化（非白名单 ref 也进镜像）', () => {
  const home = mkdtempSync(join(tmpdir(), 'cred-sync-refresh-'))
  process.env.DSH_HOME = home
  try {
    const yamlPath = join(home, '.credentials.yaml')
    writeYaml(yamlPath, [
      ['ZAI_CODING_CN_API_KEY', 'key-a'],
      ['MY_CUSTOM_TOKEN', 'custom-xyz'],
    ])
    const db = getDb()
    refreshCredentialMirrors(db)
    assert.equal(getCredentialMirror(db, 'ZAI_CODING_CN_API_KEY'), 'key-a')
    assert.equal(getCredentialMirror(db, 'MY_CUSTOM_TOKEN'), 'custom-xyz') // 旧白名单实现会漏掉它
  } finally {
    closeDb()
    rmSync(home, { recursive: true, force: true })
    process.env.DSH_HOME = SAVED_HOME
  }
})

test('CredentialSyncService：启动对账双向、定时巡检跟随、恢复回写覆盖、日志不泄凭据值', async () => {
  const home = mkdtempSync(join(tmpdir(), 'cred-sync-service-'))
  const dbPath = join(home, 'store.db')
  try {
    const yamlPath = join(home, '.credentials.yaml')
    // 新机场景：yaml 只有本机自定义 ref，库里有恢复来的 ref
    writeYaml(yamlPath, [['MY_CUSTOM_TOKEN', 'custom-local']])
    const db = getDb(dbPath)
    putCredentialMirror(db, 'ZAI_CODING_CN_API_KEY', 'key-from-db')

    const logs: string[] = []
    const service = new CredentialSyncService({
      log: {
        info: (message: string, ...args: unknown[]) => { logs.push(message + ' ' + args.join(' ')) },
        warn: (message: string, ...args: unknown[]) => { logs.push(message + ' ' + args.join(' ')) },
      },
      yamlPath,
      dbPath,
    })

    // 启动对账：反向补缺进 yaml + 正向 yaml 全量回库
    const report = await service.reconcileOnStartup()
    assert.deepEqual(report.restore.restored, ['ZAI_CODING_CN_API_KEY'])
    assert.deepEqual(report.mirror.mirrored, ['MY_CUSTOM_TOKEN'])
    assert.match(readFileSync(yamlPath, 'utf8'), /ZAI_CODING_CN_API_KEY: key-from-db/)
    assert.equal(getCredentialMirror(db, 'MY_CUSTOM_TOKEN'), 'custom-local')

    // 日志红线：只出现 ref 名/方向/数量，绝不出现凭据值
    const joined = logs.join('\n')
    assert.equal(joined.includes('key-from-db'), false)
    assert.equal(joined.includes('custom-local'), false)

    // 定时巡检：yaml 新增 ref（原有 ref 保留，yaml 是权威不会被巡检删改）→ 定时触发后自动进镜像
    writeYaml(yamlPath, [
      ['MY_CUSTOM_TOKEN', 'custom-local'],
      ['LATER_REF', 'later-value'],
      ['ZAI_CODING_CN_API_KEY', 'key-from-db'],
    ])
    service.start(10)
    await new Promise((resolve) => setTimeout(resolve, 120))
    service.stop()
    assert.equal(getCredentialMirror(db, 'LATER_REF'), 'later-value')

    // 恢复回写：库更新后 restoreAfterBackup 覆盖 yaml 同名 ref
    putCredentialMirror(db, 'MY_CUSTOM_TOKEN', 'custom-new')
    const restoredAfter = await service.restoreAfterBackup()
    assert.deepEqual(restoredAfter.restored, ['MY_CUSTOM_TOKEN'])
    assert.match(readFileSync(yamlPath, 'utf8'), /MY_CUSTOM_TOKEN: custom-new/)

    service.dispose() // 幂等停止，不抛错
  } finally {
    closeDb(dbPath)
    rmSync(home, { recursive: true, force: true })
  }
})
