---
name: 材料设计（Material Design）
description: Google 推出的设计系统，基于纸张和墨水的隐喻，强调层次、动效、大胆色彩和响应式交互，是现代移动端设计的标准。
triggers:
  - 材料设计
  - Material Design
  - Material
  - Google
  - 层次
  - 动效
  - 海拔
  - 涟漪
od:
  category: style-modern
---

# 材料设计（Material Design）

## 一、一句话定位

Google 推出的设计系统，基于纸张和墨水的隐喻，强调层次、动效、大胆色彩和响应式交互，是现代移动端设计的标准。

- 英文名：**Material Design**
- 风格类型：`visual`（视觉风格：靠色彩/材质/字体塑造）
- 关键词：Material、Google、层次、动效、海拔、涟漪、卡片、modern、contemporary、sleek
- 适用场景提示：Material：纸片式层级与标准动效曲线
- 源风格分类：`modern`

---

## 二、设计哲学（源 `philosophy` 字段）

Material Design（材料设计）是 Google 在 2014 年推出的设计语言，将数字界面比作有物理属性的纸张和墨水。

核心理念：
- 材料隐喻：界面如同有厚度的纸张，可堆叠、移动
- 海拔系统：通过阴影表达层次关系
- 大胆色彩：鲜明的主色和强调色
- 有意义的动效：动画传达空间关系和反馈

> ⚠️ 已剔除 5 句跨风格重复的通用模板句（判定标准：在 ≥10 套风格里逐字重复）。被剔除的是「视觉一致性：所有组件必须遵循统一的视觉语言，从色彩到…」「层次分明：通过颜色深浅、字号大小、留白空间建立清晰的…」「交互反馈：每个可交互元素都必须有明确的 hover、…」「响应式适配：设计必须在移动端、平板、桌面端上保持一致…」「无障碍性：确保色彩对比度符合 WCAG 2.1 AA…」这类与具体风格无关的套话，保留的是该风格独有的美学主张。

---

## 三、色彩逻辑

| 项 | 值 |
|---|---|
| 主色 primary | `#6200ee` |
| 辅色 secondary | `#03dac6` |
| 强调色 accent | `#ff0266`、`#ffde03`、`#00c853`、`#c12700` |

配套的 Tailwind 类名配方（来自 `material-design-tokens.ts`）：

