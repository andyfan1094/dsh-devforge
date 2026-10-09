---
name: Apple 流动玻璃（Apple Liquid Glass）
description: Apple WWDC 2025 发布的全新设计语言，通过 SVG 折射滤镜、彩虹边缘光晕、流体形变动画和多层玻璃堆叠，创造出超越传统毛玻璃的有机流动视觉体验。
triggers:
  - Apple 流动玻璃
  - Apple Liquid Glass
  - Apple
  - Liquid Glass
  - 流动玻璃
  - 彩虹边缘
  - 折射
  - 多层堆叠
od:
  category: style-modern
---

# Apple 流动玻璃（Apple Liquid Glass）

## 一、一句话定位

Apple WWDC 2025 发布的全新设计语言，通过 SVG 折射滤镜、彩虹边缘光晕、流体形变动画和多层玻璃堆叠，创造出超越传统毛玻璃的有机流动视觉体验。

- 英文名：**Apple Liquid Glass**
- 风格类型：`visual`（视觉风格：靠色彩/材质/字体塑造）
- 关键词：Apple、Liquid Glass、流动玻璃、彩虹边缘、折射、多层堆叠、WWDC 2025
- 适用场景提示：液态玻璃：Apple WWDC25 Liquid Glass 的光学活性表面
- 源风格分类：`modern`

---

## 二、设计哲学（源 `philosophy` 字段）

Liquid Glass（流动玻璃）是 Apple WWDC 2025 发布的革命性设计语言，超越传统毛玻璃效果，通过光线折射、彩虹边缘和流体动画创造出真正有机、流动的视觉体验。

核心理念：
- 霓虹描边文字：标题使用 text-stroke 配合青色发光描边，产生霓虹效果
- 渐变填充文字：紫色到品红的渐变填充，配合 3D 阴影产生立体感
- 彩虹折射边缘：边缘呈现棱镜效果，红橙黄绿青蓝紫的光谱渐变
- 流体形变：圆角随交互产生液态变形动画
- 多层深度：3+ 层玻璃堆叠产生丰富的空间层次
- 高饱和度：backdrop-saturate-180 让背景色彩更加鲜艳

## 字体设计核心（最重要的视觉元素）

