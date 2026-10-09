---
name: 装饰艺术风格（Art Deco）
description: 1920-30年代的奢华设计风格，几何对称图案、金色装饰、优雅线条和高端质感，传达精致与繁荣。
triggers:
  - 装饰艺术风格
  - Art Deco
  - 装饰艺术
  - 奢华
  - 金色
  - 几何
  - 1920年代
  - 优雅
od:
  category: style-retro
---

# 装饰艺术风格（Art Deco）

## 一、一句话定位

1920-30年代的奢华设计风格，几何对称图案、金色装饰、优雅线条和高端质感，传达精致与繁荣。

- 英文名：**Art Deco**
- 风格类型：`visual`（视觉风格：靠色彩/材质/字体塑造）
- 关键词：装饰艺术、奢华、金色、几何、1920年代、优雅、高端、retro、vintage、nostalgic
- 适用场景提示：装饰艺术：对称几何、金属线条、奢华秩序
- 源风格分类：`retro`

---

## 二、设计哲学（源 `philosophy` 字段）

Art Deco（装饰艺术）是1920-30年代流行的设计风格，融合了现代主义的几何形式与传统工艺的奢华感。

核心理念：
- 几何对称：放射状线条、重复几何图案
- 奢华感：金色、黑色、深蓝的高端配色
- 精致工艺：细腻的线条和装饰细节
- 现代与传统：机械时代美学与古典优雅的结合

> ⚠️ 已剔除 5 句跨风格重复的通用模板句（判定标准：在 ≥10 套风格里逐字重复）。被剔除的是「视觉一致性：所有组件必须遵循统一的视觉语言，从色彩到…」「层次分明：通过颜色深浅、字号大小、留白空间建立清晰的…」「交互反馈：每个可交互元素都必须有明确的 hover、…」「响应式适配：设计必须在移动端、平板、桌面端上保持一致…」「无障碍性：确保色彩对比度符合 WCAG 2.1 AA…」这类与具体风格无关的套话，保留的是该风格独有的美学主张。

---

## 三、色彩逻辑

| 项 | 值 |
|---|---|
| 主色 primary | `#d4af37` |
| 辅色 secondary | `#1a1a2e` |
| 强调色 accent | `#c9a227`、`#2d2d44`、`#f5f5dc`、`#4bc542` |

配套的 Tailwind 类名配方（来自 `art-deco-tokens.ts`）：

