---
name: 单色极简（Monochrome）
description: 纯黑白灰的极致单色设计，通过精确的灰阶层次、字重对比和负空间构建视觉层次，不依赖任何色彩即达到高级感。适合摄影、建筑和高端品牌。
triggers:
  - 单色极简
  - Monochrome
  - 单色
  - 黑白
  - 灰阶
  - 极简
  - 无色彩
  - 高级感
od:
  category: style-minimal
---

# 单色极简（Monochrome）

## 一、一句话定位

纯黑白灰的极致单色设计，通过精确的灰阶层次、字重对比和负空间构建视觉层次，不依赖任何色彩即达到高级感。适合摄影、建筑和高端品牌。

- 英文名：**Monochrome**
- 风格类型：`visual`（视觉风格：靠色彩/材质/字体塑造）
- 关键词：单色、黑白、灰阶、极简、无色彩、高级感、摄影、建筑、minimal、clean
- 适用场景提示：单色：只用一色明度阶梯，零彩色
- 源风格分类：`minimal`

---

## 二、设计哲学（源 `philosophy` 字段）

单色极简（Monochrome）是对色彩的彻底放弃，仅凭黑、白、灰三者的精确调度构建完整的视觉层次。

核心理念：
- 零色相依赖：不使用任何带有色相（hue）的颜色，所有视觉信息由灰阶传达
- 灰阶层次：通过 #111111 到 #fafafa 之间的精确灰度梯度建立信息优先级
- 字重对比：以 font-light 与 font-bold 的差异替代色彩区分
- 负空间构图：大量留白不是空白，是设计的一部分
- 网格秩序：严格的网格系统确保每一个元素都有精确的位置

> ⚠️ 已剔除 5 句跨风格重复的通用模板句（判定标准：在 ≥10 套风格里逐字重复）。被剔除的是「视觉一致性：所有组件必须遵循统一的视觉语言，从色彩到…」「层次分明：通过颜色深浅、字号大小、留白空间建立清晰的…」「交互反馈：每个可交互元素都必须有明确的 hover、…」「响应式适配：设计必须在移动端、平板、桌面端上保持一致…」「无障碍性：确保色彩对比度符合 WCAG 2.1 AA…」这类与具体风格无关的套话，保留的是该风格独有的美学主张。

---

## 三、色彩逻辑

| 项 | 值 |
|---|---|
| 主色 primary | `#111111` |
| 辅色 secondary | `#fafafa` |
| 强调色 accent | `#666666`、`#999999`、`#cccccc`、`#666666` |

配套的 Tailwind 类名配方（来自 `monochrome-tokens.ts`）：

