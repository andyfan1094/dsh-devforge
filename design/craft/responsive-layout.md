---
name: 响应式与布局栅格
description: 内容驱动的断点策略、移动优先写法、栅格与间距阶梯、clamp 流式排版、容器查询、触控目标与横向溢出排查的通用布局工艺规则。
triggers:
  - 响应式
  - 断点
  - 栅格
  - 移动端适配
  - 自适应布局
  - 容器查询
  - 流式排版
  - 横向溢出
  - 触控目标
  - responsive
  - breakpoints
  - layout grid
od:
  category: craft
---

# 响应式与布局栅格（responsive layout）

跨品牌通用的布局工艺规则。设计系统决定用哪几档断点、间距 token 叫什么；本文件决定**断点什么时候允许加、间距从哪里取值、什么尺寸可以流体、什么尺寸必须固定**。

> **不重复的部分**：字号阶梯、行高、字距、行宽 measure 见 [`typography.md`](typography.md)；对比度地板、display 6rem 上限、间距节奏、五态齐备见 [`craft-floor.md`](craft-floor.md) 与 [`state-coverage.md`](state-coverage.md)。

## 一、断点策略：内容驱动，不是设备驱动

断点加在「布局开始难看」的那个宽度上，不加在 iPhone / iPad / 笔记本的型号宽度上。设备型号是年年变的巧合，「三列被压到每列 180px 时标题换三行」才是可复现的物理事实。

唯一可接受的断点来源：把窗口从 320px 连续拖到最宽，记录内容第一次出现下列情况时的宽度——正文单行超过 75ch（measure 取值见 `craft-floor.md`）；卡片标题换行 ≥ 3 行、或中文单行只剩 4–6 字；相邻列间距小于最小间距 token；出现横向滚动（`scrollWidth > clientWidth`）；主次层级因等宽压缩而消失（主操作与次操作同宽同色）。这些宽度就是真实断点候选。排查现有页面的真实断点，三步做完：

1. 列出样式表里声明过的全部宽度断点并去重：每个不同的值都意味着多一个必须测试的布局状态。
2. 逐个做「删除实验」：把某个断点整块注释掉，在它上下各 40px 处截图对比；视觉无变化的是僵尸断点，删掉。
3. 数量预算：页面级 3–5 档（含 320 基线）足够；组件级差异交给容器查询，不占页面断点预算。

```js
new Set([...document.styleSheets].flatMap(s => { try { return [...s.cssRules] } catch { return [] } }).filter(r => r.media)
  .flatMap(r => [...r.media.matchAll(/(min|max)-width:\s*([\d.]+)(px|em|rem)/g)].map(m => `${m[1]}-width:${m[2]}${m[3]}`)))
```

需要公开基准时可直接采用 IBM Carbon 2x Grid 的五档数值（列数与外边距已配好）：

| 档位 | 宽度（px / rem） | 列数 | 外边距 | padding |
|---|---|---|---|---|
| Small | 320 / 20 | 4 | 0 | 16px |
| Medium | 672 / 42 | 8 | 16px | 16px |
| Large | 1056 / 66 | 16 | 16px | 16px |
| X-Large | 1312 / 82 | 16 | 16px | 16px |
| Max | 1584 / 99 | 16 | 24px | 16px |

采用现成断点表是允许的，但采用之后**仍须跑一遍拖动实验**：Carbon 的 320 / 672 是给 IBM 的内容配的，你的内容可能在 780px 就已经难看。

## 二、移动优先：从 320px 起，以及它的真实代价

移动优先 = 不加媒体查询的样式就是最窄环境的完整可用样式，`min-width` 媒体查询只做增强。

```css
.grid { display: grid; gap: var(--space-4); grid-template-columns: 1fr; }   /* 基础：320px 起即成立 */
@media (min-width: 672px)  { .grid { grid-template-columns: repeat(2, 1fr); } }   /* 增强：只在更宽处改排列 */
@media (min-width: 1056px) { .grid { grid-template-columns: repeat(3, 1fr); } }
```

从 320px 起、并用 `min-width` 的理由：320px 是主流设计系统公开断点表里的最小档（Carbon Small = 320px），它逼你在写第一行 CSS 时就面对最苛刻的宽度，而不是先搭桌面布局再回来「适配」——后者产出的永远是打了补丁的桌面布局；`min-width` 让断点向上叠加，每档只需回答「从这一档起什么变了」，不必逐档重置上一档的规则，且无媒体查询时的基础布局本身可用，打印、老引擎、读屏顺序都不受影响。

