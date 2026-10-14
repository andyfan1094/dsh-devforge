---
name: 登录与注册页模板
description: 中文产品登录与注册页的单文件骨架：左品牌右表单分栏、字段级与表单级双层错误、密码可见切换与提交中态一次给全，零外部依赖。
triggers:
  - 登录页模板
  - 登录页
  - 注册页
  - 认证页
  - 找回密码
  - sign in template
  - auth page
od:
  category: template
---

# 登录与注册页模板

**这份模板给你什么**：一个零依赖的单文件 HTML 认证页骨架——左侧品牌区（产品名 + 一句价值说明）、右侧表单卡片（账号、密码可见切换、30 天免登录、忘记密码、主按钮、第三方登录），加上字段级错误、表单级 `role="alert"` 汇总与提交中态的完整写法。所有颜色、间距、圆角走 `:root` 语义 token，换设计系统只改前半段变量。

**什么场景用**：产品的登录、注册、找回密码三个入口页——「用户还没进来、只给一次机会」的界面。也适合当认证相关**邮件落地页**（重设密码、邀请加入）的起点。

**怎么改**：① 先把 `:root` 的 `--accent` 换成 `systems/` 里选定设计系统的主色（默认深青绿 `#1f6f5c`）；② 换产品名与那句价值说明，**写清楚产品做什么，不写形容词**；③ 按业务决定是否保留「30 天免登录」与第三方登录；④ 错误文案与验证码时机见下文「安全与体验的平衡」，那是本模板最不能随手改的部分。

---

## 布局决策

### 单栏居中，还是左右分栏

| 判据 | 选**单栏居中** | 选**左右分栏**（左品牌右表单） |
| --- | --- | --- |
| 访客状态 | 已经知道自己在登录什么（内部工具、客户端内嵌页、从邮件点进来的落地页） | 第一次听说这个产品（对外注册转化、SaaS 首屏、渠道投放页） |
| 要交代的事 | 不需要交代，直接给表单 | 需要一句「这是什么、解决什么」 |
| 品牌侧内容 | 无 | 产品名 + 一句价值说明，可选 2 条真实能力点 |
| 版式 | 表单垂直水平居中，宽度上限与分栏方案一致 | 两列 1:1（`minmax(0, 1fr)` 各一），≥900px 才分栏 |

本模板用分栏。三条硬约束：① 品牌侧**不放大插画、不用整屏渐变**，它是背景信息不是主角，填充只靠 `--surface-2` 与一条 1px 分隔线；② 两列不要做成 2:1，一侧过宽会让视线在表单与品牌之间来回跑；③ 窄屏时品牌区**降级成顶部一条（产品名 + 价值说明），而不是隐藏**——访问者至少要清楚自己正在登录哪个产品。窄屏隐藏的只有那 2 条能力点。

### 表单卡片的宽度

`--form-max: 400px` 是**上限不是目标**：账号与密码都是短内容，超过 440px 只是拉长眼动行程，并不会显得"大气"。写法用 `width: 100%; max-width: var(--form-max)`，320px 屏幕上卡片自动收到容器宽度，靠 `--space-4` 的内边距留呼吸；输入框一律与卡片同宽，不会出现某个字段只有 200px 的参差。

### 移动端折叠顺序与键盘顺序

DOM 顺序固定为 **品牌区 → 表单**，宽屏靠 `grid` 分栏，不用 `order` 重排。这样移动端天然是「这是哪个产品 → 表单」，Tab 顺序与视觉顺序也天然一致，读屏用户不会先撞见表单再被念到品牌。卡片内部的垂直节奏：标题 → 一行描述 → 错误汇总 → 字段（间距 `--space-4`）→ 免登录/忘记密码一行 → 主按钮（`--space-5` 上方留白拉开）→ 分隔线 → 第三方按钮。

---

## 安全与体验的平衡

### 错误提示粒度：不得泄露账号是否存在

这是认证页最容易犯错、后果最重的一处。**凭据校验失败只有一句话**：

> 邮箱或手机号与密码不匹配。请重新输入，或使用「忘记密码」重置。

