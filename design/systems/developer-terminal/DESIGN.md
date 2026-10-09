---
name: 终端风（Developer Terminal）
description: 把网站做成一场终端会话：荧光绿 mono 文字、prompt 前缀、命令与输出的成对结构、tmux 状态栏，用工具的真实感表达开发者身份。
triggers:
  - 终端风
  - Developer Terminal
  - 终端
  - 命令行
  - CLI
  - 开发者
  - 黑客
  - 等宽字体
od:
  category: style-modern
---

# 终端风（Developer Terminal）

## 一、一句话定位

把网站做成一场终端会话：荧光绿 mono 文字、prompt 前缀、命令与输出的成对结构、tmux 状态栏，用工具的真实感表达开发者身份。

- 英文名：**Developer Terminal**
- 风格类型：`visual`（视觉风格：靠色彩/材质/字体塑造）
- 关键词：终端、命令行、CLI、开发者、黑客、等宽字体、shell、tmux、terminal、monospace、developer
- 适用场景提示：开发者终端：等宽字体、提示符、命令行语汇
- 源风格分类：`modern`

---

## 二、设计哲学（源 `philosophy` 字段）

Developer Terminal 不是在模仿终端的样子，而是在借用终端的语言。对开发者来说，终端是每天生活的地方——最诚实、最高效、零装饰的工具。把个人网站做成一场终端会话，等于宣告：我的身份不需要营销页面来证明，工具本身就是我的名片。

核心理念：
- 内容即输出：每一段内容都是某条命令的执行结果。访客不是在"浏览页面"，而是在"读取会话"——标题是 prompt，正文是 stdout，错误提示是 stderr
- 工具的真实感：真实的终端没有渐变、没有阴影、没有摄影图。它只有等宽字符、光标和颜色语义。这种克制不是贫乏，而是专业性本身
- 颜色即语法高亮：荧光绿是主体输出，青色是路径与链接，品红是关键字与错误，琥珀是字符串与警告，蓝灰是注释。颜色不做装饰，只做语义
- 会话感：闪烁的光标暗示"会话仍在进行"，tmux 状态栏暗示"系统仍在运行"。页面不是静态文档，而是一个活着的进程

这种风格适用于开发者个人主页、技术博客、CLI 工具官网、API 文档、黑客马拉松页面，以及任何想向技术受众传递"我们说同一种语言"的产品。

终端美学的悖论在于：它看起来最"不设计"，却要求最严格的设计纪律——一旦出现一个 sans-serif 字符或一块渐变，整个幻觉就崩塌了。

---

## 三、色彩逻辑

| 项 | 值 |
|---|---|
| 主色 primary | `#4AF626` |
| 辅色 secondary | `#0A0E12` |
| 强调色 accent | `#8BE9FD`、`#FF79C6`、`#FFB86C`、`#6272A4` |

配套的 Tailwind 类名配方（来自 `developer-terminal-tokens.ts`）：