**真实代价（不是白拿的收益）**：带不匹配媒体查询的样式表**仍然会下载**，只是下载优先级被降低。所以它不省请求、不省字节，买到的是「默认态可用」和「更少的覆盖声明」；成本在认知层——每多一个 `min-width` 块，就多一处必须记住「从这一档起状态是什么」的地方。

`max-width` 的例外（其余场合都该用 `min-width`，且不要在同一根轴上混用两种方向；若必须混用，两个值不要相等，否则断点边界附近容易出现两条规则双双命中或双双落空）：

| 场景 | 理由 |
|---|---|
| `@media print` | 打印与屏幕是介质差异，不是宽度递增关系 |
| 对不可修改的第三方组件做局部降级 | 只能在它既有样式之上做减法 |
| 表达硬性上限（如超宽屏禁止三栏继续拉伸） | 表达的就是上限，写成 `min-width` 会绕远 |
| 偏好类与减法类条件（`prefers-reduced-motion` / `prefers-contrast`） | 逐条覆盖默认增强，天然是减法 |

## 三、栅格与间距

栅格是否有用的判据只有一条：**你能不能说清自己需要哪些分母**。需要「跨 2 / 3 / 4 / 6 列」这种可协商比例，且同页多个区块必须对齐同一条 key line（仪表盘、表单 + 说明、图文混排）时才有用；Carbon 用 16 列（16 内做 2 / 4 / 8 分割，最小档 4 列），12 列同样能整除出 2 / 3 / 4 / 6。说不清分母、或内容条目数不定（卡片墙用 `auto-fit` 更稳）、或只有单栏长文布局，栅格就是负担。

外边距、列间距、padding 的关系可照搬 Carbon：**基准单元 8px**；所有外边距与 padding 都是 8 的整数倍；padding 固定 16px；使用列间距时每个盒子的外边距等于它自己的 padding，**总 gutter = 32px**；页面外边距在断点内固定（0 / 16 / 16 / 16 / 24px），不随窗口缩放漂移。

- **页面外边距 ≥ 列间距**，否则页面边缘比内部更挤。
- **间距用固定值，宽度才用流体值**，随视口缩放的 gap 会让「同组紧凑、异组宽松」的节奏失效。
- Small 档外边距为 0 不等于贴边：留白由 16px padding 提供，视觉结果仍是 16px。

间距阶梯（4 / 8 基准）：

| 用途 | 建议值 | 典型场景 |
|---|---|---|
| 密集控件内部 | 4px | 图标与文字、tag 内部、紧凑行 |
| 基准单元 | 8px | 间距原子：标签与输入框、列表项内元素 |
| 小间隔 | 12–16px | 同组元素之间、表单字段之间（Carbon padding = 16px） |
| 组间距 | 24–32px | 不同分组之间（gutter 总量 = 32px） |
| 区块间距 | 48–64px | 页面大区块之间 |

**纪律**：任何 `margin` / `padding` / `gap` 的值必须来自 token 表。出现 7px、13px、30px 这类非基准倍数值即为违反——它不是审美问题，而是「这一处的节奏不在系统内」的可判定证据。

## 四、流式排版与流体间距

`clamp(最小值, 首选值, 最大值)`。首选值不要写成纯视口单位（如 `4vw`）：纯 `vw` 在窄屏小到不可读、在宽屏大到失控。正确形态是 `rem + vw` 的线性插值，Utopia 给出的公式是：

```
Slope = (MaxSize - MinSize) / (MaxWidth - MinWidth)   yIntersection = (-1 * MinWidth) * Slope + MinSize
font-size: clamp(MinSize[rem], yIntersection[rem] + Slope * 100vw, MaxSize[rem])
```

代入 1rem 到 2rem、视口 320px 到 1440px，得到一行可直接用的结果：`--step-0: clamp(1rem, 0.7143rem + 1.4286vw, 2rem)`。

**该流体的**：display / h1 / h2 字号、区块纵向间距、hero 内边距、栅格 gap、卡片内大留白。

**绝不该流体的**：

| 属性 | 为什么必须固定 |
|---|---|
| `line-height` | 用无单位倍数（CJK 下限见 [`typography.md`](typography.md)），流体行高会与字号缩放互相干扰 |
| `border` / `outline` 宽度 | 1px 描边在任何宽度都是 1px，流体会在窄屏糊成亚像素 |
| 图标尺寸、焦点环宽度 | 图标要与相邻文字的字号、描边成整数关系；焦点环必须恒定可见，不能因宽度变化而变细 |
| 圆角、分隔线、触控目标最小边 | 都是离散常量，不是可缩放尺度 |

