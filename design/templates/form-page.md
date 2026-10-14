---
name: 表单页模板
description: 中文后台单列表单页的可直接打开骨架：页头、错误汇总区、字段流、粘性操作栏与无障碍接线一次给全。
triggers:
  - 表单页模板
  - 表单模板
  - 新建表单
  - 编辑表单
  - 单列表单
  - form template
  - form page
od:
  category: template
---

# 表单页模板

中文后台 / 控制台场景的**单列表单页骨架**：面包屑返回、页头标题与一行描述、错误汇总区、单列字段流（文本、下拉、单选、复选、日期区间、文本域、开关）、字段级帮助与错误接线、粘性底栏，以及危险操作区。适用「新建 / 编辑一条业务记录」这类**一次改一个对象、字段数 6–15 个**的表单；不含多步骤向导、批量编辑、行内可编辑表格——那三种该换骨架，不是在单列表单上打补丁。

骨架是自包含的单文件 HTML，零外部依赖，存成 `.html` 双击就能在浏览器里看真实状态。复制它当起点时先看「可替换的 token」，把变量指到所选设计系统的 `tokens.css` 再改字段；字段本身只是示例。校验时机、错误播报与跨端 schema 契约见 `craft/form-validation.md`，本文件只负责**骨架长什么样**。

## 布局规则

**为什么单列。** 中文后台的字段标签多为 2–6 个汉字、长短不一；两列并排会让标签无法对齐到同一条竖线上，眼睛要在列之间来回扫，填错和漏填都变多。单列的路径是确定的：读完一行、往下走一行。只有字段少（≤5）且彼此无关时才允许两列，且宽度固定、不随容器拉伸。

**标签位置。** 一律标签在控件上方，不用浮动标签、不用内联标签、更不用 placeholder 冒充标签。中文标签在小字号下会变宽，浮动标签为了塞进控件内只能截断或缩字号；等用户开始输入、placeholder 消失，上下文就没了。标签与控件间距 `--space-2`。

**间距比例按 1:2 走。** 标签 → 控件 → 帮助文本 `--space-2`（8px）；字段与字段之间 `--space-4`（16px）；组 / 小节之间 `--space-6`（32px，正好是字段间距的两倍）。分组靠留白和一个 `h2` 表达，不靠多画分割线。

**输入框宽度与内容匹配。** `--field-max: 420px` 是**上限不是目标**：文本、下拉、文本域取到 420px 就停；手机号、日期这类定长内容再窄一点（180–220px），并显式给它 `max-width`。把单行文本输入拉到 1200px 宽不是"大气"，是没做决定。宽度写成 `width: 100%; max-width: …`，不写固定 px，320px 起就不溢出。

### 操作区：粘性底栏与危险操作区

粘性底栏（`position: sticky; bottom: 0`）只放**一个主操作 + 一个取消**，并补 `env(safe-area-inset-bottom)`。主操作窄屏占满整行、宽屏收成自适应宽度（`flex: 1 1 160px` → `flex: 0 0 auto`）；底栏背景用不透明的页面底色，滚动时字段不会从按钮之间穿过去。

**危险操作区**不进底栏——紧挨主操作等于给误触发请帖。写法：与主表单之间用 `hr` 隔开，独立 `section` + 带明确动词的标题，按钮默认不聚焦、用 `--danger` 描边而不是实心红，并要求二次确认。带删除 / 财务后果的提交，按 WCAG 3.3.4 至少提供「可撤销、二次确认、提交前摘要」三者之一。

```html
<hr class="rule">
<section class="danger-zone" aria-labelledby="danger-title">
  <h2 id="danger-title">停用或删除客户</h2>
  <p>停用后该客户从选择器与统计中移除，数据保留；删除不可恢复。</p>
  <button class="btn btn--danger" type="button">删除该客户</button>
</section>
```

## 错误与帮助文本

**位置契约。** 错误消息紧贴控件下沿——那是视线离开控件后的第一落点；帮助文本排在错误之后。帮助是常驻信息，错误是临时打断，所以错误出现时只把帮助往下推，不覆盖、不替换任何内容。计数与帮助同行左右分列，计数右对齐并加 `font-variant-numeric: tabular-nums`，数字跳动才不晃眼。

