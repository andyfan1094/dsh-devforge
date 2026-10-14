---
name: 反 AI 味自检清单
description: 12 条通用自检项 —— 任何界面交付前逐条核对，一条不过就说明视觉漂移了
triggers:
  - 自检清单
  - 交付前检查
  - slop
  - AI味
  - 视觉漂移
  - 交付自检
  - 上线前检查
od:
  category: craft
---

# 反 AI 味自检清单

> 来源：AnxForever/stylekit `lib/styles/slop-checklist.ts`（MIT）。原文件是"把清单追加到 Hard Prompt 末尾让模型自校验"的生成器，此处固化为可逐条核对的中文清单。
> 与 `anti-slop-unified.md` 的分工：那份是**判定规则全书**（含出处与理由），这份是**交付前打钩用的短清单**。

## 通用项（任何风格都适用）

- [ ] 没有紫色到蓝色的渐变
- [ ] 没有用 Inter / Roboto / Geist / Fraunces / Plus Jakarta Sans 这类被用滥的字体
- [ ] 没有嵌套卡片（卡片里再套卡片）
- [ ] 没有在彩色背景上放灰色文字
- [ ] 正文对比度达到 WCAG AA（≥ 4.5:1）
- [ ] 没有 bounce / elastic 这类弹跳缓动曲线
- [ ] 动效提供了 `prefers-reduced-motion` 备选（关掉动效，页面依然成立）
- [ ] 正文行宽控制在 65–75 个字符
- [ ] 没有单侧粗边框装饰（`border-left` / `border-right` 超过 1px 的强调条）
- [ ] 没有渐变文字（`background-clip: text`）
- [ ] 没有把玻璃态当作默认表面处理
- [ ] 没有在每个 section 标题上方都放一个小小的全大写、字距拉开的 eyebrow 标签

## 怎么用

1. **交付前逐条核对**，一条不过就说明视觉漂移了，改完再交。
2. 风格特有的禁忌不在本清单里 —— 见你所用的 `systems/<id>/DESIGN.md` 的"禁忌"章，以及 stylekit 系风格里的 `forbidden` 条目。
3. 本清单只覆盖「明显是 AI 味」的部分；「好不好看」由 `craft/craft-floor.md` 的硬数字和截图自检兜底。