上下限纪律：`max` 不超过 `craft-floor.md` 的 display 上限 6rem，`min` 不低于正文字号下限（15–16px）。必测项：clamp 会影响用户开启浏览器文字缩放时的实际最大字号表现，因此**流体字号上线前必须实测「页面缩放 200%」与「系统文字放大」两种情况**——不是禁止，而是必测。组件内部的流体值用 `cqw` / `cqi`，不要用 `vw`：组件被放进侧栏时 `vw` 仍按整个视口算，与它实际可用宽度无关。

## 五、内容容器与容器查询（@container）

分工：页面骨架的相对关系（header / sidebar / main 谁让谁）用 `@media`；**组件自身**在不同槽位里的表现用 `@container`。

```css
.post { container: sidebar / inline-size; }   /* 建立并命名容器 */
@container sidebar (width > 700px) { .card h2 { font-size: 2em; } }
```

| 要点 | 事实 |
|---|---|
| `container-type` | `inline-size` 最常用（只查内联轴）；`size` 会同时施加 layout / style / size containment，可能改变固有尺寸计算，仅在需查块轴时用；默认 `normal` 不建立尺寸容器，但仍可用于命名查询与样式查询 |
| 长度单位与命名 | 单位 `cqw` / `cqi`（内联轴 1%）/ `cqh` / `cqb` / `cqmin` / `cqmax`；跨组件引用时给容器命名，避免命中最近的另一个容器 |
| 无可用容器时 | 容器查询长度单位回退为小视口单位（`sv*`），不要把 `cqi` 当成绝不会出错的值 |

适用场景：可复用卡片、放进侧栏的筛选面板、同一组件被放进 2 列与 4 列两种栅格。**每组件 2–3 档容器断点足够**，档位过多会让测试组合爆炸。回退方式：基础样式写成「窄容器版本」，让宽容器成为增强；需要兼容旧引擎时用 `@supports (container-type: inline-size)` 包住增强块，在 `@supports not` 分支里用页面断点近似。

## 六、布局原语：用 flex / grid 表达意图

卡片墙（首选，不需要断点表）：

```css
.cards { display: grid; gap: var(--space-4);
         grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr)); }
```

`auto-fit` 与 `auto-fill` 的差别可判定：`auto-fit` 在放置完条目后**折叠空轨道**（空轨道按 0px 处理，两侧 gap 一并消失），条目少时卡片拉伸铺满整行；`auto-fill` 保留空轨道，条目少时右侧留白。`minmax()` 的最小值必须写成 `min(100%, 18rem)`：直接写 `18rem` 时，容器一旦窄于 18rem 轨道就拒绝收缩，直接造成横向溢出。

按内容自身宽度换行（intrinsic）：`.cluster > * { flex: 1 1 20rem; }` 配 `display: flex; flex-wrap: wrap; gap`，含义是「尽量 20rem 宽，具体由浏览器分配」。对照写法 `width: 33.333%` 再加两级 `max-width` 媒体查询，是把列数与视口宽度硬绑在一起，冗长且不可靠。

Switcher 原语（直接横排或竖排，跳过中间态）：`flex-basis: calc((var(--threshold) - 100%) * 999)` 配 `flex-grow: 1`。容器窄于阈值时 `calc` 为大的正值，元素占满整行（竖排）；宽于阈值时为负值，负 `flex-basis` 非法被丢弃，`flex-grow` 接管（横排）。条目过多时用数量阈值兜底：`:nth-last-child(n+5), :nth-last-child(n+5) ~ * { flex-basis: 100%; }`。间距一律用 `gap`，不再做负 margin 补偿。

subgrid（跨卡对齐）：用于「卡片内标题 / 正文 / 按钮在多张卡片之间横向对齐」。要点：Baseline 2023 起可用；gap 默认从父栅格继承、可局部覆盖；**subgrid 维度不生成隐式轨道**，条目超出会挤进最后一轨；内部行号从 1 重新开始（同一组件放到父栅格不同位置时行号始终稳定）。兼容未覆盖时用 `@supports (grid-template-columns: subgrid)` 包裹，回退到普通嵌套栅格。

判定：能用「最小可接受宽度 + 让浏览器分配」表达的布局，不要写成「列数对应视口宽度」的映射表。

## 七、触控与指针

**最小目标尺寸**：WCAG 2.2 SC 2.5.8 要求指针目标至少 24 × 24 CSS px；不满足时可用**间距例外**——以目标包围盒中心画一个 24 CSS px 直径的圆，该圆不得与任何相邻目标、或相邻欠尺寸目标的圆相交。实践换算：20 × 20 的目标只要与相邻目标留出 4px 间隙即可通过，20 × 20 且零间隙不通过。行内链接（句子中的链接）不受此约束，不要为达标而破坏文本行高。主操作可参照更严格的 SC 2.5.5（Enhanced）；移动端 44–48px 属**经验区间**，本文件的硬底线只有 24 × 24。

