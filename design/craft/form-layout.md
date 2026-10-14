---
name: 表单布局与字段编排
description: 表单的静态结构判据：单列纪律、标签位置与文案、控件宽度与内容匹配、字段分组与顺序、帮助文本、必填标记、操作区、多步表单与设置页。
triggers:
  - 表单
  - 表单布局
  - 表单设计
  - 字段编排
  - 标签位置
  - 必填标记
  - 帮助文本
  - 多步表单
  - 输入框宽度
  - 设置页
  - form layout
  - form design
od:
  category: craft
---

# Form layout and field composition craft rules

表单**长什么样**的通用规则：列数、标签、宽度、分组、顺序、操作区、分步与设置页。校验**何时触发**、错误如何播报、schema 契约在哪一层，见 `form-validation.md`；标签与 `aria-describedby` 的无障碍接线见 `accessibility-baseline.md`。本文只回答一件事：字段在页面上怎么摆，才能让用户看一眼就知道该往哪儿填。

> 依据实际抓取的一手来源：GOV.UK Design System（Text input / Fieldset / Textarea / Date input / Button / Task list / Error summary / Spacing）、GOV.UK Service Manual《Structuring forms》、U.S. Web Design System（Form / Text input / Step indicator / Complete a complex form）、IBM Carbon Design System（Form guidelines 与 specifications）、Nielsen Norman Group（表单白空间、占位符危害、Reset 按钮、autosave 期望）、MDN `inputmode`。许可与链接见文末「来源」。

## 一条主轴：默认单列

**为什么单列是默认**（理由都可判定，不是审美偏好）：

- **视觉配对不会断。** 用户不必判断"这个标签配左边还是右边那个框"。
- **视线路径最短。** 左对齐标签方案下，每填一个字段都要做一次左→右的横向扫视；字段越多成本线性累加，并直接转化为错行填写。
- **Tab 顺序天然正确。** 自上而下就是逻辑顺序，不需要 `tabindex` 补丁。
- **高度变化只影响本行。** 错误提示、帮助文本、字数统计出现或消失时不会牵动邻列。

**仅以下四类允许双列**，必须逐条对照，不能凭"屏幕很宽"开工：

| 允许双列的情形 | 判定依据 | 例子 |
|---|---|---|
| 语义成对的字段 | 两个字段一起读才构成一个完整值 | 有效期起 / 止、最小值 / 最大值 |
| 地理或日期成组 | 内容本身就是"同一件事的两个分量" | 省 / 市、日 / 月 / 年 |
| 缩短字段对 | 两个字段短且高度相近 | 名 / 姓（仅当两词均 ≤10 字符） |
| 只读的对照字段 | 一列显示值、一列显示单位或口径 | 金额 / 币种 |

一行最多 **2 个控件**，禁止三列及以上；右对齐标签 + 左对齐值的对照式只用于只读信息，不用于输入。

**双列的具体代价：**

- **错误态连带撑高整行。** Carbon 明文要求：双列中左列的错误提示把内容往下推时，右列必须同步增长以维持对齐。任何"逐字段独立高度"的实现立刻破功。
- **键盘遮挡更早发生。** 一屏被劈成两半后，375px 视口下一行的两个控件都落到折叠线以下，键盘弹出即遮住当前焦点。
- **移动端必须回落单列。** Carbon 的硬约束：移动端表单只能单列。双列因此必须附带断点回退规则。
- **标签换行即配对崩。** 只要有一个标签折行，那一行的左右配对关系就读不出来了。

## 标签

| 方案 | 判定 | 代价 |
|---|---|---|
| **顶部标签（默认）** | 采用，除非命中下面两行的条件 | 表单变长，滚动距离增加 |
| 左对齐标签 | 仅限桌面端高密度录入（字段 > 8 个）、标签普遍 ≤2 个词、有横向空间预算 | 每字段一次横向扫视；标签换行即错行；移动端须回落顶部 |
| 占位符当标签 | **禁止**（理由见下段） | 标签在输入后消失，复查时字段含义不可知 |

**为什么禁止占位符当标签：** 用户一输入文字标签就消失；复查半填表单时无法确认字段原本要什么；部分读屏器不朗读占位符；浏览器默认占位符颜色通常不满足 WCAG AA 对比度。GOV.UK 与 NN/g 立场一致——不要用占位符代替标签，也不要用它承载提示或示例。浮动标签（focus 时标签上浮）被 NN/g 列为"可用但非首选"：它省纵向空间，但用户开始输入前仍看不到完整标签；只在移动端空间确实紧张时采用。