账号不存在与密码错误必须使用**完全相同的文案、相同的布局位置、相近的响应时间**——否则任何人拿一份手机号表批量试一遍，就能筛出你们有多少注册用户，这就是账号枚举。字段级错误只承载"格式 / 必填"这类与账号存在性无关的问题（比如「请输入邮箱或手机号」），**永远不用字段级错误表达"这个账号不存在"**。同一规则延伸到另外三个入口：注册页邮箱被占用时不写「该邮箱已注册」，写中性的「若该邮箱可用，我们已发送确认邮件」；找回密码无论账号是否存在都返回「如果该账号存在，重置邮件已发送」；失败次数提示可以说「连续 5 次失败后需等待 15 分钟」，但不透露该账号是否存在。另外别把账号放进 URL（`/reset?email=…` 会进服务端日志与 `Referer`）。

### 密码可见切换

用 `aria-pressed` 表达**"密码当前是否可见"**（按下 = 可见），同时换 `aria-label`（显示密码 / 隐藏密码）并同步图标；按钮紧贴输入框右侧，切换后**焦点留在按钮上**，键盘用户不用重新找位置。不要靠"眼睛"图标单独承载语义（读屏拿不到状态），也不要用 emoji 当图标。

### 记住我

宾语写清楚：写「30 天内免登录」，不写「记住我」——用户得知道被记住的是什么、多久。默认勾选只在个人设备场景成立；共用电脑（医院、门店、网吧）应当默认不勾。勾了就一定要给出退出路径：设置页有「已登录设备 / 退出全部设备」。

### 验证码出现时机

首屏**不放**验证码。默认无验证码，同一账号或同一 IP 累计 3–5 次失败后再插入图形验证码，且只作为"多加一道"而非"直接锁定"。首屏就摆验证码，等于让全部真实用户替攻击者付成本。出现时放在主按钮上方独立字段，提供刷新入口，并把它排除在凭据错误文案之外。

### 第三方登录的位置与层级

放在主表单**之后**，用「或使用以下方式登录」分隔线与主路径断开；按钮走次级样式（`--border` 描边 + `--surface` 底），**不用第三方品牌色填充**——一大块蓝色会把主按钮压下去。文案写动作本身（「微信登录」），不写「使用微信账号快速登录」这类冗长描述；数量控制在 2–3 个，多出来的收进「更多方式」。第三方登录失败也复用同一句统一措辞，不要在这里区分"该微信未注册"。

---

## 可替换的 token

全部在 `:root` 定义，暗色用 `@media (prefers-color-scheme: dark)` 成对覆盖。

| 变量 | 用途 | 模板默认 | 换成设计系统时取自 |
| --- | --- | --- | --- |
| `--bg` | 页面底色 | `#f5f7f6` / 暗 `#111614` | `systems/<id>/tokens.css` 的 `--background` |
| `--surface` | 表单卡片、按钮表面 | `#ffffff` | `--card` |
| `--surface-2` | 品牌区底、切换按钮悬停底 | `#edf1ef` | `--muted` / `--secondary` |
| `--border` | 输入框描边、分隔线 | `#d6dcd9` | `--border` / `--input` |
| `--text` | 正文与文字链接 | `#17201d` | `--foreground` |
| `--text-muted` | 描述、帮助文本、分隔线文字 | `#5c6764` | `--muted-foreground` |
| `--accent` | 主按钮填充、复选框 `accent-color` | `#1f6f5c`（占位） | `--primary`，**必须覆盖**，别留占位绿 |
| `--accent-contrast` | 主按钮上的文字 | `#ffffff` | `--primary-foreground` |
| `--focus` | 焦点环 | 同 `--accent` | `--ring` |
| `--danger` | 字段错误、表单级错误边框与文字 | `#a4342a` / 暗 `#e88a7d` | `--destructive` |
| `--radius` | 输入框、按钮、卡片圆角 | `10px` | `--radius`（卡片可到 12–16px） |
| `--space-1…6` | 4/8/12/16/24/32px 间距阶 | 固定 | 系统的 spacing 阶；保住「字段 16 : 区块 24」 |
| `--font-sans` | 全站正文 | `system-ui, -apple-system, "Segoe UI", "Noto Sans SC", sans-serif` | `--font-sans`；有 `--font-display` 时标题换掉它 |
| `--shadow-1` | 表单卡片抬升 | 偏移 + 柔和模糊 | 系统的 elevation 层级 |
| `--form-max` | 表单卡片宽度上限 | `400px` | 不必替换；窄屏靠 `max-width` 自动收窄 |
| `--control-h` | 控件最小高度 | `44px` | 不低于 40px；触屏命中区 44px 更稳 |

