/**
 * 内置记忆知识图谱视图 —— 纯 SVG + 确定性力导向布局（零第三方依赖、无动画）。
 *
 * - 布局在 useMemo 里一次性算完（约 200 节点规模毫秒级），不做逐帧模拟，避免面板卡顿；
 * - 交互：hover / 选中聚焦时高亮邻居并压暗其余；点条目节点回调查看详情，
 *   点关键词节点回调给列表做过滤；分类节点仅作枢纽展示；
 * - 颜色全部走面板主题 token（与整页明暗主题联动），不散写魔法值（紫色沿用品-promo 同源）。
 */
import { useMemo, useState } from 'react'
import type { MemoryGraph, MemoryGraphNode } from '../../memory/protocol.ts'
import css from './panel.module.css'

/** 画布逻辑尺寸（viewBox，等比缩放适配面板宽度）。 */
const WIDTH = 820
const HEIGHT = 430

/** 力导向模拟节点（内部状态，不外泄）。 */
interface SimNode { id: string; x: number; y: number; vx: number; vy: number }

/** 斥/引力常数：60~220 节点规模下可收敛，且不会糊成中心一团。 */
const REPULSION = 26000
const SPRING = 0.028
const GRAVITY = 0.02
const ITERATIONS = 300
const DAMPING = 0.86
const MAX_STEP = 14

/** 弹簧原长：条目-关键词紧凑、条目-条目居中、分类枢纽拉远，控制成图疏密层次。 */
function restLength(a: string, b: string): number {
  const kindA = a.slice(0, a.indexOf(':'))
  const kindB = b.slice(0, b.indexOf(':'))
  if (kindA === 'category' || kindB === 'category') return 150
  if (kindA === 'entry' && kindB === 'entry') return 120
  return 85
}

/** 确定性力导向布局：黄金角初始化 + 300 轮斥力/弹簧/向心模拟，输出节点坐标。 */
function computeLayout(graph: MemoryGraph): Map<string, { x: number; y: number }> {
  const cx = WIDTH / 2
  const cy = HEIGHT / 2
  const sim = new Map<string, SimNode>()
  graph.nodes.forEach((node, index) => {
    // 黄金角 2.399963 均匀撒点：同参数必得同布局，刷新不跳动
    const angle = (index * 2.399963) % (Math.PI * 2)
    const ring = node.kind === 'category' ? 46 : node.kind === 'tag' ? 130 : 205
    sim.set(node.id, { id: node.id, x: cx + Math.cos(angle) * ring, y: cy + Math.sin(angle) * ring, vx: 0, vy: 0 })
  })
  const list = [...sim.values()]
  for (let step = 0; step < ITERATIONS; step++) {
    // 斥力：所有节点两两相斥，距离平方反比
    for (let i = 0; i < list.length; i++) {
      const a = list[i]
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]
        let dx = a.x - b.x
        let dy = a.y - b.y
        let dist2 = dx * dx + dy * dy
        if (dist2 < 1) { dx = (i - j) * 0.7; dy = (i + j) * 0.5; dist2 = 1 }
        const force = REPULSION / dist2
        const dist = Math.sqrt(dist2)
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        a.vx += fx; a.vy += fy
        b.vx -= fx; b.vy -= fy
      }
    }
    // 弹簧：沿边相互吸引到各自原长
    for (const edge of graph.edges) {
      const a = sim.get(edge.source)
      const b = sim.get(edge.target)
      if (a === undefined || b === undefined) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy))
      const force = SPRING * (dist - restLength(edge.source, edge.target)) * Math.min(3, edge.weight)
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      a.vx += fx; a.vy += fy
      b.vx -= fx; b.vy -= fy
    }
    // 向心 + 阻尼积分，步长封顶防弹飞
    for (const node of list) {
      node.vx += (cx - node.x) * GRAVITY
      node.vy += (cy - node.y) * GRAVITY
      node.vx *= DAMPING
      node.vy *= DAMPING
      const dx = Math.max(-MAX_STEP, Math.min(MAX_STEP, node.vx))
      const dy = Math.max(-MAX_STEP, Math.min(MAX_STEP, node.vy))
      node.x = Math.max(16, Math.min(WIDTH - 16, node.x + dx))
      node.y = Math.max(16, Math.min(HEIGHT - 16, node.y + dy))
    }
  }
  const positions = new Map<string, { x: number; y: number }>()
  for (const node of list) positions.set(node.id, { x: Math.round(node.x * 10) / 10, y: Math.round(node.y * 10) / 10 })
  return positions
}

