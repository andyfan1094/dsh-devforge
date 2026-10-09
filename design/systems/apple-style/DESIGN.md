---
name: Apple 风格（Apple Style）
description: 极致简约的高端设计风格，大量留白、精致圆角、微妙阴影和 SF Pro 风格字体，传达高端科技产品的品质感。
triggers:
  - Apple 风格
  - Apple Style
  - Apple
  - 极简
  - 高端
  - 科技
  - 产品
  - 留白
od:
  category: style-minimal
---

# Apple 风格（Apple Style）

## 一、一句话定位

极致简约的高端设计风格，大量留白、精致圆角、微妙阴影和 SF Pro 风格字体，传达高端科技产品的品质感。

- 英文名：**Apple Style**
- 风格类型：`visual`（视觉风格：靠色彩/材质/字体塑造）
- 关键词：Apple、极简、高端、科技、产品、留白、精致、minimal、clean、simple
- 适用场景提示：Apple 式：胶囊按钮、SF 字体度量、高级留白
- 源风格分类：`minimal`

---

## 二、设计哲学（源 `philosophy` 字段）

Apple Style 是一种源于 Apple 设计语言的极致简约风格，通过大量留白、精致的细节和克制的配色，传达高端科技产品的品质感和信任感。

核心理念：
- 极致简约：去除一切不必要的元素
- 大量留白：让内容呼吸，突出重点
- 精致细节：每个像素都经过精心设计
- 克制配色：黑白灰为主，蓝色点缀

> ⚠️ 已剔除 5 句跨风格重复的通用模板句（判定标准：在 ≥10 套风格里逐字重复）。被剔除的是「视觉一致性：所有组件必须遵循统一的视觉语言，从色彩到…」「层次分明：通过颜色深浅、字号大小、留白空间建立清晰的…」「交互反馈：每个可交互元素都必须有明确的 hover、…」「响应式适配：设计必须在移动端、平板、桌面端上保持一致…」「无障碍性：确保色彩对比度符合 WCAG 2.1 AA…」这类与具体风格无关的套话，保留的是该风格独有的美学主张。

---

## 三、色彩逻辑

| 项 | 值 |
|---|---|
| 主色 primary | `#000000` |
| 辅色 secondary | `#f5f5f7` |
| 强调色 accent | `#0071e3`、`#34c759`、`#ff3b30`、`#a13ff6` |

配套的 Tailwind 类名配方（来自 `apple-style-tokens.ts`）：

