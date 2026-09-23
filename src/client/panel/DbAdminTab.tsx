/**
 * 数据管理页 —— 天工造梦库表浏览器（辉哥 2026-09-23 定稿）。
 *
 * 交互契约：
 * - 数据透明化：表结构、数据行、域统计全部明文可看；
 * - 密钥保护：凭据/密钥值只显示掩码（服务端只回掩码），「复制」按钮经 reveal
 *   端点取明文直写剪贴板——明文永远不进入组件状态与 DOM（防旁观、防录屏）。
 */
import { useCallback, useEffect, useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { DbAdminConfigFilesResult, DbAdminCredentialRefsResult, DbAdminRowsResult, DbAdminTablesResult } from '../../store/dbadmin-protocol.ts'
import css from './panel.module.css'

/** 页内视图。 */
type View = 'tables' | 'credentials' | 'configs'

/** 复制文本到剪贴板；失败抛错由调用方提示。 */
async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

/** 数据管理页组件。 */
export function DbAdminTab({ api }: { api: DevforgeApi }): JSX.Element {
  const [view, setView] = useState<View>('tables')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)

  // ---- 表清单 ----
  const [tables, setTables] = useState<DbAdminTablesResult | null>(null)
  const [selectedTable, setSelectedTable] = useState('')

  // ---- 表数据 ----
  const [rows, setRows] = useState<DbAdminRowsResult | null>(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [full, setFull] = useState(false)

  // ---- 凭据镜像 ----
  const [credentials, setCredentials] = useState<DbAdminCredentialRefsResult | null>(null)

  // ---- 库外配置 ----
  const [configs, setConfigs] = useState<DbAdminConfigFilesResult | null>(null)

  /** 临时提示（复制成功等）；3 秒自动消退。 */
  const flash = useCallback((message: string): void => {
    setNotice(message)
    window.setTimeout(() => { setNotice('') }, 3000)
  }, [])

  /** 加载表清单；首次加载后自动选中第一张表。 */
  const refreshTables = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setError('')
      const data = await api.getDbTables()
      setTables(data)
      setSelectedTable((current) => (current !== '' && data.tables.some((table) => table.name === current) ? current : data.tables[0]?.name ?? ''))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [api])

  /** 加载当前表数据分页。 */
  const refreshRows = useCallback(async (): Promise<void> => {
    if (selectedTable === '') { setRows(null); return }
    setLoading(true)
    try {
      setError('')
      setRows(await api.getDbRows({ table: selectedTable, page, pageSize: 50, search, full }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [api, selectedTable, page, search, full])

  /** 加载凭据镜像清单。 */
  const refreshCredentials = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setError('')
      setCredentials(await api.getDbCredentialRefs())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [api])

  /** 加载库外配置清单。 */
  const refreshConfigs = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setError('')
      setConfigs(await api.getDbConfigFiles())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [api])

  // 视图/表/翻页/搜索变化即拉数据。
  useEffect(() => { if (view === 'tables') void refreshTables() }, [view, refreshTables])
  useEffect(() => { if (view === 'tables') void refreshRows() }, [view, refreshRows])
  useEffect(() => { if (view === 'credentials') void refreshCredentials() }, [view, refreshCredentials])
  useEffect(() => { if (view === 'configs') void refreshConfigs() }, [view, refreshConfigs])

  /** 复制凭据明文：明文只进剪贴板，不落状态。 */
  const copyCredential = async (ref: string): Promise<void> => {
    try {
      await copyText(await api.revealDbCredential(ref))
      flash('已复制「' + ref + '」到剪贴板（页面不显示明文）')
    } catch (e) {
      setError('复制失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  /** 复制库外配置明文：同上契约。 */
  const copyConfig = async (name: 'feishu' | 'backup-secret' | 'credentials-yaml', label: string): Promise<void> => {
    try {
      await copyText(await api.revealDbConfig(name))
      flash('已复制' + label + '到剪贴板（页面不显示明文）')
    } catch (e) {
      setError('复制失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const totalPages = rows === null ? 1 : Math.max(1, Math.ceil(rows.total / rows.pageSize))

  return (
    <section className={css['tabBody']}>
      <div className={css['toolbar']}>
        <div className={css['segmented']} role="group" aria-label="数据管理视图">
          <button type="button" data-active={view === 'tables' || undefined} onClick={() => { setView('tables') }}>数据表</button>
          <button type="button" data-active={view === 'credentials' || undefined} onClick={() => { setView('credentials') }}>凭据镜像</button>
          <button type="button" data-active={view === 'configs' || undefined} onClick={() => { setView('configs') }}>库外配置</button>
        </div>
        <span className={css['sectionHint']}>数据全透明；密钥只显掩码，复制直达剪贴板</span>
        <span className={css['toolbarSpacer']} />
        {notice !== '' && <span className={css['sectionHint']} data-notice="">{notice}</span>}
        <button type="button" className={css['ghostButton']} onClick={() => {
          if (view === 'tables') { void refreshTables(); void refreshRows() }
          if (view === 'credentials') void refreshCredentials()
          if (view === 'configs') void refreshConfigs()
        }}>刷新</button>
      </div>

      {error !== '' && <div className={css['banner']} data-kind="error">{error}</div>}
      {loading && <div className={css['empty']} data-loading="">加载中…</div>}

      {view === 'tables' && (
        <div className={css['dbAdminLayout']}>
          <aside className={css['dbAdminSidebar']}>
            {(tables?.tables ?? []).map((table) => (
              <button
                key={table.name}
                type="button"
                className={css['dbAdminTableItem']}
                data-active={table.name === selectedTable || undefined}
                title={table.ddl}
                onClick={() => { setSelectedTable(table.name); setPage(1); setSearch(''); setSearchInput('') }}
              >
                <span className={css['dbAdminTableName']}>{table.name}</span>
                <span className={css['dbAdminTableCount']}>{table.rowCount}</span>
              </button>
            ))}
          </aside>

          <div className={css['dbAdminMain']}>
            {tables !== null && selectedTable !== '' && (
              <div className={css['toolbar']}>
                <input
                  type="search"
                  className={css['dbAdminSearch']}
                  placeholder="在文本列中搜索…"
                  value={searchInput}
                  onChange={(event) => { setSearchInput(event.target.value) }}
                  onKeyDown={(event) => { if (event.key === 'Enter') { setSearch(searchInput); setPage(1) } }}
                />
                <label className={css['dbAdminToggle']}>
                  <input type="checkbox" checked={full} onChange={(event) => { setFull(event.target.checked); setPage(1) }} />
                  完整单元格
                </label>
              </div>
            )}

            {rows !== null && (
              <>
                <div className={css['tableWrap']}>
                  <table className={css['dbAdminGrid']}>
                    <thead>
                      <tr>
                        {rows.columns.map((column) => (
                          <th key={column.name} title={column.type}>{column.name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.rows.length === 0 && (
                        <tr><td className={css['dbAdminEmpty']} colSpan={Math.max(rows.columns.length, 1)}>（无数据）</td></tr>
                      )}
                      {rows.rows.map((row, index) => (
                        <tr key={index}>
                          {rows.columns.map((column) => {
                            const cell = row[column.name]
                            return (
                              <td key={column.name} className={css['dbAdminCell']} title={typeof cell === 'string' ? cell : undefined}>{formatCell(cell)}</td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className={css['dbAdminPager']}>
                  <span>{rows.table} · 共 {rows.total} 行{rows.truncated ? ' · 有单元格被截断' : ''}</span>
                  <span className={css['toolbarSpacer']} />
                  <button type="button" className={css['ghostButton']} disabled={rows.page <= 1} onClick={() => { setPage(rows.page - 1) }}>上一页</button>
                  <span>{rows.page} / {totalPages}</span>
                  <button type="button" className={css['ghostButton']} disabled={rows.page >= totalPages} onClick={() => { setPage(rows.page + 1) }}>下一页</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {view === 'credentials' && (
        <div className={css['tableWrap']}>
          <div className={css['resourceList']}>
            {(credentials?.refs ?? []).map((item) => (
              <div key={item.ref} className={css['resourceRow']}>
                <div className={css['resourceInfo']}>
                  <strong className={css['resourceTitle']}>{item.ref}</strong>
                  <span className={css['dbAdminMasked']}>{item.masked}</span>
                </div>
                <button type="button" className={css['ghostButton']} title="取明文并复制（页面不显示明文）" onClick={() => { void copyCredential(item.ref) }}>复制</button>
              </div>
            ))}
            {credentials !== null && credentials.refs.length === 0 && <div className={css['empty']}>凭据镜像为空</div>}
          </div>
        </div>
      )}

      {view === 'configs' && (
        <div className={css['resourceList']}>
          {(configs?.files ?? []).map((file) => (
            <div key={file.name} className={css['resourceRow']}>
              <div className={css['resourceInfo']}>
                <strong className={css['resourceTitle']}>{file.label}</strong>
                <span className={css['resourceMeta']}>
                  {file.exists ? file.keys.length > 0 ? '键：' + file.keys.join('、') : '存在' : '文件不存在'}
                  {file.maskedPreview !== undefined && <span className={css['dbAdminMasked']}> {file.maskedPreview}</span>}
                </span>
              </div>
              {file.exists && (
                <button type="button" className={css['ghostButton']} title="取全文并复制（页面不显示明文）" onClick={() => { void copyConfig(file.name, file.label) }}>复制全文</button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** 单元格渲染：对象/数组转紧凑 JSON，布尔与空值给短文案。 */
function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try { return JSON.stringify(value) } catch { return String(value) }
}
