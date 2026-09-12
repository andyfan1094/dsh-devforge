/**
 * 沙箱提权参数清洗 —— 工具层根治（0.33.0）。
 *
 * 问题：宿主 Bash/Pwsh/Fs 工具的 schema 恒定广播可选的 sandbox_permissions /
 * justification（沙箱被拒后的一次性提权重试专用）。GPT/Codex 类模型不管提示词
 * 怎么写都会惯性携带这两个字段，而 @deepseek-ai/dsh-sandbox 的校验是**硬失败**：
 *   - 只带其一：抛 "invalid escalation: sandbox_permissions requires a justification"
 *     / "justification is only valid together with sandbox_permissions"；
 *   - justification 空白或非字符串：抛 "invalid justification: expected a non-empty sentence"；
 *   - 请求模式不严格宽于当前有效模式：抛 `sandbox escalation to "X" is not strictly
 *     wider than this call's current "Y" mode`。danger-full-access 已是最宽、
 *     其 WIDER_MODES 为空表，因此该会话里**任何**提权请求都必然硬失败。
 * 结果是模型连续报错、反复重试直至会话作废。纯提示词约束对这类模型无效（已实测）。
 *
 * 修复位置：`tools/pre-execute` 瀑布钩子。该钩子拿到的是**活的 exec 对象**，
 * 且 `exec.arguments` 可以整体替换 —— createExecution 只对 JSON 快照做 deepFreeze，
 * exec 自身要到 notifyResult 才冻结；工具体随后读到的是 `exec.arguments`
 * （dsh-tools: dispatchToolBody → tool.execute(exec.arguments, exec)）。所以在
 * 派发前剥掉"必然失败"的提权字段即可从工具层彻底消除该错误：不依赖任何提示词，
 * 不改动 dsh 官方包，宿主升级不会覆盖本插件。
 *
 * 保守原则 —— 只剥**可证必然失败**的字段，其余一律原样放行：
 *   A. 带了 sandbox_permissions，但 justification 缺失/空白/非字符串 → 必然抛错；
 *   B. 只带 justification、没带 sandbox_permissions → 必然抛错；
 *   C. 成对且合法，但请求模式不是当前有效模式的严格更宽者 → 必然抛错
 *      （含 danger-full-access 会话里的全部提权请求）。
 * 不处理的情形：模式无法判定且请求模式本身合法（无法确证必然失败）；审批策略为
 * `never` 时的合法提权（那是确定性拒绝，属于诚实且可学习的终局错误，不该被静默改写）。
 */

/** 与 @deepseek-ai/dsh-sandbox 的 WIDER_MODES 逐字一致；宿主新增模式时本表保守失效（见 judgeEscalationArgs）。 */
export const WIDER_SANDBOX_MODES: Readonly<Record<string, readonly string[]>> = {
  'read-only': ['workspace-write', 'danger-full-access'],
  'workspace-write': ['danger-full-access'],
  'danger-full-access': [],
}

/** 任何模式下可用的合法升级目标（read-only 是地板，无人升级到它）。 */
export const KNOWN_ESCALATION_TARGETS: ReadonlySet<string> = new Set(
  Object.values(WIDER_SANDBOX_MODES).flatMap((modes) => [...modes]),
)

/** 需要清洗的两个参数名（成对出现语义由宿主定义）。 */
export const SANDBOX_ESCALATION_FIELDS = ['sandbox_permissions', 'justification'] as const

/** 剥离原因（诊断与自检用）。 */
export type EscalationStripReason =
  | 'justification-missing-or-blank'
  | 'justification-without-mode'
  | 'not-strictly-wider'
  | 'unknown-mode'

/** 对一次调用参数的裁定：放行，或剥掉提权字段。 */
export type EscalationVerdict =
  | { readonly action: 'keep' }
  | { readonly action: 'strip'; readonly reason: EscalationStripReason }

const KEEP: EscalationVerdict = { action: 'keep' }

