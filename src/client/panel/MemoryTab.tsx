/**
 * 记忆工作台页签 —— 会话记忆（自动沉淀+主动注入）状态、设置、条目管理与镜像/项目索引。
 * 布局：状态条 → 设置行 → 双栏（左记忆条目表，右项目索引+镜像同步）。
 */
import { useCallback, useEffect, useState } from 'react'
import { MEMORY_API, type MemorySettings, type MemoryStatus, type MirrorSyncResult, type ProjectIndexResult } from '../../memory/protocol.ts'
import type { RagDocument } from '../../rag/protocol.ts'
import css from './panel.module.css'

/** 同源 JSON 请求。 */
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json' } })
  const body = (await response.json()) as { ok?: boolean; error?: string }
  if (!response.ok || body?.ok === false) throw new Error(body?.error ?? ('HTTP ' + response.status))
  return body as T
}

const card = { border: '1px solid rgba(128,128,128,0.3)', borderRadius: 8, padding: '8px 10px', minWidth: 0 } as const
const cardTitle = { fontSize: 12, fontWeight: 600, opacity: 0.85, margin: '0 0 6px' } as const
const row = { display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' } as const

export function MemoryTab(): JSX.Element {
  const [status, setStatus] = useState<MemoryStatus | null>(null)
  const [settings, setSettings] = useState<MemorySettings | null>(null)
  const [docs, setDocs] = useState<RagDocument[]>([])
  const [projectPath, setProjectPath] = useState('')
  const [report, setReport] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const reload = useCallback(async () => {
    try {
      const [statusData, settingsData] = await Promise.all([
        api<{ status: MemoryStatus }>(MEMORY_API.status),
        api<{ settings: MemorySettings }>(MEMORY_API.settings),
      ])
      setStatus(statusData.status)
      setSettings(settingsData.settings)
      if (statusData.status.memoryKbId !== '') {
        const docsData = await api<{ docs: RagDocument[] }>(MEMORY_API.memories)
        setDocs(docsData.docs)
      } else setDocs([])
    } catch (error) { setMessage('加载失败：' + (error instanceof Error ? error.message : String(error))) }
  }, [])

  useEffect(() => { void reload() }, [reload])

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setMessage('')
    try { await fn() }
    catch (error) { setMessage('❌ ' + (error instanceof Error ? error.message : String(error))) }
    finally { setBusy(false) }
  }

  const saveSettings = (): Promise<void> => run(async () => {
    if (settings === null) return
    await api(MEMORY_API.settings, { method: 'PUT', body: JSON.stringify(settings) })
    await reload()
    setMessage('✅ 记忆设置已保存（即时生效）')
  })

  const deleteMemory = (id: string): Promise<void> => run(async () => {
    await api(MEMORY_API.memoryItem + '?id=' + encodeURIComponent(id), { method: 'DELETE' })
    await reload()
    setMessage('✅ 已删除记忆条目')
  })

  const indexProject = (): Promise<void> => run(async () => {
    if (projectPath.trim() === '') throw new Error('项目路径必填（本机绝对路径）')
    const data = await api<{ report: ProjectIndexResult }>(MEMORY_API.index, { method: 'POST', body: JSON.stringify({ path: projectPath.trim() }) })
    setReport('项目索引：扫描 ' + data.report.scanned + ' · 新增 ' + data.report.added + ' · 更新 ' + data.report.updated + ' · 删除 ' + data.report.removed + ' · 跳过 ' + data.report.skipped + (data.report.errors.length > 0 ? ' · 错误 ' + data.report.errors.length + ' 条' : ''))
    await reload()
    setMessage('✅ 项目索引完成，知识库「' + projectPath.split('/').filter(Boolean).pop() + '」已更新')
  })

  const syncMirror = (kind: 'mnemon' | 'hindsight'): Promise<void> => run(async () => {
    const data = await api<{ report: MirrorSyncResult }>(MEMORY_API.mirrorSync, { method: 'POST', body: JSON.stringify({ kind }) })
    setReport((kind === 'mnemon' ? 'Mnemon' : 'Hindsight') + ' 镜像：扫描 ' + data.report.scanned + ' · 新增 ' + data.report.added + ' · 更新 ' + data.report.updated + ' · 跳过 ' + data.report.skipped + (data.report.errors.length > 0 ? ' · ' + data.report.errors[0] : ''))
    await reload()
    setMessage('✅ 镜像同步完成')
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
      {message !== '' && <div className={css.banner}>{message}</div>}
      <div style={{ ...card, ...row, display: 'flex' }}>
        <span className={css.badge}>记忆 {status?.memoryCount ?? 0} 条</span>
        <span className={css.badge}>沉淀 {status?.sedimentCount ?? 0} 次</span>
        <span className={css.badge}>注入 {settings?.autoInject === true ? '开' : '关'}</span>
        <span className={css.badge}>Mnemon {status?.mirror.mnemonRootExists === true ? '✓' : '✗'}</span>
        <span className={css.badge}>Hindsight {status?.mirror.hindsightConfigured === true ? status.mirror.hindsightServerMode : '未配置'}</span>
        <div style={{ flex: 1 }} />
        <button type="button" className={css.ghostButton} disabled={busy} onClick={() => { void reload() }}>刷新</button>
      </div>
      {settings !== null && (
        <div style={{ ...card, ...row, display: 'flex' }}>
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={settings.autoSediment} onChange={(e) => setSettings({ ...settings, autoSediment: e.target.checked })} />自动沉淀（会话结束提炼入库）
          </label>
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={settings.autoInject} onChange={(e) => setSettings({ ...settings, autoInject: e.target.checked })} />主动注入（每轮首步召回相关记忆）
          </label>
          <label style={{ fontSize: 12, opacity: 0.85 }}>注入条数
            <input className={css.input} style={{ width: 52, marginLeft: 6 }} type="number" min={1} max={20} value={settings.topK} onChange={(e) => setSettings({ ...settings, topK: Number(e.target.value) || 4 })} />
          </label>
          <label style={{ fontSize: 12, opacity: 0.85 }}>阈值
            <input className={css.input} style={{ width: 60, marginLeft: 6 }} type="number" step="0.05" min={0} max={1} value={settings.threshold} onChange={(e) => setSettings({ ...settings, threshold: Number(e.target.value) || 0 })} />
          </label>
          <label style={{ fontSize: 12, opacity: 0.85 }}>注入字数上限
            <input className={css.input} style={{ width: 68, marginLeft: 6 }} type="number" min={300} max={4000} step={100} value={settings.maxChars} onChange={(e) => setSettings({ ...settings, maxChars: Number(e.target.value) || 1200 })} />
          </label>
          <div style={{ flex: 1 }} />
          <button type="button" className={css.ghostButton} disabled={busy} onClick={() => { void saveSettings() }}>保存设置</button>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,3fr) minmax(0,2fr)', gap: 10, alignItems: 'start' }}>
        <div style={card}>
          <p style={cardTitle}>记忆条目（会话记忆库，自动沉淀 + 手动清理）</p>
          {docs.length === 0
            ? <div className={css.empty}>还没有沉淀记忆——正常使用几轮会话后，这里会出现值得长期保存的条目。</div>
            : (
              <table className={css.dataTable}>
                <thead><tr><th>记忆</th><th style={{ width: 56 }}>切块</th><th style={{ width: 60 }}>操作</th></tr></thead>
                <tbody>
                  {docs.slice().reverse().slice(0, 30).map((doc) => (
                    <tr key={doc.id}>
                      <td style={{ fontSize: 12, wordBreak: 'break-all' }}>{doc.fileName.replace(/^mem-/, '').replace(/\.md$/, '')}</td>
                      <td>{doc.chunkCount}</td>
                      <td><button type="button" className={css.ghostButton} disabled={busy} onClick={() => { void deleteMemory(doc.id) }}>删除</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={card}>
            <p style={cardTitle}>项目自动索引（尊重 .gitignore，增量）</p>
            <div style={row}>
              <input className={css.input} style={{ flex: 1, minWidth: 180 }} value={projectPath} placeholder="/Users/andyfan/Documents/ds/某项目" onChange={(e) => setProjectPath(e.target.value)} />
              <button type="button" className={css.ghostButton} disabled={busy} onClick={() => { void indexProject() }}>索引</button>
            </div>
          </div>
          <div style={card}>
            <p style={cardTitle}>只读镜像（零写入协议）</p>
            <div style={row}>
              <button type="button" className={css.ghostButton} disabled={busy} onClick={() => { void syncMirror('mnemon') }}>同步 Mnemon</button>
              <button type="button" className={css.ghostButton} disabled={busy} onClick={() => { void syncMirror('hindsight') }}>同步 Hindsight</button>
            </div>
            {report !== '' && <div style={{ fontSize: 11, opacity: 0.8, marginTop: 6, whiteSpace: 'pre-wrap' }}>{report}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
