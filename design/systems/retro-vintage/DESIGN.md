---
name: 复古怀旧风（Retro Vintage）
description: 怀旧复古的设计风格，老式排版、复古色调、手工质感元素。适合咖啡馆、复古品牌、独立杂志、音乐厂牌。
triggers:
  - 复古怀旧风
  - Retro Vintage
  - 复古
  - 怀旧
  - 老式
  - 手工
  - 咖啡馆
  - 独立
od:
  category: style-retro
---

# 复古怀旧风（Retro Vintage）

## 一、一句话定位

怀旧复古的设计风格，老式排版、复古色调、手工质感元素。适合咖啡馆、复古品牌、独立杂志、音乐厂牌。

- 英文名：**Retro Vintage**
- 风格类型：`visual`（视觉风格：靠色彩/材质/字体塑造）
- 关键词：复古、怀旧、老式、手工、咖啡馆、独立、文艺、retro、vintage、nostalgic
- 适用场景提示：复古怀旧：做旧纸张、褪色印刷色
- 源风格分类：`retro`

---

## 二、设计哲学（源 `philosophy` 字段）

Retro Vintage 风格从20世纪中期的设计美学中汲取灵感，通过复古排版、做旧纹理和怀旧色调创造温暖的时光感。

核心理念：
- 时光沉淀：设计带有岁月的温度和故事
- 手工温度：避免过于数字化的冷感
- 经典永恒：使用经过时间检验的设计元素
- 文化底蕴：传达历史感和文化认同

> ⚠️ 已剔除 5 句跨风格重复的通用模板句（判定标准：在 ≥10 套风格里逐字重复）。被剔除的是「视觉一致性：所有组件必须遵循统一的视觉语言，从色彩到…」「层次分明：通过颜色深浅、字号大小、留白空间建立清晰的…」「交互反馈：每个可交互元素都必须有明确的 hover、…」「响应式适配：设计必须在移动端、平板、桌面端上保持一致…」「无障碍性：确保色彩对比度符合 WCAG 2.1 AA…」这类与具体风格无关的套话，保留的是该风格独有的美学主张。

---

## 三、色彩逻辑

| 项 | 值 |
|---|---|
| 主色 primary | `#8b4513` |
| 辅色 secondary | `#f5e6d3` |
| 强调色 accent | `#c94c4c`、`#2e4a3f`、`#d4a373`、`#816904` |

配套的 Tailwind 类名配方（来自 `retro-vintage-tokens.ts`）：