/** justification 必须是宿主语义要求的"非空句子"（非字符串一律视为非法）。 */
function isNonEmptySentence(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * 裁定一次工具调用的提权参数是否必然失败。
 * @param args - 模型的原始调用参数（任意值；非对象一律放行）。
 * @param effectiveMode - 该次调用所在会话的当前沙箱模式；undefined 表示无法判定。
 * @returns 放行，或返回应当剥离的原因。
 */
export function judgeEscalationArgs(args: unknown, effectiveMode?: string): EscalationVerdict {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return KEEP
  const record = args as Record<string, unknown>
  const hasMode = record.sandbox_permissions !== undefined
  const hasReason = record.justification !== undefined
  if (!hasMode && !hasReason) return KEEP
  if (hasMode && !isNonEmptySentence(record.justification)) {
    return { action: 'strip', reason: 'justification-missing-or-blank' }
  }
  if (!hasMode) return { action: 'strip', reason: 'justification-without-mode' }
  const mode = typeof record.sandbox_permissions === 'string' ? record.sandbox_permissions : ''
  const wider = effectiveMode === undefined ? undefined : WIDER_SANDBOX_MODES[effectiveMode]
  if (wider === undefined) {
    // 当前模式未知（策略服务缺失或宿主引入新模式，本表尚未同步）：只有请求模式
    // 本身不是任何已知升级目标时才确证必然失败，否则保守放行。
    return KNOWN_ESCALATION_TARGETS.has(mode) ? KEEP : { action: 'strip', reason: 'unknown-mode' }
  }
  return wider.includes(mode) ? KEEP : { action: 'strip', reason: 'not-strictly-wider' }
}

/** 剥掉两个提权字段后的参数副本（其余键与值原样保留）。 */
export function stripEscalationFields(args: Record<string, unknown>): Record<string, unknown> {
  const { sandbox_permissions: _mode, justification: _reason, ...rest } = args
  return rest
}

/** 一次实际发生的清洗记录。 */
export interface EscalationStripInfo {
  /** 工具名（exec.name）。 */
  readonly tool: string
  /** 调用 id（exec.callId）。 */
  readonly callId: string
  /** 剥离原因。 */
  readonly reason: EscalationStripReason
  /** 被丢弃的请求模式（若给出且为字符串）。 */
  readonly requestedMode?: string
  /** 该次调用的有效模式（若可判定）。 */
  readonly effectiveMode?: string
}

/** 最小化依赖的 exec 视图（宿主 ToolExecution 的结构子集）。 */
export interface ToolExecutionLike {
  readonly name?: string
  readonly callId?: string
  readonly agent?: { readonly session?: unknown }
  arguments?: unknown
}

/** 读取可选服务所需的最小 ctx 视图。 */
export interface SandboxPolicyContext {
  get(name: string): unknown
}

/** ctx.sandboxPolicy 的结构子集。 */
interface SandboxPolicyServiceLike {
  resolve?(request?: { session?: unknown }): { mode?: unknown } | undefined
}

/**
 * 构造「解析该次调用所在会话当前沙箱模式」的回调。
 *
 * 血的教训（0.33.0 翻车点）：`resolve` 内部使用 `this`
 * （`this.overrideOf(session)` / `this.defaultMode` / `this.workspaceRoot` / `this.ctx`）。
 * 一旦写成 `const resolve = service.resolve; resolve(...)` 就会丢掉 this 绑定、
 * 抛 TypeError 并被吞成 undefined，钩子于是静默走"模式未知 → 保守放行"分支——
 * 表面无异常、日志无记录，但一个参数都没剥掉。必须以 `service.resolve(...)`
 * 形式调用；对应的回归测试见 tests/sandbox-escalation-guard.test.ts。
 * @param ctx - 宿主上下文（只读可选服务）。
 * @returns 模式解析回调；无法判定时返回 undefined。
 */
export function createEffectiveModeResolver(ctx: SandboxPolicyContext): (exec: ToolExecutionLike) => string | undefined {
  let service: SandboxPolicyServiceLike | undefined
  return (exec) => {
    try {
      service ??= ctx.get('sandboxPolicy') as SandboxPolicyServiceLike | undefined
      const current = service
      if (current === undefined || typeof current.resolve !== 'function') return undefined
      const session = exec?.agent?.session
      // 以方法形式调用：this 必须是服务实例本身。
      const policy = session === undefined ? current.resolve() : current.resolve({ session })
      return policy !== null && typeof policy === 'object' && typeof policy.mode === 'string' ? policy.mode : undefined
    } catch {
      return undefined
    }
  }
}

/** 一次「携带提权字段但被放行」的记录（诊断静默放行用）。 */
export interface EscalationKeepInfo {
  /** 工具名（exec.name）。 */
  readonly tool: string
  /** 该次调用的有效模式（undefined = 无法判定）。 */
  readonly effectiveMode?: string
  /** 请求的提权模式（若给出且为字符串）。 */
  readonly requestedMode?: string
}

/** 宿主侧依赖注入。 */
export interface SandboxEscalationGuardHost {
  /** 解析该次调用所在会话的当前沙箱模式；undefined = 无法判定。 */
  readonly resolveEffectiveMode?: (exec: ToolExecutionLike) => string | undefined
  /** 清洗发生时的观测回调（日志/自检）；抛错会被吞掉，绝不影响工具执行。 */
  readonly onStrip?: (info: EscalationStripInfo) => void
  /**
   * 携带提权字段但**未**清洗时的观测回调。这是 0.33.0 的教训：
   * 模式解析失败会静默放行，只有把这个分支也暴露出来才能第一时间发现问题。
   */
  readonly onKeep?: (info: EscalationKeepInfo) => void
}

/** 注册监听所需的最小 ctx 视图。 */
export interface SandboxEscalationGuardContext {
  on(name: string, listener: (exec: ToolExecutionLike, next: () => unknown) => unknown, options?: { prepend?: boolean }): unknown
}

function safeResolveMode(host: SandboxEscalationGuardHost, exec: ToolExecutionLike): string | undefined {
  try {
    return host.resolveEffectiveMode?.(exec)
  } catch {
    return undefined
  }
}

/**
 * 装载提权参数清洗钩子：任何工具的调用参数若携带必然失败的提权字段，就在派发前剥掉。
 * 注册为 `prepend`，确保它是链条上最先看到参数的监听器。
 * @param ctx - 宿主上下文（只需 on）。
 * @param host - 模式解析与观测回调。
 * @returns 卸载函数。
 */
export function installSandboxEscalationGuard(
  ctx: SandboxEscalationGuardContext,
  host: SandboxEscalationGuardHost = {},
): () => void {
  const dispose = ctx.on('tools/pre-execute', (exec, next) => {
    try {
      const args = exec?.arguments
      const carriesEscalation = args !== null && typeof args === 'object'
        && ((args as Record<string, unknown>).sandbox_permissions !== undefined
          || (args as Record<string, unknown>).justification !== undefined)
      const effectiveMode = safeResolveMode(host, exec)
      const verdict = judgeEscalationArgs(args, effectiveMode)
      if (verdict.action === 'strip') {
        const requested = (args as Record<string, unknown>).sandbox_permissions
        exec.arguments = stripEscalationFields(args as Record<string, unknown>)
        host.onStrip?.({
          tool: typeof exec.name === 'string' ? exec.name : '',
          callId: String(exec.callId ?? ''),
          reason: verdict.reason,
          ...(typeof requested === 'string' ? { requestedMode: requested } : {}),
          ...(effectiveMode !== undefined ? { effectiveMode } : {}),
        })
      } else if (carriesEscalation) {
        // 放行也留痕：静默放行正是 0.33.0 没能被及时发现的原因。
        const requested = (args as Record<string, unknown>).sandbox_permissions
        host.onKeep?.({
          tool: typeof exec.name === 'string' ? exec.name : '',
          ...(typeof requested === 'string' ? { requestedMode: requested } : {}),
          ...(effectiveMode !== undefined ? { effectiveMode } : {}),
        })
      }
    } catch {
      // 清洗是安全网：自身异常绝不能改变工具调用的成败。
    }
    return next()
  }, { prepend: true })
  return () => {
    if (typeof dispose === 'function') dispose()
  }
}
