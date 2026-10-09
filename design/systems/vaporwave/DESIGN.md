---
name: 霓虹复古（Neon Retro）
description: 80-90年代复古未来主义美学，粉紫渐变、霓虹色彩、故障艺术效果。包含蒸汽波、合成波、赛博朋克三种变体。
triggers:
  - 霓虹复古
  - Neon Retro
  - 蒸汽波
  - 复古未来
  - 霓虹
  - 80年代
  - 故障艺术
  - 赛博
od:
  category: style-retro
---

# 霓虹复古（Neon Retro）

## 一、一句话定位

80-90年代复古未来主义美学，粉紫渐变、霓虹色彩、故障艺术效果。包含蒸汽波、合成波、赛博朋克三种变体。

- 英文名：**Neon Retro**
- 风格类型：`visual`（视觉风格：靠色彩/材质/字体塑造）
- 关键词：蒸汽波、复古未来、霓虹、80年代、故障艺术、赛博、合成波、赛博朋克、vaporwave、synthwave、cyberpunk
- 适用场景提示：蒸汽波：粉紫渐变、网格地平线、90 年代数字浪漫
- 源风格分类：`retro`

---

## 二、设计哲学（源 `philosophy` 字段）

Vaporwave（蒸汽波）是一种源于2010年代初的网络亚文化美学，融合了80-90年代的消费主义符号、日本文化元素和早期互联网美学。

核心理念：
- 怀旧感：对80-90年代商业美学的戏仿和致敬
- 超现实：希腊雕塑、棕榈树、日落等超现实元素组合
- 霓虹色彩：粉色、青色、紫色的渐变组合
- 故障美学：VHS 故障、扫描线、色差效果

> ⚠️ 已剔除 5 句跨风格重复的通用模板句（判定标准：在 ≥10 套风格里逐字重复）。被剔除的是「视觉一致性：所有组件必须遵循统一的视觉语言，从色彩到…」「层次分明：通过颜色深浅、字号大小、留白空间建立清晰的…」「交互反馈：每个可交互元素都必须有明确的 hover、…」「响应式适配：设计必须在移动端、平板、桌面端上保持一致…」「无障碍性：确保色彩对比度符合 WCAG 2.1 AA…」这类与具体风格无关的套话，保留的是该风格独有的美学主张。

---

## 三、色彩逻辑

| 项 | 值 |
|---|---|
| 主色 primary | `#ff71ce` |
| 辅色 secondary | `#01cdfe` |
| 强调色 accent | `#05ffa1`、`#b967ff`、`#fffb96`、`#47d9ff` |

配套的 Tailwind 类名配方（来自 `vaporwave-tokens.ts`）：