**两条播报路径要分开。**（一）提交失败 → 汇总区：容器带 `tabindex="-1"`，标题写清问题数量，`<ul>` 每条是一个锚点链接；它**不带 `role="alert"`**，因为焦点移动本身已触发播报，再加 alert 会读两遍。显示顺序固定为「先 `hidden = false` 渲染、再 `.focus()`」——`hidden` 元素不可聚焦，顺序反了等于什么都没发生。（二）焦点不动时冒出来的字段级错误 → 独立节点（`role="alert"`），别复用汇总区，详见 `craft/form-validation.md`。

**汇总区跳到字段用的是什么机制。** 每条写成 `a[href="#字段id"]`，同时监听汇总区点击：取 `hash` 找到控件、`field.focus()`，再 `preventDefault()`。纯锚点跳转只保证滚动到位，键盘焦点还停在汇总区的链接上，键盘用户得自己 Tab 过去；补一次 `focus()` 才让"跳到问题字段"在键盘上成立。链接文案必须是「字段名 + 具体问题」，不要写"查看详情"。

**字段级接线（三个属性）。** `aria-invalid` 只在错误态为 `"true"`、其余保持 `"false"`（CSS 直接选 `[aria-invalid="true"]`，不靠删属性回默认）；**分组控件（单选 / 复选 / 日期区间）的错误挂在 `fieldset` 上**，不挂在某一个选项上，跨字段规则（如结束日期晚于开始日期）也用这个节点。`aria-describedby` 里的**错误 id 建议在错误出现时才追加、消失时移除**：被 `aria-describedby` 引用的隐藏节点，在部分读屏器里仍会算进描述文本，会变成「还没报错就先念一遍错误」——骨架 JS 已按这个逻辑处理。骨架也不给 `<form>` 写 `novalidate`，而是由 JS 置 `form.noValidate = true`：禁用 JS 时用户仍拿到浏览器原生校验。

```html
<label for="customer-phone">手机号</label>
<input id="customer-phone" required pattern="1[3-9][0-9]{9}"
       aria-describedby="customer-phone-help"
       aria-invalid="false">
<p class="field__help" id="customer-phone-help">…</p>
<p class="field__error" id="customer-phone-error" hidden>…</p>
```

## 可替换的 token

全部在 `:root` 定义，暗色用 `@media (prefers-color-scheme: dark)` 覆盖成对颜色。

| 变量 | 用途 | 模板默认 | 换成设计系统时取自 |
| --- | --- | --- | --- |
| `--bg` | 页面底色 | `#f6f7f6` / 暗 `#121614` | `systems/<id>/tokens.css` 的 `--background` |
| `--surface` | 控件与卡片表面 | `#ffffff` | `--card` |
| `--surface-2` | 次级表面（开关轨道、选中底） | `#f0f2f1` | `--muted` / `--secondary` |
| `--border` | 控件描边与分隔线 | `#d7dcd9` | `--border` / `--input` |
| `--text` | 正文 | `#17201d` | `--foreground` |
| `--text-muted` | 帮助文本、计数、面包屑、必填星号 | `#5c6764` | `--muted-foreground` |
| `--accent` | 主操作按钮、开关选中态、原生控件 `accent-color` | `#1f6f5c`（占位） | `--primary`，**必须覆盖**，别留占位值 |
| `--accent-contrast` | 主操作上的文字 | `#ffffff` | `--primary-foreground` |
| `--focus` | 焦点环 | 同 `--accent` | `--ring` |
| `--danger` | 错误描边、错误文本、危险按钮 | `#a4342a` | `--destructive` |
| `--radius` | 控件圆角 | `10px` | `--radius`（卡片 12–16px，胶囊留给小控件） |
| `--space-1…6` | 4/8/12/16/24/32px 间距阶 | 固定 | 系统的 spacing 阶；改值要保住「字段 16 : 成组 32 = 1:2」 |
| `--font-sans` | 全站正文 | `system-ui, -apple-system, "Segoe UI", "Noto Sans SC", sans-serif` | `--font-sans`；若系统另有 `--font-display`，标题换掉它 |
| `--shadow-1` | 错误汇总区、开关滑块 | 偏移 + 柔和模糊 | 系统的 elevation 层级 |
| `--field-max` | 输入框最大宽度 | `420px` | 不必替换；定长内容（手机号、日期）另行收窄 |
| `--control-h` | 控件最小高度 | `40px` | 不低于 40px；移动端命中区 44px 更稳 |