**标签文案规则（四条）：**

- **用名词短语**，不用完整问句：写「公司名称」，不写「请问您公司的名称是？」。单问题页面可把标签兼作页面标题（GOV.UK 的 `isPageHeading`）；同页多个问题时**不得**把任一标签提为页面标题。
- **句式统一：** 同一表单内标签的字数、语序、单位写法一致，不要混用「金额（元）」和「金额，以元为单位」。
- **句首大写，不加冒号：** 末尾的 `:` 是视觉噪音，读屏时还会被读出来。
- **长度 1–6 个词：** 超出说明该拆成"标签 + 帮助文本"两段，而不是写一个长标签。标签与输入框间距 **4–8px**（GOV.UK 的 spacing unit 1 = 5px 是典型值），且必须显著小于字段间距。

## 控件宽度与内容匹配

**宽度是内容提示。** 过宽让用户误判"要填很多"，过窄导致内容被截断、反复横向确认。GOV.UK 用按字符数标定的固定宽度（`govuk-input--width-N`，N ∈ 2/3/4/5/10/20/30），并要求邮编框是邮编大小、电话框是电话大小；USWDS 用 `ex` 给出等价梯度：`2xs`=5ex、`xs`=9ex、`sm`=13ex、`md`=20ex、`lg`=30ex、`xl`=40ex、`2xl`=50ex。选一套进 token 即可。

| 字段 | 建议宽度（字符） | 依据 |
|---|---|---|
| 日 / 月 | 2 | 固定位数的日期分量 |
| 年 | 4 | 4 位年份 |
| CVC、验证码 | 3–4 | 位数固定 |
| 邮编 / 区号 | 8–10 | 长度已知且短 |
| 手机号 | 10–20 | 依国家格式 |
| 邮箱 | 20–30 | 典型长度上限 |
| 姓名、地址行 | 30 或占满容器 | 长度不可预估 |
| 中文专名 | 按约 2 倍字符宽度计 | 汉字占位约为拉丁字母两倍 |

固定宽度用于长度已知的字段，流体宽度（`govuk-!-width-two-thirds` 这类）用于"长度不可预估但不必占满"的字段。两者都要有容器级上限：正文内容列宽控制在约 **2/3 容器**（GOV.UK 正文即 `govuk-grid-column-two-thirds`），不要把输入框拉到 1920px 宽。

**控件尺寸与行高：** 输入框高度由**正文行高 + 上下内边距**决定，不要写死 `height`，否则用户放大字号或换字体时会裁切文字；字段文本字号不低于正文体系的最小可读字号（Carbon 的 label 与 helper text 是 12px，但**字段文本是 14px**，即 `$body-compact-01`）；同屏输入框高度必须一致，textarea、select、input 的基线要能对齐，否则一行里出现三种高度。

**文本域与选择器：** textarea 行数按预期回容量给，至少 3 行、默认 4–5 行（GOV.UK 示例用 `rows="5"`），给 `resize: vertical` 或完全禁用，**禁止** `resize: both` 让用户把宽度拖出容器；select 宽度按"最长选项在目标视口内完整可读"定、通常 20–30 字符，不要为"避免换行"把 3 个选项的下拉框拉成 100% 宽（会被误读成文本框），选项文案过长时先缩短文案再考虑放宽控件。

## 字段分组与顺序

**fieldset 的边界：** `<fieldset>` + `<legend>` 用于**多个输入共同回答一个问题**的场合：地址的三个输入、日/月/年三个分量、同属一个主题的多选组。GOV.UK 的标准做法是把「你住在哪里？」作为 legend，下面挂地址行 1、地址行 2、城市、邮编各自的 label。

反向约束：不要为视觉分区而套 fieldset——分区内只有一个输入不需要；只是"看起来相近"而无共同语义的，用留白加小标题即可；legend 与子字段 label 不得表达同一件事。判定一句话：**如果需要一句话整体说明这一组、或这一组会共享同一个错误提示，就用 fieldset；否则不要。**

**字段顺序按用户心智，不按数据库：**

