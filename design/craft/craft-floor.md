---
name: 工艺地板
description: 设计工艺的硬性数值底线与拒绝清单：对比度、行宽 measure、display 字号上限、字距地板、圆角区间，以及必须齐备的交互状态。
triggers:
  - 工艺地板
  - 质量底线
  - 验收标准
  - 对比度
  - 行宽
  - 字号上限
  - 圆角
  - 设计检查清单
  - craft floor
od:
  category: craft
---

# 工艺地板（craft floor）

> **来源**：译自 impeccable `skill/reference/craft-floor.md`（52 行，Apache-2.0，© 2025 Paul Bakaus）。
> **本文件的角色**：impeccable 源档案的忠实译本。**全部可执行数值阈值只在这里出现一次**（对比度、measure、display 上限、tracking 地板、圆角区间…）；规则的「合并统一措辞 + 判定方式」见 [`anti-slop-unified.md`](anti-slop-unified.md)，不在此重复。
> **保留项**：每条末尾的 `rule:` 注释是 impeccable 引擎（59 条确定性检测规则）的规则 id，供后续做确定性 lint 时对齐；`<codex>` 段是源文件中的补充条款段。

方向定下来之后再加载本文件，**不要一边搭一边念清单**。已固定的 brief 或已承诺的视觉世界优先于本文件任何一条；你自己的习惯不优先。设计钩子（design hook）生效时，下面的机械检查会在你编辑的过程中实时报出——直接执行它的结论，不要逐条重新自审一遍。

## 验证（Verify）

下列每一条都是对**已建成的结果**的检查，不是意图声明。把它们合并到同一批渲染回合里一次跑完，不要为每条单独截一次图——这些检查共用同一次渲染。

- **对比度**：正文与 placeholder 文字 ≥ **4.5:1**，大字号文字 ≥ **3:1**。在有色表面上，次级文字要**从该色相或前景色取色**，永远不要直接上灰色。<!-- rule:skill-color-verify-contrast -->
- **深度**：阴影必须带偏移量 + 柔和模糊。**零偏移的彩色光晕是装饰，不是深度**。<!-- rule:skill-color-no-glow-halo -->
- **间距**：同组紧凑、异组宽松；标题**上方留白多于下方**。读计算后的真实值，不要凭感觉。<!-- rule:skill-layout-spacing-rhythm -->
- **字体**：正文行宽（measure）**65–75ch**；display 字号上限 **6rem**；字距（tracking）地板 **−0.04em**；标题行平衡；字号与字重的层级跳变要明显。**把真实文案在每个断点都跑一遍**，修掉所有溢出。<!-- rule:skill-typo-floor --><!-- rule:skill-ban-text-overflow -->
- **动效**：只留**一个有意图的时刻**——不要散落的特效，也不要每个 section 都用同一个入场动画。用指数型 ease-out，从「本来就可见」的默认态出发。材质不要只停在 transform / opacity：`blur`、`backdrop-filter`、`clip-path`、`mask`、`shadow` 只要过渡平滑，都属于可用的调色板。<!-- rule:skill-motion-floor --><!-- rule:skill-motion-materials-palette --><!-- rule:skill-motion-no-section-fade -->
- **状态**：hover、disabled、loading、error、empty 五态齐备；外加真实内容、可用的控件、响应式构图、键盘焦点。<!-- rule:skill-floor-shipping -->
- **浏览器原生面**：你没画的那部分**也在承担设计**。文本选区、光标（caret）、自定义滚动条、焦点环、下划线偏移量、表格数字的字形——这些都带着浏览器默认样式出厂，而默认样式不属于任何设计系统。**用调色板给它们上色**。这是「一页是被建造出来的、而不是被拼装出来的」最便宜的证据，也是模型最稳定会漏掉的一项。<!-- rule:skill-craft-browser-surfaces -->
- **文案**：用产品自己的语言。控件名要说清它执行什么动作；错误信息要说清问题是什么、怎么恢复。<!-- rule:skill-copy-design-material -->
- **覆盖度**：brief 的每一条要求都已落地，且能在几秒内找到。<!-- rule:skill-floor-brief-coverage -->

## 拒绝（Refuse）

下列是**该品类的默认值，不是禁令**：brief 自己的说法可以为其中任何一条挣得豁免。当某个轴是自由的时候你却伸手去够它们，说明你**没有在做决定**；意识到这一点，意味着重写那个元素，而不是把它调弱一点。

### 页面骨架