**悬停态在触屏上失效**：触屏没有真正的 hover，`:hover` 会在点击后粘住；写法是把悬停增强整体放进条件里。

```css
.card { border: 1px solid var(--border); }        /* 默认态：无 hover 也看得懂 */
@media (hover: hover) { .card:hover { box-shadow: var(--shadow-2); } }
```

`hover` 描述**主输入机制**能否方便地悬停，取值 `none` 表示主输入机制无法悬停或无主指针设备（含「长按才触发」的模拟悬停）。指针精度用 `pointer: coarse` 放大命中区与相邻间距；混合设备（笔记本 + 触屏）要看 `any-pointer` / `any-hover`，只看 `pointer` 会漏判。触屏判定项：320px 宽下所有可点元素不依赖 hover 就能看出可点（边框 / 底色 / 图标至少一项），状态变化不能只在 `:hover` 里发生。

## 八、媒体与长内容的抗压

图片与视频由容器决定裁切比例，不写死像素尺寸：

```css
.media { aspect-ratio: 16 / 9; }
.media img, .media video { inline-size: 100%; block-size: 100%; object-fit: cover; display: block; }
img { max-inline-size: 100%; height: auto; }
```

长 URL 与长英文单词：`overflow-wrap: anywhere` 会在任意位置断行，并且参与 `min-content` 尺寸计算，因此能真正消除溢出；`overflow-wrap: break-word` 只在必要时断行，对 `min-content` 计算影响较弱。判定：塞入一段 200 字符、无空格无连字符的 URL，容器内不得出现横向滚动。

表格横向滚动：让表格自己滚，不要让整页滚——`.table-wrap { overflow-x: auto; max-inline-size: 100%; }` 加 `.table-wrap > table { min-inline-size: 40rem; }`。40rem 是**经验值**，按「列数 × 最小可读列宽」推，不要照抄；同时保证容器可聚焦并有可访问名称（见 [`accessibility-baseline.md`](accessibility-baseline.md)）。

flex / grid 子项：子项默认 `min-width: auto`，长内容会把父容器撑破，所有承载文本的子项显式写 `min-inline-size: 0`。

## 九、横向溢出的系统排查法

先定位再修，顺序不能颠倒：

```js
const vw = document.documentElement.clientWidth;
[...document.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > vw + 1)
  .forEach(el => console.log(el, (el.getBoundingClientRect().right - vw) + 'px 超出'));
```

命中元素后，按固定顺序（从最常见到最隐蔽）逐条排除：

| 顺序 | 元凶 | 判定动作 |
|---|---|---|
| 1 | `100vw` / `100vmax` | 桌面有纵向滚动条时 `100vw` 含滚动条宽度，比可用宽度宽（Windows 桌面浏览器约 15–17px，**经验区间**）；改成 `100%` 或 `width: auto` 后溢出消失即命中 |
| 2 | 负 margin | 形如 `margin-inline: -16px` 把内容推出容器；把该值临时归零，溢出消失即命中 |
| 3 | 固定宽度 | `width: 320px` / `min-width: 600px`，或 `width: 100%` 叠加 padding 却未用 `box-sizing: border-box`；替换为 `max-inline-size: 100%` 验证 |
| 4 | absolute 定位 | 绝对定位元素右边缘锚定在父级之外，父级既无 `position: relative` 也无溢出约束；加 `outline: 1px solid red` 定位后验证 |
| 5 | `min-width` | 子项 `min-width: auto` 被内容撑开，或 `minmax()` 最小值写成固定长度而非 `min(100%, X)`；补 `min-inline-size: 0` 验证 |

**禁止用 `overflow-x: hidden` 掩盖**：它只是把缺陷藏起来，还会破坏 `position: sticky` 与内部滚动容器；排查的唯一正确终点是找到那个真正超宽的元素。

## 十、常见失败模式（逐条判定）

