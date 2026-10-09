---
name: 拟物设计（Skeuomorphism）
description: 模拟真实世界物体的数字设计风格，通过纹理、光影、材质模仿现实物品，带来熟悉感和直觉性体验。
triggers:
  - 拟物设计
  - Skeuomorphism
  - 拟物
  - 写实
  - 纹理
  - 质感
  - 真实
  - 3D
od:
  category: style-retro
---

# 拟物设计（Skeuomorphism）

## 一、一句话定位

模拟真实世界物体的数字设计风格，通过纹理、光影、材质模仿现实物品，带来熟悉感和直觉性体验。

- 英文名：**Skeuomorphism**
- 风格类型：`visual`（视觉风格：靠色彩/材质/字体塑造）
- 关键词：拟物、写实、纹理、质感、真实、3D、阴影、retro、vintage、nostalgic
- 适用场景提示：拟物：皮革、拉丝金属、缝合线等真实材质隐喻
- 源风格分类：`retro`

---

## 二、设计哲学（源 `philosophy` 字段）

Skeuomorphism（拟物设计）是一种模拟真实世界物体外观和行为的设计方法，曾在早期 iOS 和数字产品中广泛使用。

核心理念：
- 真实模拟：界面元素模仿现实物品的外观和触感
- 材质纹理：皮革、木材、金属等真实材质纹理
- 光影深度：通过高光、阴影创造立体感
- 熟悉直觉：利用用户对现实世界的认知减少学习成本

> ⚠️ 已剔除 5 句跨风格重复的通用模板句（判定标准：在 ≥10 套风格里逐字重复）。被剔除的是「视觉一致性：所有组件必须遵循统一的视觉语言，从色彩到…」「层次分明：通过颜色深浅、字号大小、留白空间建立清晰的…」「交互反馈：每个可交互元素都必须有明确的 hover、…」「响应式适配：设计必须在移动端、平板、桌面端上保持一致…」「无障碍性：确保色彩对比度符合 WCAG 2.1 AA…」这类与具体风格无关的套话，保留的是该风格独有的美学主张。

---

## 三、色彩逻辑

| 项 | 值 |
|---|---|
| 主色 primary | `#8b7355` |
| 辅色 secondary | `#d4c4a8` |
| 强调色 accent | `#c9a227`、`#5c4033`、`#2e5a3c`、`#4bc542` |

配套的 Tailwind 类名配方（来自 `skeuomorphism-tokens.ts`）：

