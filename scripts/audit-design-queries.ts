/**
 * 设计资产检索命中率体检。
 *
 * 用途：回答「Agent 用日常话去查，查得到吗」这个问题。
 * 设计资产靠 frontmatter 的 triggers/description 命中，中文同义词不写进去就查不到——
 * 资产明明存在却搜空，是这套库最容易退化的地方。本脚本对一批真实查询词逐条体检。
 *
 * 运行：node --experimental-strip-types scripts/audit-design-queries.ts
 * 退出码：存在 0 命中的查询词时为 1（便于在交付前当回归门禁）。
 */
import { fileURLToPath } from 'node:url'
import { DesignStore } from '../src/design.ts'

/** 体检用的查询词：按使用场景分组，尽量贴近真实提问方式。 */
const QUERIES: Record<string, string[]> = {
  排版与层级: ['排版', '层级', '字体', '字号', '行高', '排版层级', '长文排版', '编辑式排版'],
  颜色与主题: ['配色', '强调色', '对比度', '暗色模式', '语义色', '单色'],
  交互与状态: ['状态覆盖', '空状态', '加载状态', '错误状态', '表单校验', '校验时机', '动效', '动效纪律'],
  组件与页面: ['表格', '数据表格', '列表页', '控制台', '后台', '仪表盘', '看板', '设置页', '表单', '表单布局', '登录页', '详情页'],
  数据与图表: ['图表', '数据可视化', '指标卡', '折线图', '柱状图'],
  布局与响应式: ['响应式', '栅格', '断点', '移动端', '留白', '间距'],
  无障碍与合规: ['无障碍', '键盘导航', '焦点环', '读屏', 'RTL'],
  工作法与流程: ['设计流程', '重设计', '改造界面', '审美', '设计方向', '三旋钮', '交付自检', '截图自检'],
  生图与素材: ['生图', '主视觉', '配图', '图标', '图片生成'],
  演示稿与文档: ['演示稿', '幻灯片', 'PPT', '封面', '报告'],
  设计系统: ['设计系统', '调性', '字体配对', 'Linear 风格', '深色'],
}

/** 每个查询词至少应命中的条数；低于该值视为太窄。 */
const MIN_HITS = 1

const store = new DesignStore(fileURLToPath(new URL('../design/', import.meta.url)))

const misses: string[] = []
let checked = 0

for (const [group, queries] of Object.entries(QUERIES)) {
  console.log('\n【' + group + '】')
  for (const query of queries) {
    checked += 1
    const hits = store.search(query, undefined, 3)
    if (hits.length < MIN_HITS) {
      misses.push(group + ' → 「' + query + '」')
      console.log('  ✗ ' + query.padEnd(10) + ' 0 命中')
      continue
    }
    console.log('  ✓ ' + query.padEnd(10) + hits.length + '+ 条，首位 ' + hits[0]?.id)
  }
}

console.log('\n—— 体检汇总 ——')
console.log('资产总数：' + store.count() + '；查询词：' + checked + '；零命中：' + misses.length)
if (misses.length > 0) {
  console.log('零命中清单（要么补资产，要么给已有资产补 triggers）：')
  for (const miss of misses) console.log('  · ' + miss)
  process.exitCode = 1
}