强调色配额：本骨架里 `--accent` 只出现在主按钮、开关选中态和原生控件 `accent-color` 上（`craft/anti-ai-slop.md` 建议单屏可见强调色 ≤2 处，超了就把握手态的选中色退成 `var(--text)`）。必填星号刻意用 `--text-muted`：不给 `--accent`（跟主操作抢强调），也不给 `--danger`（红色留给错误）。

## 骨架（单文件 HTML）

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>新建客户 · 客户管理</title>
<!-- 内联 SVG 图标，避免 favicon 404，也不引任何外链；换 --accent 时这里的 %231f6f5c 要同步 -->
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%231f6f5c'/%3E%3Cpath d='M9 21V11h4.6l2.4 4 2.4-4H23v10h-2.6v-6l-2.4 4-2.4-4v6H9Z' fill='%23fff'/%3E%3C/svg%3E">
<style>
  :root {
    color-scheme: light dark;
    --bg: #f6f7f6;
    --surface: #ffffff;
    --surface-2: #f0f2f1;
    --border: #d7dcd9;
    --text: #17201d;
    --text-muted: #5c6764;
    --accent: #1f6f5c;              /* 占位：必须按所选设计系统覆盖（tokens.css 的 --primary） */
    --accent-contrast: #ffffff;
    --focus: #1f6f5c;               /* 系统给了 --ring 就换成它 */
    --danger: #a4342a;
    --radius: 10px;
    --space-1: 4px;
    --space-2: 8px;
    --space-3: 12px;
    --space-4: 16px;
    --space-5: 24px;
    --space-6: 32px;
    --font-sans: system-ui, -apple-system, "Segoe UI", "Noto Sans SC", sans-serif;
    --shadow-1: 0 1px 2px rgba(23, 32, 29, .06), 0 8px 24px rgba(23, 32, 29, .06);
    --field-max: 420px;
    --control-h: 40px;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #121614;
      --surface: #1a201e;
      --surface-2: #212826;
      --border: #333c39;
      --text: #e8ece9;
      --text-muted: #9aaaa4;
      --accent: #4fb79b;
      --accent-contrast: #0d1513;
      --focus: #6fd3b6;
      --danger: #e88a7d;
      --shadow-1: 0 1px 2px rgba(0, 0, 0, .4), 0 8px 24px rgba(0, 0, 0, .32);
    }
  }
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font-sans); font-size: 15px; line-height: 1.6; -webkit-text-size-adjust: 100%; }
  :focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }   /* 瞬时出现：不加任何过渡动画 */
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
  /* 移动优先：320px 起可用 */
  .page { max-width: 720px; margin: 0 auto; padding: var(--space-5) var(--space-4) var(--space-6); }
  .crumbs { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-4); font-size: 13px; color: var(--text-muted); }
  .crumbs a { display: inline-flex; align-items: center; gap: var(--space-1); color: var(--text-muted); text-decoration: none; }
  .crumbs a:hover { color: var(--text); text-decoration: underline; text-underline-offset: 3px; }
  .crumbs svg { width: 14px; height: 14px; flex: none; }
  .crumbs__sep { color: var(--border); }
  .crumbs [aria-current] { color: var(--text); }
  .page-title { margin: 0 0 var(--space-2); font-size: 26px; line-height: 1.25; letter-spacing: -.01em; }
  .page-desc { margin: 0 0 var(--space-5); color: var(--text-muted); }
  /* 错误汇总区：默认 hidden，提交失败时 JS 去掉 hidden 并聚焦 */
  .error-summary { margin-bottom: var(--space-5); padding: var(--space-4); border: 1px solid var(--danger); border-radius: var(--radius); background: var(--surface); box-shadow: var(--shadow-1); }
  .error-summary__title { display: flex; align-items: center; gap: var(--space-2); margin: 0 0 var(--space-2); font-size: 15px; color: var(--danger); }
  .error-summary__title svg { width: 18px; height: 18px; flex: none; }
  .error-summary ul { margin: 0; padding-left: var(--space-5); }
  .error-summary li + li { margin-top: var(--space-1); }
  .error-summary a { color: var(--text); }
  .error-summary__hint { margin: var(--space-3) 0 0; font-size: 13px; color: var(--text-muted); }
  .form-required-hint { margin: 0 0 var(--space-5); font-size: 13px; color: var(--text-muted); }
  /* 分组：小节之间 32px，是字段之间 16px 的两倍 */
  .section-title { margin: 0 0 var(--space-4); font-size: 15px; font-weight: 600; }
  .form-section + .form-section { margin-top: var(--space-6); padding-top: var(--space-6); border-top: 1px solid var(--border); }
  .field { margin: 0 0 var(--space-4); border: 0; padding: 0; min-width: 0; }
  .field:last-of-type { margin-bottom: 0; }
  .field__label { display: block; margin-bottom: var(--space-2); font-size: 14px; font-weight: 600; }
  legend.field__label { padding: 0; }
  .req { color: var(--text-muted); font-weight: 400; }
  .field__meta { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3); }
  .field__help { margin: var(--space-2) 0 0; font-size: 13px; color: var(--text-muted); }
  .field__help--lead { margin: 0 0 var(--space-3); }
  .field__count { margin: var(--space-2) 0 0; font-size: 12px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .field__error { margin: var(--space-2) 0 0; font-size: 13px; font-weight: 600; color: var(--danger); }
  .input { width: 100%; max-width: var(--field-max); min-height: var(--control-h); padding: var(--space-2) var(--space-3); font: inherit; color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
  .input:hover { border-color: var(--text-muted); }
  .input[aria-invalid="true"] { border-color: var(--danger); }
  .input--area { min-height: 96px; resize: vertical; }
  .input--phone { max-width: 220px; }
  .input--date { max-width: 200px; }
  select.input { padding-right: var(--space-4); }   /* 保留原生箭头；要自绘就用内联 SVG data-URI 并覆盖暗色描边 */
  input[type="radio"], input[type="checkbox"] { accent-color: var(--accent); }
  .choices { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .choice { display: inline-flex; align-items: center; gap: var(--space-2); min-height: var(--control-h); padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); cursor: pointer; }
  .choice:has(input:checked) { border-color: var(--text); background: var(--surface-2); }
  .choice:has(input:focus-visible) { border-color: var(--focus); }
  .range { display: flex; flex-direction: column; gap: var(--space-2); }
  .range__label { display: block; margin-bottom: var(--space-1); font-size: 13px; color: var(--text-muted); }
  .range__sep { font-size: 13px; color: var(--text-muted); }
  .switch-row { display: flex; align-items: center; gap: var(--space-2); }
  .switch-row .field__label { margin-bottom: 0; }
  .switch { appearance: none; flex: none; width: 44px; height: 24px; margin: 0; border: 1px solid var(--border); border-radius: 999px; background: var(--surface-2); position: relative; cursor: pointer; }
  .switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: var(--surface); box-shadow: var(--shadow-1); }
  .switch:checked { background: var(--accent); border-color: var(--accent); }
  .switch:checked::after { left: auto; right: 2px; background: var(--accent-contrast); }
  /* 粘性底栏：一个主操作 + 一个取消 */
  .form-actions { position: sticky; bottom: 0; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); margin-top: var(--space-6); padding: var(--space-3) 0 calc(var(--space-3) + env(safe-area-inset-bottom)); background: var(--bg); border-top: 1px solid var(--border); }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); min-height: var(--control-h); padding: 0 var(--space-4); font: inherit; font-weight: 600; color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); cursor: pointer; }
  .btn:hover { border-color: var(--text-muted); }
  .btn[disabled] { opacity: .6; cursor: not-allowed; }
  .btn--primary { flex: 1 1 160px; color: var(--accent-contrast); background: var(--accent); border-color: var(--accent); }
  .btn--primary:hover { background: color-mix(in oklab, var(--accent) 88%, var(--text)); border-color: var(--accent); }
  .form-actions__note { margin: 0; font-size: 13px; color: var(--text-muted); }
  @media (min-width: 640px) {
    .page { padding: var(--space-6) var(--space-6) var(--space-6); }
    .range { flex-direction: row; align-items: flex-end; gap: var(--space-3); }
    .range__sep { line-height: var(--control-h); }
    .btn--primary { flex: 0 0 auto; }
    .form-actions__note { margin-left: auto; }
  }
