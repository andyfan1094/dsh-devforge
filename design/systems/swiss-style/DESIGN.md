---
name: 瑞士国际风格（Swiss International）
description: 源于瑞士的理性主义设计风格，强调网格系统、无衬线字体、清晰层次和客观信息传达，是现代平面设计的基石。
triggers:
  - 瑞士国际风格
  - Swiss International
  - 瑞士
  - 国际主义
  - 网格
  - Helvetica
  - 理性
  - 排版
od:
  category: style-modern
---

# 瑞士国际风格（Swiss International）

## 一、一句话定位

源于瑞士的理性主义设计风格，强调网格系统、无衬线字体、清晰层次和客观信息传达，是现代平面设计的基石。

- 英文名：**Swiss International**
- 风格类型：`visual`（视觉风格：靠色彩/材质/字体塑造）
- 关键词：瑞士、国际主义、网格、Helvetica、理性、排版、极简、modern、contemporary、sleek
- 适用场景提示：瑞士国际主义：网格、无衬线、左对齐、极端字号对比
- 源风格分类：`modern`

---

## 二、设计哲学（源 `philosophy` 字段）

Swiss International Style（瑞士国际风格）是20世纪50年代在瑞士发展起来的设计运动，强调清晰、客观、理性的视觉传达。

核心理念：
- 网格系统：严格的数学网格控制布局
- 无衬线字体：Helvetica 等清晰易读的字体
- 负空间：大量留白增强可读性
- 客观传达：设计服务于信息，而非装饰

> ⚠️ 已剔除 5 句跨风格重复的通用模板句（判定标准：在 ≥10 套风格里逐字重复）。被剔除的是「视觉一致性：所有组件必须遵循统一的视觉语言，从色彩到…」「层次分明：通过颜色深浅、字号大小、留白空间建立清晰的…」「交互反馈：每个可交互元素都必须有明确的 hover、…」「响应式适配：设计必须在移动端、平板、桌面端上保持一致…」「无障碍性：确保色彩对比度符合 WCAG 2.1 AA…」这类与具体风格无关的套话，保留的是该风格独有的美学主张。

---

## 三、色彩逻辑

| 项 | 值 |
|---|---|
| 主色 primary | `#000000` |
| 辅色 secondary | `#ffffff` |
| 强调色 accent | `#ff0000`、`#0057b8`、`#ffcc00`、`#6c3b00` |

配套的 Tailwind 类名配方（来自 `swiss-style-tokens.ts`）：

