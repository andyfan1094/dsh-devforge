---
name: 数据表格页模板
description: 中文后台列表页的可直接打开骨架：工具栏＋五态齐备的表格＋分页，含排序、批量选择与 token 契约，接数据即用。
triggers:
  - 表格页模板
  - 列表页模板
  - 数据表格模板
  - CRUD 列表
  - 分页表格
  - data table template
  - list page template
od:
  category: template
---

# 数据表格页模板

**给你什么。** 一份零依赖、可直接用浏览器打开的中文后台列表页骨架：页面头（标题／一行描述／主操作）、工具栏（搜索＋状态筛选＋列设置＋主操作＋选中才出现的批量操作条）、一张带排序指示、数字右对齐、色点状态、溢出菜单的表格，以及完整的分页区。更要紧的是——五态里的「空态（无数据）」「空态（筛选无结果）」「加载骨架」「错误态」都给到了真实标记，不是一句"待补充"。

**什么时候用。** 凡是"一批同构记录 + 需要检索、筛选、翻页"的后台页面都用它：订单／工单／客户／成员／日志／审批流列表。原型阶段直接改示例数据即可演示；正式开发时把它当作结构基线，接你自己的数据源。

**怎么改。** ① 先按 `systems/<id>/tokens.css` 覆盖 `:root` 里的 token（本文件默认 `--accent: #1f6f5c`，只是个不犯红线的占位）；② 改表头与列顺序，低优先级列按注释里的隐藏策略调整；③ 换文案：三种空态与错误态的标题、说明、出口按钮都是给用户看的真话，必须按业务重写；④ 其余状态标记在后段 `<template id="state-*">` 里，按需取用，别把所有状态同时塞进 DOM。

## 页面结构

三块的职责边界要划清，否则最后会变成一团谁都能改的工具栏。

| 区域 | 职责 | 不该干的事 |
| --- | --- | --- |
| **工具栏** | 改变"查询条件"与"作用于选中集的操作"：搜索、筛选、列设置、主操作、批量操作条 | 不放单行操作（那是行的事）；不做数据统计（统计属于分页区或页面头） |
| **表格区** | 呈现同构记录，并承担排序、选择、行内入口 | 不做分页（不"加载到底再让用户滚"）；不放大段正文 |
| **分页区** | 回答"总量多少、现在第几页、一页多少条、怎么翻" | 不放筛选；不放批量操作；不在结果为 0 时消失 |
联动规则：**任何查询条件变化都重置到第 1 页**，否则用户会停在一个不存在的页码上看到空表。这条要在接数据时写进代码，不是写着好看。

## 五态怎么落地

| 状态 | 触发条件 | 必须包含 | 出口（用户下一步） |
| --- | --- | --- | --- |
| **加载** | 首次进入、切换筛选／翻页、手动刷新 | 与真实列宽对齐的骨架行（不是整页 spinner），外层 `aria-busy="true"` | 15 秒后补一句"比平时慢，仍在加载"；不要无限转 |
| **空 · 无数据** | 系统里一条记录都没有 | 标题＋一句解释＋主操作 | 「新建订单」——这是首次使用的引导位，不是空白 |
| **空 · 筛选无结果** | 有数据，但当前条件命中 0 条 | 复述当前条件（关键词＋筛选项）＋放宽建议＋清空筛选 | 「清空筛选条件」，绝不与"无数据"共用一套文案 |
| **错误** | 请求失败、5xx、超时 | 发生了什么＋为什么（可知时）＋怎么办＋可复制错误码 | 「重新加载」；连输三次后换成「联系支持」并把错误码交出去 |
| **有数据** | 正常返回 | 表格主态：列头、排序、行、行操作 | 翻页、排序、选中后批量处理 |
| **边界** | 超长文本、字段缺失、极端量级 | 见下 | —— |
**两种空必须分开。** 无数据是"你还没有东西"，筛选无结果是"你的条件太窄了"——把后者写成前者，用户会以为数据被删了。**错误不得并入空态**，那会藏掉故障。本模板给出的两条文案：
- 无数据：标题「还没有订单记录」，说明「客户下单后订单会自动出现在这里，也可以由你手动录入历史单据。」，出口「新建订单」。
- 筛选无结果：标题「没有符合条件的订单」，说明「当前条件：关键词「云栖」＋ 状态「待发货」。这批订单可能在其他状态里，或者关键词需要更短一些。」，出口「清空筛选条件」＋「查看全部订单」。
**边界约定：**
- **超长文本**（客户名 40 字、备注 200 字）：单元格 `overflow-wrap: anywhere` 不撑破布局；需要限高时用 `.cell-truncate` 并配 `title` 给出全文，不要裁掉却不告诉用户。
- **字段缺失**：渲染 `—`（`<span class="muted-cell">—</span>`）并保留单元格；不输出空白、`null`、`undefined`。
- **量级**：1 万条以上只认分页，不认"全部加载后再前端分页"。
- **移动端 320px**：低优先级列隐藏（见 CSS 第 10 节列优先级策略），单号／金额／状态必须还在。

