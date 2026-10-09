---
name: 新野兽派（Neo-Brutalist）
description: 大胆的黑色粗边框、硬边缘阴影、无圆角、高对比度配色。源于建筑野兽派，强调功能与原始美学。
triggers:
  - 新野兽派
  - Neo-Brutalist
  - 粗边框
  - 硬阴影
  - 无圆角
  - 高对比
  - 功能主义
  - expressive
od:
  category: style-expressive
---

# 新野兽派（Neo-Brutalist）

## 一、一句话定位

大胆的黑色粗边框、硬边缘阴影、无圆角、高对比度配色。源于建筑野兽派，强调功能与原始美学。

- 英文名：**Neo-Brutalist**
- 风格类型：`visual`（视觉风格：靠色彩/材质/字体塑造）
- 关键词：粗边框、硬阴影、无圆角、高对比、功能主义、expressive、bold、vibrant、表现力、张力
- 适用场景提示：新野兽派：粗黑边框、硬边阴影、无圆角、高对比
- 源风格分类：`expressive`

---

## 二、设计哲学（源 `philosophy` 字段）

Neo-Brutalist（新野兽派）设计风格源于建筑领域的野兽派运动，强调原始、未经修饰的功能美学。在 Web 设计中，这种风格通过大胆的黑色边框、硬边缘阴影、锐利的直角和高对比度的配色方案来表达。

核心理念：
- 功能优先：每个元素都有明确的目的
- 诚实表达：不掩饰结构，不伪装功能
- 大胆直接：用视觉冲击力传达信息
- 反对圆滑：拒绝过度精致，拥抱粗犷

> ⚠️ 已剔除 5 句跨风格重复的通用模板句（判定标准：在 ≥10 套风格里逐字重复）。被剔除的是「视觉一致性：所有组件必须遵循统一的视觉语言，从色彩到…」「层次分明：通过颜色深浅、字号大小、留白空间建立清晰的…」「交互反馈：每个可交互元素都必须有明确的 hover、…」「响应式适配：设计必须在移动端、平板、桌面端上保持一致…」「无障碍性：确保色彩对比度符合 WCAG 2.1 AA…」这类与具体风格无关的套话，保留的是该风格独有的美学主张。

---

## 三、色彩逻辑

| 项 | 值 |
|---|---|
| 主色 primary | `#000000` |
| 辅色 secondary | `#ffffff` |
| 强调色 accent | `#ff006e`、`#ccff00`、`#00d9ff`、`#ff9500` |

配套的 Tailwind 类名配方（来自 `neo-brutalist-tokens.ts`）：

