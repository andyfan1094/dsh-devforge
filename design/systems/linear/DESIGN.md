---
name: Linear 设计系统
description: Linear 设计系统：深色开发者工具设计语言，冷蓝紫单色相族 + 紫罗兰强调，多层微阴影代替硬投影；适用于开发者工具、效率应用与专业后台。
triggers:
  - Linear
  - 线性风格
  - 深色开发者工具
  - 紫罗兰强调色
  - 专业工具界面
  - 深色仪表盘
  - issue 跟踪
  - 项目管理后台
od:
  category: dark-devtool
---

# Linear 设计系统

一套**只做深色**的专业工具界面语言：近黑的冷灰蓝底子 + 单一紫罗兰强调色，靠明度阶梯分层，靠多层微阴影与 1px 内高光"点出"边缘，而不是靠大投影压出立体感。

- 权威来源：better-design `registry/linear/globals.json`（MIT，© 2026 Marvin Kaunda），token 全部为 `oklch()`
- 本目录：`tokens.css`（CSS 变量 + 已展开的基础层）、`design-tokens.json`（22 项扁平 token）

---

## 一、用于什么场景

**该用**：开发者工具、issue/项目管理后台、CLI 配套 Web 控制台、监控与运维面板、任何"长时间盯着看、信息密度中等偏高、用户是专业人士"的界面。

**不该用**：营销落地页与品牌官网（太冷、太安静，没有说服力）；儿童/消费娱乐产品；需要展示大量真实照片的内容站（近黑底会吃掉照片的暗部）；必须同时提供浅色模式的 C 端产品——**这套主题只有一套取值**（见下文"最大的坑"）。

判断口诀：**这个界面是给人"用"的，还是给人"逛"的？** 前者合适，后者不合适。

---

## 二、色彩逻辑

### 2.1 只有一个色相族，加一个强调色

把 22 个 token 的 oklch 色相角拉出来看，结论非常干净：

| 角色 | token | 值 | 色相角 |
|---|---|---|---|
| 底色 | `--background` | `oklch(0.223 0.0183 279.84)` | 279.8° |
| 卡片/浮层 | `--card` / `--popover` / `--muted` | `oklch(0.2498 0.0243 281.29)` | 281.3° |
| 次级面 | `--secondary` | `oklch(0.2883 0.0304 276.56)` | 276.6° |
| 高亮面 | `--accent` | `oklch(0.321 0.0242 281.73)` | 281.7° |
| 分隔线 | `--border` | `oklch(0.353 0.0327 282.22)` | 282.2° |
| 输入框底 | `--input` | `oklch(0.28 0.0369 259.97)` | **260.0°** |
| **主色** | `--primary` / `--ring` | `oklch(0.6317 0.1989 275.24)` | **275.2°** |
| 危险 | `--destructive` | `oklch(0.3959 0.1331 25.72)` | 25.7°（唯一的暖色） |

**除 `--destructive` 外，全部落在 247–283° 的冷蓝紫区间**；`--primary` 的彩度（0.199）是其他所有 token 的 6–10 倍——这是整套设计的核心手法：**底色几乎无彩，唯一的彩色留给交互主色**。

→ 实操含义：想给这套系统换一个品牌色，**只需要改 `--primary` 与 `--ring`**，其余 20 个 token 不要动。组件里的聚焦环是用 `color-mix(in oklch, var(--primary) 30%, transparent)` 从主色现算的，会自动跟着变（这是源仓库组件代码里的真实写法）。

### 2.2 层级靠明度阶梯，不靠阴影

`--background`(0.223) → `--muted`/`--card`(0.2498) → `--input`(0.28) → `--secondary`(0.2883) → `--accent`(0.321) → `--border`(0.353)

六级明度阶梯只跨了 0.13 的 L 值，**每一步都非常小**。这意味着：
- 面与面之间的区分是"若隐若现"的，不是色块拼接；
- 不要为了提高"可读性"把 `--card` 调亮很多，那会立刻毁掉这套系统的气质；
- 需要更强的分隔时，**加 1px 边框，而不是加阴影或加大明度差**。

### 2.3 前景色的三个档

