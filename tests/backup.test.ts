/**
 * CNB 备份模块测试：加密容器往返、错误密码拦截、快照一致性、备份配置与密码文件。
 * 使用独立临时目录（DSH_HOME 覆盖），不触碰生产 ~/.dsh。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { decryptBackupContainer, encryptBackupContainer, BackupCryptoError } from '../src/backup/crypto.ts'
import { buildBackupContainer, parseBackupContainer } from '../src/backup/snapshot.ts'

const SAVED_HOME = process.env.DSH_HOME

test('加密容器：6 位密码往返一致、错误密码 BAD_PASSWORD、KDF 参数写头', async () => {
  const plain = Buffer.from('中文内容 ' + 'ab'.repeat(2048), 'utf8')
  const container = await encryptBackupContainer(plain, 'a1b2c3')
  assert.equal(container.subarray(0, 4).toString('ascii'), 'DFB1')
  // 短密码 → N=2^20 写入容器头
  const N = container.readUInt32BE(5)
  assert.equal(N, 2 ** 20)
  const back = await decryptBackupContainer(container, 'a1b2c3')
  assert.ok(back.equals(plain))
  await assert.rejects(() => decryptBackupContainer(container, 'wrong0'), (error: unknown) => error instanceof BackupCryptoError && error.code === 'BAD_PASSWORD')
})

test('加密容器：长密码用常规 KDF，参数随容器头自适应', async () => {
  const plain = Buffer.from('data')
  const container = await encryptBackupContainer(plain, 'a-long-password-123')
  assert.equal(container.readUInt32BE(5), 2 ** 15)
  const back = await decryptBackupContainer(container, 'a-long-password-123')
  assert.ok(back.equals(plain))
})

test('备份容器组装：store.db 快照可打开且含数据、飞书配置在场、整体加解密往返', async () => {
  // 临时 DSH_HOME：造库数据 + 飞书文件，getDb 走 dshHome() 路径
  const home = mkdtempSync(join(tmpdir(), 'backup-e2e-'))
  process.env.DSH_HOME = home
  try {
    const { getDb } = await import('../src/store/db.ts')
    getDb() // 初始化库
    const db = getDb()
    db.prepare("INSERT INTO docs(domain, id, data, sort_order, created_at, updated_at) VALUES ('ssh.host', 'e2e-host', '{}', 0, 1, 1)").run()
    writeFileSync(join(home, 'dsh-feishu.json'), JSON.stringify({ appId: 'cli_x' }))

    const { plaintext, fileCount } = buildBackupContainer()
    assert.equal(fileCount, 2)
    const container = await encryptBackupContainer(plaintext, 'zz9x8y')
    const parsed = parseBackupContainer(await decryptBackupContainer(container, 'zz9x8y'))
    assert.ok(parsed.files['store.db'] !== undefined)
    assert.ok(parsed.files['dsh-feishu.json'] !== undefined)

    // 快照库一致性：独立打开快照，能看到 e2e-host
    const { DatabaseSync } = await import('node:sqlite')
    const dir = mkdtempSync(join(tmpdir(), 'snap-check-'))
    const snapPath = join(dir, 'snap.db')
    writeFileSync(snapPath, Buffer.from(parsed.files['store.db'], 'base64'))
    const snapDb = new DatabaseSync(snapPath, { readOnly: true })
    const row = snapDb.prepare("SELECT COUNT(*) c FROM docs WHERE domain='ssh.host'").get()
    assert.equal(Number(row['c']), 1)
    snapDb.close()
    rmSync(dir, { recursive: true, force: true })
  } finally {
    rmSync(home, { recursive: true, force: true })
    process.env.DSH_HOME = SAVED_HOME
  }
})
