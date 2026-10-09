---
name: 编辑杂志风（Editorial）
description: 优雅的杂志排版风格，衬线标题、无衬线正文、精致的留白和网格系统。灵感来自高端时尚杂志和报纸排版。暖米色背景、柔和黑文字、精细的透明度层次和动画下划线交互。
triggers:
  - 编辑杂志风
  - Editorial
  - 杂志排版
  - 衬线字体
  - 优雅留白
  - 网格系统
  - 极简主义
  - 作品集
od:
  category: style-minimal
---

# 编辑杂志风（Editorial）

## 一、一句话定位

优雅的杂志排版风格，衬线标题、无衬线正文、精致的留白和网格系统。灵感来自高端时尚杂志和报纸排版。暖米色背景、柔和黑文字、精细的透明度层次和动画下划线交互。

- 英文名：**Editorial**
- 风格类型：`visual`（视觉风格：靠色彩/材质/字体塑造）
- 关键词：杂志排版、衬线字体、优雅留白、网格系统、极简主义、作品集、单色、minimal、clean、simple
- 适用场景提示：杂志编辑：衬线标题 + 无衬线正文的经典出版物层级
- 源风格分类：`minimal`

---

## 二、设计哲学（源 `philosophy` 字段）

Editorial（编辑杂志风）设计风格源于传统印刷媒体的排版美学，特别是高端时尚杂志和报纸的设计语言。这种风格强调内容的层次结构、精致的字体搭配和大量留白。

核心理念：
- 内容为王：设计服务于内容，不喧宾夺主。UI 是低声细语，不是大声喊叫
- 字体层次：衬线标题与无衬线正文形成对比，标签使用 uppercase tracking 增加呼吸感
- 留白即美：适当的负空间让内容呼吸，section 间距 py-24 md:py-40 起步
- 单色克制：仅使用 #1C1C1C 配合不同透明度（/60 /40 /10）构建视觉层次，拒绝彩色装饰
- 微妙动效：hover-underline 动画、clip-path reveal、group-hover:italic 等克制而精致的交互

---

## 三、色彩逻辑

| 项 | 值 |
|---|---|
| 主色 primary | `#1C1C1C` |
| 辅色 secondary | `#F9F8F6` |
| 强调色 accent | `#1C1C1C`、`#6b7280`、`#1c1c1c`、`#816d70` |

配套的 Tailwind 类名配方（来自 `editorial-tokens.ts`）：