## 可替换的 token

本模板在 `:root` 里定义全部契约，暗色由 `@media (prefers-color-scheme: dark)` 覆盖。接设计系统时只替换右列的值，别改类名。

| token | 作用 | 默认值 / 来源 |
| --- | --- | --- |
| `--bg` | 页面底色 | `#f6f7f6`；来自所选 DESIGN.md |
| `--surface` | 卡片、表格、输入框底 | `#ffffff` |
| `--surface-2` | 表头、次级块、禁用底 | `#f2f4f3` |
| `--border` | 分隔线、输入框描边 | `#dfe3e1` |
| `--text` | 正文与表头 | `#171a19` |
| `--text-muted` | 描述、次要列、占位符 | `#5d6b66`（对 `--surface` 保持 ≥4.5:1） |
| `--accent` | 主操作、选中态、排序激活 | `#1f6f5c` —— **占位值，按所选设计系统覆盖**；禁默认靛蓝 |
| `--accent-contrast` | 主操作上的文字 | `#ffffff` |
| `--focus` | 焦点环颜色 | `#1f6f5c`；须与相邻底色对比 ≥3:1 |
| `--radius` | 圆角基准 | `8px` |
| `--space-1` … `--space-6` | 间距阶（4/8/12/16/24/32） | 与设计系统对齐时整体换算，别逐项手改 |
| `--font-sans` | 界面字体 | `system-ui, -apple-system, "Segoe UI", "Noto Sans SC", sans-serif`（零外链；禁 Inter/Roboto 当 display 脸） |
| `--font-mono` | 单号、错误码 | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` |
| `--shadow-1` | 浮层与表格容器阴影 | `0 1px 2px rgba(16,24,20,.06), 0 1px 3px rgba(16,24,20,.04)` |
| `--row-h` | 行高 | `44px`（拇指可点；数据密集型可降到 `40px`） |
| `--cell-pad-x` | 单元格左右内边距 | `var(--space-3)`（`12px`） |
| `--ok` / `--warn` / `--danger` / `--info` | 状态语义色（色点＋文本） | `#1f6f5c` / `#8a5a00` / `#a3341f` / `#2f5d8a`；**颜色永远配文字** |

## 骨架（单文件 HTML，零外部依赖）

