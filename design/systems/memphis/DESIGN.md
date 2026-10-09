---
name: 孟菲斯风格（Memphis）
description: 80年代意大利设计运动，大胆的几何图形、鲜艳的撞色、不规则形状和有趣的图案，打破传统设计规则。
triggers:
  - 孟菲斯风格
  - Memphis
  - 孟菲斯
  - 几何
  - 撞色
  - 80年代
  - 波普
  - 图案
od:
  category: style-retro
---

# 孟菲斯风格（Memphis）

## 一、一句话定位

80年代意大利设计运动，大胆的几何图形、鲜艳的撞色、不规则形状和有趣的图案，打破传统设计规则。

- 英文名：**Memphis**
- 风格类型：`visual`（视觉风格：靠色彩/材质/字体塑造）
- 关键词：孟菲斯、几何、撞色、80年代、波普、图案、大胆、retro、vintage、nostalgic
- 适用场景提示：孟菲斯：80 年代几何图形与撞色拼贴
- 源风格分类：`retro`

---

## 二、设计哲学（源 `philosophy` 字段）

Memphis（孟菲斯）是1980年代由意大利设计师 Ettore Sottsass 创立的设计运动，以打破传统、拥抱混乱和趣味性著称。

核心理念：
- 反叛传统：打破功能主义的严肃设计
- 大胆撞色：鲜艳、对比强烈的色彩组合
- 几何图形：圆形、三角形、波浪线的自由组合
- 趣味性：设计应该有趣、令人愉悦

> ⚠️ 已剔除 5 句跨风格重复的通用模板句（判定标准：在 ≥10 套风格里逐字重复）。被剔除的是「视觉一致性：所有组件必须遵循统一的视觉语言，从色彩到…」「层次分明：通过颜色深浅、字号大小、留白空间建立清晰的…」「交互反馈：每个可交互元素都必须有明确的 hover、…」「响应式适配：设计必须在移动端、平板、桌面端上保持一致…」「无障碍性：确保色彩对比度符合 WCAG 2.1 AA…」这类与具体风格无关的套话，保留的是该风格独有的美学主张。

---

## 三、色彩逻辑

| 项 | 值 |
|---|---|
| 主色 primary | `#ff6b6b` |
| 辅色 secondary | `#feca57` |
| 强调色 accent | `#48dbfb`、`#ff9ff3`、`#1dd1a1`、`#5f27cd` |

配套的 Tailwind 类名配方（来自 `memphis-tokens.ts`）：

