---
name: 工艺规则库说明
description: craft 目录导航：解释为什么在 skills、模板、设计系统之外还需要「跨品牌通用工艺」这一轴，以及技能如何用 od.craft.requires 按需引入。
triggers:
  - 工艺规则库
  - craft 目录
  - 设计资产导航
  - 通用设计知识
  - craft requires
  - 资产说明
  - 设计规则索引
  - craft readme
od:
  category: craft
---

# Craft references

Brand-agnostic craft knowledge. Each file is a small, dense rulebook on one
dimension of professional UI craft (typography, color, motion, …). Skills
opt into the references they need; the daemon injects only the requested
ones into the system prompt above the active skill body.

## Why a fourth axis next to skills, templates, and design systems

| Axis | Scope | Example |
|---|---|---|
| `skills/` | Functional capabilities invoked while doing work | `design-brief`, `brand-extract`, `imagegen` |
| `design-templates/` | Packaged artifact shapes | `saas-landing`, `dashboard`, `pricing-page` |
| `design-systems/` | Brand package: prose, token contract, and optional rich resources | `linear-app`, `apple`, `notion` |
| `craft/` | **Universal** craft knowledge — true regardless of brand | letter-spacing rules, accent-overuse caps, anti-AI-slop |

`DESIGN.md` tells the agent which colors and fonts a brand uses. `craft/`
tells the agent the universal rules a competent designer applies on top —
e.g. ALL CAPS always needs ≥0.06em tracking, regardless of the brand.

## How a skill opts in

Add an `od.craft.requires` array to the skill's front-matter. Only the
listed sections are injected, so a skill that needs only typography pays
no token cost for color/motion content.

```yaml
od:
  craft:
    requires: [typography, color, anti-ai-slop]
```

Use the layered stack for editorial skills that require authored hierarchy
and sustained reading behavior:

```yaml
od:
  craft:
    requires: [typography, typography-hierarchy, typography-hierarchy-editorial]
```

Allowed shipped values match the file names in this directory minus the `.md`
extension. The runtime skips an absent file for compatibility, but repository
authoring does not silently accept arbitrary values.

Run `pnpm lint:craft` after adding or changing `od.craft.requires`. The
repository guard reports unresolved slugs with their manifest paths, so typos
cannot silently drop a craft section from the runtime prompt. If a slug is an
intentional forward reference, record it in the 待补充 section of
`design/INDEX.md` until the matching `craft/<slug>.md` file ships.

### Runtime compatibility and authoring failures

The loader remains tolerant because externally installed or older bundles may
reference a section that is unavailable in the current resource set. A missing
optional paragraph must not make an otherwise usable runtime bundle fail.

Checked-in content has a stronger contract: `pnpm lint:craft` and
`pnpm guard` fail on malformed slugs and unresolved references. A deliberate
forward reference is valid only when it is recorded in the 待补充 section of
`design/INDEX.md`; this makes planned work explicit while preserving
the runtime compatibility behavior.

Note for skill authors arriving from older guidance: an earlier draft
used `motion` as the future-slug placeholder. The shipped equivalent
today is `animation-discipline`. Use that one if your skill emits
motion.

### Enforcement levels

Craft files mix auto-checked rules and guidance.

- **Auto-checked.** Rules wired into `apps/daemon/src/lint-artifact.ts` — currently the P0 list in `anti-ai-slop.md` (Tailwind-indigo accent, two-stop hero gradients, emoji-as-icons, etc.). The linter reports these as findings back to the UI (for P0/P1 badges) and to the agent (as a system reminder for self-correction). Artifact persistence is not currently hard-blocked on P0 hits.
- **Guidance.** The rest. The agent reads the rules, reviewers apply them, the linter doesn't check them.

A purely behavioral craft file (state-coverage, animation-discipline) is guidance unless a specific rule is later promoted into `lint-artifact.ts`.

## Files