```html
<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>订单列表 · 后台</title><style>
/* ===== 1. token 契约（接设计系统时只改这里） ===== */
:root {
  --bg:#f6f7f6; --surface:#fff; --surface-2:#f2f4f3; --border:#dfe3e1;
  --text:#171a19; --text-muted:#5d6b66;
  --accent:#1f6f5c;            /* 占位：按所选设计系统覆盖，禁默认靛蓝 */
  --accent-contrast:#fff; --focus:#1f6f5c; --radius:8px;
  --space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px; --space-5:24px; --space-6:32px;
  --font-sans:system-ui,-apple-system,"Segoe UI","Noto Sans SC",sans-serif;
  --font-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --shadow-1:0 1px 2px rgba(16,24,20,.06),0 1px 3px rgba(16,24,20,.04);
  --row-h:44px;                          /* 表格专用 */
  --cell-pad-x:var(--space-3);
  --ok:#1f6f5c; --warn:#8a5a00; --danger:#a3341f; --info:#2f5d8a;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg:#101312; --surface:#171b1a; --surface-2:#1e2422; --border:#2b3230;
    --text:#e8ebe9; --text-muted:#9aa6a1;
    --accent:#4fb396; --accent-contrast:#0b1512; --focus:#4fb396;
    --shadow-1:0 1px 2px rgba(0,0,0,.5),0 1px 3px rgba(0,0,0,.35);
    --ok:#4fb396; --warn:#d8a13a; --danger:#e8735c; --info:#79aede;
  }
}
/* ===== 2. 基础 ===== */
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;padding:var(--space-5) var(--space-4) var(--space-6);background:var(--bg);color:var(--text);font:14px/1.6 var(--font-sans)}
h1{margin:0;font-size:20px;line-height:1.35;font-weight:650;letter-spacing:-.01em}
p{margin:0}
button,input,select{font:inherit;color:inherit}
main{max-width:1180px;margin:0 auto}
/* 焦点环：瞬时出现，全文件不含任何过渡动画 */
a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.skip-link{position:absolute;left:var(--space-4);top:-4rem;z-index:20;padding:var(--space-2) var(--space-3);border-radius:var(--radius);background:var(--surface);color:var(--text);box-shadow:var(--shadow-1)}
.skip-link:focus{top:var(--space-4)}
/* ===== 3. 页面头与按钮 ===== */
.page-head{display:flex;flex-wrap:wrap;gap:var(--space-3) var(--space-4);align-items:flex-end;justify-content:space-between;margin-bottom:var(--space-5)}
.page-desc{margin-top:var(--space-1);color:var(--text-muted);font-size:13px}
.btn{display:inline-flex;align-items:center;gap:var(--space-1);min-height:36px;padding:0 var(--space-3);border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);color:var(--text);cursor:pointer}
.btn:hover:not(:disabled){background:var(--surface-2)}
.btn-primary{background:var(--accent);border-color:var(--accent);color:var(--accent-contrast);font-weight:600}
.btn-primary:hover:not(:disabled){filter:brightness(1.08)}
.btn:disabled{background:var(--surface-2);color:var(--text-muted);cursor:not-allowed}
.btn-plain{border-color:transparent;background:transparent;color:var(--text-muted)}
.btn-plain:hover:not(:disabled){background:var(--surface-2);color:var(--text)}
.icon-btn{display:inline-grid;place-items:center;width:32px;height:32px;border:1px solid transparent;border-radius:var(--radius);background:transparent;color:var(--text-muted);cursor:pointer}
.icon-btn:hover{background:var(--surface-2);color:var(--text)}
/* ===== 4. 工具栏与批量操作条 ===== */
.toolbar{display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:center;margin-bottom:var(--space-4)}
.field{display:flex;align-items:center;gap:var(--space-1);min-height:36px;padding:0 var(--space-2) 0 var(--space-3);border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);color:var(--text-muted)}
.field:focus-within{border-color:var(--accent)}
.field input,.field select{min-width:0;height:34px;border:0;background:transparent;color:var(--text);outline:0} /* 焦点由 .field:focus-within 与全局 :focus-visible 承接 */
.field-search{flex:1 1 220px}
.field-search input{width:100%}
.toolbar-spacer{flex:1 1 auto}
.bulkbar{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);padding:var(--space-1) var(--space-1) var(--space-1) var(--space-3);border:1px solid var(--accent);border-radius:var(--radius);background:var(--surface-2)}
.bulkbar[hidden]{display:none}
.bulkbar-count{font-weight:600;font-variant-numeric:tabular-nums}
/* ===== 5. 表格 ===== */
.table-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface);box-shadow:var(--shadow-1)} /* 移动端横向滚动兜底 */
table{width:100%;min-width:880px;border-collapse:collapse}
caption{text-align:start}
th,td{padding:0 var(--cell-pad-x);text-align:start;vertical-align:middle;border-bottom:1px solid var(--border);overflow-wrap:anywhere}
thead th{position:sticky;top:0;z-index:1;height:40px;background:var(--surface-2);color:var(--text-muted);font-size:12px;font-weight:600;letter-spacing:.02em;white-space:nowrap}
tbody tr{height:var(--row-h)}
tbody tr:last-child th,tbody tr:last-child td{border-bottom:0}
tbody tr:hover{background:var(--surface-2)}
.col-num{width:44px;text-align:center}
.col-actions{width:56px;text-align:center}
.num{text-align:end;font-variant-numeric:tabular-nums}
.mono{font-family:var(--font-mono);font-size:13px}
.muted-cell{color:var(--text-muted)}
.cell-truncate{display:block;max-width:22ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 可排序列：aria-sort 是唯一状态源，图标方向跟随它 */
.sort-btn{display:inline-flex;align-items:center;gap:var(--space-1);margin:0 calc(var(--cell-pad-x) * -1);padding:var(--space-1) var(--cell-pad-x);border:0;background:transparent;color:inherit;font:inherit;cursor:pointer}
.sort-btn:hover{color:var(--text)}
.sort-btn svg{flex:none;opacity:.4}
th[aria-sort="ascending"] .sort-btn,th[aria-sort="descending"] .sort-btn{color:var(--text)}
th[aria-sort="ascending"] .sort-btn svg,th[aria-sort="descending"] .sort-btn svg{opacity:1}
/* 状态：色点 + 文本，颜色永不单独承载语义 */
.status{display:inline-flex;flex-wrap:wrap;align-items:center;gap:var(--space-2)}
.dot{flex:none;width:8px;height:8px;border-radius:50%;background:currentColor}
.st-ok{color:var(--ok)} .st-warn{color:var(--warn)} .st-info{color:var(--info)} .st-off{color:var(--text-muted)}
/* ===== 6. 分页 ===== */
.pagination{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-3);margin-top:var(--space-4);font-size:13px;color:var(--text-muted)}
.pagination-spacer{flex:1 1 auto}
.pagination .field{min-height:32px}
.page-current{color:var(--text);font-weight:600;font-variant-numeric:tabular-nums}
/* ===== 7. 状态块：空态与错误态共用一套结构 ===== */
.page-state{display:grid;gap:var(--space-2);justify-items:center;padding:var(--space-6) var(--space-4);text-align:center}
.page-state-icon{display:grid;place-items:center;width:40px;height:40px;border:1px solid var(--border);border-radius:var(--radius);background:var(--surface-2);color:var(--text-muted)}
.page-state h2{margin:0;font-size:15px;font-weight:650}
.page-state p{max-width:46ch;color:var(--text-muted);font-size:13px}
.page-state-actions{display:flex;flex-wrap:wrap;gap:var(--space-2);justify-content:center;margin-top:var(--space-1)}
.empty-query{color:var(--text);font-weight:600}
.err-code{font-family:var(--font-mono);font-size:12px;padding:2px var(--space-1);border-radius:calc(var(--radius) / 2);background:var(--surface-2)}
/* ===== 8. 加载骨架 ===== */
.skeleton-bar{display:block;height:12px;border-radius:4px;background:var(--surface-2);animation:skeleton-pulse 1.4s ease-in-out infinite}
@keyframes skeleton-pulse{0%,100%{opacity:1}50%{opacity:.5}}
.row-skeleton td{border-bottom:1px solid var(--border)}
/* ===== 9. 列优先级（移动优先，320px 起可用） =====
   ≤720px 隐藏低优先级列；320px 仍保留 复选框/单号/金额/状态/行操作。
   需要按用户偏好动态控制时，把 .col-md 换成给对应 <th>/<td> 加 hidden 属性。 */
@media (max-width:720px){
  .col-md{display:none}
  table{min-width:600px}
  body{padding:var(--space-4) var(--space-3) var(--space-5)}
}
@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:.001ms !important;animation-iteration-count:1 !important}
}
</style>
</head>
<body>
<a class="skip-link" href="#orders-region">跳到订单列表</a>
<main>
  <!-- ===== 页面头 ===== --><header class="page-head"><div>
      <h1>订单列表</h1>
      <p class="page-desc">共 48 条订单，按创建时间倒序排列。筛选条件变化后会回到第 1 页。</p></div><button class="btn btn-primary" type="button">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg>
      新建订单
    </button></header>
  <!-- ===== 工具栏：搜索 / 筛选 / 列设置 / 主操作 / 批量操作条 ===== --><div class="toolbar" role="search"><div class="field field-search">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.25"/><path d="M10.2 10.2 13.5 13.5"/></svg>
      <label class="sr-only" for="q">搜索订单号或客户名称</label>
      <input id="q" type="search" placeholder="搜索订单号或客户名称" autocomplete="off"></div><div class="field field-select">
      <label class="sr-only" for="status-filter">按状态筛选</label><select id="status-filter">
        <option value="">全部状态</option>
        <option value="paid">待发货</option>
        <option value="shipped">已发货</option>
        <option value="done">已完成</option>
        <option value="canceled">已取消</option></select></div><button class="btn" type="button" aria-haspopup="true" aria-expanded="false">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M2.5 4.5h11M4.5 8h7M6.5 11.5h3"/></svg>
      列设置
    </button><span class="toolbar-spacer"></span>
    <!-- 批量操作条：未选中时保持 hidden；选中后由脚本移除 hidden 并更新计数 --><div class="bulkbar" id="bulkbar" role="status" aria-live="polite" hidden>
      <span class="bulkbar-count">已选 <span id="bulk-count">0</span> 项</span>
      <button class="btn" type="button">导出所选</button>
      <button class="btn" type="button">批量发货</button>
      <button class="btn btn-plain" type="button" id="bulk-clear">清空选择</button></div></div>
  <!-- ===== 表格区（有数据态） ===== --><div class="table-wrap" id="orders-region"><table>
      <caption class="sr-only">订单列表，共 48 条，当前显示第 1 页的第 1 至 7 条</caption><thead><tr>
          <th class="col-num" scope="col"><input type="checkbox" id="select-all" aria-label="全选本页订单"></th><th scope="col" aria-sort="none">
            <button class="sort-btn" type="button">订单号<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9.5 6 2.5M3.5 5 6 2.5 8.5 5M3.5 7 6 9.5 8.5 7"/></svg></button>
          </th>
          <th scope="col">客户</th>
          <th class="col-md" scope="col">下单时间</th><th scope="col" aria-sort="descending">
            <button class="sort-btn" type="button">金额（元）<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9.5 6 2.5M3.5 5 6 2.5 8.5 5M3.5 7 6 9.5 8.5 7"/></svg></button>
          </th>
          <th class="col-md num" scope="col">件数</th>
          <th scope="col">状态</th>
          <th class="col-actions" scope="col"><span class="sr-only">行操作</span></th></tr></thead><tbody><tr>
          <td class="col-num"><input type="checkbox" class="row-check" aria-label="选择订单 DD20261014-0031"></td><td class="mono">DD20261014-0031</td>
          <td>杭州云栖电商有限公司</td><td class="col-md muted-cell">2026-10-14 09:12</td><td class="num">12,480.00</td><td class="col-md num">3</td>
          <td><span class="status st-ok"><span class="dot" aria-hidden="true"></span>已完成</span></td>
          <td class="col-actions"><button class="icon-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="订单 DD20261014-0031 的更多操作"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12.5" cy="8" r="1.4"/></svg></button></td>
        </tr><tr>
          <td class="col-num"><input type="checkbox" class="row-check" aria-label="选择订单 DD20261014-0030"></td><td class="mono">DD20261014-0030</td>
          <td>宁波华信五金制造厂</td><td class="col-md muted-cell">2026-10-14 08:40</td><td class="num">3,260.50</td><td class="col-md num">18</td>
          <td><span class="status st-warn"><span class="dot" aria-hidden="true"></span>待发货</span></td>
          <td class="col-actions"><button class="icon-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="订单 DD20261014-0030 的更多操作"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12.5" cy="8" r="1.4"/></svg></button></td>
        </tr><tr>
          <td class="col-num"><input type="checkbox" class="row-check" aria-label="选择订单 DD20261013-0029"></td><td class="mono">DD20261013-0029</td>
          <td>成都锦江餐饮管理有限公司</td><td class="col-md muted-cell">2026-10-13 17:55</td><td class="num">8,900.00</td><td class="col-md num">6</td>
          <td><span class="status st-info"><span class="dot" aria-hidden="true"></span>已发货</span></td>
          <td class="col-actions"><button class="icon-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="订单 DD20261013-0029 的更多操作"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12.5" cy="8" r="1.4"/></svg></button></td>
        </tr><tr>
          <td class="col-num"><input type="checkbox" class="row-check" aria-label="选择订单 DD20261013-0028"></td><td class="mono">DD20261013-0028</td>
          <td>深圳市明泰电子有限公司</td><td class="col-md muted-cell">2026-10-13 15:03</td><td class="num">26,750.00</td><td class="col-md num">42</td>
          <td><span class="status st-warn"><span class="dot" aria-hidden="true"></span>待发货</span></td>
          <td class="col-actions"><button class="icon-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="订单 DD20261013-0028 的更多操作"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12.5" cy="8" r="1.4"/></svg></button></td>
        </tr><tr>
          <td class="col-num"><input type="checkbox" class="row-check" aria-label="选择订单 DD20261013-0027"></td><td class="mono">DD20261013-0027</td>
          <td>苏州吴中区鲜丰生鲜超市</td><td class="col-md muted-cell">2026-10-13 11:26</td><td class="num">1,180.00</td><td class="col-md num">2</td>
          <td><span class="status st-off"><span class="dot" aria-hidden="true"></span>已取消</span></td>
          <td class="col-actions"><button class="icon-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="订单 DD20261013-0027 的更多操作"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12.5" cy="8" r="1.4"/></svg></button></td>
        </tr><tr>
          <td class="col-num"><input type="checkbox" class="row-check" aria-label="选择订单 DD20261012-0026"></td><td class="mono">DD20261012-0026</td>
          <td><span class="cell-truncate" title="北京朝阳区博远教育培训中心（望京校区）">北京朝阳区博远教育培训中心（望京校区）</span></td><td class="col-md muted-cell">2026-10-12 20:14</td><td class="num">15,300.00</td>
          <td class="col-md num">9</td>
          <td><span class="status st-ok"><span class="dot" aria-hidden="true"></span>已完成</span></td>
          <td class="col-actions"><button class="icon-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="订单 DD20261012-0026 的更多操作"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12.5" cy="8" r="1.4"/></svg></button></td>
        </tr><tr>
          <td class="col-num"><input type="checkbox" class="row-check" aria-label="选择订单 DD20261012-0025"></td><td class="mono">DD20261012-0025</td>
          <td>武汉光谷智造设备租赁部</td><td class="col-md muted-cell">2026-10-12 16:48</td><td class="num">4,020.00</td><td class="col-md"><span class="muted-cell">—</span></td>
          <td><span class="status st-info"><span class="dot" aria-hidden="true"></span>已发货</span></td>
          <td class="col-actions"><button class="icon-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="订单 DD20261012-0025 的更多操作"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12.5" cy="8" r="1.4"/></svg></button></td>
        </tr></tbody>
    </table>
  </div>
  <!-- ===== 分页区：共 N 条 / 每页条数 / 上一页 / 当前页 / 下一页 ===== -->
  <nav class="pagination" aria-label="订单列表分页">
    <span>共 <strong>48</strong> 条</span><div class="field field-select">
      <label class="sr-only" for="page-size">每页显示条数</label><select id="page-size">
        <option value="10" selected>每页 10 条</option>
        <option value="20">每页 20 条</option>
        <option value="50">每页 50 条</option></select></div><span class="pagination-spacer"></span><button class="btn" type="button" disabled>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>
      上一页
    </button>
    <span class="page-current">第 1 / 5 页</span><button class="btn" type="button">
      下一页
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>
    </button></nav>
  <!-- ===== 状态演示：三张 <template> 默认不渲染。
       接数据时把它们的内容挂到表格区外层（替换或覆盖 .table-wrap），并记得去掉容器上的 hidden 与 aria-hidden。 ===== --><section class="state-demos" hidden aria-hidden="true">
    <!-- 空态 A：系统里还没有任何记录（首次使用） --><template id="state-empty-firstuse"><div class="page-state"><span class="page-state-icon">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6.5 10 3l7 3.5v7L10 17l-7-3.5z"/><path d="M3 6.5 10 10l7-3.5M10 10v7"/></svg>
        </span>
        <h2>还没有订单记录</h2>
        <p>客户下单后订单会自动出现在这里，也可以由你手动录入历史单据。</p>
        <div class="page-state-actions"><button class="btn btn-primary" type="button">新建订单</button></div></div></template>
    <!-- 空态 B：筛选条件命中 0 条（复述当前条件 + 清空出口） --><template id="state-empty-noresult"><div class="page-state"><span class="page-state-icon">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="9" r="5.25"/><path d="M12.8 12.8 17 17"/></svg>
        </span>
        <h2>没有符合条件的订单</h2>
        <p>当前条件：关键词「<span class="empty-query">云栖</span>」＋ 状态「<span class="empty-query">待发货</span>」。这批订单可能在其他状态里，或者关键词需要更短一些。</p><div class="page-state-actions">
          <button class="btn btn-primary" type="button">清空筛选条件</button>
          <button class="btn" type="button">查看全部订单</button></div></div></template>
    <!-- 错误态：发生了什么 + 为什么 + 怎么办 + 可复制错误码（不得并入空态） --><template id="state-error"><div class="page-state" role="alert"><span class="page-state-icon">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="M10 6.5v4.5M10 13.6h.01"/></svg>
        </span>
        <h2>订单数据加载失败</h2>
        <p>服务器返回 503，订单服务的数据库连接在 12:04 中断。你的筛选条件已保留，重新加载即可继续。</p>
        <p>错误码 <code class="err-code">ORD-LIST-503-8f21</code>，联系支持时请附上。</p><div class="page-state-actions">
          <button class="btn btn-primary" type="button">重新加载</button>
          <button class="btn" type="button">复制错误码</button></div></div></template>
    <!-- 加载骨架：替换 tbody 内容即可；外层要加 aria-busy="true" --><template id="state-loading"><table>
        <caption class="sr-only">订单列表正在加载</caption><tbody aria-busy="true"><tr class="row-skeleton"><td class="col-num"><span class="skeleton-bar" style="width:16px;height:16px"></span></td>
            <td><span class="skeleton-bar" style="width:132px"></span></td><td><span class="skeleton-bar" style="width:180px"></span></td>
            <td class="col-md"><span class="skeleton-bar" style="width:112px"></span></td><td class="num"><span class="skeleton-bar" style="width:72px;margin-left:auto"></span></td>
            <td class="col-md num"><span class="skeleton-bar" style="width:24px;margin-left:auto"></span></td><td><span class="skeleton-bar" style="width:64px"></span></td>
            <td class="col-actions"><span class="skeleton-bar" style="width:16px;margin:0 auto"></span></td></tr><tr class="row-skeleton">
            <td class="col-num"><span class="skeleton-bar" style="width:16px;height:16px"></span></td><td><span class="skeleton-bar" style="width:132px"></span></td>
            <td><span class="skeleton-bar" style="width:150px"></span></td><td class="col-md"><span class="skeleton-bar" style="width:112px"></span></td>
            <td class="num"><span class="skeleton-bar" style="width:88px;margin-left:auto"></span></td>
            <td class="col-md num"><span class="skeleton-bar" style="width:24px;margin-left:auto"></span></td><td><span class="skeleton-bar" style="width:64px"></span></td>
            <td class="col-actions"><span class="skeleton-bar" style="width:16px;margin:0 auto"></span></td></tr><tr class="row-skeleton">
            <td class="col-num"><span class="skeleton-bar" style="width:16px;height:16px"></span></td><td><span class="skeleton-bar" style="width:132px"></span></td>
            <td><span class="skeleton-bar" style="width:200px"></span></td><td class="col-md"><span class="skeleton-bar" style="width:112px"></span></td>
            <td class="num"><span class="skeleton-bar" style="width:64px;margin-left:auto"></span></td>
            <td class="col-md num"><span class="skeleton-bar" style="width:24px;margin-left:auto"></span></td><td><span class="skeleton-bar" style="width:64px"></span></td>
            <td class="col-actions"><span class="skeleton-bar" style="width:16px;margin:0 auto"></span></td></tr></tbody></table></template></section></main>
<script>
/* 最小交互层：全选 / 半选 / 批量条显隐 / 清空选择。
   半选（indeterminate）是"部分选中"唯一的表达，属性只能由脚本设置，CSS 无法替代。 */
(function () {
  var all = document.getElementById('select-all');
  var bulkbar = document.getElementById('bulkbar');
  var count = document.getElementById('bulk-count');
  var clear = document.getElementById('bulk-clear');
  function rows() { return [].slice.call(document.querySelectorAll('.row-check')); }
  function sync() {
    var list = rows();
    var picked = list.filter(function (c) { return c.checked; });
    all.checked = list.length > 0 && picked.length === list.length;      /* 全选 */
    all.indeterminate = picked.length > 0 && picked.length < list.length; /* 半选 */
    count.textContent = String(picked.length);
    bulkbar.hidden = picked.length === 0;
  }
  all.addEventListener('change', function () {
    rows().forEach(function (c) { c.checked = all.checked; });
    sync();
  });
  rows().forEach(function (c) { c.addEventListener('change', sync); });
  clear.addEventListener('click', function () {
    rows().forEach(function (c) { c.checked = false; });
    all.checked = false;
    all.indeterminate = false;
    sync();
    all.focus();  /* 清空后焦点还给全选，键盘用户不用重新找位置 */
  });
  /* 排序按钮只翻 aria-sort 取值（真实排序接数据时再补）；图标方向由 CSS 跟随 aria-sort。 */
  document.querySelectorAll('.sort-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var th = btn.closest('th');
      var next = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
      th.setAttribute('aria-sort', next);
      document.querySelectorAll('th[aria-sort]').forEach(function (other) {
        if (other !== th) other.setAttribute('aria-sort', 'none');
      });
    });
  });
})();
</script></body></html>
```

