---
name: 新拟物派（Neumorphism）
description: 柔和的内凹外凸立体效果，通过双重阴影模拟光源，浅色背景配同色系元素，营造精致的立体感。
triggers:
  - 新拟物派
  - Neumorphism
  - 立体感
  - 双重阴影
  - 柔和
  - 浅色系
  - 内凹外凸
  - modern
od:
  category: style-modern
---

# 新拟物派（Neumorphism）

## 一、一句话定位

柔和的内凹外凸立体效果，通过双重阴影模拟光源，浅色背景配同色系元素，营造精致的立体感。

- 英文名：**Neumorphism**
- 风格类型：`visual`（视觉风格：靠色彩/材质/字体塑造）
- 关键词：立体感、双重阴影、柔和、浅色系、内凹外凸、modern、contemporary、sleek、现代、简洁
- 适用场景提示：新拟物：同色系凸起／凹陷的柔和实体感
- 源风格分类：`modern`

---

## 二、设计哲学（源 `philosophy` 字段）

Neumorphism（新拟物派）是一种介于扁平设计和拟物设计之间的风格，通过柔和的阴影创造出元素从背景中"挤压"或"凹陷"的视觉效果。

核心理念：
- 柔和立体：通过双重阴影（亮/暗）模拟自然光源
- 同色系统一：元素与背景使用相同或相近的颜色
- 触感直觉：凸起表示可交互，凹陷表示已激活或输入区
- 克制装饰：避免过多颜色和对比，保持整体柔和感

> ⚠️ 已剔除 5 句跨风格重复的通用模板句（判定标准：在 ≥10 套风格里逐字重复）。被剔除的是「视觉一致性：所有组件必须遵循统一的视觉语言，从色彩到…」「层次分明：通过颜色深浅、字号大小、留白空间建立清晰的…」「交互反馈：每个可交互元素都必须有明确的 hover、…」「响应式适配：设计必须在移动端、平板、桌面端上保持一致…」「无障碍性：确保色彩对比度符合 WCAG 2.1 AA…」这类与具体风格无关的套话，保留的是该风格独有的美学主张。

---

## 三、色彩逻辑

| 项 | 值 |
|---|---|
| 主色 primary | `#e0e5ec` |
| 辅色 secondary | `#d1d9e6` |
| 强调色 accent | `#6d5dfc`、`#ff6b6b`、`#4ecdc4`、`#ffe66d` |

配套的 Tailwind 类名配方（来自 `neumorphism-tokens.ts`）：