- 底色 主 / 次：bg-white · bg-[#f5f5f7]
- 底色 强调：bg-black · bg-[#0071e3]
- 文字 主 / 次 / 弱：text-black · text-gray-500 · text-gray-400

**用色纪律**（源 `doList` 中与颜色相关的条目）：

- 使用 Apple 蓝 #0071e3 作为强调色

---

## 四、字体性格

- 标题：font-semibold tracking-tight text-black
- 正文：text-gray-600
- 等宽：font-mono text-sm

字号阶梯：

| 项 | 值 |
|---|---|
| `hero` | `text-5xl md:text-7xl lg:text-8xl` |
| `h1` | `text-4xl md:text-5xl lg:text-6xl` |
| `h2` | `text-3xl md:text-4xl` |
| `h3` | `text-xl md:text-2xl` |
| `body` | `text-base md:text-lg` |
| `small` | `text-sm` |

---

## 五、圆角与间距哲学

| 项 | 值 |
|---|---|
| 圆角 | `rounded-2xl` |
| 边框 | `border-0 border-none border-gray-200` |

| 项 | 值 |
|---|---|
| 区块间距 section | `py-20 md:py-32` |
| 容器内边距 container | `px-6 md:px-8` |
| 卡片内边距 card | `p-8 md:p-12` |
| 间距 gap · sm | `gap-4` |
| 间距 gap · md | `gap-8` |
| 间距 gap · lg | `gap-12` |

---

## 六、交互、阴影与状态

| 项 | 值 |
|---|---|
| 过渡 | `transition-all duration-200` |
| 按下态 | `active:scale-95` |
| 阴影 sm / md / lg / none | `shadow-[0_2px_8px_rgba(0,0,0,0.04)]` · `shadow-[0_4px_12px_rgba(0,0,0,0.08)]` · `shadow-[0_8px_24px_rgba(0,0,0,0.12)]` · `shadow-none` |
| 阴影 hover / focus | `hover:shadow-[0_8px_24px_rgba(0,0,0,0.12)]` · `focus:shadow-[0_0_0_4px_rgba(0,113,227,0.3)]` |
| 彩色阴影 | — |

---

## 七、禁忌（源 `forbidden` 字段，含**为什么**禁）

> 这一节是 stylekit 最有价值的资产之一：它不仅列出禁用项，还给出了理由。理由直接来自源数据，
> 未做改写，便于直接喂给模型做生成后自检。

| 项 | 值 |
|---|---|
| `bg-gradient-to-r` | Apple style uses solid colors, not gradients |
| `shadow-2xl` | Apple style uses subtle, refined shadows |
| `border-2` | Apple style uses minimal or no borders |
| 其他禁用类名 | `bg-gradient-to-br`、`shadow-inner`、`border-4` |
| 其他禁用正则 | `^bg-gradient`、`^shadow-(?:2xl\|inner)`、`^border-(?:2\|4\|8)` |

另外，源 `dontList` 以自然语言补充：

- 禁止使用过多颜色
- 禁止使用渐变背景
- 禁止使用重阴影
- 禁止元素过于拥挤
- 禁止使用花哨的装饰

---

## 八、一致性清洗记录

源仓库的 `globalCss` 里存在与本风格 `aiRules` 直接冲突的模板残留，已按**以 aiRules 为准**剔除下列 3 项（原始素材保留在仓库中未改动）：

| 项 | 值 |
|---|---|
| `.apple-style-card::before` | 渐变（aiRules 禁渐变） |
| `.apple-style-gradient` | 渐变（aiRules 禁渐变） |
| `.apple-style-gradient-text` | 渐变（aiRules 禁渐变） |

### 禁令推导依据

从本套的 `forbidden` 与 `aiRules` 推导出 **1 条整类禁令**（`gradient`），依据如下：

| 项 | 值 |
|---|---|
| `gradient` | forbidden.patterns 含整类渐变禁令 `^bg-gradient` |

---

## 九、AI 硬规则（源 `aiRules` 全文，生成时应逐条遵守）

```text
你是一名专精 Apple Style 设计风格的前端开发专家。生成的所有代码都必须严格遵守以下约束：

## 绝对禁止

- 使用渐变背景
- 使用过多颜色（超过 3 种）
- 使用重阴影 shadow-xl, shadow-2xl
- 元素过于拥挤
- 使用花哨的装饰和动画

## 必须遵守

- 大量留白
- Apple 灰背景 bg-[#f5f5f7]
- Apple 蓝强调色 text-[#0071e3], bg-[#0071e3]
- 精致圆角 rounded-xl, rounded-2xl, rounded-full
- 微妙阴影 shadow-[0_4px_12px_rgba(0,0,0,0.08)]
- SF Pro 风格字体

## 配色方案

主色：
- 黑色：text-black, bg-black
- 白色：text-white, bg-white
- Apple 灰：bg-[#f5f5f7]

强调色：
- Apple 蓝：#0071e3
- Apple 绿：#34c759
- Apple 红：#ff3b30

## 字体排印

- 标题：font-semibold tracking-tight
- 正文：font-normal
- 链接：text-[#0071e3] hover:underline

## 布局

- 最大宽度：max-w-5xl 或 max-w-[980px]
- 大量留白：py-20, py-24
- 居中对齐：text-center, mx-auto

## 动效与交互规则

- Spring Physics（弹簧物理）：严禁使用默认的 linear 或基础 ease。必须使用丝滑的减速曲线，如 `transition-all duration-500 ease-[cubic-bezier(0.25,0.1,0.25,1)]`。
- Haptic Touch（触感反馈）：所有可交互元素（按钮、卡片）都必须具备物理按压的阻尼感，强制添加 `active:scale-[0.98]` 或 `active:scale-[0.96]`。
- Contextual Depth（情境纵深）：卡片悬停时，利用 `group-hover` 让内部图片或图标产生微妙放大（`scale-105`），营造视差纵深感。
- Subtle Blurs（微妙模糊）：交互过程可以伴随背景模糊度或不透明度的平滑过渡。

## 自检清单

每次生成代码后请检查：
1. 留白是否足够充分
2. 配色是否克制（黑白灰 + 蓝色点缀）
3. 是否没有使用渐变
4. 整体是否呈现高端简约的观感
```

---

## 十、必须包含项与示例提示词

- **button** 必须含：`px-6 py-3` · `bg-[#0071e3]` · `rounded-full` · `text-white font-medium` · `hover:bg-[#0077ed]` · `transition-colors duration-200`
- **card** 必须含：`bg-white` · `rounded-2xl` · `shadow-[0_4px_12px_rgba(0,0,0,0.08)]`
- **input** 必须含：`bg-[#f5f5f7]` · `rounded-xl` · `text-black placeholder-gray-400` · `focus:outline-none focus:ring-2 focus:ring-[#0071e3]` · `transition-all`

示例提示词（源 `examplePrompts`）：

1. **产品展示页**（Product Page）—— Apple 风格产品介绍
   ```text
   用 Apple Style 创建一个产品展示页面，要求：
1. Hero：全屏黑色背景，大标题居中，产品图片
2. 特性区：白色背景，大量留白，图文交替
3. 规格区：Apple 灰背景，简洁的参数列表
4. 购买区：价格、颜色选择、购买按钮
5. 整体：极简、高端、大量留白
   ```
2. **服务页面**（Services Page）—— Apple 风格服务介绍
   ```text
   用 Apple Style 设计一个服务介绍页面，要求：
1. 标题区：简洁有力的标题和副标题
2. 服务卡片：白色背景，圆角，微妙阴影
3. 定价区：清晰的价格对比
4. CTA：Apple 蓝按钮，圆角胶囊形状
5. 整体：专业、可信、简约
   ```
3. **作品集展示**（Portfolio Showcase）—— 生成 Apple 风格风格的作品集页面
   ```text
   Create a portfolio showcase page using Apple Style style with project grid, about section, contact form, and consistent visual language.
   ```

---

## 十一、token 配方总表（源 `apple-style-tokens.ts`，Tailwind 类名字符串）

> 这些是**类名配方**而非 CSS 变量——stylekit 的 token 层就是"每个视觉位该用哪些 Tailwind 类"。
> 同目录 `tokens.css` 是该风格 `globalCss` 里的 CSS 变量与工具类（已做一致性清洗）；
> `design-tokens.json` 是扁平 key-value 形式，便于按需注入。

| 项 | 值 |
|---|---|
| 边框宽度 / 颜色 / 圆角 / 风格 | border-0 · border-gray-200 · rounded-2xl · border-none |
| 阴影 sm / md / lg / none | shadow-[0_2px_8px_rgba(0,0,0,0.04)] · shadow-[0_4px_12px_rgba(0,0,0,0.08)] · shadow-[0_8px_24px_rgba(0,0,0,0.12)] · shadow-none |
| 阴影 hover / focus | hover:shadow-[0_8px_24px_rgba(0,0,0,0.12)] · focus:shadow-[0_0_0_4px_rgba(0,113,227,0.3)] |
| 过渡 / 按下态 | transition-all duration-200 · active:scale-95 |
| 标题字体 / 正文字体 / 等宽字体 | font-semibold tracking-tight text-black · text-gray-600 · font-mono text-sm |
| 字号 · hero | text-5xl md:text-7xl lg:text-8xl |
| 字号 · h1 | text-4xl md:text-5xl lg:text-6xl |
| 字号 · h2 | text-3xl md:text-4xl |
| 字号 · h3 | text-xl md:text-2xl |
| 字号 · body | text-base md:text-lg |
| 字号 · small | text-sm |
| 区块间距 / 容器内边距 / 卡片内边距 | py-20 md:py-32 · px-6 md:px-8 · p-8 md:p-12 |
| 间距 · sm | gap-4 |
| 间距 · md | gap-8 |
| 间距 · lg | gap-12 |
| 底色 主 / 次 | bg-white · bg-[#f5f5f7] |
| 底色 · 强调 | bg-black · bg-[#0071e3] |
| 文字 主 / 次 / 弱 | text-black · text-gray-500 · text-gray-400 |
| 按钮 · primary | bg-[#0071e3] text-white |
| 按钮 · secondary | bg-black text-white |
| 必须包含 · button | px-6 py-3 · bg-[#0071e3] · rounded-full · text-white font-medium · hover:bg-[#0077ed] · transition-colors duration-200 |
| 必须包含 · card | bg-white · rounded-2xl · shadow-[0_4px_12px_rgba(0,0,0,0.08)] |
| 必须包含 · input | bg-[#f5f5f7] · rounded-xl · text-black placeholder-gray-400 · focus:outline-none focus:ring-2 focus:ring-[#0071e3] · transition-all |

---

## 十二、来源与许可

- 素材仓库：AnxForever/**stylekit**（MIT License, © 2026 AnxForever）
- 源文件：`lib/styles/apple-style.ts`、`lib/styles/apple-style-tokens.ts`
- 转换脚本：`D:\项目\scripts\convert-stylekit-systems.mjs`（一次性、可复跑）
- 局部改动：按 `aiRules` 剔除 `globalCss` 中的矛盾项（见第八节），其余内容保持源样。
- 注意：源仓库的 `components` 字段含可复制的 JSX 组件代码模板，本轮**未纳入**设计系统格式（本项目格式无组件槽位）。