## 落地前自检

- [ ] 单文件零外部依赖：无 CDN、无字体外链、无图片；所有图标都是内联 SVG，没有一处 emoji 当图标。
- [ ] `:root` 里 token 契约齐全，暗色由 `@media (prefers-color-scheme: dark)` 覆盖；正文没有裸 hex（状态色只在 `:root` 定义一次）。
- [ ] `--accent` 已按所选设计系统覆盖，不是默认靛蓝，全文无渐变、无渐变文字。
- [ ] 焦点环为 `:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px }` 且瞬时出现；全文件搜索不到过渡动画声明，更没有 transition-all 这种写法。
- [ ] 320px 视口下正文不横向溢出，表格容器内部可横向滚动，核心列（单号／金额／状态）仍在。
- [ ] 表格有 `caption`（可为 `sr-only`）；每个表头 `th` 带 `scope="col"`；排序列带 `aria-sort` 且图标方向跟随该属性，当前排序列实心、其余淡化。
- [ ] 金额与件数右对齐并启用 `tabular-nums`，金额带千分位与两位小数。
- [ ] 状态列是"色点＋中文文本"双通道；字段缺失显示 `—` 而非空白；超长客户名用 `.cell-truncate` 且带 `title` 全文。
- [ ] 全选复选框会进入 `indeterminate` 半选态；批量条仅在选中数 >0 时出现，含"已选 N 项"与清空出口，清空后焦点回到全选。
- [ ] 行操作收进溢出菜单（`aria-haspopup`＋动态 `aria-expanded`＋含订单号的 `aria-label`），行内没有堆三个按钮。
- [ ] 分页含"共 N 条／每页条数／上一页／当前页／下一页"，首末页按钮为 disabled 态；筛选变化重置到第 1 页。
- [ ] 五态齐全：有数据（主表格）、加载骨架（列宽对齐，非整页 spinner）、两种空态文案分开、错误态含原因与可复制错误码。示例数据全为可信的中文业务数据，无 lorem ipsum、无编造指标（如"提升 300%"）。
- [ ] 桌面与移动至少两档截图亲眼看过了，而不是只看代码。