`--foreground` 是纯白 `oklch(1 0 0)`（标题/主文本），`--muted-foreground` 是 `oklch(0.701 0.0199 275.78)`（说明文字/占位符），`--card-foreground` 略暗于纯白（`oklch(0.9838 0.0035 247.86)`）。

**不要在这三档之外自造第四档灰**。需要"更弱的文字"时，用 `opacity` 或 `color-mix`，不要再引入一个新灰值，否则同屏会出现两种"看起来差不多但不一样"的灰，这是这套系统最容易被破坏的地方。

---

## 三、字体性格

`cssVars` 里**没有**字体 token（22 项全是颜色与圆角），字体信息在 `globals.css` 的 `@layer base` 里：

```css
html { font-family: var(--font-geist-sans, ui-sans-serif, system-ui, ...); }
```

即：源站用 **Geist Sans**（Next.js 注入的 `--font-geist-sans`），独立使用时回退到系统 UI 无衬线栈——已在 `tokens.css` 里处理成带 fallback 的写法，避免 `var()` 未定义导致整条声明失效。

性格要点（来自组件实现）：
- **字重只用 400 / 500 / 600**：按钮 `font-medium`（500），卡片标题 `font-semibold`（600）。**没有 700 及以上的粗体**——粗体在这套"安静"的系统里会显得吵闹。
- **字号偏小**：按钮 14px（`text-sm`），卡片标题 24px（`text-2xl`），说明文字 14px。信息密度是专业人士能接受的，不需要放大讨好。
- **紧字距**：卡片标题 `tracking-tight`——深色底上白字的视觉膨胀感比浅色底更强，必须靠负字距收回来。数字场景建议开 `tabular-nums`。

---

## 四、圆角与间距哲学

### 圆角

`--radius: 0.5rem`（8px），并派生：

| token | 值 | 用在哪 |
|---|---|---|
| `--radius-sm` | `calc(var(--radius) - 4px)` = 4px | 小徽标、tag |
| `--radius-md` | `calc(var(--radius) - 2px)` = 6px | **按钮、输入框** |
| `--radius-lg` | `var(--radius)` = 8px | **卡片、面板** |
| `--radius-xl` | `calc(var(--radius) + 4px)` = 12px | 大浮层、模态 |

哲学是**"同心圆角 + 子不大于父"**：容器（卡片）用最大层级，里面的控件退一级。按钮 6px 装在卡片 8px 上，视觉上四角同心。

**禁忌**：不要出现胶囊（`rounded-full`）或 >12px 的大圆角。这套系统的圆角是"克制的工程感"，胶囊会立刻把它变成消费级风格。

### 间距

源 token 集里没有间距阶梯，间距由组件固定：

- 卡片内边距 **`p-6` = 24px**（四边一致，Header/Content/Footer 用 `pt-0` 相互抵消，保证一个视觉 24px 栅格）
- 按钮高度 **h-8 / h-9 / h-10 = 32 / 36 / 40px**，水平内边距 `px-3 / px-4 / px-6`
- 输入框与默认按钮**同高 h-9**（36px）——表单行里并排时不歪

→ 实施时把 **8px 当作基础单位**，所有间距用 8 的倍数（24/32/40），不要出现 18px、22px 这类数字。

---

## 五、动效与状态

- **时长极短**：`duration-150 ease-out`（按钮、输入框都是）。这套系统的动效是"确认感"，不是"表演"。
- **过渡属性要指名**：组件里写的是 `transition-[border-color,box-shadow]` / `transition-all`（按钮）。**优先学前者**，避免 `transition: all` 带来的意外联动（这条也正是本项目 `craft/animation-discipline.md` 的要求）。
- **按下反馈**：按钮 `active:scale-[0.98] active:brightness-95`——位移 + 亮度双反馈，位移量极小（2%）。
- **悬停**：只是把面提亮一档（`hover:bg-accent` / `hover:bg-primary/90`），**不改变尺寸、不发光**。
- **聚焦**：`focus-visible:ring-2 ring-ring`（主色环）+ 输入框额外的 3px 主色光晕。**永远不要用 `outline: none` 且不给替代**。
- **禁用**：`opacity-40` + `pointer-events-none`，不要改成灰色实心块。

