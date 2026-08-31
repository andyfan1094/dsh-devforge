/**
 * 备份加密容器（devforge backup container v1）。
 *
 * 格式：magic(4) + version(1) + kdfParams(8: N4+r1+p1+reserved2) + salt(16) + iv(12) + authTag(16) + ciphertext
 * - 密码：用户输入的 6 位密码（任意字符集）。短密码是主要攻击面，因此：
 *   密码 ≤ 8 字符 → scrypt N=2^20（单次派生秒级，10^6 全空间离线爆破以月计）；
 *   更长密码 → scrypt N=2^15（流畅优先）。参数写入容器头，恢复端按参数解密，无版本耦合。
 * - AES-256-GCM（authTag 防篡改），salt/iv 每次加密全随机。
 * - 密码绝不落盘、不进日志；容器头无敏感信息可公开。
 */

import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem?: number },
) => Promise<Buffer>

/** 容器 magic（DFB = DevForge Backup）。 */
export const BACKUP_MAGIC = 'DFB1'
/** 容器版本。 */
export const BACKUP_VERSION = 1
const SALT_LENGTH = 16
const IV_LENGTH = 12
const TAG_LENGTH = 16
/** magic(4) + version(1) + N(4) + r(1) + p(1) + reserved(2) + salt(16) + iv(12) + tag(16)。 */
export const HEADER_LENGTH = 4 + 1 + 4 + 1 + 1 + 2 + SALT_LENGTH + IV_LENGTH + TAG_LENGTH

/** KDF 参数（写入容器头，恢复端按头解密）。 */
export interface KdfParams {
  N: number
  r: number
  p: number
}

/** 短密码强化参数：单次派生秒级，把 6 位密码的离线爆破成本拉到不可行。 */
export const KDF_STRONG: KdfParams = { N: 2 ** 20, r: 8, p: 1 }
/** 长密码常规参数：流畅优先。 */
export const KDF_NORMAL: KdfParams = { N: 2 ** 15, r: 8, p: 1 }

/** 按密码长度选 KDF 参数：≤8 字符视为短密码。 */
export function pickKdfParams(password: string): KdfParams {
  return password.length <= 8 ? KDF_STRONG : KDF_NORMAL
}

/** 派生密钥（maxmem 必须随 N 提高，否则 scrypt 直接报错）。 */
async function deriveKey(password: string, salt: Buffer, params: KdfParams): Promise<Buffer> {
  return await scrypt(password, salt, 32, {
    N: params.N,
    r: params.r,
    p: params.p,
    // Node 默认 maxmem=32MB，N=2^20、r=8 需要 128*N*r ≈ 1GB。
    maxmem: 2 * 1024 * 1024 * 1024,
  })
}

/** 加密明文 → 容器（头 + 密文）；随机 salt/iv。 */
export async function encryptBackupContainer(plaintext: Uint8Array, password: string): Promise<Buffer> {
  if (password === '') throw new Error('备份加密密码不能为空。')
  const params = pickKdfParams(password)
  const salt = randomBytes(SALT_LENGTH)
  const iv = randomBytes(IV_LENGTH)
  const key = await deriveKey(password, salt, params)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()

  const header = Buffer.alloc(HEADER_LENGTH)
  header.write(BACKUP_MAGIC, 0, 'ascii')
  header[4] = BACKUP_VERSION
  header.writeUInt32BE(params.N, 5)
  header[9] = params.r
  header[10] = params.p
  // header[11..12] 保留
  salt.copy(header, 13)
  iv.copy(header, 13 + SALT_LENGTH)
  return Buffer.concat([header, ciphertext, authTag])
}

/** 解密容器 → 明文；密码错误抛 BAD_PASSWORD，容器损坏抛 TAMPERED。 */
export async function decryptBackupContainer(container: Uint8Array, password: string): Promise<Buffer> {
  if (container.length < HEADER_LENGTH + 16) throw new BackupCryptoError('TAMPERED', '备份容器体积过小（截断或损坏）。')
  const buf = Buffer.from(container)
  if (buf.subarray(0, 4).toString('ascii') !== BACKUP_MAGIC) throw new BackupCryptoError('UNSUPPORTED_FORMAT', '不是 devforge 备份容器（magic 不符）。')
  if (buf[4] !== BACKUP_VERSION) throw new BackupCryptoError('UNSUPPORTED_FORMAT', '不支持的备份容器版本 ' + String(buf[4]) + '。')
  const params: KdfParams = {
    N: buf.readUInt32BE(5),
    r: buf[9] ?? 8,
    p: buf[10] ?? 1,
  }
  if (params.N < 2 ** 14 || params.N > 2 ** 21 || params.r < 1 || params.r > 32 || params.p < 1 || params.p > 32) {
    throw new BackupCryptoError('TAMPERED', '备份容器 KDF 参数非法。')
  }
  const salt = buf.subarray(13, 13 + SALT_LENGTH)
  const iv = buf.subarray(13 + SALT_LENGTH, 13 + SALT_LENGTH + IV_LENGTH)
  const ciphertext = buf.subarray(HEADER_LENGTH, buf.length - TAG_LENGTH)
  const authTag = buf.subarray(buf.length - TAG_LENGTH)

  const key = await deriveKey(password, salt, params)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    throw new BackupCryptoError('BAD_PASSWORD', '解密失败：备份密码不正确或备份文件已损坏。')
  }
}

/** 加密模块错误码。 */
export type BackupCryptoErrorCode = 'BAD_PASSWORD' | 'TAMPERED' | 'UNSUPPORTED_FORMAT'

/** 带错误码的加密异常（路由层按错误码给用户可读提示）。 */
export class BackupCryptoError extends Error {
  readonly code: BackupCryptoErrorCode
  constructor(code: BackupCryptoErrorCode, message: string) {
    super(message)
    this.name = 'BackupCryptoError'
    this.code = code
  }
}