- 底色 主 / 次：bg-white · bg-black
- 底色 强调：bg-[#ff006e] · bg-[#ccff00] · bg-[#00d9ff] · bg-[#ff9500]
- 文字 主 / 次 / 弱：text-black · text-white · text-gray-700

**用色纪律**（源 `doList` 中与颜色相关的条目）：

- 使用高对比度配色（黑白为主 + 鲜艳强调色）
- Hover 时瞬间切换高对比背景色（如 hover:bg-[#ffff00]）并增大阴影（Brutal Snap，禁止使用渐变或 opacity 过渡）

---

## 四、字体性格

- 标题：font-black tracking-tight
- 正文：font-mono
- 等宽：font-mono

字号阶梯：

| 项 | 值 |
|---|---|
| `hero` | `text-4xl md:text-6xl lg:text-8xl` |
| `h1` | `text-3xl md:text-5xl` |
| `h2` | `text-2xl md:text-4xl` |
| `h3` | `text-xl md:text-2xl` |
| `body` | `text-sm md:text-base` |
| `small` | `text-xs md:text-sm` |

---

## 五、圆角与间距哲学

| 项 | 值 |
|---|---|
| 圆角 | `rounded-none` |
| 边框 | `border-2 md:border-4 border-solid border-black` |

| 项 | 值 |
|---|---|
| 区块间距 section | `py-12 md:py-24 lg:py-32` |
| 容器内边距 container | `px-4 md:px-8 lg:px-12` |
| 卡片内边距 card | `p-4 md:p-6` |
| 间距 gap · sm | `gap-2 md:gap-4` |
| 间距 gap · md | `gap-4 md:gap-6` |
| 间距 gap · lg | `gap-6 md:gap-8` |

---

## 六、交互、阴影与状态

| 项 | 值 |
|---|---|
| 过渡 | `transition-all duration-200` |
| 按下态 | `active:translate-x-[4px] active:translate-y-[4px]` |
| 阴影 sm / md / lg / none | `shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] md:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]` · `shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] md:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]` · `shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] md:shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]` · `shadow-none` |
| 阴影 hover / focus | `hover:shadow-none` · `focus:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] md:focus:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]` |
| 彩色阴影 | pink: `shadow-[4px_4px_0px_0px_rgba(255,0,110,1)] md:shadow-[8px_8px_0px_0px_rgba(255,0,110,1)]` · green: `shadow-[4px_4px_0px_0px_rgba(204,255,0,1)] md:shadow-[8px_8px_0px_0px_rgba(204,255,0,1)]` · blue: `shadow-[4px_4px_0px_0px_rgba(0,217,255,1)] md:shadow-[8px_8px_0px_0px_rgba(0,217,255,1)]` |

---

## 七、禁忌（源 `forbidden` 字段，含**为什么**禁）

> 这一节是 stylekit 最有价值的资产之一：它不仅列出禁用项，还给出了理由。理由直接来自源数据，
> 未做改写，便于直接喂给模型做生成后自检。

| 项 | 值 |
|---|---|
| `rounded-lg` | Neo-Brutalist uses sharp corners only (rounded-none) |
| `shadow-lg` | Neo-Brutalist uses hard-edge shadows only (shadow-[Xpx_Xpx_0px_0px_...]) |
| `bg-gradient-to-r` | Neo-Brutalist uses solid colors, no gradients |
| `border-gray-300` | Neo-Brutalist uses pure black borders (border-black) |
| 其他禁用类名 | `rounded-sm`、`rounded`、`rounded-md`、`rounded-xl`、`rounded-2xl`、`rounded-3xl`、`shadow-sm`、`shadow`、`shadow-md`、`shadow-xl`、`shadow-2xl`、`border-gray-100`、`border-gray-200`、`border-gray-400`、`border-gray-500`、`border-slate-100`、`border-slate-200`、`border-slate-300`、`border-slate-400`、`border-slate-500`、`opacity-50`、`opacity-75` |
| 其他禁用正则 | `^rounded-(?!none)`、`^shadow-(?!\[\|none)`、`^bg-gradient-`、`^border-gray-`、`^border-slate-` |

另外，源 `dontList` 以自然语言补充：

- 禁止使用圆角 rounded-lg, rounded-md, rounded-xl
- 禁止使用模糊阴影 shadow-lg, shadow-xl, shadow-2xl
- 禁止使用渐变 bg-gradient-*
- 禁止使用灰色边框 border-gray-*, border-slate-*
- 禁止使用淡入淡出的半透明效果
- 禁止使用 rounded-full（装饰圆除外）
- 禁止按钮 active 状态位移量小于原始阴影像素值（未完全压平，失去碾压感）
- 禁止 hover 背景色切换使用渐变或 opacity 过渡（必须是硬切，duration-150 ease-out）
- 禁止按钮 hover 时仅用位移替代阴影消失（hover 应增大阴影强调力量，active 才是完全压平）

---

## 八、一致性清洗记录

源仓库的 `globalCss` 里存在与本风格 `aiRules` 直接冲突的模板残留，已按**以 aiRules 为准**剔除下列 3 项（原始素材保留在仓库中未改动）：

| 项 | 值 |
|---|---|
| `.neo-brutalist-card::before` | 渐变（aiRules 禁渐变） |
| `.neo-brutalist-gradient` | 渐变（aiRules 禁渐变） |
| `.neo-brutalist-gradient-text` | 渐变（aiRules 禁渐变） |

### 禁令推导依据

从本套的 `forbidden` 与 `aiRules` 推导出 **1 条整类禁令**（`gradient`），依据如下：

| 项 | 值 |
|---|---|
| `gradient` | forbidden.patterns 含整类渐变禁令 `^bg-gradient-` |

---

## 九、AI 硬规则（源 `aiRules` 全文，生成时应逐条遵守）

```text
# Neo-Brutalist（新野兽派）设计系统

你是一个专精 Neo-Brutalist（新野兽派）网页设计的前端开发专家，生成的所有代码都必须严格遵循以下规范。

## 风格身份
- **名称**：Neo-Brutalist / Web Brutalism
- **类别**：表现力（Expressive）、高对比度（High-Contrast）
- **本质**：原始、诚实、不加掩饰——功能优先于形式，拒绝精致化
- **情绪基调**：大胆、对抗性强、顽劣中带侵略性、反企业气质
- **灵感来源**：建筑野兽派、朋克 zine 刊物、早期网页、瑞士海报设计

---

## 核心视觉原则

### 1. 边框系统（关键）
```
REQUIRED: Pure black borders
border-black border-2 md:border-4

NEVER use: border-gray-*, border-slate-*, border-neutral-*
```

### 2. 阴影系统（仅限硬边缘）
```
REQUIRED FORMAT:
shadow-[Xpx_Xpx_0px_0px_rgba(0,0,0,1)]

Examples:
Mobile: shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]
Desktop: shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]