- 底色 主 / 次：bg-[#1a1a2e] · bg-[#0f0f1a]
- 底色 强调：bg-[#d4af37] · bg-[#c9a832] · bg-[#2c2c54] · bg-[#8b6914]
- 文字 主 / 次 / 弱：text-[#d4af37] · text-[#f0e6d0] · text-[#8a7a5a]

**用色纪律**（源 `doList` 中与颜色相关的条目）：

- 使用金色和深色的高对比配色
- 添加金色边框和装饰线

---

## 四、字体性格

- 标题：font-serif font-bold tracking-widest uppercase
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
| 边框 | `border-2 border-solid border-[#d4af37]` |

| 项 | 值 |
|---|---|
| 区块间距 section | `py-16 md:py-28 lg:py-36` |
| 容器内边距 container | `px-6 md:px-12 lg:px-20` |
| 卡片内边距 card | `p-6 md:p-10` |
| 间距 gap · sm | `gap-3 md:gap-5` |
| 间距 gap · md | `gap-5 md:gap-8` |
| 间距 gap · lg | `gap-8 md:gap-12` |

---

## 六、交互、阴影与状态

| 项 | 值 |
|---|---|
| 过渡 | `transition-all duration-400 ease-in-out` |
| 按下态 | `active:opacity-80` |
| 阴影 sm / md / lg / none | `shadow-[0_2px_4px_rgba(212,175,55,0.15)]` · `shadow-[0_4px_12px_rgba(212,175,55,0.2)]` · `shadow-[0_8px_24px_rgba(212,175,55,0.25)]` · `shadow-none` |
| 阴影 hover / focus | `hover:shadow-[0_6px_20px_rgba(212,175,55,0.3)]` · `focus:shadow-[0_4px_16px_rgba(212,175,55,0.25)]` |
| 彩色阴影 | gold: `shadow-[0_4px_16px_rgba(212,175,55,0.3)]` · navy: `shadow-[0_4px_16px_rgba(26,26,46,0.3)]` |

---

## 七、禁忌（源 `forbidden` 字段，含**为什么**禁）

> 这一节是 stylekit 最有价值的资产之一：它不仅列出禁用项，还给出了理由。理由直接来自源数据，
> 未做改写，便于直接喂给模型做生成后自检。

| 项 | 值 |
|---|---|
| `font-sans` | Art Deco uses serif typography for elegance (font-serif) |
| `rounded-xl` | Art Deco uses sharp geometric corners (rounded-none) |
| `bg-pink-500` | Art Deco uses gold, navy and deep warm tones, not bright neons |
| `text-cyan-400` | Art Deco uses gold and cream text, not neon colors |
| 其他禁用类名 | `font-mono`、`rounded-lg`、`rounded-2xl`、`rounded-full`、`bg-[#ff71ce]`、`bg-[#01cdfe]`、`bg-[#ff69b4]`、`bg-[#00ff00]`、`text-[#ff71ce]`、`text-[#01cdfe]`、`text-[#ff69b4]`、`border-[#ff71ce]`、`border-[#01cdfe]` |
| 其他禁用正则 | `^font-(?:sans\|mono)$`、`^rounded-(?:lg\|xl\|2xl\|3xl\|full)$`、`^bg-(?:pink\|cyan\|lime\|green)-`、`^text-(?:pink\|cyan\|lime\|green)-` |

另外，源 `dontList` 以自然语言补充：

- 禁止使用过于鲜艳的配色
- 禁止使用不对称的混乱布局
- 禁止使用过于现代的无衬线字体
- 禁止省略装饰性元素

---

## 八、一致性清洗记录

本套风格的 `globalCss` 未发现与 `aiRules` 自相矛盾之处，**未做剔除**。

本套风格未推导出任何整类禁令（其 `forbidden` 只针对具体类名，不做整类剔除），因此 **`globalCss` 未做整类剔除**。

---

## 九、AI 硬规则（源 `aiRules` 全文，生成时应逐条遵守）

```text
你是一个 Art Deco 设计风格的前端开发专家。生成的所有代码必须严格遵守以下约束：

## 绝对禁止

- 使用过于鲜艳的现代配色
- 使用不对称的混乱布局
- 使用圆润的现代字体
- 省略装饰性边框和线条

## 必须遵守

- 金色配色 text-yellow-500, border-yellow-500
- 深色背景 bg-slate-900, bg-slate-800
- 衬线字体 font-serif
- 宽字距 tracking-wider, tracking-[0.3em]
- 对称布局和居中对齐
- 几何装饰元素

## 配色

主色调：
- 金色: #d4af37, text-yellow-500, border-yellow-500
- 深蓝: #1a1a2e, bg-slate-900
- 海军蓝: #2d2d44, bg-slate-800
- 奶油色: #f5f5dc

## 装饰元素

- 角落装饰边框
- 放射状线条
- 渐变分隔线
- 几何图案

## Animation & Interaction Rules

- Elegant & Slow: 动画必须显得高贵从容。使用较长持续时间，如 `duration-500` 或 `duration-700`，绝不能有急促弹跳感。
- Golden Shimmer: 悬停时，通过背景渐变位置移动（如 `bg-[length:200%_auto] hover:bg-right`）模拟黄金材质反光与流泽。
- Symmetrical Expansion: 交互时，尽量保持对称性。例如悬停卡片时，四角装饰线框可以产生向外轻微扩张（通过 `group-hover:translate` 实现）。
- Subtle Lift: 采用极轻微上浮和金色光晕放大效果。

## Layout & Spacing
- Section padding: py-16 md:py-24
- Card padding: p-6 md:p-8
- Gap between cards: gap-6 md:gap-8
- Max content width: max-w-6xl mx-auto

## Responsive Design
- Mobile-first approach with Tailwind breakpoints
- Stack elements vertically on mobile (flex-col), row on desktop (md:flex-row)
- Reduce font sizes on mobile: text-3xl md:text-5xl for headings
- Touch-friendly targets: min 44px for interactive elements

## Self-Check Verification
After generating code, verify:
1. All interactive elements have hover/focus/active states
2. Color contrast meets WCAG 2.1 AA (4.5:1 for text)
3. Layout is responsive across breakpoints
4. Typography hierarchy is clear (h1 > h2 > h3 > body)
5. Spacing is consistent using the defined scale
6. All animations respect prefers-reduced-motion
```

---

## 十、必须包含项与示例提示词

- **button** 必须含：`rounded-none` · `border-2 border-[#d4af37]` · `font-serif font-bold tracking-widest uppercase` · `transition-all duration-400 ease-in-out`
- **card** 必须含：`rounded-none` · `border-2 border-[#d4af37]` · `bg-[#1a1a2e]` · `shadow-[0_4px_12px_rgba(212,175,55,0.2)]`
- **input** 必须含：`rounded-none` · `border-2 border-[#d4af37]` · `bg-[#0f0f1a]` · `text-[#f0e6d0]` · `font-serif` · `focus:shadow-[0_4px_16px_rgba(212,175,55,0.25)]` · `focus:outline-none`

示例提示词（源 `examplePrompts`）：

1. **奢侈品牌官网**（Luxury Brand Website）—— 高端奢华的品牌网站
   ```text
   用 Art Deco 风格创建一个奢侈品牌官网，要求：
1. 背景：深色渐变
2. 标题：金色衬线字体 + 宽字距
3. 装饰：放射状线条 + 角落边框
4. 按钮：金色边框 + 悬停填充
5. 整体对称优雅
   ```
2. **SaaS 着陆页**（SaaS Landing Page）—— 生成 装饰艺术风格风格的 SaaS 产品着陆页
   ```text
   Create a SaaS landing page using Art Deco style with hero section, feature grid, testimonials, pricing table, and footer.
   ```
3. **作品集展示**（Portfolio Showcase）—— 生成 装饰艺术风格风格的作品集页面
   ```text
   Create a portfolio showcase page using Art Deco style with project grid, about section, contact form, and consistent visual language.
   ```

---

## 十一、token 配方总表（源 `art-deco-tokens.ts`，Tailwind 类名字符串）

> 这些是**类名配方**而非 CSS 变量——stylekit 的 token 层就是"每个视觉位该用哪些 Tailwind 类"。
> 同目录 `tokens.css` 是该风格 `globalCss` 里的 CSS 变量与工具类（已做一致性清洗）；
> `design-tokens.json` 是扁平 key-value 形式，便于按需注入。

| 项 | 值 |
|---|---|
| 边框宽度 / 颜色 / 圆角 / 风格 | border-2 · border-[#d4af37] · rounded-none · border-solid |
| 阴影 sm / md / lg / none | shadow-[0_2px_4px_rgba(212,175,55,0.15)] · shadow-[0_4px_12px_rgba(212,175,55,0.2)] · shadow-[0_8px_24px_rgba(212,175,55,0.25)] · shadow-none |
| 阴影 hover / focus | hover:shadow-[0_6px_20px_rgba(212,175,55,0.3)] · focus:shadow-[0_4px_16px_rgba(212,175,55,0.25)] |
| 彩色阴影 | gold: shadow-[0_4px_16px_rgba(212,175,55,0.3)] · navy: shadow-[0_4px_16px_rgba(26,26,46,0.3)] |
| 过渡 / 按下态 | transition-all duration-400 ease-in-out · active:opacity-80 |
| 标题字体 / 正文字体 / 等宽字体 | font-serif font-bold tracking-widest uppercase · font-serif · font-mono |
| 字号 · hero | text-4xl md:text-6xl lg:text-7xl |
| 字号 · h1 | text-3xl md:text-5xl |
| 字号 · h2 | text-2xl md:text-3xl |
| 字号 · h3 | text-lg md:text-xl |
| 字号 · body | text-sm md:text-base |
| 字号 · small | text-xs md:text-sm |
| 区块间距 / 容器内边距 / 卡片内边距 | py-16 md:py-28 lg:py-36 · px-6 md:px-12 lg:px-20 · p-6 md:p-10 |
| 间距 · sm | gap-3 md:gap-5 |
| 间距 · md | gap-5 md:gap-8 |
| 间距 · lg | gap-8 md:gap-12 |
| 底色 主 / 次 | bg-[#1a1a2e] · bg-[#0f0f1a] |
| 底色 · 强调 | bg-[#d4af37] · bg-[#c9a832] · bg-[#2c2c54] · bg-[#8b6914] |
| 文字 主 / 次 / 弱 | text-[#d4af37] · text-[#f0e6d0] · text-[#8a7a5a] |
| 按钮 · primary | bg-[#d4af37] text-[#1a1a2e] |
| 按钮 · secondary | bg-transparent text-[#d4af37] border-2 border-[#d4af37] |
| 按钮 · danger | bg-[#8b0000] text-[#f0e6d0] |
| 必须包含 · button | rounded-none · border-2 border-[#d4af37] · font-serif font-bold tracking-widest uppercase · transition-all duration-400 ease-in-out |
| 必须包含 · card | rounded-none · border-2 border-[#d4af37] · bg-[#1a1a2e] · shadow-[0_4px_12px_rgba(212,175,55,0.2)] |
| 必须包含 · input | rounded-none · border-2 border-[#d4af37] · bg-[#0f0f1a] · text-[#f0e6d0] · font-serif · focus:shadow-[0_4px_16px_rgba(212,175,55,0.25)] · focus:outline-none |

---

## 十二、来源与许可

- 素材仓库：AnxForever/**stylekit**（MIT License, © 2026 AnxForever）
- 源文件：`lib/styles/art-deco.ts`、`lib/styles/art-deco-tokens.ts`
- 转换脚本：`D:\项目\scripts\convert-stylekit-systems.mjs`（一次性、可复跑）
- 局部改动：按 `aiRules` 剔除 `globalCss` 中的矛盾项（见第八节），其余内容保持源样。
- 注意：源仓库的 `components` 字段含可复制的 JSX 组件代码模板，本轮**未纳入**设计系统格式（本项目格式无组件槽位）。