/** 节点半径：分类枢纽最大，标签/条目按连接度增长并封顶。 */
function nodeRadius(node: MemoryGraphNode): number {
  if (node.kind === 'category') return 8
  if (node.kind === 'tag') return 3.5 + Math.min(5.5, node.weight * 0.6)
  return 3 + Math.min(4.5, node.weight * 0.4)
}

/** 图谱视图属性：focusId 为当前聚焦节点（选中条目或激活关键词），回调走父级状态。 */
export function MemoryGraphView({ graph, focusId, onSelectEntry, onToggleTag }: {
  graph: MemoryGraph | null
  focusId: string
  onSelectEntry: (entryId: string) => void
  onToggleTag: (tag: string) => void
}): JSX.Element {
  const [hoverId, setHoverId] = useState('')
  const positions = useMemo(() => (graph === null ? new Map<string, { x: number; y: number }>() : computeLayout(graph)), [graph])
  // 邻接表：聚焦时只点亮直接邻居，其余压暗
  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>()
    if (graph === null) return map
    for (const edge of graph.edges) {
      if (!map.has(edge.source)) map.set(edge.source, new Set())
      if (!map.has(edge.target)) map.set(edge.target, new Set())
      map.get(edge.source)?.add(edge.target)
      map.get(edge.target)?.add(edge.source)
    }
    return map
  }, [graph])

  if (graph === null || graph.nodes.length === 0) {
    return <div className={css['empty']}>暂无内置记忆，迁移外部记忆或正常使用几轮后，图谱会自动生成。</div>
  }

  const active = hoverId !== '' ? hoverId : focusId
  const activeSet = new Set<string>()
  if (active !== '') {
    activeSet.add(active)
    for (const id of neighbors.get(active) ?? []) activeSet.add(id)
  }
  const isActive = (id: string): boolean => active === '' || activeSet.has(id)
  const edgeActive = (source: string, target: string): boolean => active !== '' && (source === active || target === active)

  return (
    <div className={css['graphWrap']}>
      <svg className={css['graphSvg']} viewBox={'0 0 ' + WIDTH + ' ' + HEIGHT} role="img" aria-label="内置记忆知识图谱">
        {graph.edges.map((edge) => {
          const a = positions.get(edge.source)
          const b = positions.get(edge.target)
          if (a === undefined || b === undefined) return null
          const on = edgeActive(edge.source, edge.target)
          const dim = active !== '' && !on
          return <line key={edge.source + '\u0000' + edge.target} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            className={css['graphEdge']} data-active={on ? '' : undefined} data-dim={dim ? '' : undefined}
            strokeWidth={Math.min(3, 0.5 + edge.weight * 0.45)} />
        })}
        {graph.nodes.map((node) => {
          const pos = positions.get(node.id)
          if (pos === undefined) return null
          const on = isActive(node.id)
          const focused = node.id === active
          // 标签展示策略：分类常显；关键词高连接度或聚焦时显示；条目仅聚焦时显示，防止文字糊满
          const showLabel = node.kind === 'category' || focused || (node.kind === 'tag' && node.weight >= 4)
          const handle = (): void => {
            if (node.kind === 'entry' && node.entryId !== undefined) onSelectEntry(node.entryId)
            else if (node.kind === 'tag') onToggleTag(node.label)
          }
          return (
            <g key={node.id} className={css['graphNodeGroup']} data-dim={!on ? '' : undefined}
              onMouseEnter={() => setHoverId(node.id)} onMouseLeave={() => setHoverId('')} onClick={handle}>
              <circle cx={pos.x} cy={pos.y} r={nodeRadius(node) + (focused ? 2 : 0)} className={css['graphNode']} data-kind={node.kind} data-focus={focused ? '' : undefined} />
              {showLabel && <text x={pos.x} y={pos.y - nodeRadius(node) - 3} textAnchor="middle" className={css['graphLabel']} data-strong={focused || node.kind === 'category' ? '' : undefined}>{node.label}</text>}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
