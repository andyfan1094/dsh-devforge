---
name: 赛博朋克霓虹（Cyberpunk Neon）
description: 未来感十足的赛博朋克风格，霓虹发光效果、深色背景、高科技感的 UI 元素。适合游戏、科技产品、创意工作室。
triggers:
  - 赛博朋克霓虹
  - Cyberpunk Neon
  - 赛博朋克
  - 霓虹
  - 未来
  - 发光
  - 游戏
  - 科技
od:
  category: style-expressive
---

# 赛博朋克霓虹（Cyberpunk Neon）

## 一、一句话定位

未来感十足的赛博朋克风格，霓虹发光效果、深色背景、高科技感的 UI 元素。适合游戏、科技产品、创意工作室。

- 英文名：**Cyberpunk Neon**
- 风格类型：`visual`（视觉风格：靠色彩/材质/字体塑造）
- 关键词：赛博朋克、霓虹、未来、发光、游戏、科技、expressive、bold、vibrant、表现力
- 适用场景提示：赛博朋克霓虹：暗底 + 高饱和霓虹辉光
- 源风格分类：`expressive`

---

## 二、设计哲学（源 `philosophy` 字段）

Cyberpunk Neon 风格来源于赛博朋克科幻美学，通过霓虹发光、深色背景和高对比度创造未来感。

核心理念：
- 霓虹发光：核心元素使用发光效果突出
- 深色主导：近乎纯黑的背景让霓虹更加醒目
- 高科技感：使用网格、扫描线等元素增加科技感
- 色彩冲击：青色、品红、黄色等高饱和度颜色

> ⚠️ 已剔除 5 句跨风格重复的通用模板句（判定标准：在 ≥10 套风格里逐字重复）。被剔除的是「视觉一致性：所有组件必须遵循统一的视觉语言，从色彩到…」「层次分明：通过颜色深浅、字号大小、留白空间建立清晰的…」「交互反馈：每个可交互元素都必须有明确的 hover、…」「响应式适配：设计必须在移动端、平板、桌面端上保持一致…」「无障碍性：确保色彩对比度符合 WCAG 2.1 AA…」这类与具体风格无关的套话，保留的是该风格独有的美学主张。

---

## 三、色彩逻辑

| 项 | 值 |
|---|---|
| 主色 primary | `#00ffff` |
| 辅色 secondary | `#0a0a0f` |
| 强调色 accent | `#ff00ff`、`#ffff00`、`#00ff00`、`#ff0506` |

配套的 Tailwind 类名配方（来自 `cyberpunk-neon-tokens.ts`）：