- 底色 主 / 次：bg-[#fafafa] · bg-[#f5f5f5]
- 底色 强调：bg-[#e5e5e5] · bg-[#cccccc] · bg-[#111111]
- 文字 主 / 次 / 弱：text-[#111111] · text-[#666666] · text-[#999999]

**用色纪律**（源 `doList` 中与颜色相关的条目）：

- 使用纯灰色调背景 bg-[#fafafa] 或 bg-white
- 主要文字使用深灰 text-[#111111]，次要文字 text-[#666666]
- 通过 font-light 和 font-bold 的字重对比建立层次

---

## 四、字体性格

- 标题：font-bold tracking-tight
- 正文：font-light
- 等宽：font-mono

字号阶梯：

| 项 | 值 |
|---|---|
| `hero` | `text-4xl md:text-6xl lg:text-8xl` |
| `h1` | `text-3xl md:text-5xl` |
| `h2` | `text-2xl md:text-4xl` |
| `h3` | `text-lg md:text-xl` |
| `body` | `text-sm md:text-base` |
| `small` | `text-xs` |

---

## 五、圆角与间距哲学

| 项 | 值 |
|---|---|
| 圆角 | `rounded-sm` |
| 边框 | `border border-solid border-[#e5e5e5]` |

| 项 | 值 |
|---|---|
| 区块间距 section | `py-16 md:py-24` |
| 容器内边距 container | `px-6 md:px-8` |
| 卡片内边距 card | `p-6` |
| 间距 gap · sm | `gap-4` |
| 间距 gap · md | `gap-6` |
| 间距 gap · lg | `gap-8` |

---

## 六、交互、阴影与状态

| 项 | 值 |
|---|---|
| 过渡 | `transition-colors duration-200` |
| 按下态 | `active:opacity-70` |
| 阴影 sm / md / lg / none | `shadow-sm` · `shadow-sm` · `shadow-md` · `shadow-none` |
| 阴影 hover / focus | `shadow-sm` · `ring-1 ring-[#cccccc]` |
| 彩色阴影 | — |

---

## 七、禁忌（源 `forbidden` 字段，含**为什么**禁）

> 这一节是 stylekit 最有价值的资产之一：它不仅列出禁用项，还给出了理由。理由直接来自源数据，
> 未做改写，便于直接喂给模型做生成后自检。

| 项 | 值 |
|---|---|
| `bg-blue-500` | Monochrome style forbids any color with hue; use grayscale only |
| `text-red-500` | Monochrome style forbids any color with hue; use grayscale only |
| `rounded-full` | Monochrome style uses sharp corners only (rounded-sm or rounded-none) |
| `shadow-xl` | Monochrome style uses minimal shadows only (shadow-sm max) |
| `bg-gradient-to-r` | Monochrome style forbids gradients entirely |
| 其他禁用类名 | `bg-red-500`、`bg-green-500`、`bg-pink-500`、`bg-purple-500`、`bg-yellow-500`、`bg-orange-500`、`bg-cyan-500`、`bg-indigo-500`、`bg-teal-500`、`bg-emerald-500`、`bg-rose-500`、`text-blue-500`、`text-green-500`、`text-pink-500`、`shadow-lg`、`shadow-2xl`、`bg-gradient-to-l`、`bg-gradient-to-t`、`bg-gradient-to-b` |
| 其他禁用正则 | `^bg-(?:blue\|red\|green\|pink\|purple\|yellow\|orange\|cyan\|indigo\|teal\|emerald\|rose\|violet\|amber\|lime\|sky\|fuchsia)-`、`^text-(?:blue\|red\|green\|pink\|purple\|yellow\|orange\|cyan\|indigo\|teal\|emerald\|rose\|violet\|amber\|lime\|sky\|fuchsia)-`、`^border-(?:blue\|red\|green\|pink\|purple\|yellow\|orange\|cyan\|indigo\|teal\|emerald\|rose\|violet\|amber\|lime\|sky\|fuchsia)-`、`^rounded-full$`、`^shadow-(?:xl\|2xl)$`、`^bg-gradient-` |

另外，源 `dontList` 以自然语言补充：

- 禁止使用任何带色相的颜色（无 blue/red/green/pink 等）
- 禁止使用 rounded-full 圆形圆角
- 禁止使用重阴影 shadow-lg shadow-xl shadow-2xl
- 禁止使用渐变 bg-gradient-to-*

---

## 八、一致性清洗记录

源仓库的 `globalCss` 里存在与本风格 `aiRules` 直接冲突的模板残留，已按**以 aiRules 为准**剔除下列 3 项（原始素材保留在仓库中未改动）：

| 项 | 值 |
|---|---|
| `.monochrome-card::before` | 渐变（aiRules 禁渐变） |
| `.monochrome-gradient` | 渐变（aiRules 禁渐变） |
| `.monochrome-gradient-text` | 渐变（aiRules 禁渐变） |

### 禁令推导依据

从本套的 `forbidden` 与 `aiRules` 推导出 **1 条整类禁令**（`gradient`），依据如下：

| 项 | 值 |
|---|---|
| `gradient` | forbidden.patterns 含整类渐变禁令 `^bg-gradient-` |

---

## 九、AI 硬规则（源 `aiRules` 全文，生成时应逐条遵守）

```text
You are designing in Monochrome style.
- Use ONLY grayscale colors: #111111, #333333, #666666, #999999, #cccccc, #e5e5e5, #f5f5f5, #fafafa, #ffffff
- NEVER use any color with hue (no blue, red, green, pink, orange, etc.)
- Build hierarchy with font-weight contrast: font-light for body, font-bold for headings
- Use generous negative space (py-24, px-8) for breathing room
- Borders must be subtle: grayscale borders in the #e5e5e5 to #cccccc range
- No rounded-full, no heavy shadows, no gradients
- Keep corners sharp: rounded-sm or rounded-none
- Uppercase tracking-wider for labels and small text
- Grid-based alignment for all layouts

## Animation & Interaction Rules

- Deliberate Slowness: 交互应使用 duration-500 到 700 的缓慢节奏，避免快速跳变。
- Grayscale Breathing: 仅允许相邻灰阶过渡（如 #111111 到 #2a2a2a），保持克制。
- Line Growth: 优先使用细线延展作为交互提示，减少大面积反差切换。
- Static Elevation: 避免 translate 和重阴影，维持安静二维平面感。
```

---

## 十、必须包含项与示例提示词

- **button** 必须含：`rounded-sm` · `transition-colors` · `font-medium`
- **card** 必须含：`rounded-sm` · `border`
- **input** 必须含：`border-b` · `focus:outline-none` · `bg-transparent`

示例提示词（源 `examplePrompts`）：

1. **SaaS 着陆页**（SaaS Landing Page）—— 生成 单色极简风格的 SaaS 产品着陆页
   ```text
   Create a SaaS landing page using Monochrome style with hero section, feature grid, testimonials, pricing table, and footer.
   ```
2. **作品集展示**（Portfolio Showcase）—— 生成 单色极简风格的作品集页面
   ```text
   Create a portfolio showcase page using Monochrome style with project grid, about section, contact form, and consistent visual language.
   ```

---

## 十一、token 配方总表（源 `monochrome-tokens.ts`，Tailwind 类名字符串）

> 这些是**类名配方**而非 CSS 变量——stylekit 的 token 层就是"每个视觉位该用哪些 Tailwind 类"。
> 同目录 `tokens.css` 是该风格 `globalCss` 里的 CSS 变量与工具类（已做一致性清洗）；
> `design-tokens.json` 是扁平 key-value 形式，便于按需注入。

| 项 | 值 |
|---|---|
| 边框宽度 / 颜色 / 圆角 / 风格 | border · border-[#e5e5e5] · rounded-sm · border-solid |
| 阴影 sm / md / lg / none | shadow-sm · shadow-sm · shadow-md · shadow-none |
| 阴影 hover / focus | shadow-sm · ring-1 ring-[#cccccc] |
| 过渡 / 按下态 | transition-colors duration-200 · active:opacity-70 |
| 标题字体 / 正文字体 / 等宽字体 | font-bold tracking-tight · font-light · font-mono |
| 字号 · hero | text-4xl md:text-6xl lg:text-8xl |
| 字号 · h1 | text-3xl md:text-5xl |
| 字号 · h2 | text-2xl md:text-4xl |
| 字号 · h3 | text-lg md:text-xl |
| 字号 · body | text-sm md:text-base |
| 字号 · small | text-xs |
| 区块间距 / 容器内边距 / 卡片内边距 | py-16 md:py-24 · px-6 md:px-8 · p-6 |
| 间距 · sm | gap-4 |
| 间距 · md | gap-6 |
| 间距 · lg | gap-8 |
| 底色 主 / 次 | bg-[#fafafa] · bg-[#f5f5f5] |
| 底色 · 强调 | bg-[#e5e5e5] · bg-[#cccccc] · bg-[#111111] |
| 文字 主 / 次 / 弱 | text-[#111111] · text-[#666666] · text-[#999999] |
| 按钮 · primary | bg-[#111111] text-[#fafafa] |
| 按钮 · secondary | bg-[#f5f5f5] border border-[#e5e5e5] text-[#111111] |
| 必须包含 · button | rounded-sm · transition-colors · font-medium |
| 必须包含 · card | rounded-sm · border |
| 必须包含 · input | border-b · focus:outline-none · bg-transparent |

---

## 十二、来源与许可

- 素材仓库：AnxForever/**stylekit**（MIT License, © 2026 AnxForever）
- 源文件：`lib/styles/monochrome.ts`、`lib/styles/monochrome-tokens.ts`
- 转换脚本：`D:\项目\scripts\convert-stylekit-systems.mjs`（一次性、可复跑）
- 局部改动：按 `aiRules` 剔除 `globalCss` 中的矛盾项（见第八节），其余内容保持源样。
- 注意：源仓库的 `components` 字段含可复制的 JSX 组件代码模板，本轮**未纳入**设计系统格式（本项目格式无组件槽位）。
