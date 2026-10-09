---
name: 单色工业风
description: 单色工业风（Monochrome Industrial）：OLED 纯黑底 + 无彩色灰阶 + 一盏信号红，零圆角、零阴影，等宽字体承担仪表盘语义；适用于开发者工具、CLI 控制台与工业监控界面。
triggers:
  - 工业风
  - 单色工业
  - 机械仪表盘
  - 等宽字体界面
  - OLED 纯黑
  - 点阵显示
  - 信号红强调
  - CLI 控制台
  - 监控大屏
od:
  category: dark-devtool
---

# 单色工业风（Monochrome Industrial）

**31 套主题里唯一一套"完整设计系统"**：其余主题只给颜色和圆角（20–43 个 token），这一套额外给了**排版刻度 9 个 + 间距刻度 9 个 + 动效 3 个 + 字体 3 个**，共 **60 个 token**。它的设计语言也最鲜明——**零圆角、零阴影、无彩色灰阶 + 一盏"信号灯红"**，字体本身承载机器语义（等宽 + 全大写 + 宽字距 = 仪表盘读数）。

- 权威来源：better-design `registry/monochrome-industrial/globals.json`（MIT，© 2026 Marvin Kaunda）
  - 上游参考：`github.com/dominikmartn/monochrome-industrial-design-skill`（源文件注释里注明）
- 本目录：`tokens.css`（`:root` 深色默认 + `.light` 浅色覆盖 + 基础层 + 3 个组件辅助类）、`design-tokens.json`（60 项扁平 token）
- ⚠️ **token 数量口径修正**：验货报告里"122 变量"是源文件中 `--x:` 行的总数（60 个 `:root` + 29 个 `.light` 覆盖 + 33 个 `@theme inline` 镜像），**真实设计 token 是 60 个**。

---

## 一、用于什么场景

**该用**：开发者工具与 CLI 配套界面、运维/监控控制台、工业设备控制面板、终端风格的产品页、需要"专业到有点冷"的技术品牌站。

**不该用**：任何面向普通消费者的界面（它刻意不好亲近）、需要柔软/温暖情绪的产品、儿童与教育、生活服务类应用。这套语言里没有"亲切"这个选项。

判断口诀：**这个界面像不像一块仪器面板？** 像就对，不像就换。

---

## 二、色彩逻辑

### 2.1 无彩色灰阶 + 一盏信号红

60 个 token 里，**16 个是私有单色板**，全部无彩度（`#000` 到 `#fff` 的灰度阶梯）：

| token | 值 | 角色 |
|---|---|---|
| `--mono-black` | `#000000` | OLED 纯黑底（`--background` 同值） |
| `--mono-surface` | `#111111` | 面板面（`--card` / `--muted` 同值） |
| `--mono-surface-raised` | `#1a1a1a` | 抬升面（`--secondary` 同值） |
| `--mono-border` | `#222222` | 细微边框 |
| `--mono-border-visible` | `#333333` | **可见边框**——组件默认边框用它，不是 `--border` |
| `--mono-text-disabled` | `#666666` | 禁用文字 |
| `--mono-text-secondary` | `#999999` | 次级文字（`--muted-foreground` 同值） |
| `--mono-text-primary` | `#e8e8e8` | 主文本（`--foreground` 同值） |
| `--mono-text-display` | `#ffffff` | 展示字（标题用，比主文本更亮） |
| **`--mono-accent`** | **`#d71921`** | **信号灯红——"每屏只有一个"**（源注释原文：`signal-light red — one per screen`） |
| `--mono-accent-subtle` | `rgba(215,25,33,0.15)` | 红色的极淡底 |
| `--mono-success` / `--mono-warning` / `--mono-error` | `#4a9e5c` / `#d4a843` / `#d71921` | 状态三色 |
| `--mono-info` | `#999999` | **信息色是灰的，不是蓝的** |
| `--mono-interactive` | `#5b9bf6` | 唯一一个"正常"的交互蓝（浅色模式下变 `#007aff`） |

关键观察：