- 底色 主 / 次：bg-white · bg-black
- 底色 强调：bg-[#ff0000]
- 文字 主 / 次 / 弱：text-black · text-white · text-gray-600

**用色纪律**（源 `doList` 中与颜色相关的条目）：

- 使用黑白为主的配色
- Rational Restraint: only color and border-color change on interaction — zero translate, scale, or shadow added. The grid must not be disturbed
- Guide Line Extension: left border changes from gray to red `hover:border-[#ff0000]` and background shifts to `hover:bg-[#f0f0f0]` — the structure becomes activated, not decorated
- Hierarchy Focus: category label turns red `group-hover:text-[#ff0000]` on hover — the taxonomic label is highlighted, reinforcing information hierarchy

---

## 四、字体性格

- 标题：font-sans font-bold tracking-tight
- 正文：font-sans
- 等宽：font-mono

字号阶梯：

| 项 | 值 |
|---|---|
| `hero` | `text-5xl md:text-7xl lg:text-9xl` |
| `h1` | `text-4xl md:text-6xl` |
| `h2` | `text-2xl md:text-4xl` |
| `h3` | `text-lg md:text-xl` |
| `body` | `text-sm md:text-base` |
| `small` | `text-xs md:text-sm` |

---

## 五、圆角与间距哲学

| 项 | 值 |
|---|---|
| 圆角 | `rounded-none` |
| 边框 | `border border-solid border-black` |

| 项 | 值 |
|---|---|
| 区块间距 section | `py-12 md:py-24 lg:py-32` |
| 容器内边距 container | `px-4 md:px-8 lg:px-16` |
| 卡片内边距 card | `p-4 md:p-6` |
| 间距 gap · sm | `gap-2 md:gap-4` |
| 间距 gap · md | `gap-4 md:gap-8` |
| 间距 gap · lg | `gap-8 md:gap-12` |

---

## 六、交互、阴影与状态

| 项 | 值 |
|---|---|
| 过渡 | `transition-opacity duration-150` |
| 按下态 | `active:opacity-70` |
| 阴影 sm / md / lg / none | `shadow-none` · `shadow-none` · `shadow-none` · `shadow-none` |
| 阴影 hover / focus | `hover:shadow-none` · `focus:shadow-none` |
| 彩色阴影 | — |

---

## 七、禁忌（源 `forbidden` 字段，含**为什么**禁）

> 这一节是 stylekit 最有价值的资产之一：它不仅列出禁用项，还给出了理由。理由直接来自源数据，
> 未做改写，便于直接喂给模型做生成后自检。

| 项 | 值 |
|---|---|
| `font-serif` | Swiss Style uses Helvetica-style sans-serif only (font-sans) |
| `rounded-xl` | Swiss Style uses sharp geometric corners for grid alignment (rounded-none) |
| `shadow-lg` | Swiss Style avoids decorative shadows; focus on typography and grid |
| `bg-gradient-to-r` | Swiss Style uses flat solid colors only, no gradients |
| 其他禁用类名 | `font-mono`、`rounded-lg`、`rounded-2xl`、`rounded-3xl`、`rounded-full`、`shadow-sm`、`shadow`、`shadow-md`、`shadow-xl`、`shadow-2xl`、`bg-gradient-to-l`、`bg-gradient-to-b`、`bg-gradient-to-t`、`italic`、`border-dashed`、`border-dotted` |
| 其他禁用正则 | `^font-(?:serif\|mono)$`、`^rounded-(?!none)`、`^shadow-(?!none)`、`^bg-gradient-`、`^italic$` |

另外，源 `dontList` 以自然语言补充：

- 禁止使用装饰性元素
- 禁止使用衬线字体作为正文
- 禁止过度装饰或渐变
- 禁止打破网格系统
- 禁止使用任何 `translate`、`scale` 或 `shadow` 变化（Rational Restraint — 网格不可被扰动）
- 禁止 hover 时引入新颜色以外的装饰（只允许颜色和边框色变化，不添加阴影或变形）
- 禁止使用 `duration-300` 或更长（Swiss Style 精准高效，`duration-150 ease-out` 是上限）
- 禁止按钮不带箭头图标（Swiss Style 按钮必须包含方向性，`→` 是排版的一部分）

---

## 八、一致性清洗记录

源仓库的 `globalCss` 里存在与本风格 `aiRules` 直接冲突的模板残留，已按**以 aiRules 为准**剔除下列 5 项（原始素材保留在仓库中未改动）：

| 项 | 值 |
|---|---|
| `@keyframes swiss-style-fade-in` | transform 位移/缩放（aiRules 禁位移缩放） |
| `.swiss-style-card::before` | 渐变（aiRules 禁渐变） |
| `.swiss-style-gradient` | 渐变（aiRules 禁渐变） |
| `.swiss-style-gradient-text` | 渐变（aiRules 禁渐变） |
| `.swiss-style-animate-in 的 animation 声明` | 引用了已删除的 @keyframes swiss-style-fade-in |

### 禁令推导依据

从本套的 `forbidden` 与 `aiRules` 推导出 **3 条整类禁令**（`gradient`、`shadow`、`transform`），依据如下：

| 项 | 值 |
|---|---|
| `gradient` | forbidden.patterns 含整类渐变禁令 `^bg-gradient-` |
| `shadow` | 直接禁令句：「禁止使用任何 `translate`、`scale` 或 `shadow` 变化（Rational Restraint — 网格不可被扰动）」 |
| `transform` | 直接禁令句：「禁止使用任何 `translate`、`scale` 或 `shadow` 变化（Rational Restraint — 网格不可被扰动）」 |

---

## 九、AI 硬规则（源 `aiRules` 全文，生成时应逐条遵守）

```text
你是一个 Swiss International Style 设计风格的前端开发专家。生成的所有代码必须严格遵守以下约束：

## 绝对禁止

- 使用装饰性元素
- 使用衬线字体
- 过度装饰或渐变效果
- 打破网格系统

## 必须遵守

- 12列网格系统 grid-cols-12
- 无衬线字体 font-sans
- 大量留白 p-8, gap-8
- 黑白为主 bg-black, text-white, bg-white, text-black
- 红色强调 bg-red-600, text-red-600
- 大写标签 uppercase tracking-[0.2em]
- 左对齐文本

## 配色

仅使用：
- 黑色: #000000
- 白色: #ffffff
- 红色: #ff0000 (强调色)
- 蓝色: #0057b8 (可选强调)

## 排版

- 标题：超大字号、粗体、紧凑行高
- 标签：小号、大写、宽字距
- 正文：适中字号、充足行高

## Animation & Interaction Rules

- Rational Restraint: Only color and border-color change on hover — zero `translate`, `scale`, or new `shadow`. The grid is a rational system; its geometry must not be disturbed by interaction. Forbidden: `hover:-translate-y-*`, `hover:scale-*`, `hover:shadow-*`.
- Guide Line Extension: The left border activates from `border-[#cccccc]` to `hover:border-[#ff0000]` and background shifts to `hover:bg-[#f0f0f0]` — the structural grid line becomes a red typographic accent, making the module feel "selected" on the layout.
- Hierarchy Focus: The category/label element turns `group-hover:text-[#ff0000] transition-colors duration-150 ease-out` — the taxonomic hierarchy is highlighted, reinforcing Swiss style's belief that information structure is the highest design value.
- Clean Cut Transitions: Use `duration-150 ease-out` for color changes. Button arrow icon uses `group-hover:translate-x-2 transition-transform duration-150 ease-out` — the arrow is the only permitted movement, indicating directionality as a typographic element.
```

---

## 十、必须包含项与示例提示词

- **button** 必须含：`rounded-none` · `font-sans font-bold` · `transition-opacity duration-150`
- **card** 必须含：`rounded-none` · `border border-black` · `bg-white`
- **input** 必须含：`rounded-none` · `border border-black` · `font-sans` · `focus:outline-none`

示例提示词（源 `examplePrompts`）：

1. **设计工作室官网**（Design Studio Website）—— 极简理性的设计工作室网站
   ```text
   用 Swiss International Style 创建一个设计工作室官网，要求：
1. 布局：严格的12列网格
2. 字体：无衬线字体，大标题
3. 配色：黑白为主，红色点缀
4. 大量留白
5. 简洁的几何装饰
   ```
2. **SaaS 着陆页**（SaaS Landing Page）—— 生成 瑞士国际风格风格的 SaaS 产品着陆页
   ```text
   Create a SaaS landing page using Swiss International style with hero section, feature grid, testimonials, pricing table, and footer.
   ```
3. **作品集展示**（Portfolio Showcase）—— 生成 瑞士国际风格风格的作品集页面
   ```text
   Create a portfolio showcase page using Swiss International style with project grid, about section, contact form, and consistent visual language.
   ```

---

## 十一、token 配方总表（源 `swiss-style-tokens.ts`，Tailwind 类名字符串）

> 这些是**类名配方**而非 CSS 变量——stylekit 的 token 层就是"每个视觉位该用哪些 Tailwind 类"。
> 同目录 `tokens.css` 是该风格 `globalCss` 里的 CSS 变量与工具类（已做一致性清洗）；
> `design-tokens.json` 是扁平 key-value 形式，便于按需注入。

| 项 | 值 |
|---|---|
| 边框宽度 / 颜色 / 圆角 / 风格 | border · border-black · rounded-none · border-solid |
| 阴影 sm / md / lg / none | shadow-none · shadow-none · shadow-none · shadow-none |
| 阴影 hover / focus | hover:shadow-none · focus:shadow-none |
| 过渡 / 按下态 | transition-opacity duration-150 · active:opacity-70 |
| 标题字体 / 正文字体 / 等宽字体 | font-sans font-bold tracking-tight · font-sans · font-mono |
| 字号 · hero | text-5xl md:text-7xl lg:text-9xl |
| 字号 · h1 | text-4xl md:text-6xl |
| 字号 · h2 | text-2xl md:text-4xl |
| 字号 · h3 | text-lg md:text-xl |
| 字号 · body | text-sm md:text-base |
| 字号 · small | text-xs md:text-sm |
| 区块间距 / 容器内边距 / 卡片内边距 | py-12 md:py-24 lg:py-32 · px-4 md:px-8 lg:px-16 · p-4 md:p-6 |
| 间距 · sm | gap-2 md:gap-4 |
| 间距 · md | gap-4 md:gap-8 |
| 间距 · lg | gap-8 md:gap-12 |
| 底色 主 / 次 | bg-white · bg-black |
| 底色 · 强调 | bg-[#ff0000] |
| 文字 主 / 次 / 弱 | text-black · text-white · text-gray-600 |
| 按钮 · primary | bg-black text-white |
| 按钮 · secondary | bg-white text-black border border-black |
| 按钮 · danger | bg-[#ff0000] text-white |
| 必须包含 · button | rounded-none · font-sans font-bold · transition-opacity duration-150 |
| 必须包含 · card | rounded-none · border border-black · bg-white |
| 必须包含 · input | rounded-none · border border-black · font-sans · focus:outline-none |

---

## 十二、来源与许可

- 素材仓库：AnxForever/**stylekit**（MIT License, © 2026 AnxForever）
- 源文件：`lib/styles/swiss-style.ts`、`lib/styles/swiss-style-tokens.ts`
- 转换脚本：`D:\项目\scripts\convert-stylekit-systems.mjs`（一次性、可复跑）
- 局部改动：按 `aiRules` 剔除 `globalCss` 中的矛盾项（见第八节），其余内容保持源样。
- 注意：源仓库的 `components` 字段含可复制的 JSX 组件代码模板，本轮**未纳入**设计系统格式（本项目格式无组件槽位）。
