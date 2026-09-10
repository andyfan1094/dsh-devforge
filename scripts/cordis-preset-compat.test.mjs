/** 预设兼容模块行为验证：使用独立注册表，不连接生产或调用模型。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPresetCordisModule, SUPPORTED_VERSION } from './cordis-preset-compat.mjs';

const packagePath = process.env.DSH_CORDIS_PACKAGE;
assert.ok(packagePath, '必须指定 DSH_CORDIS_PACKAGE，禁止隐式选取其他版本');
const requireUpstream = createRequire(packagePath);
const source = await readFile(join(dirname(packagePath), 'lib/index.js'), 'utf8');
const metadata = JSON.parse(await readFile(packagePath, 'utf8'));
const resolveImport = name => pathToFileURL(requireUpstream.resolve(name)).href;
const options = { version: metadata.version, presetId: 'cordis-250k', resolveImport };
const native = await import(pathToFileURL(join(dirname(packagePath), 'lib/index.js')).href);
const compat = await import('data:text/javascript;base64,' + Buffer.from(buildPresetCordisModule(source, options)).toString('base64'));
const { Context } = await import(resolveImport('@deepseek-ai/cordis'));
const { CordisInspectRegistryService } = await import(resolveImport('@deepseek-ai/dsh-cordis-host-runner'));
const kinds = ['Service', 'Event', 'Builtin', 'Tool'];
const methods = ['listService', 'listEvents', 'listBuiltins', 'listTools'];

/** 每个用例独占真正的 Cordis 注册表，避免测试相互共享生命周期。 */
function createRegistry(t) {
  const root = new Context();
  const registry = new CordisInspectRegistryService(root);
  t.after(() => root.fiber.dispose());
  return registry;
}

/** 仅模拟外围工具存储；接口注册、输入验证、分发及 Client 回包使用真实实现。 */
function mount(module, registry, runner = {}) {
  const definitions = new Map();
  const sections = [];
  const listeners = new Map();
  const disposers = [];
  const ctx = {
    cordisInspect: registry,
    dynamicCordisRunner: runner,
    systemPrompt: {
      getSectionOrder: () => 42,
      section: section => { sections.push(section); },
    },
    tools: {
      register: definition => { definitions.set(definition.name, definition); },
      schemas: agent => [{ name: 'tool-for-' + agent.id, parameters: {} }],
    },
    effect: callback => { const dispose = callback(); disposers.push(dispose); return dispose; },
    on: (name, callback) => { listeners.set(name, callback); },
  };
  const dispose = () => {
    for (const disposer of disposers.splice(0).reverse()) disposer();
    definitions.clear();
    sections.length = 0;
    listeners.clear();
  };
  try { module.apply(ctx); } catch (error) { dispose(); throw error; }
  return { definitions, sections, listeners, dispose };
}

/** 查询始终携带实际调用方标识，专门检测是否误用挂载方作用域。 */
function query(registry, provider, index, id = 'agent-a') {
  return registry.query('host', provider, methods[index], undefined, { id }, new AbortController().signal);
}

/** 副本接口按挂载代随机命名，精确 id 必须从注册表现查。 */
function compatProviders(registry, index) {
  const suffix = '/' + kinds[index];
  return registry.list().map(item => item.id).filter(id => id.startsWith('cordis-250k/') && id.endsWith(suffix));
}

function compatProvider(registry, index) {
  const matches = compatProviders(registry, index);
  assert.equal(matches.length, 1, '副本应恰好注册一个 ' + kinds[index]);
  return matches[0];
}

for (const reverse of [false, true]) {
  test(reverse ? '先挂载副本再挂载原版，两组接口均可查询' : '先挂载原版再挂载副本，两组接口均可查询', async t => {
    const registry = createRegistry(t);
    const modules = reverse ? [compat, native] : [native, compat];
    const mounts = modules.map(module => mount(module, registry));
    t.after(() => mounts.forEach(item => item.dispose()));
    assert.equal(registry.list().length, 8);
    for (let index = 0; index < kinds.length; index++) {
      assert.deepEqual(await query(registry, compatProvider(registry, index), index), await query(registry, kinds[index], index));
    }
  });
}