- 底色 主 / 次：bg-[#e0e5ec] · bg-[#f0f0f3]
- 底色 强调：bg-[#6d5dfc] · bg-[#ff6b6b] · bg-[#4ecdc4] · bg-[#ffe66d]
- 文字 主 / 次 / 弱：text-gray-800 · text-gray-600 · text-gray-400

**用色纪律**（源 `doList` 中与颜色相关的条目）：

- 使用浅色背景 bg-[#e0e5ec] 或 bg-[#f0f0f3]
- 保持元素与背景同色系
- 光源方向始终固定为左上亮、右下暗（Fixed Illuminant）：负 X/Y 偏移 = 白色高光，正 X/Y 偏移 = 暗色阴影

---

## 四、字体性格

- 标题：font-semibold text-gray-800
- 正文：text-gray-600
- 等宽：font-mono text-gray-700

字号阶梯：

| 项 | 值 |
|---|---|
| `hero` | `text-4xl md:text-6xl` |
| `h1` | `text-3xl md:text-4xl` |
| `h2` | `text-2xl md:text-3xl` |
| `h3` | `text-xl md:text-2xl` |
| `body` | `text-sm md:text-base` |
| `small` | `text-xs` |

---

## 五、圆角与间距哲学

| 项 | 值 |
|---|---|
| 圆角 | `rounded-xl` |
| 边框 | `border-0 border-none border-transparent` |

| 项 | 值 |
|---|---|
| 区块间距 section | `py-12 md:py-20` |
| 容器内边距 container | `px-6 md:px-8` |
| 卡片内边距 card | `p-6 md:p-8` |
| 间距 gap · sm | `gap-3 md:gap-4` |
| 间距 gap · md | `gap-4 md:gap-6` |
| 间距 gap · lg | `gap-6 md:gap-8` |

---

## 六、交互、阴影与状态

| 项 | 值 |
|---|---|
| 过渡 | `transition-all duration-200` |
| 按下态 | `active:shadow-[inset_4px_4px_8px_#b8bcc2,inset_-4px_-4px_8px_#ffffff]` |
| 阴影 sm / md / lg / none | `shadow-[4px_4px_8px_#b8bcc2,-4px_-4px_8px_#ffffff]` · `shadow-[6px_6px_12px_#b8bcc2,-6px_-6px_12px_#ffffff] md:shadow-[8px_8px_16px_#b8bcc2,-8px_-8px_16px_#ffffff]` · `shadow-[8px_8px_16px_#b8bcc2,-8px_-8px_16px_#ffffff] md:shadow-[12px_12px_24px_#b8bcc2,-12px_-12px_24px_#ffffff]` · `shadow-none` |
| 阴影 hover / focus | `hover:shadow-[4px_4px_8px_#b8bcc2,-4px_-4px_8px_#ffffff]` · `focus:shadow-[6px_6px_12px_#b8bcc2,-6px_-6px_12px_#ffffff]` |
| 彩色阴影 | pressed: `shadow-[inset_4px_4px_8px_#b8bcc2,inset_-4px_-4px_8px_#ffffff]` · pressedLg: `shadow-[inset_8px_8px_16px_#b8bcc2,inset_-8px_-8px_16px_#ffffff]` |

---

## 七、禁忌（源 `forbidden` 字段，含**为什么**禁）

> 这一节是 stylekit 最有价值的资产之一：它不仅列出禁用项，还给出了理由。理由直接来自源数据，
> 未做改写，便于直接喂给模型做生成后自检。

| 项 | 值 |
|---|---|
| `rounded-none` | Neumorphism requires rounded corners (rounded-xl or rounded-2xl) |
| `shadow-lg` | Neumorphism uses dual-shadow system, not standard shadows |
| `bg-white` | Neumorphism uses light gray backgrounds (#e0e5ec), not pure white |
| `bg-black` | Neumorphism uses light gray backgrounds, not black |
| `border-2` | Neumorphism avoids visible borders, shadows create separation |
| `bg-gradient-to-r` | Neumorphism uses solid colors, no gradients |
| 其他禁用类名 | `rounded-sm`、`shadow-sm`、`shadow`、`shadow-md`、`shadow-xl`、`shadow-2xl`、`bg-gray-900`、`bg-gray-950`、`border-4`、`border-8`、`border`、`bg-gradient-to-l`、`bg-gradient-to-t`、`bg-gradient-to-b`、`text-black` |
| 其他禁用正则 | `^rounded-none`、`^shadow-(?!\[\|none)`、`^bg-gradient-`、`^border-[248]`、`^bg-black`、`^bg-white$` |

另外，源 `dontList` 以自然语言补充：

- 禁止使用纯黑或纯白背景
- 禁止使用硬边缘阴影 shadow-[Xpx_Xpx_0px]
- 禁止使用高对比度配色
- 禁止使用粗边框 border-2 及以上
- 禁止使用渐变背景 bg-gradient-*
- 禁止直角 rounded-none
- 禁止按钮使用任何 translate 位移（新拟物元素是长在背景上的，不可浮起）
- 禁止 hover 时增大阴影（与光影物理规律相悖，手指靠近应使阴影缩小）
- 禁止打破光源方向（亮阴影必须在左上 -X/-Y，暗阴影必须在右下 +X/+Y）
- 禁止输入框 focus 时增大内阴影（应减小，模拟通道开放而非加压）

---

## 八、一致性清洗记录

源仓库的 `globalCss` 里存在与本风格 `aiRules` 直接冲突的模板残留，已按**以 aiRules 为准**剔除下列 5 项（原始素材保留在仓库中未改动）：

| 项 | 值 |
|---|---|
| `@keyframes neumorphism-fade-in` | transform 位移/缩放（aiRules 禁位移缩放） |
| `.neumorphism-card::before` | 渐变（aiRules 禁渐变） |
| `.neumorphism-gradient` | 渐变（aiRules 禁渐变） |
| `.neumorphism-gradient-text` | 渐变（aiRules 禁渐变） |
| `.neumorphism-animate-in 的 animation 声明` | 引用了已删除的 @keyframes neumorphism-fade-in |

### 禁令推导依据

从本套的 `forbidden` 与 `aiRules` 推导出 **2 条整类禁令**（`gradient`、`transform`），依据如下：

| 项 | 值 |
|---|---|
| `gradient` | forbidden.patterns 含整类渐变禁令 `^bg-gradient-` |
| `transform` | 直接禁令句：「- **Extrude to Intrude**：按钮 active 状态必须从凸起切换为凹陷阴影，禁止任何 translate 位移——元素是从表面生长出来的，不会悬浮。」 |

---

## 九、AI 硬规则（源 `aiRules` 全文，生成时应逐条遵守）

```text
# Neumorphism（新拟物派）设计系统

你是一位专精于 Neumorphism（新拟物派 / Soft UI）风格的前端开发专家。生成的所有代码都必须严格遵守以下规范。

## 风格身份
- **名称**：Neumorphism / Soft UI（新拟物派）
- **分类**：现代、极简
- **本质**：通过双重阴影模拟光线打在类粘土表面上的效果，营造柔和的立体纵深感
- **气质**：平静、可触、精致、亲和

---

## 核心视觉原则

### 1. 背景基调
```
必须使用：bg-[#e0e5ec] 或 bg-[#f0f0f3]
仅使用浅灰单色背景
元素必须与背景保持同一色系
```

### 2. 阴影系统（双光源）
```
凸起（默认）：
shadow-[8px_8px_16px_#b8bcc2,-8px_-8px_16px_#ffffff]
- 暗阴影：右下方向 (+X, +Y) → #b8bcc2
- 亮阴影：左上方向 (-X, -Y) → #ffffff
- 模糊半径：偏移量的 1.5-2 倍

凹陷（按下 / 输入框）：
shadow-[inset_8px_8px_16px_#b8bcc2,inset_-8px_-8px_16px_#ffffff]
- 光源方向不变，但改为 inset
```

### 3. 圆角
```
必须使用：rounded-xl (12px) 或 rounded-2xl (16-24px)
所有元素保持柔和、一致的曲率
```

---

## 交互规范

### 按钮状态
| 状态 | 效果 | 实现 |
|-------|--------|----------------|
| Default | 凸起 | shadow-[8px_8px_16px_#b8bcc2,-8px_-8px_16px_#ffffff] |
| Hover | 阴影缩小 | shadow-[4px_4px_8px_#b8bcc2,-4px_-4px_8px_#ffffff] |
| Active | 凹陷（inset） | shadow-[inset_4px_4px_8px_#b8bcc2,inset_-4px_-4px_8px_#ffffff] |
| Disabled | 淡化 | opacity-50，阴影减弱 |

### 输入框状态
| 状态 | 效果 | 实现 |
|-------|--------|----------------|
| Default | 深凹陷 | shadow-[inset_6px_6px_12px_#b8bcc2,inset_-6px_-6px_12px_#ffffff] |
| Focus | 浅凹陷 | shadow-[inset_2px_2px_4px_#b8bcc2,inset_-2px_-2px_4px_#ffffff] |

---

## 动效规则

### 交互物理
- **Extrude to Intrude**：按钮 active 状态必须从凸起切换为凹陷阴影，禁止任何 translate 位移——元素是从表面生长出来的，不会悬浮。
- **Hover Shadowing**：hover 时阴影必须缩小（16px → 8px），模拟手指靠近遮挡光源。这与常规 hover 相反——阴影应缩小而非放大。
- **Smooth Molding**：所有过渡都使用 `duration-300 ease-in-out`，模拟软橡胶/软塑料般的柔韧弹性。
- **Fixed Illuminant**：光源方向固定锁死在左上方，任何阴影配置都不得破坏这一方向。

### 过渡时长
```
transition-all duration-300 ease-in-out
```

---

## 配色方案

| Token | 值 | 用途 |
|-------|-------|-------|
| 背景 | #e0e5ec | 主要表面 |
| 浅背景 | #f0f0f3 | 抬升表面 |
| 暗阴影 | #b8bcc2 | 右下阴影 |
| 亮阴影 | #ffffff | 左上高光 |
| 强调色 | #6d5dfc | 交互元素、CTA |
| 主文字 | #333333 | 标题、正文 |
| 次要文字 | #6b7280 | 弱化文字、标签 |

---

## 禁止使用的模式

| 模式 | 原因 |
|---------|--------|
| bg-white, bg-black | 破坏单色系的和谐感 |
| shadow-[Xpx_Xpx_0px] | 硬边阴影违背柔和美学 |
| 高对比度配色 | 破坏细腻的立体感知 |
| border-2 及以上 | 边框会破坏无缝的表面错觉 |
| bg-gradient-* | 渐变与扁平光照模拟相冲突 |
| rounded-none | 直角与柔软材质感相悖 |
| 按钮使用 translate | 元素属于表面的一部分，不会浮起 |
| 更大的 hover 阴影 | 违背光照物理规律（手指靠近应遮光） |

---

## 响应式规范

### 阴影缩放
```
移动端：shadow-[4px_4px_8px_#b8bcc2,-4px_-4px_8px_#ffffff]
桌面端 (md:)：shadow-[8px_8px_16px_#b8bcc2,-8px_-8px_16px_#ffffff]
```

### 间距
```
内边距：p-4 md:p-6 lg:p-8
间隙：gap-4 md:gap-6
区块：py-12 md:py-20
```

---

## 自检清单

输出代码前请逐项确认：
- [ ] 背景是 #e0e5ec 或 #f0f0f3
- [ ] 所有阴影都使用双光源（亮/暗）格式
- [ ] 亮阴影位于 -X/-Y，暗阴影位于 +X/+Y
- [ ] 按钮：hover 缩小阴影，active 转为 inset
- [ ] 输入框使用 inset 阴影，focus 时减小深度
- [ ] 交互元素上没有使用 translate
- [ ] 圆角是 rounded-xl 或 rounded-2xl
- [ ] 过渡使用 duration-300 ease-in-out
```

---

## 十、必须包含项与示例提示词

- **button** 必须含：`bg-[#e0e5ec]` · `rounded-xl` · `shadow-[6px_6px_12px_#b8bcc2,-6px_-6px_12px_#ffffff]` · `hover:shadow-[4px_4px_8px_#b8bcc2,-4px_-4px_8px_#ffffff]` · `active:shadow-[inset_4px_4px_8px_#b8bcc2,inset_-4px_-4px_8px_#ffffff]` · `transition-all duration-200`
- **card** 必须含：`bg-[#e0e5ec]` · `rounded-2xl` · `shadow-[8px_8px_16px_#b8bcc2,-8px_-8px_16px_#ffffff]`
- **input** 必须含：`bg-[#e0e5ec]` · `rounded-xl` · `shadow-[inset_4px_4px_8px_#b8bcc2,inset_-4px_-4px_8px_#ffffff]` · `focus:shadow-[inset_6px_6px_12px_#b8bcc2,inset_-6px_-6px_12px_#ffffff]` · `focus:outline-none` · `placeholder:text-gray-400` · `transition-shadow duration-200`

示例提示词（源 `examplePrompts`）：

1. **智能家居控制面板**（Smart Home Control Panel）—— 设备控制和状态展示
   ```text
   用 Neumorphism 风格设计一个智能家居控制面板，要求：
1. 背景：统一浅灰色 #e0e5ec
2. 设备卡片：凸起效果，显示设备图标和状态
3. 开关按钮：圆形，开启时凹陷 + 强调色图标
4. 温度滑块：凹槽轨道，凸起滑块
5. 场景按钮：按下时从凸起变凹陷
所有阴影使用双色：右下深色 + 左上亮色
   ```
2. **计算器应用**（Calculator App）—— 拟物风格计算器界面
   ```text
   用 Neumorphism 风格创建一个计算器界面，要求：
1. 外框：大圆角凸起容器
2. 显示屏：凹陷区域，深色背景，显示数字
3. 数字按钮：4x3 网格，凸起效果
4. 运算符：右侧一列，用强调色
5. 按下效果：从凸起变凹陷
背景色 #e0e5ec，阴影用 #a3b1c6 和 #ffffff
   ```
3. **音频控制器**（Audio Controller）—— 音量和均衡器控制
   ```text
   用 Neumorphism 风格设计一个音频控制器，要求：
1. 主容器：大圆角凸起面板
2. 旋钮：圆形凸起，带刻度指示
3. 推子/滑块：垂直凹槽，凸起滑块
4. 均衡器：多个垂直滑块并排
5. 按钮：静音/预设等，按下时凹陷
保持统一的浅灰色调，通过阴影创造立体感
   ```

---

## 十一、token 配方总表（源 `neumorphism-tokens.ts`，Tailwind 类名字符串）

> 这些是**类名配方**而非 CSS 变量——stylekit 的 token 层就是"每个视觉位该用哪些 Tailwind 类"。
> 同目录 `tokens.css` 是该风格 `globalCss` 里的 CSS 变量与工具类（已做一致性清洗）；
> `design-tokens.json` 是扁平 key-value 形式，便于按需注入。

| 项 | 值 |
|---|---|
| 边框宽度 / 颜色 / 圆角 / 风格 | border-0 · border-transparent · rounded-xl · border-none |
| 阴影 sm / md / lg / none | shadow-[4px_4px_8px_#b8bcc2,-4px_-4px_8px_#ffffff] · shadow-[6px_6px_12px_#b8bcc2,-6px_-6px_12px_#ffffff] md:shadow-[8px_8px_16px_#b8bcc2,-8px_-8px_16px_#ffffff] · shadow-[8px_8px_16px_#b8bcc2,-8px_-8px_16px_#ffffff] md:shadow-[12px_12px_24px_#b8bcc2,-12px_-12px_24px_#ffffff] · shadow-none |
| 阴影 hover / focus | hover:shadow-[4px_4px_8px_#b8bcc2,-4px_-4px_8px_#ffffff] · focus:shadow-[6px_6px_12px_#b8bcc2,-6px_-6px_12px_#ffffff] |
| 彩色阴影 | pressed: shadow-[inset_4px_4px_8px_#b8bcc2,inset_-4px_-4px_8px_#ffffff] · pressedLg: shadow-[inset_8px_8px_16px_#b8bcc2,inset_-8px_-8px_16px_#ffffff] |
| 过渡 / 按下态 | transition-all duration-200 · active:shadow-[inset_4px_4px_8px_#b8bcc2,inset_-4px_-4px_8px_#ffffff] |
| 标题字体 / 正文字体 / 等宽字体 | font-semibold text-gray-800 · text-gray-600 · font-mono text-gray-700 |
| 字号 · hero | text-4xl md:text-6xl |
| 字号 · h1 | text-3xl md:text-4xl |
| 字号 · h2 | text-2xl md:text-3xl |
| 字号 · h3 | text-xl md:text-2xl |
| 字号 · body | text-sm md:text-base |
| 字号 · small | text-xs |
| 区块间距 / 容器内边距 / 卡片内边距 | py-12 md:py-20 · px-6 md:px-8 · p-6 md:p-8 |
| 间距 · sm | gap-3 md:gap-4 |
| 间距 · md | gap-4 md:gap-6 |
| 间距 · lg | gap-6 md:gap-8 |
| 底色 主 / 次 | bg-[#e0e5ec] · bg-[#f0f0f3] |
| 底色 · 强调 | bg-[#6d5dfc] · bg-[#ff6b6b] · bg-[#4ecdc4] · bg-[#ffe66d] |
| 文字 主 / 次 / 弱 | text-gray-800 · text-gray-600 · text-gray-400 |
| 按钮 · primary | bg-[#6d5dfc] text-white |
| 按钮 · secondary | bg-[#e0e5ec] text-gray-700 |
| 必须包含 · button | bg-[#e0e5ec] · rounded-xl · shadow-[6px_6px_12px_#b8bcc2,-6px_-6px_12px_#ffffff] · hover:shadow-[4px_4px_8px_#b8bcc2,-4px_-4px_8px_#ffffff] · active:shadow-[inset_4px_4px_8px_#b8bcc2,inset_-4px_-4px_8px_#ffffff] · transition-all duration-200 |
| 必须包含 · card | bg-[#e0e5ec] · rounded-2xl · shadow-[8px_8px_16px_#b8bcc2,-8px_-8px_16px_#ffffff] |
| 必须包含 · input | bg-[#e0e5ec] · rounded-xl · shadow-[inset_4px_4px_8px_#b8bcc2,inset_-4px_-4px_8px_#ffffff] · focus:shadow-[inset_6px_6px_12px_#b8bcc2,inset_-6px_-6px_12px_#ffffff] · focus:outline-none · placeholder:text-gray-400 · transition-shadow duration-200 |

---

## 十二、来源与许可

- 素材仓库：AnxForever/**stylekit**（MIT License, © 2026 AnxForever）
- 源文件：`lib/styles/neumorphism.ts`、`lib/styles/neumorphism-tokens.ts`
- 转换脚本：`D:\项目\scripts\convert-stylekit-systems.mjs`（一次性、可复跑）
- 局部改动：按 `aiRules` 剔除 `globalCss` 中的矛盾项（见第八节），其余内容保持源样。
- 注意：源仓库的 `components` 字段含可复制的 JSX 组件代码模板，本轮**未纳入**设计系统格式（本项目格式无组件槽位）。
