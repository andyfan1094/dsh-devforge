# 设计资产来源与许可（合规清单）

本目录下的设计资产来自多个开源仓库，均按其许可协议集成。**本文件是合规凭据**：
任何对外发布或再分发本插件时，必须连同本文件与各资产的 `LICENSE` / `NOTICE.md` 一并提供。

## 一、逐项来源

| 资产 | 来源仓库 | 许可 | 归属与改写说明 |
| --- | --- | --- | --- |
| `craft/`（anti-ai-slop、laws-of-ux、typography-hierarchy、accessibility-baseline、animation-discipline、color、state-coverage、form-validation、rtl-and-bidi 等 13 篇） | nexu-io/open-design | Apache-2.0 | 原文集成。其中 `anti-ai-slop.md` 原文自注 Adapted from referodesign/refero_skill (MIT) |
| `craft/anti-slop-unified.md` | 五源合并（见该文件头部出处标注） | 混合，同上各源 | **本次原创整理**，逐条标注出处，非任何单一来源的复制 |
| `craft/craft-floor.md` | pbakaus/impeccable | Apache-2.0 | 译自 `skill/reference/craft-floor.md`。**必须随附 `skills/impeccable/NOTICE.md`**，其中含 ehmo/platform-design-skills 的 MIT 归属 |
| `standards/vercel-web-*.md` | vercel-labs/web-interface-guidelines | MIT (c) 2025 Vercel Labs | 原文集成（`AGENTS.md` / `command.md` / `README.md` 三档），`standards/LICENSE` 随附 |
| `skills/hallmark/` | Nutlope/hallmark | MIT (c) 2026 Hallmark contributors | 原文集成，丢弃 `site/`、`docs/screenshots` 与全部图片 |
| `skills/impeccable/` | pbakaus/impeccable | Apache-2.0 (c) 2025 Paul Bakaus | 仅集成 prose 层（SKILL.src.md + reference/ + agents/）；**`NOTICE.md` 随附**；其 `reference/ios.md` 与 `android.md` 蒸馏自 MIT 的 ehmo/platform-design-skills；丢弃 20 份 provider 生成副本与打包产物 |
| `skills/taste-skill/`、`redesign-skill/`、`brandkit/`、`image-to-code-skill/`、`imagegen-*`、`web-clone/`、`emil-design-eng/`、`stitch-skill/`、`soft|minimalist|brutalist-skill/` 等 | nexu-io/open-design 与 Leonxlnx/taste-skill 两处 | 各自 MIT / Apache-2.0 | 两处同主题技能**已合并去重**，同目录内 `LICENSE` 随附 |
| `systems/<主题>/` | marvkr/better-design | MIT (c) 2026 Marvin Kaunda | 由 `registry/<theme>/globals.json` 与 `globals.css` 转换而来。⚠️ **含 apple、airbnb、notion、vercel、stripe、supabase、figma 等真实品牌名，仅作内部设计参考；对外发布需自行评估商标风险** |
| `systems/<风格>/`（stylekit 部分） | AnxForever/stylekit | MIT | 148 套风格中精选转换；`aiRules` 与 `globalCss` 冲突处以 `aiRules` 为准清洗，清洗记录见各 `DESIGN.md` |
| `craft/copy-anti-aiisms.md` | MohamedAbdallah-14/unslop | MIT | 仅取界面/营销微文案相关部分（该库主体是散文去 AI 味，与视觉设计无关） |
| `standards/v0-design-guidelines.md` 等 | dontriskit/awesome-ai-system-prompts | ⚠️ 整理者 MIT，**内容是他方系统提示词** | **已重写措辞，未逐字照搬**；本插件不主张对原文内容的著作权 |

## 二、明确排除（未入包）

| 仓库 | 排除原因 |
| --- | --- |
| vercel-labs/agent-skills | **仓库根目录无任何 LICENSE 文件**（README 声称 MIT，但 9 个 `SKILL.md` 中 5 个无许可声明）→ 合规灰区，整仓排除；其唯一设计相关技能 `web-design-guidelines` 也只是 1,270 字节的 URL 指针，零规则 |
| abi/screenshot-to-code | 仅参考其架构模式（设计系统可插拔注入、生成后截图自检、资产策略），**未搬运任何代码或提示词原文** |
| awesome-ai-system-prompts 中的越狱类文件与对话日志 | 与设计无关，且性质不当 |
| 上述各仓库的图片、视频、展示站、测试夹具与 provider 生成副本 | 与设计知识无关，占原始体积 95% 以上 |

## 三、改写声明

- `craft/anti-slop-unified.md`：五源去重合并的**原创整理**。
- `standards/v0-design-guidelines.md`：**重写版**，保留思路与判据，措辞自撰。
- `craft/design-principles.md`：CRAP 部分译自 stylekit，v0 通用条款为**重写**。
- 其余英文原始文档在集成时译为中文；token 名、CSS 属性名、字体名等专有名词保留英文。
