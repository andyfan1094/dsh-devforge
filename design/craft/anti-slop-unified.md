---
name: 反 AI 味统一禁项清单（判定全书）
description: 合并 hallmark/slop-test、taste-skill、impeccable（craft-floor + anti-ai-slop + slop-checklist + critique）三源共 223 条提取项，去重后按 P0/P1/P2 分档，逐条给出可判定细节与全部出处。
triggers:
  - 反AI味
  - AI味
  - 去AI味
  - slop
  - anti-slop
  - 设计禁项
  - 视觉自检
  - 交付前检查
  - 设计稿评审
  - 前端审美
od:
  category: craft
---

# 反 AI 味统一禁项清单（判定全书）

> **合并来源**（三份已提取清单，未回读原始仓库）：
> `tmp/slop-extract/hallmark.md`（slop-test 58 道 gate + 六轴自评）、`tmp/slop-extract/taste-skill.md`、`tmp/slop-extract/impeccable.md`（impeccable craft-floor + OpenDesign anti-ai-slop + stylekit slop-checklist + critique）。
> **出处缩写**：`hallmark` = hallmark/slop-test；`taste` = taste-skill；`IM-craft` = impeccable/craft-floor；`IM-anti` = impeccable/anti-ai-slop；`IM-check` = impeccable/slop-checklist；`IM-critique` = impeccable/critique。
> **分档**：P0 命中即返工 / P1 应改 / P2 打磨。同一现象多源档位冲突时**取最严格档**，冲突已在条目内注明。
> **与 `slop-checklist.md` 的分工**：那份是交付前打钩用的短清单，这份是判定规则全书（含判定方式、数值阈值与出处）。

## 怎么用（三步）

1. **开工前把 P0 背下来**：P0 是返工线，不是优化项。动笔前先过一遍 P0 目录，任何一条命中即整段重做，不要交给评审。
2. **生成后逐条核**：按本文件从上到下扫一遍，先查可机械判定的（`font-family`、`transition`、`border-left` 宽度、`grid-template-columns`、对比度数值、`ch` 宽度、z-index、hex 裸值），再查需要目视的（装饰有无动机、留白节奏、层级）。
3. **交付前截图自检**：在 320 / 768 / 1024 / 1440 / 1920px 各截一张，看横向滚动、可点击文本折行、图文溢出、hover/focus 态、以及"截图给外人看能否认出是哪个产品"。

---

## P0 必改（命中即返工）

### 字体与排版

- **[P0] 显示字体用被用滥或系统默认字体** → 查 `font-family` / `--font-display`，h1/h2 必须 `var(--font-display)` 不得硬编码；命中 Inter / Roboto / Open Sans / Poppins / Lato / Geist / Fraunces / Plus Jakarta Sans / Impact / Arial Black / 平台默认无衬线 / `system-ui` 即判负 → 出处：hallmark + taste + IM-check + IM-anti + IM-craft
  - 替代池须跨项目轮换（taste 给 `Outfit` / `Cabinet Grotesk` / `Satoshi` 或品牌衬线）；`Fraunces` 与 `Instrument_Serif` 明确禁用；「创意简报 = 衬线」是生产测试里最常见的 AI tell，衬线仅品牌点名或编辑/奢品/出版语境且能说清理由才用。
  - **冲突取严**：taste-skill 曾把 `Geist` 列为优先替代，IM-check 把 `Geist` 列入用滥字体 → 禁用。
- **[P0] 字距紧于 −0.04em** → 读实际 `letter-spacing`，地板止于 −0.04em，−0.02 到 −0.03em 通常更好看 → 出处：IM-craft
- **[P0] display 字号超过 6rem，或标题行不平衡、字号与字重层级跳变不明显** → 读实际 `font-size` 与层级对比 → 出处：IM-craft
- **[P0] 正文行宽（measure）偏离 65–75ch** → 读计算后的真实值，不凭感觉 → 出处：IM-craft + hallmark + taste（冲突取严：hallmark 允许 45–75ch，仅多栏窄容器场景可下探至 45ch）
- **[P0] display 斜体降部被裁** → 斜体词含 `y g j p q` 时禁 `leading-[1]` / `leading-none`，至少 `leading-[1.1]` 并给包裹元素留 `pb-1` / `mb-1`，逐词审计 → 出处：taste
- **[P0] 标题内混字族强调或标题用斜体** → `h1`–`h6`、`.*__title`、`.hero__title`、wordmark、数字、页脚陈述、或标题内 `<em>` / `<i>` 上出现 `font-style: italic` 即判负；标题一律正体，强调只用同字族的 italic/bold、字重、强调色或手绘下划线，斜体仅允许正文段落内 → 出处：taste + hallmark（hallmark 记为 P2，取严 P0）
- **[P0] monospace 当「技术感」戏服穿** → 查 `font-family` 是否用在非代码、非数据、非度量文本上；mono 出现在图注、标签、数字即算占掉一个字体家族 → 出处：IM-craft + hallmark
- **[P0] display 文本与 seed 绑定的字族不一致** → h1/h2 必须用 `var(--font-display)`，硬编码 Inter / Roboto / `system-ui` 即判负 → 出处：IM-anti

### 色彩与对比度

- **[P0] AI 紫/靛蓝与紫→蓝渐变** → accent 命中裸 hex `#6366f1` / `#4f46e5` / `#4338ca` / `#3730a3` / `#8b5cf6` / `#7c3aed` / `#a855f7` 即判负；hero 上 purple→blue / blue→cyan / indigo→pink / 青→品红 两停渐变即判负；禁自动紫色按钮辉光与随机霓虹渐变（Lila 规则），品牌点名才用紫且需一致色盘 + 协调中性色 + 克制渐变；应改用 `--accent` token → 出处：hallmark + taste + IM-anti
- **[P0] 渐变文字** → 检查 `background-clip: text` 或渐变填充文字；强调应来自字重或字号，无任何 genre 允许渐变标题 → 出处：hallmark + IM-craft + IM-check
- **[P0] 纯 `#000` / 纯 `#fff` 当基础色** → 查色值，纯黑改 off-black / `zinc-950` / charcoal；`modern-minimal` 仅允许纯 `#fff` 纸面 → 出处：hallmark + taste
- **[P0] 对比度不达标** → 正文（<24px regular 或 <18px bold）需 WCAG 4.5:1 / APCA Lc ≥ 60；大字（≥24px regular / ≥18px bold）、图标、`:focus-visible` 焦点环需 3:1 / Lc ≥ 45；OKLCH 预检 `|L_text − L_bg| < 50%` 判疑似失败；表单 label / placeholder / 焦点环 / 帮助与错误文字同样过 AA；照片上的 ghost 按钮必须有底衬或描边；暗色双模正文过 AA、hero 过 AAA，品牌主色不得被暗色模式洗掉 → 出处：hallmark + taste + IM-craft + IM-critique
- **[P0] 按钮文字 ≈ 按钮填充色** → OKLCH 内亮度差 < 5% 且 chroma 差 < 0.05 即判负（典型 `color: var(--color-ink)` + `background: var(--color-ink)`）；`bg-white` CTA + `text-white` 标签、无边框透明按钮全部禁止 → 出处：hallmark + taste
- **[P0] 强调色 token 纪律** → `--color-accent` 铺底却缺 `--color-accent-ink`（未定义/未使用/未达 Lc 60 或 4.5:1）判负；选定 accent 后全页通用，暖灰站第 7 区冒蓝 CTA、玫瑰站页脚出青绿徽标均判负 → 出处：hallmark + taste
- **[P0] 深色分区 ink-on-ink** → `background-color` 的 OKLCH 亮度 < 50% 却未同步切换文字色（通常换 `--color-paper`）并让子元素继承；同一规则内必须同时写 `color` → 出处：hallmark
- **[P0] 有色表面上给次级文字直接上灰色** → 必须从该色相或前景色取色 → 出处：IM-craft + IM-check
- **[P0] 零偏移彩色光晕当深度，或霓虹外发光** → 阴影必须带偏移量 + 柔和模糊；发光改内边框或微染色阴影 → 出处：IM-craft + taste
- **[P0] 仅靠颜色传达含义** → 红 = 错误、绿 = 成功不得是唯一载体 → 出处：IM-critique

