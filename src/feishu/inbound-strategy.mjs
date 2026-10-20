// 飞书入站消息投递策略（0.66.2 起：运行中一律插话 + 即时在对话底部开新卡）。
//
// 背景（2026-10-20 辉哥实录）：旧策略把运行中消息 steer 进当前轮，而流式回复卡片
// 按会话只有一张。飞书对卡片原地更新既不产生新消息也不提醒，手机端表现为
// 「发了消息却看不到回复」；更糟的是 steer 在 turn/end 边界被拒时只停在 inbox，
// 整轮没有 entry 承载输出，回复彻底丢失。
//
// 辉哥的定案：不要排队，就要插话；插话后给卡片刷一张最新的到对话底部。
// 因此运行中的消息继续 steer（模型立刻看到、能调整方向），调用方在 steer 之后
// 立刻翻页（rolloverChat）：旧卡就地收尾，续写落到一张新卡片上——飞书会把它
// 当作新消息推送，手机端一眼能看到。
//
// QUEUE 只作为降级路径保留：steer 抛错（会话已销毁等）时把消息排队，等空闲边界
// 再 followup，避免消息静默丢失。

export const DELIVERY = Object.freeze({
  /** 空闲：正常开一轮新 turn。 */
  FOLLOWUP: 'followup',
  /** 运行中：steer 插进当前轮次的最邻近 step，并立即翻页让续写落到新卡片。 */
  STEER: 'steer',
  /** 降级：steer 失败时排队，等空闲边界逐条 followup（不由本策略主动返回）。 */
  QUEUE: 'queue',
})

/**
 * 决定一条入站消息的投递方式。
 * @param {{ wasRunning?: boolean }} input
 * @returns {'followup' | 'steer'}
 */
export function inboundDeliveryOf({ wasRunning } = {}) {
  return wasRunning === true ? DELIVERY.STEER : DELIVERY.FOLLOWUP
}
