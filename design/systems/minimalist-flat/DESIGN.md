---
name: 极简扁平风（Minimalist Flat）
description: 极致简约的扁平设计，无阴影无渐变，通过颜色和留白创造层次。适合作品集、创意机构、艺术网站。
triggers:
  - 极简扁平风
  - Minimalist Flat
  - 极简
  - 扁平
  - 无阴影
  - 作品集
  - 创意
  - 艺术
od:
  category: style-minimal
---

# 极简扁平风（Minimalist Flat）

## 一、一句话定位

极致简约的扁平设计，无阴影无渐变，通过颜色和留白创造层次。适合作品集、创意机构、艺术网站。

- 英文名：**Minimalist Flat**
- 风格类型：`visual`（视觉风格：靠色彩/材质/字体塑造）
- 关键词：极简、扁平、无阴影、作品集、创意、艺术、minimal、clean、simple、留白
- 适用场景提示：极简扁平：去装饰、去阴影、纯排版驱动的通用底子
- 源风格分类：`minimal`

---

## 二、设计哲学（源 `philosophy` 字段）

Minimalist Flat 风格追求设计的本质，去除一切不必要的装饰，让内容成为主角。

核心理念：
- 少即是多：每个元素都必须有存在的理由
- 扁平纯粹：拒绝阴影、渐变等仿真效果
- 颜色说话：用色彩区分层次而非光影
- 大量留白：让设计呼吸，突出核心内容

> ⚠️ 已剔除 5 句跨风格重复的通用模板句（判定标准：在 ≥10 套风格里逐字重复）。被剔除的是「视觉一致性：所有组件必须遵循统一的视觉语言，从色彩到…」「层次分明：通过颜色深浅、字号大小、留白空间建立清晰的…」「交互反馈：每个可交互元素都必须有明确的 hover、…」「响应式适配：设计必须在移动端、平板、桌面端上保持一致…」「无障碍性：确保色彩对比度符合 WCAG 2.1 AA…」这类与具体风格无关的套话，保留的是该风格独有的美学主张。

---

## 三、色彩逻辑

| 项 | 值 |
|---|---|
| 主色 primary | `#000000` |
| 辅色 secondary | `#ffffff` |
| 强调色 accent | `#ff3366`、`#00d4aa`、`#ffcc00`、`#b45700` |

配套的 Tailwind 类名配方（来自 `minimalist-flat-tokens.ts`）：

