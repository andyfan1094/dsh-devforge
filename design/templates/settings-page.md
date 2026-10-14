---
name: 设置页模板
description: 中文后台设置页骨架：左侧分区锚点导航 + 即时保存与显式保存两种语义 + 红色危险区与二次确认，单文件零依赖可直接打开。
triggers:
  - 设置页模板
  - 配置页模板
  - 偏好设置
  - 分区导航
  - 危险操作区
  - settings template
  - preferences page
od:
  category: template
---

# 设置页模板

设置页是后台里最容易被做烂的一屏：几十个开关平铺、点一下不知道存没存、改完不敢退出、删除按钮和"发送测试"挨在一起。这个模板把三件事一次性定死——**分区怎么切、改动什么时候生效、危险操作放在哪**。结构是「左侧分区锚点导航 + 右侧按作用域分组的设置项」，每一行都是"标题 + 一行说明 + 控件"，并显式标注该设置的作用域（整个工作区 / 仅我）。模板同时给出两种保存语义的完整实现：开关与选择器用**即时保存**并在控件旁出现内联「已保存」，涉及跨字段校验、对外请求或影响他人的设置收进**显式保存**，由底部粘性条统一提交，脏状态时提示「有未保存修改」并拦截离开。危险区固定在最后一屏，用独立红色描边区域与二次确认隔离；不用 emoji 充当图标、不用渐变、不引入任何外部依赖，320px 起即可用（窄屏时左侧导航折为顶部横向滚动条）。

## 结构决策

**分区锚点导航 vs 多页签。** 判据是"用户是否需要跨区对照"。分区数 ≤ 7、每区能在一屏内读完、改动之间弱关联（常规 / 通知 / 权限 / 集成）——用锚点单页：Ctrl+F 能搜到设置名、可深链接到 `#danger`、浏览器前进后退天然可用、移动端只需一条横向滚动条。反过来，分区里装的是**不同提交语义或不同对象**（工作区设置 vs 个人账号 vs 计费）、分区数超过 7、或单个分区本身就是完整表单流程——用页签，让每个页签各自负责自己的保存与离开逻辑。混合做法（锚点单页 + 固定侧栏 + 每区一个"本区保存"）比纯页签更难做对，表单不长就别选。

**即时保存 vs 显式保存。** 同一个页面里**一个分区只能有一种语义**，否则用户永远在猜"这个开关是立刻生效还是等我点保存"：

- **即时保存**：单项、布尔或单选、幂等、可逆、无对外副作用——如"当有人提及我时发送邮件通知"。拨动即生效，控件旁给一行内联「已保存」；失败必须把控件拨回原值并就地报错。
- **显式保存**：跨字段关联校验（域名白名单 + 邀请开关）、需要校验格式或密钥（Webhook 地址、签名方式）、会对外发起请求、会影响其他成员（权限与准入）。这类设置统一收进一个表单，由粘性条提交。
- **两者都不属于**：不可逆或影响面大的操作——不走即时保存，也不混进普通表单，单独进危险区走二次确认。

**危险区的位置。** 永远在页面最后一个分区，视觉上与上方设置项**物理隔离**（独立红色描边区域 + 额外顶部间距），不要塞进导航中间"顺手能够到"的位置。入口按钮不用实心主色，默认次级描边 + 危险色文字；破坏性按钮上的动词要写清对象（"删除工作区"，不是"确定"）。

## 反馈与撤销

- **保存成功反馈。** 即时保存 → 控件旁内联「已保存」（`role="status"`，约 2.4 秒后自行消失，不夺取焦点、不遮挡刚改的字段）。显式保存 → 页面级轻提示 + 粘性条收起。任何情况下都不要用居中模态弹窗宣布"保存成功"，那是为一次不需要决策的操作强行打断。
- **失败必须回滚。** 模板里的即时保存只在本地演示成功态；真实项目必须 `await` 后端写入，失败时把控件恢复为旧值并列出可重试的错误行。让界面停留在"看起来已保存"的状态，比保存失败本身更伤信任。
- **未保存离开的拦截。** 脏状态时挂 `beforeunload`（刷新 / 关标签）；站内路由跳转要另做一层拦截，给出「离开并放弃」与「继续编辑」两个明确选项——只依赖浏览器原生提示，站内跳转会静默丢掉改动。
- **撤销窗口。** 有短暂可逆窗口的操作（停用外部分享链接）给 8–10 秒撤销条，写清"什么被改掉了、多久内可撤销"。真正不可逆的操作（删除工作区）**不要假装给撤销**，改用二次确认 + 输入对象名称这类强确认。