| File | Section name | When to require |
|---|---|---|
| `typography.md` | `typography` | Any skill that emits typed content (~all skills) |
| `typography-hierarchy.md` | `typography-hierarchy` | Any skill that emits typed content where hierarchy must feel authored, not assembled — especially surfaces with a strong entry point, varied levels, or intentional rhythm. Compose with `typography`. |
| `typography-hierarchy-editorial.md` | `typography-hierarchy-editorial` | Skills whose primary artifact is a sustained reading surface: `blog-post`, `docs-page`, `digital-eguide`. Requires `typography` + `typography-hierarchy`. |
| `color.md` | `color` | Any skill that emits styled output (~all skills) |
| `anti-ai-slop.md` | `anti-ai-slop` | Marketing pages, landing pages, decks |
| `state-coverage.md` | `state-coverage` | Any skill with stateful UI (dashboards, mobile apps, forms, list/table views) |
| `animation-discipline.md` | `animation-discipline` | Any skill that ships motion: mobile apps, multi-screen flows, gamified UI, transitions, microinteractions |
| `accessibility-baseline.md` | `accessibility-baseline` | Any skill that ships interactive UI: dashboards, forms, mobile flows, anything with focus/labels/keyboard paths |
| `rtl-and-bidi.md` | `rtl-and-bidi` | Any skill that ships localized text or layout: blogs, docs, financial tables, mobile apps, anything that may render Arabic / Hebrew / Persian |
| `form-validation.md` | `form-validation` | Any skill whose primary artifact contains an interactive form: lead capture, sign-in, signup, settings, multi-step intake |
| `laws-of-ux.md` | `laws-of-ux` | Any skill whose composition decisions hit named cognitive limits: pricing pages (Hick's, Choice Overload, Von Restorff), dashboards (Pareto, Selective Attention, Working Memory), onboarding (Goal-Gradient, Zeigarnik, Peak-End), modals (Fitts's, Tesler's). Sibling axis to the rendering-rule files above — covers what to compose, not how to render. |
| `data-tables.md` | `data-tables` | Any skill that emits a data table, list page, or a surface where rows and columns are compared. 表格 / 列表页。 |
| `dashboard-console.md` | `dashboard-console` | Any skill that emits a console, dashboard, admin shell, or monitored operational surface. 控制台 / 后台 / 仪表盘。 |
| `form-layout.md` | `form-layout` | Any skill whose primary artifact is a form: sign-in, settings, intake, multi-step flows. 表单布局与字段编排（校验行为见 `form-validation`）。 |
| `responsive-layout.md` | `responsive-layout` | Any skill that ships a surface across viewports: breakpoints, grid, container queries, fluid type, overflow. 响应式 / 断点 / 栅格。 |
| `data-visualization.md` | `data-visualization` | Any skill that renders charts, KPI cards, or data summaries. 图表 / 指标卡（页面编排见 `dashboard-console`）。 |

The five sections above were authored in-repo as **Chinese-original rulebooks** distilled from
primary sources (GOV.UK, USWDS, IBM Carbon, W3C ARIA APG / WCAG, MDN, NN/g, Primer, Atlassian,
Ant Design, Every Layout, Utopia); each file lists the URLs actually fetched, the license as
declared by that page, and marks unsourced numbers as 经验区间. See [`../SOURCES.md`](../SOURCES.md).

**Partial-stateful skills.** A skill that's mostly static but contains an embedded form, data table, or query surface should opt in. State-coverage rules apply to the stateful component, not the whole page.

Planned-but-unshipped slugs are recorded in the 待补充 section of
[`design/INDEX.md`](../INDEX.md); do not hard-code a second future
list here.

## Attribution

Craft content is adapted from the MIT-licensed
[refero_skill](https://github.com/referodesign/refero_skill) project
(© Refero Design), with edits to fit OpenDesign's house style and link
back to OD's design tokens (`var(--accent)` etc.) instead of generic
Tailwind hex values.