### 结构与布局

- **[P0] 三等列卡片网格 + 图标在标题上方的瓷砖式排布** → 查 `grid-template-columns` 与卡片结构；出现可互换的等尺寸「图标 + 标题 + 说明」卡片组即判负；改 2 列锯齿、不对称网格、滚动钉住或横向滚动 → 出处：hallmark + taste + IM-craft
- **[P0] 卡片内嵌套卡片** → 查 DOM 层级，卡片里再套卡片永远是错的 → 出处：hallmark + IM-craft
- **[P0] 卡片/列表项/callout/alert 上出现 > 1px 的彩色 `border-left` / `border-right` 强调条** → 读出实际 border 宽度 > 1px 即判负；圆角卡片 + 彩色左边框 = 「AI 仪表盘瓦片」标志形状，圆角与左边框必须去掉其一 → 出处：hallmark + IM-craft + IM-anti
- **[P0] 形状堆叠过多** → 同元素叠加 > 1 个 hover 效果（translate + scale + shadow + colour + rotate）即判负；`hover:scale-105` 等统一悬停缩放铺在多处不相关元素上同样判负 → 出处：hallmark
- **[P0] Hero 全屏居中** → `min-height: 100vh` / `h-screen` 且全部居中，或 eyebrow / title / lede / CTA 全压同一条竖向中心轴即自动判负；最多留两个居中元素，eyebrow 或 CTA 必须偏心（margin 对齐 / 右贴齐 / 数字锚定）；视口高度一律 `min-h-[100dvh]` 不用 `h-screen` → 出处：hallmark + taste
- **[P0] 圆角体系混用或越界** → 读 `border-radius` 实际值：卡片圆角不得超出 12–16px，非小型控件不得用胶囊形；全页锁一套（全直角 0 / 全软 12–16px / 交互元素全胶囊），方按钮配圆卡片判错 → 出处：taste + IM-craft
- **[P0] 1px 描边压在宽而柔的阴影上（幽灵卡片），或同层级 border 与 shadow 双声明** → 层级只声明一次 → 出处：IM-craft
- **[P0] 硬偏移阴影 `box-shadow: 4px 4px 0`（零模糊实心块）** → 除非该视觉世界真的是新粗野主义，否则判负 → 出处：IM-craft
- **[P0] 等宽留白当唯一分隔** → 分区仅靠等宽留白分隔，无分隔线、无装饰、无色彩变化，节奏完全一致即判负；用「数学上完美」的均等 padding/margin 制造整洁属 AI tell，要点是刻意的不对称留白 → 出处：hallmark + taste
- **[P0] 同组不紧凑、异组不宽松，或标题上方留白不多于下方** → 读计算后的真实间距值 → 出处：IM-craft
- **[P0] Nav 指纹** → wordmark 左 + 4–5 个行内文字链接居/右 + 按钮居右占满整宽 + 1px 发丝下边框 + 白底即判负（除非 brief 明确只有 2 个目的地且 genre 路由表允许 N1a）；导航在 1024px 必须单行，高度上限 80px、默认 64–72px → 出处：hallmark + taste
- **[P0] Footer 指纹** → 4 列链接（Product / Company / Resources / Legal）+ 社交图标行 + 最底部极小版权 + 1px 发丝上边框 + 中性灰底即判负（除非是真文档根/枢纽页）；改用 Ft1/Ft2/Ft4/Ft5/Ft6/Ft7/Ft8 → 出处：hallmark
- **[P0] 分区标题用「左大标题 + 右悬浮小段」split-header** → 默认禁用；标题与说明改纵向堆叠（正文 `max-width: 65ch`），只有右栏承载真实视觉/交互元素时才可用 → 出处：taste
- **[P0] 未覆盖 brief 的每一条要求** → brief 每条要求都应落地且能在几秒内找到 → 出处：IM-craft

### AI 默认版式与指认

