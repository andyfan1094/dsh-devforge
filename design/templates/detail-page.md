---
name: 详情页模板
description: 中文记录详情页单文件骨架：主区键值概览与活动时间线配侧栏归属信息，含状态徽标、溢出菜单、空态与加载骨架，零依赖。
triggers:
  - 详情页模板
  - 详情页
  - 信息页
  - 记录详情
  - 主区侧栏
  - detail page
  - record detail
od:
  category: template
---

# 详情页模板

**这份模板给你什么**：一个零依赖的单文件详情页——面包屑 + 返回、记录大标题与状态徽标（色点 + 文本，不靠颜色单独表意）、主操作配一个溢出菜单收次要操作；主区给键值概览、受行宽约束的长文本、嵌套活动时间线；侧栏放归属信息、关键日期、标签与相关记录；底部是红色描边的危险操作区，另附加载骨架与空态两种非正常状态。颜色、间距、圆角全部走 `:root` 语义 token。

**什么场景用**：一条记录的完整视图——工单、订单、客户、退款单、发布单、供应商档案。适合「用户从列表点进来，用十几秒判断现状、再决定下一步动作」的界面，也适合当真实项目里详情路由的视觉基准。列表页用 `templates/console-shell`，配置类页面用 `templates/settings-page`。

**怎么改**：① 先把 `:root` 的 `--accent` 换成 `systems/` 里选定设计系统的主色（默认深青绿 `#1f6f5c`）；② 替换记录名称、键值对、时间线事件与侧栏归属数据；③ 按字段实际存在情况增删 `dt/dd` 行——**没有值的字段写「未填写」，不要留白也不要删行**；④ 状态徽标只保留真实存在的状态，别为演示凑状态；⑤ 危险操作按业务决定留或删，删除时整块 `section#danger` 一起删干净。

---

## 结构决策

### 主区 + 侧栏的分工边界

判据是**信息是否参与「读完之后做决定」**：主区承载决策链，侧栏承载上下文。把上下文塞进主区会让标题区被淹没，把决策项塞进侧栏会让读者来回横跳。

- **主区（`main`）**：这条记录是什么（名称、状态）、它的关键属性（可在主区直接对照判断的键值对）、它的正文（富文本描述）、它发生过什么（活动时间线）。
- **侧栏（`aside`）**：只在需要时才被查看，缺了也不影响主流程——归属（负责人、所属团队）、关键日期（创建 / 更新 / 到期）、分类标签、以及指向其他记录的外链。
- **两栏都不放**：全局导航（属壳层）、与这条记录无关的指标看板、以及会修改记录的批量操作（收进溢出菜单或独立流程页）。

### 侧栏放什么

满足下面任一条的信息进侧栏：① 是**指向别人**的信息（负责人、团队、来源渠道）；② 是**元数据**（创建时间、最后更新、编号、外部系统 ID）；③ 是**跳转到别处的入口**（相关工单、父订单、客户档案）；④ 是**分类**（标签、优先级、业务线）。反过来，凡是读者会用来做「通过 / 驳回 / 发货」判断的字段，必须留在主区的键值对里——放进侧栏等于把它藏起来。

### 什么时候用页签，而不是长滚动

| 场景 | 选择 | 理由 |
| --- | --- | --- |
| 内容总量 2–3 屏、各区弱关联 | 长滚动（本模板） | Ctrl+F 可搜、可深链接到锚点、移动端只有一条滚动轴 |
| 有 2–3 个**互斥视图**（概览 / 明细 / 日志），各自内容都超过一屏 | 页签 | 一次只读一屏，滚动位置不互相污染 |
| 分区数 > 5，或单个分区本身是完整子流程（对账、结算） | 页签或独立子路由 | 长滚动会让「我在哪」彻底失效 |
| 一个主视图 + 一个高频小视图（评论、附件） | 长滚动 + 侧栏或内联折叠 | 小视图不值得为它牺牲可搜索性 |

页签必须写进 URL（`?tab=logs`）并支持浏览器前进后退，否则用户分享链接就把同事带到错误的视图。页签内切走后要保留各页签的滚动位置，别共用一条滚动轴。

---

## 信息编排

