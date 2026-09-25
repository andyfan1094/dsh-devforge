/**
 * 开发规范分区（0.40.x 从 DevforgePanel 原样抽出为独立组件，随「开发」合并页签复用）：
 * 内置规范清单 + 模态查看正文；数据自持（挂载即拉取），错误在本分区内呈现不外抛。
 */
import { useCallback, useEffect, useState, type JSX } from 'react'
import type { DevforgeApi } from '../api.ts'
import type { StandardDetail, StandardSummary } from '../../protocol.ts'
import css from './panel.module.css'

export function StandardsTab({ api }: { api: DevforgeApi }): JSX.Element {
  const [standards, setStandards] = useState<StandardSummary[]>([])
  const [viewing, setViewing] = useState<StandardDetail | null>(null)
  const [error, setError] = useState('')
  /** 规范数据是否已返回，避免慢请求期间误报“为空”。 */
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setError('')
      setStandards(await api.listStandards())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoaded(true)
    }
  }, [api])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** 查看规范正文；单项读取失败在本分区内呈现，不能抛到宿主 GUI。 */
  const viewStandard = async (id: string): Promise<void> => {
    try {
      setError('')
      setViewing(await api.getStandard(id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <>
      {error !== '' && <div className={css['banner']} data-kind="error">{error}</div>}
      <section className={css['tabBody']}>
        <div className={css['toolbar']}>
          <span className={css['sectionHint']}>内置开发规范</span>
          <span className={css['toolbarSpacer']} />
          <button type="button" className={css['ghostButton']} onClick={() => { void refresh() }}>刷新</button>
        </div>
        {!loaded && <div className={css['empty']} data-loading="">正在加载规范库…</div>}
        {loaded && standards.length === 0 && <div className={css['empty']}>规范库为空（standards/ 目录无 md 文件）</div>}
        {loaded && standards.length > 0 && (
          <div className={css['tableWrap']}>
            <div className={css['resourceList']}>
              {standards.map((standard) => (
                <div key={standard.id} className={css['resourceRow']}>
                  <div className={css['resourceInfo']}>
                    <strong className={css['resourceTitle']}>{standard.title}</strong>
                    <span className={css['resourceMeta']}>{standard.id} · {standard.tags.join(', ') || '无标签'}</span>
                  </div>
                  <button type="button" className={css['ghostButton']} onClick={() => { void viewStandard(standard.id) }}>查看</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
      {viewing !== null && (
        <div className={css['modalBackdrop']} onClick={() => { setViewing(null) }}>
          <div className={css['modal']} role="dialog" aria-modal="true" aria-label={viewing.title} onClick={(event) => { event.stopPropagation() }}>
            <h3 className={css['modalTitle']}>{viewing.title}</h3>
            <pre className={css['modalContent']}>{viewing.content}</pre>
            <div className={css['modalActions']}>
              <button type="button" className={css['ghostButton']} onClick={() => { setViewing(null) }}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
