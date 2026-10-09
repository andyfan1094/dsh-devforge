---
name: Stripe 设计系统
description: Stripe 设计系统：浅色金融级 UI，靛蓝强调 + 藏青投影的"高级感"配方，0.5px 环状描边与多层缓投影构成标志性纵深；适用于支付、金融产品与 B2B 交易后台。
triggers:
  - Stripe
  - 金融科技
  - 支付页面
  - 靛蓝强调色
  - 浅色高级阴影
  - 金融仪表盘
  - B2B 交易后台
  - 定价页
od:
  category: light-fintech
---

# Stripe 设计系统

浅色金融界面的标杆：**纯白画布 + 靛蓝单强调色 + 藏青（不是黑色）投影**。它之所以看起来"贵"，不是因为装饰多，而是因为把三件事做到了极致——投影带色、边缘有半像素描边、圆角分级严格。

- 权威来源：better-design `registry/stripe/globals.json`（MIT，© 2026 Marvin Kaunda），token 全部为 `oklch()`
- 本目录：`tokens.css`（CSS 变量 + 已展开的基础层）、`design-tokens.json`（22 项扁平 token）

---

## 一、用于什么场景

**该用**：支付与结算流程、订阅与定价页、金融/账单后台、B2B 交易系统、任何需要传达"这里经手的是钱，很稳"的界面。

**不该用**：需要张扬个性的品牌站、游戏化产品、儿童教育、内容社区。这套语言刻意"去个性"，它的说服力来自可靠感，用在需要情绪张力的地方会显得平淡。

判断口诀：**这一屏的价值是不是"让人敢把卡号填进去"？** 是就合适。

---

## 二、色彩逻辑

### 2.1 一个靛蓝，两个藏青，一片冷白

| 角色 | token | 值 | 说明 |
|---|---|---|---|
| 画布 | `--background` / `--popover` / `--input` | `oklch(1 0 0)` | 纯白 |
| 卡片面 | `--card` / `--secondary` | `oklch(0.9838 0.0035 247.86)` | 极淡的冷白（**不是灰**，L=0.9838 且带 247.9° 的微弱蓝相） |
| 弱面 | `--muted` | `oklch(0.9681 0.0052 247.88)` | |
| 悬停面 | `--accent` | `oklch(0.9521 0.0079 247.91)` | |
| 分隔线 | `--border` | `oklch(0.9292 0.0072 247.9)` | |
| **主色** | `--primary` / `--ring` | `oklch(0.5803 0.2335 278.46)` | 靛蓝，彩度 0.234（全场最高） |
| 正文 | `--foreground` | `oklch(0.2651 0.0621 251.37)` | **藏青**，不是黑 |
| 次级文字 | `--muted-foreground` / `--secondary-foreground` | `oklch(0.5546 0.032 264.27)` | 冷灰蓝 |
| 危险 | `--destructive` | `oklch(0.5903 0.2299 19.34)` | 唯一的暖色 |

三点关键观察：

1. **正文不是黑色**。`--foreground` 是 L=0.2651、色相 251° 的藏青。纯黑 `#000` 在浅色金融界面上会显得廉价且刺眼——**把正文换成纯黑，整套的高级感立刻掉一档**。
2. **所有浅色面都带同一缕蓝**（色相 247.9°）。这四个"白"在数值上几乎一样（0.9292–0.9838），肉眼看是"同一种白的不同亮度"，而不是"白 + 灰 + 米色"的杂色堆。**不要用 Tailwind 的 `gray-*` 替换它们**——那些是中性灰，会把这套配色从"冷冽"拉向"浑浊"。
3. **除 `--destructive` 外只有一个彩色**。全场彩度分布：primary 0.2335，其余 ≤0.032。想换品牌色，**改 `--primary` 与 `--ring` 即可**。

### 2.2 标志性配方：投影是藏青色的

这是 Stripe 最难被抄走的一层。看组件里的真实阴影值：