- 断点值是 768 / 1024 这类设备型号宽度，而不是内容出问题的宽度。
- 用 `max-width` 从大往小写，基础布局只在大屏成立；手搓百分比列宽 + 多级媒体查询，代替 `flex-basis` / `auto-fit`。
- 间距出现非 4 / 8 倍数的值（7px、13px、30px）；列间距靠列宽反推，间距随视口漂移。
- 对所有尺寸无脑 clamp，包括 line-height、border、图标。
- clamp 上下限与断点重复表达同一件事，冲突时行为不可预测。
- 组件在侧栏被压扁时用页面级媒体查询兜，而不是容器查询；同页两处同款卡片表现不一致。
- 可点元素的视觉标识只写在 `:hover` 里。
- 触控目标小于 24 × 24 且不满足间距例外。
- 图片写死像素宽高，或 flex 子项缺 `min-inline-size: 0`。
- 长 URL 撑破卡片；数据表格在窄屏把整页顶出横向滚动，而不是表格自身滚动。
- 用 `overflow-x: hidden` 让溢出「消失」。
- 从未在 320px 下实际看过页面；用 `100vw` 做全宽元素。

## 十一、交付前自检清单

- [ ] 在 320px、最小断点、最大断点、以及至少两档中间宽度各看过一次，并保留截图。
- [ ] 每个宽度下 `document.documentElement.scrollWidth === clientWidth`。
- [ ] 所有 `margin` / `padding` / `gap` 的值都在间距 token 表内。
- [ ] 正文行宽在各断点都落在 45–75ch 区间。
- [ ] 所有悬停增强都包在 `@media (hover: hover)` 内，默认态不依赖 hover 即可理解。
- [ ] 所有可点目标 ≥ 24 × 24 CSS px，或满足「24px 直径圆不相交」的间距例外。
- [ ] 长 URL、长中文串、长英文单词三种填充内容各试一遍；表格与代码块在窄屏自身横向滚动，不带动整页。
- [ ] 图片与视频在窄屏等比缩放、不变形、不溢出；组件在侧栏宽度下单独看过（容器查询确实生效）。
- [ ] 流体字号的上下限与 display 6rem 上限一致，缩放 200% 时仍可读。
- [ ] `@media print` 单独看过，未被响应式规则破坏；窄屏键盘 Tab 顺序正确、焦点环可见。

---

## 来源

本文件为**中文整理**，不是任何来源的逐句翻译；技法表述、数值阈值与判定方式均由整理者重写与合并。以下为**实际抓取过**的页面：

| # | 来源 | URL | 许可 / 用途 |
|---|---|---|---|
| 1 | MDN《CSS container queries》 | https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Container_queries | 页脚标注 Creative Commons（具体条款以 MDN 版权页为准）；容器查询用法与容器长度单位 |
| 2 | MDN《Using media queries》 | https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries/Using | 同上；媒体特性清单、`hover` / `pointer`、「不匹配的样式表仍会下载」 |
| 3 | MDN《repeat()》 | https://developer.mozilla.org/en-US/docs/Web/CSS/repeat | 同上；`auto-fit` / `auto-fill` 折叠空轨道的行为定义 |
| 4 | MDN《hover（@media）》 | https://developer.mozilla.org/en-US/docs/Web/CSS/@media/hover | 同上；`hover: none` 的判定语义 |
| 5 | MDN《Subgrid》 | https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout/Subgrid | 同上；Baseline 2023、隐式轨道、gap 继承、行号重启 |
| 6 | W3C WAI《Understanding SC 2.5.8 Target Size (Minimum)》 | https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html | W3C 文档许可；24 × 24 CSS px 与间距例外的原文判据 |
| 7 | Every Layout《The Switcher》 | https://every-layout.dev/layouts/switcher/ | 页面未标注开源许可（第二版为付费内容），仅作技法与事实引用，未复制其付费章节文本 |
| 8 | Utopia《Clamp》 | https://utopia.fyi/blog/clamp/ | © Clearleft / James Gilyead & Trys Mudford；线性插值公式与 clamp 缩放风险 |
| 9 | IBM Carbon《2x Grid》 | https://www.carbondesignsystem.com/building-blocks/foundations/2x-grid/overview | 页面未标注内容许可，仅引用公开数值（8px mini unit、16px padding、32px gutter、320 / 672 / 1056 / 1312 / 1584 断点表） |
| 10 | MDN《overflow-wrap》 | https://developer.mozilla.org/en-US/docs/Web/CSS/overflow-wrap | 页脚标注 Creative Commons；`anywhere` 与 `break-word` 在 min-content 计算上的差异，以及「仅在整词无法放入时才断行」 |

**未采用**：`every-layout.dev/layouts/frame/` 为付费内容，页面未给出技法正文，故未引用其任何内容。**标注为经验区间、未在来源中逐项核验的数值**：Windows 桌面滚动条约 15–17px；移动端触控目标 44–48px 惯例；表格 `min-inline-size: 40rem` 阈值——这三项按经验值使用，落地时须以目标平台实测为准。