**标题区**。一条规则：**名称 + 状态 + 主操作同屏，且状态紧跟名称**。读者先用名称确认「是不是这条」，再用状态判断「它现在在哪一步」，最后才看主操作。状态徽标用「色点 + 文字」双通道——色点负责快速扫描，文字负责准确表意，`aria-hidden` 的色点配上可见文本，色盲用户和屏幕阅读器都能读到。主操作全页只有一个（本模板是「推进到下一状态」），其余动作按频率降级为次要按钮、溢出菜单，最后才是危险区。

**键值对呈现纪律**。一律用 `dl > dt + dd`，不用表格（表格是给多行同构数据用的，两列键值用表格会带来无意义的表头语义和横向滚动）。同一组里字段顺序按**判断优先级**排，不按数据库字段顺序；`dt` 用弱化色、`dd` 用正文色，让左列退到背景里。规则三条：

- 缺值写「未填写」并保留差值样式，不留白——留白会让读者误以为渲染出错。
- 值含数字或时间戳时加 `tabular-nums`，多行对齐才不抖。
- 不在 `dd` 里塞长段落；超过一行半的内容移到富文本区。

**长文本与富文本**。正文一律 `max-width: 60ch`（区间 45–75ch），这是本模板里唯一按字符数限制宽度的地方，标题与键值对不受此限。行高给到 1.7–1.75，段间距用 `--space-3`。富文本内的强调只允许 `strong` 与 `code`——`code` 用来呈现单号、外部 ID、报错码这类需要逐字符比对的字符串，等宽字体加 tabular-nums。不要在正文里做渐变文字、彩色背景块或多色高亮，那会让正文失去可扫读性。

**活动时间线的位置**。紧跟在正文之后、同一滚动轴内，因为它属于「读记录」的一部分而不是上下文。结构用 `ol`（顺序本身就是语义），每条 = 时间 + 事件名 + 操作者 + 备注；嵌套回复用 `ul` 缩进一级，层级不超过两层。时间戳格式定死为 `YYYY-MM-DD HH:mm`（本机时区），需要精确到秒的场景（审计、对账）才补 `:ss`；机器可读值放在 `datetime` 属性里，**不要靠 `title` 提示补充信息**，触屏和键盘用户拿不到。最新事件排在最上面，倒序与「最近发生了什么」的提问方式一致。

**危险操作区**。永远在页面最后，与正文物理隔离（独立 1px `--danger` 描边 + `--space-6` 顶部间距），标题写清对象（「删除这条退款申请」而不是「删除」）。不可逆操作不假装提供撤销，改用二次确认并说明后果（哪些关联数据会一并消失）。

---

## 可替换的 token

全部颜色、间距、圆角、字体、阴影都从 `:root` 取；换设计系统时只替换这张表里的值，不动结构。

| token | 默认值 | 用途 | 替换说明 |
| --- | --- | --- | --- |
| `--bg` | `#f6f7f6` | 页面底色 | 取设计系统的 background；深色别用纯黑 |
| `--surface` | `#ffffff` | 卡片、侧栏分区、菜单面板 | 与 `--bg` 至少差 1 级明度，靠 1px 边框分层 |
| `--surface-2` | `#eef0ee` | 加载骨架、标签底、空态块 | 弱于 `--surface` 的凹陷面 |
| `--border` | `#dfe3e0` | 分隔线、卡片描边 | 发丝线，不用重投影 |
| `--text` | `#12171a` | 标题与正文 | 与底色对比度 ≥ 7:1 更稳 |
| `--text-muted` | `#5d6b66` | `dt`、时间戳、说明 | 不低于 4.5:1；别自造第四档灰 |
| `--accent` | `#1f6f5c` | 唯一强调色：主操作、链接、状态色点 | **必按所选设计系统覆盖**；禁默认靛蓝；全屏可见用量 ≤ 2 处 |
| `--accent-contrast` | `#ffffff` | 强调色上的文字 | 对比度 ≥ 4.5:1 |
| `--focus` | `#1f6f5c` | 焦点环 | 与相邻底色 ≥ 3:1；焦点环必须瞬时，不带 transition |
| `--danger` | `#b3261e` | 危险区描边、破坏性按钮、异常状态文字 | 亮色用深红，暗色需提亮 |
| `--radius` | `10px` | 卡片与控件圆角 | 派生 `--radius-sm`；子元素圆角不大于父元素 |
| `--space-1` … `--space-6` | `4 / 8 / 12 / 16 / 24 / 32px` | 全部间距 | 组内 1–3，组间 5–6，不出现 18px 这类值 |
| `--font-sans` | `system-ui, -apple-system, "Segoe UI", "Noto Sans SC", sans-serif` | 全页字体 | 不引外链字体 |
| `--shadow-1` | 单层浅阴影 | 卡片、溢出菜单 | 深色下几乎不可见属正常，别加大投影 |
| `--measure` | `60ch` | 长文本行宽上限 | 严格保持 45–75ch 区间，随字号一起调 |