- **[P0] eyebrow / kicker 标签** → 每个 section 标题上方放小型全大写、字距拉开的标签属禁令而非默认值，任何 brief 都挣不回豁免；机械判定：小号 `uppercase tracking` 标签数量 ≤ `ceil(sectionCount / 3)`，hero 计 1；eyebrow 与标题同排并列（tag-left、header-right）自动判负，含 eyebrow + 标题的同一 wrapper 必须单列（`display: block`、`flex-direction: column` 或 `grid-template-columns: 1fr` / `minmax(0, 1fr)`），禁止 `1fr 2fr` / `minmax(0,0.4fr) minmax(0,1fr)` / `auto 1fr`；章节编号 `01 / 02 / 03` 除序号本身携带读者需要的信息外即判负 → 出处：hallmark + taste + IM-craft + IM-check + IM-critique
- **[P0] 生成前未声明设计判断，直接出代码** → 出稿第一行必须是 `Reading this as: <page kind> for <audience>, with a <vibe> language, leaning toward <design system or aesthetic family>`，无此句即失败 → 出处：taste
- **[P0] 视觉决策未由三个全局旋钮门控，或自造旋钮别名** → 全篇布局/动效/密度决策必须由 `DESIGN_VARIANCE` / `MOTION_INTENSITY` / `VISUAL_DENSITY` 门控，基线 `8/6/4`，覆盖只在对话中发生；出现 `LAYOUT_VARIANCE`、`ANIM_LEVEL` 等非规范变量名即判错 → 出处：taste
- **[P0] 声明高动效但页面是静态的** → 声明 `MOTION_INTENSITY > 4` 时 hero 入场、关键分区滚动揭示、CTA hover 物理至少要有，做不到就降到 3 交静态页；截断的 ScrollTrigger、跳变入场、缺 cleanup 的半成品动效同样判错 → 出处：taste
- **[P0] hero 首屏硬约束被破坏** → 标题 ≤ 2 行（4 行标题一律判为字号错误）、副文案 ≤ 20 词且 ≤ 3–4 行、CTA 不滚动即可见；hero 文本元素超 4 个即判负（只允许 eyebrow 或品牌条 0 或 1、标题、副文案、1 主 CTA + ≤ 1 次 CTA）；hero 顶部内边距桌面最大 `pt-24`（≈6rem）；超 6 词标题禁 `text-7xl` / `text-8xl`，默认 `text-4xl md:text-5xl lg:text-6xl`，仅 3–5 词标题可用 `text-6xl md:text-7xl` → 出处：taste
- **[P0] hero 内塞信任/定价/功能信息** → 禁 CTA 下方小 tagline、信任微条、价格预告、功能 bullet 列表、社交证明头像行；"Used by / Trusted by" logo 墙必须移到 hero 下方独立分区 → 出处：taste
- **[P0] hero 大数字模板** → 大数字 + 小标签 + 几组佐证数据 + 强调色的组合即判负 → 出处：IM-craft
- **[P0] 布局家族反复出现或图文锯齿** → 一个布局家族（三列图文卡、通栏引用、左右分栏等）每页最多出现 1 次，8 个分区至少 4 种布局家族；左图右文/左文右图最多连续 2 段，第 3 段连续即 Pre-Flight Fail，须用通栏/纵向堆叠/bento/跑马灯打断 → 出处：taste
- **[P0] bento 格子数与内容数不符** → 格子数必须恰好等于内容数，禁空格 tile；任一多格网格中至少 2–3 格要有真实图像 / 非 AI 紫渐变 / 纹理 / 底色变化，纯文字奶白 bento 判为 AI 默认 → 出处：taste
- **[P0] 引用正文过长或署名不完整** → 引用正文 ≤ 3 行；署名 = 姓名 + 职位（+ 可选公司），只写「- Sarah」判错 → 出处：taste
- **[P0] 规格表每行一条 `border-b`，或长列表每行同时加 `border-t` + `border-b`** → 厨具规格表模式判为 AI 默认并禁用，改用 2 列卡片、滚动胶囊、3 簇分组（每簇一条软分隔）、精选 3–4 项 + "查看全部"折叠；长列表只选一种边并稀疏使用 → 出处：taste
- **[P0] 表单 label 用 placeholder 顶替** → label 必须在 input 上方、错误提示在下方、输入块间距 `gap-2`，placeholder 当 label 一律禁止 → 出处：taste
- **[P0] 主 CTA 文案换行、多个同义 CTA，或可点击文本折行** → CTA 桌面必须单行、≤ 3 词（理想 1–2），同一意图全站只保留一个标签；按钮标签、主导航链接、页脚链接、tab、面包屑、CTA 在 320–1920px 任一视口折成 2 行以上即判负（缩短文案优先，`white-space: nowrap` 让父级重排，窄屏 `hidden=until-found` 丢弃非必要项或折叠为 sheet）→ 出处：taste + hallmark
- **[P0] 真实文案在任一断点溢出** → 每个断点跑一遍真实文案修掉所有溢出；显示级元素（`h1`、`.hero__display`、`.section__title`、`.skill-row__title`）须 `overflow-wrap: anywhere; min-width: 0`，长连字符词（"AI-generated"）会顶出视口；含 `<img>` / `<picture>` 的 grid 轨道必须写 `minmax(0, 1fr)`（纯 `1fr` = `minmax(auto, 1fr)`，1024px+ 原图会把布局顶出视口）→ 出处：IM-craft + hallmark
- **[P0] 重绘 UI 外壳 / 手搓假截图 / 草稿风 SVG** → 用 HTML/CSS 或 SVG 手搓假浏览器栏（URL 药丸 + 三色圆点）、假手机框、假代码框、假终端框、假 IDE chrome 即判负；禁 div 矩形拼假产品 UI（假任务列表/假终端/假仪表盘，称 #1 LLM 设计 Tell）、禁破链 Unsplash 链接、禁 hero 用「文字 + 渐变光斑」充当视觉；草稿风 SVG 场景、`loose-sketch` / `doodle` 类名、`feTurbulence` 颗粒冒充插画同样判负（禁的是 SVG 冒充图片，不禁 SVG 做几何）；改用 `<picture>` / `<figure>` 放真实截图或直接省略 → 出处：hallmark + taste + IM-craft
- **[P0] 三列等宽/等尺寸卡片网格充当页面结构** → 出现可互换的等尺寸卡片组即判定 → 出处：IM-craft + IM-check
- **[P0] 用 sparkline、进度环、柔和阴影圆角矩形顶替内容，或用带填充底轨的评分/进度条做对比视觉** → 命中该组合即判为装饰性铺陈；禁大块 `bg-zinc-200` 底轨，改用数字 + 小图标或去掉底轨的极细内联条 → 出处：IM-craft + taste
- **[P0] 用几何遮罩（圆、多边形、radial-gradient 挖空）冒充有机轮廓的摄影主体** → 应从真实图像导出 alpha 蒙版或产出抠好的切图，比不做更难看 → 出处：IM-craft
- **[P0] `repeating-linear-gradient` 条纹或双轴网格叠加层做背景** → 下方必须真的有画布、地图、蓝图或测量工具支撑，否则判负 → 出处：IM-craft

### 装饰、图标与元数据

- **[P0] 装饰无畏无由** → hero 里放无内容语义锚点的光标、扫描线、渐变团、抽象形状、徽章、贴纸、装饰性 blob / wave SVG 即判负；装饰必须有动机（打字命令里的光标、指代期号/年份/版本/章节的数字、响应交互的渐变、标明作者或日期的印章）→ 出处：hallmark + IM-anti
- **[P0] emoji 当图标，或图标描边与字重不统一** → 检查 `✨` `🚀` `⚡` `🔥` `🎯` `💡` `✅` 是否出现在 `<h*>`、`<button>`、`<li>`、`class*="icon"` 内（feature 卡 / 价值点 / 步骤 / 价格档图标）；应改用真实图标库、1.6–1.8px 描边 monoline SVG 配 `currentColor`，或纯排版 → 出处：hallmark + IM-craft + IM-anti
- **[P0] 手搓 SVG 图标或手搓插画** → 禁止手绘图标路径，改用 Phosphor / HugeIcons / Radix / Tabler（Lucide 仅点名时），手搓装饰性 SVG 强烈劝退（仅简报点名、单个简单几何标记或确有质量把握时可用）→ 出处：taste + IM-craft
- **[P0] 混用两个及以上图标库或两套设计系统** → Material + Heroicons + Lucide 同页判负；只允许一套设计系统（禁 Material + shadcn 混用）→ 出处：hallmark + taste
- **[P0] 非语义微元行与版本标签** → 禁 `V0.6` / `v2.0` / `BETA` / `INVITE-ONLY PREVIEW` / `EARLY ACCESS` / `ALPHA` 当 eyebrow（除非简报就是产品发布/预览）；禁 "Marrow · No. 01 · The 6-quart" 式微元行、禁 "Index of Work, 2018 - 2026" 式区间标签、禁 `00 / INDEX` / `001 · Capabilities` / `06 · how it works`、禁图片/bento 上的 `01 / 4` 分页、禁 `Scroll · 001 Capabilities` → 出处：taste
- **[P0] 滚动提示与装饰性小圆点、旋转文字、细线网格** → 禁 `Scroll` / `↓ scroll` / `Scroll to explore` 与滚轮动画图标（用户知道怎么滚）；状态点默认零个，仅真实语义状态可用且每分区最多 1 个；禁 90° 旋转的 "INDEX OF WORK"（除非明确 agency/Awwwards 且服务真实构图）；禁仅为「显得有设计感」画的十字/细线网格 → 出处：taste
- **[P0] 装饰性元数据** → 禁图上 `<span>` overlay 标签（`Brand · 02`、`PLATE · BRAND`），图注只能放图下且只有真实摄影师真实作品才允许署名，禁 `Field study no. 12 · Ines Caetano` / `Plate 03` / `Frame XII · 35mm`；禁营销页版本页脚 `v1.4.2` / `Build 0048` / `last sync 4s ago · main`；禁 "Reservation 412 of 800" 式库存装饰（除非真实限时等候名单）；99% 简报禁 locale / 城市 / 时间 / 天气条（"Lisbon 14:23 · 18°C"），仅全球分布工作室、旅行品牌或真实线下场地可用，页脚一句真实地址可以 → 出处：taste
- **[P0] 按品类（而非使用场景）反射式选浅色或深色主题** → 命中即判负；应按「谁、在哪、什么环境光」决定 → 出处：IM-craft
- **[P0] 对既不需要打断、也不需要保护注意力的任务使用 modal** → 反推出的默认反射即判定 → 出处：IM-craft

