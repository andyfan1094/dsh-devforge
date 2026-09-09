/**
 * 为自定义创造模式生成预设内的兼容模块，不修改已安装宿主。
 * 仅给本模块的四个 Host 检查接口加预设前缀，保留工具与 Client 通道。
 */
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, realpath, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SUPPORTED_VERSION = '0.1.2-rc.1';
export const SUPPORTED_SHA256 = '39faeb632c9e16b2b25e3825cec5f9eda24adfb6ff784bde1b05534eb3e32de9';
const REGISTRATION = 'for (const provider of hostInspectProviders(ctx)) ctx.effect(() => ctx.cordisInspect.register(provider), `tool-cordis: inspect ${provider.manifest.id}`);';
const IMPORTS = [
  '@deepseek-ai/dsh-cordis-host-runner',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-tools',
];

/**
 * 校验已审查的上游产物并生成独立接口名；依赖解析由调用方提供。
 * @param {string} source 上游完整模块源码。
 * @param {{version:string,presetId:string,resolveImport:(name:string)=>string}} options 版本、预设标识和依赖 URL 解析函数。
 * @returns {string} 仅修改注册边界和导入地址的模块源码。
 */
export function buildPresetCordisModule(source, options) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(options.presetId)) throw new Error('预设标识不合法');
  if (options.version !== SUPPORTED_VERSION) throw new Error('上游版本未审查，停止生成');
  const hash = createHash('sha256').update(source).digest('hex');
  if (hash !== SUPPORTED_SHA256) throw new Error('上游源码哈希不符，停止生成');
  if (source.split(REGISTRATION).length !== 2) throw new Error('上游注册边界不唯一');
  const prefix = JSON.stringify(`${options.presetId}/`);
  let result = source.replace(REGISTRATION, `for (const provider of hostInspectProviders(ctx)) {
    // 每个预设拥有独立注册，卸载只释放自身接口，不接管其他预设的生命周期。
    const registration = { ...provider, manifest: { ...provider.manifest, id: ${prefix} + provider.manifest.id } };
    ctx.effect(() => ctx.cordisInspect.register(registration), \`tool-cordis: inspect \${registration.manifest.id}\`);
  }`);
  for (const name of IMPORTS) {
    const needle = `from ${JSON.stringify(name)};`;
    if (result.split(needle).length !== 2) throw new Error(`上游导入边界不唯一：${name}`);
    const url = options.resolveImport(name);
    if (!url.startsWith('file:')) throw new Error('依赖必须指向同一宿主的本机已安装模块');
    result = result.replace(needle, `from ${JSON.stringify(url)};`);
  }
  return `// 本机生成的预设兼容产物；来源 @deepseek-ai/dsh-tool-cordis ${SUPPORTED_VERSION}，MIT 许可证见 LICENSE.cordis-tool。\n// 上游 SHA-256：${SUPPORTED_SHA256}。升级 DSH 后须重新校验生成。\n${result}`;
}

/**
 * 生成兼容模块和来源记录；目标只允许是用户自定义预设目录。
 * @param {{upstreamPackageJson:string,presetDir:string,presetId:string}} options 已安装上游包和目标预设。
 * @returns {Promise<{modulePath:string,metadataPath:string}>} 生成文件路径。
 */
export async function generatePresetCordisModule(options) {
  const upstream = await realpath(options.upstreamPackageJson);
  const presetDir = resolve(options.presetDir);
  const compositionPath = join(presetDir, 'agent.cordis.yml');
  // 必须先由官方预设 copy 服务创建副本；生成器不能新造或修改内置预设。
  if (!presetDir.includes('/.agent-presets/') || presetDir.split('/').at(-1) !== options.presetId) {
    throw new Error('目标必须是与预设标识一致的用户预设目录');
  }
  await readFile(compositionPath, 'utf8');
  const packageJson = JSON.parse(await readFile(upstream, 'utf8'));
  if (packageJson.name !== '@deepseek-ai/dsh-tool-cordis') throw new Error('上游包名称不符');
  const source = await readFile(join(dirname(upstream), 'lib/index.js'), 'utf8');
  const require = createRequire(upstream);
  const dependencies = {};
  for (const name of IMPORTS) dependencies[name] = pathToFileURL(await realpath(require.resolve(name))).href;
  const output = buildPresetCordisModule(source, {
    version: packageJson.version,
    presetId: options.presetId,
    resolveImport: name => dependencies[name],
  });
  const modulePath = join(presetDir, 'cordis-tools.compat.mjs');
  const metadataPath = join(presetDir, 'cordis-tools.provenance.json');
  // 不覆盖已有产物；重新生成应采用新预设并重新执行加载验证。
  await mkdir(presetDir, { recursive: true });
  const license = await readFile(join(dirname(upstream), 'LICENSE'));
  const metadata = JSON.stringify({
    presetId: options.presetId,
    upstreamPackage: packageJson.name,
    upstreamVersion: packageJson.version,
    upstreamSha256: SUPPORTED_SHA256,
    generatedSha256: createHash('sha256').update(output).digest('hex'),
    dependencies,
  }, null, 2) + '\n';
  const created = [];
  try {
    // 模块最后落盘；发生冲突时只移除本次成功创建的文件，保留既有文件。
    for (const [path, content] of [[join(presetDir, 'LICENSE.cordis-tool'), license], [metadataPath, metadata], [modulePath, output]]) {
      await writeFile(path, content, { flag: 'wx' });
      created.push(path);
    }
  } catch (error) {
    await Promise.all(created.map(path => unlink(path)));
    throw error;
  }
  return { modulePath, metadataPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [upstreamPackageJson, presetDir, presetId] = process.argv.slice(2);
  if (!upstreamPackageJson || !presetDir || !presetId) throw new Error('用法：node scripts/cordis-preset-compat.mjs 上游package.json 用户预设目录 预设ID');
  console.log(JSON.stringify(await generatePresetCordisModule({ upstreamPackageJson, presetDir, presetId })));
}