---

## HTML 骨架

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>退款单详情 · 云雀运营台</title>
<style>
  /* 统一 token 契约：换设计系统只改这一段 —— --accent 默认值须按所选 systems/<id> 覆盖 */
  :root {
    --bg: #f6f7f6; --surface: #ffffff; --surface-2: #eef0ee; --border: #dfe3e0;
    --text: #12171a; --text-muted: #5d6b66;
    --accent: #1f6f5c; --accent-contrast: #ffffff; --focus: #1f6f5c; --danger: #b3261e;
    --radius: 10px; --radius-sm: 6px; --measure: 60ch;
    --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 24px; --space-6: 32px;
    --font-sans: system-ui, -apple-system, "Segoe UI", "Noto Sans SC", sans-serif;
    --shadow-1: 0 1px 2px rgba(16, 24, 20, .07), 0 1px 1px rgba(16, 24, 20, .04);
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0f1211; --surface: #171b19; --surface-2: #1f2523; --border: #2b322f; --text: #e9edea; --text-muted: #9aa8a2; --accent: #5cbfa4; --accent-contrast: #08130f; --focus: #8fe3c6; --danger: #f08a80; --shadow-1: 0 1px 2px rgba(0, 0, 0, .5); }
  }
  /* 类里的 display 会盖掉 UA 的 [hidden] 规则，必须兜底，否则加载骨架与空态会一直显示 */
  [hidden] { display: none !important; }
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 400 15px/1.6 var(--font-sans); -webkit-font-smoothing: antialiased; }
  h1, h2, h3, p, dl, dd, ol, ul, figure, blockquote { margin: 0; }
  h1 { font-size: 22px; line-height: 1.25; letter-spacing: -.01em; }
  h2 { font-size: 16px; } h3 { font-size: 15px; font-weight: 600; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  button, summary, input, select { font: inherit; color: inherit; }
  button { cursor: pointer; }
  :focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .n { font-variant-numeric: tabular-nums; }
  .mono, code { font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; font-variant-numeric: tabular-nums; }
  .vh { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .i { width: 16px; height: 16px; flex: 0 0 auto; }

  /* —— 页面头 —— */
  .wrap { margin: 0 auto; padding: 0 var(--space-4); max-width: 720px; }
  .topbar { position: sticky; top: 0; z-index: 3; background: var(--bg); border-bottom: 1px solid var(--border); }
  .topbar__in { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); margin: 0 auto; max-width: 720px; }
  .back { display: inline-flex; align-items: center; gap: var(--space-2); flex: none; font-size: 14px; color: var(--text-muted); }
  .crumbs { flex: 1 1 auto; min-width: 0; font-size: 13px; color: var(--text-muted); }
  .crumbs ol { display: flex; gap: var(--space-2); list-style: none; padding: 0; overflow: hidden; }
  .crumbs li { white-space: nowrap; }
  .crumbs li + li::before { content: "/"; margin-right: var(--space-2); color: var(--border); }
  .crumbs [aria-current] { color: var(--text); overflow: hidden; text-overflow: ellipsis; max-width: 22ch; }
  .page-head { padding: var(--space-5) 0 var(--space-4); }
  .head-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
  .badge { display: inline-flex; align-items: center; gap: 6px; padding: 2px var(--space-2); border: 1px solid var(--border); border-radius: 999px; background: var(--surface-2); font-size: 12px; color: var(--text-muted); white-space: nowrap; }
  .badge::before { content: ""; width: 6px; height: 6px; flex: none; border-radius: 50%; background: currentColor; }
  .badge[data-tone="active"] { color: var(--accent); border-color: var(--accent); background: transparent; }
  .badge[data-tone="wait"] { color: #8a5a12; border-color: #d9b072; background: #fdf6ec; }
  .badge[data-tone="bad"] { color: var(--danger); border-color: var(--danger); background: transparent; }
  @media (prefers-color-scheme: dark) { .badge[data-tone="wait"] { color: #f0bd81; border-color: #6b502c; background: #2a2216; } }
  .rec-id { margin: var(--space-2) 0 0; font-size: 13px; color: var(--text-muted); }
  .head-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-top: var(--space-4); }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); min-height: 36px; padding: 0 var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); font-size: 14px; }
  .btn:hover { background: var(--surface-2); }
  .btn--primary { background: var(--accent); border-color: var(--accent); color: var(--accent-contrast); font-weight: 600; }
  .btn--primary:hover { background: var(--focus); }
  .btn--danger { border-color: var(--danger); color: var(--danger); background: transparent; }
  .menu { position: relative; margin-left: auto; }
  .menu > summary { list-style: none; min-height: 36px; padding: 0 var(--space-3); display: inline-flex; align-items: center; gap: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text-muted); font-size: 14px; cursor: pointer; }
  .menu > summary::-webkit-details-marker { display: none; }
  .menu__panel { position: absolute; right: 0; top: calc(100% + 6px); z-index: 6; min-width: 196px; padding: var(--space-1); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); box-shadow: var(--shadow-1); }
  .menu__panel button { display: block; width: 100%; padding: var(--space-2) var(--space-3); border: 0; border-radius: var(--radius-sm); background: none; text-align: left; font-size: 14px; }
  .menu__panel button:hover { background: var(--surface-2); }

  /* —— 主区 + 侧栏：移动优先单列，≥900px 变两栏 —— */
  .layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-4); padding-bottom: var(--space-6); }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-1); padding: var(--space-5); }
  .card + .card { margin-top: var(--space-4); }
  .sec-head { margin-bottom: var(--space-3); }
  .sec-head p { font-size: 13px; color: var(--text-muted); }
  .kv { display: grid; gap: var(--space-3); }
  .kv div { display: grid; gap: 2px; }
  .kv dt { font-size: 13px; color: var(--text-muted); }
  .kv dd { font-size: 15px; overflow-wrap: anywhere; }
  .missing { color: var(--text-muted); font-style: normal; }
  .prose { max-width: var(--measure); font-size: 15.5px; line-height: 1.75; }
  .prose p + p { margin-top: var(--space-3); }
  .prose code { padding: 1px 5px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface-2); font-size: 13.5px; }
  .prose strong { font-weight: 600; }
  .prose .note { margin-top: var(--space-4); padding: var(--space-3) var(--space-4); border-left: 2px solid var(--accent); background: var(--surface-2); border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
  .prose .note p { font-size: 14px; color: var(--text-muted); }
  .prose .note strong { color: var(--text); }

  /* —— 活动时间线（嵌套不超过两层） —— */
  .tl { list-style: none; padding: 0; }
  .tl > li { position: relative; padding: 0 0 var(--space-5) 28px; border-left: 1px solid var(--border); }
  .tl > li:last-child { padding-bottom: 0; border-left-color: transparent; }
  .tl > li::before { content: ""; position: absolute; left: -1px; top: 6px; width: 9px; height: 9px; border-radius: 50%; background: var(--surface); border: 2px solid var(--border); }
  .tl > li[data-current]::before { background: var(--accent); border-color: var(--accent); }
  .tl__time { font-size: 12px; color: var(--text-muted); }
  .tl__title { margin-top: 2px; font-size: 15px; font-weight: 600; }
  .tl__by { margin-top: var(--space-1); font-size: 13px; color: var(--text-muted); }
  .tl__body { max-width: var(--measure); margin-top: var(--space-2); font-size: 14px; }
  .tl__sub { list-style: none; padding: 0; margin-top: var(--space-3); display: grid; gap: var(--space-3); }
  .tl__sub li { padding-left: var(--space-3); border-left: 1px solid var(--border); }
  .tl__sub p { max-width: var(--measure); font-size: 14px; }

  /* —— 侧栏 —— */
  .side { display: grid; gap: var(--space-4); align-content: start; }
  .side .card { padding: var(--space-4); }
  .side .kv dt { font-size: 12px; } .side .kv dd { font-size: 14px; }
  .tags { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .tags li { padding: 2px var(--space-2); border: 1px solid var(--border); border-radius: 999px; background: var(--surface-2); font-size: 12px; }
  .rel { list-style: none; padding: 0; display: grid; gap: var(--space-1); }
  .rel a { display: flex; align-items: baseline; gap: var(--space-2); padding: var(--space-2) 0; font-size: 14px; }

  /* —— 危险区 / 加载骨架 / 空态 —— */
  .danger { margin-top: var(--space-6); padding: var(--space-4); border: 1px solid var(--danger); border-radius: var(--radius); }
  .danger .sec-head h2 { display: flex; align-items: center; gap: var(--space-2); color: var(--danger); }
  .danger p { max-width: var(--measure); font-size: 14px; color: var(--text-muted); }
  .danger .actions { display: flex; flex-wrap: wrap; gap: var(--space-3); margin-top: var(--space-4); }
  .sk { border-radius: var(--radius-sm); background: var(--surface-2); }
  @media (prefers-reduced-motion: no-preference) { .sk { background-image: linear-gradient(90deg, var(--surface-2), var(--border), var(--surface-2)); background-size: 200% 100%; animation: sweep 1.4s linear infinite; } }
  @keyframes sweep { from { background-position: 200% 0; } to { background-position: -200% 0; } }
  .sk--title { width: 46%; height: 26px; }
  .sk--line { height: 12px; margin-top: var(--space-3); }
  .sk--w80 { width: 80%; } .sk--w60 { width: 60%; } .sk--w40 { width: 40%; }
  .empty { padding: var(--space-5); border: 1px dashed var(--border); border-radius: var(--radius); text-align: center; }
  .empty p { margin: 0 auto; max-width: 46ch; font-size: 14px; color: var(--text-muted); }
  .empty strong { display: block; margin-bottom: var(--space-2); font-size: 15px; color: var(--text); }
  .demo { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px dashed var(--border); }
  .demo p { font-size: 12px; color: var(--text-muted); }
  .demo button[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }

  /* ≥ 640px：键值对内联成两列；≥ 900px：侧栏落到右侧，窄屏时它在主区下方（文档顺序 = 阅读顺序） */
  @media (min-width: 640px) { .kv { grid-template-columns: 190px minmax(0, 1fr); gap: var(--space-2) var(--space-5); } .kv div { display: contents; } .kv dt { padding-top: 2px; } }
  @media (min-width: 900px) {
    h1 { font-size: 24px; }
    .wrap, .topbar__in { max-width: 1080px; }
    .layout { grid-template-columns: minmax(0, 1fr) 288px; gap: var(--space-5); align-items: start; }
    .page-head { padding: var(--space-6) 0 var(--space-5); }
  }
  @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
</style>
</head>
<body>
<!-- 图标一律内联 SVG（同文档 sprite）：零 CDN、零字体外链、零位图 -->
<svg width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute">
  <symbol id="i-back" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 5 3 12l7 7"/><path d="M3 12h13"/></symbol>
  <symbol id="i-more" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></symbol>
  <symbol id="i-alert" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></symbol>
  <symbol id="i-link" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/></symbol>
</svg>

<header class="topbar">
  <div class="topbar__in">
    <a class="back" href="#main"><svg class="i" aria-hidden="true"><use href="#i-back"/></svg>返回列表</a>
    <nav class="crumbs" aria-label="面包屑">
      <ol><li><a href="#main">售后</a></li><li><a href="#main">退款单</a></li><li aria-current="page">RF-20261012-0417</li></ol>
    </nav>
  </div>
</header>

<main class="wrap" id="main" tabindex="-1">
  <div class="page-head">
    <div class="head-row"><h1>上海鼎川电子 · 到货破损退款</h1><p class="badge" data-tone="wait">待质检</p></div>
    <p class="rec-id">退款单号 <span class="mono">RF-20261012-0417</span> · 来源渠道 线上自助提交</p>
    <div class="head-actions">
      <button type="button" class="btn btn--primary">推进到「质检通过」</button>
      <button type="button" class="btn">导出凭证</button>
      <details class="menu">
        <summary aria-haspopup="menu"><svg class="i" aria-hidden="true"><use href="#i-more"/></svg>更多操作</summary>
        <div class="menu__panel" role="menu">
          <button type="button" role="menuitem">指派处理人</button>
          <button type="button" role="menuitem">转交财务复核</button>
          <button type="button" role="menuitem">复制记录链接</button>
          <button type="button" role="menuitem">下载申请凭证 PDF</button>
        </div>
      </details>
    </div>
  </div>

  <div class="layout">
    <div>
      <!-- ===== 主区：加载骨架 ===== -->
      <section class="card" id="state-loading" aria-busy="true" hidden>
        <p class="vh" role="status">正在加载记录</p>
        <div class="sk sk--title"></div>
        <div class="sk sk--line sk--w80"></div>
        <div class="sk sk--line sk--w60"></div>
        <div class="sk sk--line sk--w40"></div>
      </section>

      <!-- ===== 主区：概览键值对（判断优先级排序，缺值写「未填写」） ===== -->
      <section class="card" id="state-ready" aria-labelledby="ov-h">
        <div class="sec-head"><h2 id="ov-h">申请概览</h2><p>判断是否放行所需的字段都在这组里，按处理优先级排列。</p></div>
        <dl class="kv">
          <div><dt>退款金额</dt><dd class="n">¥4,280.00（含运费 ¥60.00）</dd></div>
          <div><dt>申请原因</dt><dd>到货外包装破损，8 箱主板边角变形，客户拒收</dd></div>
          <div><dt>关联订单</dt><dd><a href="#main" class="mono">SO-20261008-0192</a> · 杭州云梯贸易</dd></div>
          <div><dt>收货仓库</dt><dd>华东仓（嘉兴）· 入库单 <span class="mono">IN-20261012-0063</span></dd></div>
          <div><dt>凭证材料</dt><dd>现场照片 6 张 · 物流破损签收单 1 份</dd></div>
          <div><dt>复核人</dt><dd><span class="missing">未填写</span>（等待财务分配）</dd></div>
        </dl>
      </section>

      <!-- ===== 主区：长文本（行宽 60ch） ===== -->
      <section class="card" aria-labelledby="desc-h">
        <div class="sec-head"><h2 id="desc-h">情况说明</h2><p>申请人填写原文，未做删改。</p></div>
        <div class="prose">
          <p>10 月 12 日上午 9 点 40 分，物流送来 <strong>12 箱</strong>主板，卸货时发现其中 8 箱外箱封条已被挤压开裂，开箱后确认主板边角存在不同程度变形。客户当场拒收并要求整单退款，剩余 4 箱外观完好，暂存在华东仓 B 区待处理。</p>
          <p>已按流程拍摄现场照片并请物流方在破损签收单上签字，签收单编号 <code>POD-20261012-118</code>。客服已在 11 点 15 分与客户电话沟通，客户接受「先质检后退款」的处理方式，但要求在本周内给出结论。</p>
          <blockquote class="note"><p><strong>质检提示：</strong>8 箱破损件需在 10 月 16 日前完成开箱抽检；若变形比例低于 5%，可转为部分退款并折价入库，无需整单退回。</p></blockquote>
        </div>
      </section>

      <!-- ===== 主区：活动时间线（倒序，嵌套回复不超过两层） ===== -->
      <section class="card" aria-labelledby="tl-h">
        <div class="sec-head"><h2 id="tl-h">活动记录</h2><p>时间戳格式 <span class="mono">YYYY-MM-DD HH:mm</span>（本机时区，精确到分钟）。</p></div>
        <ol class="tl">
          <li data-current>
            <p class="tl__time n"><time datetime="2026-10-14T15:42:00+08:00">2026-10-14 15:42</time></p>
            <h3 class="tl__title">提交质检结论</h3><p class="tl__by">操作人：周敏 · 华东仓质检组</p>
            <p class="tl__body">抽检 8 箱共 96 片主板，确认变形 7 片，变形比例 7.3%，高于 5% 的折价入库阈值，建议按整单退款处理。</p>
          </li>
          <li>
            <p class="tl__time n"><time datetime="2026-10-13T10:05:00+08:00">2026-10-13 10:05</time></p>
            <h3 class="tl__title">指派给华东仓质检组</h3><p class="tl__by">操作人：陈立 · 售后负责人</p>
            <ul class="tl__sub">
              <li><p class="tl__time n"><time datetime="2026-10-13T10:22:00+08:00">2026-10-13 10:22</time></p><p><strong>周敏：</strong>已接到工单，安排在 10 月 14 日抽检，届时同步抽检照片。</p></li>
              <li><p class="tl__time n"><time datetime="2026-10-13T10:31:00+08:00">2026-10-13 10:31</time></p><p><strong>陈立：</strong>抽检比例按 8 箱全检执行，不用抽样；结论需要附上每箱的照片编号。</p></li>
            </ul>
          </li>
          <li>
            <p class="tl__time n"><time datetime="2026-10-12T11:15:00+08:00">2026-10-12 11:15</time></p>
            <h3 class="tl__title">客服电话回访客户</h3><p class="tl__by">操作人：李玥 · 客户成功</p>
            <p class="tl__body">客户接受先质检后退款的处理节奏，约定本周内给出结论；沟通时长 8 分钟，已记入客户档案。</p>
          </li>
          <li>
            <p class="tl__time n"><time datetime="2026-10-12T09:52:00+08:00">2026-10-12 09:52</time></p>
            <h3 class="tl__title">创建退款单</h3><p class="tl__by">操作人：客户自助提交 · 系统生成</p>
          </li>
        </ol>
      </section>

      <!-- ===== 危险操作区：红色描边 + 后果说明，不用 emoji ===== -->
      <section class="danger" id="danger" aria-labelledby="danger-h">
        <div class="sec-head">
          <h2 id="danger-h"><svg class="i" aria-hidden="true"><use href="#i-alert"/></svg>删除这条退款申请</h2>
          <p>删除后申请记录、抽检照片与沟通记录会一并移除，退款金额不再计入本月对账，且没有回收站、无法撤销。若只是想终止流程，请改用「驳回申请」并填写原因。</p>
        </div>
        <div class="actions"><button type="button" class="btn btn--danger">删除退款申请</button></div>
      </section>

      <!-- ===== 状态演示（真实项目里由路由与数据决定，不放进交付页面） ===== -->
      <div class="demo">
        <p>状态演示：</p>
        <button type="button" class="btn" data-state="loading" aria-pressed="false">加载骨架</button>
        <button type="button" class="btn" data-state="empty" aria-pressed="false">空态</button>
        <button type="button" class="btn" data-state="ready" aria-pressed="true">正常内容</button>
      </div>

      <!-- ===== 主区：空态（诚实表达缺失字段，不留白） ===== -->
      <section class="card" id="state-empty" hidden>
        <div class="empty">
          <p><strong>这条记录尚未填写任何业务字段</strong>记录由渠道同步创建，名称、金额与申请原因均为空。请先补充「申请原因」与「收货仓库」，再推进状态。</p>
        </div>
      </section>
    </div>

    <!-- ===== 侧栏：归属 / 关键日期 / 标签 / 相关记录 ===== -->
    <aside class="side" aria-label="记录上下文">
      <section class="card" aria-labelledby="own-h">
        <div class="sec-head"><h2 id="own-h">归属</h2></div>
        <dl class="kv">
          <div><dt>当前负责人</dt><dd>周敏 · 华东仓质检组</dd></div>
          <div><dt>售后负责人</dt><dd>陈立</dd></div>
          <div><dt>客户</dt><dd>杭州云梯贸易</dd></div>
          <div><dt>业务线</dt><dd>企业级硬件 · 华东区</dd></div>
        </dl>
      </section>
      <section class="card" aria-labelledby="date-h">
        <div class="sec-head"><h2 id="date-h">关键日期</h2></div>
        <dl class="kv">
          <div><dt>创建时间</dt><dd class="n"><time datetime="2026-10-12T09:52:00+08:00">2026-10-12 09:52</time></dd></div>
          <div><dt>最后更新</dt><dd class="n"><time datetime="2026-10-14T15:42:00+08:00">2026-10-14 15:42</time></dd></div>
          <div><dt>承诺答复</dt><dd class="n"><time datetime="2026-10-16T18:00:00+08:00">2026-10-16 18:00</time></dd></div>
        </dl>
      </section>
      <section class="card" aria-labelledby="tag-h">
        <div class="sec-head"><h2 id="tag-h">标签</h2></div>
        <ul class="tags"><li>到货破损</li><li>整单退款</li><li>待抽检</li><li>华东仓</li><li>VIP 客户</li></ul>
      </section>
      <section class="card" aria-labelledby="rel-h">
        <div class="sec-head"><h2 id="rel-h">相关记录</h2><p>同一条业务链上的其他记录，按关联紧密度排列。</p></div>
        <ul class="rel">
          <li><a href="#main"><svg class="i" aria-hidden="true"><use href="#i-link"/></svg><span class="mono">SO-20261008-0192</span>原始订单</a></li>
          <li><a href="#main"><svg class="i" aria-hidden="true"><use href="#i-link"/></svg><span class="mono">IN-20261012-0063</span>入库单</a></li>
          <li><a href="#main"><svg class="i" aria-hidden="true"><use href="#i-link"/></svg><span class="mono">TK-20261012-0511</span>客服工单</a></li>
          <li><a href="#main"><svg class="i" aria-hidden="true"><use href="#i-link"/></svg>杭州云梯贸易 · 客户档案</a></li>
        </ul>
      </section>
    </aside>
  </div>
</main>

<script>
(function () {
  "use strict";
  var map = { ready: document.getElementById("state-ready"), loading: document.getElementById("state-loading"), empty: document.getElementById("state-empty") };
  var buttons = document.querySelectorAll("[data-state]");

  /* 状态切换只是演示：真实项目由路由与数据决定显示哪一种，三种状态同一时刻只能可见一个 */
  Array.prototype.forEach.call(buttons, function (btn) {
    btn.addEventListener("click", function () {
      var key = btn.getAttribute("data-state");
      Object.keys(map).forEach(function (k) { map[k].hidden = k !== key; });
      Array.prototype.forEach.call(buttons, function (b) { b.setAttribute("aria-pressed", String(b === btn)); });
    });
  });

  /* 溢出菜单：Esc 关闭并把焦点还给触发按钮；点面板外关闭 */
  var menu = document.querySelector(".menu");
  if (menu) {
    var summary = menu.querySelector("summary");
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && menu.open) { menu.open = false; summary.focus(); } });
    document.addEventListener("click", function (e) { if (menu.open && !menu.contains(e.target)) menu.open = false; });
  }
})();
</script>
</body>
</html>
```

---

## 落地前自检

- [ ] **零外部依赖**：无 CDN、无字体外链、无位图；图标全部是 `stroke="currentColor"` 的内联 SVG，无 emoji 充当图标或状态符号。
- [ ] **无紫蓝渐变、无渐变文字**；`--accent` 已按所选 `systems/<id>` 覆盖，页面可见强调色 ≤ 2 处（主操作、时间线当前节点）。
- [ ] **状态双通道**：徽标为「色点 + 文字」，色点 `aria-hidden`，去掉颜色后仍能读出状态；异常态另用 `--danger` 文字色而非仅换背景色。
- [ ] **语义正确**：`header` / `main` / `aside` 三个 landmark 齐全，键值对用 `dl > dt + dd`，时间线用 `ol`（顺序即语义），时间用 `<time datetime>`，页面级 `h1` 只有一个。
- [ ] **主区与侧栏边界**：参与「通过 / 驳回」判断的字段都在主区，侧栏只有归属、元数据、标签与外链；侧栏信息删掉后主流程仍可完成。
- [ ] **行宽**：长文本与时间线正文 `max-width: var(--measure)`（60ch，落在 45–75ch 区间）；标题与键值对不受此限。
- [ ] **缺值诚实**：不存在的字段渲染为「未填写」并保留 `dt` 行，没有留白、没有删行、没有编造占位数据；全文件无 lorem ipsum 与编造指标。
- [ ] **状态齐备**：加载骨架（`aria-busy` + `role="status"` 文案）与空态都能切出来看，且同一时刻只有一个状态可见。
- [ ] **焦点可见**：Tab 走查返回链接、主操作、溢出菜单、侧栏链接、删除按钮，焦点环瞬时出现（`:focus-visible` 不带 transition）；溢出菜单 `Esc` 关闭且焦点回到触发按钮。
- [ ] **断点实测**：320 / 640 / 900px 三档各看一眼——320px 下侧栏折到主区下方、无横向滚动，菜单面板不溢出视口；640px 起键值对变两列。
- [ ] **危险区**：位于页面最后、与正文物理隔离（1px `--danger` 描边 + `--space-6` 间距），标题与按钮动词都写明对象，并说明不可撤销与关联数据影响。
- [ ] **token 化**：正文无游离十六进制色值（仅 `:root` 与「待质检」徽标配色），间距只用 `--space-*` 六档；`transition` 未出现全属性写法。