- 底色 主 / 次：bg-[#1a0a2e] · bg-[#16082a]
- 底色 强调：bg-[#ff71ce] · bg-[#01cdfe] · bg-[#b967ff] · bg-[#05ffa1]
- 文字 主 / 次 / 弱：text-[#ff71ce] · text-[#01cdfe] · text-[#b967ff]/70

**用色纪律**（源 `doList` 中与颜色相关的条目）：

- 使用粉紫青渐变 bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-500
- 霓虹光晕强调粉+青双色散射，形成 Aesthetic 重影效果

---

## 四、字体性格

- 标题：font-bold tracking-wide
- 正文：font-sans
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
| 圆角 | `rounded-xl` |
| 边框 | `border border-solid border-[#ff71ce]/50` |

| 项 | 值 |
|---|---|
| 区块间距 section | `py-12 md:py-20 lg:py-28` |
| 容器内边距 container | `px-4 md:px-8 lg:px-12` |
| 卡片内边距 card | `p-5 md:p-8` |
| 间距 gap · sm | `gap-3 md:gap-4` |
| 间距 gap · md | `gap-4 md:gap-6` |
| 间距 gap · lg | `gap-6 md:gap-10` |

---

## 六、交互、阴影与状态

| 项 | 值 |
|---|---|
| 过渡 | `transition-all duration-300 ease-in-out` |
| 按下态 | `active:scale-95` |
| 阴影 sm / md / lg / none | `shadow-[0_0_8px_rgba(255,113,206,0.4)] md:shadow-[0_0_12px_rgba(255,113,206,0.4)]` · `shadow-[0_0_16px_rgba(255,113,206,0.5)] md:shadow-[0_0_24px_rgba(255,113,206,0.5)]` · `shadow-[0_0_24px_rgba(255,113,206,0.6)] md:shadow-[0_0_40px_rgba(255,113,206,0.6)]` · `shadow-none` |
| 阴影 hover / focus | `hover:shadow-[0_0_32px_rgba(1,205,254,0.7)]` · `focus:shadow-[0_0_20px_rgba(1,205,254,0.6)]` |
| 彩色阴影 | pink: `shadow-[0_0_20px_rgba(255,113,206,0.6)]` · cyan: `shadow-[0_0_20px_rgba(1,205,254,0.6)]` · purple: `shadow-[0_0_20px_rgba(185,103,255,0.6)]` |

---

## 七、禁忌（源 `forbidden` 字段，含**为什么**禁）

> 这一节是 stylekit 最有价值的资产之一：它不仅列出禁用项，还给出了理由。理由直接来自源数据，
> 未做改写，便于直接喂给模型做生成后自检。

| 项 | 值 |
|---|---|
| `rounded-none` | Vaporwave uses soft rounded shapes (rounded-xl or higher) |
| `border-black` | Vaporwave uses neon-colored translucent borders, not solid black |
| `shadow-[4px_4px_0px_0px` | Vaporwave uses glow shadows (0_0_Xpx_rgba), not hard-edge |
| `bg-white` | Vaporwave uses dark backgrounds with neon accents |
| 其他禁用类名 | `border-4`、`bg-gray-50`、`bg-gray-100`、`text-black`、`text-gray-900`、`text-gray-800`、`shadow-[2px_2px_0px`、`shadow-[4px_4px_0px`、`shadow-[8px_8px_0px` |
| 其他禁用正则 | `^rounded-none$`、`^shadow-\[\d+px_\d+px_0px`、`^bg-gray-(?:[1-4])`、`^text-gray-(?:[7-9])` |

另外，源 `dontList` 以自然语言补充：

- 禁止使用单调的灰色配色
- 禁止使用过于现代简约的设计
- 禁止省略霓虹发光效果
- 禁止使用过于正式的字体
- 禁止仅用单色 glow，必须体现粉青双色发光重影
- 禁止所有交互都过快，hover 需保留漂浮式慢节奏

---

## 八、一致性清洗记录

本套风格的 `globalCss` 未发现与 `aiRules` 自相矛盾之处，**未做剔除**。

本套风格未推导出任何整类禁令（其 `forbidden` 只针对具体类名，不做整类剔除），因此 **`globalCss` 未做整类剔除**。

---

## 九、AI 硬规则（源 `aiRules` 全文，生成时应逐条遵守）

```text
# Vaporwave / 霓虹复古 设计系统

你是一个专精 Vaporwave（蒸汽波）美学的前端开发专家。生成的所有代码必须严格遵循以下规范。

## 风格身份
- **名称**：Vaporwave / 霓虹复古 / Synthwave（合成波）
- **类别**：复古、表现力强、高对比度
- **本质**：80-90 年代复古未来主义、消费主义怀旧、数字腐朽感、审美反讽
- **情绪基调**：梦幻、怀旧、超现实，忧郁中带着张扬的活力
- **灵感来源**：80 年代商场、VHS 录像带、早期互联网、希腊雕塑、日本 City Pop

---

## 核心视觉原则

### 1. 背景基础
```
REQUIRED: Deep purple/pink gradient or solid dark colors
- bg-purple-900, bg-pink-900, bg-indigo-900
- bg-gradient-to-b from-purple-900 via-pink-900 to-indigo-900

Add grid overlay for depth:
bg-[linear-gradient(rgba(255,113,206,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(255,113,206,0.1)_1px,transparent_1px)]
bg-[size:50px_50px]
```

### 2. 霓虹发光系统（双色）
```
REQUIRED: Pink + Cyan dual glow (NOT single color)

TEXT GLOW:
style={{ textShadow: '2px 2px 0px rgba(185,103,255,0.5)' }}

ELEMENT GLOW:
shadow-[0_0_20px_rgba(255,113,206,0.5)]  // Pink
shadow-[0_0_20px_rgba(1,205,254,0.5)]    // Cyan
shadow-[4px_4px_0_rgba(1,205,254,0.6)]   // Hard offset shadow

DUAL IRRADIATION (ghosting effect):
shadow-[0_10px_30px_rgba(255,113,206,0.2)]
hover:shadow-[0_0_50px_rgba(1,205,254,0.4)]
```

### 3. 渐变文字
```jsx
<h1 className="text-transparent bg-clip-text 
  bg-gradient-to-r from-pink-400 via-purple-400 to-cyan-400">
  VAPORWAVE
</h1>
```

### 4. 边框系统
```
Asymmetric neon borders:
border-t-2 border-l-2 border-[#ff71ce]/50 
border-b-4 border-r-4 border-[#01cdfe]/50
```

---

## 交互规范

### Hover 效果（Aesthetic Warp）
| 元素 | 效果 | 实现 |
|---------|--------|----------------|
| 按钮 | 渐变流动 + 上浮 | bg-[length:200%_auto] hover:bg-right hover:-translate-y-1 |
| 卡片 | 旋转 + 阴影偏移 | hover:-translate-y-2 hover:rotate-1 hover:shadow-[0_0_50px_...] |
| 文字 | 字距扩展 | group-hover:tracking-[0.4em] |

### Active 状态（Glitch/Error Snap）
```
active:rotate-0 
active:translate-x-[6px] active:translate-y-[6px] 
active:shadow-none
```
模拟旧系统错误弹窗式反馈：突兀的错位位移。

### 高光扫光（Specular Sweep）
```jsx
<span className="absolute inset-0 
  bg-gradient-to-r from-transparent via-white/30 to-transparent 
  -translate-x-full 
  group-hover:translate-x-full 
  transition-transform duration-700" />
```

---

## 动画规则

### 交互物理特性
- **Aesthetic Warp**: Hover 引入轻微旋转、位移与渐变流动。使用 `bg-[length:200%_auto] hover:bg-right`。
- **Glitch/Error Snap**: Active 使用突兀的偏移（translate-x + translate-y），模拟错误弹窗式反馈。
- **Dual-Color Irradiation**: 发光必须同时呈现粉色 #ff71ce 与青色 #01cdfe 的双重重影。
- **Floating Slowness**: 非点击动画使用 `duration-500` 到 `duration-700`，营造数字废墟中缓慢漂浮的感觉。

### 时序指南
| 交互 | 时长 | 缓动 |
|-------------|----------|--------|
| Hover 上浮 | 300-500ms | ease-out |
| 渐变流动 | 500ms | ease-out |
| Active 按下 | instant | — |
| 网格缩放 | 700ms | ease-in-out |

---

## 配色

### 主霓虹色
| Token | Hex | Tailwind | Usage |
|-------|-----|----------|-------|
| 霓虹粉 | #ff71ce | pink-400 | 主色、标题 |
| 霓虹青 | #01cdfe | cyan-400 | 链接、强调色 |
| 霓虹紫 | #b967ff | purple-400 | 次要色 |
| 霓虹绿 | #05ffa1 | — | 高亮 |
| 霓虹黄 | #fffb96 | — | 特殊元素 |

### 背景与表面
| Token | Value | Usage |
|-------|-------|-------|
| 深背景 | bg-purple-900 | 主背景 |
| 面板背景 | bg-[#2b0057]/60 | 卡片背景 |
| 主文字 | text-pink-100 | 正文文字 |
| 发光文字 | text-[#ff71ce] | 强调文字 |

---

## 排版

| 元素 | 类名 |
|---------|---------|
| 标题 | font-black uppercase tracking-[0.2em] text-transparent bg-clip-text bg-gradient-... |
| 正文 | font-medium leading-relaxed drop-shadow-[0_0_5px_rgba(255,113,206,0.5)] |
| 标签 | font-mono font-bold text-xs uppercase |

---

## 特殊元素

### 装饰元素
- 日文文字：アエステティック、新しい、仮想現実
- 希腊雕像/半身像意象
- 棕榈树、日落地平线
- VHS 扫描线与故障效果
- Windows 95/98 界面元素
- 透视网格地面

### 网格背景
```jsx
<div className="absolute inset-0 
  bg-[linear-gradient(rgba(255,113,206,0.2)_1px,transparent_1px),linear-gradient(90deg,rgba(1,205,254,0.2)_1px,transparent_1px)] 
  bg-[size:15px_15px] 
  opacity-20 group-hover:opacity-50 group-hover:scale-110 
  transition-all duration-700" 
  style={{ transform: "perspective(200px) rotateX(45deg)" }} />
```

---

## 禁止事项

| 模式 | 原因 |
|---------|--------|
| 单调灰色/黑白配色 | 破坏复古的鲜活感 |
| 现代极简设计 | 与极繁美学相悖 |
| 省略霓虹发光 | 丧失蒸汽波辨识度 |
| 正式衬线字体 | 年代错位、氛围不对 |
| 单色发光 | 必须呈现粉青双色重影 |
| 过快的交互 | 应使用缓慢梦幻的节奏 |

---

## 响应式指南

### 发光缩放
```
Mobile: shadow-[0_0_10px_...]
Desktop (md:): shadow-[0_0_20px_...]
```

### 网格尺寸
```
Mobile: bg-[size:30px_30px]
Desktop: bg-[size:50px_50px]
```

---

## 自检清单

输出代码前，请确认：
- [ ] 背景是紫粉渐变或纯深紫色
- [ ] 霓虹发光同时使用粉色与青色（双色重影）
- [ ] 主要区块上叠加了网格线
- [ ] 主标题使用渐变文字
- [ ] Hover 包含旋转/位移/渐变流动
- [ ] Active 使用突兀偏移（glitch snap）
- [ ] 过渡时长在 duration-500 以上，营造漂浮感
- [ ] 合适位置有日文装饰文字
- [ ] 边框是非对称的（右下更粗）
```

---

## 十、必须包含项与示例提示词

- **button** 必须含：`rounded-xl` · `shadow-[0_0_16px_rgba(255,113,206,0.5)]` · `hover:shadow-[0_0_32px_rgba(1,205,254,0.7)]` · `transition-all duration-300 ease-in-out` · `font-bold`
- **card** 必须含：`rounded-xl` · `bg-[#1a0a2e]/80` · `border border-[#ff71ce]/50` · `shadow-[0_0_16px_rgba(255,113,206,0.5)]`
- **input** 必须含：`rounded-xl` · `border border-[#b967ff]/50` · `bg-[#1a0a2e]/60` · `text-[#01cdfe]` · `focus:shadow-[0_0_20px_rgba(1,205,254,0.6)]` · `focus:outline-none`

示例提示词（源 `examplePrompts`）：

1. **复古音乐播放器**（Retro Music Player）—— 80年代风格音乐界面
   ```text
   用 Vaporwave 风格创建一个音乐播放器界面，要求：
1. 背景：紫粉渐变 + 网格线
2. 专辑封面：带霓虹边框发光
3. 播放控制：霓虹按钮
4. 进度条：渐变色
5. 添加日文装饰文字
   ```
2. **SaaS 着陆页**（SaaS Landing Page）—— 生成 霓虹复古风格的 SaaS 产品着陆页
   ```text
   Create a SaaS landing page using Neon Retro style with hero section, feature grid, testimonials, pricing table, and footer.
   ```
3. **作品集展示**（Portfolio Showcase）—— 生成 霓虹复古风格的作品集页面
   ```text
   Create a portfolio showcase page using Neon Retro style with project grid, about section, contact form, and consistent visual language.
   ```

---

## 十一、token 配方总表（源 `vaporwave-tokens.ts`，Tailwind 类名字符串）

> 这些是**类名配方**而非 CSS 变量——stylekit 的 token 层就是"每个视觉位该用哪些 Tailwind 类"。
> 同目录 `tokens.css` 是该风格 `globalCss` 里的 CSS 变量与工具类（已做一致性清洗）；
> `design-tokens.json` 是扁平 key-value 形式，便于按需注入。

| 项 | 值 |
|---|---|
| 边框宽度 / 颜色 / 圆角 / 风格 | border · border-[#ff71ce]/50 · rounded-xl · border-solid |
| 阴影 sm / md / lg / none | shadow-[0_0_8px_rgba(255,113,206,0.4)] md:shadow-[0_0_12px_rgba(255,113,206,0.4)] · shadow-[0_0_16px_rgba(255,113,206,0.5)] md:shadow-[0_0_24px_rgba(255,113,206,0.5)] · shadow-[0_0_24px_rgba(255,113,206,0.6)] md:shadow-[0_0_40px_rgba(255,113,206,0.6)] · shadow-none |
| 阴影 hover / focus | hover:shadow-[0_0_32px_rgba(1,205,254,0.7)] · focus:shadow-[0_0_20px_rgba(1,205,254,0.6)] |
| 彩色阴影 | pink: shadow-[0_0_20px_rgba(255,113,206,0.6)] · cyan: shadow-[0_0_20px_rgba(1,205,254,0.6)] · purple: shadow-[0_0_20px_rgba(185,103,255,0.6)] |
| 过渡 / 按下态 | transition-all duration-300 ease-in-out · active:scale-95 |
| 标题字体 / 正文字体 / 等宽字体 | font-bold tracking-wide · font-sans · font-mono |
| 字号 · hero | text-4xl md:text-6xl lg:text-8xl |
| 字号 · h1 | text-3xl md:text-5xl |
| 字号 · h2 | text-2xl md:text-4xl |
| 字号 · h3 | text-xl md:text-2xl |
| 字号 · body | text-sm md:text-base |
| 字号 · small | text-xs md:text-sm |
| 区块间距 / 容器内边距 / 卡片内边距 | py-12 md:py-20 lg:py-28 · px-4 md:px-8 lg:px-12 · p-5 md:p-8 |
| 间距 · sm | gap-3 md:gap-4 |
| 间距 · md | gap-4 md:gap-6 |
| 间距 · lg | gap-6 md:gap-10 |
| 底色 主 / 次 | bg-[#1a0a2e] · bg-[#16082a] |
| 底色 · 强调 | bg-[#ff71ce] · bg-[#01cdfe] · bg-[#b967ff] · bg-[#05ffa1] |
| 文字 主 / 次 / 弱 | text-[#ff71ce] · text-[#01cdfe] · text-[#b967ff]/70 |
| 按钮 · primary | bg-gradient-to-r from-[#ff71ce] to-[#b967ff] text-white |
| 按钮 · secondary | bg-[#01cdfe]/20 text-[#01cdfe] border border-[#01cdfe]/50 |
| 按钮 · danger | bg-red-500/80 text-white |
| 必须包含 · button | rounded-xl · shadow-[0_0_16px_rgba(255,113,206,0.5)] · hover:shadow-[0_0_32px_rgba(1,205,254,0.7)] · transition-all duration-300 ease-in-out · font-bold |
| 必须包含 · card | rounded-xl · bg-[#1a0a2e]/80 · border border-[#ff71ce]/50 · shadow-[0_0_16px_rgba(255,113,206,0.5)] |
| 必须包含 · input | rounded-xl · border border-[#b967ff]/50 · bg-[#1a0a2e]/60 · text-[#01cdfe] · focus:shadow-[0_0_20px_rgba(1,205,254,0.6)] · focus:outline-none |

---

## 十二、来源与许可

- 素材仓库：AnxForever/**stylekit**（MIT License, © 2026 AnxForever）
- 源文件：`lib/styles/vaporwave.ts`、`lib/styles/vaporwave-tokens.ts`
- 转换脚本：`D:\项目\scripts\convert-stylekit-systems.mjs`（一次性、可复跑）
- 局部改动：按 `aiRules` 剔除 `globalCss` 中的矛盾项（见第八节），其余内容保持源样。
- 注意：源仓库的 `components` 字段含可复制的 JSX 组件代码模板，本轮**未纳入**设计系统格式（本项目格式无组件槽位）。
