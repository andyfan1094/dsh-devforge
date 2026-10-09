---
name: 玻璃拟态（Glassmorphism）
description: 夜航质感的高级毛玻璃。深墨夜景配克制光源，玻璃只借光、不带色：高斯模糊、饱和度增强、受光顶边与噪点颗粒，营造真实玻璃的安静高级感。
triggers:
  - 玻璃拟态
  - Glassmorphism
  - glassmorphism
  - frosted
  - blur
  - refraction
  - translucent
  - nocturne
od:
  category: style-modern
---

# 玻璃拟态（Glassmorphism）

## 一、一句话定位

夜航质感的高级毛玻璃。深墨夜景配克制光源，玻璃只借光、不带色：高斯模糊、饱和度增强、受光顶边与噪点颗粒，营造真实玻璃的安静高级感。

- 英文名：**Glassmorphism**
- 风格类型：`visual`（视觉风格：靠色彩/材质/字体塑造）
- 关键词：glassmorphism、frosted、blur、refraction、translucent、nocturne、modern、premium、玻璃拟态、夜景、毛玻璃
- 适用场景提示：玻璃拟态：折射、色散与内发光的真实玻璃面板
- 源风格分类：`modern`

---

## 二、设计哲学（源 `philosophy` 字段）

玻璃拟态的本质是光学，不是配色。真实的玻璃没有颜色——它只是借用、弯曲、柔化背后的光。这也是 Apple 在 Liquid Glass 材质规范里坚持的原则：玻璃从内容层取色，自己保持中性。

核心理念：
- 玻璃无色：面板只用白色低透明度（5%-12%），所有颜色来自背景场景
- 深色夜景：背景是接近黑的深墨蓝场景，配少量柔和光源（light wells），玻璃才有东西可折射
- 光有方向：顶边受光（inset 高光）、底边背光（inset 暗缘），这是真玻璃与"半透明色块"的分界线
- 唯一强调色：香槟金 #E4B863 只出现在主要动作和高亮文字，绝不大面积铺色
- 颗粒质感：2%-3% 噪点叠加消除塑料感
- 流体动效：所有过渡使用 spring easing，模拟玻璃的物理惯性

> ⚠️ 已剔除 5 句跨风格重复的通用模板句（判定标准：在 ≥10 套风格里逐字重复）。被剔除的是「视觉一致性：所有组件必须遵循统一的视觉语言，从色彩到…」「层次分明：通过颜色深浅、字号大小、留白空间建立清晰的…」「交互反馈：每个可交互元素都必须有明确的 hover、…」「响应式适配：设计必须在移动端、平板、桌面端上保持一致…」「无障碍性：确保色彩对比度符合 WCAG 2.1 AA…」这类与具体风格无关的套话，保留的是该风格独有的美学主张。

---

## 三、色彩逻辑

| 项 | 值 |
|---|---|
| 主色 primary | `rgba(255, 255, 255, 0.08)` |
| 辅色 secondary | `rgba(255, 255, 255, 0.05)` |
| 强调色 accent | `#0B1322`、`#33517A`、`#7C9CC4`、`#E4B863` |

配套的 Tailwind 类名配方（来自 `glassmorphism-tokens.ts`）：