- 底色 主 / 次：bg-white · bg-[#f5f5f5]
- 底色 强调：bg-[#6200ee] · bg-[#03dac6] · bg-[#018786] · bg-[#bb86fc]
- 文字 主 / 次 / 弱：text-[#212121] · text-[#757575] · text-[#9e9e9e]

**用色纪律**（源 `doList` 中与颜色相关的条目）：

- 使用大胆鲜明的色彩

---

## 四、字体性格

- 标题：font-sans font-medium tracking-tight
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
| `small` | `text-xs md:text-sm` |

---

## 五、圆角与间距哲学

| 项 | 值 |
|---|---|
| 圆角 | `rounded-md` |
| 边框 | `border border-solid border-[#e0e0e0]` |

| 项 | 值 |
|---|---|
| 区块间距 section | `py-10 md:py-16 lg:py-24` |
| 容器内边距 container | `px-4 md:px-6 lg:px-8` |
| 卡片内边距 card | `p-4 md:p-6` |
| 间距 gap · sm | `gap-2 md:gap-3` |
| 间距 gap · md | `gap-3 md:gap-4` |
| 间距 gap · lg | `gap-4 md:gap-6` |

---

## 六、交互、阴影与状态

| 项 | 值 |
|---|---|
| 过渡 | `transition-all duration-200 ease-in-out` |
| 按下态 | `active:scale-[0.99]` |
| 阴影 sm / md / lg / none | `shadow-[0_1px_3px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.14)]` · `shadow-[0_3px_6px_rgba(0,0,0,0.15),0_2px_4px_rgba(0,0,0,0.12)]` · `shadow-[0_10px_20px_rgba(0,0,0,0.15),0_3px_6px_rgba(0,0,0,0.1)]` · `shadow-none` |
| 阴影 hover / focus | `hover:shadow-[0_14px_28px_rgba(0,0,0,0.18),0_5px_10px_rgba(0,0,0,0.12)]` · `focus:shadow-[0_3px_6px_rgba(0,0,0,0.15),0_2px_4px_rgba(0,0,0,0.12)]` |
| 彩色阴影 | purple: `shadow-[0_3px_6px_rgba(98,0,238,0.25)]` · teal: `shadow-[0_3px_6px_rgba(3,218,198,0.25)]` |

---

## 七、禁忌（源 `forbidden` 字段，含**为什么**禁）

> 这一节是 stylekit 最有价值的资产之一：它不仅列出禁用项，还给出了理由。理由直接来自源数据，
> 未做改写，便于直接喂给模型做生成后自检。

| 项 | 值 |
|---|---|
| `rounded-none` | Material Design uses subtle rounding (rounded-md) for card elevation |
| `shadow-[4px_4px_0px` | Material Design uses elevation-based blur shadows, not hard-edge |
| `border-black` | Material Design uses subtle gray borders or relies on elevation shadows |
| `font-serif` | Material Design uses clean sans-serif typography (Roboto-style) |
| 其他禁用类名 | `border-4`、`shadow-[2px_2px_0px`、`shadow-[8px_8px_0px`、`font-black`、`bg-gradient-to-r`、`bg-gradient-to-l` |
| 其他禁用正则 | `^rounded-none$`、`^shadow-\[\d+px_\d+px_0px`、`^font-(?:black\|serif)$`、`^border-(?:black\|4)$` |

另外，源 `dontList` 以自然语言补充：

- 禁止使用不一致的阴影深度
- 禁止使用过于柔和的配色
- 禁止省略交互反馈
- 禁止打破 8dp 网格系统
- 禁止按钮缺少 active:scale-[0.98]（Material Pseudo-Ripple 是触感真实性的核心）
- 禁止使用非 Material 标准缓动曲线（必须使用 cubic-bezier(0.4,0,0.2,1)）
- 禁止卡片 hover 时阴影不变深（海拔变化是 Material 物理规则，不可省略）

---

## 八、一致性清洗记录

源仓库的 `globalCss` 里存在与本风格 `aiRules` 直接冲突的模板残留，已按**以 aiRules 为准**剔除下列 3 项（原始素材保留在仓库中未改动）：

| 项 | 值 |
|---|---|
| `.material-design-card::before` | 渐变（aiRules 禁渐变） |
| `.material-design-gradient` | 渐变（aiRules 禁渐变） |
| `.material-design-gradient-text` | 渐变（aiRules 禁渐变） |

### 禁令推导依据

从本套的 `forbidden` 与 `aiRules` 推导出 **1 条整类禁令**（`gradient`），依据如下：

| 项 | 值 |
|---|---|
| `gradient` | forbidden.classes 含 bg-gradient-to-r/bg-gradient-to-l，且 patterns 中无对 gradient 的显式豁免 |

---

## 九、AI 硬规则（源 `aiRules` 全文，生成时应逐条遵守）

```text
你是一个 Material Design 设计风格的前端开发专家。生成的所有代码必须严格遵守以下约束：

## 绝对禁止

- 使用不一致的阴影深度
- 使用过于柔和暗淡的配色
- 省略交互反馈效果
- 打破 8dp 网格系统

## 必须遵守

- 海拔阴影 shadow-[0_1px_3px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.24)]
- 主色调 bg-[#6200ee] text-white
- 强调色 bg-[#03dac6]
- 圆角卡片 rounded-xl
- 大写按钮文字 uppercase tracking-wider

## 配色

- 主色: #6200ee (紫色)
- 主色变体: #3700b3
- 次要色: #03dac6 (青色)
- 背景: #fafafa
- 表面: #ffffff
- 错误: #b00020

## 间距

- 基于 8dp 网格
- p-2 (8px), p-4 (16px), p-6 (24px), p-8 (32px)

## Animation & Interaction Rules

- Elevation Physics: hover 时从低海拔阴影抬升到高海拔阴影，可配合轻微 -translate-y-1 强化 Z 轴感。
- Pseudo-Ripple: active 状态至少包含 active:scale-[0.98] 或明暗下压反馈，模拟触控涟漪前奏。
- Deceleration Curve: 交互过渡优先使用 ease-[cubic-bezier(0.4,0,0.2,1)]，时长 200-300ms。
- Input Float: 输入框聚焦时标签必须平滑上浮并缩小，边框高亮同步过渡。
```

---

## 十、必须包含项与示例提示词

- **button** 必须含：`rounded-md` · `shadow-[0_1px_3px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.14)]` · `hover:shadow-[0_14px_28px_rgba(0,0,0,0.18),0_5px_10px_rgba(0,0,0,0.12)]` · `transition-all duration-200 ease-in-out` · `font-medium`
- **card** 必须含：`rounded-md` · `shadow-[0_1px_3px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.14)]` · `bg-white`
- **input** 必须含：`rounded-md` · `border border-[#e0e0e0]` · `bg-white` · `font-sans` · `focus:border-[#6200ee]` · `focus:outline-none`

示例提示词（源 `examplePrompts`）：

1. **任务管理应用**（Task Management App）—— Material 风格的任务管理界面
   ```text
   用 Material Design 创建一个任务管理应用界面，要求：
1. 顶部应用栏带阴影
2. 浮动操作按钮 (FAB)
3. 卡片列表展示任务
4. 使用海拔阴影系统
5. 紫色主色调，青色强调
   ```
2. **SaaS 着陆页**（SaaS Landing Page）—— 生成 材料设计风格的 SaaS 产品着陆页
   ```text
   Create a SaaS landing page using Material Design style with hero section, feature grid, testimonials, pricing table, and footer.
   ```
3. **作品集展示**（Portfolio Showcase）—— 生成 材料设计风格的作品集页面
   ```text
   Create a portfolio showcase page using Material Design style with project grid, about section, contact form, and consistent visual language.
   ```

---

## 十一、token 配方总表（源 `material-design-tokens.ts`，Tailwind 类名字符串）

> 这些是**类名配方**而非 CSS 变量——stylekit 的 token 层就是"每个视觉位该用哪些 Tailwind 类"。
> 同目录 `tokens.css` 是该风格 `globalCss` 里的 CSS 变量与工具类（已做一致性清洗）；
> `design-tokens.json` 是扁平 key-value 形式，便于按需注入。

| 项 | 值 |
|---|---|
| 边框宽度 / 颜色 / 圆角 / 风格 | border · border-[#e0e0e0] · rounded-md · border-solid |
| 阴影 sm / md / lg / none | shadow-[0_1px_3px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.14)] · shadow-[0_3px_6px_rgba(0,0,0,0.15),0_2px_4px_rgba(0,0,0,0.12)] · shadow-[0_10px_20px_rgba(0,0,0,0.15),0_3px_6px_rgba(0,0,0,0.1)] · shadow-none |
| 阴影 hover / focus | hover:shadow-[0_14px_28px_rgba(0,0,0,0.18),0_5px_10px_rgba(0,0,0,0.12)] · focus:shadow-[0_3px_6px_rgba(0,0,0,0.15),0_2px_4px_rgba(0,0,0,0.12)] |
| 彩色阴影 | purple: shadow-[0_3px_6px_rgba(98,0,238,0.25)] · teal: shadow-[0_3px_6px_rgba(3,218,198,0.25)] |
| 过渡 / 按下态 | transition-all duration-200 ease-in-out · active:scale-[0.99] |
| 标题字体 / 正文字体 / 等宽字体 | font-sans font-medium tracking-tight · font-sans · font-mono |
| 字号 · hero | text-4xl md:text-6xl lg:text-7xl |
| 字号 · h1 | text-3xl md:text-5xl |
| 字号 · h2 | text-2xl md:text-3xl |
| 字号 · h3 | text-xl md:text-2xl |
| 字号 · body | text-sm md:text-base |
| 字号 · small | text-xs md:text-sm |
| 区块间距 / 容器内边距 / 卡片内边距 | py-10 md:py-16 lg:py-24 · px-4 md:px-6 lg:px-8 · p-4 md:p-6 |
| 间距 · sm | gap-2 md:gap-3 |
| 间距 · md | gap-3 md:gap-4 |
| 间距 · lg | gap-4 md:gap-6 |
| 底色 主 / 次 | bg-white · bg-[#f5f5f5] |
| 底色 · 强调 | bg-[#6200ee] · bg-[#03dac6] · bg-[#018786] · bg-[#bb86fc] |
| 文字 主 / 次 / 弱 | text-[#212121] · text-[#757575] · text-[#9e9e9e] |
| 按钮 · primary | bg-[#6200ee] text-white |
| 按钮 · secondary | bg-transparent text-[#6200ee] border border-[#6200ee] |
| 按钮 · danger | bg-[#b00020] text-white |
| 必须包含 · button | rounded-md · shadow-[0_1px_3px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.14)] · hover:shadow-[0_14px_28px_rgba(0,0,0,0.18),0_5px_10px_rgba(0,0,0,0.12)] · transition-all duration-200 ease-in-out · font-medium |
| 必须包含 · card | rounded-md · shadow-[0_1px_3px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.14)] · bg-white |
| 必须包含 · input | rounded-md · border border-[#e0e0e0] · bg-white · font-sans · focus:border-[#6200ee] · focus:outline-none |

---

## 十二、来源与许可

- 素材仓库：AnxForever/**stylekit**（MIT License, © 2026 AnxForever）
- 源文件：`lib/styles/material-design.ts`、`lib/styles/material-design-tokens.ts`
- 转换脚本：`D:\项目\scripts\convert-stylekit-systems.mjs`（一次性、可复跑）
- 局部改动：按 `aiRules` 剔除 `globalCss` 中的矛盾项（见第八节），其余内容保持源样。
- 注意：源仓库的 `components` 字段含可复制的 JSX 组件代码模板，本轮**未纳入**设计系统格式（本项目格式无组件槽位）。
