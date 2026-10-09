---
name: 精密浅色
description: 精密浅色：炭黑主色，精密分层阴影；适用于B2B SaaS、企业软件。
triggers:
  - 精密浅色
  - 炭黑主色
  - 分层阴影
  - B2B SaaS
  - 企业软件
od:
  category: light-fintech
---

<!-- SKELETON: 待人工补写 -->

# 精密浅色（Precision Light）

> **TODO（骨架）**：本文件的"设计意图"正文尚未人工撰写。以下内容全部是由权威 token 反推或从源仓库
> README 主题表摘录的**客观事实**，不含主观设计判断。补写时请对照同目录的 `tokens.css` /
> `design-tokens.json`，并遵守 `design/craft/` 下的通用工艺规则。

## 一、定位与适用场景（源仓库 README 表述）

- **气质（Vibe）**：炭黑主色，精密分层阴影
- **适用（Best For）**：B2B SaaS、企业软件
- **默认模式**：浅色（该主题只有一套取值）

## 二、客观特征（脚本从 registry 反推）

| 项 | 值 |
|---|---|
| 语义 token 数 | 27 |
| 基础圆角 `--radius` | `0.625rem` |
| 背景 `--background` | `oklch(0.9772 0 0)` |
| 前景 `--foreground` | `oklch(0.3008 0 0)` |
| 主色 `--primary` | `oklch(0.3008 0 0)` |
| 强调色 `--accent` | `oklch(0.9619 0 0)` |
| 边框 `--border` | `oklch(0.9389 0 0)` |
| 私有扩展 token | 7 个：`--shadow-2xs`、`--shadow-xs`、`--shadow-sm`、`--shadow`、`--shadow-md`、`--shadow-lg`、`--shadow-xl` |

## 三、待补写清单（TODO）

- [ ] **用于什么场景**：什么项目该选它、什么项目不该选它
- [ ] **色彩逻辑**：这组色的色相/明度策略（例如"近黑底 + 单强调色"），各语义 token 的配对关系，对比度取向
- [ ] **字体性格**：字体族倾向、字重与字距、标题与正文的层级手法
- [ ] **圆角与间距哲学**：圆角取值背后的态度（锋利/柔和/胶囊），间距节奏与密度倾向
- [ ] **禁忌**：什么情境下不要用这套；容易踩的失真点（例如深色单模主题被误当浅色用）
- [ ] **与 craft 规则的关系**：与 `design/craft/` 里通用规则冲突或需要补充的地方

## 四、使用方式

- 变量定义见 [`tokens.css`](tokens.css)，扁平 token 表见 [`design-tokens.json`](design-tokens.json)。
- 所有颜色值均为 `oklch()`（本主题若为十六进制则保留原样），可直接用于 CSS 变量消费。
- ⚠️ 源数据里 `cssVars` 的键名 `light` **不代表浅色模式**，它承载的是该主题**默认且唯一**的一套取值。
  直接把这套值当"浅色主题"使用会得到与设计意图相反的结果。