强调色配额：本骨架刻意把「忘记密码 / 创建账号 / 条款」这类**文字链接压成 `--text` + 下划线**，品牌标记也走中性色，把 `--accent` 只留给主按钮与复选框 `accent-color` 两处可见用途，焦点环由 `--focus` 单独承担。

---

## 骨架（单文件 HTML）

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>登录 · 启程协作</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f5f7f6;
    --surface: #ffffff;
    --surface-2: #edf1ef;
    --border: #d6dcd9;
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
    --shadow-1: 0 1px 2px rgba(23, 32, 29, .06), 0 8px 24px rgba(23, 32, 29, .05);
    --form-max: 400px;              /* 宽度上限，不是目标 */
    --control-h: 44px;              /* 触屏命中区 */
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #111614;
      --surface: #1a201e;
      --surface-2: #212826;
      --border: #333c39;
      --text: #e8ece9;
      --text-muted: #9aaaa4;
      --accent: #4fb79b;
      --accent-contrast: #0d1513;
      --focus: #6fd3b6;
      --danger: #e88a7d;
      --shadow-1: 0 1px 2px rgba(0, 0, 0, .4), 0 8px 24px rgba(0, 0, 0, .3);
    }
  }
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font-sans); font-size: 15px; line-height: 1.6; -webkit-text-size-adjust: 100%; }
  :focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }   /* 瞬时出现：全文件没有一处 transition */
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

  /* 移动优先：320px 起单栏；≥900px 折成左右分栏 */
  .auth { display: grid; grid-template-columns: 1fr; min-height: 100vh; }
  .auth__brand { display: grid; gap: var(--space-3); align-content: start; padding: var(--space-5) var(--space-4); background: var(--surface-2); border-bottom: 1px solid var(--border); }
  .brand__lockup { display: flex; align-items: center; gap: var(--space-3); }
  .brand__mark { display: grid; place-items: center; width: 32px; height: 32px; flex: none; border-radius: var(--radius); background: var(--text); color: var(--bg); }
  .brand__name { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: -.01em; }
  .brand__tagline { margin: 0; max-width: 40ch; font-size: 15px; }
  .brand__points { display: none; }
  .link { color: var(--text); font-weight: 500; text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1px; }
  .link:hover { color: var(--text-muted); }

  .auth__panel { display: grid; place-items: center; padding: var(--space-5) var(--space-4) var(--space-6); }
  .auth__card { width: 100%; max-width: var(--form-max); }
  .auth__title { margin: 0 0 var(--space-2); font-size: 22px; line-height: 1.3; letter-spacing: -.01em; }
  .auth__desc { margin: 0 0 var(--space-5); font-size: 14px; color: var(--text-muted); }

  /* 表单级错误汇总：常驻 DOM 的 role="alert" 空节点，报错时只写 textContent（别用 hidden 切换，部分读屏器会漏播） */
  .form-alert { margin: 0 0 var(--space-4); padding: var(--space-3) var(--space-4); border: 1px solid var(--danger); border-radius: var(--radius); background: var(--surface); color: var(--danger); font-size: 14px; }
  .form-alert:empty { margin: 0; padding: 0; border: 0; }

  .field { margin: 0 0 var(--space-4); }
  .field__label { display: block; margin-bottom: var(--space-2); font-size: 14px; font-weight: 600; }
  .field__row { position: relative; }
  .input { width: 100%; min-height: var(--control-h); padding: var(--space-2) var(--space-3); font: inherit; color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
  .input:hover { border-color: var(--text-muted); }
  .input[aria-invalid="true"] { border-color: var(--danger); }
  .input--password { padding-right: 52px; }
  .pw-toggle { position: absolute; top: 50%; right: 6px; transform: translateY(-50%); display: grid; place-items: center; width: 36px; height: 36px; color: var(--text-muted); background: none; border: 0; border-radius: var(--radius); cursor: pointer; }
  .pw-toggle:hover { color: var(--text); background: var(--surface-2); }
  .field__help { margin: var(--space-2) 0 0; font-size: 13px; color: var(--text-muted); }
  .field__error { margin: var(--space-2) 0 0; font-size: 13px; font-weight: 600; color: var(--danger); }

  .row-between { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2); margin: 0 0 var(--space-5); }
  .check { display: inline-flex; align-items: center; gap: var(--space-2); font-size: 14px; cursor: pointer; }
  .check input { width: 16px; height: 16px; margin: 0; accent-color: var(--accent); }

  .btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); min-height: var(--control-h); padding: 0 var(--space-4); font: inherit; font-weight: 600; color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); cursor: pointer; }
  .btn:hover { border-color: var(--text-muted); }
  .btn--primary { width: 100%; color: var(--accent-contrast); background: var(--accent); border-color: var(--accent); }
  .btn--primary:hover { background: color-mix(in oklab, var(--accent) 88%, var(--text)); }
  .btn[disabled] { opacity: .65; cursor: not-allowed; }
  .btn[aria-busy="true"]::before { content: ""; width: 14px; height: 14px; flex: none; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: spin 700ms linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .divider { display: flex; align-items: center; gap: var(--space-3); margin: var(--space-5) 0; font-size: 13px; color: var(--text-muted); }
  .divider::before, .divider::after { content: ""; height: 1px; flex: 1 1 auto; background: var(--border); }
  .oauth { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
  .oauth .btn { font-weight: 500; }
  .auth__foot { margin: var(--space-5) 0 0; font-size: 14px; color: var(--text-muted); text-align: center; }
  .legal { margin: var(--space-3) 0 0; font-size: 12px; color: var(--text-muted); text-align: center; }

  @media (min-width: 900px) {
    .auth { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    .auth__brand { align-content: center; gap: var(--space-4); padding: var(--space-6); border-bottom: 0; border-right: 1px solid var(--border); }
    .brand__tagline { font-size: 20px; line-height: 1.45; max-width: 26ch; }
    .brand__points { display: grid; gap: var(--space-2); margin: var(--space-4) 0 0; padding: 0; list-style: none; font-size: 14px; color: var(--text-muted); }
    .brand__points li { display: flex; align-items: flex-start; gap: var(--space-2); }
    .brand__points svg { width: 16px; height: 16px; flex: none; margin-top: 3px; color: var(--text); }
    .auth__panel { padding: var(--space-6); }
    .auth__title { font-size: 24px; }
  }
  @media (prefers-reduced-motion: reduce) { .btn[aria-busy="true"]::before { animation: none; } }
</style>
</head>
<body>
<main class="auth">
  <section class="auth__brand" aria-label="产品介绍">
    <div class="brand__lockup">
      <span class="brand__mark" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.2 12 4l8 4.2v7.6L12 20l-8-4.2z"/><path d="M12 12.2 20 8M12 12.2V20M12 12.2 4 8"/></svg></span>
      <p class="brand__name">启程协作</p>
    </div>
    <p class="brand__tagline">把排期、文档与审批收进同一个工作区，改动实时同步给相关的人。</p>
    <ul class="brand__points">
      <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5"/></svg><span>排期变更自动通知到相关同事，不用再补一条群消息。</span></li>
      <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5"/></svg><span>文档与审批保留修改记录，可追溯到具体的人和时刻。</span></li>
    </ul>
  </section>

  <section class="auth__panel">
    <div class="auth__card">
      <h1 class="auth__title">登录启程协作</h1>
      <p class="auth__desc">用工作邮箱或已绑定的手机号登录，还没有账号可以现在创建。</p>

      <!-- 表单级错误汇总：常驻 DOM，默认空。凭据类错误（账号不存在 / 密码错误）一律只走这里，
           且两个原因使用同一句话，避免账号枚举。读取方式见 craft/anti-ai-slop.md 与 form-page 模板。 -->
      <p class="form-alert" id="form-alert" role="alert"></p>

      <form id="login-form" method="post" action="/session">
        <div class="field">
          <label class="field__label" for="account">邮箱或手机号</label>
          <!-- 演示态：账号为空时的字段级错误接线。真实项目初始应 aria-invalid="false" 且错误节点 hidden -->
          <input class="input" id="account" name="account" type="text" inputmode="email" autocomplete="username" required
                 aria-invalid="true" aria-describedby="account-error account-help">
          <p class="field__error" id="account-error">请输入邮箱或手机号。</p>
          <p class="field__help" id="account-help">管理员分配的邮箱，或已在设置里绑定的手机号。</p>
        </div>

        <div class="field">
          <label class="field__label" for="password">密码</label>
          <div class="field__row">
            <input class="input input--password" id="password" name="password" type="password" autocomplete="current-password" required
                   aria-describedby="password-help">
            <button class="pw-toggle" id="pw-toggle" type="button" aria-pressed="false" aria-controls="password" aria-label="显示密码">
              <svg class="pw-toggle__show" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/></svg>
              <svg class="pw-toggle__hide" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" hidden><path d="M10.6 6.1c.5-.1.9-.1 1.4-.1 6 0 9.5 6 9.5 6a17.4 17.4 0 0 1-3.1 3.7"/><path d="M6.5 7.7A17.3 17.3 0 0 0 2.5 12S6 18 12 18c1.3 0 2.4-.2 3.4-.6"/><path d="M9.9 10a3 3 0 0 0 4.1 4.1"/><path d="M4 20 20 4"/></svg>
            </button>
          </div>
          <p class="field__help" id="password-help">密码区分大小写；连续 5 次失败后需等待 15 分钟再试。</p>
        </div>

        <div class="row-between">
          <label class="check" for="remember">
            <input id="remember" name="remember" type="checkbox" checked>
            30 天内免登录
          </label>
          <a class="link" href="/reset">忘记密码？</a>
        </div>

        <!-- 提交中（JS 在提交时切到这个状态）：
             <button class="btn btn--primary" type="submit" disabled aria-busy="true"><span class="btn__label">正在登录…</span></button> -->
        <button class="btn btn--primary" id="submit-btn" type="submit" aria-busy="false">
          <span class="btn__label">登录</span>
        </button>

        <p class="divider">或使用以下方式登录</p>
        <div class="oauth">
          <button class="btn" type="button">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5.5c-3.6 0-6.5 2.3-6.5 5.2 0 1.6.9 3.1 2.3 4.1l-.6 2.2 2.6-1.3c.6.2 1.4.3 2.2.3"/><path d="M15.4 9.5c3.1 0 5.6 2 5.6 4.5 0 1.4-.8 2.7-2 3.5l.5 1.9-2.1-1.1c-.6.2-1.3.3-2 .3-3.1 0-5.6-2-5.6-4.6s2.5-4.5 5.6-4.5Z"/></svg>
            微信登录
          </button>
          <button class="btn" type="button">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20V6.6l7-3V20"/><path d="M11 20h9V11l-9-3"/><path d="M7 9.6h.01M7 13.2h.01M7 16.6h.01M15 12.4h.01M15 16h.01"/></svg>
            企业 SSO
          </button>
        </div>
      </form>

      <p class="auth__foot">还没有账号？<a class="link" href="/signup">创建账号</a></p>
      <p class="legal">登录即表示同意 <a class="link" href="/terms">服务条款</a> 与 <a class="link" href="/privacy">隐私政策</a>。</p>
    </div>
  </section>
</main>
<script>
(function () {
  var form = document.getElementById('login-form');
  var alertBox = document.getElementById('form-alert');
  var account = document.getElementById('account');
  var accountError = document.getElementById('account-error');
  var password = document.getElementById('password');
  var toggle = document.getElementById('pw-toggle');
  var submit = document.getElementById('submit-btn');
  var label = submit.querySelector('.btn__label');

  // 字段级错误只承载「格式 / 必填」问题，永远不用来表达「这个账号是否存在」
  function setFieldError(on) {
    account.setAttribute('aria-invalid', on ? 'true' : 'false');
    accountError.hidden = !on;
    account.setAttribute('aria-describedby', on ? 'account-error account-help' : 'account-help');
  }
  function clearMessages() { alertBox.textContent = ''; setFieldError(false); }

  // 凭据类错误统一措辞：账号不存在与密码错误不可区分，避免被批量枚举
  function showCredentialError() {
    alertBox.textContent = '邮箱或手机号与密码不匹配。请重新输入，或使用「忘记密码」重置。';
  }

  // 密码可见性：aria-pressed 表达「密码当前是否可见」（按下 = 可见），同时换文案与图标
  toggle.addEventListener('click', function () {
    var visible = toggle.getAttribute('aria-pressed') !== 'true';
    password.type = visible ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(visible));
    toggle.setAttribute('aria-label', visible ? '隐藏密码' : '显示密码');
    toggle.querySelector('.pw-toggle__show').hidden = visible;
    toggle.querySelector('.pw-toggle__hide').hidden = !visible;
    // 焦点留在按钮上：键盘用户按完不用重新找位置
  });

  account.addEventListener('input', clearMessages);

  form.addEventListener('submit', function (event) {
    event.preventDefault();   // 骨架不发请求；真实项目在这一行下面发 fetch
    if (!account.value.trim()) { setFieldError(true); account.focus(); return; }
    clearMessages();
    submit.disabled = true;              // 提交中：disabled 防重复提交
    submit.setAttribute('aria-busy', 'true');
    label.textContent = '正在登录…';
    // 请求失败时调用 showCredentialError()；成功则跳转，不再恢复按钮
  });
})();
</script>
</body>
</html>
```

---

## 落地前自检

- [ ] **不泄露账号存在性**：登录失败只有一句统一文案；未知账号与错误密码的文案、位置、响应时间一致；字段级错误只报格式问题
- [ ] **其它枚举面**：注册页不写「该邮箱已注册」，找回密码统一返回「如果该账号存在，重置邮件已发送」，URL 里不带账号
- [ ] **密码可见切换**：`aria-pressed` 随状态切换、`aria-label` 与图标同步、切换后焦点仍在按钮上
- [ ] **语义与绑定**：`main` / `form` 到位，每个控件都有 `for`–`id` 成对 label，`autocomplete` 为 `username` 与 `current-password`
- [ ] **错误接线**：字段错误节点有 id 且只在该字段出错时被 `aria-describedby` 引用；表单级汇总节点常驻 DOM 且带 `role="alert"`，报错时写 `textContent`
- [ ] **提交中态**：主按钮切到 `disabled` + `aria-busy="true"` + 「正在登录…」，`prefers-reduced-motion` 下转圈停止
- [ ] **焦点与键盘**：Tab 顺序为 账号 → 密码 → 可见切换 → 免登录 → 忘记密码 → 登录 → 第三方 → 创建账号；`:focus-visible` 瞬时出现，全文件无任何 `transition`
- [ ] **移动优先**：320px 起无横向滚动、卡片收到容器宽度、两个第三方按钮不挤成两行文字；≥900px 才分栏
- [ ] **零外部依赖**：无 CDN、无字体外链、无图片；图标全是 1.7–2px `stroke` 的内联 SVG，没有 emoji 当图标
- [ ] **无 AI 味**：`--accent` 仅出现在主按钮与复选框 `accent-color`；无紫蓝渐变、无渐变文字、无彩色左边框卡片、无编造指标（如「99.9% 可用」）
- [ ] **文案可信**：产品名与价值说明写清"做什么"而非形容词堆砌；示例帮助文本（失败锁定、免登录时长）与真实策略一致，无占位假文
- [ ] **暗色模式**：切换系统外观，确认错误红、边框、焦点环仍可辨；桌面与移动各截一档图亲眼看过再交付