### Hero 标题（主标题）
紫色渐变填充 + 粗青色描边(3px) + 3D偏移阴影：
- background: linear-gradient(to right, #a855f7, #ff2d92, #a855f7)
- -webkit-text-stroke: 3px #4ecdc4
- text-shadow: 4px 4px 0 rgba(0,0,0,0.5), 0 0 20px rgba(78,205,196,0.5), 0 0 40px rgba(168,85,247,0.3)
- filter: drop-shadow(0 0 15px rgba(78,205,196,0.4))

### 副标题（青色发光）
白色/青色文字 + 发光效果（无描边）：
- color: white 或 gradient cyan
- text-shadow: 0 0 20px rgba(78,205,196,0.8), 0 0 40px rgba(78,205,196,0.4), 2px 2px 0 rgba(0,0,0,0.3)

### h1/h2 标题
较细描边(2px) + 发光 + 轻微3D：
- -webkit-text-stroke: 2px #4ecdc4
- text-shadow: 3px 3px 0 rgba(0,0,0,0.4), 0 0 15px rgba(78,205,196,0.4)

### 正文
高对比度白色，保证可读性：
- color: text-white/80 到 text-white/90

与 Glassmorphism 的区别：
| 特性 | Glassmorphism | Liquid Glass |
|------|---------------|--------------|
| 边框 | border-white/20 | 彩虹渐变边框 |
| 模糊 | blur-2xl | blur-3xl + saturate-180 |
| 动画 | 简单过渡 | 液态形变 morph |
| 深度 | 单层 | 多层堆叠 |
| 文字 | 普通白色 | 渐变+粗描边+3D阴影 |
| 描边 | 无 | 3px青色霓虹描边 |
| 阴影 | 普通投影 | 3D偏移+发光组合 |

---

## 三、色彩逻辑

| 项 | 值 |
|---|---|
| 主色 primary | `rgba(255, 255, 255, 0.1)` |
| 辅色 secondary | `rgba(255, 255, 255, 0.15)` |
| 强调色 accent | `#ff6b6b`、`#4ecdc4`、`#a855f7`、`#007AFF`、`#FF2D55` |

配套的 Tailwind 类名配方（来自 `liquid-glass-tokens.ts`）：

- 底色 主 / 次：bg-white/10 backdrop-blur-[40px] backdrop-saturate-[1.8] · bg-white/15 backdrop-blur-[40px] backdrop-saturate-[1.8]
- 底色 强调：bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f0f23] · bg-gradient-to-r from-[#ff2d92] to-[#a855f7] · bg-gradient-to-r from-[#4ecdc4] to-[#6bcb77]
- 文字 主 / 次 / 弱：text-white · text-white/80 · text-white/50

**用色纪律**（源 `doList` 中与颜色相关的条目）：

- Hero标题使用粗描边 -webkit-text-stroke: 3px #4ecdc4
- Hero标题使用3D偏移阴影 text-shadow: 4px 4px 0 rgba(0,0,0,0.5)
- Hero标题使用渐变填充 bg-gradient-to-r from-[#a855f7] via-[#ff2d92] to-[#a855f7]
- 副标题使用青色发光 text-shadow: 0 0 20px rgba(78, 205, 196, 0.8)

---

## 四、字体性格

- 标题：font-black bg-gradient-to-r from-[#a855f7] via-[#ff2d92] to-[#a855f7] bg-clip-text text-transparent
- 正文：text-white/80
- 等宽：font-mono text-white/90

字号阶梯：

| 项 | 值 |
|---|---|
| `hero` | `text-5xl md:text-7xl lg:text-8xl` |
| `h1` | `text-4xl md:text-5xl` |
| `h2` | `text-3xl md:text-4xl` |
| `h3` | `text-xl md:text-2xl` |
| `body` | `text-sm md:text-base` |
| `small` | `text-xs` |

---

## 五、圆角与间距哲学

| 项 | 值 |
|---|---|
| 圆角 | `rounded-[24px]` |
| 边框 | `border border-solid border-white/20` |

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
| 过渡 | `transition-all duration-500 ease-out` |
| 按下态 | `active:scale-[0.98]` |
| 阴影 sm / md / lg / none | `shadow-lg shadow-black/5` · `shadow-xl shadow-black/10` · `shadow-2xl shadow-black/15` · `shadow-none` |
| 阴影 hover / focus | `hover:shadow-xl hover:shadow-black/15` · `focus:shadow-[0_0_0_2px_rgba(168,85,247,0.5),0_0_20px_rgba(168,85,247,0.2)]` |
| 彩色阴影 | inner: `[box-shadow:inset_0_1px_0_rgba(255,255,255,0.4)]` · glow: `shadow-[0_0_30px_rgba(168,85,247,0.4)]` · rainbow: `shadow-[0_0_20px_rgba(255,107,107,0.3),0_0_40px_rgba(78,205,196,0.2),0_0_60px_rgba(168,85,247,0.1)]` · blue: `shadow-[0_0_20px_rgba(0,122,255,0.3)]` · pink: `shadow-[0_0_20px_rgba(255,45,85,0.3)]` |

---

## 七、禁忌（源 `forbidden` 字段，含**为什么**禁）

> 这一节是 stylekit 最有价值的资产之一：它不仅列出禁用项，还给出了理由。理由直接来自源数据，
> 未做改写，便于直接喂给模型做生成后自检。

| 项 | 值 |
|---|---|
| `rounded-none` | Liquid Glass requires large rounded corners (rounded-[24px] or rounded-3xl) |
| `rounded-sm` | Liquid Glass requires large rounded corners (rounded-[24px] or rounded-3xl) |
| `bg-white` | Liquid Glass uses semi-transparent backgrounds (bg-white/10 to bg-white/15) |
| `bg-black` | Liquid Glass requires semi-transparent backgrounds, not opaque colors |
| `backdrop-blur-sm` | Liquid Glass requires high blur (backdrop-blur-[40px] or backdrop-blur-3xl) |
| `backdrop-blur` | Liquid Glass requires high blur (backdrop-blur-[40px] or backdrop-blur-3xl) |
| `duration-100` | Liquid Glass uses fluid animations (duration-500 or higher) |
| `duration-150` | Liquid Glass uses fluid animations (duration-500 or higher) |
| `duration-200` | Liquid Glass uses fluid animations (duration-500 or higher) |
| `border-white` | Liquid Glass uses gradient borders for rainbow refraction effect |
| 其他禁用类名 | `rounded`、`bg-gray-100`、`bg-gray-900`、`shadow-[0px_0px_0px`、`border-black`、`border-gray-500`、`bg-gray-50`、`bg-slate-100` |
| 其他禁用正则 | `^rounded-none`、`^rounded-sm$`、`^rounded$`、`^bg-(?!white\/\|gradient\|transparent)`、`^border-(?!white\/\|transparent)`、`^backdrop-blur$`、`^backdrop-blur-sm$`、`^duration-(100\|150\|200)$` |

另外，源 `dontList` 以自然语言补充：

- 禁止使用普通白色标题（必须使用渐变+粗描边+3D阴影）
- 禁止省略3D偏移阴影（4px 4px是必须的）
- 禁止使用细描边（Hero必须3px，h1/h2至少2px）
- 禁止省略文字发光效果（缺少霓虹感）
- 禁止使用低模糊值 backdrop-blur-sm（太弱）
- 禁止省略饱和度增强（颜色会显得暗淡）
- 禁止使用直角或小圆角（rounded-none, rounded-sm）
- 禁止使用快速过渡（duration-100, duration-150）

---

## 八、一致性清洗记录

本套风格的 `globalCss` 未发现与 `aiRules` 自相矛盾之处，**未做剔除**。

本套风格未推导出任何整类禁令（其 `forbidden` 只针对具体类名，不做整类剔除），因此 **`globalCss` 未做整类剔除**。

- ⚠️ 渐变：forbidden 里虽有渐变相关条目，但只禁具体的渐变类（如紫粉渐变组合），或对 `gradient` 作了显式豁免 —— **不构成整类禁令，未剔除**。

---

## 九、AI 硬规则（源 `aiRules` 全文，生成时应逐条遵守）

```text
你是一个 Apple Liquid Glass（流动玻璃）设计风格的前端开发专家。这是 Apple WWDC 2025 发布的全新设计语言。生成的所有代码必须严格遵守以下约束：

## 字体设计（最重要！）

### Hero 标题 - 必须使用以下样式：
```jsx
<h1
  className="font-black bg-gradient-to-r from-[#a855f7] via-[#ff2d92] to-[#a855f7] bg-clip-text"
  style={{
    WebkitTextStroke: '3px #4ecdc4',
    WebkitTextFillColor: 'transparent',
    textShadow: '4px 4px 0 rgba(0,0,0,0.5), 0 0 25px rgba(78,205,196,0.6), 0 0 50px rgba(168,85,247,0.4)',
    filter: 'drop-shadow(0 0 15px rgba(78,205,196,0.4))',
  }}
>
  标题文字
</h1>
```

### 副标题 - 青色发光白色文字：
```jsx
<h2
  className="font-bold text-white"
  style={{
    textShadow: '0 0 25px rgba(78,205,196,0.9), 0 0 50px rgba(78,205,196,0.5), 3px 3px 0 rgba(0,0,0,0.4)',
  }}
>
  副标题
</h2>
```

### h2/h3 标题 - 较细描边(2px)：
```jsx
<h2
  style={{
    WebkitTextStroke: '2px #4ecdc4',
    textShadow: '3px 3px 0 rgba(0,0,0,0.4), 0 0 15px rgba(78,205,196,0.5)',
  }}
>
  标题
</h2>
```

## 绝对禁止

- 使用普通白色标题（必须有描边+3D阴影+发光）
- 使用细描边（Hero必须3px，h2至少2px）
- 省略3D偏移阴影（4px 4px是必须的）
- 使用低模糊值 backdrop-blur-sm, backdrop-blur（太弱）
- 省略饱和度增强 backdrop-saturate
- 使用直角或小圆角 rounded-none, rounded-sm, rounded
- 使用单一颜色边框（应使用彩虹渐变）
- 使用快速过渡 duration-100, duration-150
- 使用纯色不透明背景 bg-white, bg-black
- 使用浅色背景作为容器底层（应使用深色渐变）

## 必须遵守

- Hero标题：3px青色描边 + 紫色渐变填充 + 3D阴影(4px 4px) + 发光
- 副标题：白色 + 青色发光阴影
- 超高模糊值 backdrop-blur-[40px], backdrop-blur-3xl
- 高饱和度增强 backdrop-saturate-[1.8], backdrop-saturate-200
- 彩虹渐变边框 from-[#ff6b6b] via-[#4ecdc4] to-[#a855f7]
- 顶部高光渐变 from-white/20 to-transparent
- 超大圆角 rounded-3xl, rounded-[24px]
- 流体过渡 transition-all duration-500 ease-out
- 半透明背景 bg-white/10 到 bg-white/15
- 多层堆叠使用 z-index 和不同透明度

## 彩虹配色

边缘折射渐变：
- 红: #ff6b6b
- 橙: #ffd93d
- 绿: #6bcb77
- 青: #4ecdc4
- 紫: #a855f7

背景推荐：
- 深色渐变: from-[#1a1a2e] via-[#16213e] to-[#0f0f23]
- Apple 蓝: #007AFF
- Apple 粉: #FF2D55

## 层级结构

1. 底层：深色渐变背景
2. 中层：流动玻璃容器（backdrop-blur-[40px] backdrop-saturate-[1.8]）
3. 边框层：彩虹渐变伪元素 before:
4. 高光层：顶部渐变伪元素 after:
5. 顶层：内容元素

## 核心特效

1. 彩虹边框：使用 before 伪元素 + 渐变背景 + p-[1px]
2. 顶部高光：使用 after 伪元素 + 从白色渐变到透明
3. 液态动画：animation: liquid-morph 8s ease-in-out infinite
4. 发光效果：hover:shadow-[0_0_30px_rgba(168,85,247,0.4)]
5. 压缩反馈：active:scale-[0.98]

## Animation & Interaction Rules

- Fluid Refraction: 通过滑动高光层与内部渐变云团模拟流体折射，不仅模糊，还要有“流动中的光”。
- Spatial Push: hover 需有轻微前推（scale 约 1.01-1.02）并同步扩散阴影，建议使用 cubic-bezier 物理缓动。
- Specular Edges: 交互时边框亮度从 border-white/20 提升至 /40，强化玻璃倒角高光感。
- Silky Squeeze: active 使用柔软压缩（active:scale-95~98）形成硅胶般触感，避免硬切缩放。

## 自检

每次生成代码后检查：
1. Hero标题有3px青色描边和3D偏移阴影
2. 副标题有青色发光效果
3. 有深色渐变背景容器
4. 有 backdrop-blur-[40px] 或 backdrop-blur-3xl
5. 有 backdrop-saturate-[1.8] 或更高
6. 有彩虹渐变边框
7. 有顶部高光条
8. 使用 rounded-[24px] 或更大圆角
9. 过渡时间 >= 500ms
10. 文字可读性良好
```

---

## 十、必须包含项与示例提示词

- **button** 必须含：`bg-white/10 backdrop-blur-[40px] backdrop-saturate-[1.8]` · `rounded-[20px]` · `text-white` · `before:absolute before:inset-0 before:rounded-[20px] before:p-[1px] before:-z-10` · `before:bg-gradient-to-r before:from-[#ff6b6b] before:via-[#4ecdc4] before:to-[#a855f7]` · `after:absolute after:inset-[1px] after:rounded-[19px] after:-z-10` · `after:bg-gradient-to-b after:from-white/20 after:to-transparent` · `hover:bg-white/15 hover:shadow-[0_0_20px_rgba(168,85,247,0.3)]` · `transition-all duration-500 ease-out`
- **card** 必须含：`bg-white/10 backdrop-blur-[40px] backdrop-saturate-[1.8]` · `rounded-[24px]` · `shadow-xl shadow-black/10` · `before:absolute before:inset-0 before:rounded-[24px] before:p-[1px] before:-z-10` · `before:bg-gradient-to-br before:from-[#ff6b6b] before:via-[#4ecdc4] before:to-[#a855f7]` · `after:absolute after:inset-[1px] after:rounded-[23px] after:-z-10` · `after:bg-gradient-to-b after:from-white/15 after:to-transparent` · `[box-shadow:inset_0_1px_0_rgba(255,255,255,0.4)]`
- **input** 必须含：`bg-white/10 backdrop-blur-[40px] backdrop-saturate-[1.8]` · `border border-white/20` · `rounded-[16px]` · `text-white placeholder-white/50` · `focus:outline-none focus:bg-white/15` · `focus:border-transparent` · `focus:shadow-[0_0_0_2px_rgba(168,85,247,0.5),0_0_20px_rgba(168,85,247,0.2)]` · `transition-all duration-500 ease-out`

示例提示词（源 `examplePrompts`）：

1. **Apple 风格控制中心**（Apple-style Control Center）—— iOS 风格的流动玻璃控制中心
   ```text
   用 Liquid Glass 风格创建一个 iOS 风格控制中心，要求：

## 核心效果
- 背景：深色渐变 bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f0f23]
- 主面板：bg-white/10 backdrop-blur-[40px] backdrop-saturate-[1.8] rounded-[24px]
- 彩虹边框：使用 before 伪元素实现渐变边框
- 顶部渐变：使用 after 伪元素实现高光

## 控制模块
- 网格布局：2x4 圆角正方形网格
- 每个磁贴：bg-white/10 rounded-[16px] 带彩虹边框
- 激活状态：bg-[#007AFF]/40 shadow-[0_0_20px_rgba(0,122,255,0.4)]

## 交互
- 开关控件：胶囊形状，开启时带发光
- 滑块控件：流动玻璃轨道，圆形滑块带发光
- 所有过渡：transition-all duration-500 ease-out
   ```
2. **流动玻璃音乐播放器**（Liquid Glass Music Player）—— Apple Music 风格播放界面
   ```text
   用 Liquid Glass 风格设计一个音乐播放器界面，要求：

## 背景层
- 当前播放歌曲的模糊封面作为背景
- 叠加深色渐变：bg-gradient-to-b from-black/40 via-transparent to-black/60

## 播放卡片（多层玻璃）
- 外层容器：bg-white/8 backdrop-blur-[40px] backdrop-saturate-[1.8] rounded-[32px]
- 彩虹边框：before 伪元素实现
- 内层面板：bg-white/12 rounded-[28px] p-6

## 控件设计
- 专辑封面：rounded-[20px] shadow-2xl 带发光边框
- 播放按钮：w-16 h-16 bg-white/15 rounded-full 带脉冲发光动画
- 上下曲按钮：w-12 h-12 bg-white/10 rounded-full
- 进度条：h-1 bg-white/20 rounded-full，滑块 w-4 h-4 带发光

## 动画
- 专辑封面：hover 时微微放大和发光
- 播放按钮：按下时液态压缩效果
- 进度条滑块：拖动时发光增强
   ```
3. **流动玻璃登录页面**（Liquid Glass Login Page）—— 现代登录表单设计
   ```text
   用 Liquid Glass 风格创建一个登录页面，要求：

## 全屏背景
- 深色渐变：bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f0f23]
- 添加装饰性彩虹光斑元素

## 登录卡片
- 居中容器：max-w-md mx-auto
- 流动玻璃：bg-white/10 backdrop-blur-[40px] backdrop-saturate-[1.8]
- 圆角：rounded-[32px]
- 彩虹边框：before 伪元素
- 顶部高光：after 伪元素

## 表单元素
- 输入框：bg-white/10 backdrop-blur-xl border border-white/20 rounded-[16px]
- 焦点态：focus:bg-white/15 focus:shadow-[0_0_0_2px_rgba(168,85,247,0.5)]
- 占位符：placeholder:text-white/50

## 按钮
- 主按钮：彩虹渐变边框 + 发光 hover 效果
- 次按钮：bg-transparent border border-white/30 text-white/80
- 社交登录：bg-white/10 hover:bg-white/15 rounded-[12px]

## 额外元素
- Logo：text-white text-2xl font-bold 带发光效果
- 分隔线：border-t border-white/20 my-6
- 链接：text-white/70 hover:text-white
   ```

---

## 十一、token 配方总表（源 `liquid-glass-tokens.ts`，Tailwind 类名字符串）

> 这些是**类名配方**而非 CSS 变量——stylekit 的 token 层就是"每个视觉位该用哪些 Tailwind 类"。
> 同目录 `tokens.css` 是该风格 `globalCss` 里的 CSS 变量与工具类（已做一致性清洗）；
> `design-tokens.json` 是扁平 key-value 形式，便于按需注入。

| 项 | 值 |
|---|---|
| 边框宽度 / 颜色 / 圆角 / 风格 | border · border-white/20 · rounded-[24px] · border-solid |
| 阴影 sm / md / lg / none | shadow-lg shadow-black/5 · shadow-xl shadow-black/10 · shadow-2xl shadow-black/15 · shadow-none |
| 阴影 hover / focus | hover:shadow-xl hover:shadow-black/15 · focus:shadow-[0_0_0_2px_rgba(168,85,247,0.5),0_0_20px_rgba(168,85,247,0.2)] |
| 彩色阴影 | inner: [box-shadow:inset_0_1px_0_rgba(255,255,255,0.4)] · glow: shadow-[0_0_30px_rgba(168,85,247,0.4)] · rainbow: shadow-[0_0_20px_rgba(255,107,107,0.3),0_0_40px_rgba(78,205,196,0.2),0_0_60px_rgba(168,85,247,0.1)] · blue: shadow-[0_0_20px_rgba(0,122,255,0.3)] · pink: shadow-[0_0_20px_rgba(255,45,85,0.3)] |
| 过渡 / 按下态 | transition-all duration-500 ease-out · active:scale-[0.98] |
| 标题字体 / 正文字体 / 等宽字体 | font-black bg-gradient-to-r from-[#a855f7] via-[#ff2d92] to-[#a855f7] bg-clip-text text-transparent · text-white/80 · font-mono text-white/90 |
| 字号 · hero | text-5xl md:text-7xl lg:text-8xl |
| 字号 · h1 | text-4xl md:text-5xl |
| 字号 · h2 | text-3xl md:text-4xl |
| 字号 · h3 | text-xl md:text-2xl |
| 字号 · body | text-sm md:text-base |
| 字号 · small | text-xs |
| 区块间距 / 容器内边距 / 卡片内边距 | py-16 md:py-24 · px-6 md:px-8 · p-6 md:p-8 |
| 间距 · sm | gap-4 |
| 间距 · md | gap-6 |
| 间距 · lg | gap-8 |
| 底色 主 / 次 | bg-white/10 backdrop-blur-[40px] backdrop-saturate-[1.8] · bg-white/15 backdrop-blur-[40px] backdrop-saturate-[1.8] |
| 底色 · 强调 | bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f0f23] · bg-gradient-to-r from-[#ff2d92] to-[#a855f7] · bg-gradient-to-r from-[#4ecdc4] to-[#6bcb77] |
| 文字 主 / 次 / 弱 | text-white · text-white/80 · text-white/50 |
| 按钮 · primary | bg-gradient-to-r from-[#ff2d92] to-[#a855f7] text-white font-bold |
| 按钮 · secondary | bg-white/10 text-white backdrop-blur-[40px] backdrop-saturate-[1.8] |
| 必须包含 · button | bg-white/10 backdrop-blur-[40px] backdrop-saturate-[1.8] · rounded-[20px] · text-white · before:absolute before:inset-0 before:rounded-[20px] before:p-[1px] before:-z-10 · before:bg-gradient-to-r before:from-[#ff6b6b] before:via-[#4ecdc4] before:to-[#a855f7] · after:absolute after:inset-[1px] after:rounded-[19px] after:-z-10 · after:bg-gradient-to-b after:from-white/20 after:to-transparent · hover:bg-white/15 hover:shadow-[0_0_20px_rgba(168,85,247,0.3)] · transition-all duration-500 ease-out |
| 必须包含 · card | bg-white/10 backdrop-blur-[40px] backdrop-saturate-[1.8] · rounded-[24px] · shadow-xl shadow-black/10 · before:absolute before:inset-0 before:rounded-[24px] before:p-[1px] before:-z-10 · before:bg-gradient-to-br before:from-[#ff6b6b] before:via-[#4ecdc4] before:to-[#a855f7] · after:absolute after:inset-[1px] after:rounded-[23px] after:-z-10 · after:bg-gradient-to-b after:from-white/15 after:to-transparent · [box-shadow:inset_0_1px_0_rgba(255,255,255,0.4)] |
| 必须包含 · input | bg-white/10 backdrop-blur-[40px] backdrop-saturate-[1.8] · border border-white/20 · rounded-[16px] · text-white placeholder-white/50 · focus:outline-none focus:bg-white/15 · focus:border-transparent · focus:shadow-[0_0_0_2px_rgba(168,85,247,0.5),0_0_20px_rgba(168,85,247,0.2)] · transition-all duration-500 ease-out |

---

## 十二、来源与许可

- 素材仓库：AnxForever/**stylekit**（MIT License, © 2026 AnxForever）
- 源文件：`lib/styles/liquid-glass.ts`、`lib/styles/liquid-glass-tokens.ts`
- 转换脚本：`D:\项目\scripts\convert-stylekit-systems.mjs`（一次性、可复跑）
- 局部改动：按 `aiRules` 剔除 `globalCss` 中的矛盾项（见第八节），其余内容保持源样。
- 注意：源仓库的 `components` 字段含可复制的 JSX 组件代码模板，本轮**未纳入**设计系统格式（本项目格式无组件槽位）。