### 内容与文案

- **[P0] 编造数据与指标** → 页面出现用户未提供、无来源的量化声明（"10× faster"、"saves 5 hours per week"、"trusted by 50,000+ teams"、"99.9% uptime"、"+47% conversion"、"3× more productive"）即判负；示意性数值不注明是示意同样判负；改成 `—` + 灰色占位块、向用户提问、或重构掉该证明位；统计数字绝不能当 hero 唯一大标题 → 出处：hallmark + taste + IM-anti + IM-craft
- **[P0] 假完美数字与无来源的假精确规格** → 禁 `99.99%` / `50%` / `1234567`，改有机脏数据（`47.2%`、`+1 (312) 847-1928`）；`92%` / `4.1×` / `5.8 mm` 一类数字除非来自真实数据或显式标注 mock（`<!-- mock -->` / "sample data"）否则禁用，不得伪造品牌未宣称的工程精度 → 出处：taste
- **[P0] 通用人名与通用头像** → 禁 "John Doe" / "Jane Doe" / "John Smith" / "Sarah Chan" / "Jack Su"，改用符合地域的真实感名字；禁 SVG 蛋形头像与 Lucide user 图标，改可信照片占位或专门样式 → 出处：taste + hallmark（hallmark 记为 P2，取严 P0）
- **[P0] 创业废话品牌名与填充动词** → 禁 Acme / Nexus / SmartFlow / Cloudly / Seamless / Unleash，禁 Elevate / Next-Gen / Revolutionize，只留具体动词 → 出处：taste + hallmark
- **[P0] 填充文案** → `lorem ipsum`、`feature one / two / three`、`placeholder text`、`sample content` 一律禁止；空区块是设计问题，要用构图解决而不是编词 → 出处：IM-anti
- **[P0] 一页混多种文案语域** → 技术 mono 数据、编辑散文、营销口播不得同屏混排，除非品牌声音明确要求 → 出处：taste
- **[P0] 诗性伪工匠标签、假谦逊行业梗、微元句子** → 禁 "Quietly in use at" / "Quietly trusted by"（改 Trusted by / Used at 或省略）、禁 "From the field" / "Field notes" / "Currently on the bench" / "On our desks"、禁 "We respect the French ones" 式文案；禁 eyebrow 下方塞微元句子、hero 底部装饰字带、分区标题右上角悬浮小段（eyebrow + headline + body 三层就够）→ 出处：taste
- **[P0] 通用步骤标签** → 禁 "Stage 1/2/3"、"Step 1/2/3"、"Phase 01/02/03"、"Pass One/Two/Three"，直接用品词（Install / Configure / Ship）→ 出处：taste
- **[P0] 交付前不做文案自查** → 必须逐条复读所有可见字符串（标题、副标题、eyebrow、按钮、正文、图注、alt、页脚、错误信息），标出语法破碎 / 指代不明 / 像 AI 幻觉 / 像 LLM 装深沉者并重写；宁可平实无聊也不要 AI 小聪明 → 出处：taste
- **[P0] 文案不用产品自己的语言** → 控件名说不清执行什么动作、错误信息说不清问题是什么与怎么恢复即判负；错误信息禁用错误码或术语、禁只说「Something went wrong」，须平实语言 + 精确指明问题（「Email is missing @」而非「Invalid input」）+ 可执行恢复建议且不抹掉表单 → 出处：IM-craft + IM-critique
- **[P0] 外部占位图 CDN** → 禁用 `unsplash.com` / `placehold.co` / `placekitten.com` / `picsum.photos`，改用随交付的 `.ph-img` 占位类 → 出处：IM-anti（**冲突记录**：taste 把 `picsum.photos/seed/{描述性seed}/{w}/{h}` 列为真实网络图回退方案，与 IM-anti 冲突 → 取严禁止外链 CDN）
- **[P0] 未验证即宣称结果存在** → 例如脚本注入未成功、检测器未在页面运行却声称覆盖层已生效，不得虚报未发生的事 → 出处：IM-critique
- **[P0] 在无真实 Design Context 时虚构受众细节或生成项目专属画像** → 没有真实数据就用预定义画像 → 出处：IM-critique

### 动效与交互

- **[P0] 缓动与循环滥用** → 用 linear 缓动、每张卡片挂无限循环动画、或 bounce / elastic 弹跳曲线（如 `cubic-bezier(0.34, 1.56, ...)`）用于 UI 状态变化（按钮、模态、tooltip）即判负；过冲只留给物理式交互，弹簧固定 `type: "spring", stiffness: 100, damping: 20`，信息型分区保持静止 → 出处：hallmark + taste + IM-check（hallmark 记为 P1，取严 P0）
- **[P0] 动画作用在 `top` / `left` / `width` / `height` / `margin` / `padding` 上** → 只允许动 `transform` 与 `opacity`；`will-change: transform` 只给确实会动的元素 → 出处：hallmark + taste
- **[P0] `prefers-reduced-motion` 未兜底** → 任一 `transform` / `animation` 关键帧未被兜底即判负；关掉动效后页面依然必须成立；Motion 用 `useReducedMotion()` 降级，CSS 用 `@media (prefers-reduced-motion: no-preference)` 门控或 `reduce` 覆盖块；无限循环、视差、滚动劫持、磁吸物理必须塌为静态/瞬时 → 出处：hallmark + taste + IM-check（hallmark 记为 P1，取严 P0）
- **[P0] 用 `window.addEventListener("scroll", ...)` 或 `requestAnimationFrame` 循环触碰 state** → 硬禁；改 Motion `useScroll()`、GSAP `ScrollTrigger`、IntersectionObserver 或 CSS `animation-timeline: view()`；滚动进度用 `useMotionValue` + `useTransform` 在渲染循环外跑 → 出处：taste
- **[P0] 动画说不出理由** → 每个动画必须能一句话说清它传达什么（层级/叙事/反馈/状态变化），答「因为好看」即删；「装了 GSAP 所以到处 GSAP」属业余，每个 ScrollTrigger、marquee、钉住分区都要有理由 → 出处：taste
- **[P0] 特效散落各处，或每个 section 都用同一个入场动画** → 只留一个有意图的时刻，用指数型 ease-out，从「本来就可见」的默认态出发 → 出处：IM-craft
- **[P0] 为「以防万一」给静态内容套 Motion `layout` 属性** → 禁止，白付测量开销；`layout` / `layoutId` 只用于真实可见状态变化 → 出处：taste
- **[P0] 磁吸微物理用 `useState` 实现** → 必须用 Motion `useMotionValue` / `useTransform` → 出处：taste
- **[P0] 玻璃态与高级动效道具当默认开启** → 检查 `backdrop-filter` / 半透明模糊是否被当默认表面而非服务特定效果；玻璃拟态、磁吸微物理（`MOTION_INTENSITY > 5` 且 premium/playful/agency）、永续微交互（Pulse / Typewriter / Float / Shimmer / Carousel，> 5）都必须由 design read 触发，不自动生效 → 出处：IM-craft + IM-check + taste（taste 记为 P1，取严 P0）
- **[P0] 状态不齐：hover、disabled、loading、error、empty 缺任一，或缺真实内容、可用控件、响应式构图、键盘焦点** → 逐态核对，代码内至少需 default + hover + focus-visible + active + disabled；加载态用与终布局同形的骨架屏，禁通用圆圈 spinner；`:active` 用 `-translate-y-[1px]` 或 `scale-[0.98]` 做触觉反馈 → 出处：IM-craft + taste + hallmark（hallmark 记为 P1，取严 P0）
- **[P0] 浏览器原生面未上色** → 文本选区、caret、自定义滚动条、焦点环、下划线偏移量、表格数字字形仍是浏览器默认样式即判负；默认样式不属于任何设计系统，必须用调色板给它们上色——这是模型最稳定会漏掉的一项 → 出处：IM-craft
- **[P0] 焦点指示缺失、不可见，或点击式交互没有键盘替代** → 主流程必须可纯键盘完成，所有可交互元素可聚焦且有可见焦点环 → 出处：IM-critique + hallmark
- **[P0] 触控目标小于 44×44pt** → 读出实际尺寸即判定；输入控件与相邻按钮共用基准高，下限 44px（38px input + 44px 按钮为最常见疏漏）→ 出处：IM-critique + hallmark
- **[P0] 深色模式只做单模或不做** → 面向消费者页面必须从一开始双模设计，禁无明确要求只做 light-only / dark-only；遵循 `prefers-color-scheme`，品牌主色不得被暗色模式洗掉 → 出处：taste
- **[P0] 颗粒/噪点滤镜挂在滚动容器上** → 只能挂 `fixed` + `pointer-events-none` 伪元素（禁挂滚动容器，持续 GPU 重绘毁移动端帧率）→ 出处：taste
- **[P0] 随手撒 `z-50` / `z-10`** → z-index 只用于系统性层级（吸顶导航、模态、遮罩、颗粒层），并在常量文件记录 z 轴刻度 → 出处：taste
- **[P0] 引入未安装的三方库** → 引入前先查 `package.json`，缺包先输出安装命令，禁假设库存在 → 出处：taste
- **[P0] 未经批准静默改动既有资产** → 以下必须用户明确批准：URL 结构/路由 slug、主导航标签、表单字段名与顺序（破坏分析 + 自动填充）、品牌 logo/字标、既有法律/同意/cookie 文案 → 出处：taste