## 可替换的 token

所有颜色、间距、圆角、字体、阴影都从 `:root` 取；换设计系统时只替换这张表里的值，不动结构。

| token | 默认值 | 用途 | 替换说明 |
| --- | --- | --- | --- |
| `--bg` | `#f6f7f6` | 页面底色 | 取设计系统的 background |
| `--surface` | `#ffffff` | 设置项平面、粘性条、轻提示 | 与 `--bg` 至少 1 级明度差 |
| `--surface-2` | `#eef0ee` | 导航当前项、确认条、开关底槽 | 弱于 `--surface` 的凹陷面 |
| `--border` | `#dfe3e0` | 分隔线、控件描边 | 用发丝线，不用重投影 |
| `--text` | `#12171a` | 正文与标题 | 与底色对比度 ≥ 7:1 更稳 |
| `--text-muted` | `#5d6b66` | 说明文字、作用域标签 | 对比度不低于 4.5:1 |
| `--accent` | `#1f6f5c` | 唯一强调色：导航当前项、主按钮、开关开启态 | **必按所选设计系统覆盖**；可见用量建议 ≤ 3 处 |
| `--accent-contrast` | `#ffffff` | 强调色上的文字 | 与 `--accent` 对比度 ≥ 4.5:1 |
| `--focus` | `#1f6f5c` | 焦点环颜色 | 与相邻底色对比度 ≥ 3:1 |
| `--danger` | `#b3261e` | 危险区描边、破坏性按钮文字 | 亮色用深红，暗色需提亮 |
| `--radius` | `10px` | 控件与区域圆角 | 全页统一，不混用多档 |
| `--space-1` … `--space-6` | `4 / 8 / 12 / 16 / 24 / 32px` | 全部间距 | 组内用 1–3，组间用 5–6 |
| `--font-sans` | `system-ui, -apple-system, "Segoe UI", "Noto Sans SC", sans-serif` | 全页字体 | 不引入外链字体 |
| `--shadow-1` | 单层浅阴影 | 粘性条与轻提示 | 不做大面积投影 |