- 底色 主 / 次：bg-white · bg-black
- 底色 强调：bg-[#ff3366] · bg-[#00d4aa] · bg-[#ffcc00]
- 文字 主 / 次 / 弱：text-black · text-white · text-gray-500

**用色纪律**（源 `doList` 中与颜色相关的条目）：

- 使用纯色背景 bg-white, bg-black, bg-[accent]
- 使用高对比度配色
- 文字使用纯黑或纯白 text-black, text-white
- 悬停使用颜色变化而非阴影

---

## 四、字体性格

- 标题：font-bold tracking-tight
- 正文：font-sans
- 等宽：font-mono

字号阶梯：

| 项 | 值 |
|---|---|
| `hero` | `text-4xl md:text-6xl lg:text-8xl` |
| `h1` | `text-3xl md:text-5xl` |
| `h2` | `text-2xl md:text-3xl` |
| `h3` | `text-lg md:text-xl` |
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
| 区块间距 section | `py-16 md:py-24 lg:py-32` |
| 容器内边距 container | `px-4 md:px-8 lg:px-16` |
| 卡片内边距 card | `p-6 md:p-8` |
| 间距 gap · sm | `gap-4 md:gap-6` |
| 间距 gap · md | `gap-6 md:gap-8` |
| 间距 gap · lg | `gap-8 md:gap-12` |

---

## 六、交互、阴影与状态

| 项 | 值 |
|---|---|
| 过渡 | `transition-colors duration-200` |
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
| `shadow-md` | Minimalist Flat uses zero shadows - flat design only |
| `bg-gradient-to-r` | Minimalist Flat uses solid pure colors, no gradients |
| `rounded-lg` | Minimalist Flat uses consistent corners: all rounded-none or all rounded-full |
| `bg-gray-100` | Minimalist Flat uses pure black/white, not grays for backgrounds |
| `backdrop-blur` | Minimalist Flat avoids glass/blur effects - pure flat surfaces only |
| 其他禁用类名 | `shadow-sm`、`shadow`、`shadow-lg`、`shadow-xl`、`shadow-2xl`、`bg-gradient-to-b`、`bg-gradient-to-l`、`bg-gradient-to-t`、`rounded-xl`、`rounded-2xl`、`bg-gray-50`、`bg-gray-200`、`text-gray-300`、`text-gray-400`、`backdrop-blur-lg` |
| 其他禁用正则 | `^shadow-(?!none)`、`^bg-gradient-`、`^rounded-(?:sm\|md\|lg\|xl\|2xl\|3xl)$`、`^backdrop-blur`、`^bg-gray-(?:[1-3])` |

另外，源 `dontList` 以自然语言补充：

- 禁止使用任何阴影 shadow-*
- 禁止使用渐变 bg-gradient-*
- 禁止使用透明度低于 0.5 的颜色
- 禁止混用不同的圆角值
- 禁止使用灰色文字（除非是有意为之）
- 禁止使用图案背景

---

## 八、一致性清洗记录

源仓库的 `globalCss` 里存在与本风格 `aiRules` 直接冲突的模板残留，已按**以 aiRules 为准**剔除下列 5 项（原始素材保留在仓库中未改动）：

| 项 | 值 |
|---|---|
| `@keyframes minimalist-flat-fade-in` | transform 位移/缩放（aiRules 禁位移缩放） |
| `.minimalist-flat-card::before` | 渐变（aiRules 禁渐变） |
| `.minimalist-flat-gradient` | 渐变（aiRules 禁渐变） |
| `.minimalist-flat-gradient-text` | 渐变（aiRules 禁渐变） |
| `.minimalist-flat-animate-in 的 animation 声明` | 引用了已删除的 @keyframes minimalist-flat-fade-in |

### 禁令推导依据

从本套的 `forbidden` 与 `aiRules` 推导出 **3 条整类禁令**（`gradient`、`shadow`、`transform`），依据如下：

| 项 | 值 |
|---|---|
| `gradient` | forbidden.patterns 含整类渐变禁令 `^bg-gradient-` |
| `shadow` | 直接禁令句：「- **严格二维扁平**：禁止 translate、禁止 scale、禁止任何 shadow 带来的 Z 轴反馈，所有交互必须停留在二维平面内。」 |
| `transform` | 直接禁令句：「- **Strict 2D Flatness**: NO translate, NO scale, NO shadow Z-axis feedback. All interactions stay within the 2D plane.」 |

---

## 九、AI 硬规则（源 `aiRules` 全文，生成时应逐条遵守）

```text
# Minimalist Flat 设计系统

你是一位专精于极致简约扁平设计的前端开发专家。生成的所有代码都必须严格遵循以下规范。

## 风格身份
- **名称**：Minimalist Flat / 纯粹扁平设计
- **分类**：极简、现代
- **核心**：内容为王，零装饰、最大清晰度、纯粹功能性
- **氛围**：干净、自信、艺术感、编辑感
- **灵感来源**：Dieter Rams、瑞士设计、艺术画廊、高定时尚编辑排版

---

## 核心视觉原则

### 1. 色彩纯粹性（关键）
```
仅允许纯色：
- bg-white, bg-black
- bg-[#ff3366]（或选定的强调色）
- text-black, text-white

禁止透明度，禁止灰色（除非是刻意弱化的文字）
```

### 2. 阴影政策
```
绝对禁止：
- shadow-sm, shadow-md, shadow-lg, shadow-xl, shadow-2xl
- 任何形式的 box-shadow

这是一个零阴影设计系统。
```

### 3. 渐变政策
```
绝对禁止：
- bg-gradient-*, from-*, via-*, to-*

只使用纯粹的扁平色彩。
```

### 4. 圆角一致性
```
选择其中一种并始终一致地应用：
选项 A：rounded-none（锐利、编辑感）
选项 B：rounded-full（仅用于圆形元素）

同一设计中禁止混用不同的圆角值。
```

### 5. 边框系统
```
默认：border-2 border-black
在不使用阴影的前提下建立结构
```

---

## 交互规范

### Hover（高对比度反色）
| 元素 | 默认状态 | Hover 状态 |
|------|---------|-----------|
| 按钮（填充） | bg-black text-white | hover:bg-white hover:text-black |
| 按钮（描边） | bg-white text-black | hover:bg-black hover:text-white |
| 卡片 | bg-white border-black | hover:bg-black hover:text-white |
| 链接 | text-black | hover:text-[accent] |

### Active 状态
```
active:bg-gray-200（浅色变体）
active:bg-gray-100（深色变体）
仅提供短暂的闪烁反馈
```

### Focus 状态
```
focus:outline-none focus:border-[accent]
或者
focus:bg-black focus:text-white
```

---

## 动效规则

### 交互物理
- **严格二维扁平**：禁止 translate、禁止 scale、禁止任何 shadow 带来的 Z 轴反馈，所有交互必须停留在二维平面内。
- **高对比度反色**：hover 使用前景色与背景色互换，反馈干脆、非此即彼。
- **瞬时锐利**：使用 `transition-none` 或 `duration-75`，禁止柔和的淡入淡出，禁止 ease-in-out。
- **边框动态**：focus/hover 通过边框粗细或下划线的变化来建立层次，而非依赖阴影。

### 时长指南
| 交互 | 时长 | 缓动 |
|------|------|------|
| 颜色反转 | 0ms（瞬时） | transition-none |
| 边框变化 | 75ms | ease-out |
| Focus 环 | 150-200ms | ease-out |

---

## 色彩体系

### 核心颜色
| Token | 数值 | 用途 |
|------|------|------|
| Primary | #000000（黑色） | 文字、边框、填充按钮 |
| Background | #ffffff（白色） | 页面背景、卡片 |
| Accent | #ff3366（或自选） | CTA、高亮、hover 状态 |

### 文字层级
| 层级 | 类名 |
|------|------|
| H1 | text-black text-5xl md:text-7xl font-bold tracking-tight |
| H2 | text-black text-3xl md:text-5xl font-bold |
| H3 | text-black text-xl md:text-2xl font-black |
| 正文 | text-black text-base leading-relaxed |
| 弱化 | text-gray-500 text-sm |
| 标签 | text-xs uppercase tracking-widest |

---

## 排版

| 元素 | 类名 |
|------|------|
| 标题 | font-bold tracking-tight leading-tight |
| 正文 | 常规字重，leading-relaxed |
| 标签 | text-xs font-bold uppercase tracking-widest |
| 链接 | underline-offset-4 hover:text-[accent] |

---

## 留白哲学

```
大量留白是硬性要求：
- 区块间距：space-y-12 md:space-y-24
- 卡片内边距：p-8 md:p-12
- 元素之间：gap-6 md:gap-8
- 页面边距：px-6 md:px-12

"拿不准的时候，就多留白。"
```

补充：区块纵向内边距 `py-16 md:py-24`；最大内容宽度 `max-w-6xl mx-auto`。

---

## 组件模板

### 按钮（填充）
```jsx
<button className="px-8 py-4 bg-black text-white font-bold 
  border-2 border-black 
  hover:bg-white hover:text-black 
  active:bg-gray-200 
  transition-none">
  Get Started
</button>
```

### 按钮（描边）
```jsx
<button className="px-8 py-4 bg-white text-black font-bold 
  border-2 border-black 
  hover:bg-black hover:text-white 
  active:bg-gray-100 
  transition-none">
  Learn More
</button>
```

### 卡片（带边框）
```jsx
<div className="group border-2 border-black p-8 
  hover:bg-black hover:text-white 
  transition-colors duration-200 cursor-pointer">
  <span className="text-xs font-bold uppercase tracking-widest 
    text-gray-500 group-hover:text-white">Category</span>
  <h3 className="text-3xl font-black mt-2 mb-4">Title</h3>
  <p className="leading-relaxed">Description text.</p>
</div>
```

---

## 禁止模式

| 模式 | 原因 |
|------|------|
| 任何 shadow-* | 阴影会制造深度，违反扁平原则 |
| 任何渐变 | 渐变会增加维度感，违反扁平原则 |
| opacity < 0.5 | 低透明度会削弱对比度 |
| 混用圆角值 | 破坏视觉一致性 |
| 灰色文字（非刻意） | 降低清晰度 |
| 图案背景 | 增加不必要的视觉噪音 |
| hover 时使用 translate | 制造 Z 轴错觉 |
| hover 时使用 scale | 制造 Z 轴错觉 |
| 柔和过渡（300ms 以上） | 延迟了瞬时反馈 |

---

## 响应式指南

### 间距刻度
```
移动端：space-y-8, p-6, gap-4
桌面端 (md:)：space-y-16, p-12, gap-8
大屏 (lg:)：space-y-24, p-16, gap-12
```

### 字号刻度
```
移动端：text-3xl, text-base
桌面端 (md:)：text-5xl, text-lg
```

补充：移动端纵向堆叠 `flex-col`，桌面端横向排列 `md:flex-row`；可交互元素触控目标不小于 44px。

---

## 自检清单

输出代码前，请核对以下各项：
- [ ] 没有任何阴影（零 shadow-* 类）
- [ ] 没有任何渐变（零 bg-gradient-* 类）
- [ ] 颜色保持纯粹（除刻意弱化文字外没有透明度）
- [ ] 圆角保持一致（全部锐利或全部圆形）
- [ ] 留白充足（区块间距 space-y-12 以上）
- [ ] hover 使用颜色反转（背景互换，而非 translate/scale）
- [ ] 过渡瞬时或极短（transition-none 或 duration-75）
- [ ] 保持高对比度（黑白 + 一个强调色）
- [ ] 文字色彩对比度符合 WCAG 2.1 AA 标准（正文对比度不低于 4.5:1）
- [ ] 所有动效都尊重 prefers-reduced-motion
```

---

## 十、必须包含项与示例提示词

- **button** 必须含：`border-2 border-black` · `font-medium` · `hover:bg-black hover:text-white` · `transition-colors duration-200`
- **card** 必须含：`border-2 border-black` · `hover:bg-black hover:text-white` · `transition-colors duration-200`
- **input** 必须含：`border-0 border-b-2 border-black` · `bg-transparent` · `focus:outline-none` · `focus:border-[#ff3366]` · `transition-colors duration-200`

示例提示词（源 `examplePrompts`）：

1. **Portfolio**（Designer Portfolio）—— 生成极简设计师作品集
   ```text
   Create a designer portfolio using Minimalist Flat style:
- Full-screen hero with name and title
- Grid of project cards with hover color inversion
- No shadows, no gradients
- Black and white with one accent color
- Large typography for headings
- Generous whitespace between sections
   ```
2. **SaaS 着陆页**（SaaS Landing Page）—— 生成 极简扁平风风格的 SaaS 产品着陆页
   ```text
   Create a SaaS landing page using Minimalist Flat style with hero section, feature grid, testimonials, pricing table, and footer.
   ```
3. **作品集展示**（Portfolio Showcase）—— 生成 极简扁平风风格的作品集页面
   ```text
   Create a portfolio showcase page using Minimalist Flat style with project grid, about section, contact form, and consistent visual language.
   ```

---

## 十一、token 配方总表（源 `minimalist-flat-tokens.ts`，Tailwind 类名字符串）

> 这些是**类名配方**而非 CSS 变量——stylekit 的 token 层就是"每个视觉位该用哪些 Tailwind 类"。
> 同目录 `tokens.css` 是该风格 `globalCss` 里的 CSS 变量与工具类（已做一致性清洗）；
> `design-tokens.json` 是扁平 key-value 形式，便于按需注入。

| 项 | 值 |
|---|---|
| 边框宽度 / 颜色 / 圆角 / 风格 | border-2 · border-black · rounded-none · border-solid |
| 阴影 sm / md / lg / none | shadow-none · shadow-none · shadow-none · shadow-none |
| 阴影 hover / focus | shadow-none · shadow-none |
| 过渡 / 按下态 | transition-colors duration-200 · active:opacity-80 |
| 标题字体 / 正文字体 / 等宽字体 | font-bold tracking-tight · font-sans · font-mono |
| 字号 · hero | text-4xl md:text-6xl lg:text-8xl |
| 字号 · h1 | text-3xl md:text-5xl |
| 字号 · h2 | text-2xl md:text-3xl |
| 字号 · h3 | text-lg md:text-xl |
| 字号 · body | text-sm md:text-base |
| 字号 · small | text-xs md:text-sm |
| 区块间距 / 容器内边距 / 卡片内边距 | py-16 md:py-24 lg:py-32 · px-4 md:px-8 lg:px-16 · p-6 md:p-8 |
| 间距 · sm | gap-4 md:gap-6 |
| 间距 · md | gap-6 md:gap-8 |
| 间距 · lg | gap-8 md:gap-12 |
| 底色 主 / 次 | bg-white · bg-black |
| 底色 · 强调 | bg-[#ff3366] · bg-[#00d4aa] · bg-[#ffcc00] |
| 文字 主 / 次 / 弱 | text-black · text-white · text-gray-500 |
| 按钮 · primary | bg-black text-white border-2 border-black |
| 按钮 · secondary | bg-white text-black border-2 border-black |
| 按钮 · danger | bg-[#ff3366] text-white border-2 border-[#ff3366] |
| 必须包含 · button | border-2 border-black · font-medium · hover:bg-black hover:text-white · transition-colors duration-200 |
| 必须包含 · card | border-2 border-black · hover:bg-black hover:text-white · transition-colors duration-200 |
| 必须包含 · input | border-0 border-b-2 border-black · bg-transparent · focus:outline-none · focus:border-[#ff3366] · transition-colors duration-200 |

---

## 十二、来源与许可

- 素材仓库：AnxForever/**stylekit**（MIT License, © 2026 AnxForever）
- 源文件：`lib/styles/minimalist-flat.ts`、`lib/styles/minimalist-flat-tokens.ts`
- 转换脚本：`D:\项目\scripts\convert-stylekit-systems.mjs`（一次性、可复跑）
- 局部改动：按 `aiRules` 剔除 `globalCss` 中的矛盾项（见第八节），其余内容保持源样。
- 注意：源仓库的 `components` 字段含可复制的 JSX 组件代码模板，本轮**未纳入**设计系统格式（本项目格式无组件槽位）。