### 信息架构与可访问性（UX 认知面）

- **[P0] Visual Noise Floor** → 界面所有元素视觉权重相同、没有任何东西跳出来即判负；应建立明确层级：1 个主元素、2–3 个次元素，其余全部弱化 → 出处：IM-critique
- **[P0] 装饰性杂物与注意力竞争** → 界面含无关或极少用到的信息即判负；每个元素都必须挣得它的像素 → 出处：IM-critique
- **[P0] Wall of Options** → 一次呈现 10+ 选项且无层级即判负；单个决策点可见选项须 ≤ 4，信息组每组 ≤ 4 项，需分组、标推荐、渐进披露 → 出处：IM-critique
- **[P0] Memory Bridge / Context Switch** → 用户必须记住第 1 步的信息才能完成第 3 步，或单个决策需要跨屏/标签/弹窗来回收集信息，即判负；应把该决策所需信息放在一起 → 出处：IM-critique
- **[P0] Hidden Navigation** → 用户必须自己建立位置心智地图、当前位置不可见即判负；始终显示当前位置：breadcrumbs、active 态、进度指示 → 出处：IM-critique
- **[P0] Jargon Barrier** → 技术或领域黑话未就地定义、迫使用户翻译即判负；用平实语言，无法避免的术语要 inline 定义 → 出处：IM-critique
- **[P0] Inconsistent Pattern** → 相似动作在不同位置行为不同即判负；同类动作必须同类型 UI → 出处：IM-critique
- **[P0] Multi-Task Demand** → 界面要求一边读、一边决策、一边导航即判负；应把步骤串行化，一次只做一件事 → 出处：IM-critique
- **[P0] 图片缺有意义的 alt 文本，或表单字段/按钮无标签** → 命中即判负 → 出处：IM-critique
- **[P0] 屏幕阅读器不播报状态变化（loading、success、error），或自定义组件破坏读屏顺序** → 命中即判负 → 出处：IM-critique
- **[P0] 功能看似可用却静默失败或产生错误结果** → 判定为欺骗性可用 → 出处：IM-critique
- **[P0] 空状态只显示「No results」而无任何引导** → 空态必须给出下一步 → 出处：IM-critique
- **[P0] 刷新或导航导致用户数据丢失、状态不保留** → 命中即判负 → 出处：IM-critique
- **[P0] 边界输入未处理** → 0 项、1000 项、超长文本、emoji、特殊字符、RTL 文本、从 Excel 粘贴必须逐一验证不溢出、不破版、不丢数据 → 出处：IM-critique

---

## P1 应改

