// Vendored from dsh-feishu 0.2.2 (MIT, andyfan1094/dsh-feishu).
// dsh-devforge consolidation modification: module folded into dsh-devforge;
// runtime behavior preserved. See THIRD_PARTY_NOTICES.md.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, extname, resolve as resolvePath } from 'node:path'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { createFeishuClient, buildImagePrompt } from './feishu-client.mjs'
import { allowedPathOf, sendFile, sendImage } from './outbound.mjs'
import { buildUserMessage, createReplyTracker } from './reply-tracker.mjs'
import { createCompletionNotifier } from './completion-notifier.mjs'
import { FeishuStore } from './store.mjs'
import { makeRoutes } from './routes.mjs'

export const name = 'dsh-feishu'
export const inject = ['agents', 'agentDefaultModel', 'llm', 'agentPresets', 'webServer', 'workspaceRegistry', 'sessionPersistence', 'sessionTitle', 'attachments']

const DEFAULT_AGENT_PRESET = 'cordis'

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

function selectionIdentity(selection, agentPreset, cwd) {
  return JSON.stringify({
    provider: selection.provider,
    model: selection.model,
    reasoningEffort: selection.reasoningEffort ?? '',
    agentPreset,
    cwd,
  })
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
  const send = async (chatId, text) => bridge === null ? false : bridge.sendText(chatId, text)
  const createStream = async (chatId, options) => bridge === null ? null : bridge.createStreamingCard?.(chatId, options)
  const tracker = createReplyTracker({ sendText: send, createStream, warn })
  const completionNotifier = createCompletionNotifier({ getConfig: () => store.panel(), getClient: () => bridge?.getClient?.() ?? null, warn })

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

  async function createHandle(sessionId, effective, mode, expectedCwd) {
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
    return mode === 'resume' ? ctx.agents.resume(options) : ctx.agents.create(options)
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
      const identity = selectionIdentity(effective.selection, effective.agentPreset, chatCwd)
      let sessionId = stableSessionIdOf(key, identity)
      const archivedSessionIds = archivedSessionIdsOf()
      const existing = conversations.get(key)
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
      let persistedIds = new Set()
      let hasPersistedListing = false
      try {
        const headers = await ctx.sessionPersistence?.list?.()
        if (Array.isArray(headers)) {
          hasPersistedListing = true
          persistedIds = new Set(headers.map((header) => String(header?.id ?? '').trim()).filter(Boolean))
        }
      } catch {}
      const runtimeCollisionIds = Array.from({ length: 64 }, (_, index) => {
        const suffix = index === 0 ? ':runtime-collision' : ':runtime-collision-' + (index + 1)
        return stableSessionIdOf(key, identity + suffix)
      })
      const metadataMigratedId = stableSessionIdOf(key, identity + ':metadata-migrated')
      const metadataRebuiltId = stableSessionIdOf(key, identity + ':metadata-rebuilt')
      const allSessionCandidates = [...new Set([sessionId, ...runtimeCollisionIds, metadataMigratedId, metadataRebuiltId])]
      const resumeCandidates = allSessionCandidates.filter((candidateId) => !archivedSessionIds.has(candidateId) && (!hasPersistedListing || persistedIds.has(candidateId)))
      if (typeof ctx.agents.resume === 'function') {
        for (const candidateId of resumeCandidates) {
          try {
            handle = await createHandle(candidateId, effective, 'resume', chatCwd)
            sessionId = candidateId
            resumedExisting = true
            info('resumed independent Feishu session ' + sessionId)
            break
          } catch (error) {
            if (sessionNotFoundError(error)) continue
            if (error?.code === 'FEISHU_SESSION_METADATA_MISMATCH') {
              if (candidateId === metadataRebuiltId) {
                const migrationError = new Error('飞书迁移会话元数据仍不一致，请检查持久化会话')
                migrationError.code = 'FEISHU_MIGRATION_METADATA_INCONSISTENT'
                throw migrationError
              }
              createSessionId = candidateId === metadataMigratedId ? metadataRebuiltId : metadataMigratedId
              info('migrating Feishu session metadata to ' + createSessionId)
            }
          }
        }
      }
      if (handle === null) sessionId = createSessionId
      if (handle === null) {
        const createCandidates = allSessionCandidates.filter((candidateId) => !archivedSessionIds.has(candidateId) && (!hasPersistedListing || !persistedIds.has(candidateId)))
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
      const entry = { chatId: key, sessionId, workspaceId, identity, agent: handle.agent, handle, selection: effective.selection, agentPreset: effective.agentPreset, createdAt: Date.now(), created: !existingMatch && !resumedExisting }
      conversations.set(key, entry)
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

  const handleCommand = async (envelope) => {
    const command = String(envelope.text.slice(1).trim().split(/\s+/)[0] ?? '').toLowerCase()
    if (command === 'whoami') return '飞书身份：' + envelope.userId
    if (command === 'help') return '直接发消息即可进入独立飞书会话；回答进行中再发消息会直接插入当前任务继续处理；/status 查看本飞书会话；/stop 停止本会话任务（排队中的消息一并取消）；生成文件或图片后可直接让 Agent 调用 dsh_feishu_send_file / dsh_feishu_send_image 发给你。'
    if (command === 'status') {
      try { await refreshModelState() } catch {}
      return statusText(envelope.chatId)
    }
    if (command === 'stop') {
      const entry = conversations.get(String(envelope.chatId ?? '').trim())
      if (entry === undefined) return '当前还没有独立飞书会话。'
      try {
        const running = entry.agent.status === 'running'
        entry.agent.cancel('feishu-stop')
        void tracker.cancelAgent(entry.agent.id, entry.agent.session)
        return running ? '已停止当前独立飞书会话的任务。' : '当前没有正在运行的飞书任务。'
      }
      catch { return '停止失败，请稍后重试。' }
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
      entry.agent.cancel('feishu-card-stop')
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
        entry.agent.followup(buildUserMessage(envelope.text))
        await send(envelope.chatId, '已收到修改后的内容，正在重新处理。')
      } catch (error) {
        warn('failed to deliver edited Feishu message: ' + (error instanceof Error ? error.message : String(error)))
      }
      return
    }
    if (envelope.text.startsWith('/')) {
      const reply = await handleCommand(envelope)
      if (reply !== null) await send(envelope.chatId, reply)
      return
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
      const payload = buildUserMessage(promptText, imageRefs)
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
    const currentBridge = bridge
    bridge = null
    const handles = [...conversations.values()].map((entry) => entry.handle)
    conversations.clear()
    await Promise.allSettled([
      Promise.resolve().then(() => currentBridge?.stop?.()),
      ...handles.map((handle) => handle.dispose()),
    ])
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
  try { disposers.push(ctx.on('agent/error', (payload) => { void tracker.observeAgentError(payload) })) } catch {}
  try {
    disposers.push(ctx.on('agent/disposed', (payload) => {
      const agent = payload?.agent ?? payload
      const sid = String(agent?.id ?? agent?.session?.id ?? '')
      for (const [chatId, entry] of conversations) if (entry.agent.id === sid) conversations.delete(chatId)
      void tracker.observeAgentDisposed(sid)
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