```css
/* 卡片 */
box-shadow:
  0 0 0 0.5px rgba(50,50,93,0.10),   /* 半像素环状描边——不是 border，是 shadow */
  0 2px 5px -1px rgba(50,50,93,0.25), /* 主投影，颜色是藏青紫而非黑 */
  0 1px 3px -1px rgba(0,0,0,0.30);    /* 贴地投影，唯一一层黑 */

/* 主按钮 */
box-shadow:
  0 4px 6px rgba(50,50,93,0.11),
  0 1px 3px rgba(0,0,0,0.08);

/* 输入框 */
box-shadow:
  0 1px 1px rgba(0,0,0,0.03),
  0 3px 6px rgba(18,42,66,0.02);      /* 另一种藏青：rgba(18,42,66) */
```

→ **投影颜色必须从蓝紫族里取**（`rgba(50,50,93)` / `rgba(18,42,66)`），不要用 `rgba(0,0,0,α)` 一把梭。黑色投影在浅色底上会产生"脏灰晕"，而藏青投影产生的是"冷调景深"，这就是这套界面看着干净的原因。
→ **`0 0 0 0.5px` 半像素外环**是它的签名手法：用 shadow 而非 border 画出比 1px 更细的边缘，缩放时不会跳。浅色界面上要做到"边缘清楚但线条不存在"，就靠这一手。

### 2.3 状态色

`--destructive` 只在删除/失败/不可逆操作出现。金融界面对"危险色"的使用极其克制——**一屏最多一处红**。

---

## 三、字体性格

`cssVars` 里没有字体 token，字体在 `globals.css` 的基础层：

```css
html { font-family: "Sohne", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
```

即：品牌字体 **Söhne**（商业字体），独立使用时回退到系统 UI 无衬线栈。

性格要点（来自组件实现）：
- **字号比同类系统小一号**：卡片标题只有 **18px**（`text-lg font-semibold`），而 Linear 用 24px。金融界面追求"信息量优先"，不靠放大标题充场面。
- **负字距**：按钮 `tracking-[-0.01em]`，标题 `tracking-tight`。西文在 14–18px 区间收紧字距，会让排版立刻显得"经过设计"。
- **行高偏紧**：标题 `leading-tight`，说明文字默认。不要给标题配 1.6 的松行高。
- 字重上限 **600**（`font-semibold`），没有 700+。

---

## 四、圆角与间距哲学

### 圆角：严格分级，且**输入框比按钮小**

`--radius: 0.375rem`（6px），派生：`--radius-sm`=2px、`--radius-md`=4px、`--radius-lg`=6px、`--radius-xl`=10px。

| 元素 | 圆角 | 来源 |
|---|---|---|
| 按钮（默认） | `rounded-md` = 6px | 组件 |
| 卡片/面板 | `rounded-lg` = 8px（源码注释写 8px，走 `rounded-lg`） | 组件 |
| **输入框** | `rounded` = **4px** | 组件注释明确写 "Radius: 4px (tighter than buttons)" |
| 小按钮（sm） | `rounded` = 4px | 组件 |

**输入框圆角比按钮更小**是这套系统的刻意选择：输入框是"容纳数据的槽"，更方一点更像容器；按钮是"可点的实体"，圆一点更好按。这条细节在多数系统里是反的——照抄时别顺手改统一。

### 间距

- 卡片内边距 **`p-6` = 24px**（与 Linear 同构，Header/Content/Footer 用 `pt-0` 抵消）
- 按钮高度 **h-8 / h-10 / h-11 = 32 / 40 / 44px**；默认 40px，比 Linear 的 36px 高一档（金融场景触控目标优先）
- 水平内边距 **`px-5` = 20px**（默认按钮），小号 `px-3`
- 输入框 **h-10 = 40px**，与默认按钮同高

→ 基础单位仍是 **8px 的倍数**（24/40/32），允许 4px 的半步（如 20px 内边距是 4 的倍数但不常见）。

---

## 五、动效与状态

- **时长 `duration-200 ease-out`**：比 Linear 的 150ms 稍慢。金融界面的反馈要"稳重"，不是"灵敏"。
- **悬停位移**：主按钮 `hover:-translate-y-px`（上浮 1px）+ 投影加深（从 `0 4px 6px` 到 `0 7px 14px`）。**位移必须与投影同步变化**——只动其中一个会像"飘"或"卡"。
- **过渡属性指名**：输入框用 `transition-[border-color,box-shadow]`。不要用 `transition: all`。
- **聚焦环带 offset**：`focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`——环与元素之间留 2px 空隙。这是**本主题与 Linear 的显著差异**：因为底色是白的，环必须离开边缘才看得清；深色主题则常用 `ring-offset-0` 贴边画环。照抄时别把 offset 当可有可无。
- **聚焦光晕**：输入框聚焦除了边框变主色，还叠加 `0 0 0 3px color-mix(in oklch, var(--primary) 20%, transparent)`——**只有 20% 透明度**，非常淡。别调高，调高就变成"发光"。