- 底色 主 / 次：bg-[#0a0a0f] · bg-gray-950
- 底色 强调：bg-cyan-400 · bg-fuchsia-500 · bg-yellow-400
- 文字 主 / 次 / 弱：text-white · text-cyan-400 · text-gray-400

**用色纪律**（源 `doList` 中与颜色相关的条目）：

- 背景使用深色 bg-[#0a0a0f] 或 bg-gray-950
- 文字发光 [text-shadow:0_0_10px_currentColor]
- 渐变文字 bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-transparent

---

## 四、字体性格

- 标题：font-bold
- 正文：font-mono
- 等宽：font-mono

字号阶梯：

| 项 | 值 |
|---|---|
| `hero` | `text-4xl md:text-6xl lg:text-8xl` |
| `h1` | `text-3xl md:text-5xl` |
| `h2` | `text-2xl md:text-3xl` |
| `h3` | `text-xl md:text-2xl` |
| `body` | `text-sm md:text-base` |
| `small` | `text-xs` |

---

## 五、圆角与间距哲学

| 项 | 值 |
|---|---|
| 圆角 | `rounded-lg` |
| 边框 | `border border-solid border-cyan-400/30` |

| 项 | 值 |
|---|---|
| 区块间距 section | `py-16 md:py-24` |
| 容器内边距 container | `px-4 md:px-8` |
| 卡片内边距 card | `p-6` |
| 间距 gap · sm | `gap-4` |
| 间距 gap · md | `gap-6` |
| 间距 gap · lg | `gap-8` |

---

## 六、交互、阴影与状态

| 项 | 值 |
|---|---|
| 过渡 | `transition-all duration-300` |
| 按下态 | `active:scale-95` |
| 阴影 sm / md / lg / none | `shadow-[0_0_10px_rgba(0,255,255,0.3)]` · `shadow-[0_0_15px_rgba(0,255,255,0.4)]` · `shadow-[0_0_25px_rgba(0,255,255,0.5)]` · `shadow-none` |
| 阴影 hover / focus | `shadow-[0_0_30px_rgba(0,255,255,0.6)]` · `shadow-[0_0_20px_rgba(0,255,255,0.5)]` |
| 彩色阴影 | cyan: `shadow-[0_0_20px_rgba(0,255,255,0.5)]` · magenta: `shadow-[0_0_20px_rgba(255,0,255,0.5)]` · yellow: `shadow-[0_0_20px_rgba(255,255,0,0.5)]` |

---

## 七、禁忌（源 `forbidden` 字段，含**为什么**禁）

> 这一节是 stylekit 最有价值的资产之一：它不仅列出禁用项，还给出了理由。理由直接来自源数据，
> 未做改写，便于直接喂给模型做生成后自检。

| 项 | 值 |
|---|---|
| `bg-white` | Cyberpunk uses dark backgrounds only |
| `shadow-md` | Use neon glow shadows: shadow-[0_0_20px_rgba(0,255,255,0.5)] |
| `rounded-2xl` | Keep corners subtle (rounded-lg max) |
| 其他禁用类名 | `bg-gray-50`、`bg-slate-50`、`shadow-sm`、`shadow-lg`、`text-gray-900`、`rounded-3xl` |
| 其他禁用正则 | `^bg-white`、`^bg-gray-[1-3]`、`^bg-slate-[1-3]`、`^shadow-(?!\[)`、`^rounded-[23]xl` |

另外，源 `dontList` 以自然语言补充：

- 禁止使用浅色/白色背景
- 禁止使用低饱和度颜色
- 禁止使用普通阴影 shadow-md（必须是发光阴影）
- 禁止使用暖色调（除非作为警告/错误色）
- 禁止圆角过大 rounded-2xl, rounded-3xl
- 禁止使用柔和/温暖的设计语言

---

## 八、一致性清洗记录

本套风格的 `globalCss` 未发现与 `aiRules` 自相矛盾之处，**未做剔除**。

本套风格未推导出任何整类禁令（其 `forbidden` 只针对具体类名，不做整类剔除），因此 **`globalCss` 未做整类剔除**。

### 转换附带处理

- 去掉 1 处 `@layer` 包装（剥离 Tailwind 后该语法无意义，留着会被浏览器整块忽略）

---

## 九、AI 硬规则（源 `aiRules` 全文，生成时应逐条遵守）

```text
风格：Cyberpunk Neon
类型：未来感科幻界面

必须使用：
- 深色背景：bg-[#0a0a0f] 或 bg-gray-950
- 霓虹发光阴影：shadow-[0_0_20px_rgba(0,255,255,0.5)]
- 文字发光：style={{textShadow: '0 0 10px currentColor'}}
- 发光边框：border border-cyan-400 shadow-[0_0_10px...]
- 高饱和度颜色：cyan-400、fuchsia-500、yellow-400
- 科技感文字使用 font-mono
- 标签使用 uppercase tracking-wider

必须避免：
- 浅色/白色背景
- 低饱和度颜色
- 普通阴影（shadow-md）
- 暖色调配色
- 过大的圆角（rounded-2xl 及以上）
- 柔和/亲和的设计语言

配色规则：
- 主色：青色 (#00ffff)
- 强调色：品红 (#ff00ff)
- 背景：近黑色 (#0a0a0f)
- 文字：带发光效果的白色
- 边框：主色调发光

特殊效果：
- 扫描线叠加层，营造科技感
- 使用 animate-pulse 制造脉冲元素
- hover 时发光增强

---

## 动效规则

### 交互物理
- **Unstable Neon**：发光效果可以带有轻微脉冲，谨慎使用 `animate-pulse`。禁止高频闪烁影响可读性。
- **Glitch Press**：active 状态使用偏移位移 + 颜色反转，而不是缩放。例如：`active:translate-x-[2px] active:-translate-y-[1px] active:text-fuchsia-400`
- **CRT Scanline**：卡片在 hover 时提升扫描线密度/可见度，模拟终端扫描效果。
- **Fast & Raw**：常规交互使用 `duration-100` 到 `duration-150`；只有扫光效果可以放宽到 `duration-300`。

### 时长参考
| 交互 | 时长 | 缓动 |
|-------------|----------|--------|
| 按钮 hover | 100-150ms | ease-out |
| 发光脉冲 | 2-3s | ease-in-out（循环） |
| 扫光 | 150-300ms | ease-out |
| Glitch Press | 瞬间 | — |

---

## 排版

| 元素 | 类名 |
|---------|---------|
| 标题 | font-mono font-bold uppercase tracking-[0.2em] |
| 标签 | text-xs font-mono uppercase tracking-wider |
| 正文 | font-mono text-sm |
| 代码/数据 | font-mono tabular-nums |

---

## 禁止使用的模式

| 模式 | 原因 |
|---------|--------|
| 浅色/白色背景 | 破坏霓虹的可见度 |
| 低饱和度颜色 | 失去赛博朋克的强度感 |
| shadow-md, shadow-lg | 不使用模糊阴影——只用发光 |
| 暖色调配色 | 与冷峻科技美学相悖 |
| rounded-2xl, rounded-3xl | 过于柔和，缺乏科技感 |
| 柔和/亲和的语言 | 破坏沉浸感 |
| active 状态使用 scale 变换 | 应改用 glitch 偏移 |

---

## 自检清单

输出代码前请逐项确认：
- [ ] 背景是近黑色（#0a0a0f 或 bg-gray-950）
- [ ] 霓虹发光使用 shadow-[0_0_Xpx_rgba(...)] 格式
- [ ] 文字在合适的地方带有 textShadow 发光效果
- [ ] 仅使用高饱和度颜色（青、品红、黄、绿）
- [ ] 所有文字元素都使用 font-mono
- [ ] Active 状态使用 glitch 偏移，而不是 scale
- [ ] 圆角是 rounded-sm 或 rounded-none
- [ ] 过渡要快：duration-100 到 duration-150
```

---

## 十、必须包含项与示例提示词

- **button** 必须含：`px-6 py-3` · `rounded-lg` · `font-mono` · `uppercase tracking-wider` · `transition-all duration-300`
- **card** 必须含：`bg-gray-950` · `border border-cyan-400/30` · `rounded-lg`
- **input** 必须含：`bg-gray-950` · `border border-cyan-400/30` · `rounded-lg` · `text-cyan-400` · `font-mono` · `focus:border-cyan-400` · `focus:shadow-[0_0_15px_rgba(0,255,255,0.3)]`

示例提示词（源 `examplePrompts`）：

1. **游戏界面**（Game Interface）—— 生成赛博朋克风格游戏 UI
   ```text
   Create a game interface using Cyberpunk Neon style:
- Dark background with scan line effect
- Neon glowing HUD elements
- Stats cards with cyan borders and glow
- Action buttons with pulse animation
- Futuristic font-mono typography
- Magenta accent for alerts/warnings
   ```
2. **SaaS 着陆页**（SaaS Landing Page）—— 生成 赛博朋克霓虹风格的 SaaS 产品着陆页
   ```text
   Create a SaaS landing page using Cyberpunk Neon style with hero section, feature grid, testimonials, pricing table, and footer.
   ```
3. **作品集展示**（Portfolio Showcase）—— 生成 赛博朋克霓虹风格的作品集页面
   ```text
   Create a portfolio showcase page using Cyberpunk Neon style with project grid, about section, contact form, and consistent visual language.
   ```

---

## 十一、token 配方总表（源 `cyberpunk-neon-tokens.ts`，Tailwind 类名字符串）

> 这些是**类名配方**而非 CSS 变量——stylekit 的 token 层就是"每个视觉位该用哪些 Tailwind 类"。
> 同目录 `tokens.css` 是该风格 `globalCss` 里的 CSS 变量与工具类（已做一致性清洗）；
> `design-tokens.json` 是扁平 key-value 形式，便于按需注入。

| 项 | 值 |
|---|---|
| 边框宽度 / 颜色 / 圆角 / 风格 | border · border-cyan-400/30 · rounded-lg · border-solid |
| 阴影 sm / md / lg / none | shadow-[0_0_10px_rgba(0,255,255,0.3)] · shadow-[0_0_15px_rgba(0,255,255,0.4)] · shadow-[0_0_25px_rgba(0,255,255,0.5)] · shadow-none |
| 阴影 hover / focus | shadow-[0_0_30px_rgba(0,255,255,0.6)] · shadow-[0_0_20px_rgba(0,255,255,0.5)] |
| 彩色阴影 | cyan: shadow-[0_0_20px_rgba(0,255,255,0.5)] · magenta: shadow-[0_0_20px_rgba(255,0,255,0.5)] · yellow: shadow-[0_0_20px_rgba(255,255,0,0.5)] |
| 过渡 / 按下态 | transition-all duration-300 · active:scale-95 |
| 标题字体 / 正文字体 / 等宽字体 | font-bold · font-mono · font-mono |
| 字号 · hero | text-4xl md:text-6xl lg:text-8xl |
| 字号 · h1 | text-3xl md:text-5xl |
| 字号 · h2 | text-2xl md:text-3xl |
| 字号 · h3 | text-xl md:text-2xl |
| 字号 · body | text-sm md:text-base |
| 字号 · small | text-xs |
| 区块间距 / 容器内边距 / 卡片内边距 | py-16 md:py-24 · px-4 md:px-8 · p-6 |
| 间距 · sm | gap-4 |
| 间距 · md | gap-6 |
| 间距 · lg | gap-8 |
| 底色 主 / 次 | bg-[#0a0a0f] · bg-gray-950 |
| 底色 · 强调 | bg-cyan-400 · bg-fuchsia-500 · bg-yellow-400 |
| 文字 主 / 次 / 弱 | text-white · text-cyan-400 · text-gray-400 |
| 按钮 · primary | bg-cyan-400 text-black |
| 按钮 · secondary | bg-transparent text-cyan-400 border border-cyan-400 |
| 按钮 · danger | bg-red-500 text-white shadow-[0_0_15px_rgba(255,0,0,0.5)] |
| 必须包含 · button | px-6 py-3 · rounded-lg · font-mono · uppercase tracking-wider · transition-all duration-300 |
| 必须包含 · card | bg-gray-950 · border border-cyan-400/30 · rounded-lg |
| 必须包含 · input | bg-gray-950 · border border-cyan-400/30 · rounded-lg · text-cyan-400 · font-mono · focus:border-cyan-400 · focus:shadow-[0_0_15px_rgba(0,255,255,0.3)] |

---

## 十二、来源与许可

- 素材仓库：AnxForever/**stylekit**（MIT License, © 2026 AnxForever）
- 源文件：`lib/styles/cyberpunk-neon.ts`、`lib/styles/cyberpunk-neon-tokens.ts`
- 转换脚本：`D:\项目\scripts\convert-stylekit-systems.mjs`（一次性、可复跑）
- 局部改动：按 `aiRules` 剔除 `globalCss` 中的矛盾项（见第八节），其余内容保持源样。
- 注意：源仓库的 `components` 字段含可复制的 JSX 组件代码模板，本轮**未纳入**设计系统格式（本项目格式无组件槽位）。