- 底色 主 / 次：bg-gradient-to-b from-[#e8dfd1] to-[#d4c4a8] · bg-[#8b7355]
- 底色 强调：bg-[#b8a88a] · bg-[#6b5b45] · bg-[#c9b896] · bg-[#a0926e]
- 文字 主 / 次 / 弱：text-[#3a2f22] · text-[#6b5b45] · text-[#8b7355]

**用色纪律**（源 `doList` 中与颜色相关的条目）：

- （无）

---

## 四、字体性格

- 标题：font-sans font-bold
- 正文：font-sans
- 等宽：font-mono

字号阶梯：

| 项 | 值 |
|---|---|
| `hero` | `text-3xl md:text-5xl lg:text-6xl` |
| `h1` | `text-2xl md:text-4xl` |
| `h2` | `text-xl md:text-3xl` |
| `h3` | `text-lg md:text-xl` |
| `body` | `text-sm md:text-base` |
| `small` | `text-xs md:text-sm` |

---

## 五、圆角与间距哲学

| 项 | 值 |
|---|---|
| 圆角 | `rounded-lg` |
| 边框 | `border border-solid border-[#a89880]` |

| 项 | 值 |
|---|---|
| 区块间距 section | `py-10 md:py-16 lg:py-24` |
| 容器内边距 container | `px-4 md:px-8 lg:px-12` |
| 卡片内边距 card | `p-4 md:p-6` |
| 间距 gap · sm | `gap-2 md:gap-3` |
| 间距 gap · md | `gap-3 md:gap-5` |
| 间距 gap · lg | `gap-5 md:gap-8` |

---

## 六、交互、阴影与状态

| 项 | 值 |
|---|---|
| 过渡 | `transition-all duration-200 ease-out` |
| 按下态 | `active:translate-y-px` |
| 阴影 sm / md / lg / none | `shadow-[0_1px_3px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.24)]` · `shadow-[0_3px_6px_rgba(0,0,0,0.16),0_3px_6px_rgba(0,0,0,0.23)]` · `shadow-[0_10px_20px_rgba(0,0,0,0.19),0_6px_6px_rgba(0,0,0,0.23)]` · `shadow-none` |
| 阴影 hover / focus | `hover:shadow-[0_14px_28px_rgba(0,0,0,0.25),0_10px_10px_rgba(0,0,0,0.22)]` · `focus:shadow-[0_3px_6px_rgba(0,0,0,0.16),0_3px_6px_rgba(0,0,0,0.23)]` |
| 彩色阴影 | brown: `shadow-[0_3px_6px_rgba(139,115,85,0.3),0_3px_6px_rgba(139,115,85,0.2)]` · dark: `shadow-[0_3px_6px_rgba(0,0,0,0.25),0_3px_6px_rgba(0,0,0,0.2)]` |

---

## 七、禁忌（源 `forbidden` 字段，含**为什么**禁）

> 这一节是 stylekit 最有价值的资产之一：它不仅列出禁用项，还给出了理由。理由直接来自源数据，
> 未做改写，便于直接喂给模型做生成后自检。

| 项 | 值 |
|---|---|
| `shadow-[4px_4px_0px` | Skeuomorphism uses realistic multi-layer blurred shadows, not hard-edge |
| `rounded-none` | Skeuomorphism uses moderate rounding (rounded-lg) for realistic surfaces |
| `bg-white` | Skeuomorphism uses textured gradient backgrounds, not flat colors |
| `border-black` | Skeuomorphism uses subtle tonal borders matching the surface material |
| 其他禁用类名 | `bg-black`、`border-4`、`shadow-[2px_2px_0px`、`shadow-[8px_8px_0px`、`font-black` |
| 其他禁用正则 | `^shadow-\[\d+px_\d+px_0px`、`^rounded-none$`、`^bg-(?:white\|black)$`、`^border-(?:black\|4)$` |

另外，源 `dontList` 以自然语言补充：

- 禁止使用纯扁平的色块
- 禁止省略阴影和高光
- 禁止使用过于简化的图标
- 禁止忽视材质细节

---

## 八、一致性清洗记录

本套风格的 `globalCss` 未发现与 `aiRules` 自相矛盾之处，**未做剔除**。

本套风格未推导出任何整类禁令（其 `forbidden` 只针对具体类名，不做整类剔除），因此 **`globalCss` 未做整类剔除**。

### 转换附带处理

- 源 `globalCss` 引用了从未定义的变量 `--skeuomorphism-primary`，已用 `colors` 字段补齐 1 个 `:root` 变量，保证 tokens.css 与 design-tokens.json 一致、且不留悬空引用

---

## 九、AI 硬规则（源 `aiRules` 全文，生成时应逐条遵守）

```text
你是一个 Skeuomorphism 设计风格的前端开发专家。生成的所有代码必须严格遵守以下约束：

## 绝对禁止

- 使用纯扁平的色块
- 省略阴影和高光效果
- 使用过于简化的图标
- 忽视材质和纹理细节

## 必须遵守

- 渐变背景 bg-gradient-to-b from-gray-100 to-gray-300
- 复杂阴影 shadow-[0_4px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.8)]
- 边框层次 border border-gray-400
- 圆角适中 rounded-lg
- 按压反馈 active:translate-y-[1px]

## 配色

- 使用自然材质色调
- 皮革棕: #8b7355
- 木材米: #d4c4a8
- 金属银: #c0c0c0
- 纸张白: #f5f5dc

## 光影原则

- 顶部高光 (inset 0 1px 0 rgba(255,255,255,0.8))
- 底部暗边 (inset 0 -1px 0 rgba(0,0,0,0.1))
- 外部投影 (0 4px 8px rgba(0,0,0,0.3))

## Animation & Interaction Rules

- Tactile Resistance: active 状态使用短时下压和更紧凑外阴影，模拟按键阻尼，不使用弹跳放大。
- Fixed Illuminant: 顶部高光和底部暗边在 hover 与 active 中保持稳定，确保光源始终来自上方。
- Texture Shimmer: 材质层允许轻微 background-position 位移，表达金属拉丝或皮革纹理的受光变化。
- Embossed Focus: 输入焦点优先加深 inset 阴影，而不是强烈外发光轮廓。

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

- **button** 必须含：`rounded-lg` · `border border-[#a89880]` · `shadow-[0_3px_6px_rgba(0,0,0,0.16),0_3px_6px_rgba(0,0,0,0.23)]` · `hover:-translate-y-px` · `transition-all duration-200 ease-out` · `font-bold`
- **card** 必须含：`rounded-lg` · `border border-[#a89880]` · `shadow-[0_3px_6px_rgba(0,0,0,0.16),0_3px_6px_rgba(0,0,0,0.23)]` · `bg-gradient-to-b from-[#e8dfd1] to-[#d4c4a8]`
- **input** 必须含：`rounded-lg` · `border border-[#a89880]` · `bg-[#f5efe6]` · `font-sans` · `focus:shadow-[0_3px_6px_rgba(0,0,0,0.16),0_3px_6px_rgba(0,0,0,0.23)]` · `focus:outline-none`

示例提示词（源 `examplePrompts`）：

1. **复古音乐播放器**（Retro Music Player）—— 仿真实收音机的音乐播放界面
   ```text
   用 Skeuomorphism 风格创建一个复古音乐播放器界面，要求：
1. 背景：模拟木质或金属材质
2. 按钮：带有真实按压感的 3D 效果
3. 旋钮：模拟真实旋钮的外观
4. 显示屏：模拟 LCD 或复古显示器
5. 整体有复古电子设备的质感
   ```
2. **SaaS 着陆页**（SaaS Landing Page）—— 生成 拟物设计风格的 SaaS 产品着陆页
   ```text
   Create a SaaS landing page using Skeuomorphism style with hero section, feature grid, testimonials, pricing table, and footer.
   ```
3. **作品集展示**（Portfolio Showcase）—— 生成 拟物设计风格的作品集页面
   ```text
   Create a portfolio showcase page using Skeuomorphism style with project grid, about section, contact form, and consistent visual language.
   ```

---

## 十一、token 配方总表（源 `skeuomorphism-tokens.ts`，Tailwind 类名字符串）

> 这些是**类名配方**而非 CSS 变量——stylekit 的 token 层就是"每个视觉位该用哪些 Tailwind 类"。
> 同目录 `tokens.css` 是该风格 `globalCss` 里的 CSS 变量与工具类（已做一致性清洗）；
> `design-tokens.json` 是扁平 key-value 形式，便于按需注入。

| 项 | 值 |
|---|---|
| 边框宽度 / 颜色 / 圆角 / 风格 | border · border-[#a89880] · rounded-lg · border-solid |
| 阴影 sm / md / lg / none | shadow-[0_1px_3px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.24)] · shadow-[0_3px_6px_rgba(0,0,0,0.16),0_3px_6px_rgba(0,0,0,0.23)] · shadow-[0_10px_20px_rgba(0,0,0,0.19),0_6px_6px_rgba(0,0,0,0.23)] · shadow-none |
| 阴影 hover / focus | hover:shadow-[0_14px_28px_rgba(0,0,0,0.25),0_10px_10px_rgba(0,0,0,0.22)] · focus:shadow-[0_3px_6px_rgba(0,0,0,0.16),0_3px_6px_rgba(0,0,0,0.23)] |
| 彩色阴影 | brown: shadow-[0_3px_6px_rgba(139,115,85,0.3),0_3px_6px_rgba(139,115,85,0.2)] · dark: shadow-[0_3px_6px_rgba(0,0,0,0.25),0_3px_6px_rgba(0,0,0,0.2)] |
| 过渡 / 按下态 | transition-all duration-200 ease-out · active:translate-y-px |
| 标题字体 / 正文字体 / 等宽字体 | font-sans font-bold · font-sans · font-mono |
| 字号 · hero | text-3xl md:text-5xl lg:text-6xl |
| 字号 · h1 | text-2xl md:text-4xl |
| 字号 · h2 | text-xl md:text-3xl |
| 字号 · h3 | text-lg md:text-xl |
| 字号 · body | text-sm md:text-base |
| 字号 · small | text-xs md:text-sm |
| 区块间距 / 容器内边距 / 卡片内边距 | py-10 md:py-16 lg:py-24 · px-4 md:px-8 lg:px-12 · p-4 md:p-6 |
| 间距 · sm | gap-2 md:gap-3 |
| 间距 · md | gap-3 md:gap-5 |
| 间距 · lg | gap-5 md:gap-8 |
| 底色 主 / 次 | bg-gradient-to-b from-[#e8dfd1] to-[#d4c4a8] · bg-[#8b7355] |
| 底色 · 强调 | bg-[#b8a88a] · bg-[#6b5b45] · bg-[#c9b896] · bg-[#a0926e] |
| 文字 主 / 次 / 弱 | text-[#3a2f22] · text-[#6b5b45] · text-[#8b7355] |
| 按钮 · primary | bg-gradient-to-b from-[#b8a88a] to-[#8b7355] text-white |
| 按钮 · secondary | bg-gradient-to-b from-[#e8dfd1] to-[#d4c4a8] text-[#3a2f22] |
| 按钮 · danger | bg-gradient-to-b from-[#c0392b] to-[#962d22] text-white |
| 必须包含 · button | rounded-lg · border border-[#a89880] · shadow-[0_3px_6px_rgba(0,0,0,0.16),0_3px_6px_rgba(0,0,0,0.23)] · hover:-translate-y-px · transition-all duration-200 ease-out · font-bold |
| 必须包含 · card | rounded-lg · border border-[#a89880] · shadow-[0_3px_6px_rgba(0,0,0,0.16),0_3px_6px_rgba(0,0,0,0.23)] · bg-gradient-to-b from-[#e8dfd1] to-[#d4c4a8] |
| 必须包含 · input | rounded-lg · border border-[#a89880] · bg-[#f5efe6] · font-sans · focus:shadow-[0_3px_6px_rgba(0,0,0,0.16),0_3px_6px_rgba(0,0,0,0.23)] · focus:outline-none |

---

## 十二、来源与许可

- 素材仓库：AnxForever/**stylekit**（MIT License, © 2026 AnxForever）
- 源文件：`lib/styles/skeuomorphism.ts`、`lib/styles/skeuomorphism-tokens.ts`
- 转换脚本：`D:\项目\scripts\convert-stylekit-systems.mjs`（一次性、可复跑）
- 局部改动：按 `aiRules` 剔除 `globalCss` 中的矛盾项（见第八节），其余内容保持源样。
- 注意：源仓库的 `components` 字段含可复制的 JSX 组件代码模板，本轮**未纳入**设计系统格式（本项目格式无组件槽位）。