- **先问能筛掉人的问题。** 资格、适用范围这类会终止流程的字段放最前，避免用户填完二十个字段才被告知不符合条件。
- **用分支隐藏不相关字段**，而不是让用户自己跳过。
- **把难的字段放前面。** 用户注意力与耐心在表单前端最高，把需要翻证件、需要决策的字段前置。
- **禁止照搬数据库列顺序或 API schema 顺序。**「创建时间」「内部备注」「租户 ID」不属于用户心智模型；用户排序的依据是"我手上有什么、先给什么"。
- 已在上游取得的字段不重复问；确需确认时给"确认/修改"入口，而不是重开一个空输入框。

**组内与组间距的比例。** 组内必须显著小于组间，用户才能在一屏内看出"这是两件事"。落在 token 上的取值：组内字段间距 **16–32px**（Carbon `form items margin-bottom` = 32px）；组间间距 **≥ 组内的 1.5–2 倍，目标 40–64px**（经验区间，由"组内 < 组间"推导）；标题区与第一个字段 **40px**（Carbon `title area margin-bottom`）；最后一个字段与按钮 **48px**（Carbon `buttons margin-top`）；双列 gutter **32px**。紧凑场景可按比例整体缩小，但**组内 < 组间**这个比值关系不能破。

## 帮助文本与示例

- **位置：** 主体位置是**标签下方、输入框上方**（GOV.UK 的 hint 位置）。放输入框下方也可接受，但错误提示同样落在那条线上，容易混淆；两处都要有时，错误必须是唯一带警示样式的那条。
- **长度上限：一句话、30 字内、末尾不加句号。** 读屏器在用户进入控件时会朗读整段，过长即噪音；GOV.UK 要求 hint 只承载"多数用户都需要"的信息且不长于一个短句。
- **禁止在帮助文本里放链接。** 读屏器朗读链接文字时不会说明"这是链接"；需要链接时放到标签或正文段落。
- **帮助文本不得承载关键信息。** 不看这条提示就无法完成任务时，它必须常驻页面。Carbon 的对应规则是 tooltip 只放解释性、附加性内容，绝不是"放不下就塞这儿"的容器。
- **示例与占位符分工：** 格式示例（「例如，27 3 2007」）写进帮助文本，不用占位符；占位符只用于输入提示或自动补全暗示，**不得**重复标签、不得放示例、不得放格式要求；有强格式约束的字段（日期、证件号、金额）用分组输入 + 帮助文本示例，而不是"自由文本框 + 一段正则说明"。
- 字长限制与字数统计属于字段自身的状态，不要用帮助文本"预告"限制——用户需要在输入过程中持续看到剩余量。

## 必填与可选

- **默认标记可选，不标记必填。** 在可选标签末尾加「（可选）」，GOV.UK 的地址示例即 `Address line 2 (optional)`。必填是常态，标必填等于给每个字段加一次视觉噪音、用户仍要逐条确认；标可选只需用户找到那条少见的例外。
- **只标一次。** 同一表单内不得部分字段标「*」、部分标「必填」、部分标「（可选）」。选一种，全篇统一。
- **`required` 不能替代可见标记。** 标记必须进入可见标签文本；只靠 `required` 属性不满足视觉用户，读屏播报也因实现而异。
- **先做减法，再谈标记。** 判断一个字段是否该留的唯一问题是"没有它服务还能不能完成"；否才留，答不上来就删。字段越多放弃率越高，这个结论先于任何字段级技巧生效。
- **可选项给合理默认值。** 预填值会被当作推荐值，所以默认值必须是你愿意背书的选项；没有可信默认时宁可留空让用户主动选择。
- **布尔语义用勾选或开关表达**，不要用"是/否"两个单选去表达一个开关心智。
- 校验规则（何时报错、报什么、错误怎么播报）见 `form-validation.md`。

## 按钮与操作区

- **主操作在内容流末尾、左对齐、单列。** 不要在表单中部或右上角再放一个等价主操作。
- **主次必须可见可分。** 主按钮用实心最强调样式；次要操作用描边或纯文本样式，与主操作同等权重会立刻抬高误点率。
- **一行最多 2 个按钮**（主 + 一次要）；第三个操作改为文本链接或收进"更多"菜单。

按钮文案用**动词 + 对象**，它是交互契约：

| 场景 | 文案 | 来源 |
|---|---|---|
| 不保存信息、进入下一步 | 继续 | GOV.UK Button |
| 会保存当前信息 | 保存并继续 | GOV.UK Button |
| 可稍后回来接着填 | 保存稍后再回来 | GOV.UK Button |
| 新增一条同类记录 | 再添加一条地址 | GOV.UK Button |
| 付款 | 付款 | GOV.UK Button |
| 无法律条文需勾选 | 确认并发送 | GOV.UK Button |
| 有法律条文需勾选 | 接受并发送 | GOV.UK Button |