## HTML 骨架

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>工作区设置 · 云雀控制台</title>
<style>
  /* 统一 token 契约：换设计系统只改这一段 —— --accent 默认值须按所选 systems/<id> 覆盖 */
  :root {
    --bg: #f6f7f6; --surface: #ffffff; --surface-2: #eef0ee; --border: #dfe3e0;
    --text: #12171a; --text-muted: #5d6b66;
    --accent: #1f6f5c; --accent-contrast: #ffffff; --focus: #1f6f5c; --danger: #b3261e;
    --radius: 10px;
    --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 24px; --space-6: 32px;
    --font-sans: system-ui, -apple-system, "Segoe UI", "Noto Sans SC", sans-serif;
    --shadow-1: 0 1px 2px rgba(16, 24, 20, .07), 0 1px 1px rgba(16, 24, 20, .04);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f1211; --surface: #171b19; --surface-2: #1f2523; --border: #2b322f;
      --text: #e9edea; --text-muted: #9aa8a2;
      --accent: #5cbfa4; --accent-contrast: #08130f; --focus: #8fe3c6; --danger: #f08a80;
      --shadow-1: 0 1px 2px rgba(0, 0, 0, .5);
    }
  }
  * { box-sizing: border-box; }
  /* 必须显式覆盖：类里的 display 会盖掉 UA 的 [hidden] 规则，否则「已保存」与粘性条会一直可见 */
  [hidden] { display: none !important; }
  body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font-sans); font-size: 15px; line-height: 1.6; }
  h1, h2, h3, p { margin: 0; }
  h1 { font-size: 24px; line-height: 1.25; letter-spacing: -.01em; }
  h2 { font-size: 17px; }
  h3 { font-size: 15px; font-weight: 600; }
  a { color: inherit; }
  /* 焦点环瞬时出现，不带任何 transition */
  :focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  @media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
  .i { width: 16px; height: 16px; flex: 0 0 auto; }
  .page-head__inner, .layout { max-width: 1080px; margin: 0 auto; padding: 0 var(--space-4); }
  .page-head { padding: var(--space-5) 0 var(--space-4); }
  .crumb { font-size: 13px; color: var(--text-muted); }
  .page-head h1 { margin: var(--space-2) 0; }
  .lede { max-width: 52ch; color: var(--text-muted); }
  .scope { margin-top: var(--space-3); font-size: 13px; color: var(--text-muted); }
  .scope b { color: var(--text); font-weight: 600; }
  /* 窄屏：分区导航折为顶部横向滚动条 */
  .sidenav { position: sticky; top: 0; z-index: 3; background: var(--bg); border-bottom: 1px solid var(--border); }
  .sidenav ul { display: flex; gap: var(--space-1); margin: 0; padding: var(--space-2) var(--space-4); list-style: none; overflow-x: auto; }
  .sidenav a { display: block; padding: var(--space-2) var(--space-3); border-radius: 999px; white-space: nowrap; font-size: 14px; text-decoration: none; color: var(--text-muted); }
  .sidenav a[aria-current] { color: var(--accent); background: var(--surface-2); font-weight: 600; }
  main { padding-bottom: 96px; }
  section[id] { scroll-margin-top: 72px; padding: var(--space-5) 0 var(--space-3); }
  .section-head { margin-bottom: var(--space-2); }
  .section-head p { font-size: 14px; color: var(--text-muted); }
  .setting { display: grid; gap: var(--space-3); padding: var(--space-4) 0; border-top: 1px solid var(--border); }
  .setting__title { margin-bottom: 2px; }
  .setting__desc { max-width: 56ch; font-size: 14px; color: var(--text-muted); }
  .setting__scope { margin-top: var(--space-1); font-size: 12px; color: var(--text-muted); }
  .setting__control { display: flex; align-items: center; gap: var(--space-3); min-height: 24px; }
  .switch { position: relative; display: inline-flex; flex: 0 0 auto; width: 44px; height: 24px; }
  .switch input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; }
  .switch__track { width: 100%; height: 100%; border: 1px solid var(--border); border-radius: 999px; background: var(--surface-2); transition: background-color .14s ease, border-color .14s ease; }
  .switch__track::after { content: ""; position: absolute; top: 4px; left: 4px; width: 16px; height: 16px; border-radius: 50%; background: var(--surface); box-shadow: var(--shadow-1); transition: transform .14s ease; }
  .switch input:checked + .switch__track { background: var(--accent); border-color: var(--accent); }
  .switch input:checked + .switch__track::after { transform: translateX(20px); }
  .switch input:focus-visible + .switch__track { outline: 2px solid var(--focus); outline-offset: 2px; }
  select, input[type="text"], input[type="url"] { min-height: 36px; max-width: 100%; padding: 0 var(--space-3); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); font: inherit; font-size: 14px; }
  input[type="text"], input[type="url"] { width: 260px; }
  .hint { font-size: 12px; color: var(--text-muted); }
  .saved-note { display: inline-flex; align-items: center; gap: var(--space-1); font-size: 13px; color: var(--text-muted); }
  .savebar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 4; background: var(--surface); border-top: 1px solid var(--border); box-shadow: var(--shadow-1); }
  .savebar__inner { max-width: 1080px; margin: 0 auto; padding: var(--space-3) var(--space-4); display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
  .savebar__state { display: inline-flex; align-items: center; gap: var(--space-2); font-size: 14px; color: var(--text-muted); }
  .savebar__spacer { margin-left: auto; }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); min-height: 36px; padding: 0 var(--space-4); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); font: inherit; font-size: 14px; cursor: pointer; }
  .btn--primary { background: var(--accent); border-color: var(--accent); color: var(--accent-contrast); font-weight: 600; }
  .btn--danger { border-color: var(--danger); color: var(--danger); }
  .danger-zone { margin-top: var(--space-6); padding: var(--space-4); border: 1px solid var(--danger); border-radius: var(--radius); }
  .danger-zone .section-head h2 { display: flex; align-items: center; gap: var(--space-2); color: var(--danger); }
  .danger-zone .setting { border-top-color: var(--danger); }
  .confirm-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); margin-top: var(--space-3); padding: var(--space-3); border-radius: var(--radius); background: var(--surface-2); }
  .toastbar { position: fixed; left: var(--space-4); right: var(--space-4); bottom: 76px; z-index: 5; max-width: 520px; margin: 0 auto; padding: var(--space-3) var(--space-4); display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); box-shadow: var(--shadow-1); font-size: 14px; }
  .toastbar button { padding: var(--space-1); border: 0; background: none; color: var(--accent); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
  @media (min-width: 720px) { .setting { grid-template-columns: minmax(0, 1fr) auto; align-items: start; } .setting__control { justify-content: flex-end; } input[type="text"], input[type="url"] { width: 300px; } }
  @media (min-width: 900px) { .layout { display: grid; grid-template-columns: 208px minmax(0, 1fr); gap: var(--space-6); align-items: start; } .sidenav { top: var(--space-5); border-bottom: 0; background: transparent; } .sidenav ul { flex-direction: column; gap: 2px; overflow: visible; padding: 0; } .sidenav a { border-radius: var(--radius); } section[id] { scroll-margin-top: var(--space-5); } }
</style>
</head>
<body>
  <!-- 图标一律内联 SVG（同文档 sprite），零外部依赖 -->
  <svg width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute">
    <symbol id="i-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></symbol>
    <symbol id="i-alert" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></symbol>
    <symbol id="i-info" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/></symbol>
  </svg>

  <header class="page-head">
    <div class="page-head__inner">
      <p class="crumb">云雀控制台 / 工作区 / 设置</p>
      <h1>工作区设置</h1>
      <p class="lede">管理通知方式、成员权限与第三方集成。带「立即生效」的设置改动会即时保存，其余改动需在底部确认。</p>
      <p class="scope">当前作用域：<b>星野数据 · 工作区</b>（仅管理员可修改权限与集成）</p>
    </div>
  </header>

  <div class="layout">
    <nav class="sidenav" aria-label="设置分区">
      <ul>
        <li><a href="#general" aria-current="true">常规</a></li>
        <li><a href="#notify">通知</a></li>
        <li><a href="#perm">权限</a></li>
        <li><a href="#integration">集成</a></li>
        <li><a href="#danger">危险区</a></li>
      </ul>
    </nav>

    <main>
      <!-- ===== 常规：即时保存 ===== -->
      <section id="general" aria-labelledby="general-h">
        <div class="section-head"><h2 id="general-h">常规</h2><p>界面与时间的默认行为，改动立即生效。</p></div>

        <div class="setting">
          <div><h3 class="setting__title" id="s-tz">默认时区</h3><p class="setting__desc">报表、导出文件与定时摘要都按这个时区计算。</p><p class="setting__scope">作用域：整个工作区</p></div>
          <div class="setting__control">
            <select data-instant aria-labelledby="s-tz"><option selected>(UTC+08:00) 中国标准时间</option><option>(UTC+09:00) 日本标准时间</option><option>(UTC+00:00) 协调世界时</option></select>
            <p class="saved-note" role="status" hidden><svg class="i" aria-hidden="true"><use href="#i-check"/></svg>已保存</p>
          </div>
        </div>

        <div class="setting">
          <div><h3 class="setting__title" id="s-lang">界面语言</h3><p class="setting__desc">只影响你自己的界面，不会改变其他成员看到的语言。</p><p class="setting__scope">作用域：仅我</p></div>
          <div class="setting__control">
            <select data-instant aria-labelledby="s-lang"><option selected>简体中文</option><option>English</option></select>
            <p class="saved-note" role="status" hidden><svg class="i" aria-hidden="true"><use href="#i-check"/></svg>已保存</p>
          </div>
        </div>

        <div class="setting">
          <div><h3 class="setting__title" id="s-density">紧凑列表密度</h3><p class="setting__desc">数据表与任务列表减小行高，一屏多看几行。</p><p class="setting__scope">作用域：仅我</p></div>
          <div class="setting__control">
            <label class="switch"><input type="checkbox" role="switch" data-instant aria-labelledby="s-density"><span class="switch__track" aria-hidden="true"></span></label>
            <p class="saved-note" role="status" hidden><svg class="i" aria-hidden="true"><use href="#i-check"/></svg>已保存</p>
          </div>
        </div>
      </section>

      <!-- ===== 通知：即时保存 ===== -->
      <section id="notify" aria-labelledby="notify-h">
        <div class="section-head"><h2 id="notify-h">通知</h2><p>决定哪些事件会打扰你。这些开关只对你自己生效，随时可关。</p></div>

        <div class="setting">
          <div><h3 class="setting__title" id="s-mention">当有人提及我时发送邮件通知</h3><p class="setting__desc">评论、任务描述与文档正文中 @ 到你时触发；回复整串讨论不会重复提醒。</p><p class="setting__scope">作用域：仅我</p></div>
          <div class="setting__control">
            <label class="switch"><input type="checkbox" role="switch" checked data-instant aria-labelledby="s-mention"><span class="switch__track" aria-hidden="true"></span></label>
            <p class="saved-note" role="status" hidden><svg class="i" aria-hidden="true"><use href="#i-check"/></svg>已保存</p>
          </div>
        </div>

        <div class="setting">
          <div><h3 class="setting__title" id="s-digest">每天 09:00 发送未读摘要</h3><p class="setting__desc">把前一天未读的评论与变更合并成一封邮件；当天没有未读则不发送。</p><p class="setting__scope">作用域：仅我 · 按默认时区</p></div>
          <div class="setting__control">
            <label class="switch"><input type="checkbox" role="switch" data-instant aria-labelledby="s-digest"><span class="switch__track" aria-hidden="true"></span></label>
            <p class="saved-note" role="status" hidden><svg class="i" aria-hidden="true"><use href="#i-check"/></svg>已保存</p>
          </div>
        </div>

        <div class="setting">
          <div><h3 class="setting__title" id="s-channel">升级提醒的送达渠道</h3><p class="setting__desc">仅作用于"需要你处理"的提醒，普通动态仍走站内消息。</p><p class="setting__scope">作用域：仅我</p></div>
          <div class="setting__control">
            <select data-instant aria-labelledby="s-channel"><option selected>站内消息</option><option>邮件</option><option>群机器人</option></select>
            <p class="saved-note" role="status" hidden><svg class="i" aria-hidden="true"><use href="#i-check"/></svg>已保存</p>
          </div>
        </div>
      </section>

      <!-- ===== 权限 + 集成：显式保存，同一表单由底部粘性条提交 ===== -->
      <form id="explicit-form">
        <section id="perm" aria-labelledby="perm-h">
          <div class="section-head"><h2 id="perm-h">权限</h2><p>影响其他成员，改动需在底部确认后生效。</p></div>

          <div class="setting">
            <div><h3 class="setting__title" id="s-invite">允许成员邀请外部协作者</h3><p class="setting__desc">关闭后只有管理员能发起邀请，已发出的邀请链接不受影响。</p><p class="setting__scope">作用域：整个工作区</p></div>
            <div class="setting__control">
              <label class="switch"><input type="checkbox" role="switch" checked data-explicit aria-labelledby="s-invite"><span class="switch__track" aria-hidden="true"></span></label>
            </div>
          </div>

          <div class="setting">
            <div><h3 class="setting__title" id="s-domain">自动准入的邮箱域名</h3><p class="setting__desc">这些域名下的同事申请加入时自动通过；多个域名用英文逗号分隔。</p><p class="setting__scope">作用域：整个工作区</p></div>
            <div class="setting__control">
              <input type="text" data-explicit value="xingye.com" aria-labelledby="s-domain" aria-describedby="s-domain-hint"><span class="hint" id="s-domain-hint">保存时校验</span>
            </div>
          </div>
        </section>

        <section id="integration" aria-labelledby="integration-h">
          <div class="section-head"><h2 id="integration-h">集成</h2><p>用于对接外部系统，保存时会向目标地址发起一次连通性校验。</p></div>

          <div class="setting">
            <div><h3 class="setting__title" id="s-webhook">事件推送地址</h3><p class="setting__desc">任务状态变更与评论创建会以 POST 推送到该地址，需为 https。</p><p class="setting__scope">作用域：整个工作区</p></div>
            <div class="setting__control">
              <input type="url" data-explicit value="https://hooks.example.com/yunque" aria-labelledby="s-webhook">
            </div>
          </div>

          <div class="setting">
            <div><h3 class="setting__title" id="s-token">推送签名方式</h3><p class="setting__desc">用于校验请求确实来自本工作区；更换后旧签名立即失效，需同步更新接收端。</p><p class="setting__scope">作用域：整个工作区</p></div>
            <div class="setting__control">
              <select data-explicit aria-labelledby="s-token"><option selected>HMAC-SHA256（推荐）</option><option>Bearer 令牌</option><option>不签名</option></select>
            </div>
          </div>
        </section>
      </form>

      <!-- ===== 危险区：独立红色描边区域，二次确认，不用 emoji ===== -->
      <section id="danger" aria-labelledby="danger-h">
        <div class="danger-zone">
          <div class="section-head">
            <h2 id="danger-h"><svg class="i" aria-hidden="true"><use href="#i-alert"/></svg>危险区</h2>
            <p>以下操作会影响工作区外的访问方或删除数据，无法通过"保存"撤销。</p>
          </div>

          <div class="setting">
            <div><h3 class="setting__title" id="s-share">停用公开分享链接</h3><p class="setting__desc">停用后，所有已分享的只读链接立即失效；重新分享会生成新链接。</p><p class="setting__scope" id="link-state">当前状态：公开分享链接可访问</p></div>
            <div class="setting__control">
              <button type="button" class="btn btn--danger" id="btn-revoke" aria-describedby="link-state">停用公开分享链接</button>
            </div>
          </div>

          <div class="confirm-row" id="revoke-confirm" hidden>
            <p>确认停用？外部访问方会立刻收到 403；此操作在 10 秒内可撤销。</p>
            <div class="savebar__spacer"></div>
            <button type="button" class="btn" id="btn-revoke-cancel">取消</button>
            <button type="button" class="btn btn--danger" id="btn-revoke-confirm">确认停用</button>
          </div>

          <div class="setting">
            <div><h3 class="setting__title" id="s-delete">删除工作区</h3><p class="setting__desc">成员、文档与集成配置将一并删除，且没有回收站。需要输入工作区名称确认。</p><p class="setting__scope">作用域：整个工作区 · 不可撤销</p></div>
            <div class="setting__control">
              <button type="button" class="btn btn--danger" aria-describedby="s-delete">删除工作区</button>
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>

  <!-- 显式保存：仅脏状态出现的粘性条 -->
  <div class="savebar" id="savebar" role="region" aria-label="未保存的改动" hidden>
    <div class="savebar__inner">
      <p class="savebar__state"><svg class="i" aria-hidden="true"><use href="#i-info"/></svg>有未保存修改 · 权限与集成的改动需保存后生效</p>
      <div class="savebar__spacer"></div>
      <button type="button" class="btn" id="btn-discard">放弃</button>
      <button type="button" class="btn btn--primary" id="btn-save">保存</button>
    </div>
  </div>

  <p class="toastbar" id="toast" role="status" hidden></p>
  <div class="toastbar" id="undobar" role="status" hidden>
    <span>已停用公开分享链接</span>
    <div class="toastbar__spacer"></div>
    <button type="button" id="btn-undo">撤销</button>
  </div>

<script>
(function () {
  "use strict";
  var savebar = document.getElementById("savebar");
  var toast = document.getElementById("toast");
  var undobar = document.getElementById("undobar");
  var dirty = false;

  function toastOnce(text) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toast.hidden = true; }, 3200);
  }
  function setDirty(next) { dirty = next; savebar.hidden = !next; }

  /* 离开拦截：刷新 / 关标签走 beforeunload；站内路由跳转需另加「离开并放弃 / 继续编辑」确认 */
  window.addEventListener("beforeunload", function (e) {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = "";
  });

  /* 即时保存：本模板只在本地演示内联「已保存」。
     真实项目必须 await 后端写入，失败时把控件恢复为旧值并就地提示可重试，不得停留在假的成功态。 */
  Array.prototype.forEach.call(document.querySelectorAll("[data-instant]"), function (ctl) {
    var note = ctl.closest(".setting").querySelector(".saved-note");
    ctl.addEventListener("change", function () {
      if (!note) return;
      note.hidden = false;
      clearTimeout(note._t);
      note._t = setTimeout(function () { note.hidden = true; }, 2400);
    });
  });

  /* 显式保存：任何输入或选择都进入脏状态 */
  var form = document.getElementById("explicit-form");
  Array.prototype.forEach.call(form.querySelectorAll("[data-explicit]"), function (ctl) {
    var fire = function () { setDirty(true); };
    ctl.addEventListener("change", fire);
    ctl.addEventListener("input", fire);
  });
  document.getElementById("btn-discard").addEventListener("click", function () {
    form.reset(); /* 放弃 = 回到上次保存的值，而不是清空 */
    setDirty(false);
  });
  document.getElementById("btn-save").addEventListener("click", function () {
    /* 真实项目：await api.save(...) 成功后 setDirty(false) + toastOnce；失败保留脏状态并列出错误行 */
    setDirty(false);
    toastOnce("权限与集成设置已保存");
  });

  /* 分区导航当前项：锚点原生可 Tab 到达，滚动时同步 aria-current */
  var links = Array.prototype.slice.call(document.querySelectorAll(".sidenav a"));
  var byId = {};
  links.forEach(function (a) { byId[a.getAttribute("href").slice(1)] = a; });
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        links.forEach(function (a) { a.removeAttribute("aria-current"); });
        var active = byId[entry.target.id];
        if (active) active.setAttribute("aria-current", "true");
      });
    }, { rootMargin: "-12% 0px -72% 0px" });
    Array.prototype.forEach.call(document.querySelectorAll("main section[id]"), function (s) { io.observe(s); });
  }

  /* 危险操作：二次确认 + 10 秒撤销窗口 */
  var confirmRow = document.getElementById("revoke-confirm");
  document.getElementById("btn-revoke").addEventListener("click", function () {
    confirmRow.hidden = false;
    document.getElementById("btn-revoke-cancel").focus();
  });
  document.getElementById("btn-revoke-cancel").addEventListener("click", function () {
    confirmRow.hidden = true;
    document.getElementById("btn-revoke").focus();
  });
  document.getElementById("btn-revoke-confirm").addEventListener("click", function () {
    confirmRow.hidden = true;
    document.getElementById("link-state").textContent = "当前状态：公开分享链接已停用";
    undobar.hidden = false;
    clearTimeout(undobar._t);
    undobar._t = setTimeout(function () { undobar.hidden = true; }, 10000);
  });
  document.getElementById("btn-undo").addEventListener("click", function () {
    clearTimeout(undobar._t);
    undobar.hidden = true;
    document.getElementById("link-state").textContent = "当前状态：公开分享链接可访问";
  });
})();
</script>
</body>
</html>
```

## 落地前自检

- [ ] `--accent` 已按所选 `systems/<id>` 覆盖；页面可见强调色 ≤ 3 处（导航当前项、主按钮、开关开启态），没有默认靛蓝。
- [ ] 未使用全属性过渡（`transition` 只写明确属性）；焦点环由 `:focus-visible` 瞬时出现，不带淡入。
- [ ] 零外部依赖：无 CDN、无字体外链、无位图；图标全部是 `stroke="currentColor"` 的内联 SVG。
- [ ] 全页无 emoji 充当图标或状态符号。
- [ ] 320px 宽度下：分区导航折为顶部横向滚动条且可横滑，设置项不横向溢出，控件落到说明文字下方。
- [ ] 每个设置项都标注了作用域（整个工作区 / 仅我），用户能判断改动会影响谁。
- [ ] 明确区分即时保存与显式保存，且**同一分区内不混用**两种语义。
- [ ] 即时保存的「已保存」是内联提示（`role="status"`）而非居中模态；真实项目已接后端并在失败时回滚控件值。
- [ ] 显式保存：脏状态才出现粘性条，含「有未保存修改」文案与保存 / 放弃；「放弃」是恢复上次保存值，不是清空。
- [ ] 离开拦截已接：`beforeunload` 之外，站内路由跳转也有「离开并放弃 / 继续编辑」确认。
- [ ] 危险区位于最后一屏、与普通设置物理隔离，破坏性操作有二次确认且动词写明对象；不可逆操作不假装提供撤销。
- [ ] 键盘全流程可用：Tab 可达导航与全部控件，Tab 顺序与视觉顺序一致；确认展开后焦点落在确认按钮，取消后焦点回到触发按钮。
