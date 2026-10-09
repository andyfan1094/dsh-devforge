---
name: 侘寂风（Wabi-Sabi）
description: 日本侘寂美学的数字化呈现，崇尚不完美之美、自然衰老之雅和极致留白之禅，以墨色、茶色和纸张质感传递东方诗意。
triggers:
  - 侘寂风
  - Wabi-Sabi
  - 侘寂
  - 日式
  - 禅
  - 不完美
  - 留白
  - Ma
od:
  category: style-minimal
---

# 侘寂风（Wabi-Sabi）

## 一、一句话定位

日本侘寂美学的数字化呈现，崇尚不完美之美、自然衰老之雅和极致留白之禅，以墨色、茶色和纸张质感传递东方诗意。

- 英文名：**Wabi-Sabi**
- 风格类型：`visual`（视觉风格：靠色彩/材质/字体塑造）
- 关键词：侘寂、日式、禅、不完美、留白、Ma、纸张、自然、东方
- 适用场景提示：日式侘寂：不完美、极静、纸张与墨色的东方留白
- 源风格分类：`minimal`

---

## 二、设计哲学（源 `philosophy` 字段）

侘寂（Wabi-Sabi）是日本传统美学中最深层的哲学概念。

核心理念：
- 不完美之美：裂纹、磨损、不规则都是岁月赋予的美
- 间（Ma）：留白不是空无，是有意义的空间
- 自然衰变：万物生长、衰老、消逝的过程本身就是美
- 朴素之深：在极致的简约中发现深邃
- 一期一会：此刻即是唯一，不可再现

> ⚠️ 已剔除 5 句跨风格重复的通用模板句（判定标准：在 ≥10 套风格里逐字重复）。被剔除的是「视觉一致性：所有组件必须遵循统一的视觉语言，从色彩到…」「层次分明：通过颜色深浅、字号大小、留白空间建立清晰的…」「交互反馈：每个可交互元素都必须有明确的 hover、…」「响应式适配：设计必须在移动端、平板、桌面端上保持一致…」「无障碍性：确保色彩对比度符合 WCAG 2.1 AA…」这类与具体风格无关的套话，保留的是该风格独有的美学主张。

---

## 三、色彩逻辑

| 项 | 值 |
|---|---|
| 主色 primary | `#3a3a3a` |
| 辅色 secondary | `#f2ede4` |
| 强调色 accent | `#8a9a7b`、`#b5a78c`、`#8b6f4e`、`#799d91` |

配套的 Tailwind 类名配方（来自 `wabi-sabi-tokens.ts`）：