- 底色 主 / 次：bg-background · bg-foreground
- 底色 强调：bg-[#e63946]
- 文字 主 / 次 / 弱：text-foreground · text-background · text-muted

**用色纪律**（源 `doList` 中与颜色相关的条目）：

- 背景使用暖米色 bg-[#F9F8F6]，文字使用柔和黑 text-[#1C1C1C]
- 使用透明度层次构建灰度：text-[#1C1C1C]/60（次要）、/40（辅助）、/10（边框）
- 标签样式使用 font-sans text-xs tracking-[0.2em] uppercase
- 标题使用 tracking-tighter 紧凑字间距，hero 标题 text-6xl md:text-8xl 起步
- 斜体用于副标题或装饰性文字：italic text-[#1C1C1C]/60

---

## 四、字体性格

- 标题：font-serif tracking-tight
- 正文：font-sans
- 等宽：font-mono

字号阶梯：

| 项 | 值 |
|---|---|
| `hero` | `text-4xl md:text-6xl lg:text-7xl` |
| `h1` | `text-3xl md:text-5xl` |
| `h2` | `text-2xl md:text-3xl` |
| `h3` | `text-xl md:text-2xl` |
| `body` | `text-sm md:text-base` |
| `small` | `text-xs` |

---

## 五、圆角与间距哲学

| 项 | 值 |
|---|---|
| 圆角 | `rounded-none` |
| 边框 | `border border-solid border-border` |

| 项 | 值 |
|---|---|
| 区块间距 section | `py-16 md:py-24 lg:py-32` |
| 容器内边距 container | `px-6 md:px-12` |
| 卡片内边距 card | `p-6` |
| 间距 gap · sm | `gap-4` |
| 间距 gap · md | `gap-6 md:gap-8` |
| 间距 gap · lg | `gap-8 md:gap-12` |

---

## 六、交互、阴影与状态

| 项 | 值 |
|---|---|
| 过渡 | `transition-colors duration-200` |
| 按下态 | `active:scale-95` |
| 阴影 sm / md / lg / none | `shadow-none` · `shadow-none` · `shadow-none` · `shadow-none` |
| 阴影 hover / focus | `shadow-none` · `shadow-none` |
| 彩色阴影 | — |

---

## 七、禁忌（源 `forbidden` 字段，含**为什么**禁）

> 这一节是 stylekit 最有价值的资产之一：它不仅列出禁用项，还给出了理由。理由直接来自源数据，
> 未做改写，便于直接喂给模型做生成后自检。

| 项 | 值 |
|---|---|
| `rounded-lg` | Editorial uses sharp corners only (rounded-none) |
| `shadow-lg` | Editorial avoids shadows completely |
| `border-4` | Editorial uses thin borders only (border) |
| `bg-gradient-to-r` | Editorial uses solid colors, no gradients |
| `font-black` | Editorial headings use font-serif with normal weight, not bold |
| 其他禁用类名 | `rounded-sm`、`rounded`、`rounded-md`、`rounded-xl`、`rounded-2xl`、`rounded-3xl`、`rounded-full`、`shadow-sm`、`shadow`、`shadow-md`、`shadow-xl`、`shadow-2xl`、`border-2`、`border-8`、`bg-blue-500`、`bg-green-500`、`bg-yellow-500`、`bg-purple-500`、`bg-pink-500`、`bg-gradient-to-l`、`bg-gradient-to-t`、`bg-gradient-to-b`、`font-extrabold` |
| 其他禁用正则 | `^rounded-(?!none)`、`^shadow-(?!none)`、`^border-[248]`、`^bg-gradient-` |

另外，源 `dontList` 以自然语言补充：

- 禁止使用彩色强调色（红、蓝、绿等），保持纯单色体系
- 禁止使用粗边框或阴影（shadow-*）
- 禁止使用 #0a0a0a 纯黑或 #fafafa 冷白作为主色
- 禁止标题使用无衬线字体
- 禁止过小的行高，正文至少 leading-relaxed
- 禁止元素堆积，保持呼吸感
- 禁止使用渐变、背景图案或装饰性几何元素
- 禁止使用大圆角 rounded-xl 以上

---

## 八、一致性清洗记录

源仓库的 `globalCss` 里存在与本风格 `aiRules` 直接冲突的模板残留，已按**以 aiRules 为准**剔除下列 2 项（原始素材保留在仓库中未改动）：

| 项 | 值 |
|---|---|
| `.editorial-gradient` | 渐变（aiRules 禁渐变） |
| `.editorial-gradient-text` | 渐变（aiRules 禁渐变） |

### 禁令推导依据

从本套的 `forbidden` 与 `aiRules` 推导出 **2 条整类禁令**（`gradient`、`shadow`），依据如下：

| 项 | 值 |
|---|---|
| `gradient` | forbidden.patterns 含整类渐变禁令 `^bg-gradient-` |
| `shadow` | 直接禁令句：「禁止使用粗边框或阴影（shadow-*）」 |

---

## 九、AI 硬规则（源 `aiRules` 全文，生成时应逐条遵守）

```text
You are an Editorial design style frontend development expert. All generated code must strictly follow these constraints:

## Core Palette

- Background: #F9F8F6 (warm cream, NOT pure white or #fafafa)
- Foreground: #1C1C1C (soft black, NOT #000 or #0a0a0a)
- Opacity hierarchy: text-[#1C1C1C]/60 (secondary), /40 (tertiary), /10 (borders/dividers)
- NO colored accents. This style is purely monochromatic.

## Typography

- Headings: font-serif, tracking-tighter, weight 400 (never bold)
- Hero titles: text-6xl md:text-8xl lg:text-[9rem] leading-[0.9]
- Labels: font-sans text-xs tracking-[0.2em] uppercase text-[#1C1C1C]/40
- Body: font-sans text-sm or text-base leading-relaxed text-[#1C1C1C]/80
- Italic for decorative subtitles: italic text-[#1C1C1C]/60

## Layout

- Section spacing: py-24 md:py-40 minimum
- Container: max-w-7xl mx-auto px-6 md:px-12
- Generous gaps: gap-12 lg:gap-24
- Content width: max-w-xs or max-w-md for body text
- Use 12-column grids: grid-cols-12 with col-span-5/col-span-7 splits

## Interactions

- Links: hover-underline animation (scaleX from right-to-left on hover)
- Titles: group-hover:italic transition-all duration-500
- Images: group-hover:scale-105 transition-transform duration-1000
- Arrows: group-hover:translate-x-2 transition-transform
- Borders: border-[#1C1C1C]/10, hover:bg-[#1C1C1C]/[0.02]

## Form Fields

- Bottom-border only: border-b border-[#1C1C1C]/20
- Floating labels with peer-focus pattern
- Input text: font-serif text-xl
- Focus: focus:border-[#1C1C1C] (no outline, no shadow, no ring)

## Navigation

- Fixed: fixed top-0 z-50 bg-[#F9F8F6]/90 backdrop-blur-sm
- Logo: font-serif text-lg tracking-[0.3em] uppercase
- Links: font-sans text-xs tracking-[0.2em] uppercase text-[#1C1C1C]/60

## Absolutely Forbidden

- Colored accents (red, blue, green) - this is a monochrome style
- Box shadows (shadow-*)
- Thick borders (border-2 and above)
- Large border-radius (rounded-xl and above)
- Gradients or background patterns
- Bold font weights on headings (font-bold, font-semibold)
- Pure black #000 or #0a0a0a
- Pure white #fff or #fafafa as background
- Decorative geometric shapes or icons

## Animation & Interaction Rules

- Cinematic Image Zoom: 配图区域应使用容器裁切 + 子元素慢速放大（如 `group-hover:scale-105 duration-1000`），保持时装大片式凝视感。
- Brutal Contrast: 交互对比应果断，但仅在既有调色盘中反转（`#1C1C1C` 与 `#F9F8F6`），禁止回退到纯黑纯白。
- Text Restraint: 文字本体不位移；hover 提示优先使用细线延展、字色加深等排版型反馈。
- Layout Lines: 分隔线 hover 时可从 `/10` 加深至 `/40`，用于强调网格骨架，不添加阴影和炫技动画。
```

---

## 十、必须包含项与示例提示词

- **button** 必须含：`px-6 py-3` · `text-sm tracking-wide` · `transition-colors`
- **card** 必须含：`border border-border` · `hover:border-foreground` · `transition-colors`
- **input** 必须含：`border border-border` · `text-sm` · `focus:outline-none` · `focus:border-foreground` · `transition-colors` · `placeholder:text-muted`

示例提示词（源 `examplePrompts`）：

1. **创意作品集**（Creative Portfolio）—— 编辑杂志风格的创意设计师作品集
   ```text
   Use Editorial style to create a creative portfolio page:
1. Fixed nav: font-serif logo with tracking-[0.3em], hover-underline links
2. Hero: massive serif title (9rem+) with italic subtitle in #1C1C1C/60, clip-path image reveal
3. Featured works: numbered list (01, 02, 03) with hover image float and group-hover:italic
4. Infinite marquee ticker: services list with dot separators
5. Archive grid: masonry 2-col layout with staggered scroll reveals
6. About section: sticky portrait left, serif quote right, services/clients lists
7. Contact: floating-label inputs with bottom borders, hover-underline submit button
8. Palette: bg-[#F9F8F6], text-[#1C1C1C] with /60 /40 /10 opacity hierarchy only
   ```
2. **杂志风格博客**（Magazine Style Blog）—— 经典杂志排版的博客首页
   ```text
   Use Editorial style to create a magazine blog homepage:
1. Navigation: fixed top, bg-[#F9F8F6]/90 backdrop-blur, hover-underline links
2. Featured article: full-width grayscale image with clip-path reveal, serif title text-7xl
3. Article list: numbered editorial list with border-b border-[#1C1C1C]/10 dividers
4. Typography: font-serif headings tracking-tighter, font-sans text-xs labels with tracking-[0.2em] uppercase
5. Footer: minimal, text-xs uppercase with dot separators
6. Colors: monochrome only, #F9F8F6 background, #1C1C1C text with opacity variants
   ```
3. **工作室介绍**（Studio About Page）—— 设计工作室的介绍页面
   ```text
   Use Editorial style to design a studio about page:
1. Layout: 12-col grid, col-span-5 sticky portrait + col-span-7 content
2. Hero quote: font-serif text-6xl with line breaks and italic decorative words
3. Body text: font-sans text-sm leading-relaxed text-[#1C1C1C]/80, max-w-xl
4. Services & clients: two-column grid with uppercase tracking labels, serif list items
5. Contact section: Say Hello heading text-8xl, floating-label form inputs
6. Interactions: IntersectionObserver scroll reveals, group-hover:italic on links
7. Palette: bg-[#F9F8F6], pure monochrome, NO accent colors
   ```

---

## 十一、token 配方总表（源 `editorial-tokens.ts`，Tailwind 类名字符串）

> 这些是**类名配方**而非 CSS 变量——stylekit 的 token 层就是"每个视觉位该用哪些 Tailwind 类"。
> 同目录 `tokens.css` 是该风格 `globalCss` 里的 CSS 变量与工具类（已做一致性清洗）；
> `design-tokens.json` 是扁平 key-value 形式，便于按需注入。

| 项 | 值 |
|---|---|
| 边框宽度 / 颜色 / 圆角 / 风格 | border · border-border · rounded-none · border-solid |
| 阴影 sm / md / lg / none | shadow-none · shadow-none · shadow-none · shadow-none |
| 阴影 hover / focus | shadow-none · shadow-none |
| 过渡 / 按下态 | transition-colors duration-200 · active:scale-95 |
| 标题字体 / 正文字体 / 等宽字体 | font-serif tracking-tight · font-sans · font-mono |
| 字号 · hero | text-4xl md:text-6xl lg:text-7xl |
| 字号 · h1 | text-3xl md:text-5xl |
| 字号 · h2 | text-2xl md:text-3xl |
| 字号 · h3 | text-xl md:text-2xl |
| 字号 · body | text-sm md:text-base |
| 字号 · small | text-xs |
| 区块间距 / 容器内边距 / 卡片内边距 | py-16 md:py-24 lg:py-32 · px-6 md:px-12 · p-6 |
| 间距 · sm | gap-4 |
| 间距 · md | gap-6 md:gap-8 |
| 间距 · lg | gap-8 md:gap-12 |
| 底色 主 / 次 | bg-background · bg-foreground |
| 底色 · 强调 | bg-[#e63946] |
| 文字 主 / 次 / 弱 | text-foreground · text-background · text-muted |
| 按钮 · primary | bg-foreground text-background |
| 按钮 · secondary | bg-transparent text-foreground |
| 必须包含 · button | px-6 py-3 · text-sm tracking-wide · transition-colors |
| 必须包含 · card | border border-border · hover:border-foreground · transition-colors |
| 必须包含 · input | border border-border · text-sm · focus:outline-none · focus:border-foreground · transition-colors · placeholder:text-muted |

---

## 十二、来源与许可

- 素材仓库：AnxForever/**stylekit**（MIT License, © 2026 AnxForever）
- 源文件：`lib/styles/editorial.ts`、`lib/styles/editorial-tokens.ts`
- 转换脚本：`D:\项目\scripts\convert-stylekit-systems.mjs`（一次性、可复跑）
- 局部改动：按 `aiRules` 剔除 `globalCss` 中的矛盾项（见第八节），其余内容保持源样。
- 注意：源仓库的 `components` 字段含可复制的 JSX 组件代码模板，本轮**未纳入**设计系统格式（本项目格式无组件槽位）。