FORBIDDEN: shadow-sm, shadow-md, shadow-lg, shadow-xl, shadow-2xl
(No blur allowed — hard edges only)
```

### 3. 圆角
```
REQUIRED: rounded-none
Sharp corners everywhere

FORBIDDEN: rounded-lg, rounded-md, rounded-xl, rounded-2xl
(Exception: rounded-full for intentional decorative circles only)
```

### 4. 字体排印
```
HEADINGS: font-black (900 weight)
BODY: font-mono
LABELS: font-mono uppercase tracking-wider
```

---

## 交互规范

### 按钮状态（Physical Crushing）
| 状态 | 效果 | 实现方式 |
|------|------|----------|
| Default | 带阴影浮起 | shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] |
| Hover | 阴影增大 + 偏移 | hover:shadow-[10px_10px_0px_0px...] hover:-translate-y-1 hover:-translate-x-1 |
| Active | 完全压平 | active:translate-x-[6px] active:translate-y-[6px] active:shadow-none |

**关键**：active 位移量必须等于原始阴影像素值，这样才能实现「physical crushing（实体压平）」效果——按钮被完整地压入表面。

### 卡片 Hover（Brutal Snap）
```jsx
<div className="group bg-white border-4 border-black
  shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]
  hover:shadow-[12px_12px_0px_0px_rgba(255,0,110,1)]
  hover:-translate-y-1 hover:-translate-x-1
  hover:bg-[#ffff00]
  transition-all duration-150 ease-out">
  ...
</div>
```

**关键**：hover 背景色切换必须是瞬间硬切，禁止渐变、禁止 opacity 淡出；duration-150 ease-out 仅用于位置和阴影的过渡。

---

## 动效规则

### 交互物理
- **Physical Crushing**：按钮 active 位移量必须等于阴影偏移量。以 6px 阴影为例：`active:translate-x-[6px] active:translate-y-[6px] active:shadow-none`。
- **Brutal Snap**：hover 时背景瞬间切换为高对比色，硬切、无渐隐：`hover:bg-[#ffff00]`
- **Zero Rounding Easing**：所有过渡统一使用 `ease-out duration-150`，保持生猛的碰撞质感，拒绝柔和的弹簧物理效果。
- **Heavy Focus**：卡片 hover 时阴影增大，同时阴影颜色切换为强调色（粉色/品红）。

### 时长指南
| 交互 | 时长 | 缓动 |
|------|------|------|
| Hover 位移变换 | 150ms | ease-out |
| Active 按压 | 瞬间 | — |
| 阴影变化 | 150ms | ease-out |
| 颜色瞬切 | 0ms | 瞬间 |

---

## 配色方案

### 主色
| Token | 值 | 用途 |
|-------|-----|------|
| 黑 | #000000 | 边框、文字、阴影 |
| 白 | #ffffff | 背景 |

### 强调色
| Token | 色值 | 用途 |
|-------|------|------|
| 粉色 | #ff006e | CTA、hover 效果 |
| 绿色 | #ccff00 | 成功状态、Hero 背景 |
| 蓝色 | #00d9ff | 链接、信息提示 |
| 黄色 | #ff9500 | 标签、警示 |
| 亮黄 | #ffff00 | hover 背景 |

### 阴影颜色
```
Default: rgba(0,0,0,1)
Hover accent: rgba(255,0,110,1)
```

---

## 字体排印

| 元素 | 类名 |
|------|------|
| H1 | font-black text-4xl md:text-6xl lg:text-8xl tracking-tight leading-tight |
| H2 | font-black text-2xl md:text-4xl |
| H3 | font-black text-xl md:text-2xl |
| 正文 | font-mono text-sm md:text-base leading-relaxed |
| 标签 | font-mono text-xs uppercase tracking-wider |
| CTA | font-black uppercase text-lg |

---

## 响应式指南

### 缩放比例
移动端数值约为桌面端数值的 50%。

### 边框
```
border-2 md:border-4
```

### 阴影
```
shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] 
md:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]
```

### 间距
```
p-4 md:p-8
py-12 md:py-24
gap-4 md:gap-8
```

### 字体排印
```
text-sm md:text-base
text-xl md:text-3xl
text-4xl md:text-6xl lg:text-8xl
```

---

## 组件模板

### 按钮
```jsx
<button className="
  bg-[#ff006e] text-white font-black uppercase text-lg
  px-8 py-4 border-4 border-black
  shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]
  hover:shadow-[10px_10px_0px_0px_rgba(0,0,0,1)]
  hover:-translate-y-1 hover:-translate-x-1
  active:translate-x-[6px] active:translate-y-[6px]
  active:shadow-none
  transition-all duration-150 ease-out">
  Click Hard
</button>
```

### 卡片
```jsx
<div className="group bg-white border-4 border-black
  shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]
  hover:shadow-[12px_12px_0px_0px_rgba(255,0,110,1)]
  hover:-translate-y-1 hover:-translate-x-1
  hover:bg-[#ffff00]
  transition-all duration-150 ease-out
  p-8 cursor-pointer">
  <h3 className="font-black text-xl mb-2 
    group-hover:tracking-wider transition-all duration-150">
    Neo-Brutalism
  </h3>
  <p className="font-mono text-base text-gray-700">
    Raw, bold, unapologetic design.
  </p>
</div>
```

---

## 禁止模式

| 模式 | 原因 |
|------|------|
| rounded-lg, rounded-md, rounded-xl | 软化了野兽派的锐利边缘 |
| shadow-lg, shadow-xl, shadow-2xl | 模糊违反了硬边缘原则 |
| bg-gradient-* | 渐变过于精致光滑 |
| border-gray-*, border-slate-* | 必须使用纯黑边框 |
| 淡入淡出/opacity 过渡 | 必须使用硬切换 |
| rounded-full（一般用途） | 仅限装饰性圆形 |
| Active 位移量 < 阴影像素值 | 无法实现完全压平的碾压感 |
| Hover opacity 淡出 | 必须瞬间切换到新颜色 |

---

## 自检清单

输出代码前，请核对以下各项：
- [ ] 没有圆角（有意为之的装饰性圆形除外）
- [ ] 阴影是硬边缘格式：shadow-[Xpx_Xpx_0px_0px_rgba...]
- [ ] 边框是纯黑色：border-black
- [ ] 按钮 active 位移量 = 原始阴影像素值
- [ ] hover 背景变化是瞬间完成的（硬切，无渐隐）
- [ ] 过渡统一使用 duration-150 ease-out
- [ ] 标题使用 font-black，正文使用 font-mono
- [ ] 边框、阴影、间距均带有响应式 md: 前缀
- [ ] 移动端数值 ≈ 桌面端数值的 50%
```

---

## 十、必须包含项与示例提示词

- **button** 必须含：`rounded-none` · `border-2 md:border-4` · `border-black` · `shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] md:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]` · `hover:shadow-none` · `hover:translate-x-[2px] hover:translate-y-[2px]` · `transition-all duration-200` · `font-black`
- **card** 必须含：`rounded-none` · `border-2 md:border-4` · `border-black` · `shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] md:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]` · `bg-white`
- **input** 必须含：`rounded-none` · `border-2 md:border-4` · `border-black` · `font-mono` · `focus:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]` · `focus:outline-none`

示例提示词（源 `examplePrompts`）：

1. **SaaS 产品着陆页**（SaaS Product Landing Page）—— 包含 Hero、特性卡片、定价表、CTA
   ```text
   用 Neo-Brutalist 风格生成一个 SaaS 产品着陆页，要求：