禁止「提交」「确定」「下一步」这类泛化文案（除非它是唯一动作且上下文毫无歧义）：用户需要重读整页才能推断按钮后果。

**危险操作：** 与主操作不同色、不同层级，且不紧邻主按钮；文案写出具体后果（「删除此项目及其 3 个附件」，不是「确定」）；可撤销或有二次确认，没有恢复路径的破坏性按钮不得与主按钮同权重。disabled 提交按钮只在"操作确实还不可用"时使用——用它表达"表单没填完"只会让用户不知道缺什么，此时应让校验指出具体字段。

**取消与重置：**

- **不要放"重置"按钮。** 它只会清空用户已输入的内容，没有正向价值却制造误清空。NN/g 的结论：去掉 Reset，多数表单的可用性都会改善。
- 需要的"紧急出口"是**返回链接**或流程内取消，而不是清空表单；有未保存修改时，取消必须提示内容会丢失并提供「继续编辑」。
- 纯查询/筛选表单不需要重置按钮；用措辞明确的"清除筛选条件"链接，且只清筛选条件。

**粘性提交栏**仅当同时满足以下条件才用：表单长度 **> 2 屏**（移动端 **> 1.5 屏**）、主操作在滚动中长时间不可见、页面没有其他常驻主操作。使用时必须为虚拟键盘预留空间（键盘弹出不得盖住提交栏，也不得让当前焦点滚出视口）；不得遮挡底部危险区或最后一个字段，需预留等高底部留白；栏内只放主操作，不要塞校验错误摘要。

## 多步表单

**分步判据**（满足任一条即考虑分步）：

- 单页可见字段 **> 7 个**，且无法用 fieldset 分成 2–3 个语义组。
- 页面内存在心理上独立的**决策**（不是多填几格，而是另一件事，如"先选套餐、再填付款方式"）。
- 移动端一次填完需要滚动 **> 3 屏**。
- 流程需要中途保存、跨会话继续。

反向约束：分步有成本（每次跳转都是一次流失机会），**不要为"看起来简洁"把 ≤7 个字段的短表单拆成 3 步**。GOV.UK 的方向是从"一页一件事"起步（一页一个信息、一个决定、一个问题），再用研究证据把可合并的页面并回去。

**步骤指示器的两种形态：** 「第 X 步，共 N 步」的线性指示器用于必须按顺序完成、不能跳步的流程，必须始终显示总数与当前位置；「已完成 / 未完成 / 暂不能开始」的任务列表式用于可任意顺序、可跨会话的流程，且仅当"用户不想也不能一次做完 + 需要自选顺序"时用。任务列表不可用于强顺序流程，也不可取代答案回顾页。

用户必须持续能回答三件事：**我在哪一步、还剩几步、能不能回去改**——三者缺一，进度指示器就只是装饰。线性流程给「上一步」；「上一步」是流程内倒退，「取消/返回」是离开流程，语义不同，不得共用一个按钮。

**跨步数据保留：** 每步提交即持久化，不让用户走完全程才落库，刷新、断网、误点返回都不应丢数据；回到前一步时之前的选择必须还在，不得默认重置；提交前提供答案回顾并允许直接跳回任一字段修改；被分支跳过的步骤不出现在"共 N 步"里。

## 设置页（settings）

判定依据是**"这个控件的一次改变是不是一个完整结果"**：

| 控件类型 | 保存方式 |
|---|---|
| 开关、单选、单个下拉 | 即时保存，且每个改动就地给「已保存」/「保存中」反馈 |
| 一组需要一起判断、一起校验的字段 | 显式保存按钮 |
| 提交后需重算或重启才生效的设置 | 显式保存 + 结果反馈 |

**核心禁忌：同一页混用两种方式**——用户无法判断哪些改动已生效。无法避免时必须用分区标题标注本区采用哪种方式，并保证每区内部一致。NN/g 的实证依据：多数用户的心智模型是"没点保存就等于没改"、离开页面等于取消；所以即时保存方案**必须**补显式反馈，否则用户会反复寻找不存在的保存按钮，认知负荷高于多按一次按钮。

**危险区：** 放在页面最底部的独立区块，与常规设置明确分隔；用分区标题（如"危险操作"）+ 破坏性按钮样式，措辞写清后果；提供撤销或恢复路径，不可恢复的写明"此操作不可撤销"。