- 底色 主 / 次：bg-[#fef9ef] · bg-black
- 底色 强调：bg-[#ff6b6b] · bg-[#feca57] · bg-[#48dbfb] · bg-[#ff9ff3]
- 文字 主 / 次 / 弱：text-black · text-white · text-gray-600

**用色纪律**（源 `doList` 中与颜色相关的条目）：

- 使用鲜艳的撞色组合
- 标题和文字在 group-hover 时可瞬间切换高饱和撞色（Pop Swap，波普色彩反转），使用 transition-colors duration-150
- 按钮 hover 时换色并增大阴影：hover:bg-pink-400 hover:shadow-[8px_8px_0px_#000]（撞色波普强化）

---

## 四、字体性格

- 标题：font-black tracking-tight
- 正文：font-sans
- 等宽：font-mono

字号阶梯：

| 项 | 值 |
|---|---|
| `hero` | `text-5xl md:text-7xl lg:text-9xl` |
| `h1` | `text-4xl md:text-6xl` |
| `h2` | `text-3xl md:text-4xl` |
| `h3` | `text-xl md:text-2xl` |
| `body` | `text-sm md:text-base` |
| `small` | `text-xs md:text-sm` |

---

## 五、圆角与间距哲学

| 项 | 值 |
|---|---|
| 圆角 | `rounded-none` |
| 边框 | `border-4 border-solid border-black` |

| 项 | 值 |
|---|---|
| 区块间距 section | `py-12 md:py-24 lg:py-32` |
| 容器内边距 container | `px-4 md:px-8 lg:px-16` |
| 卡片内边距 card | `p-5 md:p-8` |
| 间距 gap · sm | `gap-3 md:gap-4` |
| 间距 gap · md | `gap-4 md:gap-6` |
| 间距 gap · lg | `gap-6 md:gap-10` |

---

## 六、交互、阴影与状态

| 项 | 值 |
|---|---|
| 过渡 | `transition-all duration-200` |
| 按下态 | `active:translate-x-[5px] active:translate-y-[5px]` |
| 阴影 sm / md / lg / none | `shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] md:shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]` · `shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] md:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]` · `shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] md:shadow-[12px_12px_0px_0px_rgba(0,0,0,1)]` · `shadow-none` |
| 阴影 hover / focus | `hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]` · `focus:shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]` |
| 彩色阴影 | coral: `shadow-[5px_5px_0px_0px_rgba(255,107,107,1)]` · yellow: `shadow-[5px_5px_0px_0px_rgba(254,202,87,1)]` · teal: `shadow-[5px_5px_0px_0px_rgba(72,219,251,1)]` |

---

## 七、禁忌（源 `forbidden` 字段，含**为什么**禁）

> 这一节是 stylekit 最有价值的资产之一：它不仅列出禁用项，还给出了理由。理由直接来自源数据，
> 未做改写，便于直接喂给模型做生成后自检。

| 项 | 值 |
|---|---|
| `border-gray-200` | Memphis uses thick black borders (border-4 border-black), not subtle grays |
| `shadow-md` | Memphis uses hard-edge offset shadows, not blurred shadows |
| `bg-gray-50` | Memphis uses bold vivid colors (coral, yellow, teal), not muted grays |
| `text-gray-400` | Memphis uses high-contrast text, not subtle muted text |
| 其他禁用类名 | `border`、`border-[0.5px]`、`border-gray-300`、`border-slate-200`、`bg-gray-100`、`bg-slate-50`、`text-gray-500`、`shadow-sm`、`shadow`、`opacity-50`、`opacity-60` |
| 其他禁用正则 | `^border-(?:gray\|slate)-`、`^shadow-(?!\[\|none)`、`^bg-(?:gray\|slate)-(?:[1-3])`、`^text-(?:gray\|slate)-(?:[3-5])` |

另外，源 `dontList` 以自然语言补充：

- 禁止使用单调的配色
- 禁止过于对称规整的布局
- 禁止使用细边框
- 禁止省略几何装饰元素
- 禁止几何装饰在 hover 时保持静止（失去孟菲斯游乐场的灵魂）
- 禁止按钮 active 状态保留阴影（压下去就应该完全贴地，active:shadow-none 是必须的）
- 禁止按钮 hover 使用位移减小阴影（应是增大阴影 + 换色，而非向阴影方向移动）

---

## 八、一致性清洗记录

本套风格的 `globalCss` 未发现与 `aiRules` 自相矛盾之处，**未做剔除**。

本套风格未推导出任何整类禁令（其 `forbidden` 只针对具体类名，不做整类剔除），因此 **`globalCss` 未做整类剔除**。

---

## 九、AI 硬规则（源 `aiRules` 全文，生成时应逐条遵守）

```text
你是一个 Memphis 设计风格的前端开发专家。生成的所有代码必须严格遵守以下约束：

## 绝对禁止

- 使用单调、低饱和度的配色
- 使用过于对称规整的布局
- 使用细边框 border
- 省略几何装饰元素

## 必须遵守

- 鲜艳撞色 bg-yellow-400, bg-pink-300, bg-cyan-400
- 粗边框 border-4 border-black
- 硬边阴影 shadow-[6px_6px_0px_#000]
- 几何装饰（圆形、三角形、方形）
- 粗体字 font-black, font-bold

## 配色

主色调：
- 红色: #ff6b6b, bg-red-500
- 黄色: #feca57, bg-yellow-400
- 青色: #48dbfb, bg-cyan-400
- 粉色: #ff9ff3, bg-pink-300
- 绿色: #1dd1a1, bg-green-400

## 装饰元素

- 圆形 rounded-full
- 三角形（用 border 实现）
- 方形 rotate-45
- 波浪线、点状、条纹图案

## Animation & Interaction Rules

- Playful Chaos: 卡片内装饰几何使用 group 类各自向不同方向独立运动（circle: group-hover:translate-x-4 group-hover:-translate-y-2；triangle: group-hover:-translate-x-2 group-hover:rotate-12），禁止统一方向。
- Toy Button Physics: 按钮 active 状态 active:translate-x-[6px] active:translate-y-[6px] active:shadow-none，模拟玩具按键完全贴地。
- Pop Swap: hover 时即刻切换高饱和撞色（hover:bg-pink-400），transition-colors duration-150，禁止使用渐变过渡。
- Snappy Motion: 所有动画 duration-150 ease-out，保持波普玩具的干脆感。
```

---

## 十、必须包含项与示例提示词

- **button** 必须含：`border-4` · `border-black` · `shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]` · `hover:translate-x-[3px] hover:translate-y-[3px]` · `hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]` · `transition-all duration-200` · `font-black`
- **card** 必须含：`border-4` · `border-black` · `shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]` · `bg-[#fef9ef]`
- **input** 必须含：`border-4` · `border-black` · `font-sans` · `focus:shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]` · `focus:outline-none`

示例提示词（源 `examplePrompts`）：

1. **创意工作室官网**（Creative Studio Website）—— 大胆有趣的创意网站
   ```text
   用 Memphis 风格创建一个创意工作室官网，要求：
1. 背景：多彩渐变 + 几何装饰
2. 标题：粗体 + 多层阴影
3. 卡片：粗边框 + 硬阴影
4. 按钮：鲜艳撞色
5. 添加圆形、三角形装饰
   ```
2. **SaaS 着陆页**（SaaS Landing Page）—— 生成 孟菲斯风格风格的 SaaS 产品着陆页
   ```text
   Create a SaaS landing page using Memphis style with hero section, feature grid, testimonials, pricing table, and footer.
   ```
3. **作品集展示**（Portfolio Showcase）—— 生成 孟菲斯风格风格的作品集页面
   ```text
   Create a portfolio showcase page using Memphis style with project grid, about section, contact form, and consistent visual language.
   ```

---

## 十一、token 配方总表（源 `memphis-tokens.ts`，Tailwind 类名字符串）

> 这些是**类名配方**而非 CSS 变量——stylekit 的 token 层就是"每个视觉位该用哪些 Tailwind 类"。
> 同目录 `tokens.css` 是该风格 `globalCss` 里的 CSS 变量与工具类（已做一致性清洗）；
> `design-tokens.json` 是扁平 key-value 形式，便于按需注入。

| 项 | 值 |
|---|---|
| 边框宽度 / 颜色 / 圆角 / 风格 | border-4 · border-black · rounded-none · border-solid |
| 阴影 sm / md / lg / none | shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] md:shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] · shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] md:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] · shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] md:shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] · shadow-none |
| 阴影 hover / focus | hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] · focus:shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] |
| 彩色阴影 | coral: shadow-[5px_5px_0px_0px_rgba(255,107,107,1)] · yellow: shadow-[5px_5px_0px_0px_rgba(254,202,87,1)] · teal: shadow-[5px_5px_0px_0px_rgba(72,219,251,1)] |
| 过渡 / 按下态 | transition-all duration-200 · active:translate-x-[5px] active:translate-y-[5px] |
| 标题字体 / 正文字体 / 等宽字体 | font-black tracking-tight · font-sans · font-mono |
| 字号 · hero | text-5xl md:text-7xl lg:text-9xl |
| 字号 · h1 | text-4xl md:text-6xl |
| 字号 · h2 | text-3xl md:text-4xl |
| 字号 · h3 | text-xl md:text-2xl |
| 字号 · body | text-sm md:text-base |
| 字号 · small | text-xs md:text-sm |
| 区块间距 / 容器内边距 / 卡片内边距 | py-12 md:py-24 lg:py-32 · px-4 md:px-8 lg:px-16 · p-5 md:p-8 |
| 间距 · sm | gap-3 md:gap-4 |
| 间距 · md | gap-4 md:gap-6 |
| 间距 · lg | gap-6 md:gap-10 |
| 底色 主 / 次 | bg-[#fef9ef] · bg-black |
| 底色 · 强调 | bg-[#ff6b6b] · bg-[#feca57] · bg-[#48dbfb] · bg-[#ff9ff3] |
| 文字 主 / 次 / 弱 | text-black · text-white · text-gray-600 |
| 按钮 · primary | bg-[#ff6b6b] text-black |
| 按钮 · secondary | bg-[#feca57] text-black |
| 按钮 · danger | bg-red-600 text-white |
| 必须包含 · button | border-4 · border-black · shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] · hover:translate-x-[3px] hover:translate-y-[3px] · hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] · transition-all duration-200 · font-black |
| 必须包含 · card | border-4 · border-black · shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] · bg-[#fef9ef] |
| 必须包含 · input | border-4 · border-black · font-sans · focus:shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] · focus:outline-none |

---

## 十二、来源与许可

- 素材仓库：AnxForever/**stylekit**（MIT License, © 2026 AnxForever）
- 源文件：`lib/styles/memphis.ts`、`lib/styles/memphis-tokens.ts`
- 转换脚本：`D:\项目\scripts\convert-stylekit-systems.mjs`（一次性、可复跑）
- 局部改动：按 `aiRules` 剔除 `globalCss` 中的矛盾项（见第八节），其余内容保持源样。
- 注意：源仓库的 `components` 字段含可复制的 JSX 组件代码模板，本轮**未纳入**设计系统格式（本项目格式无组件槽位）。
