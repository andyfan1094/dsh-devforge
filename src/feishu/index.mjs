// Vendored from dsh-feishu 0.2.2 (MIT, andyfan1094/dsh-feishu).
// dsh-devforge consolidation modification: module folded into dsh-devforge;
// runtime behavior preserved. See THIRD_PARTY_NOTICES.md.
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, resolve as resolvePath } from 'node:path'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { createFeishuClient, buildImagePrompt, withFeishuChannelHint } from './feishu-client.mjs'
import { allowedPathOf, sendFile, sendImage, updateCard } from './outbound.mjs'
import { buildUserMessage, createReplyTracker } from './reply-tracker.mjs'
import { createQuestionAnswerer } from './questions.mjs'
import { legacySelectionIdentity, selectionIdentity, withGeneration } from './session-identity.mjs'
import { buildForkSeed, describeOccupier, forkCreateOptions, readSessionEvents } from './fork-takeover.mjs'
import { collectPersistedSessions, orderByRecentActivity } from './session-store-view.mjs'
import { buildEffortCard, buildHelpCard, buildModelCard, MODEL_PAGE_SIZE, HELP_ACTIONS, sendCardToChat } from './help.mjs'
import { createCompletionNotifier } from './completion-notifier.mjs'
import { FeishuStore } from './store.mjs'
import { makeRoutes } from './routes.mjs'

export const name = 'dsh-feishu'
export const inject = ['agents', 'agentDefaultModel', 'llm', 'agentPresets', 'webServer', 'workspaceRegistry', 'sessionPersistence', 'sessionTitle', 'attachments']

const DEFAULT_AGENT_PRESET = 'cordis'

// 飞书侧支持的斜杠命令全集：未知命令据此兜底提示（绝不静默无响应）。
// 与 handleCommand 的分支一一对应，新增命令时两边同步改。
const KNOWN_COMMANDS = new Set(['whoami', 'help', 'model', 'status', 'stop', 'new'])

export function feishuSessionTitleOf(text) {
  const compact = String(text ?? '').replace(/^!+\s*/, '').replace(/\s+/g, ' ').trim()
  const greeting = compact.toLowerCase().replace(/[?？!！,.，。~～\s]/g, '')
  if (/^(在|在吗|在不|你好|您好|hi|hello|测试|test)$/.test(greeting)) return '飞书会话'
  const summary = Array.from(compact).slice(0, 24).join('')
  return summary === '' ? '飞书会话' : '飞书 · ' + summary
}

export function normalizeConfig(config = {}) {
  const allowUsers = Array.isArray(config.allowUsers)
    ? config.allowUsers.map((id) => String(id).trim()).filter(Boolean)
    : []
  const configuredCwd = String(config.cwd ?? '').trim()
  return {
    enabled: config.enabled !== false,
    appId: String(config.appId ?? '').trim(),
    appSecret: String(config.appSecret ?? ''),
    domain: String(config.domain ?? 'https://open.feishu.cn').trim().replace(/\/+$/, '') || 'https://open.feishu.cn',
    allowUsers: [...new Set(allowUsers)],
    cwd: resolvePath(configuredCwd || process.cwd()),
    ack: config.ack !== false,
    ackReaction: String(config.ackReaction ?? 'OK').trim() || 'OK',
    provider: String(config.provider ?? '').trim(),
    model: String(config.model ?? '').trim(),
    reasoningEffort: String(config.reasoningEffort ?? '').trim(),
    agentPreset: String(config.agentPreset ?? DEFAULT_AGENT_PRESET).trim() || DEFAULT_AGENT_PRESET,
    mediaDir: String(config.mediaDir ?? '').trim(),
    groupMode: String(config.groupMode ?? '').trim() === 'mention' ? 'mention' : 'all',
    welcomeText: String(config.welcomeText ?? ''),
    chatCwds: normalizeRecordOf(config.chatCwds),
    asrBaseUrl: String(config.asrBaseUrl ?? '').trim(),
    asrApiKey: String(config.asrApiKey ?? '').trim(),
    asrModel: String(config.asrModel ?? '').trim(),
    syncCatchUp: config.syncCatchUp !== false,
    sdkLoader: config.sdkLoader,
  }
}

function normalizeRecordOf(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    const id = String(key).trim()
    const dir = String(item ?? '').trim()
    if (id !== '' && dir !== '') out[id] = resolvePath(dir)
  }
  return out
}

function customModelConfigured(config) {
  return config.provider !== '' || config.model !== ''
}

function sessionAlreadyExistsError(error) {
  const code = String(error?.code ?? '').toUpperCase()
  const text = error instanceof Error ? error.message : String(error ?? '')
  return code.includes('ALREADY_EXISTS')
    || /session.*already exists|already exists.*session/i.test(text)
    || /session.*already has a persisted log|session.*already persisted|\(id collision\)/i.test(text)
}

function sessionNotFoundError(error) {
  const code = String(error?.code ?? '').toUpperCase()
  const text = error instanceof Error ? error.message : String(error ?? '')
  return code.includes('NOT_FOUND') || /session.*not found|not found.*session/i.test(text)
}

export function legacySessionIdOf(chatId) {
  const digest = createHash('sha256').update(String(chatId), 'utf8').digest('hex').slice(0, 32)
  return 'session-feishu-' + digest
}

export function stableSessionIdOf(chatId, identity = 'legacy') {
  const digest = createHash('sha256')
    .update('dsh-feishu-session-v2\0' + String(chatId), 'utf8')
    .update('\0' + String(identity), 'utf8')
    .digest('hex')
    .slice(0, 32)
  return 'session-feishu-v2-' + digest
}

export function agentOptionsOf(selection) {
  return {
    provider: selection.provider,
    model: selection.model,
    ...(selection.maxTokens === undefined ? {} : { maxTokens: selection.maxTokens }),
  }
}

const IMAGE_MEDIA_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

function imageMediaTypeOf(imagePath, imageMeta = null) {
  const fromMeta = String(imageMeta?.format ?? '').trim().toLowerCase()
  const fromPath = extname(String(imagePath ?? '')).slice(1).toLowerCase()
  return IMAGE_MEDIA_TYPES[fromMeta] ?? IMAGE_MEDIA_TYPES[fromPath] ?? ''
}

function imagePathsOf(envelope) {
  if (Array.isArray(envelope?.imagePaths)) return envelope.imagePaths.map((value) => String(value ?? '').trim()).filter(Boolean)
  const single = String(envelope?.imagePath ?? '').trim()
  return single === '' ? [] : [single]
}

function imageMetasOf(envelope, count) {
  if (Array.isArray(envelope?.imageMetas)) return envelope.imageMetas.slice(0, count)
  return count === 0 ? [] : [envelope?.imageMeta ?? null]
}

function stripImagePlaceholders(text) {
  return String(text ?? '').replace(/\[图片\]/g, '').replace(/\n{3,}/g, '\n\n').trim()
}

async function saveFeishuImages(ctx, imagePaths, imageMetas) {
  if (imagePaths.length === 0) return []
  const attachments = ctx?.attachments
  if (attachments === undefined || typeof attachments.saveImages !== 'function') {
    throw new Error('DSH attachments service is not available')
  }
  const inputs = await Promise.all(imagePaths.map(async (imagePath, index) => {
    const imageMeta = imageMetas[index] ?? null
    const mediaType = imageMediaTypeOf(imagePath, imageMeta)
    if (mediaType === '') throw new Error('unsupported Feishu image format: ' + imagePath)
    return {
      data: await readFile(imagePath),
      mediaType,
      name: basename(imagePath),
    }
  }))
  return [...await attachments.saveImages(inputs)]
}

export function effortIdsOf(modelInfo) {
  return Array.isArray(modelInfo?.reasoning?.efforts)
    ? modelInfo.reasoning.efforts.map((effort) => String(effort.id)).filter(Boolean)
    : []
}

export function reasoningEffortsOf(modelInfo) {
  return Array.isArray(modelInfo?.reasoning?.efforts)
    ? modelInfo.reasoning.efforts.map((effort) => ({
      id: String(effort.id),
      name: String(effort.name ?? effort.id),
      ...(effort.description === undefined ? {} : { description: String(effort.description) }),
    }))
    : []
}