1. Hero 区域：大标题使用 font-black，鲜艳背景色（如 #ccff00），黑色粗边框按钮
2. 特性区域：3 个卡片，每个有硬边缘阴影，hover 时阴影变为粉色
3. 定价表：3 列，中间推荐列用强调色背景
4. CTA：全宽黑色背景，白色大标题，粉色按钮
所有元素必须：无圆角、黑色粗边框、硬边缘阴影、hover 位移效果
   ```
2. **博客文章页**（Blog Article Page）—— 包含标题、作者信息、正文、相关文章
   ```text
   用 Neo-Brutalist 风格创建一个博客文章页面，要求：
1. 顶部：超大标题 font-black，作者信息带头像
2. 正文：使用 font-mono，段落间距适中
3. 侧边栏：相关文章卡片，有硬边缘阴影
4. 分享按钮：图标按钮带黑色边框，hover 位移
所有元素遵循 Neo-Brutalist 规范：无圆角、纯黑边框、高对比配色
   ```
3. **作品集展示**（Portfolio Showcase）—— 网格布局展示项目作品
   ```text
   用 Neo-Brutalist 风格设计一个作品集页面，要求：
1. 导航栏：左侧 Logo 用 font-black，右侧链接 font-mono
2. Hero：个人介绍，使用鲜艳背景色块
3. 作品网格：2-3 列布局，每个卡片有缩略图和标题
4. 卡片效果：黑色粗边框，hover 时阴影变色 + 轻微上移
5. 联系区：简洁表单，输入框 focus 时出现硬阴影
   ```

---

## 十一、token 配方总表（源 `neo-brutalist-tokens.ts`，Tailwind 类名字符串）

> 这些是**类名配方**而非 CSS 变量——stylekit 的 token 层就是"每个视觉位该用哪些 Tailwind 类"。
> 同目录 `tokens.css` 是该风格 `globalCss` 里的 CSS 变量与工具类（已做一致性清洗）；
> `design-tokens.json` 是扁平 key-value 形式，便于按需注入。

| 项 | 值 |
|---|---|
| 边框宽度 / 颜色 / 圆角 / 风格 | border-2 md:border-4 · border-black · rounded-none · border-solid |
| 阴影 sm / md / lg / none | shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] md:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] · shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] md:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] · shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] md:shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] · shadow-none |
| 阴影 hover / focus | hover:shadow-none · focus:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] md:focus:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] |
| 彩色阴影 | pink: shadow-[4px_4px_0px_0px_rgba(255,0,110,1)] md:shadow-[8px_8px_0px_0px_rgba(255,0,110,1)] · green: shadow-[4px_4px_0px_0px_rgba(204,255,0,1)] md:shadow-[8px_8px_0px_0px_rgba(204,255,0,1)] · blue: shadow-[4px_4px_0px_0px_rgba(0,217,255,1)] md:shadow-[8px_8px_0px_0px_rgba(0,217,255,1)] |
| 过渡 / 按下态 | transition-all duration-200 · active:translate-x-[4px] active:translate-y-[4px] |
| 标题字体 / 正文字体 / 等宽字体 | font-black tracking-tight · font-mono · font-mono |
| 字号 · hero | text-4xl md:text-6xl lg:text-8xl |
| 字号 · h1 | text-3xl md:text-5xl |
| 字号 · h2 | text-2xl md:text-4xl |
| 字号 · h3 | text-xl md:text-2xl |
| 字号 · body | text-sm md:text-base |
| 字号 · small | text-xs md:text-sm |
| 区块间距 / 容器内边距 / 卡片内边距 | py-12 md:py-24 lg:py-32 · px-4 md:px-8 lg:px-12 · p-4 md:p-6 |
| 间距 · sm | gap-2 md:gap-4 |
| 间距 · md | gap-4 md:gap-6 |
| 间距 · lg | gap-6 md:gap-8 |
| 底色 主 / 次 | bg-white · bg-black |
| 底色 · 强调 | bg-[#ff006e] · bg-[#ccff00] · bg-[#00d9ff] · bg-[#ff9500] |
| 文字 主 / 次 / 弱 | text-black · text-white · text-gray-700 |
| 按钮 · primary | bg-[#ff006e] text-white |
| 按钮 · secondary | bg-black text-white |
| 按钮 · danger | bg-red-500 text-white |
| 必须包含 · button | rounded-none · border-2 md:border-4 · border-black · shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] md:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] · hover:shadow-none · hover:translate-x-[2px] hover:translate-y-[2px] · transition-all duration-200 · font-black |
| 必须包含 · card | rounded-none · border-2 md:border-4 · border-black · shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] md:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] · bg-white |
| 必须包含 · input | rounded-none · border-2 md:border-4 · border-black · font-mono · focus:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] · focus:outline-none |

---

## 十二、来源与许可

- 素材仓库：AnxForever/**stylekit**（MIT License, © 2026 AnxForever）
- 源文件：`lib/styles/neo-brutalist.ts`、`lib/styles/neo-brutalist-tokens.ts`
- 转换脚本：`D:\项目\scripts\convert-stylekit-systems.mjs`（一次性、可复跑）
- 局部改动：按 `aiRules` 剔除 `globalCss` 中的矛盾项（见第八节），其余内容保持源样。
- 注意：源仓库的 `components` 字段含可复制的 JSX 组件代码模板，本轮**未纳入**设计系统格式（本项目格式无组件槽位）。