- 底色 主 / 次：bg-[#f7f3ec] · bg-[#f2ede4]
- 底色 强调：bg-[#8a9a7b]/10 · bg-[#b5a78c]/10 · bg-[#8b6f4e]/10
- 文字 主 / 次 / 弱：text-[#3a3a3a] · text-[#8a8278] · text-[#b5a78c]

**用色纪律**（源 `doList` 中与颜色相关的条目）：

- 使用温暖的纸张色背景 bg-[#f7f3ec] bg-[#f2ede4]
- 墨色为主要文字色 text-[#3a3a3a]

---

## 四、字体性格

- 标题：font-serif font-light tracking-wide
- 正文：font-serif font-light
- 等宽：font-mono font-light

字号阶梯：

| 项 | 值 |
|---|---|
| `hero` | `text-3xl md:text-5xl lg:text-6xl` |
| `h1` | `text-2xl md:text-4xl` |
| `h2` | `text-xl md:text-2xl` |
| `h3` | `text-lg md:text-xl` |
| `body` | `text-sm md:text-base` |
| `small` | `text-xs` |

---

## 五、圆角与间距哲学

| 项 | 值 |
|---|---|
| 圆角 | `rounded-none` |
| 边框 | `border border-solid border-[#d4cdc5]/30` |

| 项 | 值 |
|---|---|
| 区块间距 section | `py-24 md:py-32 lg:py-40` |
| 容器内边距 container | `px-8 md:px-16 lg:px-24` |
| 卡片内边距 card | `p-8 md:p-10` |
| 间距 gap · sm | `gap-6` |
| 间距 gap · md | `gap-10` |
| 间距 gap · lg | `gap-16` |

---

## 六、交互、阴影与状态

| 项 | 值 |
|---|---|
| 过渡 | `transition-opacity duration-1000` |
| 按下态 | `active:opacity-80` |
| 阴影 sm / md / lg / none | `shadow-none` · `shadow-sm` · `shadow-md` · `shadow-none` |
| 阴影 hover / focus | `hover:shadow-sm` · `focus:ring-1 focus:ring-[#8a9a7b]/20` |
| 彩色阴影 | — |

---

## 七、禁忌（源 `forbidden` 字段，含**为什么**禁）

> 这一节是 stylekit 最有价值的资产之一：它不仅列出禁用项，还给出了理由。理由直接来自源数据，
> 未做改写，便于直接喂给模型做生成后自检。

| 项 | 值 |
|---|---|
| `bg-black` | Wabi-sabi uses warm paper tones, not pure darkness |
| `font-black` | Only light and extralight weights convey wabi-sabi restraint |
| `shadow-lg` | Shadows must be minimal or absent for quiet aesthetic |
| `bg-gradient-to-r` | No gradients; use flat, natural tones |
| `animate-bounce` | No energetic animations; only slow fades allowed |
| 其他禁用类名 | `bg-gray-900`、`bg-slate-900`、`font-extrabold`、`font-bold`、`border-4`、`border-[3px]`、`border-[4px]`、`shadow-xl`、`shadow-2xl`、`rounded-2xl`、`rounded-3xl`、`rounded-full`、`bg-gradient-to-b`、`text-6xl`、`text-7xl`、`text-8xl`、`animate-spin`、`animate-pulse` |
| 其他禁用正则 | `^bg-(?:black\|gray-9\|slate-9)`、`^font-(?:black\|extrabold\|bold)$`、`^shadow-(?:lg\|xl\|2xl)$`、`^bg-gradient`、`^animate-(?:bounce\|spin\|pulse)$`、`^text-(?:[6-9]xl\|\dxl)$` |

另外，源 `dontList` 以自然语言补充：

- 禁止使用鲜艳色彩和高饱和度
- 禁止使用厚重阴影和粗边框
- 禁止密集排列元素
- 禁止使用装饰性动画和弹跳效果

---

## 八、一致性清洗记录

源仓库的 `globalCss` 里存在与本风格 `aiRules` 直接冲突的模板残留，已按**以 aiRules 为准**剔除下列 8 项（原始素材保留在仓库中未改动）：

| 项 | 值 |
|---|---|
| `@keyframes wabi-sabi-fade-in` | transform 位移/缩放（aiRules 禁位移缩放） |
| `.wabi-sabi-card::before` | 渐变（aiRules 禁渐变） |
| `.wabi-sabi-gradient` | 渐变（aiRules 禁渐变） |
| `.wabi-sabi-gradient-text` | 渐变（aiRules 禁渐变） |
| `.wabi-sabi-frosted` | 玻璃态 backdrop-filter（aiRules 禁玻璃态） |
| `.wabi-sabi-animate-in 的 animation 声明` | 引用了已删除的 @keyframes wabi-sabi-fade-in |
| `@media (min-width: 768px) 的 transition 中的 transform/box-shadow` | aiRules 禁位移缩放、禁阴影 |
| `@media print` | 玻璃态 backdrop-filter（aiRules 禁玻璃态） |

### 禁令推导依据

从本套的 `forbidden` 与 `aiRules` 推导出 **5 条整类禁令**（`gradient`、`bounce`、`glass`、`shadow`、`transform`），依据如下：

| 项 | 值 |
|---|---|
| `gradient` | forbidden.patterns 含整类渐变禁令 `^bg-gradient` |
| `shadow` | 直接禁令句：「- Shadowless Void: 放弃所有营造现代立体感的 `box-shadow`。」 |
| `transform` | 直接禁令句：「绝对禁止使用任何 `translate`（位移）、`scale`（缩放）或弹簧动画。」 |
| `bounce` | forbidden 明列 animate-bounce |
| `glass` | 人工登记（依据）：wabi-sabi 的 aiRules 通篇主张「无装饰 / 无影虚空 / 绝对静止」，且 forbidden 明确禁 rounded-2xl/3xl/full 与 shadow-lg/xl/2xl；同文件 globalCss 里的 .wabi-sabi-frosted（backdrop-filter 毛玻璃）属模板残留，与本风格精神直接冲突。 |

### 转换附带处理

- 源 `globalCss` 引用了从未定义的变量 `--wabi-sabi-primary`，已用 `colors` 字段补齐 1 个 `:root` 变量，保证 tokens.css 与 design-tokens.json 一致、且不留悬空引用

---

## 九、AI 硬规则（源 `aiRules` 全文，生成时应逐条遵守）

```text
You are designing in Wabi-Sabi style.
- Warm paper-toned backgrounds: #f7f3ec, #f2ede4
- Ink-like text color: #3a3a3a
- Muted natural accents: moss green #8a9a7b, tea brown #b5a78c
- Always use serif fonts (font-serif)
- Extreme whitespace: py-32, large gaps between sections
- Ultra-thin borders: border-[#d4cdc5]/30
- Slow transitions: duration-500 or longer
- No bold colors, no heavy shadows, no decorative elements
- Embrace asymmetry and imperfection
- Think "zen garden" and "ceramic pottery"

## Animation & Interaction Rules
- Absolute Stillness: 侘寂的核心是静谧。绝对禁止使用任何 `translate`（位移）、`scale`（缩放）或弹簧动画。元素必须像石头一样静静待在原处。
- Shadowless Void: 放弃所有营造现代立体感的 `box-shadow`。界面的层次仅通过大量留白和非常微弱的边框线来表达。
- Dust Breathing: 所有交互必须极其极其缓慢。强制使用 `duration-1000` 甚至更长的过渡时间（如 `duration-[1500ms]`），配合 `ease-in-out`。让背景颜色的加深看起来像自然光线缓慢变暗。
- Ink Fading: 悬停（Hover）时，文本的颜色不要发生突变，而是通过改变透明度（如从 `opacity-60` 缓慢过渡到 `opacity-100`），模拟墨迹在时间中的显现。
```

---

## 十、必须包含项与示例提示词

- **button** 必须含：`bg-transparent` · `transition-colors` · `duration-500`
- **card** 必须含：`transition-colors`
- **input** 必须含：`bg-transparent` · `focus:outline-none`

示例提示词（源 `examplePrompts`）：

1. **SaaS 着陆页**（SaaS Landing Page）—— 生成 侘寂风风格的 SaaS 产品着陆页
   ```text
   Create a SaaS landing page using Wabi-Sabi style with hero section, feature grid, testimonials, pricing table, and footer.
   ```
2. **作品集展示**（Portfolio Showcase）—— 生成 侘寂风风格的作品集页面
   ```text
   Create a portfolio showcase page using Wabi-Sabi style with project grid, about section, contact form, and consistent visual language.
   ```

---

## 十一、token 配方总表（源 `wabi-sabi-tokens.ts`，Tailwind 类名字符串）

> 这些是**类名配方**而非 CSS 变量——stylekit 的 token 层就是"每个视觉位该用哪些 Tailwind 类"。
> 同目录 `tokens.css` 是该风格 `globalCss` 里的 CSS 变量与工具类（已做一致性清洗）；
> `design-tokens.json` 是扁平 key-value 形式，便于按需注入。

| 项 | 值 |
|---|---|
| 边框宽度 / 颜色 / 圆角 / 风格 | border · border-[#d4cdc5]/30 · rounded-none · border-solid |
| 阴影 sm / md / lg / none | shadow-none · shadow-sm · shadow-md · shadow-none |
| 阴影 hover / focus | hover:shadow-sm · focus:ring-1 focus:ring-[#8a9a7b]/20 |
| 过渡 / 按下态 | transition-opacity duration-1000 · active:opacity-80 |
| 标题字体 / 正文字体 / 等宽字体 | font-serif font-light tracking-wide · font-serif font-light · font-mono font-light |
| 字号 · hero | text-3xl md:text-5xl lg:text-6xl |
| 字号 · h1 | text-2xl md:text-4xl |
| 字号 · h2 | text-xl md:text-2xl |
| 字号 · h3 | text-lg md:text-xl |
| 字号 · body | text-sm md:text-base |
| 字号 · small | text-xs |
| 区块间距 / 容器内边距 / 卡片内边距 | py-24 md:py-32 lg:py-40 · px-8 md:px-16 lg:px-24 · p-8 md:p-10 |
| 间距 · sm | gap-6 |
| 间距 · md | gap-10 |
| 间距 · lg | gap-16 |
| 底色 主 / 次 | bg-[#f7f3ec] · bg-[#f2ede4] |
| 底色 · 强调 | bg-[#8a9a7b]/10 · bg-[#b5a78c]/10 · bg-[#8b6f4e]/10 |
| 文字 主 / 次 / 弱 | text-[#3a3a3a] · text-[#8a8278] · text-[#b5a78c] |
| 按钮 · primary | bg-transparent border-b border-[#3a3a3a]/30 text-[#3a3a3a] |
| 按钮 · secondary | bg-transparent border-b border-[#d4cdc5] text-[#8a8278] |
| 按钮 · danger | bg-transparent border-b border-[#8b6f4e] text-[#8b6f4e] |
| 必须包含 · button | bg-transparent · transition-colors · duration-500 |
| 必须包含 · card | transition-colors |
| 必须包含 · input | bg-transparent · focus:outline-none |

---

## 十二、来源与许可

- 素材仓库：AnxForever/**stylekit**（MIT License, © 2026 AnxForever）
- 源文件：`lib/styles/wabi-sabi.ts`、`lib/styles/wabi-sabi-tokens.ts`
- 转换脚本：`D:\项目\scripts\convert-stylekit-systems.mjs`（一次性、可复跑）
- 局部改动：按 `aiRules` 剔除 `globalCss` 中的矛盾项（见第八节），其余内容保持源样。
- 注意：源仓库的 `components` 字段含可复制的 JSX 组件代码模板，本轮**未纳入**设计系统格式（本项目格式无组件槽位）。