- **[P1] 结构复用失当** → 通用 AI 模板（Hero → 3 features → CTA → footer，或 Hero → Features → Pricing → FAQ → CTA）即判负；与项目内上一次产出同结构指纹/宏观结构也判负（读 `.hallmark/log.json` 或 CSS 宏观结构戳，本次必须与上次不同）；至少引入一个非常规 section（整幅引语式口碑墙、对照现状的定价、内联迷你产品演示）→ 出处：hallmark + IM-anti
- **[P1] `transition: all` / `transition-all`** → 必须显式列出属性 → 出处：hallmark（**冲突记录**：taste 在 MOTION 4–7 档自己开出了 `transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1)` 配方，与 hallmark 禁令冲突 → 取严：禁 `transition: all`，改用同等时长曲线的显式属性列表）
- **[P1] 自动轮播内容缺暂停机制（WCAG 2.2.2）** → carousel / banner / stats 缺 hover 与 focus 暂停即判负 → 出处：hallmark
- **[P1] 中性/表面色用 `oklch(... 0 ...)`（零 chroma 纯灰）** → 每个中性色向锚点色相微调，chroma 至少 0.005；`modern-minimal` 允许零 chroma → 出处：hallmark
- **[P1] 强调色覆盖单视口 > ~5%** → 按面积算（实心填充、大面积强调色标题、满屏强调背景）；`atmospheric` 允许强调色调径向光晕至 ~20% → 出处：hallmark
- **[P1] 抽象背景超限** → 超过一种强调色、覆盖 > ~5%、或全页动画 mesh-gradient（极光球、满页 mesh）均判负；`atmospheric` 允许最多两个暖调径向光晕覆盖 ~20–30% 画布、固定附着、不带动画 → 出处：hallmark
- **[P1] 间距不在命名刻度上** → padding / gap / margin 必须落在 `--space-3xs` … `--space-5xl`（4px 倍数），任意值如 `padding: 17px` 判负 → 出处：hallmark
- **[P1] 输入控件状态细节错误** → 命中任一项即判负：① 各状态间 `border-width` 变化（default/hover/focus/error 都必须 `border-width: 1px`，状态只改 `background-color` / `outline` / `box-shadow` / `border-color`）；② 焦点环用 `border` 实现（必须 `outline: 2px solid var(--color-focus)` + `outline-offset: 1px`，静态态预留 `outline: 2px solid transparent` 防几何位移）；③ 同表单内 input 高度 ≠ 相邻按钮高度；④ 辅助文字槽为空时塌陷（无 helper/error 也须 `min-height: 1lh`）；⑤ 禁用态只靠 `opacity`（需三通道：`opacity: 0.55` AND `cursor: not-allowed` AND 原生 `disabled` 或 `aria-disabled="true"`）→ 出处：hallmark
- **[P1] token 纪律** → 中途中引入 `:root` / `[data-theme="..."]` 之外的任何色值（`#hex`、`oklch(...)`、`rgb(...)`、`hsl(...)`）或 `font-family` 声明即判负；`:root` 之外裸 hex 超过约 12 个同样说明 token 没被遵守；`var(--accent)` 每屏可见用法上限 2 处（渲染正文中出现 6 次以上即判负）；所有颜色与字体必须引用命名 token（`var(--color-accent)`、`font-family: var(--font-display)`）→ 出处：hallmark + IM-anti
- **[P1] LCP / 性能指标不达标** → LCP < 2.5s（hero 图 `next/image priority` 或 preload）、INP < 200ms、CLS < 0.1（为图/字体/嵌入预留空间）；LCP 元素杀手：演示视频自动带声播放、缺 `poster`、缺 `fetchpriority="high"`、或对 LCP 元素用 `loading="lazy"`；声明完成前跑 Lighthouse → 出处：hallmark + taste
- **[P1] 视觉性 `<svg>`、自绘 `<div>`、`<canvas>`、装饰图形缺 `aria-label` 或 `aria-hidden="true"`** → 必须有可访问名或显式隐藏 → 出处：hallmark
- **[P1] 主题级 `.section__head { grid-template-columns: ... }` 覆写为非 `1fr`** → 无移动端塌陷规则，且 `@media (max-width: 48rem)` 下不存在同特异度的全局 `[data-theme] .section__head { grid-template-columns: 1fr }` 即判负 → 出处：hallmark
- **[P1] 全大写显示标题 `line-height` < 1.0** → 显示级元素（`.hero__display`、`.section__title`、`h1`、`h2`、≥ `--text-2xl`）同时声明 `text-transform: uppercase` 与 < 1.0 行高（或 `--lh-tight`）即判负；底线 `line-height: 1.0`，推荐 `1.02–1.08`，或去掉 `text-transform: uppercase` → 出处：hallmark
- **[P1] 非顶层导航元素也 `position: sticky; top: 0;`** → 与同样 `top: 0` 的 sticky `<header>` / `<nav>` / `.banner` 重叠出血即判负；定义 `--banner-height`（约 44–64px）并让次级 sticky 用 `top: var(--banner-height)`；拆分 `--z-sticky`（页内，如 200）与 `--z-sticky-nav`（顶导航，如 300）→ 出处：hallmark
- **[P1] 已做 study 诊断却丢弃 DNA 转用目录主题** → CSS 戳 `theme:` 写目录主题（Specimen、Midnight、Brutal、Garden、Atelier、Newsprint、Terminal、Manifesto、Almanac、Sport、Studio、Riso、Bloom、Coral、Cobalt、Aurora、Editorial、Carnival、Lumen、Hum）而非 `studied-DNA (source: ...)` 且用户未明确改向即判负；须改用 study DNA 的 token（纸面 OKLCH、强调 OKLCH、候选字体、宏观结构、原型）并把戳更新为 `theme: studied-DNA (source: <URL 或图片>)` → 出处：hallmark
- **[P1] 主色不唯一或饱和度过高** → 主色最多 1 个，饱和度默认 < 80% → 出处：taste
- **[P1] 高级消费品简报直接取 beige + brass 暖工艺色盘** → 默认禁用该色族：背景 `#f5f1ea` / `#f7f5f1` / `#fbf8f1` / `#efeae0` / `#ece6db` / `#faf7f1` / `#e8dfcb`，强调 `#b08947` / `#b6553a` / `#9a2436` / `#9c6e2a` / `#bc7c3a` / `#7d5621`，文字 `#1a1714` / `#1a1814` / `#1b1814`；替代家族：Cold Luxury、Forest、Black and Tan、Cobalt + Cream、Terracotta + Slate、Olive + Brick + Paper、纯单色 + 单点饱和色 → 出处：taste
- **[P1] 连续两个项目复用同一色盘家族** → 色盘轮换：上一个 premium-consumer 项目用过暖米 + 黄铜，这次必须换家族 → 出处：taste
- **[P1] 阴影不染背景色相** → 浅底禁纯黑投影，阴影须带背景色相 → 出处：taste
- **[P1] 每页主题不唯一** → 页面只有一个明暗主题，分区不得反转（暗页里插暖白分区判错）；整页主题在 `layout.tsx` 或页根设一次，不让分区 override → 出处：taste
- **[P1] 多列布局不写移动端折叠** → 每段多列布局在同一组件内显式声明 `< 768px` 方案，禁「Tailwind 会处理」；VARIANCE 4–10 的不对称布局在 `< 768px` 必须塌成单列 `w-full` + `px-4` + `py-8` → 出处：taste
- **[P1] 档位只写在文档里、不落到 CSS** → VARIANCE 1–3 对称 12 列等分；4–7 用 `margin-top:-2rem` 叠压、4:3 混 16:9；8–10 用 masonry、`grid-template-columns: 2fr 1fr 1fr`、`padding-left: 20vw` → 出处：taste
- **[P1] 动效档位与技术手段错配** → MOTION 1–3 只允许 `:hover` / `:active`；4–7 用过渡 + `animation-delay` 级联；8–10 才上滚动驱动编排 / parallax / ScrollTrigger → 出处：taste
- **[P1] 密度档位与技术手段错配** → DENSITY 1–3 分区间距 `py-32`~`py-48`；4–7 用 `py-16`~`py-24`；8–10 收紧、不用卡片、`1px` 细线分隔且所有数字强制 `font-mono` → 出处：taste
- **[P1] 语气信号未映射成档位** → 按映射表：minimalist/clean/editorial/Linear → 5-6/3-4/2-3；premium consumer/Apple/luxury → 7-8/5-7/3-4；playful/Awwwards/agency → 9-10/8-10/3-4；landing/portfolio 默认 → 7-9/6-8/3-5；trust-first/公共部门 → 3-4/2-3/4-5；改版-preserve → 沿用/+1/沿用；改版-overhaul → +2/+2/沿用 → 出处：taste
- **[P1] 未按用例取预设** → Landing SaaS 7/6/4；Agency 9/8/3；Premium consumer 7/6/3；设计师作品集 8/7/3；开发者作品集 6/5/4；Editorial 6/4/3；公共部门服务 3/2/5 → 出处：taste
- **[P1] 无差别使用卡片容器** → 只有阴影表达真实层级时才用卡片，否则用 `border-t`、`divide-y` 或负空间；`VISUAL_DENSITY > 7` 时禁通用卡片容器 → 出处：taste
- **[P1] shadcn/ui 默认态直接上线** → 允许使用但必须改 radius / 颜色 / 阴影 / 字体以贴合项目美学 → 出处：taste
- **[P1] `useEffect` 动画无清理函数** → 缺 cleanup 即判未完成 → 出处：taste
- **[P1] 跑马灯当填充物** → 横向滚动文字 marquee 每页最多 1 个 → 出处：taste
- **[P1] 每个分区都在灌内容** → 默认形状：标题 ≤ 8 词 + 副段 ≤ 25 词 + 1 个视觉资产或 1 个 CTA，超出须有理由 → 出处：taste
- **[P1] 长列表用默认 `<ul>` / `divide-y`** → 超过 5 项须换组件：2 列分组、卡片网格、tabs/accordion、scroll-snap 胶囊、轮播或跑马灯 → 出处：taste
- **[P1] 中圆点当万能分隔符** → `·` 在元数据条中每行最多 1 个，禁 `foo · bar · baz · qux` 式堆叠 → 出处：taste
- **[P1] 生产环境用 `<link>` 引 Google Fonts** → 必须 `next/font` 或自托管 `@font-face` + `font-display: swap` → 出处：taste
- **[P1] logo 墙用纯文字 wordmark** → 真 logo 用 Simple Icons（`https://cdn.simpleicons.org/{slug}/ffffff`）或 devicon；自造品牌名必须自造 monogram SVG；logo 必须双模可见；logo 墙只放 logo，禁在 logo 下加行业/品类标签 → 出处：taste
- **[P1] 极简站点就不放图片** → 极简也必须至少 2–3 张真实图片（hero + 产品/生活照 + 支撑图），纯文字页是未完成品不是极简 → 出处：taste
- **[P1] 视觉资产不按优先级取用** → 有图像生成工具就必须用它按分区比例生成（hero 摄影、产品图、纹理底、氛围图）→ 否则用真实网络图 → 都没有才留 `<!-- TODO: ... -->` 占位并在回复里明说需要哪些图 → 出处：taste
- **[P1] 改版不先读现有站点** → 必读现有站点的三旋钮读数作为起点而非基线；IA/内容/SEO 尚可走定向演进（杠杆 1–4，约 70% 价值/40% 风险），视觉债是结构性的才全量重做 → 出处：taste

