/**
 * 250k 压缩用户预设的一键配置能力（Windows/Mac 通用）。
 *
 * 职责边界：
 * - 检测：报告 cordis-250k 预设存在性、压缩参数、全局默认预设指向；
 * - 创建：预设缺失时把内置精简模板写入用户预设目录（绝不覆盖已有文件）；
 * - 设默认：可选把 agent-presets.default 切到 cordis-250k（merge 写入）。
 *
 * 不做的事：不修改/删除已存在的预设内容（完整创作模式版本由用户维护）、
 * 不触碰官方 shipped 预设、不回滚已写入文件（部分失败在结果中如实报告）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  PRESET_COMPOSITION_YAML,
  PRESET_ID,
  PRESET_META_YAML,
  RETAIN_TOKENS,
  THRESHOLD_RATIO,
} from './agent-preset-250k-template.ts'
import type { AgentPreset250kSetupResult, AgentPreset250kStatus } from './protocol.ts'

export type { AgentPreset250kSetupResult, AgentPreset250kStatus }

/** 一键配置依赖的宿主服务（均可选：缺失时对应能力降级为仅文件操作）。 */
export interface AgentPreset250kDeps {
  /** 宿主 settings 服务：读全局 agent-presets 域 + merge 更新默认预设。 */
  settings?: {
    get(ns: string): unknown
    update(ns: string, patch: object): Promise<void>
  }
  /** agent 预设服务：配置完成后校验预设可解析挂载。 */
  agentPresets?: { resolve(id: string): Promise<{ id?: string; broken?: string }> }
}

/** 一键配置的状态/结果契约见 protocol.ts（Host/Client 共享）；此处仅实现行为。 */

/** 解析用户预设根目录：优先显式 dshHome，其次运行时 DSH_HOME，最后 ~/.dsh。 */
export function resolvePresetRoot(dshHome?: string): string {
  const root = dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(root, '.agent-presets')
}

/** 从组合 yml 提取压缩参数；任意一项缺失即 undefined（供状态页判断健康度）。 */
export function parsePresetParams(yaml: string): { thresholdRatio?: number; retainTokens?: number } {
  const ratio = /^\s*thresholdRatio:\s*([0-9]+(?:\.[0-9]+)?)\s*$/m.exec(yaml)
  const retain = /^\s*retainTokens:\s*([0-9]+)\s*$/m.exec(yaml)
  return {
    thresholdRatio: ratio ? Number(ratio[1]) : undefined,
    retainTokens: retain ? Number(retain[1]) : undefined,
  }
}

/** 组装状态快照：文件 + 参数 + 全局默认指向一次性读齐，路由与测试共用。 */
export function readAgentPreset250kStatus(deps: AgentPreset250kDeps, dshHome?: string): AgentPreset250kStatus {
  const presetPath = join(resolvePresetRoot(dshHome), PRESET_ID, 'agent.cordis.yml')
  const yaml = existsSync(presetPath) ? readFileSync(presetPath, 'utf8') : ''
  const params = yaml ? parsePresetParams(yaml) : {}
  const domain = deps.settings?.get('agent-presets') as { default?: unknown } | undefined
  const defaultPreset = typeof domain?.default === 'string' ? domain.default : undefined
  return {
    presetPath,
    presetExists: yaml !== '',
    thresholdRatio: params.thresholdRatio,
    retainTokens: params.retainTokens,
    paramsOk: params.thresholdRatio === THRESHOLD_RATIO && params.retainTokens === RETAIN_TOKENS,
    defaultPreset,
    isDefault: defaultPreset === PRESET_ID,
  }
}

/**
 * 执行一键配置：缺文件则写入内置模板，可选切换全局默认，最后校验可挂载。
 *
 * 顺序刻意为先文件后 settings 再 resolve：文件是其他两步的前提；
 * settings/resolve 失败不回滚文件（文件本身无害，失败原因进 warnings）。
 */
export async function setupAgentPreset250k(
  deps: AgentPreset250kDeps,
  options: { dshHome?: string; setDefault?: boolean } = {},
): Promise<AgentPreset250kSetupResult> {
  const warnings: string[] = []
  const created: string[] = []
  const presetDir = join(resolvePresetRoot(options.dshHome), PRESET_ID)
  const compositionPath = join(presetDir, 'agent.cordis.yml')
  const metaPath = join(presetDir, 'preset.yml')

  if (!existsSync(compositionPath)) {
    // 组合文件缺失才视为“需要创建”；目录里已有的其他文件一律不动。
    mkdirSync(presetDir, { recursive: true })
    if (!existsSync(metaPath)) {
      writeFileSync(metaPath, PRESET_META_YAML, 'utf8')
      created.push(metaPath)
    }
    writeFileSync(compositionPath, PRESET_COMPOSITION_YAML, 'utf8')
    created.push(compositionPath)
  }

  let defaultSwitched = false
  if (options.setDefault === true) {
    if (deps.settings === undefined) {
      warnings.push('宿主 settings 服务不可用，未能切换全局默认预设；可在 DSH 设置中手动将默认预设设为 ' + PRESET_ID)
    } else {
      try {
        await deps.settings.update('agent-presets', { default: PRESET_ID })
        defaultSwitched = true
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        warnings.push('切换全局默认预设失败：' + reason)
      }
    }
  }

  if (deps.agentPresets !== undefined) {
    try {
      const resolved = await deps.agentPresets.resolve(PRESET_ID)
      if (resolved.broken !== undefined) {
        warnings.push('预设已写入，但宿主解析报告异常：' + resolved.broken)
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      warnings.push('预设已写入，但宿主解析失败：' + reason)
    }
  }

  const status = readAgentPreset250kStatus(deps, options.dshHome)
  return { ...status, ok: status.paramsOk, created, warnings, defaultSwitched }
}
