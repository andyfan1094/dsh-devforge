---
name: 包豪斯风格（Bauhaus）
description: 德国包豪斯学派的设计理念，强调功能主义、几何形式和原色运用，形式追随功能的现代主义经典。
triggers:
  - 包豪斯风格
  - Bauhaus
  - 包豪斯
  - 功能主义
  - 几何
  - 原色
  - 现代主义
  - 极简
od:
  category: style-modern
---

# 包豪斯风格（Bauhaus）

## 一、一句话定位

德国包豪斯学派的设计理念，强调功能主义、几何形式和原色运用，形式追随功能的现代主义经典。

- 英文名：**Bauhaus**
- 风格类型：`visual`（视觉风格：靠色彩/材质/字体塑造）
- 关键词：包豪斯、功能主义、几何、原色、现代主义、极简、modern、contemporary、sleek、现代
- 适用场景提示：包豪斯：三原色 + 基本几何形 + 功能主义构成
- 源风格分类：`modern`

---

## 二、设计哲学（源 `philosophy` 字段）

Bauhaus（包豪斯）是1919年在德国创立的设计学派，其核心理念"形式追随功能"深刻影响了现代设计。

核心理念：
- 功能主义：设计服务于功能，去除多余装饰
- 几何形式：圆形、方形、三角形的纯粹运用
- 原色运用：红、黄、蓝三原色 + 黑白
- 统一性：艺术与工艺的结合
- 机械精密：交互如精密仪器运转，短促有力

> ⚠️ 已剔除 5 句跨风格重复的通用模板句（判定标准：在 ≥10 套风格里逐字重复）。被剔除的是「视觉一致性：所有组件必须遵循统一的视觉语言，从色彩到…」「层次分明：通过颜色深浅、字号大小、留白空间建立清晰的…」「交互反馈：每个可交互元素都必须有明确的 hover、…」「响应式适配：设计必须在移动端、平板、桌面端上保持一致…」「无障碍性：确保色彩对比度符合 WCAG 2.1 AA…」这类与具体风格无关的套话，保留的是该风格独有的美学主张。

---

## 三、色彩逻辑

| 项 | 值 |
|---|---|
| 主色 primary | `#000000` |
| 辅色 secondary | `#ffffff` |
| 强调色 accent | `#ff0000`、`#ffcc00`、`#0000ff`、`#6c3b00` |

配套的 Tailwind 类名配方（来自 `bauhaus-tokens.ts`）：

