---
name: 电视大屏风
description: 电视大屏风：影院感，大尺寸电视 UI；适用于媒体、流媒体、电视应用。
triggers:
  - 电视 UI
  - 大屏界面
  - 影院感深色
  - 10 英尺界面
od:
  category: dark-media
---

<!-- SKELETON: 待人工补写 -->

# 电视大屏风（Tv Style）

> **TODO（骨架）**：本文件的"设计意图"正文尚未人工撰写。以下内容全部是由权威 token 反推或从源仓库
> README 主题表摘录的**客观事实**，不含主观设计判断。补写时请对照同目录的 `tokens.css` /
> `design-tokens.json`，并遵守 `design/craft/` 下的通用工艺规则。

## 一、定位与适用场景（源仓库 README 表述）

- **气质（Vibe）**：影院感，大尺寸电视 UI
- **适用（Best For）**：媒体、流媒体、电视应用
- **默认模式**：深色（该主题只有一套取值）

## 二、客观特征（脚本从 registry 反推）

| 项 | 值 |
|---|---|
| 语义 token 数 | 35 |
| 基础圆角 `--radius` | `0.1875rem` |
| 背景 `--background` | `oklch(0.14 0 0)` |
| 前景 `--foreground` | `oklch(0.985 0 0)` |
| 主色 `--primary` | `oklch(0.87 0.17 95)` |
| 强调色 `--accent` | `oklch(0.26 0 0)` |
| 边框 `--border` | `oklch(1 0 0 / 0.08)` |
| 私有扩展 token | 15 个：`--tv-cyan`、`--tv-teal`、`--tv-magenta`、`--tv-red`、`--tv-amber`、`--tv-green`、`--shadow-xs`、`--shadow-sm`、`--shadow-md`、`--shadow-lg`、`--shadow-xl`、`--shadow-inset`、`--shadow-primary`、`--shadow-button`、`--shadow-button-hover` |

## 二·补、源数据注意事项

- 源数据缺口：`globals.css` 中另有 `--shadow-s`、`--shadow-m`、`--shadow-l` 等 3 个 token 未写入 `cssVars`，因此 `design-tokens.json` 不含它们——以 `tokens.css` 为准。

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