- 底色 主 / 次：bg-white/8 backdrop-blur-[40px] backdrop-saturate-[180%] · bg-white/12 backdrop-blur-[60px] backdrop-saturate-[180%]
- 底色 强调：bg-[radial-gradient(640px_circle_at_85%_10%,rgba(124,156,196,0.25),transparent_60%),radial-gradient(560px_circle_at_10%_90%,rgba(51,81,122,0.3),transparent_60%)] bg-[#0B1322] · bg-[radial-gradient(640px_circle_at_80%_15%,rgba(201,143,78,0.22),transparent_60%),radial-gradient(560px_circle_at_12%_88%,rgba(92,58,30,0.35),transparent_60%)] bg-[#120D0A] · bg-[radial-gradient(640px_circle_at_85%_12%,rgba(127,182,158,0.2),transparent_60%),radial-gradient(560px_circle_at_10%_88%,rgba(31,77,58,0.35),transparent_60%)] bg-[#081210]
- 文字 主 / 次 / 弱：text-white · text-white/80 · text-white/50

**用色纪律**（源 `doList` 中与颜色相关的条目）：

- 背景使用深墨夜景底色（#0B1322 一类）+ 2-3 个大半径柔和光源光斑（radial-gradient light wells）
- 玻璃面板使用 bg-white/5 到 bg-white/12，配 backdrop-blur-[40px] 或 backdrop-blur-[60px]
- 光有方向：inset 0 1px 0 白色高光（顶边受光）+ inset 0 -1px 0 深色暗缘（底边背光）+ 外层深阴影
- 唯一强调色香槟金 #E4B863，只用于主 CTA、关键数字和高亮文字

---

## 四、字体性格

- 标题：font-semibold text-white
- 正文：text-white/80
- 等宽：font-mono text-white/85

字号阶梯：

| 项 | 值 |
|---|---|
| `hero` | `text-4xl md:text-6xl` |
| `h1` | `text-3xl md:text-5xl` |
| `h2` | `text-2xl md:text-3xl` |
| `h3` | `text-xl md:text-2xl` |
| `body` | `text-sm md:text-base` |
| `small` | `text-xs` |

---

## 五、圆角与间距哲学

| 项 | 值 |
|---|---|
| 圆角 | `rounded-3xl` |
| 边框 | `border border-solid border-white/15` |

| 项 | 值 |
|---|---|
| 区块间距 section | `py-16 md:py-24` |
| 容器内边距 container | `px-6 md:px-8` |
| 卡片内边距 card | `p-6 md:p-8` |
| 间距 gap · sm | `gap-4` |
| 间距 gap · md | `gap-6` |
| 间距 gap · lg | `gap-8` |

---

## 六、交互、阴影与状态

| 项 | 值 |
|---|---|
| 过渡 | `transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]` |
| 按下态 | `active:scale-[0.97]` |
| 阴影 sm / md / lg / none | `shadow-[0_2px_8px_rgba(3,7,18,0.35),inset_0_1px_0_rgba(255,255,255,0.18)]` · `shadow-[0_8px_24px_rgba(3,7,18,0.45),inset_0_1px_0_rgba(255,255,255,0.22),inset_0_-1px_0_rgba(2,6,16,0.3)]` · `shadow-[0_16px_48px_rgba(3,7,18,0.55),0_0_0_1px_rgba(255,255,255,0.08),inset_0_1px_0_rgba(255,255,255,0.25),inset_0_-1px_0_rgba(2,6,16,0.35)]` · `shadow-none` |
| 阴影 hover / focus | `hover:shadow-[0_20px_60px_rgba(3,7,18,0.65),0_0_0_1px_rgba(255,255,255,0.12),inset_0_1px_0_rgba(255,255,255,0.32)]` · `focus:shadow-[0_0_0_3px_rgba(228,184,99,0.18),0_8px_24px_rgba(3,7,18,0.45)]` |
| 彩色阴影 | inner: `shadow-[inset_0_1px_1px_rgba(255,255,255,0.3),inset_0_-1px_1px_rgba(2,6,16,0.35)]` · glow: `shadow-[0_0_40px_rgba(124,156,196,0.15),0_0_80px_rgba(124,156,196,0.05)]` · blue: `shadow-[0_0_24px_rgba(124,156,196,0.3),inset_0_1px_0_rgba(124,156,196,0.2)]` · green: `shadow-[0_0_16px_rgba(228,184,99,0.3),inset_0_1px_0_rgba(228,184,99,0.2)]` |

---

## 七、禁忌（源 `forbidden` 字段，含**为什么**禁）

> 这一节是 stylekit 最有价值的资产之一：它不仅列出禁用项，还给出了理由。理由直接来自源数据，
> 未做改写，便于直接喂给模型做生成后自检。

| 项 | 值 |
|---|---|
| `rounded-none` | Glassmorphism requires large rounded corners (rounded-2xl or rounded-3xl) |
| `rounded-sm` | Glassmorphism requires large rounded corners (rounded-2xl or rounded-3xl) |
| `rounded` | Glassmorphism requires large rounded corners (rounded-2xl or rounded-3xl) |
| `bg-white` | Glassmorphism uses semi-transparent surfaces (bg-white/5 to bg-white/12) |
| `bg-black` | Glassmorphism requires semi-transparent surfaces, not opaque colors |
| `backdrop-blur-sm` | Glassmorphism requires high blur (backdrop-blur-[40px] or higher) |
| `backdrop-blur` | Glassmorphism requires high blur (backdrop-blur-[40px] or higher) |
| `duration-100` | Glassmorphism uses fluid animations (duration-500 with spring easing) |
| `duration-150` | Glassmorphism uses fluid animations (duration-500 with spring easing) |
| `border-black` | Glassmorphism uses luminous white borders (border-white/15 to border-white/35) |
| `from-indigo-600` | The purple-pink AI gradient is the exact cliche this style rejects; use deep night scenes with light wells |
| `via-purple-600` | The purple-pink AI gradient is the exact cliche this style rejects; use deep night scenes with light wells |
| `to-pink-500` | The purple-pink AI gradient is the exact cliche this style rejects; use deep night scenes with light wells |
| 其他禁用类名 | `bg-gray-100`、`bg-gray-900`、`shadow-none`、`border-gray-500` |
| 其他禁用正则 | `^rounded-none`、`^rounded-sm$`、`^rounded$`、`^bg-(?!white\/\|gradient\|\[\|transparent)`、`^border-(?!white\/\|\[)`、`^backdrop-blur$`、`^backdrop-blur-sm$`、`^duration-(100\|150)$` |

另外，源 `dontList` 以自然语言补充：

- 禁止紫粉 AI 渐变背景（#667eea、#764ba2、#f093fb 一类的 indigo-purple-pink 组合）
- 禁止在纯色平面背景上使用（必须有光源或图片，玻璃才有东西可模糊）
- 禁止玻璃透明度超过 15%（会变成实心色块，失去玻璃感）
- 禁止使用低模糊值 backdrop-blur-sm 或 backdrop-blur
- 禁止省略 backdrop-saturate（饱和度增强让暗景光源透过玻璃发亮）
- 禁止给玻璃面板本身上色（玻璃无色，颜色属于背景）
- 禁止使用不透明背景 bg-white, bg-black
- 禁止使用直角或小圆角 rounded-none, rounded-sm
- 禁止使用快速过渡 duration-100, duration-150
- 禁止使用单层扁平阴影（必须外层深度 + 顶边高光 + 底边暗缘）

---

## 八、一致性清洗记录

本套风格的 `globalCss` 未发现与 `aiRules` 自相矛盾之处，**未做剔除**。

本套风格未推导出任何整类禁令（其 `forbidden` 只针对具体类名，不做整类剔除），因此 **`globalCss` 未做整类剔除**。

- ⚠️ 渐变：forbidden 里虽有渐变相关条目，但只禁具体的渐变类（如紫粉渐变组合），或对 `gradient` 作了显式豁免 —— **不构成整类禁令，未剔除**。

---

## 九、AI 硬规则（源 `aiRules` 全文，生成时应逐条遵守）

```text
# 玻璃拟态设计系统（Nocturne Glassmorphism）

你是一位专精于高级夜航玻璃拟态（Nocturne Glassmorphism）风格的前端开发专家。生成的所有代码都必须严格遵守以下规范。

## 风格身份
- **名称**：Nocturne Glassmorphism（夜航玻璃拟态）
- **分类**：现代、高端
- **本质**：无色玻璃覆于深夜场景之上——颜色由场景承载，玻璃只负责借光
- **气质**：安静的奢华感、电影感、沉稳、真实可信
- **灵感来源**：Apple Liquid Glass 材质规范（玻璃从内容层取色，自身永远保持中性）、建筑玻璃幕墙、雨夜车窗外的城市灯光

---

## 核心视觉原则

### 1. 场景先于玻璃（关键）
```
必须使用：深墨夜景底色 + 2-3 个柔和光源光斑。禁止使用平面渐变或紫粉渐变。

底色: #0B1322（深墨蓝）或 #060A13（近黑）
光源光斑（radial-gradient，大半径，柔和）：
<div class="absolute -top-32 -right-20 w-[560px] h-[560px] rounded-full"
  style="background: radial-gradient(circle, rgba(124,156,196,0.28) 0%, transparent 65%)" />
<div class="absolute -bottom-36 -left-24 w-[520px] h-[520px] rounded-full"
  style="background: radial-gradient(circle, rgba(51,81,122,0.35) 0%, transparent 65%)" />
可选的单一暖色点缀：
  radial-gradient(circle, rgba(228,184,99,0.12) 0%, transparent 60%)
```

### 2. 玻璃面板三层结构
```
第 1 层 — 无色玻璃表面：
bg-white/5 到 bg-white/12（禁止上色，禁止超过 15%）
backdrop-blur-[40px] 或 backdrop-blur-[60px]
backdrop-saturate-[180%]

第 2 层 — 内发光：
<span class="absolute inset-0 bg-gradient-to-b from-white/12 to-transparent pointer-events-none" />

第 3 层 — 方向性阴影（光从上方而来）：
shadow-[0_16px_40px_rgba(3,7,18,0.5),inset_0_1px_0_rgba(255,255,255,0.22),inset_0_-1px_0_rgba(2,6,16,0.35)]
```

### 3. 颗粒噪点
```
全屏叠加 2%-3% 的 SVG feTurbulence 噪点，消除塑料感：
opacity: 0.025; background-image: url("data:image/svg+xml,...feTurbulence type='fractalNoise' baseFrequency='0.8'...")
```

### 4. 边框系统
```
默认: border border-white/15
Hover: border-white/30 到 border-white/35
```

### 5. 圆角
```
必须使用: rounded-2xl (16px) 或 rounded-3xl (24px)
```

---

## 交互规范

### Hover 效果
| 元素 | 效果 | 实现 |
|---------|--------|----------------|
| 卡片 | 上浮 + 阴影加深 | hover:-translate-y-1 hover:shadow-[0_24px_64px_rgba(3,7,18,0.6),inset_0_1px_0_rgba(255,255,255,0.32),inset_0_-1px_0_rgba(2,6,16,0.35)] |
| 按钮 | 轻微上浮 + 边框提亮 | hover:-translate-y-0.5 hover:border-white/35 hover:bg-white/15 |
| 链接 | 背景浮现 | hover:bg-white/8 |

### 扫光高光（光反射）
```jsx
<span className="absolute inset-0 -translate-x-[150%] skew-x-[-20deg]
  bg-gradient-to-r from-transparent via-white/25 to-transparent
  group-hover:translate-x-[150%] transition-transform duration-700 ease-out
  pointer-events-none" />
```

### Active 状态
```
active:scale-[0.97]
```

---

## 动效规则

### Spring 物理
```
transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]
```

### 时长参考
| 交互 | 时长 | 缓动 |
|-------------|----------|--------|
| Hover 上浮 | 500ms | cubic-bezier(0.16,1,0.3,1) |
| 扫光高光 | 700ms | ease-out |
| Focus 光晕 | 500ms | cubic-bezier(0.16,1,0.3,1) |
| Active 按下 | 150ms | ease-out |

---

## 配色方案

### 夜景场景（背景拥有全部颜色）
| Token | Hex | 用途 |
|-------|-----|-------|
| 近黑 | #060A13 | 最深的底色，页面边缘 |
| 深墨蓝 | #0B1322 | 主背景 |
| 钢蓝抬升 | #16233A | 抬升区域、分区色带 |
| 月光钢蓝 | #33517A | 光源光斑颜色（深） |
| 月光 | #7C9CC4 | 光源光斑颜色（亮） |

### 玻璃表面（永远无色）
| Token | 值 | 用途 |
|-------|-------|-------|
| 玻璃背景 | bg-white/5 到 bg-white/12 | 面板背景 |
| 玻璃背景 Hover | bg-white/10 到 bg-white/16 | Hover 状态 |
| 边框 | border-white/15 | 默认边框 |
| 边框 Hover | border-white/30 | Hover 边框 |
| 主文字 | text-white | 标题 |
| 次要文字 | text-white/60 | 正文 |
| 弱化文字 | text-white/40 | 说明文字 |

### 唯一强调色（克制使用）
| Token | Hex | 用途 |
|-------|-----|-------|
| 香槟金 | #E4B863 | 主 CTA 填充（/15-/22 透明度）、关键数字、边框（/40） |
| 亮香槟 | #F3DCA8 | 香槟按钮上的文字、高亮词语 |

香槟按钮配方：
```
bg-[#E4B863]/15 border border-[#E4B863]/40 text-[#F3DCA8]
shadow-[0_4px_20px_rgba(228,184,99,0.15),inset_0_1px_0_rgba(243,220,168,0.35)]
hover:bg-[#E4B863]/22 hover:border-[#E4B863]/55
```

---

## 禁止使用的模式

| 模式 | 原因 |
|---------|--------|
| #667eea / #764ba2 / #f093fb 渐变 | 这正是本风格明确拒绝的通用 AI 紫粉配色 |
| 上色的玻璃面板（如 bg-purple-500/20） | 玻璃无色；颜色属于场景 |
| 玻璃透明度超过 15% | 会变成实心色块，破坏玻璃错觉 |
| 纯色平面背景 | 没有可供折射的东西 |
| 面板使用 bg-white, bg-black | 玻璃需要半透明 |
| backdrop-blur-sm, backdrop-blur | 模糊不足 |
| 省略 backdrop-saturate | 场景光源无法透过玻璃发亮 |
| 单层阴影 | 没有光的方向，看起来是平面半透明 |
| rounded-none, rounded-sm | 直角破坏玻璃感 |
| duration-100, duration-150 | 过快，失去流动感 |
| 多种强调色 | 只允许一种香槟金强调色 |

---

## 响应式规范

### 模糊值缩放
```
移动端: backdrop-blur-[30px]
桌面端 (md:): backdrop-blur-[40px] 到 backdrop-blur-[60px]
```

### 阴影缩放
```
移动端: shadow-[0_8px_24px_rgba(3,7,18,0.45),inset_0_1px_0_rgba(255,255,255,0.18)]
桌面端: shadow-[0_16px_40px_rgba(3,7,18,0.5),inset_0_1px_0_rgba(255,255,255,0.22),inset_0_-1px_0_rgba(2,6,16,0.35)]
```

### 内边距
```
卡片: p-6 md:p-8 lg:p-10
按钮: px-5 py-3 md:px-6 md:py-3.5
```

---

## 组件模板

### 玻璃卡片
```jsx
<div className="group relative p-6 md:p-8
  bg-white/8 backdrop-blur-[60px] backdrop-saturate-[180%]
  border border-white/15 rounded-3xl
  shadow-[0_16px_40px_rgba(3,7,18,0.5),inset_0_1px_0_rgba(255,255,255,0.22),inset_0_-1px_0_rgba(2,6,16,0.35)]
  hover:border-white/30
  hover:shadow-[0_24px_64px_rgba(3,7,18,0.6),inset_0_1px_0_rgba(255,255,255,0.32),inset_0_-1px_0_rgba(2,6,16,0.35)]
  hover:-translate-y-1
  transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]
  overflow-hidden">
  {/* Inner luminance */}
  <span className="absolute inset-0 bg-gradient-to-b from-white/12 to-transparent pointer-events-none" />
  {/* Content */}
  <div className="relative z-10">...</div>
</div>
```

---

## 自检清单

输出代码前请逐项确认：
- [ ] 背景是深墨夜景 + 柔和光源光斑（不是平面渐变，更不是紫粉渐变）
- [ ] 玻璃面板是 5%-12% 透明度的无色白玻璃
- [ ] 存在 backdrop-blur-[40px] 或更高的模糊值
- [ ] 存在 backdrop-saturate-[180%]
- [ ] 阴影有方向性（外层深度 + 顶边高光 + 底边暗缘）
- [ ] 叠加了颗粒噪点
- [ ] 香槟金 #E4B863 只出现在主要操作/高亮位置
- [ ] 边框使用 border-white/15
- [ ] 圆角是 rounded-2xl 或 rounded-3xl
- [ ] 过渡使用 spring easing cubic-bezier(0.16,1,0.3,1)
- [ ] 正文文字是 white/60 或更亮
```

---

## 十、必须包含项与示例提示词

- **button** 必须含：`bg-white/10 backdrop-blur-[40px] backdrop-saturate-[180%]` · `border border-white/20` · `rounded-2xl` · `text-white` · `shadow-[0_4px_16px_rgba(3,7,18,0.45),inset_0_1px_0_rgba(255,255,255,0.25),inset_0_-1px_0_rgba(2,6,16,0.3)]` · `hover:bg-white/15 hover:border-white/35 hover:shadow-[0_10px_32px_rgba(3,7,18,0.55),inset_0_1px_0_rgba(255,255,255,0.35)]` · `hover:-translate-y-0.5` · `transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]`
- **card** 必须含：`bg-white/8 backdrop-blur-[60px] backdrop-saturate-[180%]` · `border border-white/15` · `rounded-3xl` · `shadow-[0_16px_40px_rgba(3,7,18,0.5),inset_0_1px_0_rgba(255,255,255,0.22),inset_0_-1px_0_rgba(2,6,16,0.35)]` · `[background-image:linear-gradient(to_bottom,rgba(255,255,255,0.12),transparent_50%)]`
- **input** 必须含：`bg-white/6 backdrop-blur-[40px] backdrop-saturate-[180%]` · `border border-white/15` · `rounded-2xl` · `text-white placeholder-white/35` · `shadow-[inset_0_1px_0_rgba(255,255,255,0.15),inset_0_-1px_0_rgba(2,6,16,0.3)]` · `focus:outline-none focus:border-white/35 focus:bg-white/10` · `focus:shadow-[0_0_0_3px_rgba(228,184,99,0.15),inset_0_1px_0_rgba(255,255,255,0.25)]` · `transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]`

示例提示词（源 `examplePrompts`）：

1. **夜航玻璃仪表盘**（Nocturne Glass Dashboard）—— 深夜景毛玻璃数据面板
   ```text
   Create a nocturne glassmorphism dashboard with:
1. Background: deep ink #0B1322 with three soft radial light wells — rgba(124,156,196,0.28) top right, rgba(51,81,122,0.35) bottom left, rgba(228,184,99,0.12) center accent
2. Film grain: full-viewport 2.5% SVG feTurbulence noise overlay
3. Top nav: fixed, bg-white/6 backdrop-blur-[60px] backdrop-saturate-[180%], border-b border-white/10
4. Stat cards: bg-white/8 backdrop-blur-[60px], directional shadows (outer depth + inset top highlight + inset bottom shade), key numbers in champagne #E4B863, hover lift
5. Chart area: large colorless glass panel; chart line in moonlight #7C9CC4 with champagne highlight point
6. All transitions: duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]
7. Specular sweep on card hover; NO purple-pink gradients anywhere
   ```
2. **夜航玻璃登录页**（Nocturne Glass Login）—— 安静高级的深夜毛玻璃登录页
   ```text
   Create a nocturne glassmorphism login page with:
1. Background: near-black #060A13 to #0B1322, one moonlight well rgba(124,156,196,0.25) upper right, one faint champagne well rgba(228,184,99,0.1) lower left, 2.5% film grain
2. Login card: centered, bg-white/8 backdrop-blur-[60px] backdrop-saturate-[180%], rounded-3xl, shadow with inset top highlight and inset bottom shade
3. Inner luminance: gradient overlay from-white/12 to transparent at top
4. Inputs: bg-white/6, inset shade, focus ring rgba(228,184,99,0.15)
5. Submit button: the ONLY champagne element — bg-[#E4B863]/15 border-[#E4B863]/40 text-[#F3DCA8]
6. Serif display headline (e.g. Playfair Display) over the glass for editorial luxury
7. All corners rounded-2xl or rounded-3xl, spring easing transitions
   ```
3. **夜航玻璃音乐播放器**（Nocturne Glass Music Player）—— 沉浸式深夜毛玻璃音乐播放器
   ```text
   Create a nocturne glassmorphism music player with:
1. Background: blurred album art darkened with a rgba(6,10,19,0.6) scrim so the glass stays readable, plus 2.5% film grain
2. Player card: bg-white/8 backdrop-blur-[60px] backdrop-saturate-[180%], rounded-3xl, directional shadows
3. Album art: rounded-2xl with border-white/15 frame and inset top highlight
4. Controls: colorless glass buttons; the play button is the single champagne accent (#E4B863/15 fill, #F3DCA8 icon)
5. Progress bar: glass track bg-white/8; fill in moonlight #7C9CC4; thumb with champagne ring on drag
6. Playlist: glass sidebar with hover-highlighted rows (hover:bg-white/8)
7. All transitions spring easing; NO purple-pink gradients
   ```

---

## 十一、token 配方总表（源 `glassmorphism-tokens.ts`，Tailwind 类名字符串）

> 这些是**类名配方**而非 CSS 变量——stylekit 的 token 层就是"每个视觉位该用哪些 Tailwind 类"。
> 同目录 `tokens.css` 是该风格 `globalCss` 里的 CSS 变量与工具类（已做一致性清洗）；
> `design-tokens.json` 是扁平 key-value 形式，便于按需注入。

| 项 | 值 |
|---|---|
| 边框宽度 / 颜色 / 圆角 / 风格 | border · border-white/15 · rounded-3xl · border-solid |
| 阴影 sm / md / lg / none | shadow-[0_2px_8px_rgba(3,7,18,0.35),inset_0_1px_0_rgba(255,255,255,0.18)] · shadow-[0_8px_24px_rgba(3,7,18,0.45),inset_0_1px_0_rgba(255,255,255,0.22),inset_0_-1px_0_rgba(2,6,16,0.3)] · shadow-[0_16px_48px_rgba(3,7,18,0.55),0_0_0_1px_rgba(255,255,255,0.08),inset_0_1px_0_rgba(255,255,255,0.25),inset_0_-1px_0_rgba(2,6,16,0.35)] · shadow-none |
| 阴影 hover / focus | hover:shadow-[0_20px_60px_rgba(3,7,18,0.65),0_0_0_1px_rgba(255,255,255,0.12),inset_0_1px_0_rgba(255,255,255,0.32)] · focus:shadow-[0_0_0_3px_rgba(228,184,99,0.18),0_8px_24px_rgba(3,7,18,0.45)] |
| 彩色阴影 | inner: shadow-[inset_0_1px_1px_rgba(255,255,255,0.3),inset_0_-1px_1px_rgba(2,6,16,0.35)] · glow: shadow-[0_0_40px_rgba(124,156,196,0.15),0_0_80px_rgba(124,156,196,0.05)] · blue: shadow-[0_0_24px_rgba(124,156,196,0.3),inset_0_1px_0_rgba(124,156,196,0.2)] · green: shadow-[0_0_16px_rgba(228,184,99,0.3),inset_0_1px_0_rgba(228,184,99,0.2)] |
| 过渡 / 按下态 | transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] · active:scale-[0.97] |
| 标题字体 / 正文字体 / 等宽字体 | font-semibold text-white · text-white/80 · font-mono text-white/85 |
| 字号 · hero | text-4xl md:text-6xl |
| 字号 · h1 | text-3xl md:text-5xl |
| 字号 · h2 | text-2xl md:text-3xl |
| 字号 · h3 | text-xl md:text-2xl |
| 字号 · body | text-sm md:text-base |
| 字号 · small | text-xs |
| 区块间距 / 容器内边距 / 卡片内边距 | py-16 md:py-24 · px-6 md:px-8 · p-6 md:p-8 |
| 间距 · sm | gap-4 |
| 间距 · md | gap-6 |
| 间距 · lg | gap-8 |
| 底色 主 / 次 | bg-white/8 backdrop-blur-[40px] backdrop-saturate-[180%] · bg-white/12 backdrop-blur-[60px] backdrop-saturate-[180%] |
| 底色 · 强调 | bg-[radial-gradient(640px_circle_at_85%_10%,rgba(124,156,196,0.25),transparent_60%),radial-gradient(560px_circle_at_10%_90%,rgba(51,81,122,0.3),transparent_60%)] bg-[#0B1322] · bg-[radial-gradient(640px_circle_at_80%_15%,rgba(201,143,78,0.22),transparent_60%),radial-gradient(560px_circle_at_12%_88%,rgba(92,58,30,0.35),transparent_60%)] bg-[#120D0A] · bg-[radial-gradient(640px_circle_at_85%_12%,rgba(127,182,158,0.2),transparent_60%),radial-gradient(560px_circle_at_10%_88%,rgba(31,77,58,0.35),transparent_60%)] bg-[#081210] |
| 文字 主 / 次 / 弱 | text-white · text-white/80 · text-white/50 |
| 按钮 · primary | bg-white/12 text-white backdrop-blur-[40px] backdrop-saturate-[180%] |
| 按钮 · secondary | bg-white/6 text-white/85 backdrop-blur-[30px] backdrop-saturate-[160%] |
| 必须包含 · button | bg-white/10 backdrop-blur-[40px] backdrop-saturate-[180%] · border border-white/20 · rounded-2xl · text-white · shadow-[0_4px_16px_rgba(3,7,18,0.45),inset_0_1px_0_rgba(255,255,255,0.25),inset_0_-1px_0_rgba(2,6,16,0.3)] · hover:bg-white/15 hover:border-white/35 hover:shadow-[0_10px_32px_rgba(3,7,18,0.55),inset_0_1px_0_rgba(255,255,255,0.35)] · hover:-translate-y-0.5 · transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] |
| 必须包含 · card | bg-white/8 backdrop-blur-[60px] backdrop-saturate-[180%] · border border-white/15 · rounded-3xl · shadow-[0_16px_40px_rgba(3,7,18,0.5),inset_0_1px_0_rgba(255,255,255,0.22),inset_0_-1px_0_rgba(2,6,16,0.35)] · [background-image:linear-gradient(to_bottom,rgba(255,255,255,0.12),transparent_50%)] |
| 必须包含 · input | bg-white/6 backdrop-blur-[40px] backdrop-saturate-[180%] · border border-white/15 · rounded-2xl · text-white placeholder-white/35 · shadow-[inset_0_1px_0_rgba(255,255,255,0.15),inset_0_-1px_0_rgba(2,6,16,0.3)] · focus:outline-none focus:border-white/35 focus:bg-white/10 · focus:shadow-[0_0_0_3px_rgba(228,184,99,0.15),inset_0_1px_0_rgba(255,255,255,0.25)] · transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] |

---

## 十二、来源与许可

- 素材仓库：AnxForever/**stylekit**（MIT License, © 2026 AnxForever）
- 源文件：`lib/styles/glassmorphism.ts`、`lib/styles/glassmorphism-tokens.ts`
- 转换脚本：`D:\项目\scripts\convert-stylekit-systems.mjs`（一次性、可复跑）
- 局部改动：按 `aiRules` 剔除 `globalCss` 中的矛盾项（见第八节），其余内容保持源样。
- 注意：源仓库的 `components` 字段含可复制的 JSX 组件代码模板，本轮**未纳入**设计系统格式（本项目格式无组件槽位）。