test('仅副本冷加载时，四个接口及调用方工具作用域均完整', async t => {
  const registry = createRegistry(t);
  const mounted = mount(compat, registry);
  t.after(mounted.dispose);
  for (let index = 0; index < kinds.length; index++) assert.ok(await query(registry, compatProvider(registry, index), index));
  assert.deepEqual(await query(registry, compatProvider(registry, 3), 3, '甲'), { tools: [{ name: 'tool-for-甲', parameters: {} }] });
  assert.deepEqual(await query(registry, compatProvider(registry, 3), 3, '乙'), { tools: [{ name: 'tool-for-乙', parameters: {} }] });
});

for (const removeNative of [true, false]) {
  test(removeNative ? '卸载原版后副本接口继续工作' : '卸载副本后原版接口继续工作', async t => {
    const registry = createRegistry(t);
    const original = mount(native, registry);
    const copied = mount(compat, registry);
    t.after(() => { original.dispose(); copied.dispose(); });
    (removeNative ? original : copied).dispose();
    assert.equal(registry.list().length, 4);
    for (let index = 0; index < kinds.length; index++) {
      assert.ok(await query(registry, removeNative ? compatProvider(registry, index) : kinds[index], index));
    }
  });
}

test('同预设两代并发挂载互不冲突，卸载一代不影响另一代', async t => {
  const registry = createRegistry(t);
  const first = mount(compat, registry);
  const second = mount(compat, registry);
  t.after(() => { first.dispose(); second.dispose(); });
  assert.equal(registry.list().length, 8);
  for (let index = 0; index < kinds.length; index++) {
    const ids = compatProviders(registry, index);
    assert.equal(ids.length, 2, '两代各自注册一个 ' + kinds[index]);
    assert.deepEqual(await query(registry, ids[0], index), await query(registry, ids[1], index));
  }
  first.dispose();
  assert.equal(registry.list().length, 4);
  for (let index = 0; index < kinds.length; index++) assert.ok(await query(registry, compatProvider(registry, index), index));
});

test('注册表仍拒绝重复 id，首次注册不受失败回滚影响', async t => {
  const registry = createRegistry(t);
  const mounted = mount(compat, registry);
  t.after(mounted.dispose);
  const forged = { id: compatProvider(registry, 0), description: '伪造接口', methods: [{ name: 'listService', description: '查询服务', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, outputSchema: { description: 'JSON data' } }] };
  assert.throws(() => registry.register({ manifest: forged, query: async () => ({}) }), /already registered/);
  assert.equal(registry.list().length, 4);
  assert.ok(await query(registry, compatProvider(registry, 0), 0));
});

test('所有工具名称、参数、输出结构、描述和系统提示词与原版严格一致', t => {
  const registry = createRegistry(t);
  const original = mount(native, registry);
  const copied = mount(compat, registry);
  t.after(() => { original.dispose(); copied.dispose(); });
  assert.deepEqual([...copied.definitions.keys()], [...original.definitions.keys()]);
  assert.equal(copied.definitions.size, 7);
  for (const [name, definition] of original.definitions) {
    const candidate = copied.definitions.get(name);
    assert.deepEqual(candidate.parameters, definition.parameters, name + '参数必须一致');
    assert.deepEqual(candidate.output.schema, definition.output.schema, name + '输出必须一致');
    assert.equal(candidate.description, definition.description, name + '描述必须一致');
  }
  assert.deepEqual(copied.sections, original.sections);
  assert.deepEqual([...copied.listeners.keys()], [...original.listeners.keys()]);
  assert.deepEqual(compat.inject, native.inject);
});

