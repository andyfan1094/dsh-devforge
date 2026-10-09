---
name: Linear 风格（Linear Style）
description: 受 Linear 应用启发的极简暗色设计风格。精确的排版、克制的动效、开发者审美的极致表达。深色背景配合微妙的渐变和精细的边框。
triggers:
  - Linear 风格
  - Linear Style
  - Linear
  - 极简
  - 暗色
  - 开发者
  - 精确
  - 工具
od:
  category: style-minimal
---

# Linear 风格（Linear Style）

## 一、一句话定位

受 Linear 应用启发的极简暗色设计风格。精确的排版、克制的动效、开发者审美的极致表达。深色背景配合微妙的渐变和精细的边框。

- 英文名：**Linear Style**
- 风格类型：`visual`（视觉风格：靠色彩/材质/字体塑造）
- 关键词：Linear、极简、暗色、开发者、精确、工具、minimal、clean、simple、留白
- 适用场景提示：Linear 式深色 SaaS：近黑底 + 紫罗兰强调
- 源风格分类：`minimal`

---

## 二、设计哲学（源 `philosophy` 字段）

Linear Style 源自备受开发者推崇的项目管理工具 Linear。其设计理念是"每一个像素都有目的"。

核心理念：
- 深色优先：几乎纯黑的背景（#0a0a0b），让内容成为唯一焦点
- 精确排版：Inter 字体，letter-spacing 微调，恰到好处的行高
- 克制渐变：紫色渐变仅用于主要 CTA 和品牌元素
- 微妙边框：1px 的半透明白色边框划分层级
- 无多余装饰：没有阴影、没有圆角过大的元素、没有花哨的效果

> ⚠️ 已剔除 5 句跨风格重复的通用模板句（判定标准：在 ≥10 套风格里逐字重复）。被剔除的是「视觉一致性：所有组件必须遵循统一的视觉语言，从色彩到…」「层次分明：通过颜色深浅、字号大小、留白空间建立清晰的…」「交互反馈：每个可交互元素都必须有明确的 hover、…」「响应式适配：设计必须在移动端、平板、桌面端上保持一致…」「无障碍性：确保色彩对比度符合 WCAG 2.1 AA…」这类与具体风格无关的套话，保留的是该风格独有的美学主张。

---

## 三、色彩逻辑

| 项 | 值 |
|---|---|
| 主色 primary | `#5e6ad2` |
| 辅色 secondary | `#0a0a0b` |
| 强调色 accent | `#f2c94c`、`#27ae60`、`#eb5757`、`#2d9cdb` |

配套的 Tailwind 类名配方（来自 `linear-style-tokens.ts`）：