- 以「图标 + 标题 + 说明」的**同尺寸卡片**作为页面结构。卡片是偷懒的容器；**卡片嵌套永远是错的**。<!-- rule:skill-ban-identical-card-grids --><!-- rule:skill-layout-cards-lazy -->
- **hero 大数字模板**：大数字 + 小标签 + 几组佐证数据 + 强调色。<!-- rule:skill-ban-hero-metric -->
- 标题上方的 **kicker / eyebrow**。这一条是**禁令而非默认值**：任何 brief 都挣不回它。标题自己就该承载重量——删掉那个标签，让标题说话。<!-- rule:skill-ban-eyebrow-on-every-section -->
- **章节编号**（01 / 02 / 03），除非序号本身携带读者需要的信息。<!-- rule:skill-ban-numbered-section-markers -->
- 对既不需要打断、也不需要受保护注意力的任务使用 **modal**。<!-- rule:skill-reflex-modal-by-reflex -->

### 表面习惯

- **渐变文字**。强调应当来自字重或字号。<!-- rule:skill-ban-gradient-text -->
- 把**玻璃与模糊**当装饰用，而不是当某个特定效果用。<!-- rule:skill-ban-glassmorphism-default -->
- 卡片、列表项、callout、alert 上**超过 1px 的彩色 `border-left` / `border-right`**。<!-- rule:skill-ban-side-stripe-borders -->
- **硬偏移阴影**（`box-shadow: 4px 4px 0`），除非这个视觉世界**真的是**新粗野主义。零模糊的实心块阴影是一套戏服，不是一套深度系统；没主动选择它的世界永远挣不到它当默认值。<!-- rule:skill-ban-hard-offset-shadow -->
- 用 **sparkline、进度环、柔和阴影的圆角矩形** 顶替内容。<!-- rule:skill-reflex-decorative-chrome -->
- 把 **monospace** 当「技术感」的戏服穿，而不是用于代码、数据或度量。<!-- rule:skill-reflex-mono-as-technical -->
- 在自有世界的页面上，用**系统 display 字体**（Impact、Arial Black、平台默认无衬线）当 display 声音。**寻找并自托管**一个性格匹配已批准字形方案的字体；「装得到的最接近的那个」是失败，不是回退。<!-- rule:skill-ban-system-display-face -->
- 用 **Unicode 字形或 emoji 顶替图标系统**。图标是画出来的——来自真实图标库或自己创作的 SVG，**描边与字重统一**。<!-- rule:skill-ban-glyph-icons -->
- 用**几何遮罩**冒充有机轮廓。用圆、多边形或 radial-gradient 挖空去近似摄影主体的边缘，是这类效果里最廉价的版本，**比不做更难看**。要么从真实图像导出 alpha 蒙版，要么产出抠好的切图资产。<!-- rule:skill-ban-geometric-occlusion-mask -->
- **按品类**选浅色或深色。要按使用场景选：谁、在哪、在什么环境光下。<!-- rule:skill-reflex-theme-by-habit -->

### codex 补充条款

- 字距**止于 −0.04em**；**−0.02 到 −0.03em 通常更好看**。<!-- rule:skill-typo-codex-tracking-repeat -->
- 层级只声明一次：要么 border，要么 shadow。**1px 描边压在宽而柔的阴影上，就是「幽灵卡片」**。卡片圆角保持 **12–16px**；胶囊形留给小型控件。<!-- rule:skill-codex-elevation-radius --><!-- rule:skill-ban-codex-ghost-card --><!-- rule:skill-ban-codex-over-round -->
- **要么真实插画，要么什么都不放**。草稿风 SVG 场景、`loose-sketch` / `doodle` 这类类名、`feTurbulence` 颗粒，一律读起来像业余作品。这条禁的是**SVG 冒充图片**，从不禁 SVG 做几何：清晰的矢量形状、图表、动画线稿、shader 驱动的效果仍是一等媒介。带明暗、带透视、或含人物形象的插画，即使画成线稿也是一张图片；几何指的是「一个会话能精确指定出来的形状」。<!-- rule:skill-ban-codex-sketchy-svg -->
- **背景是表面**，只从主题自己的世界里取纹理。`repeating-linear-gradient` 条纹与双轴网格叠加层，下面必须真的有画布、地图、蓝图或测量工具作为支撑。<!-- rule:skill-ban-codex-stripes --><!-- rule:skill-ban-codex-grid-backgrounds -->
- **声明与配置只能来自被给予的事实**；示意性数值要**如实标注**。先命名一个概念再把它反讽掉，不算声明。<!-- rule:skill-codex-material-honesty --><!-- rule:skill-ban-codex-x-theater -->

---

地板管的是机械层，它**从不替你选方向**。等每一项检查都绿了，把这一页的花费全部投在已承诺的那个世界上；在「更精致」与「更坚定」之间犹豫时——**选坚定**。<!-- rule:skill-floor-not-ceiling -->