**分区与锚点导航：** 分组 ≤7 组，每组一个有实际信息的小标题，超过 7 组先合并；页面 > 3 屏或 > 6 个分组时用左侧锚点导航 + 右侧内容区，窄屏退化为顶部锚点行或折叠分区；锚点与分组标题同名且滚动位置与高亮项同步，否则用户会失去位置感；每个设置项写清"改了会发生什么"，而不是只写设置名。

## 响应式与移动端

**移动端强制单列。** 前文所有双列特例在窄屏一律堆叠，堆叠后语义仍须成立（"省 / 市"纵排读得通，"起 / 止"纵排要给足标签区分）。

**键盘类型按内容给：** 电话用 `type="tel"`；邮箱用 `type="email"` 或 `inputmode="email"`；纯数字用 `type="text"` + `inputmode="numeric"`（避开 `type="number"` 的滚轮改值与取值陷阱）；日期、时间的分量框同样用 `type="text"` + `inputmode="numeric"`，这样即使与日期选择器冲突也能唤起数字键盘；网址用 `inputmode="url"` 强化 `/` 与 `.`。

`inputmode` 只影响键盘布局，**不提供任何校验或范围限制**，业务校验必须另有实现——这是 MDN 明确写出的边界，别把键盘当校验。

**触控目标：** 表单控件的可点区域不小于 WCAG 2.5.8 的 24×24 CSS px 下限，实践上输入框高度取 **≥40px**（含内边距）。通用目标尺寸规则见 `accessibility-baseline.md`，这里只约束表单控件。

**避免的布局：** 输入框紧贴视口边缘（至少留 16px 外边距）；一行 3 个及以上控件；需要横向滚动或缩放才能填完的表单；标签列 + 输入列的表格式布局（窄屏必然破版）；依赖 hover 展示帮助或选项说明（触屏没有 hover）。

## 常见失败模式

- 表单默认双列"为了利用宽屏"。→ 错行填写与键盘遮挡的固定来源。
- 占位符代替标签。→ 输入后标签消失，复查无法确认字段内容。
- 帮助文本塞进 tooltip。→ 关键信息需 hover 或点击才能看到，直接抬高完成成本。
- 必填只用 `required`、不进标签文本。→ 视觉用户看不到，读屏播报因实现而异。
- 组内间距等于组间距。→ 用户看不出分组边界，最终把城市填进公司名。
- `width: 100%` 铺满所有字段。→ 邮编框看起来像地址行，诱发多填或乱填。
- 同一页混用即时保存与显式保存。→ 用户永远不确定哪些改动已生效。
- 保留"重置"按钮。→ 唯一的实际效果是清空用户填好的内容。
- 主操作文案是「提交」。→ 用户必须重读整页才能判断后果。
- 危险操作与主操作同权重、无撤销。→ 误点即不可逆损失。
- 「上一步」与「取消」共用一个按钮。→ 用户要么丢数据，要么退不出流程。
- 步骤指示器只有编号、没有总数或名称。→ 用户无法判断剩余工作量。
- 移动端一行两个控件且不做键盘避让。→ 焦点框被键盘遮住，用户看不见自己在输入什么。
- 用 `type="number"` 收邮编、卡号、电话。→ 前导零被吞、滚轮误改值、取值类型不一致。

## 交付前自检清单

- [ ] 全部字段单列；所有双列都能归入四类允许情形之一，且已声明断点回落规则。
- [ ] 每个字段的可见标签在其上方，是名词短语、句首大写、无冒号、1–6 个词。
- [ ] 没有任何字段依赖占位符充当标签。
- [ ] 字段宽度按预期字符数分级，容器有宽度上限，宽屏下输入框没有被拉满。
- [ ] 同屏输入框高度一致；字段文本不小于正文字号；没有写死 `height`。
- [ ] 多输入语境用 fieldset + legend；legend 与 label 不重复；单字段组没有滥用 fieldset。
- [ ] 字段顺序按用户心智，能筛人的问题在最前，没有出现数据库列名。
- [ ] 组间距 ≥ 组内间距的 1.5 倍；40px 标题区、48px 字段后到按钮等层间距已落在 token 上。
- [ ] 帮助文本 ≤1 句、≤30 字、无链接、不承载关键信息；格式示例写在帮助文本里。
- [ ] 必填/可选只有一种标记策略，且标记出现在可见标签文本中。
- [ ] 主操作在末尾、左对齐、单列；主次视觉可分；按钮文案是动词 + 对象。
- [ ] 危险操作在独立区块、层级降低、有撤销或二次确认。
- [ ] 没有"重置"按钮；取消路径明确且会提示未保存内容。
- [ ] 粘性提交栏满足使用条件，且已处理键盘遮挡与底部留白。
- [ ] 多步流程显示当前位置与总步数，可回退且跨步数据保留。
- [ ] 设置页保存方式单一，混用时已分区标注；危险区在底部；锚点导航与分组同名。
- [ ] 移动端输入类型与 `inputmode` 按内容配置；控件高度 ≥40px；无横向滚动。
- [ ] 桌面与 320px 两档都实际看过截图，确认焦点框、错误提示、帮助文本在窄屏不互相覆盖。