1. **灰阶有分工，不能混用**。`--border`(#222) 与 `--mono-border-visible`(#333) 是两个不同的东西：**组件的可见边框一律用 `--mono-border-visible`**，`--border` 只用于分区线的更弱场合。同理 `--foreground`(#e8e8e8) 与 `--mono-text-display`(#fff)：正文用前者，标题用后者。混用会让"层次"塌掉。
2. **红色是信号，不是装饰**。"one per screen" 是硬规则：**一屏最多一个红**。危险按钮、错误态、当前选中项——三者只能出现一个。用两处，红色就失去意义了。
3. **状态色齐全，但信息色是灰**。这是工业语汇的体现：信息不需要颜色提醒，它只需要被读到。
4. `--mono-interactive`(#5b9bf6) 是整套里唯一一个非灰非红的彩色。它存在是为了"链接必须可识别"——**不要拿它当装饰色扩散使用**。

### 2.2 浅色模式：印刷技术手册

`.light` 覆盖 29 个变量，实现方式是把 `--mono-black` 从 `#000` 变成 `#f5f5f5`，同时翻转 txt/surface 两端，形成"**暖白纸 + 黑字**"的印刷技术手册观感：

```
深色（默认）  --mono-black #000000（底）  --mono-text-display #ffffff（字）
浅色（.light）--mono-black #f5f5f5（底）  --mono-text-display #000000（字）
```

**切换方式**：在 `<html>` 或任意容器上加 `class="light"`。源文件注释原文：*"Defaults to dark (OLED black). Add `.light` to `<html>` for the warm off-white mode."*

> 📌 **口径修正**：验货报告称"31 个主题里只有 `tactile-minimal` 真有明暗两套"——这句只在 **`cssVars` 数据层**成立。**`monochrome-industrial` 的 CSS 里同样有一套完整的 `.light` 覆盖（29 个变量）**，只是没写进 `cssVars`。本目录已按 CSS 为准保留该 `.light` 块。

---

## 三、字体性格：字体在这里是"仪器语义"

三个字体 token：

```css
--font-display: "Doto", "Space Mono", monospace;                    /* 点阵显示字 */
--font-sans:    "Space Grotesk", "DM Sans", system-ui, sans-serif;  /* 标题/正文 */
--font-mono:    "Space Mono", "JetBrains Mono", "SF Mono", monospace; /* 数据/标签 */
```

**Doto**（点阵/点阵管显示体）通过 Google Fonts 加载，只用于"仪表读数"级的大数字与时间显示。`tokens.css` 已保留这条 `@import`（提到文件顶部）。

三种字体的分工是**语义分工，不是审美分工**：

| 字体 | 用在哪 | 传达什么 |
|---|---|---|
| `--font-mono` | 按钮标签、输入框值、卡片说明、数据值 | **"这是机器在说话"** |
| `--font-sans` | 卡片标题、段落 | "这是人在解释" |
| `--font-display` | 大号数字、时间、计量值 | "这是仪表读数" |

配套的三条排版规则（**必须成套使用，缺一条就不像了**）：

```css
/* 1. 仪器标签：等宽 + 全大写 + 宽字距 + 小字号 + 次级灰 */
.mono-label {
  font-family: var(--font-mono);
  font-size: var(--label);          /* 11px */
  font-weight: 400;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mono-text-secondary);
}

/* 2. 展示数值：点阵字 + 行高 1 + 负字距 */
.mono-display {
  font-family: var(--font-display);
  font-size: var(--display-xl);     /* 72px */
  line-height: 1;
  letter-spacing: -0.03em;
  color: var(--mono-text-display);
}

/* 3. 等宽数据：开表格数字，保证数字列对齐 */
.mono-data {
  font-family: var(--font-mono);
  font-feature-settings: "tnum";
  color: var(--mono-text-primary);
}
```

→ **`0.08em` 是这个系统的签名数字**：所有全大写文本（按钮、placeholder、卡片说明、标签）都用它。全大写必须给 ≥0.06em 的字距，这里取 0.08em——本项目 `design/craft/typography.md` 的通用规则在此得到验证。
→ 字重只用 **400 / 500**（按钮 `font-medium`）。**没有粗体**。
→ 字号刻度（9 级）：`11 / 12 / 14 / 16 / 18 / 24 / 36 / 48 / 72 px`（`--label` → `--display-xl`）。

---

## 四、圆角与间距哲学

### 圆角：**零**

```css
--radius: 0rem;  /* 源注释：Monochrome Industrial is sharp — pill (999px) or technical (4–8px) only */
```

源注释给出了唯一的例外规则：**要么锋利（0），要么整颗胶囊（999px），要么 4–8px 的技术圆角**；**禁止中间值**（不要 12px、16px 的"柔和圆角"，那是消费级语言）。

组件的实际选择是 **`rounded-none` 一以贯之**——按钮、卡片、输入框全是直角。

### 间距：8px 基础刻度，9 级

```css
--space-2xs: 2px;   --space-xs: 4px;    --space-sm: 8px;
--space-md: 16px;   --space-lg: 24px;   --space-xl: 32px;
--space-2xl: 48px;  --space-3xl: 64px;  --space-4xl: 96px;
```

组件级取值：卡片内边距 **`p-6` = 24px**、按钮高度 **h-8 / h-10 / h-12 = 32 / 40 / 48px**、水平内边距 `px-3 / px-5 / px-7`。

### 动效刻度

```css
--ease-mono: cubic-bezier(0.25, 0.1, 0.25, 1);  /* 类 ease 的机械曲线——没有回弹 */
--duration-micro: 200ms;         /* 微交互 */
--duration-transition: 350ms;    /* 状态转场 */
```

**曲线刻意"机械"**：没有 spring、没有 overshoot。这是工业语汇的一部分——面板上的指示灯不会弹。

---

## 五、容器策略（这套系统最重要的一条设计原则）

源组件在 `card.tsx` 里写下了明确的原则：

> *"Container Strategy rule: prefer the lightest tool that works. We pick border-only here, never elevation."*
> （容器策略：优先使用**最轻的、够用的**分隔手段。卡片这里只选描边，永不使用投影。）

对应的实现就是：**卡片零阴影，只有 1px 边框**。

```css
/* 卡片：无阴影、直角、可见边框 */
.card {
  border: 1px solid var(--mono-border-visible);
  border-radius: 0;
  background: var(--card);
}
```

界面的层次感来自**三个"最轻工具"的组合，按需升级**：

| 需要表达 | 用什么 | 不要用什么 |
|---|---|---|
| 面与面分开 | 换 `--mono-surface` / `--mono-surface-raised` 的面色（8 级灰阶里选一档） | 投影 |
| 区块边界 | 1px `--mono-border`(#222) 或 `--mono-border-visible`(#333) | 更粗的线 |
| 元素悬浮 | **不做**。工业面板上没有任何东西"飘" | 任何 `box-shadow` |

只有一样东西是"叠上去"的：**点阵网格纹**，用 `tokens.css` 里保留的三个辅助类实现（`radial-gradient` 画点，非贴图）：

```css
.dot-grid        { background-size: 16px 16px; }  /* 常规 */
.dot-grid-subtle { background-size: 12px 12px; }  /* 更弱 */
.dot-grid-tight  { background-size: 8px 8px; }    /* 更密 */
```

用在 hero 面板、卡片、空状态上作底纹。**网格纹是唯一的"装饰"，且必须极淡。**

---

## 六、动效与状态

- **无位移、无缩放**：唯一的动效反馈是 `active:translate-y-[1px]`（按下时下沉 1px，模拟物理按钮的行程）。
- **过渡属性指名**：`transition-[background-color,color,border-color] duration-150 ease-out`。
- **悬停**：只改边框与面色（`hover:border-foreground/60` / `hover:bg-[var(--mono-surface)]`）。**不改变尺寸、不发光、不位移。**
- **聚焦**：`focus-visible:ring-2 ring-[var(--mono-accent)] ring-offset-0`——**聚焦环是红色的**，且贴边（offset 0，与深色底一致）。输入框聚焦时**边框直接变成 `--mono-accent` 红**。
  → ⚠️ 与"一屏一个红"的冲突处理：聚焦是**瞬时态**，不算"占用了那一盏红灯"；但**不要在一屏里同时出现红色危险按钮 + 聚焦红环 + 红色错误提示**，此时应把危险按钮降级为描边样式。
- **禁用**：`opacity-40` + `pointer-events-none`。

---

## 七、禁忌

| 禁忌 | 为什么 |
|---|---|
| ❌ 给任何元素加 `box-shadow` | "Container Strategy" 明令禁止投影。层次只能靠面色、边框、留白 |
| ❌ 用 12px / 16px 这类"柔和圆角" | 圆角规则：**0 / 999px / 4–8px**，三者之外都是破坏。组件实际一律 0 |
| ❌ 一屏出现两个 `--mono-accent` 红 | 源注释硬规则 "one per screen"。滥用后危险信号失效 |
| ❌ 把 `--mono-interactive`(#5b9bf6) 当装饰色铺开 | 它的职责只有一条：让链接可识别 |
| ❌ 全大写文本不给 `letter-spacing: 0.08em` | 全大写没有字距会挤成一团；0.08em 是这套系统的签名值 |
| ❌ 用粗体（600+） | 字重上限 500。粗体在单色界面里会变成"噪点" |
| ❌ 用 `--border`(#222) 当组件边框 | 组件可见边框用 `--mono-border-visible`(#333)；#222 太弱，边框会消失 |
| ❌ 把 `--foreground`(#e8e8e8) 当标题色 | 标题用 `--mono-text-display`(#fff)，比正文更亮一档；混用会丢掉"展示层" |
| ❌ 引入彩色（紫、青、渐变） | 全系统无彩色灰阶 + 一个红。任何彩色都会立刻破坏工业感 |
| ❌ 动效加 spring / bounce / overshoot | 曲线是 `cubic-bezier(0.25,0.1,0.25,1)`，刻意无回弹 |
| ❌ 把 `--radius` 改成非 0 后又依赖派生圆角 | `--radius-sm/md/lg/xl` = `calc(var(--radius) ∓ ...)`，全部派生自 `--radius`。改了 `--radius`，派生值会连动（`-4px` 在 `--radius:0` 时会是负数——正因为如此，本主题组件一律用 `rounded-none` 而非 `rounded-md`） |
| ❌ 直连 CDN 字体而不做本地回退 | `--font-display` 首选 Doto（Google Fonts）。离线/内网环境必须保证 `"Space Mono", monospace` 回退链可用——回退链已在 token 里写好，别删 |

---

## 八、实现要点

```css
@import "./design/systems/monochrome-industrial/tokens.css";

/* 仪器标签：这套系统的招牌 */
.label {
  font-family: var(--font-mono);
  font-size: var(--label);        /* 11px */
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mono-text-secondary);
}

/* 卡片：只描边，零阴影 */
.panel {
  background: var(--card);
  border: 1px solid var(--mono-border-visible);
  border-radius: 0;               /* 不使用 var(--radius) 的派生值 */
  padding: var(--space-lg);       /* 24px */
}

/* 浅色模式：给 <html> 加 class */
html.light { /* .light 块已在 tokens.css 中定义，无需重复 */ }
```

**双模切换**：本主题支持浅色模式，但做法是**加 `.light` class**（`:root` 即深色默认），不是 `prefers-color-scheme` 自动切换——工业设备通常由部署方决定用哪套，不由用户系统偏好决定。

## 九、与 craft 规则的关系

- 与 `design/craft/typography.md` 一致：**全大写必须给 ≥0.06em 字距**，本系统用 0.08em。这是该 craft 规则的一个强证据样本。
- 与 `design/craft/color.md` 一致：强调色唯一且有配额（一屏一个）；信息层级靠明度而非色相。
- 与 `design/craft/animation-discipline.md` 一致：200/350ms 短时长、指名过渡属性、无回弹曲线。
- **与 craft 的潜在冲突点**：多数 craft 规则建议用阴影表达层级（elevation）。本主题**明令禁止阴影**，改用"面色 + 边框 + 留白"三件套。落地时若项目同时套用通用 craft 规则，需要把"阴影=层级"改成"面色=层级"，否则会自相矛盾。
- 补充：本主题是 31 套里 token 完整度上限参考（唯一自带排版/间距/动效/字体刻度）。其余主题若需要这些刻度，可参考本主题的取值结构。

---

## 十、token 清单概览

| 分组 | 数量 | 说明 |
|---|---|---|
| shadcn 语义色 | 20 | `--background` … `--ring` + `--radius` |
| 私有单色板 | 16 | `--mono-*`，含信号红与状态三色 |
| 排版刻度 | 9 | `--display-xl` … `--label`（11→72px） |
| 间距刻度 | 9 | `--space-2xs` … `--space-4xl`（2→96px，8px 基数） |
| 动效 | 3 | `--ease-mono`、`--duration-micro`、`--duration-transition` |
| 字体 | 3 | `--font-display`、`--font-sans`、`--font-mono` |
| **合计** | **60** | 另有 `.light` 覆盖 29 个变量 |
