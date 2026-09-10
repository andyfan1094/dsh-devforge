/** 上游 JSON 客户端兼容层：规避宿主全局 dispatcher 与 Node 内置 fetch 跨 undici 版本互操作时 gzip 正文不解压的问题。 */
import { gunzipSync, inflateSync } from 'node:zlib'

/**
 * 组装上游请求头：默认要求未压缩正文。
 *
 * 背景（0.29.5 修复）：宿主 dsh-http-proxy 会把 npm undici v8 的 ProxyAgent 安装为全局 dispatcher，
 * 而 Node 内置 fetch 使用自带的另一份 undici——跨版本互作用时，经代理路径返回的压缩响应会丢失
 * 响应头且正文保持 gzip 原始字节（暂存实测 10/10 复现），导致智谱监控、火山方舟用量等
 * 「上游按需 gzip」的 JSON 接口稳定解析失败；小响应不压缩所以时好时坏。
 * 显式声明 accept-encoding: identity 从源头规避；调用方显式传入同名头时以调用方为准。
 */
export function upstreamRequestHeaders(extra?: Record<string, string>): Record<string, string> {
  return { 'accept-encoding': 'identity', ...extra }
}

/** 识别并解开正文中的 gzip/zlib 压缩字节；普通文本原样返回。 */
export function decodeUpstreamBody(raw: Buffer): string {
  if (raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b) {
    try { return gunzipSync(raw).toString('utf8') } catch { /* 魔数命中但解压失败，按原文交给上层报错 */ }
  }
  if (raw.length >= 2 && raw[0] === 0x78) {
    try { return inflateSync(raw).toString('utf8') } catch { /* 同上 */ }
  }
  return raw.toString('utf8')
}

/** 读取响应正文并做压缩兜底解压（response.text() 的兼容版）。 */
export async function upstreamResponseText(response: Response): Promise<string> {
  return decodeUpstreamBody(Buffer.from(await response.arrayBuffer()))
}