- 底色 主 / 次：bg-[#0A0E12] · bg-[#0D141B]
- 底色 强调：bg-[#4AF626] · bg-[#8BE9FD] · bg-[#FF79C6] · bg-[#FFB86C]
- 文字 主 / 次 / 弱：text-[#4AF626] · text-[#8BE9FD] · text-[#6272A4]

**用色纪律**（源 `doList` 中与颜色相关的条目）：

- 近黑背景 bg-[#0A0E12] 搭配荧光绿主文字 text-[#4AF626]
- 标题或输入位使用闪烁光标块 w-2 h-4 bg-[#4AF626]
- 内容组织为命令 + 输出的成对结构，注释行用 # 开头并使用 text-[#6272A4]
- 状态用 exit code 徽标表达：[0] OK 绿色 / [1] ERR 品红

---

## 四、字体性格

- 标题：font-mono font-bold tracking-tight
- 正文：font-mono
- 等宽：font-mono

字号阶梯：

| 项 | 值 |
|---|---|
| `hero` | `text-2xl md:text-4xl` |
| `h1` | `text-xl md:text-2xl` |
| `h2` | `text-lg md:text-xl` |
| `h3` | `text-base md:text-lg` |
| `body` | `text-sm` |
| `small` | `text-xs` |

---

## 五、圆角与间距哲学

| 项 | 值 |
|---|---|
| 圆角 | `rounded-sm` |
| 边框 | `border border-solid border-[#1F2937]` |

| 项 | 值 |
|---|---|
| 区块间距 section | `py-8 md:py-12` |
| 容器内边距 container | `px-4 md:px-6` |
| 卡片内边距 card | `p-4` |
| 间距 gap · sm | `gap-2` |
| 间距 gap · md | `gap-3` |
| 间距 gap · lg | `gap-5` |

---

## 六、交互、阴影与状态

| 项 | 值 |
|---|---|
| 过渡 | `transition-colors duration-150` |
| 按下态 | `active:bg-[#4AF626]/20` |
| 阴影 sm / md / lg / none | `shadow-none` · `shadow-none` · `shadow-none` · `shadow-none` |
| 阴影 hover / focus | `hover:shadow-none` · `ring-1 ring-[#4AF626]/60` |
| 彩色阴影 | — |

---

## 七、禁忌（源 `forbidden` 字段，含**为什么**禁）

> 这一节是 stylekit 最有价值的资产之一：它不仅列出禁用项，还给出了理由。理由直接来自源数据，
> 未做改写，便于直接喂给模型做生成后自检。

| 项 | 值 |
|---|---|
| `font-sans` | Developer Terminal is monospace-only; every glyph must be font-mono |
| `bg-white` | Terminals are near-black; use bg-[#0A0E12] or bg-[#0D141B] |
| `rounded-lg` | Terminal chrome stays flat and sharp; rounded-sm is the maximum radius |
| `shadow-md` | Terminals are flat surfaces; no elevation shadows |
| `backdrop-blur` | No glassmorphism; a terminal renders opaque character cells |
| 其他禁用类名 | `font-serif`、`bg-gray-50`、`rounded-xl`、`rounded-2xl`、`rounded-full`、`shadow-lg`、`shadow-xl` |
| 其他禁用正则 | `^font-(sans\|serif)`、`^bg-(white\|gray-50\|gray-100\|slate-50)`、`^rounded-(lg\|xl\|2xl\|3xl\|full)`、`^shadow-(md\|lg\|xl\|2xl)`、`^bg-gradient-`、`^backdrop-blur` |

另外，源 `dontList` 以自然语言补充：

- 禁止任何 sans-serif 或衬线字体（font-sans、font-serif）
- 禁止白色或浅色背景（bg-white、bg-gray-50）
- 禁止 rounded-lg 及以上的大圆角（终端窗口只有 rounded-sm 以内）
- 禁止渐变（bg-gradient-*）与玻璃拟态（backdrop-blur）
- 禁止摄影图像与插画装饰（终端里只有字符）
- 禁止超过 4 种终端强调色（青/品红/琥珀/蓝灰之外不再加色）
- 禁止厚阴影 shadow-md 及以上（终端是平面的）

---

## 八、一致性清洗记录

本套风格的 `globalCss` 未发现与 `aiRules` 自相矛盾之处，**未做剔除**。

从本套的 `forbidden` 与 `aiRules` 推导出 **2 条整类禁令**（`gradient`、`transform`），依据如下：

| 项 | 值 |
|---|---|
| `gradient` | forbidden.patterns 含整类渐变禁令 `^bg-gradient-` |
| `transform` | 直接禁令句：「no translate or scale」 |
### 例外保留（禁令成立，但下列规则经复核不属禁令范围）

| 项 | 值 |
|---|---|
| `.developer-terminal-scanlines::after` | aiRules 禁的是**装饰性渐变类**（原文「禁止渐变（bg-gradient-*）」）；扫描线是 2.5% 不透明度的 `repeating-linear-gradient` 纹理，属 CRT 荧幕母题，不是色彩渐变，保留。 |

---

## 九、AI 硬规则（源 `aiRules` 全文，生成时应逐条遵守）

```text
你是一位专精于 Developer Terminal（终端风）的设计专家。生成的所有代码都必须严格遵守以下约束：

## 绝对禁止
- 任何 sans-serif / serif 字体（font-sans、font-serif）
- 白色或浅色背景（bg-white、bg-gray-50 等）
- rounded-lg 及以上的圆角（只允许 rounded-sm 与 rounded-none）
- 渐变 bg-gradient-* 与玻璃拟态 backdrop-blur
- 摄影图像或插画（终端里只有字符）
- 第 5 种强调色（只允许 #8BE9FD / #FF79C6 / #FFB86C / #6272A4）
- shadow-md 及以上的厚阴影

## 必须遵守
- 全局使用 font-mono
- 背景色 #0A0E12，面板色 #0D141B，边框 border-[#1F2937]
- 主文字为荧光绿 #4AF626；注释以 # 开头，颜色用 #6272A4
- 章节标题以 prompt 前缀开头：visitor@stylekit:~$ 命令
- 标题或输入位带闪烁光标块（w-2 h-4 bg-[#4AF626] animate-pulse）
- 内容按"命令 + 输出"成对组织；列表使用 ls -la 式对齐输出
- 状态用 exit code 徽标表达：[0] OK（绿色）/ [1] ERR（品红 #FF79C6）
- 页面底部使用 tmux 式状态栏
- 分隔使用 ASCII 线（──────）

## 颜色语义
- #4AF626 绿：主体输出、成功状态、prompt 命令
- #8BE9FD 青：路径、链接、用户名、提示信息
- #FF79C6 品红：关键字、错误、危险操作
- #FFB86C 琥珀：字符串、数字、警告
- #6272A4 蓝灰：注释、次要信息、非活动项

## 动效与交互
- 光标闪烁使用 steps() 或 animate-pulse，周期约 1 秒
- hover 只改变背景透明度（hover:bg-[#4AF626]/10）或边框亮度，不做位移与缩放
- 可选微弱的 scanline 扫描线纹理（repeating-linear-gradient，透明度不超过 0.03）
- transition 统一使用 transition-colors duration-150

## 响应式
- 移动端：整页仍保持单列终端窗口，字号 text-xs/text-sm，表格横向滚动
- 桌面端：终端窗口最大宽度约 max-w-5xl 并居中，保持 80 列的排版质感

## 自检清单
1. 页面中没有任何非 mono 字体
2. 没有渐变、玻璃拟态、厚阴影或图片
3. 每个区块都能读成一条命令的输出
4. 颜色只承担语义，不做装饰
5. 底部有 tmux 状态栏，且至少存在一个闪烁光标
```

---

## 十、必须包含项与示例提示词

- **button** 必须含：`font-mono` · `text-sm` · `rounded-sm` · `transition-colors duration-150`
- **card** 必须含：`font-mono` · `bg-[#0D141B]` · `border border-[#1F2937]` · `rounded-sm`
- **input** 必须含：`font-mono` · `bg-[#0A0E12]` · `border border-[#1F2937]` · `rounded-sm` · `text-[#4AF626]` · `caret-[#4AF626]` · `placeholder:text-[#6272A4]` · `focus:outline-none focus:border-[#4AF626]/60`

示例提示词（源 `examplePrompts`）：

1. **开发者个人主页**（Developer Homepage）—— 把个人主页做成一场登录后的终端会话
   ```text
   用 Developer Terminal 终端风创建一个开发者个人主页，要求：
1. Hero 是 boot sequence：Last login 行、[ OK ] 自检项、ASCII 站名、带闪烁光标的 prompt
2. 关于我 = whoami 命令的键值对输出，技能 = cat skills.txt
3. 项目列表 = ls -la ~/projects 的对齐输出，每行可点击
4. 联系方式 = printenv CONTACT_* 输出，邮箱与链接用青色 #8BE9FD
5. 底部 tmux 状态栏：会话名、窗口列表、时间
全程 font-mono，背景 #0A0E12，主文字 #4AF626，禁止渐变与图片
   ```
2. **CLI 工具官网**（CLI Tool Landing Page）—— 命令行工具的产品页，安装命令即 CTA
   ```text
   用 Developer Terminal 终端风为一个 CLI 工具设计官网，要求：
1. 顶部会话标签栏（tmux 窗口式导航）：0:install* 1:docs 2:changelog
2. Hero 展示一条可复制的安装命令 npm install -g mytool，配 [0] OK 徽标
3. 功能区 = 三个"命令 + 输出"面板，演示核心用法
4. 版本更新 = git log --oneline 式列表，哈希用琥珀 #FFB86C
5. stderr 风格的注意事项区块（品红 #FF79C6 边框）
面板统一 border-[#1F2937] rounded-sm，分隔用 ASCII 线
   ```
3. **系统监控面板**（System Monitor Dashboard）—— htop / ps aux 语言的状态监控页
   ```text
   用 Developer Terminal 终端风创建一个系统监控面板，要求：
1. 服务列表 = ps aux 式表格：PID、SERVICE、CPU、MEM、STATUS 列
2. 资源占用 = ASCII 进度条 [████████░░] 67%，超过 80% 用琥珀色
3. 日志流 = tail -f 输出区，INFO 青色 / WARN 琥珀 / ERR 品红
4. 每个服务带 exit code 徽标 [0] OK 或 [1] ERR
5. 底部 tmux 状态栏显示 load、uptime、时钟
全 font-mono，禁止图表库，所有可视化用字符完成
   ```

---

## 十一、token 配方总表（源 `developer-terminal-tokens.ts`，Tailwind 类名字符串）

> 这些是**类名配方**而非 CSS 变量——stylekit 的 token 层就是"每个视觉位该用哪些 Tailwind 类"。
> 同目录 `tokens.css` 是该风格 `globalCss` 里的 CSS 变量与工具类（已做一致性清洗）；
> `design-tokens.json` 是扁平 key-value 形式，便于按需注入。

| 项 | 值 |
|---|---|
| 边框宽度 / 颜色 / 圆角 / 风格 | border · border-[#1F2937] · rounded-sm · border-solid |
| 阴影 sm / md / lg / none | shadow-none · shadow-none · shadow-none · shadow-none |
| 阴影 hover / focus | hover:shadow-none · ring-1 ring-[#4AF626]/60 |
| 过渡 / 按下态 | transition-colors duration-150 · active:bg-[#4AF626]/20 |
| 标题字体 / 正文字体 / 等宽字体 | font-mono font-bold tracking-tight · font-mono · font-mono |
| 字号 · hero | text-2xl md:text-4xl |
| 字号 · h1 | text-xl md:text-2xl |
| 字号 · h2 | text-lg md:text-xl |
| 字号 · h3 | text-base md:text-lg |
| 字号 · body | text-sm |
| 字号 · small | text-xs |
| 区块间距 / 容器内边距 / 卡片内边距 | py-8 md:py-12 · px-4 md:px-6 · p-4 |
| 间距 · sm | gap-2 |
| 间距 · md | gap-3 |
| 间距 · lg | gap-5 |
| 底色 主 / 次 | bg-[#0A0E12] · bg-[#0D141B] |
| 底色 · 强调 | bg-[#4AF626] · bg-[#8BE9FD] · bg-[#FF79C6] · bg-[#FFB86C] |
| 文字 主 / 次 / 弱 | text-[#4AF626] · text-[#8BE9FD] · text-[#6272A4] |
| 按钮 · primary | bg-[#4AF626] text-[#0A0E12] hover:bg-[#3FD41F] |
| 按钮 · secondary | bg-transparent text-[#4AF626] border border-[#1F2937] hover:border-[#4AF626]/60 |
| 按钮 · danger | bg-transparent text-[#FF79C6] border border-[#FF79C6]/40 hover:bg-[#FF79C6]/10 |
| 必须包含 · button | font-mono · text-sm · rounded-sm · transition-colors duration-150 |
| 必须包含 · card | font-mono · bg-[#0D141B] · border border-[#1F2937] · rounded-sm |
| 必须包含 · input | font-mono · bg-[#0A0E12] · border border-[#1F2937] · rounded-sm · text-[#4AF626] · caret-[#4AF626] · placeholder:text-[#6272A4] · focus:outline-none focus:border-[#4AF626]/60 |

---

## 十二、来源与许可

- 素材仓库：AnxForever/**stylekit**（MIT License, © 2026 AnxForever）
- 源文件：`lib/styles/developer-terminal.ts`、`lib/styles/developer-terminal-tokens.ts`
- 转换脚本：`D:\项目\scripts\convert-stylekit-systems.mjs`（一次性、可复跑）
- 局部改动：按 `aiRules` 剔除 `globalCss` 中的矛盾项（见第八节），其余内容保持源样。
- 注意：源仓库的 `components` 字段含可复制的 JSX 组件代码模板，本轮**未纳入**设计系统格式（本项目格式无组件槽位）。