- 底色 主 / 次：bg-white · bg-black
- 底色 强调：bg-[#dd0000] · bg-[#ffd700] · bg-[#0057b8]
- 文字 主 / 次 / 弱：text-black · text-white · text-gray-600

**用色纪律**（源 `doList` 中与颜色相关的条目）：

- 使用原色（红、黄、蓝）+ 黑白
- 色彩交互为原色之间的硬切换，不用透明度渐变
- 利用伪元素做几何色块的滑入/覆盖动画

---

## 四、字体性格

- 标题：font-sans font-bold uppercase tracking-widest
- 正文：font-sans
- 等宽：font-mono

字号阶梯：

| 项 | 值 |
|---|---|
| `hero` | `text-5xl md:text-7xl lg:text-9xl` |
| `h1` | `text-4xl md:text-6xl` |
| `h2` | `text-2xl md:text-4xl` |
| `h3` | `text-xl md:text-2xl` |
| `body` | `text-sm md:text-base` |
| `small` | `text-xs md:text-sm` |

---

## 五、圆角与间距哲学

| 项 | 值 |
|---|---|
| 圆角 | `rounded-none` |
| 边框 | `border-2 border-solid border-black` |

| 项 | 值 |
|---|---|
| 区块间距 section | `py-12 md:py-24 lg:py-32` |
| 容器内边距 container | `px-4 md:px-8 lg:px-16` |
| 卡片内边距 card | `p-6 md:p-8` |
| 间距 gap · sm | `gap-2 md:gap-4` |
| 间距 gap · md | `gap-4 md:gap-8` |
| 间距 gap · lg | `gap-8 md:gap-12` |

---

## 六、交互、阴影与状态

| 项 | 值 |
|---|---|
| 过渡 | `transition-opacity duration-200` |
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
| `font-serif` | Bauhaus uses geometric sans-serif typography only (font-sans) |
| `rounded-xl` | Bauhaus uses strict geometric forms with sharp angles (rounded-none) |
| `shadow-lg` | Bauhaus rejects decorative shadows; form follows function |
| `bg-gradient-to-r` | Bauhaus uses flat solid primary colors (red, yellow, blue), no gradients |
| 其他禁用类名 | `rounded-lg`、`rounded-2xl`、`rounded-3xl`、`rounded-full`、`shadow-sm`、`shadow`、`shadow-md`、`shadow-xl`、`shadow-2xl`、`bg-gradient-to-l`、`bg-gradient-to-b`、`bg-gradient-to-t`、`border-dashed`、`border-dotted`、`italic` |
| 其他禁用正则 | `^font-serif`、`^rounded-(?!none)`、`^shadow-(?!none)`、`^bg-gradient-`、`^border-(?:dashed\|dotted)` |

另外，源 `dontList` 以自然语言补充：

- 禁止使用复杂的渐变
- 禁止使用装饰性元素
- 禁止使用衬线字体
- 禁止使用非原色的复杂配色
- 禁止使用柔和缓慢的 duration-500 以上过渡
- 禁止使用 ease-in-out（使用 ease-out）
- 禁止使用圆角（rounded-lg 等），仅允许 rounded-full 用于圆形

---

## 八、一致性清洗记录

源仓库的 `globalCss` 里存在与本风格 `aiRules` 直接冲突的模板残留，已按**以 aiRules 为准**剔除下列 2 项（原始素材保留在仓库中未改动）：

| 项 | 值 |
|---|---|
| `.bauhaus-gradient` | 渐变（aiRules 禁渐变） |
| `.bauhaus-gradient-text` | 渐变（aiRules 禁渐变） |

### 禁令推导依据

从本套的 `forbidden` 与 `aiRules` 推导出 **1 条整类禁令**（`gradient`），依据如下：

| 项 | 值 |
|---|---|
| `gradient` | forbidden.patterns 含整类渐变禁令 `^bg-gradient-` |

---

## 九、AI 硬规则（源 `aiRules` 全文，生成时应逐条遵守）

```text
你是一名专精 Bauhaus（包豪斯）设计风格的前端开发专家。生成的所有代码都必须严格遵守以下约束：

## 绝对禁止

- 使用复杂的渐变效果
- 使用装饰性元素
- 使用衬线字体
- 使用非原色的复杂配色
- 使用柔和缓慢的 ease-in-out 或 duration-500 以上的过渡
- 使用圆角（rounded-lg, rounded-xl），仅 rounded-full 可用于纯圆形

## 必须遵守

- 原色配色 bg-red-600, bg-yellow-400, bg-blue-600
- 黑白为基础色 bg-black, bg-white, text-black
- 粗边框 border-4 border-black
- 无衬线字体 font-bold, font-black
- 大写字母 uppercase
- 几何形状装饰

## 动效与交互规则

- Structural Shifts（结构性位移）：动效要展现"结构"本身，使用硬朗的位移或大面积纯色相互覆盖来表达。
- Mechanical Precision（机械精度）：过渡时间短促有力，使用 duration-150 或 duration-200，配合 ease-out。
- Primary Color Swaps（原色互换）：交互时在红（#ff0000）、黄（#ffcc00）、蓝（#0000ff）、黑、白之间进行高对比度的色彩翻转。
- Geometric Reveals（几何滑现）：利用伪元素（如 absolute inset-0 bg-yellow-400），在悬停时像滑轨一样从 -translate-x-full 滑入 translate-x-0，覆盖原本的色块。
- Geometric Animation（几何动效）：几何装饰元素在悬停时 scale-125 或 rotate-45，体现出机械运转般的精密感。

## 配色方案

仅使用：
- 红色：#ff0000, bg-red-600
- 黄色：#ffcc00, bg-yellow-400
- 蓝色：#0000ff, bg-blue-600
- 黑色：#000000, bg-black
- 白色：#ffffff, bg-white

## 几何元素

- 圆形 rounded-full
- 方形（不使用圆角）
- 三角形（用 border 实现）
```

---

## 十、必须包含项与示例提示词

- **button** 必须含：`rounded-none` · `border-2 border-black` · `font-sans font-bold uppercase` · `transition-opacity duration-200`
- **card** 必须含：`rounded-none` · `border-2 border-black` · `bg-white`
- **input** 必须含：`rounded-none` · `border-2 border-black` · `font-sans` · `focus:outline-none`

示例提示词（源 `examplePrompts`）：

1. **设计学院官网**（Design School Website）—— 现代主义设计学院网站
   ```text
   用 Bauhaus 风格创建一个设计学院官网，要求：
1. 配色：仅使用红黄蓝 + 黑白
2. 几何装饰：圆形、方形、三角形，悬停时 scale/rotate
3. 按钮使用色块滑轨覆盖机制（伪元素 translate 动画）
4. 字体：粗体无衬线 + 大写
5. 布局：网格对齐
6. 所有交互 duration-150 到 200，ease-out
7. 去除所有装饰性元素
   ```
2. **SaaS 着陆页**（SaaS Landing Page）—— 生成 包豪斯风格风格的 SaaS 产品着陆页
   ```text
   Create a SaaS landing page using Bauhaus style with hero section, feature grid, testimonials, pricing table, and footer.
   ```
3. **作品集展示**（Portfolio Showcase）—— 生成 包豪斯风格风格的作品集页面
   ```text
   Create a portfolio showcase page using Bauhaus style with project grid, about section, contact form, and consistent visual language.
   ```

---

## 十一、token 配方总表（源 `bauhaus-tokens.ts`，Tailwind 类名字符串）

> 这些是**类名配方**而非 CSS 变量——stylekit 的 token 层就是"每个视觉位该用哪些 Tailwind 类"。
> 同目录 `tokens.css` 是该风格 `globalCss` 里的 CSS 变量与工具类（已做一致性清洗）；
> `design-tokens.json` 是扁平 key-value 形式，便于按需注入。

| 项 | 值 |
|---|---|
| 边框宽度 / 颜色 / 圆角 / 风格 | border-2 · border-black · rounded-none · border-solid |
| 阴影 sm / md / lg / none | shadow-none · shadow-none · shadow-none · shadow-none |
| 阴影 hover / focus | hover:shadow-none · focus:shadow-none |
| 过渡 / 按下态 | transition-opacity duration-200 · active:opacity-70 |
| 标题字体 / 正文字体 / 等宽字体 | font-sans font-bold uppercase tracking-widest · font-sans · font-mono |
| 字号 · hero | text-5xl md:text-7xl lg:text-9xl |
| 字号 · h1 | text-4xl md:text-6xl |
| 字号 · h2 | text-2xl md:text-4xl |
| 字号 · h3 | text-xl md:text-2xl |
| 字号 · body | text-sm md:text-base |
| 字号 · small | text-xs md:text-sm |
| 区块间距 / 容器内边距 / 卡片内边距 | py-12 md:py-24 lg:py-32 · px-4 md:px-8 lg:px-16 · p-6 md:p-8 |
| 间距 · sm | gap-2 md:gap-4 |
| 间距 · md | gap-4 md:gap-8 |
| 间距 · lg | gap-8 md:gap-12 |
| 底色 主 / 次 | bg-white · bg-black |
| 底色 · 强调 | bg-[#dd0000] · bg-[#ffd700] · bg-[#0057b8] |
| 文字 主 / 次 / 弱 | text-black · text-white · text-gray-600 |
| 按钮 · primary | bg-[#dd0000] text-white |
| 按钮 · secondary | bg-black text-white |
| 按钮 · danger | bg-[#dd0000] text-white |
| 必须包含 · button | rounded-none · border-2 border-black · font-sans font-bold uppercase · transition-opacity duration-200 |
| 必须包含 · card | rounded-none · border-2 border-black · bg-white |
| 必须包含 · input | rounded-none · border-2 border-black · font-sans · focus:outline-none |

---

## 十二、来源与许可

- 素材仓库：AnxForever/**stylekit**（MIT License, © 2026 AnxForever）
- 源文件：`lib/styles/bauhaus.ts`、`lib/styles/bauhaus-tokens.ts`
- 转换脚本：`D:\项目\scripts\convert-stylekit-systems.mjs`（一次性、可复跑）
- 局部改动：按 `aiRules` 剔除 `globalCss` 中的矛盾项（见第八节），其余内容保持源样。
- 注意：源仓库的 `components` 字段含可复制的 JSX 组件代码模板，本轮**未纳入**设计系统格式（本项目格式无组件槽位）。
