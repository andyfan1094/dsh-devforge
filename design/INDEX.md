---
name: 设计资产总览
description: 六层设计资产的地图与「什么任务查哪一层」的查表，供 AI agent 定位入口
triggers:
  - 设计资产
  - 设计能力
  - 查设计规范
  - design assets
od:
  category: index
---

# 设计资产总览（AI 入口地图）

> 这份文件回答一个问题：**什么任务该查哪一层**。资产本体不在这里，用 `devforge_design` 工具按需读取
> （不带参数给总览，`query` 关键词检索，`id` 读全文）。
>
> **检索用法**：`query` 可以给多个词（空格分隔），例如 `"表格 分页 排序"`。全部命中的资产优先返回；
> 没有任何一条全部命中时，退化为「按命中词数排序」。所以查不到时先换更短的词，仍无结果再用 `catalog=true` 看全部六层。

## 六层资产与适用场景

| 层 | 回答什么问题 | 什么时候查 | 代表条目 |
| --- | --- | --- | --- |
| **craft/** | 什么是"好"，什么是"AI 味" | **任何**视觉产物的起点与终点：开工前定标准，交付前逐条自检 | `anti-slop-unified`★、`craft-floor`★、`laws-of-ux`、`typography-hierarchy`、`accessibility-baseline`、`animation-discipline`、`form-validation`、`data-tables`、`dashboard-console`、`form-layout`、`responsive-layout`、`data-visualization` |
| **standards/** | 行业权威怎么写界面 | 写 Web 界面、表单、交互时当硬规范；做视觉审查时用审查档 | `vercel-web-interface`（108 条生成版）、`vercel-web-review`（104 条 + 14 反模式）、`vercel-web-readme`（130 条散文版）、`v0-design-guidelines` |
| **skills/** | 一套完整工作法怎么走 | 需要成体系地做设计、改造、生图时 | `taste-skill`（三旋钮 + Design Read）★、`hallmark`（宏观结构 / 主题 / 组件）★、`impeccable`（流程与审计）★、`redesign-skill`、`image-to-code-skill`、`brandkit` |
| **systems/** | 这套视觉语言的具体数值 | 调性定了要落地时 → 拿 `DESIGN.md` 与 `tokens.css` | `linear`、`stripe`、`monochrome-industrial`、`wabi-sabi`、`glassmorphism` |
| **templates/** | 从什么骨架开始 | 做原型、后台或演示稿时 | `console-shell`★（控制台壳层）、`data-table-page`、`form-page`、`settings-page`、`auth-page`、`detail-page` |
| **prompts/** | 现成的提示词片段 | 需求模糊要定方向、要生图、要审计旧界面时 | `ui-design-brief`（模糊需求 → 设计 brief）、`redesign-audit`（改造前审计）、`hero-image-direction`（主视觉生图）、`screenshot-selfcheck`（交付前双档自检） |

## 典型任务的查法（照这个顺序走）

### 一、做一个新界面

1. `craft/anti-slop-unified` —— 先看红线，P0 记住，别边做边犯
2. `skills/taste-skill` —— 三旋钮定档（DESIGN_VARIANCE / MOTION_INTENSITY / VISUAL_DENSITY），先写一行 Design Read
3. `skills/hallmark` —— 选宏观结构与主题（参考其结构指纹记录，别重复上一次的骨架）
4. `systems/<id>` —— 取 tokens，颜色、间距、字体一律走 token，不自己造值
5. `standards/vercel-web-interface` —— 过交互、表单、无障碍硬规范
6. **交付前**：`craft/anti-slop-unified` 逐条核 + `craft/craft-floor` 核硬数字 + 桌面与移动两档截图亲眼看

### 二、改造既有界面（重设计）

1. `skills/redesign-skill` —— 先读它的立场："旧样子是它**是什么**的证据，不是它**该成为什么**的权威"
2. `craft/anti-slop-unified` + `craft/craft-floor` —— 定下验收线
3. `skills/impeccable` —— 走流程：先建立产品真值（它到底是什么、给谁用），再谈视觉
4. 需要换调性时在 `systems/` 里选系统
5. **交付前**：`skills/impeccable` 的评审协议 + `standards/vercel-web-review` 的反模式清单

### 三、选一套设计语言

1. `devforge_design(kind="systems", query="<调性词>")` 检索候选
2. 读 `systems/<id>/DESIGN.md` —— 看它的色彩逻辑、字体性格、禁忌
3. 读 `systems/<id>/tokens.css` 与 `design-tokens.json` —— 拿具体值

### 四、做演示稿与报告视觉

1. `craft/typography-hierarchy-editorial` —— 编辑风排版层级
2. `skills/` 里的 deck 类条目（如 `deck-swiss-international`、`deck-guizang-editorial`）

### 五、界面文案与微文案

1. `craft/copy-anti-aiisms` —— 去 AI 味的用词与句式
2. `standards/vercel-web-readme` 的 Copywriting 章

### 六、从骨架起步（原型 / 后台 / 演示）

1. `templates/console-shell` —— 控制台壳层（左栏导航 + 顶栏 + 主区），换 `--accent` 与品牌名即可开工
2. 按页面类型接着选：`templates/data-table-page`、`form-page`、`settings-page`、`auth-page`、`detail-page`
3. 骨架统一 token 契约，换设计系统只改 `:root` 变量；对应的判定标准查同名的 craft 条目（如 `craft/data-tables`）
4. 交付前用 `prompts/screenshot-selfcheck` 走一遍桌面与移动双档自检

### 七、需求模糊、还没定方向

1. `prompts/ui-design-brief` —— 把一句话需求变成 Design Read + 三旋钮档位 + 内容真值 + 验收线
2. 要主视觉图时 `prompts/hero-image-direction`（生成后必须看图：缩略图测试、压字测试、撞风格检查）
3. 要改造既有界面时 `prompts/redesign-audit` —— 先逐块判决「保留 / 重构 / 删除」，再谈视觉

## 红线速记

> 完整清单与判定方式见 `craft/anti-slop-unified.md`，此处只作提醒。

- 禁默认靛蓝当主色；禁紫蓝"信任"渐变与渐变文字
- 禁 emoji 当功能图标；禁编造指标与填充文案（lorem ipsum、"feature one two three"）
- 禁 `transition: all`；焦点环必须瞬时出现，不可淡入
- 移动优先从 320px 起，禁止桌面优先再缩小
- display 文字不用 Inter / Roboto 这类默认脸
- **交付前必须截图自检：桌面与移动至少两档**

## 目录约定

- 每个资产 id 形如 `类型/名称`，例如 `craft/anti-slop-unified`、`systems/linear`、`skills/hallmark`
- 目录型资产（skills / systems / templates）以入口文档为门户：`SKILL.md` / `DESIGN.md` / `README.md`
- 单文件资产（craft / standards / prompts）即 `类型/<名称>.md`
- 支持 YAML frontmatter：`name`、`description`、`triggers`（检索的主要线索）、`od.category`