### 阴影（这套系统最讲究的一处）

源组件的阴影**全是多层叠加**，不是一条 `box-shadow`：

```css
/* 卡片 */
box-shadow:
  0 1px 3px rgba(0,0,0,0.3),        /* 环境投影，负责"浮起来" */
  0 0 0 1px rgba(255,255,255,0.03), /* 1px 白描边，负责边缘清晰 */
  inset 0 1px 0 rgba(255,255,255,0.04); /* 顶部内高光，负责"受光" */

/* 主按钮 */
box-shadow:
  0 0 0 1px color-mix(in oklch, var(--primary) 55%, transparent), /* 主色描边环 */
  0 1px 3px rgba(0,0,0,0.4),                                       /* 投影 */
  inset 0 1px 0 rgba(255,255,255,0.1);                             /* 内高光 */
```

**深色界的铁律**：近黑底上的元素，单靠黑色投影是"看不出深度"的（黑压黑），必须靠**白色低透明度的 1px 描边 + 顶部内高光**勾出边缘。这三层缺一层，元素就会"糊"在背景里。

---

## 六、禁忌

| 禁忌 | 为什么 |
|---|---|
| ❌ 把它当浅色主题用 | `cssVars` 里的键名叫 `light`，但它承载的是这套主题**默认且唯一**的深色取值。拿它当浅色模式会得到完全相反的结果 |
| ❌ 引入第二个彩色强调色 | 除 `--destructive` 外全场只有 `--primary` 一个彩色。加第二个彩色（绿/橙/粉）会立刻破坏"单一色相族"的核心手法 |
| ❌ 用纯黑 `#000` 当背景 | 它的底是**带蓝的深灰**（L=0.223，色相 280°）。换成纯黑后所有冷色调会失衡，白字对比也会过硬 |
| ❌ 用大投影表达层级 | 深色底上大投影≈看不见，还会糊掉边缘。层级必须走明度阶梯 + 1px 边框 + 多层微阴影 |
| ❌ 用 700+ 粗体、大字号的"营销腔"排版 | 字重上限 600；放大字号、加粗标题会让这套系统变得吵闹 |
| ❌ 大圆角 / 胶囊按钮 | 圆角上限 12px，按钮 6px。胶囊属于消费级语言 |
| ❌ 自造第四档灰色文字 | 前景只有三档（纯白 / 0.9838 / 0.701）。多一档就会出现"两种差不多的灰" |
| ❌ 把 `--destructive` 红当装饰色 | 它是唯一的暖色，只用于危险操作与错误态；当装饰色用会让"危险"信号失效 |
| ❌ 直接删掉 `tokens.css` 里的基础层块而不做替代 | `*{border-color}`、`body{background/color}`、`html{font-family}` 是源设计系统的全局预设；删掉必须自己在 reset 里补等价内容 |

---

## 七、实现要点

```css
/* 1. 引入 token */
@import "./design/systems/linear/tokens.css";

/* 2. 只用语义 token，不写死颜色 */
.card {
  background: var(--card);
  color: var(--card-foreground);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 24px; /* p-6 */
}

/* 3. 聚焦环从主色现算，才能随品牌色自动变色 */
.input:focus-visible {
  border-color: color-mix(in oklch, var(--primary) 60%, transparent);
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--primary) 30%, transparent);
}
```

**深色单模提醒**：本主题不提供 `.light` / `.dark` 切换块——`tokens.css` 的 `:root` 就是它唯一的样子。若项目需要双模，必须**另写一套浅色值**，不能靠翻转。

## 八、与 craft 规则的关系

- 与 `design/craft/animation-discipline.md` 一致：动效短、可被打断、**禁止 `transition: all`**（源按钮用了 `transition-all`，落地时建议收窄到具体属性）。
- 与 `design/craft/color.md` 一致：强调色唯一、层级靠明度。
- 需补充的一点：craft 的"深色模式需与浅色模式成对提供"在本主题**不成立**——它是刻意的单模主题，选型前先确认产品是否真的只需要深色。
