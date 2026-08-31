/**
 * 代码仓库工作台 —— 服务工厂主面板「代码仓库」页签的内部容器。
 *
 * 按托管平台分子页签：CNB（cnb.cool，默认首位）与 GitHub。两个平台各自
 * 维护独立的工作台组件与本地凭据存储，互不影响。
 */
import { useState } from 'react'
import type { DevforgeApi } from '../api.ts'
import { CnbTab } from './CnbTab.tsx'
import { GithubTab } from './GithubTab.tsx'
import css from './panel.module.css'

/** 托管平台子页签。 */
type RepoHost = 'cnb' | 'github'

/** 内嵌页属性。 */
export interface ReposTabProps {
  /** 服务工厂统一 API 客户端。 */
  api: DevforgeApi
}

/** 服务工厂代码仓库工作台。 */
export function ReposTab({ api }: ReposTabProps): JSX.Element {
  const [host, setHost] = useState<RepoHost>('cnb')

  return (
    <section className={css['githubWorkspace']} aria-label="代码仓库工作台">
      <div className={css['subTabBar']} role="tablist" aria-label="代码托管平台">
        <button type="button" role="tab" aria-selected={host === 'cnb'} data-active={host === 'cnb' ? '' : undefined} className={css['subTab']} onClick={() => { setHost('cnb') }}>CNB</button>
        <button type="button" role="tab" aria-selected={host === 'github'} data-active={host === 'github' ? '' : undefined} className={css['subTab']} onClick={() => { setHost('github') }}>GitHub</button>
      </div>
      {host === 'cnb' && <CnbTab api={api} />}
      {host === 'github' && <GithubTab api={api} />}
    </section>
  )
}