---

## 六、禁忌

| 禁忌 | 为什么 |
|---|---|
| ❌ 把正文色换成纯黑 | `--foreground` 是藏青（L=0.2651）。纯黑在浅色金融界面上会显得廉价、刺眼 |
| ❌ 用 `rgba(0,0,0,α)` 做投影 | 投影必须带蓝紫（`rgba(50,50,93)` / `rgba(18,42,66)`）。黑色投影会产生脏灰晕，是这套"高级感"最大的破坏点 |
| ❌ 用 Tailwind 的 `gray-*` 充当 `--muted` / `--border` | 这些 token 是带 247.9° 蓝相的冷白/冷灰；换成中性灰会整体变浑浊 |
| ❌ 删掉 `0 0 0 0.5px` 那层环状描边 | 这是它的边缘签名手法。少了它，卡片边会糊，加 `border` 又会变粗 |
| ❌ 把输入框圆角改得比按钮大 | 输入框 4px < 按钮 6px 是刻意设计（槽 vs 实体） |
| ❌ 大圆角 / 胶囊按钮 | 圆角上限 10px。金融界面的圆角一旦变大就"轻浮" |
| ❌ 引入第二个彩色 | 全场只有一个靛蓝（+ 一个危险红）。补色、辅助色都会破坏单强调结构 |
| ❌ 聚焦环去掉 `ring-offset-2` | 浅色底上贴边环与边框粘连，无法辨认；这是无障碍问题，不只是美观问题 |
| ❌ 把它当"深色主题的反面"来翻转 | 本主题只有一套浅色取值（`cssVars` 键名虽叫 `light`，含义是"默认且唯一"）。需要深色必须另写一套，不能靠调换变量 |
| ❌ 一屏出现多处 `--destructive` | 金融场景里红色是"钱出问题"的信号，滥用会让真正的错误失去份量 |

---

## 七、实现要点

```css
@import "./design/systems/stripe/tokens.css";

/* 卡片：注意三层投影，且第二层是藏青 */
.card {
  background: var(--card);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  padding: 24px;
  box-shadow:
    0 0 0 0.5px rgba(50, 50, 93, 0.10),
    0 2px 5px -1px rgba(50, 50, 93, 0.25),
    0 1px 3px -1px rgba(0, 0, 0, 0.30);
}

/* 主按钮：悬停位移与投影必须同步 */
.btn-primary {
  background: var(--primary);
  color: var(--primary-foreground);
  border-radius: 6px;
  height: 40px;
  padding: 0 20px;
  font-size: 14px;
  font-weight: 500;
  letter-spacing: -0.01em;
  box-shadow: 0 4px 6px rgba(50, 50, 93, 0.11), 0 1px 3px rgba(0, 0, 0, 0.08);
  transition: background-color 200ms ease-out, box-shadow 200ms ease-out, transform 200ms ease-out;
}
.btn-primary:hover {
  background: color-mix(in oklch, var(--primary) 90%, transparent);
  transform: translateY(-1px);
  box-shadow: 0 7px 14px rgba(50, 50, 93, 0.10), 0 3px 6px rgba(0, 0, 0, 0.08);
}
```

## 八、与 craft 规则的关系

- 与 `design/craft/animation-discipline.md` 一致：`ease-out` + 200ms、指名过渡属性、悬停位移与投影同步。
- 与 `design/craft/color.md` 的"非中性底上统一色相"高度呼应：本主题所有浅色面共享 247.9° 色相，是这条规则的教科书案例。
- 与 `design/craft/accessibility-baseline.md` 一致：`focus-visible` + `ring-offset-2` 的可辨识聚焦环**必须保留**。
- 需注意：源组件的投影大量使用硬编码 `rgba()`（未 token 化）。若项目需要换品牌色，投影的藏青值需要同步调整，否则会与新的主色打架——这是本主题落地时唯一需要人工判断的地方。
