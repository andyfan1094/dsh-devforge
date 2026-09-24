/**
 * 记忆合并页签（0.40.x）：辉哥定稿——记忆中枢（知识库检索）与记忆工作台（长期记忆管理）
 * 合并为一个「记忆」页签，内部二级切换；两个既有组件零改动复用。
 * 分区受控于面板（个人中心「编辑身份」跳入时直达长期记忆分区）。
 */
import type { JSX } from 'react'
import { RagTab } from './RagTab.tsx'
import { MemoryTab } from './MemoryTab.tsx'
import type { DevforgeApi } from '../api.ts'
import css from './panel.module.css'

export type MemorySection = 'rag' | 'workbench'

export function MemoryHubTab({ api, section, onSectionChange }: { api: DevforgeApi; section: MemorySection; onSectionChange: (next: MemorySection) => void }): JSX.Element {
  return (
    <div className={css['memoryHub']}>
      <div className={css['segmented']} role="group" aria-label="记忆分区" data-dsh-part="segmented">
        <button type="button" data-active={section === 'rag' || undefined} onClick={() => { onSectionChange('rag') }}>知识库检索</button>
        <button type="button" data-active={section === 'workbench' || undefined} onClick={() => { onSectionChange('workbench') }}>长期记忆</button>
      </div>
      {section === 'rag' ? <RagTab /> : <MemoryTab api={api} />}
    </div>
  )
}