- 底色 主 / 次：bg-[#0a0a0b] · bg-white/[0.03]
- 底色 强调：bg-[#5e6ad2]
- 文字 主 / 次 / 弱：text-white · text-zinc-400 · text-zinc-500

**用色纪律**（源 `doList` 中与颜色相关的条目）：

- 背景使用近黑 bg-[#0a0a0b] 或 bg-zinc-950
- 文字使用 text-white 和 text-zinc-400 双层级
- 按钮渐变 bg-gradient-to-r from-[#5e6ad2] to-[#8b5cf6]
- 交互使用 opacity 变化而非颜色变化 hover:text-white

---

## 四、字体性格

- 标题：font-sans font-semibold tracking-tight
- 正文：font-sans text-sm
- 等宽：font-mono

字号阶梯：

| 项 | 值 |
|---|---|
| `hero` | `text-4xl font-semibold tracking-tight` |
| `h1` | `text-2xl font-semibold tracking-tight` |
| `h2` | `text-xl font-semibold tracking-tight` |
| `h3` | `text-base font-medium tracking-tight` |
| `body` | `text-sm` |
| `small` | `text-xs` |

---

## 五、圆角与间距哲学

| 项 | 值 |
|---|---|
| 圆角 | `rounded-lg` |
| 边框 | `border border-solid border-white/10` |

| 项 | 值 |
|---|---|
| 区块间距 section | `py-12 md:py-20` |
| 容器内边距 container | `px-4 md:px-8` |
| 卡片内边距 card | `p-5` |
| 间距 gap · sm | `gap-1.5` |
| 间距 gap · md | `gap-3` |
| 间距 gap · lg | `gap-5` |

---

## 六、交互、阴影与状态

| 项 | 值 |
|---|---|
| 过渡 | `transition-all duration-150` |
| 按下态 | `active:opacity-80` |
| 阴影 sm / md / lg / none | `shadow-none` · `shadow-none` · `shadow-none` · `shadow-none` |
| 阴影 hover / focus | `shadow-none` · `shadow-none` |
| 彩色阴影 | — |

---

## 七、禁忌（源 `forbidden` 字段，含**为什么**禁）

> 这一节是 stylekit 最有价值的资产之一：它不仅列出禁用项，还给出了理由。理由直接来自源数据，
> 未做改写，便于直接喂给模型做生成后自检。

| 项 | 值 |
|---|---|
| `bg-white` | Linear Style uses dark backgrounds only (#0a0a0b) |
| `rounded-2xl` | Linear Style uses rounded-lg max for restrained aesthetics |
| `shadow-sm` | Linear Style avoids shadows entirely; uses borders for hierarchy |
| `font-serif` | Linear Style uses Inter (sans-serif) exclusively |
| `font-mono` | Linear Style uses Inter (sans-serif) exclusively for UI text |
| 其他禁用类名 | `bg-gray-50`、`bg-gray-100`、`bg-slate-50`、`rounded-3xl`、`rounded-full`、`shadow-md`、`shadow-lg`、`shadow-xl`、`shadow-purple-500/20`、`shadow-indigo-500/20`、`text-pink-400`、`text-green-400`、`text-orange-400` |
| 其他禁用正则 | `^bg-(?:white\|gray-(?:50\|100)\|slate-50)$`、`^rounded-(?:2xl\|3xl\|full)$`、`^shadow-(?:sm\|md\|lg\|xl\|2xl)$`、`^shadow-.*\/\d+$`、`^font-(?:serif\|mono)$` |

另外，源 `dontList` 以自然语言补充：

- 禁止使用白色/浅色背景（暗色是根基）
- 禁止大圆角 rounded-2xl rounded-3xl rounded-full
- 禁止使用彩色阴影或大面积阴影
- 禁止使用多种字体（只用 Inter）
- 禁止使用饱和度过高的颜色（除品牌紫色外）
- 禁止装饰性元素（渐变背景、blob、噪点纹理等）

---

## 八、一致性清洗记录

源仓库的 `globalCss` 里存在与本风格 `aiRules` 直接冲突的模板残留，已按**以 aiRules 为准**剔除下列 2 项（原始素材保留在仓库中未改动）：

| 项 | 值 |
|---|---|
| `@keyframes linear-style-fade-in` | transform 位移/缩放（aiRules 禁位移缩放） |
| `.linear-style-animate-in 的 animation 声明` | 引用了已删除的 @keyframes linear-style-fade-in |

### 禁令推导依据

从本套的 `forbidden` 与 `aiRules` 推导出 **1 条整类禁令**（`transform`），依据如下：

| 项 | 值 |
|---|---|
| `transform` | 直接禁令句：「- No scale transforms on hover」 |

---

## 九、AI 硬规则（源 `aiRules` 全文，生成时应逐条遵守）

```text
You are a Linear Style design expert. This style emulates the design language of the Linear project management tool — precise, restrained, and developer-focused.

## Absolute Rules
- Background: #0a0a0b or bg-zinc-950 — always dark
- Text: text-white for primary, text-zinc-400 for secondary, text-zinc-500/600 for tertiary
- Borders: border border-white/10 — always 1px, always semi-transparent
- Brand color: #5e6ad2 (indigo-purple) — used sparingly for CTAs and accents
- Font: Inter only, tracking-tight, text-sm as default body size
- Border-radius: rounded-lg max, rounded-md for small elements

## Forbidden
- White or light backgrounds
- Large border-radius (rounded-2xl+)
- Colored shadows
- Multiple fonts
- High-saturation colors (except brand purple)
- Decorative elements (gradients as decoration, blobs, patterns)

## Interaction Pattern
- Use opacity for hover states: hover:opacity-90 or hover:bg-white/[0.06]
- Transitions must be fast: duration-150
- No scale transforms on hover
- Focus: focus:border-[#5e6ad2]/50

## Typography Scale
- Hero: text-4xl font-semibold tracking-tight
- Section: text-2xl font-semibold tracking-tight
- Body: text-sm text-zinc-400
- Label: text-xs text-zinc-500 font-medium uppercase tracking-wider
```

---

## 十、必须包含项与示例提示词

- **button** 必须含：`rounded-lg` · `font-medium` · `text-sm` · `transition-opacity duration-150`
- **card** 必须含：`rounded-lg` · `border border-white/10` · `bg-white/[0.03]`
- **input** 必须含：`rounded-lg` · `border border-white/10` · `bg-white/[0.03]` · `text-white text-sm` · `focus:outline-none`

示例提示词（源 `examplePrompts`）：

1. **项目管理 Dashboard**（Project Management Dashboard）—— Linear 风格的项目看板，包含 issue 列表和状态管理
   ```text
   Create a project management dashboard in Linear style. Include a sidebar with workspace navigation, a main area with issue list (showing status icons, issue IDs, titles, labels, and assignees), and a top bar with filters. Use #0a0a0b background, border-white/10 borders, and #5e6ad2 for the primary action button.
   ```
2. **SaaS 着陆页**（SaaS Landing Page）—— 生成 Linear 风格风格的 SaaS 产品着陆页
   ```text
   Create a SaaS landing page using Linear Style style with hero section, feature grid, testimonials, pricing table, and footer.
   ```
3. **作品集展示**（Portfolio Showcase）—— 生成 Linear 风格风格的作品集页面
   ```text
   Create a portfolio showcase page using Linear Style style with project grid, about section, contact form, and consistent visual language.
   ```

---

## 十一、token 配方总表（源 `linear-style-tokens.ts`，Tailwind 类名字符串）

> 这些是**类名配方**而非 CSS 变量——stylekit 的 token 层就是"每个视觉位该用哪些 Tailwind 类"。
> 同目录 `tokens.css` 是该风格 `globalCss` 里的 CSS 变量与工具类（已做一致性清洗）；
> `design-tokens.json` 是扁平 key-value 形式，便于按需注入。

| 项 | 值 |
|---|---|
| 边框宽度 / 颜色 / 圆角 / 风格 | border · border-white/10 · rounded-lg · border-solid |
| 阴影 sm / md / lg / none | shadow-none · shadow-none · shadow-none · shadow-none |
| 阴影 hover / focus | shadow-none · shadow-none |
| 过渡 / 按下态 | transition-all duration-150 · active:opacity-80 |
| 标题字体 / 正文字体 / 等宽字体 | font-sans font-semibold tracking-tight · font-sans text-sm · font-mono |
| 字号 · hero | text-4xl font-semibold tracking-tight |
| 字号 · h1 | text-2xl font-semibold tracking-tight |
| 字号 · h2 | text-xl font-semibold tracking-tight |
| 字号 · h3 | text-base font-medium tracking-tight |
| 字号 · body | text-sm |
| 字号 · small | text-xs |
| 区块间距 / 容器内边距 / 卡片内边距 | py-12 md:py-20 · px-4 md:px-8 · p-5 |
| 间距 · sm | gap-1.5 |
| 间距 · md | gap-3 |
| 间距 · lg | gap-5 |
| 底色 主 / 次 | bg-[#0a0a0b] · bg-white/[0.03] |
| 底色 · 强调 | bg-[#5e6ad2] |
| 文字 主 / 次 / 弱 | text-white · text-zinc-400 · text-zinc-500 |
| 按钮 · primary | bg-gradient-to-r from-[#5e6ad2] to-[#8b5cf6] text-white |
| 按钮 · secondary | bg-white/[0.03] text-white border border-white/10 |
| 按钮 · danger | bg-[#eb5757] text-white |
| 必须包含 · button | rounded-lg · font-medium · text-sm · transition-opacity duration-150 |
| 必须包含 · card | rounded-lg · border border-white/10 · bg-white/[0.03] |
| 必须包含 · input | rounded-lg · border border-white/10 · bg-white/[0.03] · text-white text-sm · focus:outline-none |

---

## 十二、来源与许可

- 素材仓库：AnxForever/**stylekit**（MIT License, © 2026 AnxForever）
- 源文件：`lib/styles/linear-style.ts`、`lib/styles/linear-style-tokens.ts`
- 转换脚本：`D:\项目\scripts\convert-stylekit-systems.mjs`（一次性、可复跑）
- 局部改动：按 `aiRules` 剔除 `globalCss` 中的矛盾项（见第八节），其余内容保持源样。
- 注意：源仓库的 `components` 字段含可复制的 JSX 组件代码模板，本轮**未纳入**设计系统格式（本项目格式无组件槽位）。
