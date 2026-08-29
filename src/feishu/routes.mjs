// Vendored from dsh-feishu 0.2.2 (MIT, andyfan1094/dsh-feishu).
// dsh-devforge consolidation modification: module folded into dsh-devforge;
// runtime behavior preserved. See THIRD_PARTY_NOTICES.md.
const BASE = '/api/dsh-feishu'
const MAX_BODY = 128 * 1024

function writeJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  })
  res.end(JSON.stringify(body))
}

export function isLoopback(req) {
  const address = req.socket.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

async function readJson(req) {
  const parts = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.byteLength
    if (size > MAX_BODY) return undefined
    parts.push(chunk)
  }
  try {
    const value = JSON.parse(Buffer.concat(parts).toString('utf8'))
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

function message(error) {
  return error instanceof Error ? error.message : String(error)
}

function guarded(req, res, method) {
  if (!isLoopback(req)) { writeJson(res, 403, { error: 'forbidden: loopback-only' }); return false }
  if (req.method !== method) { writeJson(res, 405, { error: 'method not allowed: ' + req.method }); return false }
  return true
}

export function makeRoutes(runtime) {
  const config = {
    kind: 'exact',
    path: BASE + '/config',
    handler: async (req, res) => {
      if (!isLoopback(req)) { writeJson(res, 403, { error: 'forbidden: loopback-only' }); return }
      if (req.method === 'GET') { writeJson(res, 200, { config: runtime.panelConfig() }); return }
      if (req.method !== 'PATCH') { writeJson(res, 405, { error: 'method not allowed: ' + req.method }); return }
      const body = await readJson(req)
      if (body === undefined) { writeJson(res, 400, { error: 'invalid JSON body' }); return }
      try { writeJson(res, 200, { config: await runtime.updateConfig(body), status: await runtime.status() }) }
      catch (error) { writeJson(res, 400, { error: message(error) }) }
    },
  }
  const models = {
    kind: 'exact',
    path: BASE + '/models',
    handler: async (req, res) => {
      if (!guarded(req, res, 'GET')) return
      try { writeJson(res, 200, await runtime.modelOptions()) }
      catch (error) { writeJson(res, 400, { error: message(error) }) }
    },
  }
  const status = {
    kind: 'exact',
    path: BASE + '/status',
    handler: async (req, res) => {
      if (!guarded(req, res, 'GET')) return
      writeJson(res, 200, { status: await runtime.status() })
    },
  }
  const test = {
    kind: 'exact',
    path: BASE + '/test',
    handler: async (req, res) => {
      if (!guarded(req, res, 'POST')) return
      const body = await readJson(req) ?? {}
      try { writeJson(res, 200, { result: await runtime.testConnection(body) }) }
      catch (error) { writeJson(res, 400, { error: message(error) }) }
    },
  }
  return [config, models, status, test]
}

export const FEISHU_API_BASE = BASE