</style>
</head>
<body>
<main class="page">
  <nav class="crumbs" aria-label="面包屑">
    <a href="/customers">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 3.5 5 8l4.5 4.5"/></svg>
      客户管理
    </a>
    <span class="crumbs__sep" aria-hidden="true">/</span>
    <span aria-current="page">新建客户</span>
  </nav>
  <header>
    <h1 class="page-title">新建客户</h1>
    <p class="page-desc">填写客户主体信息，保存后可在客户列表继续补充合同与联系人。</p>
  </header>
  <!-- 错误汇总区：默认 hidden。提交失败时 JS 先 hidden = false 渲染，再 focus() 播报 -->
  <div class="error-summary" id="form-error-summary" tabindex="-1" hidden>
    <h2 class="error-summary__title">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3.2 2.6 16h14.8L10 3.2Z"/><path d="M10 8v3.4"/><path d="M10 13.7h.01"/></svg>
      <span id="form-error-count">有 2 处需要修改</span>
    </h2>
    <ul id="error-summary-list">
      <li><a href="#customer-name">客户名称为必填项</a></li>
      <li><a href="#customer-phone">手机号需为 11 位数字，且以 1 开头</a></li>
    </ul>
    <p class="error-summary__hint">上面每一项都可点击，跳到对应字段直接修改。</p>
  </div>
  <form id="customer-form">
    <p class="form-required-hint">带 <span class="req" aria-hidden="true">*</span><span class="sr-only">星号</span> 的字段为必填。</p>
    <section class="form-section">
      <h2 class="section-title">基础信息</h2>
      <div class="field">
        <label class="field__label" for="customer-name">客户名称 <span class="req" aria-hidden="true">*</span></label>
        <input class="input" id="customer-name" name="name" type="text" maxlength="30" required autocomplete="organization"
               aria-describedby="customer-name-help" aria-invalid="false"
               data-counter="customer-name-count" data-error-message="客户名称为必填项，最多 30 个字">
        <p class="field__error" id="customer-name-error" hidden>客户名称为必填项，最多 30 个字。</p>
        <div class="field__meta">
          <p class="field__help" id="customer-name-help">与营业执照一致，用于合同与发票抬头。</p>
          <p class="field__count" id="customer-name-count">0/30</p>
        </div>
      </div>
      <div class="field">
        <label class="field__label" for="customer-industry">所属行业 <span class="req" aria-hidden="true">*</span></label>
        <select class="input" id="customer-industry" name="industry" required aria-describedby="customer-industry-help"
                aria-invalid="false" data-error-message="请选择所属行业">
          <option value="">请选择行业</option>
          <option value="manufacturing">制造业</option>
          <option value="retail">零售与电商</option>
          <option value="logistics">物流与供应链</option>
          <option value="finance">金融与保险</option>
          <option value="public">公共事业</option>
        </select>
        <p class="field__error" id="customer-industry-error" hidden>请选择所属行业。</p>
        <p class="field__help" id="customer-industry-help">用于按行业分组查看客户分布。</p>
      </div>
      <fieldset class="field" id="customer-tier" aria-describedby="customer-tier-help" aria-invalid="false">
        <legend class="field__label">客户等级 <span class="req" aria-hidden="true">*</span></legend>
        <p class="field__help field__help--lead" id="customer-tier-help">等级决定服务响应时限与审批链路。</p>
        <div class="choices">
          <label class="choice" for="tier-standard"><input type="radio" id="tier-standard" name="tier" value="standard" required checked> 标准</label>
          <label class="choice" for="tier-key"><input type="radio" id="tier-key" name="tier" value="key"> 重点</label>
          <label class="choice" for="tier-strategic"><input type="radio" id="tier-strategic" name="tier" value="strategic"> 战略</label>
        </div>
        <p class="field__error" id="customer-tier-error" hidden>请选择客户等级。</p>
      </fieldset>
      <fieldset class="field" id="customer-services" aria-describedby="customer-services-help">
        <legend class="field__label">服务范围</legend>
        <p class="field__help field__help--lead" id="customer-services-help">可多选，保存后仍可调整。</p>
        <div class="choices">
          <label class="choice" for="service-presale"><input type="checkbox" id="service-presale" name="services" value="presale" checked> 售前咨询</label>
          <label class="choice" for="service-delivery"><input type="checkbox" id="service-delivery" name="services" value="delivery" checked> 实施交付</label>
          <label class="choice" for="service-support"><input type="checkbox" id="service-support" name="services" value="support"> 运维支持</label>
          <label class="choice" for="service-training"><input type="checkbox" id="service-training" name="services" value="training"> 培训</label>
        </div>
      </fieldset>
    </section>
    <section class="form-section">
      <h2 class="section-title">合作与联系</h2>
      <fieldset class="field" id="service-period" aria-describedby="period-help" aria-invalid="false">
        <legend class="field__label">合作起止日期</legend>
        <p class="field__help field__help--lead" id="period-help">用于生成续约提醒；结束日期需晚于开始日期。</p>
        <div class="range">
          <div class="range__item">
            <label class="range__label" for="period-start">开始日期</label>
            <input class="input input--date" id="period-start" name="periodStart" type="date">
          </div>
          <span class="range__sep">至</span>
          <div class="range__item">
            <label class="range__label" for="period-end">结束日期</label>
            <input class="input input--date" id="period-end" name="periodEnd" type="date">
          </div>
        </div>
        <p class="field__error" id="service-period-error" hidden>结束日期需晚于开始日期。</p>
      </fieldset>
      <div class="field">
        <label class="field__label" for="customer-contact">联系人 <span class="req" aria-hidden="true">*</span></label>
        <input class="input" id="customer-contact" name="contact" type="text" maxlength="20" required autocomplete="name"
               aria-describedby="customer-contact-help" aria-invalid="false" data-error-message="联系人为必填项">
        <p class="field__error" id="customer-contact-error" hidden>联系人为必填项，最多 20 个字。</p>
        <p class="field__help" id="customer-contact-help">对接人的姓名或称呼，会出现在工单与通知里。</p>
      </div>
      <div class="field">
        <label class="field__label" for="customer-phone">手机号 <span class="req" aria-hidden="true">*</span></label>
        <input class="input input--phone" id="customer-phone" name="phone" type="tel" maxlength="11" required inputmode="numeric"
               pattern="1[3-9][0-9]{9}" autocomplete="tel" aria-describedby="customer-phone-help" aria-invalid="false"
               data-error-message="手机号需为 11 位数字，且以 1 开头">
        <p class="field__error" id="customer-phone-error" hidden>手机号需为 11 位数字，且以 1 开头。</p>
        <p class="field__help" id="customer-phone-help">用于发送开通与告警短信，不会对外公开。</p>
      </div>
      <div class="field">
        <label class="field__label" for="customer-note">备注</label>
        <textarea class="input input--area" id="customer-note" name="note" rows="4" maxlength="200"
                  aria-describedby="customer-note-help" aria-invalid="false" data-counter="customer-note-count"></textarea>
        <div class="field__meta">
          <p class="field__help" id="customer-note-help">记录对接背景、结算约定等；客户侧可见。</p>
          <p class="field__count" id="customer-note-count">0/200</p>
        </div>
      </div>
      <div class="field">
        <div class="switch-row">
          <input class="switch" id="customer-enabled" name="enabled" type="checkbox" role="switch" checked aria-describedby="customer-enabled-help">
          <label class="field__label" for="customer-enabled">创建后立即启用</label>
        </div>
        <p class="field__help" id="customer-enabled-help">启用后该客户出现在选择器与统计中；停用不删除任何数据。</p>
      </div>
    </section>
    <div class="form-actions">
      <button class="btn btn--primary" type="submit">保存并启用</button>
      <button class="btn" type="button">取消</button>
      <p class="form-actions__note">保存后仍可继续补充合同与联系人。</p>
    </div>
  </form>