- 底色 主 / 次：bg-[#f5e6d3] · bg-[#e8d5c0]
- 底色 强调：bg-[#c94c4c] · bg-[#2e4a3f] · bg-[#d4a373]
- 文字 主 / 次 / 弱：text-[#8b4513] · text-[#f5e6d3] · text-[#8b4513]/60

**用色纪律**（源 `doList` 中与颜色相关的条目）：

- 使用复古色调 sepia, amber, brown 系列
- Ink & Oxidation: hover slightly darkens background (`hover:bg-[#eedbc2]`) and deepens text (`group-hover:text-[#5c2e0a]`) — simulating paper yellowing and ink settling over decades

---

## 四、字体性格

- 标题：font-serif uppercase tracking-widest
- 正文：font-serif
- 等宽：font-mono

字号阶梯：

| 项 | 值 |
|---|---|
| `hero` | `text-4xl md:text-6xl lg:text-7xl` |
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
| 边框 | `border-2 border-solid border-[#8b4513]` |

| 项 | 值 |
|---|---|
| 区块间距 section | `py-14 md:py-24 lg:py-32` |
| 容器内边距 container | `px-6 md:px-10 lg:px-16` |
| 卡片内边距 card | `p-6 md:p-8` |
| 间距 gap · sm | `gap-3 md:gap-5` |
| 间距 gap · md | `gap-5 md:gap-8` |
| 间距 gap · lg | `gap-8 md:gap-12` |

---

## 六、交互、阴影与状态

| 项 | 值 |
|---|---|
| 过渡 | `transition-colors duration-200` |
| 按下态 | `active:opacity-75` |
| 阴影 sm / md / lg / none | `shadow-[0_2px_4px_rgba(139,69,19,0.1)]` · `shadow-[0_4px_8px_rgba(139,69,19,0.15)]` · `shadow-[0_8px_16px_rgba(139,69,19,0.2)]` · `shadow-none` |
| 阴影 hover / focus | `hover:shadow-[0_4px_12px_rgba(139,69,19,0.2)]` · `focus:shadow-[0_2px_8px_rgba(139,69,19,0.15)]` |
| 彩色阴影 | brown: `shadow-[0_4px_12px_rgba(139,69,19,0.2)]` · rust: `shadow-[0_4px_12px_rgba(201,76,76,0.2)]` |

---

## 七、禁忌（源 `forbidden` 字段，含**为什么**禁）

> 这一节是 stylekit 最有价值的资产之一：它不仅列出禁用项，还给出了理由。理由直接来自源数据，
> 未做改写，便于直接喂给模型做生成后自检。

| 项 | 值 |
|---|---|
| `bg-gradient-to-r` | Retro Vintage uses solid vintage tones, not modern gradients |
| `rounded-xl` | Retro Vintage uses minimal rounding to maintain classic feel |
| `bg-[#ff00ff]` | Retro Vintage uses warm brown/cream palette, not neon colors |
| `shadow-[0_0_` | Retro Vintage avoids neon glow shadows |
| `font-sans` | Retro Vintage uses serif typography (font-serif) |
| `bg-white` | Retro Vintage uses cream/parchment (#f5e6d3), not pure white |
| 其他禁用类名 | `bg-gradient-to-b`、`bg-gradient-to-l`、`rounded-2xl`、`rounded-full`、`bg-[#00ffff]`、`bg-[#ff71ce]`、`text-[#ff00ff]`、`text-[#00ffff]`、`backdrop-blur` |
| 其他禁用正则 | `^bg-gradient-`、`^rounded-(?:xl\|2xl\|3xl\|full)$`、`^bg-(?:pink\|cyan\|violet\|fuchsia)-`、`^text-(?:pink\|cyan\|violet\|fuchsia)-`、`^shadow-\[0_0_`、`^backdrop-blur` |

另外，源 `dontList` 以自然语言补充：

- 禁止使用现代渐变效果
- 禁止使用霓虹/高饱和度颜色
- 禁止使用极简/扁平的现代设计语言
- 禁止使用过于圆润的圆角
- 禁止使用玻璃态效果
- 禁止使用动效过多的交互
- 禁止使用任何 `scale` 或 `translate-y` 动画（Antique Stillness — 旧纸张不会浮起或弹跳）
- 禁止使用 `duration-150` 或更快的过渡（Slow Passage — 氧化是地质过程，不是点击事件）
- 禁止 hover 时引入新的饱和颜色（只能加深现有的复古色调，不能替换为现代色）

---

## 八、一致性清洗记录

源仓库的 `globalCss` 里存在与本风格 `aiRules` 直接冲突的模板残留，已按**以 aiRules 为准**剔除下列 7 项（原始素材保留在仓库中未改动）：

| 项 | 值 |
|---|---|
| `@keyframes retro-vintage-fade-in` | transform 位移/缩放（aiRules 禁位移缩放） |
| `.retro-vintage-gradient` | 渐变（aiRules 禁渐变） |
| `.retro-vintage-gradient-text` | 渐变（aiRules 禁渐变） |
| `.retro-vintage-frosted` | 玻璃态 backdrop-filter（aiRules 禁玻璃态） |
| `.retro-vintage-animate-in 的 animation 声明` | 引用了已删除的 @keyframes retro-vintage-fade-in |
| `@media (min-width: 768px) 的 transition 中的 transform/box-shadow` | aiRules 禁位移缩放、禁阴影 |
| `@media print` | 玻璃态 backdrop-filter（aiRules 禁玻璃态） |

### 禁令推导依据

从本套的 `forbidden` 与 `aiRules` 推导出 **3 条整类禁令**（`gradient`、`glass`、`transform`），依据如下：

| 项 | 值 |
|---|---|
| `gradient` | forbidden.patterns 含整类渐变禁令 `^bg-gradient-` |
| `glass` | 直接禁令句：「禁止使用玻璃态效果」 |
| `transform` | 直接禁令句：「禁止使用任何 `scale` 或 `translate-y` 动画（Antique Stillness — 旧纸张不会浮起或弹跳）」 |

### 转换附带处理

- 去掉 1 处 `@layer` 包装（剥离 Tailwind 后该语法无意义，留着会被浏览器整块忽略）

---

## 九、AI 硬规则（源 `aiRules` 全文，生成时应逐条遵守）

```text
风格：Retro Vintage（复古怀旧风）
类型：怀旧经典的设计美学

必须使用：
- 复古配色：棕褐色、琥珀色、棕色调
- 背景使用纸张纹理或做旧效果
- 衬线字体或复古无衬线字体
- 粗边框：border-2 或 border-4
- 装饰性元素（角部装饰、分隔线）
- 旧式排版：大写字母、tracking-widest
- 图片滤镜：sepia、brightness-90

必须避免：
- 现代渐变
- 霓虹色/高饱和度色彩
- 极简/扁平化的现代设计
- 过大的圆角
- 玻璃拟态效果
- 厚重的动画

配色方案：
- 主色：鞍棕色（#8b4513）
- 背景：奶油色/羊皮纸色（#f5e6d3）
- 强调色：铁锈红（#c94c4c）、森林绿（#2e4a3f）

字体排版：
- 标题：font-serif，可选大写
- 标签：text-xs uppercase tracking-[0.2em]
- 正文：font-serif，宽松行距

## 动效与交互规则

- 古董般的静止：绝对不使用任何 `scale` 或 `translate-y` 动效。陈旧的羊皮纸平铺在桌面上——它不会漂浮、上升，也不会弹跳。禁止使用：`hover:-translate-y-*`、`hover:scale-*`。
- 墨迹与氧化：hover 时背景微妙地变暗（`hover:bg-[#eedbc2]`），文字颜色随之加深（`group-hover:text-[#5c2e0a]`）。这模拟的是纸张随时间泛黄、墨迹随时间加深的过程，而不是现代式的色彩切换。
- 缓慢的时间流逝：所有过渡效果必须使用 `duration-700 ease-in-out` 或更长时长。历史材质的变化是缓慢的，切勿使用 `duration-150` 或更快的时长。
- 边角显现：装饰性边角元素使用 `opacity-30 group-hover:opacity-100 transition-opacity duration-700`——仿佛读者需要凑近细看，才能发现隐藏的细节。
```

---

## 十、必须包含项与示例提示词

- **button** 必须含：`font-serif uppercase tracking-widest` · `transition-colors duration-200`
- **card** 必须含：`border-2 border-[#8b4513]` · `bg-[#f5e6d3]` · `font-serif`
- **input** 必须含：`border-2 border-[#8b4513]` · `bg-transparent` · `text-[#8b4513]` · `font-serif` · `focus:outline-none` · `focus:bg-[#8b4513]/5` · `transition-colors duration-200`

示例提示词（源 `examplePrompts`）：

1. **咖啡馆网站**（Coffee Shop Website）—— 生成复古咖啡馆网站
   ```text
   Create a coffee shop website using Retro Vintage style:
- Hero with sepia-toned coffee imagery
- Menu section with decorative borders
- About us with vintage typography
- Contact with old-style form styling
- Paper texture backgrounds
- Ornamental corner decorations
- Serif fonts throughout
   ```
2. **SaaS 着陆页**（SaaS Landing Page）—— 生成 复古怀旧风风格的 SaaS 产品着陆页
   ```text
   Create a SaaS landing page using Retro Vintage style with hero section, feature grid, testimonials, pricing table, and footer.
   ```
3. **作品集展示**（Portfolio Showcase）—— 生成 复古怀旧风风格的作品集页面
   ```text
   Create a portfolio showcase page using Retro Vintage style with project grid, about section, contact form, and consistent visual language.
   ```

---

## 十一、token 配方总表（源 `retro-vintage-tokens.ts`，Tailwind 类名字符串）

> 这些是**类名配方**而非 CSS 变量——stylekit 的 token 层就是"每个视觉位该用哪些 Tailwind 类"。
> 同目录 `tokens.css` 是该风格 `globalCss` 里的 CSS 变量与工具类（已做一致性清洗）；
> `design-tokens.json` 是扁平 key-value 形式，便于按需注入。

| 项 | 值 |
|---|---|
| 边框宽度 / 颜色 / 圆角 / 风格 | border-2 · border-[#8b4513] · rounded-none · border-solid |
| 阴影 sm / md / lg / none | shadow-[0_2px_4px_rgba(139,69,19,0.1)] · shadow-[0_4px_8px_rgba(139,69,19,0.15)] · shadow-[0_8px_16px_rgba(139,69,19,0.2)] · shadow-none |
| 阴影 hover / focus | hover:shadow-[0_4px_12px_rgba(139,69,19,0.2)] · focus:shadow-[0_2px_8px_rgba(139,69,19,0.15)] |
| 彩色阴影 | brown: shadow-[0_4px_12px_rgba(139,69,19,0.2)] · rust: shadow-[0_4px_12px_rgba(201,76,76,0.2)] |
| 过渡 / 按下态 | transition-colors duration-200 · active:opacity-75 |
| 标题字体 / 正文字体 / 等宽字体 | font-serif uppercase tracking-widest · font-serif · font-mono |
| 字号 · hero | text-4xl md:text-6xl lg:text-7xl |
| 字号 · h1 | text-3xl md:text-5xl |
| 字号 · h2 | text-2xl md:text-3xl |
| 字号 · h3 | text-lg md:text-xl |
| 字号 · body | text-sm md:text-base |
| 字号 · small | text-xs md:text-sm |
| 区块间距 / 容器内边距 / 卡片内边距 | py-14 md:py-24 lg:py-32 · px-6 md:px-10 lg:px-16 · p-6 md:p-8 |
| 间距 · sm | gap-3 md:gap-5 |
| 间距 · md | gap-5 md:gap-8 |
| 间距 · lg | gap-8 md:gap-12 |
| 底色 主 / 次 | bg-[#f5e6d3] · bg-[#e8d5c0] |
| 底色 · 强调 | bg-[#c94c4c] · bg-[#2e4a3f] · bg-[#d4a373] |
| 文字 主 / 次 / 弱 | text-[#8b4513] · text-[#f5e6d3] · text-[#8b4513]/60 |
| 按钮 · primary | bg-[#8b4513] text-[#f5e6d3] |
| 按钮 · secondary | bg-transparent text-[#8b4513] border-2 border-[#8b4513] |
| 按钮 · danger | bg-[#c94c4c] text-[#f5e6d3] |
| 必须包含 · button | font-serif uppercase tracking-widest · transition-colors duration-200 |
| 必须包含 · card | border-2 border-[#8b4513] · bg-[#f5e6d3] · font-serif |
| 必须包含 · input | border-2 border-[#8b4513] · bg-transparent · text-[#8b4513] · font-serif · focus:outline-none · focus:bg-[#8b4513]/5 · transition-colors duration-200 |

---

## 十二、来源与许可

- 素材仓库：AnxForever/**stylekit**（MIT License, © 2026 AnxForever）
- 源文件：`lib/styles/retro-vintage.ts`、`lib/styles/retro-vintage-tokens.ts`
- 转换脚本：`D:\项目\scripts\convert-stylekit-systems.mjs`（一次性、可复跑）
- 局部改动：按 `aiRules` 剔除 `globalCss` 中的矛盾项（见第八节），其余内容保持源样。
- 注意：源仓库的 `components` 字段含可复制的 JSX 组件代码模板，本轮**未纳入**设计系统格式（本项目格式无组件槽位）。