## 来源

本文为中文整理，非英文原文的翻译或摘抄；数值与规则均来自下列**实际抓取过**的页面，经验性推断已就地标注为"经验区间"。

| 来源 | 抓取页面 | 许可（按页面实际声明） |
|---|---|---|
| GOV.UK Design System | [Text input](https://design-system.service.gov.uk/components/text-input/)、[Fieldset](https://design-system.service.gov.uk/components/fieldset/)、[Textarea](https://design-system.service.gov.uk/components/textarea/)、[Date input](https://design-system.service.gov.uk/components/date-input/)、[Button](https://design-system.service.gov.uk/components/button/)、[Task list](https://design-system.service.gov.uk/components/task-list/)、[Error summary](https://design-system.service.gov.uk/components/error-summary/)、[Error message](https://design-system.service.gov.uk/components/error-message/)、[Spacing](https://design-system.service.gov.uk/styles/spacing/)、[Question pages](https://design-system.service.gov.uk/patterns/question-pages/)、[Complete multiple tasks](https://design-system.service.gov.uk/patterns/complete-multiple-tasks/)、[Recover from validation errors](https://design-system.service.gov.uk/patterns/validation/) | 页面声明 Open Government Licence v3.0（© Crown copyright）；**不是 MIT**，使用需遵守 OGL v3.0 的署名要求 |
| GOV.UK Service Manual | [Structuring forms](https://www.gov.uk/service-manual/design/form-structure) | Open Government Licence v3.0 |
| U.S. Web Design System (USWDS) | [Form](https://designsystem.digital.gov/components/form/)、[Text input](https://designsystem.digital.gov/components/text-input/)、[Step indicator](https://designsystem.digital.gov/components/step-indicator/)、[Progress easily](https://designsystem.digital.gov/patterns/complete-a-complex-form/progress-easily/)、[Accessibility](https://designsystem.digital.gov/documentation/accessibility/) | 美国联邦政府作品，页面未标注限制性许可（公共领域 / CC0 类） |
| IBM Carbon Design System | [Form guidelines](https://www.carbondesignsystem.com/building-blocks/core/components/form/guidelines)、[Form specifications](https://www.carbondesignsystem.com/building-blocks/core/components/form/specifications/)、[Forms pattern](https://www.carbondesignsystem.com/building-blocks/core/patterns/forms/) | 页面版权 © IBM；代码仓库为 Apache-2.0 |
| Nielsen Norman Group | [Group Form Elements Effectively Using White Space](https://www.nngroup.com/articles/form-design-white-space/)、[Placeholders in Form Fields Are Harmful](https://www.nngroup.com/articles/form-design-placeholders/)、[Reset and Cancel Buttons](https://www.nngroup.com/articles/reset-and-cancel-buttons/)、[Don't Prioritize Efficiency Over Expectations (autosave)](https://www.nngroup.com/articles/efficiency-vs-expectations/)、[Website Forms Usability: Top 10 Recommendations](https://www.nngroup.com/articles/web-form-design/) | 版权 © Nielsen Norman Group，保留全部权利；本文仅引用结论并标注出处 |
| MDN Web Docs | [`inputmode` 全局属性](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inputmode) | 内容按 CC BY-SA 2.5 授权（Mozilla 贡献者） |

**抓取失败、因此未据以撰写的页面：** `carbondesignsystem.com/.../form/usage/`（跨域跳转未跟随）、`developer.mozilla.org/.../Elements/input/type`（404）、`nngroup.com/articles/mobile-form-design/`（404）、`nngroup.com/articles/placeholders-form-fields-harmful/`（404）、Primer `ui-patterns/saving` 与 `ui-patterns/forms`（只取到导航壳，正文未获取）。这些页面的结论一律未写入本文。
