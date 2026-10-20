// 企微桥配置存取。
//
// 为什么单独成文件：
// 1. 配置里有 Secret，绝不能出现在日志、面板返回或提交内容里；集中在这里便于审计。
// 2. 与飞书桥同构：配置落 ~/.dsh/dsh-wecom.json，随 HOME 隔离，
//    暂存实例（隔离 HOME）天然使用自己的配置，不会污染生产。
// 3. 写入使用「临时文件 + rename」的原子替换，避免写一半断电导致配置损坏。

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** 默认配置文件位置（跟随 HOME，便于隔离测试）。 */
export function defaultConfigPath() {
  return join(homedir(), '.dsh', 'dsh-wecom.json')
}

/** 配置默认值；enabled 默认 false——未配置凭据时不应该悄悄去连服务端。 */
export const DEFAULTS = {
  enabled: false,
  botId: '',
  secret: '',
  cwd: '',
  agentPreset: 'cordis',
  botName: '',
  welcomeText: '',
  allowUserIds: [],
  replyMode: 'stream',
}

const asString = (value, fallback = '') => {
  const text = String(value ?? '').trim()
  return text === '' ? fallback : text
}

/**
 * 归一化配置：所有外部输入都不可信，缺省、类型错、超长一律收敛到安全值。
 * @param {object} raw 原始配置（文件/环境变量/宿主配置合并后）
 */
export function normalizeConfig(raw = {}) {
  const allow = Array.isArray(raw.allowUserIds)
    ? raw.allowUserIds.map((item) => String(item ?? '').trim()).filter((item) => item !== '')
    : []
  return {
    enabled: raw.enabled === true,
    botId: asString(raw.botId),
    secret: asString(raw.secret),
    // 工作目录必须是绝对路径；相对路径在宿主工作目录不确定时会指错地方，直接拒绝。
    cwd: resolve(asString(raw.cwd, process.cwd())),
    agentPreset: asString(raw.agentPreset, DEFAULTS.agentPreset),
    botName: asString(raw.botName),
    welcomeText: asString(raw.welcomeText),
    allowUserIds: allow,
    replyMode: asString(raw.replyMode, DEFAULTS.replyMode) === 'final' ? 'final' : 'stream',
  }
}

/**
 * 读取配置：宿主显式配置 > 环境变量 > 配置文件 > 默认。
 * 环境变量用于「不想把 Secret 落盘」的场景，优先级高于文件。
 */
export async function loadConfig(options = {}) {
  const path = options.path ?? defaultConfigPath()
  let fromFile = {}
  try {
    const text = await readFile(path, 'utf8')
    const parsed = JSON.parse(text)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) fromFile = parsed
  } catch {
    // 文件不存在或损坏都按空配置处理；首次使用是常态，不告警。
  }
  const merged = {
    ...fromFile,
    ...(options.overrides ?? {}),
    botId: asString(process.env.DSH_WECOM_BOT_ID, asString(options.overrides?.botId, fromFile.botId)),
    secret: asString(process.env.DSH_WECOM_SECRET, asString(options.overrides?.secret, fromFile.secret)),
  }
  return normalizeConfig(merged)
}

/** 原子写配置：先写同目录临时文件再 rename，失败不留半截文件。 */
export async function saveConfig(config, options = {}) {
  const path = options.path ?? defaultConfigPath()
  const normalized = normalizeConfig(config)
  await mkdir(dirname(path), { recursive: true })
  const temp = path + '.tmp-' + String(process.pid)
  await writeFile(temp, JSON.stringify(normalized, null, 2) + '\n', 'utf8')
  await rename(temp, path)
  return normalized
}

/** 面板可展示的配置视图：Secret 只回「是否已配置」，绝不回明文。 */
export function redactConfig(config) {
  return {
    enabled: config.enabled,
    botId: config.botId,
    secretConfigured: config.secret !== '',
    cwd: config.cwd,
    agentPreset: config.agentPreset,
    botName: config.botName,
    welcomeText: config.welcomeText,
    allowUserIds: [...config.allowUserIds],
    replyMode: config.replyMode,
  }
}