test('定义、启动和停止工具完整转发会话身份、源码、模式及取消信号', async t => {
  const registry = createRegistry(t);
  const calls = [];
  const runner = {
    define: request => { calls.push(['define', request]); return { pluginId: 'demo-1', packageId: 'pkg-1', name: request.name, purpose: request.purpose, hasHostHalf: true, hasClientHalf: true }; },
    run: (...args) => { calls.push(['run', ...args]); return { ok: true, status: 'starting', pluginRunId: 'run-1', mode: args[3], nextPackageId: 'pkg-1' }; },
    stop: (...args) => { calls.push(['stop', ...args]); return { ok: true }; },
  };
  const mounted = mount(compat, registry, runner);
  t.after(mounted.dispose);
  const agent = { id: '隔离会话' };
  const signal = new AbortController().signal;
  const exec = { agent, signal };
  const args = { plugin: { kind: 'new', idPrefix: 'demo' }, name: '验证', purpose: '转发验证', code: { host: 'return {}', client: 'return {}' } };
  assert.equal((await mounted.definitions.get('cordis_define').execute(args, exec)).pluginId, 'demo-1');
  assert.deepEqual(calls[0], ['define', { sessionId: agent.id, ...args }]);
  assert.equal((await mounted.definitions.get('cordis_run').execute({ pluginId: 'demo-1', packageId: 'pkg-1', mode: 'update' }, exec)).status, 'starting');
  assert.deepEqual(calls[1], ['run', agent, 'demo-1', 'pkg-1', 'update', signal]);
  assert.deepEqual(await mounted.definitions.get('cordis_stop').execute({ pluginId: 'demo-1' }, exec), { pluginId: 'demo-1' });
  assert.deepEqual(calls[2], ['stop', agent, 'demo-1']);
});

test('前缀副本的 Client 查询保持原名称、参数及真实回包路径', async t => {
  const registry = createRegistry(t);
  const mounted = mount(compat, registry);
  t.after(mounted.dispose);
  const agent = { id: 'client-agent' };
  const signal = new AbortController().signal;
  const input = { service: 'slots' };
  registry.syncClientManifest([{ id: 'Service', description: '客户端服务', methods: [{ name: 'listService', description: '查询服务', inputSchema: { type: 'object', properties: { service: { type: 'string' } }, additionalProperties: false }, outputSchema: { type: 'object', properties: { result: { type: 'string' } }, required: ['result'] } }] }]);
  let request;
  registry.ctx.on('cordis/inspect-query', value => {
    request = value;
    registry.resolveClientQuery(agent, value.requestId, { ok: true, data: { result: 'client-ok' } });
  });
  const result = await mounted.definitions.get('cordis_inspect_query').execute({ platform: 'client', provider: 'Service', method: 'listService', input }, { agent, signal });
  assert.deepEqual(result, { platform: 'client', provider: 'Service', method: 'listService', data: { result: 'client-ok' } });
  assert.equal(request.agentId, agent.id);
  assert.equal(request.provider, 'Service');
  assert.deepEqual(request.input, input);
});

test('版本、哈希、预设标识或依赖解析异常时立即拒绝生成', () => {
  assert.equal(metadata.version, SUPPORTED_VERSION);
  assert.throws(() => buildPresetCordisModule(source, { ...options, version: '未知版本' }), /版本未审查/);
  assert.throws(() => buildPresetCordisModule(source + '\n', options), /哈希不符/);
  for (const presetId of ['', '../cordis', 'Cordis', 'cordis/250k']) {
    assert.throws(() => buildPresetCordisModule(source, { ...options, presetId }), /预设标识不合法/);
  }
  assert.throws(() => buildPresetCordisModule(source, { ...options, resolveImport: () => 'https://example.invalid/module.js' }), /依赖必须/);
  assert.throws(() => buildPresetCordisModule(source, { ...options, resolveImport: () => { throw new Error('解析失败'); } }), /解析失败/);
});