export function apply(ctx, config = {}) {
  const bootstrap = normalizeConfig(config)
  const store = new FeishuStore(bootstrap, config.storePath)
  let resolved = normalizeConfig({ ...store.get(), sdkLoader: config.sdkLoader })
  let allowed = new Set(resolved.allowUsers)
  const modelAdapterRetryDelayMs = Number.isFinite(Number(config.modelAdapterRetryDelayMs))
    ? Math.max(0, Number(config.modelAdapterRetryDelayMs))
    : 250
  const modelAdapterRetryAttempts = Number.isFinite(Number(config.modelAdapterRetryAttempts))
    ? Math.max(1, Math.floor(Number(config.modelAdapterRetryAttempts)))
    : 20
  const conversations = new Map()
  const creating = new Map()
  const welcomedChats = new Set()
  let configurationRevision = 0
  let reconfigurationRequests = 0
  let updateChain = Promise.resolve()
  let reconfiguring = false
  let closing = false
  let bridge = null
  let lastSessionError = ''
  let modelState = {
    provider: '',
    model: '',
    reasoningEffort: '',
    reasoningEfforts: [],
    agentPreset: resolved.agentPreset,
    followDefault: true,
    error: '',
  }

  const warn = (message) => {
    try { ctx?.logger?.warn?.('[dsh-feishu]', message) } catch {}
    try { console.error('[dsh-feishu]', message) } catch {}
  }
  const info = (message) => {
    try { ctx?.logger?.info?.('[dsh-feishu]', message) } catch {}
    try { console.info('[dsh-feishu]', message) } catch {}
  }
  // 会话复用诊断落固定文件：宿主 stdout 不落盘，而"重启后换了新会话"这类静默失效
  // 只发生在 resume 阶段（错误被 catch 吞掉），没有留痕就无从归因。这里记录身份取值、
  // 每个候选的 resume 结果与最终决定（0.41.7 起）。
  const sessionLogPath = join(homedir(), '.dsh', 'logs', 'feishu-session.log')
  let sessionLogDirReady = false
  const sessionLog = (level, message) => {
    try {
      if (!sessionLogDirReady) {
        mkdirSync(dirname(sessionLogPath), { recursive: true })
        sessionLogDirReady = true
      }
      appendFileSync(sessionLogPath, '[' + new Date().toISOString() + '] [' + level + '] ' + message + '\n', 'utf8')
    } catch {}
  }
  const send = async (chatId, text) => bridge === null ? false : bridge.sendText(chatId, text)
  const createStream = async (chatId, options) => bridge === null ? null : bridge.createStreamingCard?.(chatId, options)
  const tracker = createReplyTracker({ sendText: send, createStream, warn })
  // 飞书答题器：接管飞书会话的 ask_user_question，弹框改为飞书互动卡片送达用户手机。
  const questionAnswerer = createQuestionAnswerer({
    getClient: () => bridge?.getClient?.() ?? null,
    // apply 作用域内的发送函数名为 send（sendText 是 questions.mjs 的注入形参名）；
    // 此处若误写裸标识符 sendText 会在 apply 同步段抛 ReferenceError，
    // 被 safeActivate 静默吞掉（ctx.logger 不进 stdout），飞书桥整体无声死亡（0.38.4 实录）。
    sendText: send,
    // 答完卡片立刻翻页：当前执行过程卡就地收尾，续跑的答复落到一张新卡片上，
    // 手机端才能在提问卡片下方看到「继续处理 → 已完成」的新消息（0.41.6）。
    onAnswered: (chatId) => tracker.rolloverChat(chatId),
    // 答题器诊断日志落固定文件：认领 miss、注册映射、投递失败都要有据可查；
    // homedir() 跟随 HOME 环境变量，隔离 HOME 暂存实例自然落自己的 logs。
    logFile: join(homedir(), '.dsh', 'logs', 'feishu-questions.log'),
    warn,
    info,
  })
  const completionNotifier = createCompletionNotifier({
    getConfig: () => store.panel(),
    getClient: () => bridge?.getClient?.() ?? null,
    // 会话标题作为卡片主题首选来源；去掉「飞书 · 」前缀避免噪音
    getSessionTitle: (session) => {
      try {
        return String(ctx.sessionTitle.get(session)?.title ?? '').replace(/^飞书 · /, '')
      } catch {
        return ''
      }
    },
    warn,
  })

  const cwdFor = (chatId) => {
    const custom = String(resolved.chatCwds?.[String(chatId ?? '')] ?? '').trim()
    return resolvePath(custom !== '' ? custom : resolved.cwd)
  }

  const workspaceFor = async (cwd) => {
    const existing = await ctx.workspaceRegistry.resolveByPath(cwd)
    return existing ?? ctx.workspaceRegistry.create(cwd)
  }

  const attachSessionToWorkspace = async (sessionId, cwd) => {
    const workspace = await workspaceFor(cwd)
    await workspace.attachSession(sessionId)
    return workspace.id
  }

  const archivedSessionIdsOf = () => new Set(
    [...(ctx.workspaceRegistry?.archivedSessionIds ?? [])].map((sessionId) => String(sessionId)),
  )

  const repairPersistedFeishuSessions = async () => {
    let headers
    try { headers = await ctx.sessionPersistence.list() }
    catch (error) {
      warn('persisted Feishu workspace repair failed: ' + (error instanceof Error ? error.message : String(error)))
      return
    }
    for (const header of [...headers].reverse()) {
      const sessionId = String(header?.id ?? '')
      const cwd = String(header?.cwd ?? '').trim()
      if (!sessionId.startsWith('session-feishu') || cwd === '') continue
      try { await attachSessionToWorkspace(sessionId, cwd) }
      catch (error) {
        warn('failed to attach persisted Feishu session ' + sessionId + ': ' + (error instanceof Error ? error.message : String(error)))
      }
    }
  }

  const ensureSessionTitle = (conversation, text) => {
    const session = conversation?.agent?.session
    if (session === undefined) return
    try {
      const current = ctx.sessionTitle.get(session)
      const title = feishuSessionTitleOf(text)
      if (current === undefined || (current.title === '飞书会话' && title !== '飞书会话')) ctx.sessionTitle.rename(session, title)
    } catch (error) {
      warn('failed to title Feishu session ' + conversation.sessionId + ': ' + (error instanceof Error ? error.message : String(error)))
    }
  }

  const defaultSelectionOf = () => {
    const selection = ctx.agentDefaultModel.currentSelection()
    if (selection === null || typeof selection !== 'object') throw new Error('当前没有可用的默认模型')
    if (String(selection.provider ?? '').trim() === '' || String(selection.model ?? '').trim() === '') throw new Error('当前默认模型配置不完整')
    return {
      provider: String(selection.provider).trim(),
      model: String(selection.model).trim(),
      ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: String(selection.reasoningEffort).trim() }),
      ...(selection.maxTokens === undefined ? {} : { maxTokens: selection.maxTokens }),
    }
  }

  const modelInfoOf = async (selection, { waitForAdapter = false } = {}) => {
    if (typeof ctx.llm?.resolveModelInfo !== 'function') return {}
    let lastError
    for (let attempt = 1; attempt <= modelAdapterRetryAttempts; attempt += 1) {
      try { return await ctx.llm.resolveModelInfo(selection.provider, selection.model) }
      catch (error) {
        lastError = error
        const retryable = waitForAdapter && error?.code === 'NO_ADAPTER' && !closing && attempt < modelAdapterRetryAttempts
        if (!retryable) throw error
        await new Promise((resolve) => setTimeout(resolve, modelAdapterRetryDelayMs))
      }
    }
    throw lastError
  }

  const presetOf = async (agentPreset) => {
    if (typeof ctx.agentPresets?.resolve !== 'function') return { id: agentPreset }
    const preset = await ctx.agentPresets.resolve(agentPreset)
    if (preset?.broken) throw new Error('Agent 预设不可用：' + preset.broken)
    return preset
  }

  const resolveSelection = async (candidate = resolved, { waitForAdapter = false } = {}) => {
    const next = normalizeConfig(candidate)
    const followDefault = !customModelConfigured(next)
    const base = followDefault ? defaultSelectionOf() : { provider: next.provider, model: next.model }
    if (!base.provider || !base.model) throw new Error('Provider 和 Model 必须同时填写，或同时留空以跟随 DSH 默认模型')
    const modelInfo = await modelInfoOf(base, { waitForAdapter })
    const configuredEffort = next.reasoningEffort
    const requestedEffort = configuredEffort || (followDefault ? String(base.reasoningEffort ?? '').trim() : '')
    const efforts = effortIdsOf(modelInfo)
    if (requestedEffort !== '' && !efforts.includes(requestedEffort)) {
      throw new Error('模型不支持推理级别：' + requestedEffort)
    }
    await presetOf(next.agentPreset)
    const selection = {
      provider: base.provider,
      model: base.model,
      ...(requestedEffort === '' ? {} : { reasoningEffort: requestedEffort }),
      ...(base.maxTokens === undefined ? {} : { maxTokens: base.maxTokens }),
    }
    return { selection, modelInfo, followDefault, agentPreset: next.agentPreset }
  }

  const setModelState = (effective) => {
    if (!effective || !effective.selection) return
    modelState = {
      provider: effective.selection.provider,
      model: effective.selection.model,
      reasoningEffort: effective.selection.reasoningEffort ?? '',
      reasoningEfforts: reasoningEffortsOf(effective.modelInfo),
      agentPreset: effective.agentPreset,
      followDefault: effective.followDefault,
      error: '',
    }
  }

  const refreshModelState = async ({ waitForAdapter = false } = {}) => {
    try {
      const effective = await resolveSelection(resolved, { waitForAdapter })
      setModelState(effective)
      return effective
    } catch (error) {
      modelState = { ...modelState, agentPreset: resolved.agentPreset, error: error instanceof Error ? error.message : String(error) }
      throw error
    }
  }

  const statusSnapshot = () => {
    const connection = bridge?.status?.() ?? { state: resolved.enabled ? 'unconfigured' : 'disabled', connected: false, lastError: '' }
    return {
      ...connection,
      ...(modelState.error === '' ? {} : { state: 'error', lastError: modelState.error }),
      ...(lastSessionError === '' ? {} : { lastSessionError }),
      model: {
        provider: modelState.provider,
        model: modelState.model,
        effort: modelState.reasoningEffort,
        reasoningEffort: modelState.reasoningEffort,
        reasoningEfforts: modelState.reasoningEfforts,
        preset: modelState.agentPreset,
        agentPreset: modelState.agentPreset,
        followDefault: modelState.followDefault,
      },
      independentSessions: [...conversations.values()].map((entry) => ({
        chatId: entry.chatId,
        sessionId: entry.sessionId,
        status: entry.agent.status,
        createdAt: entry.createdAt,
        provider: entry.selection.provider,
        model: entry.selection.model,
        effort: entry.selection.reasoningEffort ?? '',
        preset: entry.agentPreset,
      })),
    }
  }

  // fork：占用接管专用。create 模式下携带父会话历史前缀（只读得来，不碰写锁），
  // 参数由 forkCreateOptions 统一组装（seed 为空时退化为全新会话参数）。
  async function createHandle(sessionId, effective, mode, expectedCwd, fork = null) {
    const agentOptions = agentOptionsOf(effective.selection)
    const setup = async (agentCtx) => {
      if (mode === 'resume') {
        const header = agentCtx?.agent?.session?.header
        if (header?.agentPreset !== effective.agentPreset || header?.cwd !== expectedCwd) {
          const error = new Error('persisted Feishu session metadata does not match the requested preset/workspace')
          error.code = 'FEISHU_SESSION_METADATA_MISMATCH'
          throw error
        }
      }
      const preset = await ctx.agentPresets.mount(agentCtx, effective.agentPreset)
      if (preset?.id !== undefined && preset.id !== effective.agentPreset) throw new Error('Agent 预设解析结果不一致')
      installModelSelection(agentCtx, { current: effective.selection, assembled: undefined })
    }
    const options = {
      ...(mode === 'resume' ? { resumeSessionId: sessionId } : { sessionId }),
      ...(mode === 'resume' ? {} : { meta: { cwd: expectedCwd, agentPreset: effective.agentPreset } }),
      agentOptions,
      setup,
    }
    // create+fork：seed/血缘参数与基础 options 的同名字段合并，setup 复用同一份闭包，
    // 预设挂载与模型注入的语义和普通 create 完全一致。
    const assembled = fork === null || mode !== 'create'
      ? options
      : forkCreateOptions({ sessionId, seed: fork.seed, parentSessionId: fork.parentSessionId, cwd: expectedCwd, agentPreset: effective.agentPreset, agentOptions, setup })
    return mode === 'resume' ? ctx.agents.resume(assembled) : ctx.agents.create(assembled)
  }

  async function detectLegacySession(sessionId, effective) {
    if (typeof ctx.agents.resume !== 'function') return false
    let loaded = false
    try {
      await ctx.agents.resume({
        resumeSessionId: sessionId,
        agentOptions: agentOptionsOf(effective.selection),
        setup: (agentCtx) => {
          loaded = agentCtx?.agent?.session !== undefined
          const error = new Error('legacy Feishu session detected')
          error.code = 'FEISHU_LEGACY_SESSION_DETECTED'
          throw error
        },
      })
    } catch {}
    return loaded
  }

  async function drainCreating() {
    while (creating.size > 0) await Promise.allSettled([...creating.values()])
  }

  async function createOrResumeConversation(chatId) {
    const key = String(chatId ?? '').trim()
    if (key === '') throw new Error('飞书 chatId 缺失')
    if (closing) throw new Error('飞书插件正在关闭')
    const inFlight = creating.get(key)
    if (inFlight !== undefined) return inFlight
    const task = (async () => {
      const revision = configurationRevision
      const effective = await resolveSelection(resolved, { waitForAdapter: true })
      setModelState(effective)
      const chatCwd = cwdFor(key)
      // 0.41.7 定稿：模型不参与会话身份 → 在飞书里换模型/换思考强度不再换会话，上下文保留。
      // 模型切换走 createHandle 里的 installModelSelection，注入到既有会话即可。
      const identity = selectionIdentity(effective.selection, effective.agentPreset, chatCwd, effective.followDefault)
      // 兼容候选：0.41.6 及以前的老会话按「含模型」的旧算法建号；升级后先用旧号 resume，
      // 把历史上下文继承过来，避免"升级本身"又造成一次断上下文。
      const legacyIdentity = legacySelectionIdentity(effective.selection, effective.agentPreset, chatCwd, effective.followDefault)
      const legacyIdentityId = legacyIdentity === identity ? '' : stableSessionIdOf(key, legacyIdentity)
      // 会话代际：占用接管（fork）与 /new 都会换代。代际持久化在 FeishuStore（state.generations），
      // 重启后重算出同一个 gen-N 号，resume 照常命中；gen=1 保持原号不变（存量会话零迁移）。
      const generation = store.getChatGeneration(key)
      let sessionId = stableSessionIdOf(key, withGeneration(identity, generation))
      const archivedSessionIds = archivedSessionIdsOf()
      const existing = conversations.get(key)
      // 身份漂移是"重启就新开会话"的唯一入口：落一行诊断，直接看到选择/预设/目录四项取值，
      // 下次再遇到"重启断上下文"不必再从会话文件反推（0.41.5 归因用）。
      if (existing === undefined || existing.identity !== identity) {
        const identityDetail = 'identity ' + (existing === undefined ? 'cold-start' : 'changed')
          + ' chat=' + key
          + ' identityId=' + sessionId
          + (legacyIdentityId === '' ? '' : ' legacyIdentityId=' + legacyIdentityId)
          + ' followDefault=' + String(effective.followDefault)
          + ' selection=' + JSON.stringify(effective.selection)
          + ' preset=' + String(effective.agentPreset)
          + ' cwd=' + chatCwd
          + (existing === undefined ? '' : ' from=' + existing.identity)
        questionAnswerer.log(existing === undefined ? 'info' : 'warn', identityDetail)
        sessionLog(existing === undefined ? 'info' : 'warn', identityDetail)
      }
      const existingArchived = existing !== undefined && archivedSessionIds.has(existing.sessionId)
      if (existing !== undefined && existing.identity === identity && !existingArchived) return existing
      if (existingArchived) info('retiring archived Feishu session ' + existing.sessionId)
      const existingMatch = existing !== undefined && existing.identity === identity && !existingArchived
      let resumedExisting = false
      const legacyFound = await detectLegacySession(legacySessionIdOf(key), effective)
      if (legacyFound) {
        sessionId = stableSessionIdOf(key, identity + ':legacy-migrated')
        info('migrating pre-v2 Feishu session to ' + sessionId)
      }
      if (existing !== undefined) {
        conversations.delete(key)
        await existing.handle.dispose()
        await tracker.observeAgentDisposed(existing.agent.id)
      }
      let handle = null
      let createSessionId = sessionId
      // 占用接管（fork）成功时给用户的一次性说明；随 entry 下发，发出后即清空。
      let forkedNote = ''
      // sessionPersistence.list() 返回快照数组 { header, revision, sizeBytes }，身份在
      // snapshot.header.id 上。0.41.6 及以前误读成 snapshot.id（恒为 undefined），于是：
      //   persistedIds 恒为空 → resumeCandidates 被清空（resume 永远不执行）
      //   → createCandidates 放行全部候选 → create 从稳定号开始撞车、靠 already-exists
      //   兜底一路退到下一个空号。
      // 这就是「每次重启都新开会话」的根因（实测兜底号 0→4 严格递增，与此完全吻合）。
      // 快照形状的解析与排序统一放在 session-store-view.mjs，由单测锁死防回归。
      let persisted = { ids: new Set(), byId: new Map(), listed: false }
      try { persisted = collectPersistedSessions(await ctx.sessionPersistence?.list?.()) } catch {}
      const persistedIds = persisted.ids
      const hasPersistedListing = persisted.listed
      const runtimeCollisionIds = Array.from({ length: 64 }, (_, index) => {
        const suffix = index === 0 ? ':runtime-collision' : ':runtime-collision-' + (index + 1)
        return stableSessionIdOf(key, identity + suffix)
      })
      const metadataMigratedId = stableSessionIdOf(key, identity + ':metadata-migrated')
      const metadataRebuiltId = stableSessionIdOf(key, identity + ':metadata-rebuilt')
      // 候选顺序即复用优先级：新身份号（模型无关）永远第一；其余历史号按"最后活动时间"倒序。
      // 这一点很关键：同一条飞书聊天在磁盘上会积累多代会话号，按固定顺序取会接回**最早**那条，
      // 用户最近几轮对话照样整段丢掉（实测这条聊天下同时存在 19:24 与 23:27 两代）。
      const historyCandidates = orderByRecentActivity([...new Set([
        ...(legacyIdentityId === '' ? [] : [legacyIdentityId]),
        ...runtimeCollisionIds,
        metadataMigratedId,
        metadataRebuiltId,
      ])], persisted.byId)
      const allSessionCandidates = [...new Set([sessionId, ...historyCandidates])]
      sessionLog('info', 'candidates chat=' + key
        + ' persisted=' + persistedIds.size
        + ' hasListing=' + String(hasPersistedListing)
        + ' order=' + allSessionCandidates.slice(0, 6).join(','))
      const resumeCandidates = allSessionCandidates.filter((candidateId) => !archivedSessionIds.has(candidateId) && (!hasPersistedListing || persistedIds.has(candidateId)))
      // resume 失败原因必须留痕：占用类错误（例如"已被电脑端写句柄占用"）既不是 not-found、
      // 也不是元数据不匹配，旧代码把它们静默吞掉后一路退到"新建一个兜底号"，
      // 表现就是「每次重启都丢上下文」而毫无线索（0.41.7 归因用）。
      const resumeFailures = []
      if (typeof ctx.agents.resume === 'function') {
        for (const candidateId of resumeCandidates) {
          // 主身份与兼容身份值得重试：宿主刚起来时电脑端可能正打开着这条会话，
          // 短暂占用会在几百毫秒内释放，重试救回来的正是用户的历史上下文。
          const attempts = candidateId === sessionId || candidateId === legacyIdentityId ? 3 : 1
          for (let attempt = 1; attempt <= attempts; attempt += 1) {
            try {
              handle = await createHandle(candidateId, effective, 'resume', chatCwd)
              sessionId = candidateId
              resumedExisting = true
              info('resumed independent Feishu session ' + sessionId)
              sessionLog('info', 'resume ok chat=' + key + ' candidate=' + candidateId + ' attempt=' + attempt)
              break
            } catch (error) {
              if (sessionNotFoundError(error)) {
                sessionLog('info', 'resume not-found chat=' + key + ' candidate=' + candidateId)
                break
              }
              if (error?.code === 'FEISHU_SESSION_METADATA_MISMATCH') {
                if (candidateId === metadataRebuiltId) {
                  const migrationError = new Error('飞书迁移会话元数据仍不一致，请检查持久化会话')
                  migrationError.code = 'FEISHU_MIGRATION_METADATA_INCONSISTENT'
                  throw migrationError
                }
                createSessionId = candidateId === metadataMigratedId ? metadataRebuiltId : metadataMigratedId
                info('migrating Feishu session metadata to ' + createSessionId)
                break
              }
              const failureCode = String(error?.code ?? error?.name ?? '')
              const failureDetail = error instanceof Error ? error.message : String(error)
              resumeFailures.push({ candidateId, code: failureCode, detail: failureDetail })
              sessionLog('warn', 'resume failed chat=' + key + ' candidate=' + candidateId
                + ' attempt=' + attempt + '/' + attempts + ' code=' + failureCode + ' message=' + failureDetail)
              if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 300 * attempt))
            }
          }
          if (handle !== null) break
        }
      }
      if (handle === null) sessionId = createSessionId
      // 会话确实存在（resume 报的不是 not-found）却打不开时，不再把解锁责任推给用户：
      // 单写者租约下 GUI 可以把写句柄握几小时甚至隔夜（2026-09-29 实录），等待与重试都没有意义。
      // 处置：只读旧会话历史（read 句柄不碰写锁）→ fork 后继会话接管，消息照常投递，
      // 完整历史上下文随 seed 继承；只有 fork 也失败时才报错（文案带占用归因）。
      if (handle === null) {
        const blocked = resumeFailures.find((failure) => failure.candidateId === sessionId || (legacyIdentityId !== '' && failure.candidateId === legacyIdentityId))
        if (blocked !== undefined) {
          // 占用归因：宿主进程内有活体代理 ≈ 电脑端 GUI 开着；否则是外部进程持锁。仅用于文案与日志。
          const occupier = describeOccupier(ctx.agents, blocked.candidateId)
          sessionLog('warn', 'session occupied chat=' + key + ' candidate=' + blocked.candidateId + ' code=' + blocked.code + ' occupier=' + occupier)
          const forkedSessionId = stableSessionIdOf(key, withGeneration(identity, generation + 1))
          sessionLog('info', 'fork takeover chat=' + key + ' from=' + blocked.candidateId + ' to=' + forkedSessionId)
          try {
            const events = await readSessionEvents(ctx.sessionPersistence, blocked.candidateId)
            const { seed } = events === null ? { seed: [] } : buildForkSeed(events)
            handle = await createHandle(forkedSessionId, effective, 'create', chatCwd, { seed, parentSessionId: blocked.candidateId })
            sessionId = forkedSessionId
            resumedExisting = false
            forkedNote = seed.length === 0
              ? '原会话正被电脑端界面占用，已自动开启后继会话接管（旧会话暂无可继承的完整轮次，从现在开始记录）。'
              : '原会话正被电脑端界面占用，已自动接管到本会话：完整历史上下文已继承，这条消息继续处理。'
            // 旧号进插件归档（不再参与 resume），代际 +1 持久化：重启后重算出同一个后继号。
            store.archiveSessionId(key, blocked.candidateId)
            store.setChatGeneration(key, generation + 1)
          } catch (forkError) {
            const forkDetail = forkError instanceof Error ? forkError.message : String(forkError)
            sessionLog('error', 'fork takeover failed chat=' + key + ' target=' + forkedSessionId + ' message=' + forkDetail)
            const busyError = new Error('飞书会话正被'
              + (occupier === 'gui' ? '电脑端界面' : '其他进程')
              + '占用，自动接管失败（' + forkDetail + '）；请稍后重发，或发 /new 直接开启全新会话')
            busyError.code = 'FEISHU_SESSION_BUSY'
            throw busyError
          }
        }
      }
      if (handle === null) {
        // 只有"磁盘上还不存在的号"才允许新建；兼容用的老身份号绝不新建，
        // 否则会造出一条没人认领的孤儿会话，下次又要重新挑号。
        const createCandidates = allSessionCandidates.filter((candidateId) => candidateId !== legacyIdentityId && !archivedSessionIds.has(candidateId) && (!hasPersistedListing || !persistedIds.has(candidateId)))
        let createError = null
        for (const candidateId of createCandidates) {
          try {
            handle = await createHandle(candidateId, effective, 'create', chatCwd)
            sessionId = candidateId
            info('created independent Feishu session ' + sessionId)
            break
          } catch (error) {
            createError = error
            if (!sessionAlreadyExistsError(error)) throw error
            info('Feishu session id already exists; trying the next unique Feishu session id')
          }
        }
        if (handle === null) throw createError ?? new Error('无法分配新的独立飞书会话 ID')
      }
      if (handle?.agent === undefined || typeof handle.dispose !== 'function') throw new Error('DSH agents.create/resume 返回的 handle 不完整')
      if (closing || revision !== configurationRevision) {
        await handle.dispose()
        const error = new Error('飞书配置已更新，请重试当前消息')
        error.code = 'FEISHU_CONFIG_CHANGED'
        throw error
      }
      let workspaceId = ''
      try { workspaceId = await attachSessionToWorkspace(sessionId, chatCwd) }
      catch (error) {
        warn('failed to attach Feishu session ' + sessionId + ' to workspace: ' + (error instanceof Error ? error.message : String(error)))
      }
      const entry = { chatId: key, sessionId, workspaceId, identity, agent: handle.agent, handle, selection: effective.selection, agentPreset: effective.agentPreset, createdAt: Date.now(), created: !existingMatch && !resumedExisting, forkedNote }
      conversations.set(key, entry)
      // 双键注册：agent 实例 id + 会话 id 都映射到本飞书会话，任一命中即可认领问题卡片。
      questionAnswerer.registerAgent(handle.agent.id, key, sessionId)
      lastSessionError = ''
      return entry
    })()
    creating.set(key, task)
    try { return await task } finally { creating.delete(key) }
  }

  const statusText = (chatId) => {
    const entry = conversations.get(String(chatId ?? '').trim())
    const current = entry === undefined
      ? modelState
      : { provider: entry.selection.provider, model: entry.selection.model, reasoningEffort: entry.selection.reasoningEffort ?? '', agentPreset: entry.agentPreset }
    const actual = ['provider=' + (current.provider || '未知'), 'model=' + (current.model || '未知'), 'effort=' + (current.reasoningEffort || '默认'), 'preset=' + current.agentPreset].join(' · ')
    if (entry === undefined) return ['独立飞书会话：尚未创建。发送普通消息后会自动创建。', '当前配置：' + actual].join('\n')
    return ['独立飞书会话：' + entry.sessionId, '状态：' + String(entry.agent.status ?? 'unknown'), '工作目录：' + resolved.cwd, '实际配置：' + actual].join('\n')
  }

  const HELP_FALLBACK_TEXT = '直接发消息即可进入独立飞书会话；回答进行中再发消息会直接插入当前任务继续处理；/new 开一个不带历史的新会话；/status 查看本飞书会话；/model 切换模型与思考强度；/stop 停止本会话任务（排队中的消息一并取消）；/help 发送互动帮助卡片；生成文件或图片后可直接让 Agent 调用 dsh_feishu_send_file / dsh_feishu_send_image 发给你。'

  /** 给指定飞书会话发一张互动卡片；失败抛错由调用方兜底为文字回复。 */
  const sendCardTo = (chatId, card) => sendCardToChat(() => bridge?.getClient?.() ?? null, chatId, card)

  /**
   * 模型卡翻页缓存：chatId -> { models, current, messageId, at }。
   * 翻页回调必须原地更新同一张卡（PATCH message），需要记住发卡时的模型清单与 message_id；
   * 模型清单短时间内不变，缓存 10 分钟，过期后提示重新 /model。
   */
  const modelCardCache = new Map()
  const MODEL_CARD_CACHE_MS = 10 * 60 * 1000

  /** /model：拉取可选模型并发模型选择卡（modelOptions 内部会刷新模型状态），并记录翻页缓存。 */
  const sendModelCard = async (chatId) => {
    const options = await runtime.modelOptions()
    const messageId = await sendCardTo(chatId, buildModelCard(options.current, options.models, { pageSize: MODEL_PAGE_SIZE }))
    modelCardCache.set(String(chatId ?? '').trim(), { models: options.models, current: options.current, messageId, at: Date.now() })
  }

  const handleCommand = async (envelope) => {
    const command = String(envelope.text.slice(1).trim().split(/\s+/)[0] ?? '').toLowerCase()
    if (command === 'whoami') return '飞书身份：' + envelope.userId
    if (command === 'help') {
      // 帮助卡发送失败时回退为文字版，绝不静默无响应。
      try { await sendCardTo(envelope.chatId, buildHelpCard()) }
      catch (error) { warn('help card delivery failed: ' + (error instanceof Error ? error.message : String(error))); return HELP_FALLBACK_TEXT }
      return null
    }
    if (command === 'model') {
      try { await sendModelCard(envelope.chatId) }
      catch (error) { warn('model card delivery failed: ' + (error instanceof Error ? error.message : String(error))); return '模型卡片获取失败：' + (error instanceof Error ? error.message : String(error)) }
      return null
    }
    if (command === 'status') {
      try { await refreshModelState() } catch {}
      return statusText(envelope.chatId)
    }
    if (command === 'stop') {
      const entry = conversations.get(String(envelope.chatId ?? '').trim())
      if (entry === undefined) return '当前还没有独立飞书会话。'
      try {
        const running = entry.agent.status === 'running'
        // cancel 的 cause 必须是 { kind: ... } 对象（DSH AgentCancelCause 契约）。
        // 传字符串会让 agent-loop 的 abortedCancelCause 走 assertNever 分支抛错，
        // catch 块暴毙后 finally 把初始值 null 写进 turn/end，GUI 前端读 reason.kind 直接崩溃。
        entry.agent.cancel({ kind: 'user' })
        void tracker.cancelAgent(entry.agent.id, entry.agent.session)
        return running ? '已停止当前独立飞书会话的任务。' : '当前没有正在运行的飞书任务。'
      }
      catch { return '停止失败，请稍后重试。' }
    }
    if (command === 'new') {
      // /new：显式换代。归档当前会话号 + 代际 +1，下一封消息冷启动落到全新主号。
      // 历史上下文刻意不带过来——这就是 /new 与占用接管（fork）的本质区别。
      const key = String(envelope.chatId ?? '').trim()
      const entry = conversations.get(key)
      if (entry !== undefined && entry.agent.status === 'running') return '当前任务还在运行，请先发 /stop，结束后再开新会话。'
      const generation = store.getChatGeneration(key)
      if (entry !== undefined) {
        conversations.delete(key)
        try { await entry.handle.dispose() } catch {}
        // 旧号进插件归档：冷启动后绝不再 resume 回它（/new 的语义就是不带历史）。
        store.archiveSessionId(key, entry.sessionId)
      }
      store.setChatGeneration(key, generation + 1)
      return '已开启全新会话（第 ' + (generation + 1) + ' 代）：不携带历史上下文，直接发消息即可开始。'
    }
    return null
  }

  const handleStopRequest = async (chatId) => {
    const entry = conversations.get(String(chatId ?? '').trim())
    if (entry === undefined) {
      await send(chatId, '当前没有正在运行的飞书任务。')
      return
    }
    try {
      const running = entry.agent.status === 'running'
      // 同上：cause 必须是 { kind: 'user' }，字符串 cause 会产生 reason:null 的毒 turn/end 事件。
      entry.agent.cancel({ kind: 'user' })
      void tracker.cancelAgent(entry.agent.id, entry.agent.session)
      await send(chatId, running ? '已停止当前任务，正在收尾回复卡片。' : '当前没有正在运行的飞书任务。')
    } catch {
      await send(chatId, '停止失败，请稍后重试。')
    }
  }

  const handleMenuCommand = async ({ command, userId, chatId }) => {
    if (!allowed.has(userId)) return
    if (!['status', 'stop', 'help', 'whoami'].includes(String(command))) return
    const reply = await handleCommand({ text: '/' + String(command), userId, chatId })
    if (reply !== null) await send(chatId, reply)
  }

  const handleMessage = async (envelope, channel = {}) => {
    if (closing) return
    if (!allowed.has(envelope.userId)) {
      await send(envelope.chatId, '当前飞书身份未授权：' + envelope.userId + '\n请在飞书配置面板的白名单中加入该 open_id。')
      return
    }
    if (envelope.kind === 'edit') {
      const entry = conversations.get(String(envelope.chatId ?? '').trim())
      if (entry === undefined || entry.agent.status === 'running') return
      try {
        // 编辑重发会开启新一轮对话，同样需要通道提示，防止模型触发电脑端交互弹框。
        entry.agent.followup(buildUserMessage(withFeishuChannelHint(envelope.text)))
        await send(envelope.chatId, '已收到修改后的内容，正在重新处理。')
      } catch (error) {
        warn('failed to deliver edited Feishu message: ' + (error instanceof Error ? error.message : String(error)))
      }
      return
    }
    if (envelope.text.startsWith('/')) {
      // 未知命令显式兜底：/new 这类桌面端习惯命令曾经静默无响应（辉哥 2026-09-29 实录），
      // 输入之后得不到任何反馈。已知命令集合之外的输入一律回可用清单。
      const command = String(envelope.text.slice(1).trim().split(/\s+/)[0] ?? '').toLowerCase()
      if (!KNOWN_COMMANDS.has(command)) {
        await send(envelope.chatId, '未知命令 /' + command + '。可用命令：/new 开新会话 · /status 查看状态 · /model 换模型 · /stop 停止任务 · /help 帮助')
        return
      }
      const reply = await handleCommand(envelope)
      if (reply !== null) await send(envelope.chatId, reply)
      return
    }
    // 开放题等待自由作答时，把这条普通文本消费为答案，不再进入任务流。
    if (envelope.kind !== 'edit' && questionAnswerer.hasPendingCustom(envelope.chatId)) {
      const consumed = questionAnswerer.recordCustomAnswer(envelope.chatId, envelope.text)
      if (consumed) return
    }
    if (reconfiguring) {
      await send(envelope.chatId, '飞书 Agent 配置正在更新，请稍后重新发送。')
      return
    }
    let conversation
    try { conversation = await createOrResumeConversation(envelope.chatId) }
    catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      lastSessionError = detail
      warn('independent session creation failed' + (error?.code ? ' [' + error.code + ']' : '') + ': ' + detail)
      await send(envelope.chatId, '独立飞书会话创建失败：' + detail)
      return
    }
    if (conversation.created && resolved.welcomeText.trim() !== '' && !welcomedChats.has(envelope.chatId)) {
      welcomedChats.add(envelope.chatId)
      await send(envelope.chatId, resolved.welcomeText.trim())
    }
    // 占用接管说明：只在接管发生的那条消息前提示一次，发出后立即清空，
    // 同一会话的后续消息不再重复播报。
    if (conversation.forkedNote) {
      const note = conversation.forkedNote
      conversation.forkedNote = ''
      await send(envelope.chatId, note)
    }
    await config.beforeDelivery?.(conversation, envelope)
    const conversationKey = String(envelope.chatId ?? '').trim()
    if (closing || reconfiguring || conversations.get(conversationKey) !== conversation) {
      await send(envelope.chatId, '飞书 Agent 配置已更新，请重新发送这条消息。')
      return
    }
    const agent = conversation.agent
    const wasRunning = agent.status === 'running'
    const isSteer = envelope.text.startsWith('!')
    // Mid-run messages are inserted into the current turn instead of queueing
    // a follow-up turn; they share the already-streaming reply card.
    const deliverAsSteer = wasRunning
    const reuseLiveCard = deliverAsSteer && tracker.hasActive(agent.id)
    const ticket = reuseLiveCard ? null : tracker.register(agent.id, envelope.chatId, {
      waitForTurnStart: false,
      provider: conversation.selection.provider,
      model: conversation.selection.model,
      effort: conversation.selection.reasoningEffort ?? '',
    })
    try {
      const text = isSteer ? envelope.text.slice(1).trim() : envelope.text
      if (text === '') { ticket?.cancel(); return }
      const imagePaths = imagePathsOf(envelope)
      const imageMetas = imageMetasOf(envelope, imagePaths.length)
      const hasImages = imagePaths.length > 0
      const imageText = hasImages ? stripImagePlaceholders(text) : text
      let promptText = imageText
      let imageRefs = []
      if (hasImages) {
        try {
          imageRefs = await saveFeishuImages(ctx, imagePaths, imageMetas)
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error)
          warn('direct Feishu image delivery failed; falling back to read_image prompt: ' + detail)
          promptText = buildImagePrompt({
            text,
            imagePath: imagePaths[0],
            imageMeta: imageMetas[0] ?? null,
          })
        }
      }
      ensureSessionTitle(conversation, hasImages && imageText === '' ? '图片' : imageText)
      // 通道提示只在开启新一轮的消息上注入；运行中插队（含「!」显式插话）发生在
      // 当前轮次内部，轮次首条消息已带提示，重复注入只会增加噪音。
      const hintText = (deliverAsSteer || isSteer) ? promptText : withFeishuChannelHint(promptText)
      const payload = buildUserMessage(hintText, imageRefs)
      if (deliverAsSteer || isSteer) agent.steer(payload); else agent.followup(payload)
      if (resolved.ack) {
        const reacted = typeof channel.react === 'function' ? await channel.react(envelope.messageId, resolved.ackReaction) : false
        if (!reacted) await send(envelope.chatId, '已收到，正在处理。')
      }
    } catch (error) {
      ticket?.cancel()
      await send(envelope.chatId, '消息投递失败：' + (error instanceof Error ? error.message : String(error)))
    }
  }

  async function stopBridgeAndSessions() {
    tracker.dispose()
    // 桥重启（配置更新）只取消挂起提问，绝不能 dispose 答题器：startBridge 只重建 bridge、
    // 不重建答题器实例，一旦 dispose 就永久 closed，之后所有卡片提问都在入口被拒
    // （0.41.4 实录）。只有插件真正卸载（closing）才走不可逆的 dispose。
    if (closing) questionAnswerer.dispose()
    else questionAnswerer.cancelAll('飞书桥正在重建，该问题已取消；请直接用文字继续沟通')
    const currentBridge = bridge
    bridge = null
    const handles = [...conversations.values()].map((entry) => entry.handle)
    conversations.clear()
    await Promise.allSettled([
      Promise.resolve().then(() => currentBridge?.stop?.()),
      ...handles.map((handle) => handle.dispose()),
    ])
  }

  /**
   * 卡片回调统一路由：问答卡片归答题器；帮助/模型卡片的快捷动作在这里执行。
   * chatId 取自回调 context（p2p 会话为 open_chat_id）；模型切换复用面板同款
   * updateConfig 链路（会话身份已与模型解耦，切换后台重建流程会 resume 回同一条会话，
   * 上下文保留），任务运行中直接拒绝并提示。
   */
  const chatIdOfCardAction = (data) => String(data?.context?.open_chat_id ?? data?.open_chat_id ?? '').trim()

  const handleModelApply = (chatId, value) => {
    const provider = String(value?.provider ?? '').trim()
    const model = String(value?.model ?? '').trim()
    const effort = String(value?.effort ?? '').trim()
    if (provider === '' || model === '') return { toast: { content: '回调缺少模型信息，已忽略' } }
    const entry = conversations.get(chatId)
    if (entry !== undefined && entry.agent.status === 'running') return { toast: { content: '任务运行中，请先发送 /stop 再切换模型' } }
    const patch = { provider, model, ...(effort === '' ? { reasoningEffort: '' } : { reasoningEffort: effort }) }
    // 回调必须秒回 toast，配置更新（含桥重启）放后台跑，结果用文本回执。
    void enqueueConfigUpdate(patch)
      .then(() => {
        // 翻页缓存同步新选中值，翻页后「当前」高亮不漂移。
        const cached = modelCardCache.get(chatId)
        if (cached !== undefined) modelCardCache.set(chatId, { ...cached, current: { provider, model, ...(effort === '' ? {} : { reasoningEffort: effort }) }, at: Date.now() })
        return send(chatId, '已切换模型：' + model + (effort === '' ? '（思考强度跟随默认）' : '（思考强度 ' + effort + '）') + '；当前会话继续沿用，历史上下文保留，直接发消息即可。')
      })
      .catch((error) => send(chatId, '模型切换失败：' + (error instanceof Error ? error.message : String(error))))
    return { toast: { content: '正在切换模型…' } }
  }

  const handleFeishuCardAction = async (value, data) => {
    const action = String(value?.action ?? '')
    if (action.startsWith('feishu_question')) return questionAnswerer.handleCardValue(value)
    if (action === HELP_ACTIONS.CMD) {
      const chatId = chatIdOfCardAction(data)
      if (chatId === '') return { toast: { content: '未找到对应的飞书会话' } }
      const cmd = String(value?.cmd ?? '').trim()
      if (cmd === 'status') {
        try { await refreshModelState() } catch {}
        await send(chatId, statusText(chatId))
        return { toast: { content: '状态已发送' } }
      }
      if (cmd === 'model') {
        try { await sendModelCard(chatId) }
        catch (error) { warn('model card delivery failed: ' + (error instanceof Error ? error.message : String(error))); return { toast: { content: '模型卡片获取失败' } } }
        return { toast: { content: '已发送模型选择卡片' } }
      }
      return null
    }
    if (action === HELP_ACTIONS.MODEL_PICK) {
      const chatId = chatIdOfCardAction(data)
      if (chatId === '') return { toast: { content: '未找到对应的飞书会话' } }
      const provider = String(value?.provider ?? '').trim()
      const model = String(value?.model ?? '').trim()
      if (provider === '' || model === '') return { toast: { content: '回调缺少模型信息，已忽略' } }
      let efforts = []
      let name = model
      try {
        const info = await ctx.llm.resolveModelInfo(provider, model)
        efforts = reasoningEffortsOf(info)
        name = String(info.name ?? model)
      } catch (error) {
        warn('resolveModelInfo failed for ' + provider + '/' + model + ': ' + (error instanceof Error ? error.message : String(error)))
      }
      try { await sendCardTo(chatId, buildEffortCard({ provider, model, name, reasoningEfforts: efforts })) }
      catch (error) { warn('effort card delivery failed: ' + (error instanceof Error ? error.message : String(error))); return { toast: { content: '思考强度卡片发送失败' } } }
      return { toast: { content: '请选择思考强度' } }
    }
    if (action === HELP_ACTIONS.MODEL_APPLY) {
      const chatId = chatIdOfCardAction(data)
      if (chatId === '') return { toast: { content: '未找到对应的飞书会话' } }
      return handleModelApply(chatId, value)
    }
    if (action === HELP_ACTIONS.MODEL_PAGE) {
      // 翻页：原地更新同一张模型卡，不新增会话消息；缓存过期时提示重新 /model。
      const chatId = chatIdOfCardAction(data)
      if (chatId === '') return { toast: { content: '未找到对应的飞书会话' } }
      const cached = modelCardCache.get(chatId)
      if (cached === undefined || Date.now() - cached.at > MODEL_CARD_CACHE_MS) {
        return { toast: { content: '模型列表已过期，请重新发送 /model' } }
      }
      const page = Math.trunc(Number(value?.page ?? 0))
      if (!Number.isFinite(page) || page < 0) return { toast: { content: '无效页码，已忽略' } }
      const card = buildModelCard(cached.current, cached.models, { page, pageSize: MODEL_PAGE_SIZE })
      try {
        await updateCard(bridge?.getClient?.(), cached.messageId, card)
        return { toast: { content: '已翻页' } }
      } catch (error) {
        // 原地更新失败（卡片过期/被删等）退回发新卡，翻页能力不能死。
        warn('model card in-place page update failed: ' + (error instanceof Error ? error.message : String(error)))
        try {
          const messageId = await sendCardTo(chatId, card)
          modelCardCache.set(chatId, { ...cached, messageId, at: Date.now() })
          return { toast: { content: '已翻页（新卡片）' } }
        } catch (fallbackError) {
          warn('model card page fallback delivery failed: ' + (fallbackError instanceof Error ? fallbackError.message : String(fallbackError)))
          return { toast: { content: '翻页失败，请重新发送 /model' } }
        }
      }
    }
    return null
  }

  async function startBridge() {
    if (closing) return
    await repairPersistedFeishuSessions()
    const modelStateReady = refreshModelState({ waitForAdapter: true }).catch((error) => {
      warn('model configuration pending: ' + (error instanceof Error ? error.message : String(error)))
    })
    if (!resolved.enabled || resolved.appId === '' || resolved.appSecret === '') return
    bridge = createFeishuClient({
      config: resolved,
      onMessage: handleMessage,
      sdkLoader: resolved.sdkLoader,
      logger: ctx?.logger,
      onStopRequest: handleStopRequest,
      onMenuCommand: handleMenuCommand,
      // 卡片按钮回调统一路由：问答归答题器，帮助/模型卡在此分发（停止按钮仍由桥内部处理）。
      onCardAction: (value, data) => handleFeishuCardAction(value, data),
      onLoadState: () => store.getState(),
      onSaveState: (patch) => store.setState(patch),
    })
    await bridge.start()
    // start() swallows startup errors for boot resilience; activation callers
    // need the failure so performConfigUpdate can roll back, so verify here.
    const bridgeStatus = bridge.status?.()
    if (bridgeStatus && bridgeStatus.connected !== true && bridgeStatus.lastError) throw new Error(bridgeStatus.lastError)
    await modelStateReady
  }

  async function performConfigUpdate(patch) {
    if (closing) throw new Error('飞书插件正在关闭')
    const current = store.get()
    const next = normalizeConfig({
      ...current,
      ...patch,
      appSecret: patch.appSecret === undefined || String(patch.appSecret) === '' ? current.appSecret : patch.appSecret,
      sdkLoader: config.sdkLoader,
    })
    const effective = await resolveSelection(next)
    if (closing) throw new Error('飞书插件正在关闭')
    const previousResolved = resolved
    const previousAllowed = new Set(allowed)
    const previousModelState = { ...modelState }
    store.update(patch)
    configurationRevision += 1
    await drainCreating()
    if (closing) throw new Error('飞书插件正在关闭')
    await stopBridgeAndSessions()
    if (closing) throw new Error('飞书插件正在关闭')
    resolved = next
    allowed = new Set(resolved.allowUsers)
    setModelState(effective)
    try {
      await startBridge()
      return store.panel()
    } catch (error) {
      await stopBridgeAndSessions()
      store.save(current)
      resolved = previousResolved
      allowed = previousAllowed
      // A boot-time refresh failure stores an error-shaped snapshot without a
      // selection; re-derive from the restored config instead of crashing here.
      if (previousModelState?.selection) setModelState(previousModelState)
      else { try { await refreshModelState() } catch {} }
      try {
        await startBridge()
      } catch (rollbackError) {
        const original = error instanceof Error ? error.message : String(error)
        const rollback = rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
        throw new Error(`飞书配置启动失败且旧配置恢复失败：${original}；回滚：${rollback}`)
      }
      throw error
    }
  }

  function enqueueConfigUpdate(patch) {
    if (closing) return Promise.reject(new Error('飞书插件正在关闭'))
    reconfigurationRequests += 1
    reconfiguring = true
    const operation = updateChain.then(
      () => performConfigUpdate(patch),
      () => performConfigUpdate(patch),
    )
    updateChain = operation.catch(() => {})
    return operation.finally(() => {
      reconfigurationRequests -= 1
      reconfiguring = reconfigurationRequests > 0
    })
  }

  const runtime = {
    panelConfig: () => store.panel(),
    status: async () => {
      try { await refreshModelState() } catch {}
      return statusSnapshot()
    },
    modelOptions: async () => {
      let effective = null
      let currentError = ''
      try { effective = await refreshModelState() }
      catch (error) {
        currentError = error instanceof Error ? error.message : String(error)
        const followDefault = !customModelConfigured(resolved)
        let base = null
        try { base = followDefault ? defaultSelectionOf() : { provider: resolved.provider, model: resolved.model } } catch {}
        if (base?.provider && base?.model) {
          let modelInfo = {}
          try { modelInfo = await modelInfoOf(base) } catch {}
          effective = {
            selection: {
              provider: base.provider,
              model: base.model,
              ...((resolved.reasoningEffort || (followDefault ? base.reasoningEffort : '')) ? { reasoningEffort: resolved.reasoningEffort || base.reasoningEffort } : {}),
            },
            modelInfo,
            followDefault,
            agentPreset: resolved.agentPreset,
          }
        }
      }
      const providers = typeof ctx.llm?.listProviders === 'function' ? await ctx.llm.listProviders() : []
      const models = []
      const modelLists = await Promise.all(providers.map(async (provider) => {
        const providerId = String(provider.id ?? provider.provider ?? '').trim()
        if (providerId === '' || typeof ctx.llm?.listModels !== 'function') return []
        let listed = []
        try { listed = await ctx.llm.listModels(providerId) }
        catch (error) { warn('cannot list models for ' + providerId + ': ' + (error instanceof Error ? error.message : String(error))); return [] }
        return Promise.all(listed.map(async (item) => {
          const model = String(item.id ?? item.model ?? '').trim()
          if (model === '') return null
          let info = item
          try { info = await ctx.llm.resolveModelInfo(providerId, model) } catch {}
          return {
            provider: providerId,
            model,
            name: String(info.name ?? item.name ?? model),
            reasoningEfforts: reasoningEffortsOf(info),
            ...(info.reasoning?.defaultEffort === undefined ? {} : { defaultReasoningEffort: String(info.reasoning.defaultEffort) }),
          }
        }))
      }))
      models.push(...modelLists.flat().filter(Boolean))
      if (effective !== null && !models.some((item) => item.provider === effective.selection.provider && item.model === effective.selection.model)) {
        models.push({
          provider: effective.selection.provider,
          model: effective.selection.model,
          name: String(effective.modelInfo?.name ?? effective.selection.model),
          reasoningEfforts: reasoningEffortsOf(effective.modelInfo),
          ...(effective.modelInfo?.reasoning?.defaultEffort === undefined ? {} : { defaultReasoningEffort: String(effective.modelInfo.reasoning.defaultEffort) }),
        })
      }
      const presets = typeof ctx.agentPresets?.list === 'function' ? await ctx.agentPresets.list() : [{ id: DEFAULT_AGENT_PRESET, name: DEFAULT_AGENT_PRESET }]
      return {
        current: {
          provider: effective?.selection.provider ?? modelState.provider,
          model: effective?.selection.model ?? modelState.model,
          reasoningEffort: effective?.selection.reasoningEffort ?? modelState.reasoningEffort,
          agentPreset: effective?.agentPreset ?? modelState.agentPreset,
          followDefault: effective?.followDefault ?? modelState.followDefault,
          ...(currentError === '' ? {} : { error: currentError }),
        },
        providers: providers.map((provider) => ({ provider: String(provider.id ?? provider.provider), name: String(provider.name ?? provider.id ?? provider.provider) })),
        models,
        presets: presets.map((preset) => ({ id: String(preset.id), name: String(preset.name ?? preset.id), ...(preset.description === undefined ? {} : { description: String(preset.description) }), ...(preset.broken === undefined ? {} : { broken: String(preset.broken) }) })),
      }
    },
    updateConfig: enqueueConfigUpdate,
    testConnection: async (patch = {}) => {
      const current = store.get()
      const candidate = normalizeConfig({ ...current, ...patch, appSecret: String(patch.appSecret ?? '') || current.appSecret })
      if (candidate.appId === '' || candidate.appSecret === '') throw new Error('App ID 和 App Secret 必填')
      const response = await fetch(candidate.domain + '/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app_id: candidate.appId, app_secret: candidate.appSecret }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || (body.code !== undefined && Number(body.code) !== 0) || typeof body.tenant_access_token !== 'string') {
        throw new Error(String(body.msg ?? body.message ?? ('HTTP ' + response.status)))
      }
      return { ok: true, appId: candidate.appId }
    },
  }

  const disposers = []
  if (ctx.webServer?.register !== undefined) disposers.push(...makeRoutes(runtime).map((route) => ctx.webServer.register(route)))

  const registerOutboundTool = (definition) => {
    try {
      const disposer = ctx.tools?.register?.(definition)
      if (typeof disposer === 'function') disposers.push(disposer)
    } catch (error) {
      warn('failed to register Feishu outbound tool ' + definition.name + ': ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  const outboundRoots = () => [...new Set([
    resolved.cwd,
    ...Object.values(resolved.chatCwds ?? {}),
    resolved.mediaDir,
  ].map((value) => String(value ?? '').trim()).filter((value) => value !== ''))]
  const pickTargetConversation = (chatIdArg) => {
    const requested = String(chatIdArg ?? '').trim()
    if (requested !== '') return conversations.get(requested) ?? null
    const entries = [...conversations.values()]
    if (entries.length === 0) return null
    return entries.find((entry) => entry.agent.status === 'running') ?? entries[entries.length - 1]
  }
  try { disposers.push(ctx.on('session/event', (session, event) => { void tracker.observeSessionEvent(session, event) })) } catch {}
  try { disposers.push(ctx.on('session/event', (session, event) => { void completionNotifier.observe(session, event) })) } catch {}
  // 飞书答题器挂上宿主 user-questions waterfall：飞书会话由卡片认领，其余放行。
  // 注册失败绝不静默：0.38.4 的教训是 try/catch 空吞让整条链路无声失效，
  // 这里失败要同时进 ctx 日志与答题器落盘日志，认领全 miss 时可据此归因。
  // prepend 必须保留：内置 api-remotes 在宿主启动时就注册了同一事件的转发监听
  // （排在一切后装插件之前），而 Web 面板答题器对"认识会话"的问题一律认领且
  // 无人转交——普通挂载会让飞书答题器永远轮空（0.41.0 实锤：认领日志三天零
  // 记录、四次真实提问全部 ASK_ABORTED，手机收不到卡片）。插队到队首后飞书
  // 会话先被卡片认领，非飞书会话照常 next() 放行给面板，行为不变。
  try {
    disposers.push(ctx.on('user-questions/request', (request, next) => questionAnswerer.answer(request, next), { prepend: true }))
    questionAnswerer.log('info', 'waterfall listener registered (prepend): user-questions/request')
  } catch (error) {
    warn('user-questions/request 监听注册失败，问题卡片将无法认领：' + (error instanceof Error ? error.message : String(error)))
    questionAnswerer.log('warn', 'waterfall listener register FAILED: ' + (error instanceof Error ? error.message : String(error)))
  }
  try { disposers.push(ctx.on('agent/error', (payload) => { void tracker.observeAgentError(payload) })) } catch {}
  try {
    disposers.push(ctx.on('agent/disposed', (payload) => {
      const agent = payload?.agent ?? payload
      const sid = String(agent?.id ?? agent?.session?.id ?? '')
      for (const [chatId, entry] of conversations) if (entry.agent.id === sid) conversations.delete(chatId)
      questionAnswerer.forgetAgent(sid)
      void tracker.observeAgentDisposed(sid)
      void completionNotifier.observeAgentDisposed(agent?.session ?? sid)
    }))
  } catch {}

  void startBridge().catch(() => {})
  info('enabled; each Feishu chat uses an independent DSH agent/session')
  const dispose = async () => {
    closing = true
    reconfiguring = true
    configurationRevision += 1
    for (const disposer of disposers) { try { disposer?.() } catch {} }
    await Promise.allSettled([updateChain])
    await drainCreating()
    await stopBridgeAndSessions()
  }
  if (typeof ctx.effect === 'function') ctx.effect(() => dispose)
  else return dispose
}