</main>
<script>
(function () {
  var form = document.getElementById('customer-form');
  var summary = document.getElementById('form-error-summary');
  var list = document.getElementById('error-summary-list');
  var count = document.getElementById('form-error-count');
  form.noValidate = true;   // JS 接管错误渲染；无 JS 时保留浏览器原生校验底线

  // 分组控件的错误与 aria-invalid 挂在带 *-error 节点的 fieldset 上，不挂在单个控件上
  function host(field) {
    var group = field.closest('fieldset');
    return group && document.getElementById(group.id + '-error') ? group : field;
  }
  function refs(field) { return (host(field).getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean); }
  function errorNode(field) { return document.getElementById(host(field).id + '-error'); }

  function markField(field) {
    var target = host(field), error = errorNode(field);
    target.setAttribute('aria-invalid', 'true');
    if (!error) { return; }
    error.hidden = false;
    var ids = refs(field);
    if (ids.indexOf(error.id) === -1) { ids.push(error.id); target.setAttribute('aria-describedby', ids.join(' ')); }
  }
  function clearField(field) {
    var target = host(field), error = errorNode(field);
    target.setAttribute('aria-invalid', 'false');
    if (error) { error.hidden = true; }
    var ids = refs(field).filter(function (id) { return !error || id !== error.id; });
    if (ids.length) { target.setAttribute('aria-describedby', ids.join(' ')); }
  }

  // 已报错的字段改回 input 就复校，不必再 blur 一次（首次校验时机见 craft/form-validation.md）
  form.addEventListener('input', function (event) {
    var field = event.target;
    if (field.getAttribute && field.getAttribute('aria-invalid') === 'true' && field.checkValidity()) { clearField(field); }
  });

  form.addEventListener('submit', function (event) {
    var invalid = Array.prototype.filter.call(form.elements, function (el) {
      return el.willValidate && !el.checkValidity();
    });
    if (!invalid.length) { return; }   // 通过：交给真实提交
    event.preventDefault();
    list.textContent = '';
    invalid.forEach(function (field) {
      markField(field);
      var item = document.createElement('li');
      var link = document.createElement('a');
      link.href = '#' + host(field).id;
      link.textContent = field.dataset.errorMessage || field.validationMessage || '请检查此字段';
      item.appendChild(link);
      list.appendChild(item);
    });
    count.textContent = '有 ' + invalid.length + ' 处需要修改';
    summary.hidden = false;   // 先渲染
    summary.focus();          // 再聚焦（hidden 元素无法聚焦）
  });

  // 汇总区跳转：锚点负责滚动，focus() 负责把键盘焦点交给控件
  summary.addEventListener('click', function (event) {
    var link = event.target.closest && event.target.closest('a[href^="#"]');
    if (!link) { return; }
    var target = document.getElementById(link.hash.slice(1));
    if (!target) { return; }
    event.preventDefault();
    var next = target.matches('fieldset') ? target.querySelector('input, select, textarea') : target;
    if (next) { next.focus(); }
  });

  // 字符计数
  Array.prototype.forEach.call(document.querySelectorAll('[data-counter]'), function (field) {
    var out = document.getElementById(field.dataset.counter);
    if (!out) { return; }
    var render = function () { out.textContent = field.value.length + '/' + field.maxLength; };
    field.addEventListener('input', render);
    render();
  });
})();
</script>
</body>
</html>
```

## 落地前自检

- [ ] 每个控件都有可见 label（`for` / `id` 成对绑定），没有任何字段拿 placeholder 当标签
- [ ] 必填字段写了 `required`，视觉星号 `aria-hidden="true"` 且旁有 `sr-only` 文字，表单顶部有「* 为必填」说明
- [ ] 帮助文本与错误文本各有 id，并被对应控件的 `aria-describedby` 引用；错误出现时同步 `aria-invalid="true"`（组错误挂 `fieldset`）
- [ ] 错误汇总区默认 `hidden`，提交失败时先 `hidden = false` 再 `focus()`，容器有 `tabindex="-1"` 且**没有** `role="alert"`
- [ ] 汇总区每条链接都指向真实存在的字段 id，点击后键盘焦点落在该控件上（不是只把页面滚过去）
- [ ] `:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }` 在位，CSS 里没有 `transition` 简写（尤其 `all`），焦点环不淡入
- [ ] 全部 token 在 `:root` 定义；`--accent` 已按所选设计系统覆盖，没留占位绿
- [ ] `@media (prefers-color-scheme: dark)` 成对覆盖了颜色 token，暗色下错误红与焦点环仍然可辨
- [ ] 320px 宽度下无横向滚动、按钮够得到、日期区间自动堆叠；输入框没有拉满整屏
- [ ] 单文件零外部依赖：无 CDN、无字体外链、无图片，图标全是内联 SVG，没有 emoji 当图标
- [ ] 没有 lorem ipsum 与编造指标；示例字段与业务一致（客户名称 / 行业 / 联系人 / 手机号 / 备注 / 是否启用）
- [ ] 桌面与移动各截一档图亲眼看过，再交付