---

## P2 打磨

- **[P2] 焦点环渐显（fade in）** → 焦点环必须瞬时出现，键盘用户需要即时指示 → 出处：hallmark
- **[P2] 对用户已能看见效果的操作弹出庆功式成功 toast** → 静默成功才是品味；toast 只用于失败与不可见效果 → 出处：hallmark
- **[P2] tooltip 的 hover 延迟与 focus 延迟相等** → hover 延迟 800–1000 ms，focus 延迟 0 ms → 出处：hallmark
- **[P2] CSS 顶部缺 `/* Hallmark · macrostructure: <name> · ... */` 戳** → 必须存在 → 出处：hallmark
- **[P2] 无诉求却默认 Specimen 宏观结构** → 左缘编号标签 + 巨型衬线 + 非对称跨栏 + 纯排版 CTA 的 Specimen 兜底禁用；atmospheric / modern-minimal / playful 永不默认，仅 editorial 且 brief 有信号时可用 → 出处：hallmark
- **[P2] 默认上 Lottie 库** → 手绘 SVG 或纯 CSS 形状本可胜任时，Lottie 是最后手段 → 出处：hallmark
- **[P2] 沿用上次原型的产出未换任何变体旋钮** → 至少换一个 knob 并在戳里写明 delta（两个 Bento Grid 都是 `tiles=6, spans=irregular, accent=corner-only` 即同一个 Bento）→ 出处：hallmark
- **[P2] 320–1920px 任一视口出现横向滚动** → 判负；必须在 `html` 与 `body` 上同时写 `overflow-x: clip`（用 `clip` 而非 `hidden`，`clip` 保留后代的 `position: sticky` / `fixed`）——这是每页硬性要求 → 出处：hallmark
- **[P2] 文字装饰效果位置与尺寸未经目视确认** → `<mark>` 高亮带须落在 x-height 后方（`linear-gradient(180deg, transparent ~38%, accent ~38%, accent ~92%, transparent ~92%)`），不得贴基线（会读成粗下划线）；下划线 1–2px 且离基线偏移 1–2px，绝不 5px+；装饰描边不超过视口 5% → 出处：hallmark
- **[P2] 交互条未显式垂直居中** → flex 行默认 `align-items: stretch` 会让按钮高于同级文字、破坏基线；混排高度不一元素（按钮+文字、图标+文字、标记+正文）的行必须声明 `align-items: center`，并对有固有高度的项设 `line-height: 1`（避免继承 `html` 的 `line-height: 1.55`）→ 出处：hallmark
- **[P2] 用 `<input type="radio">` 兄弟节点 + `:checked` 实现纯 CSS 标签页却造成页面跳跃** → 要么 radio 留在正常文档流（零尺寸 + `opacity: 0`，不用 `position: absolute; top: 0`），要么用 JS 拦截 label 点击：`e.preventDefault()`、手动 `radio.checked = true`、派发 `change`、以 `{ preventScroll: true }` 聚焦 → 出处：hallmark
- **[P2] 字体家族超过三个** → `--font-display`、`--font-body` 之外最多一个 outlier（`--font-outlier` 用于 wordmark / hero 数字 / 引文）；第四种即 slop（body + display + 代码块 mono + hero 独立 display）；同族不同字重算一族 → 出处：hallmark
- **[P2] outlier 字体用在超过两个槽位** → 规范对：wordmark + hero 数字，或 wordmark + 报头，或 hero 数字 + 引文；三个槽位说明它已变成第三正文字体，收回 body 字体 → 出处：hallmark
- **[P2] 排版默认值拍脑袋** → Display 默认 `text-4xl md:text-6xl tracking-tighter leading-none`；正文默认 `text-base text-gray-600 leading-relaxed max-w-[65ch]` → 出处：taste
- **[P2] section 缺 `data-od-id`** → 评论模式无法定位该 section → 出处：IM-anti
- **[P2] 完全对称、毫无视觉张力的布局** → 疏密交替（一段紧、一段呼吸）才读起来像有意图 → 出处：IM-anti

---

## 各源独家条目（合并的真正增量）

以下条目**只在一家出现**，是本次合并相对任一单源的净增量；实现时不要因为别家没提就忽略。

### 只在 hallmark/slop-test 出现

- Nav / Footer 结构指纹（5 元素导航、4 列页脚）判负与 Ft1–Ft8、N1a 替代清单
- Hero「全居中」双居中上限（最多两个居中元素）
- `--color-accent` ↔ `--color-accent-ink` token 配对，深色分区 ink-on-ink 同一规则内写 `color`
- CSS 顶部 `/* Hallmark · macrostructure: ... */` 戳与 `.hallmark/log.json` 结构指纹去重
- Specimen 宏观结构兜底禁用；study DNA 与目录主题的取舍（`theme: studied-DNA (source: ...)`）
- `--font-outlier` 槽位上限、字体家族 ≤ 3 计数法（mono 非代码场景算一族）
- 文字装饰高亮带渐变公式与下划线 1–2px 偏移量
- radio 标签页防页面跳跃（`{ preventScroll: true }`）
- 交互条 `align-items: center` + `line-height: 1` 基线修复
- tooltip hover 800–1000 ms / focus 0 ms；焦点环不得渐显；庆功 toast 禁令
- 变体旋钮 delta 记入戳
- 320–1920px 横向滚动硬性要求 `overflow-x: clip`（非 `hidden`）
- 次级 sticky 用 `--banner-height` 挂靠，`--z-sticky` / `--z-sticky-nav` 拆分
- 全大写显示标题 `line-height` 底线 1.0 / 推荐 1.02–1.08
- 输入控件五条细则（`border-width` 恒定、焦点环用 `outline`、input 与按钮等高 44px、helper 槽 `min-height: 1lh`、禁用三通道）
- `--space-*` 4px 刻度、中性色 chroma ≥ 0.005、强调色覆盖 ≤ 5%（atmospheric 20–30%）

