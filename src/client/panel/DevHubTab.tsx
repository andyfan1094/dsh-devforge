/**
 * 开发合并页签（0.40.x）：辉哥定稿——开发规范、项目、代码仓库、服务器管理
 * 四个页签合并为一个「开发」页签，内部二级切换；四个既有能力零改动复用。
 * 滚动高度链：根容器 .tabHub 续传 panelContent 的 flex 约束（同 .memoryHub 教训）。
 */
import { useState, type JSX } from 'react'
import { StandardsTab } from './StandardsTab.tsx'
import { ProjectsTab } from './ProjectsTab.tsx'
import { ReposTab } from './ReposTab.tsx'
import { RemoteOperationsTab } from './RemoteOperationsTab.tsx'
import type { DevforgeApi } from '../api.ts'
import css from './panel.module.css'

export type DevSection = 'standards' | 'projects' | 'repos' | 'remote'

const SECTIONS: Array<{ key: DevSection; label: string }> = [
  { key: 'standards', label: '开发规范' },
  { key: 'projects', label: '项目' },
  { key: 'repos', label: '代码仓库' },
  { key: 'remote', label: '服务器管理' },
]

export function DevHubTab({ api }: { api: DevforgeApi }): JSX.Element {
  const [section, setSection] = useState<DevSection>('projects')
  return (
    <div className={css['tabHub']}>
      <div className={css['segmented']} role="group" aria-label="开发分区" data-dsh-part="segmented">
        {SECTIONS.map((item) => (
          <button key={item.key} type="button" data-active={section === item.key || undefined} onClick={() => { setSection(item.key) }}>{item.label}</button>
        ))}
      </div>
      {section === 'standards' && <StandardsTab api={api} />}
      {section === 'projects' && <ProjectsTab api={api} />}
      {section === 'repos' && <ReposTab api={api} />}
      {section === 'remote' && <RemoteOperationsTab api={api} />}
    </div>
  )
}
