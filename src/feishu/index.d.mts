/**
 * dsh-feishu vendored 模块的最小类型面。
 * 运行时契约与 dsh-feishu 0.2.2 一致；此处仅声明 devforge 激活层消费的导出，
 * 内部实现保持原 .mjs（不进 strict 类型检查，避免为迁移重写行为）。
 */
export declare const name: string
export declare const inject: readonly string[]
export declare function normalizeConfig(config?: Record<string, unknown>): Record<string, unknown>
export declare function feishuSessionTitleOf(text: unknown): string
export declare function apply(
  ctx: unknown,
  config?: Record<string, unknown> & { storePath?: string; sdkLoader?: unknown },
): void | (() => void)