### 只在 taste-skill 出现

- 开工声明句 `Reading this as: <page kind> for <audience>, ...`
- `DESIGN_VARIANCE` / `MOTION_INTENSITY` / `VISUAL_DENSITY` 三旋钮（基线 `8/6/4`）与「自造别名判错」
- 语气 → 档位映射表、用例预设表、档位 → CSS 手法对照表
- hero 数量化硬约束（元素 ≤ 4、顶距 `pt-24`、标题词数 ↔ `text-7xl/8xl` 耦合、副文案 ≤ 20 词）
- eyebrow 配额 `ceil(sectionCount / 3)`；布局家族每页 ≤ 1 次且 8 分区 ≥ 4 种；图文锯齿 ≤ 2 段
- bento 格子数 = 内容数 + 至少 2–3 格真实图像
- 引用 ≤ 3 行 + 署名规格；规格表禁每行 `border-b`；`·` 每行 ≤ 1；CTA ≤ 3 词且全站单一标签
- split-header（左大标题 + 右悬浮小段）禁用；分区默认形状（标题 ≤ 8 词 + 副段 ≤ 25 词）
- beige + brass 全套 hex 清单与七个替代色盘家族、色盘跨项目轮换
- 衬线使用门槛（`Fraunces` / `Instrument_Serif` 禁用）、斜体降部 `leading-[1.1]` + `pb-1`
- 手搓 SVG 图标禁令与图标库名单（Phosphor / HugeIcons / Radix / Tabler）
- 引入库前查 `package.json`；`useEffect` cleanup
- 装饰性元数据整族（版本标签、微元行、编号区间 eyebrow、滚动提示、状态点、旋转文字、细线网格、图上 pill、假 photo credit、版本页脚、库存计数器、locale 条）
- logo 墙 Simple Icons / devicon、自造 monogram；极简也须 2–3 张真图；视觉资产三级优先级
- `window.addEventListener("scroll")` 硬禁、rAF 触 state、Motion `layout` 滥用、弹簧 `stiffness: 100, damping: 20`、`useReducedMotion()`、磁吸 `useMotionValue`
- 暗色双模 hero 过 AAA；改版三旋钮读数；静默变更须审批清单；Pre-Flight 勾选表
- 性能预算 LCP < 2.5s / INP < 200ms / CLS < 0.1

### 只在 impeccable 出现

**craft-floor（硬地板）**

- hero 大数字模板、章节编号装饰化、无关任务 modal
- sparkline / 进度环 / 圆角矩形顶替内容；几何遮罩冒充摄影主体
- 按品类（而非使用场景）反射式选浅深主题
- `letter-spacing` 地板 −0.04em
- 幽灵卡片（1px border + 宽柔阴影双声明）；圆角 12–16px 上限；硬偏移阴影 `4px 4px 0`
- `repeating-linear-gradient` 条纹背景；草稿风 SVG / `feTurbulence`
- measure 65–75ch；display ≤ 6rem；同组/异组间距律
- 浏览器原生面（selection / caret / scrollbar / 焦点环 / 下划线偏移 / 表格数字字形）必须上色
- 文案用产品语言、brief 全覆盖

**anti-ai-slop（OpenDesign）**

- Tailwind indigo 裸 hex 清单（`#6366f1` / `#4f46e5` / `#4338ca` / `#3730a3` / `#8b5cf6` / `#7c3aed` / `#a855f7`）
- 随交付的 `.ph-img` 占位类（禁外链占位图 CDN）
- `:root` 之外裸 hex ≤ 12；`var(--accent)` 每屏 ≤ 2 处；section 需 `data-od-id`

**slop-checklist（stylekit）**

- 用滥字体清单（含 `Geist`、`Plus Jakarta Sans`）
- 「关掉动效后页面依然必须成立」
- bounce / elastic 缓动曲线禁令

**critique（评审红线，最大增量：别家几乎不覆盖 UX 认知维度）**

- Visual Noise Floor（1 主 + 2–3 次 + 其余弱化）
- 每个元素都要挣得它的像素
- Wall of Options（单决策点 ≤ 4 选项）
- Memory Bridge、Hidden Navigation、Jargon Barrier、Inconsistent Pattern、Multi-Task Demand、Context Switch
- 仅靠颜色传达含义；焦点/键盘可达；alt 与表单标签；44×44pt；读屏播报
- 静默失败 / 欺骗性可用；空状态引导；刷新丢数据
- 边界输入矩阵（0 项 / 1000 项 / 超长文本 / emoji / 特殊字符 / RTL / Excel 粘贴）
- 虚构受众画像；未验证即宣称结果

---

## 如何加灵魂而不破规则

禁项清单只负责「不扣分」，加分靠这四条。**配方 = 80% 成熟模式 + 20% 独特选择**：80% 用被验证过的成熟结构（导航、栅格、状态、无障碍），把 20% 的预算全部押在少数几处，而不是把每处都做得「有点不一样」。

1. **一个大胆视觉决策**：全页只允许一处越界——一个反常的字号跳变、一条不对称切分、一个非标准网格。它必须服务内容（指代真实的数量、时间、产品形态），不能是纯装饰。
2. **有产品味的微文案**：按钮、空态、错误、加载说的话，必须是「做过这产品的人才会说的话」，而不是通用 SaaS 腔。禁止 Elevate / Seamless / Unleash 这类填充动词。
3. **一个记得住的微交互**：只做一个，带明确理由（反馈、层级或状态变化），有 `prefers-reduced-motion` 降级，且不用弹跳缓动。
4. **一个只有做过这产品的人才会放的细节**：真实规格、真实单位、真实工序名、真实地理或时间锚点——这类细节无法被模板生成，是「人味」密度最高的地方。

**判据**：把某张截图给一个外人看，**他能否认出这是哪个产品**？认不出 → 视觉决策没落地，回炉；认得出但觉得眼熟 → 那 20% 被模板吃掉了。

---

## 附录：来源条目数对照

| 来源 | 提取条目数 | 明细 |
| --- | --- | --- |
| hallmark/slop-test | 59（题述 60） | P0 21 + P1 23 + P2 15 |
| taste-skill | 93（118 行中的条目行） | 独家机制 11 + 字体配色间距 32 + CSS/组件 AI Tells 16 + 内容文案 12 + 装饰元素 10 + 动效性能 9 + 改版 3 |
| impeccable（四文件合并） | 71 | craft-floor 33 + anti-ai-slop 14 + slop-checklist 3 + critique 21 |
| **合计原始** | **223** | — |
| **合并后** | **159** | P0 105 + P1 38 + P2 16（另含 2 条跨源冲突记录，已内联在条目里） |
| **去重率** | **≈ 28.7%** | (223 − 159) / 223 |

跨源合并的主要重复族（每组只保留一条，出处并列）：AI 紫/靛蓝与紫→蓝渐变、渐变文字、Inter/Roboto 当 display、三列等宽图标卡、卡片套卡片、单侧粗色条、emoji 当图标、`transition: all`、`h-screen` / `100vh`、hero 全屏居中、eyebrow 标签、编造指标、玻璃态滥用、嵌套卡片、对比度阈值、状态不齐、reduced-motion、动画动 `width/height`、圆角体系、行宽 measure、溢出、外链占位图、假截图/假 UI 外壳、装饰无动机、多余元数据。
