# dsh-devforge 天工造梦

`dsh-devforge` 是面向 DeepSeek Harness（DSH）的规范驱动服务工厂与本机智能体工作台。它同时提供 Host 能力和 Web 面板：Host 负责路由、工具、凭据、SQLite 持久化、子代理和外部服务；浏览器侧负责操作台、配置页和可视化状态。

当前源码版本：`0.23.1`。已发布到自有官网的稳定包以 [版本清单](https://modagentai.com/downloads/index.json) 为准；完整页面说明、截图和发布流程见：

1. **通用开发规范库**：版本化 Markdown 规范存放于 `standards/`，通过系统提示和 `devforge_standards` 工具提供给 Agent；创建服务时按模板注入生成子代理。
2. **一键生成服务**：`devforge_jobs` 工具和“新建服务”页创建独立子代理。后端服务默认注入 Api、Bll/BAL、Dal、Model、Utility/Utils 分层，要求中文注释、通用能力复用、成熟开源包优先、结构化日志和验证后的中文 Git 提交。
3. **服务工厂操作台**：侧边栏“服务工厂”入口提供开发规范、智谱 Coding Plan、生成任务、新建服务、记忆中枢、记忆工作台、工作流、远程运维、项目、代码仓库、飞书、插件更新和皮肤换肤能力。
4. **智谱 Coding Plan**：复用 DSH 受管凭据 `ZAI_CODING_CN_API_KEY`，一键补齐 `zai-coding-cn` 的 GLM-5.3 与 GLM-5.3-Flash；Host 直连智谱官方监控接口，展示 5 小时、周额度、重置倒计时、近 24 小时／7 天模型和 MCP 用量。支持自定义命名的 Key 池：每把 Key 独立凭据引用并可自行起名，主 Key 只是聊天模型路由当前指向（切换不增删池成员），官方调用（MCP 工具、额度看板、模型拉取）在 401/403/429 时自动切换下一把 Key，用量页按 Key 独立出卡片展示；旧版派生槽位 `_2…_6` 中已配置的 Key 升级时自动并入池。Key 不进入浏览器、日志或普通配置。
5. **火山方舟 Agent Plan**：使用 Plan Key 调用官方套餐模型并同步推理档位；用受管控制面 AK/SK 经火山 OpenAPI V4 签名查询 Agent Plan/Coding Plan 的 5 小时、周、月额度。操作步骤见[火山方舟用量看板教程](docs/火山方舟用量看板教程.md)。
6. **OpenAI 兼容中转站**：在 Coding Plan 页配置中转站地址和受管 API Key，通过 `GET /v1/models` 获取模型并注册为 `openai-gateway` 聊天路由；可从模型目录指定全局 `generate_image` 的生图模型，生成结果写入工作区并在聊天中内联展示。旧 `dsh-sub2api` 的 OpenAI 地址、凭据引用、模型元数据和生图模型会自动迁移，Key 明文不会被读取或复制。
7. **本机 DSH 重启**：操作台“重启 DSH”按钮和 `devforge_restart` 工具仅在用户明确要求时使用。重启接口要求 loopback 与同源请求，复用现有启动参数，启动日志写入 `$DSH_HOME/logs/dsh-web-restart.log`。
8. **可见运营浏览器**：本机前台 Chrome 保存持久登录档案，支持多标签页、页面快照、稳定元素操作和安全图片上传；多个会话共用一个浏览器进程，不复制 Cookie，也不另开隐形浏览器。
9. **闲鱼运营助手**：发布商品和消息回复分别使用独立标签页，页面状态互不覆盖；真实发布和真实发送均要求用户明确确认，并核验平台结果。
10. **已安装插件功能总览注入**：自动枚举 Loader 中用户安装的插件并读取各包描述，把「每个插件是干什么的」以动态系统提示节注入所有会话上下文；插件装卸、启停后实时跟随，官方核心内置模块仅汇总计数以防上下文膨胀。可通过设置里的「已安装插件功能总览注入开关」关闭，访问 `GET /api/dsh-devforge/plugin-brief` 可查看当前实际注入文本。
11. **插件更新**：操作台「插件更新」页签对比官网（modagentai.com）版本清单检查更新源登记表里的插件（默认登记 dsh-devforge 自己，可在设置里加包名→官网清单或 GitHub 仓库），一键升级走下载 tgz（官网渠道强制 sha256 校验）→ `dsh plugin add` 的同一条人工验证路径；升级后提示重启 DSH 生效（重启仍需用户确认）。
12. **DSH 全 GUI 换肤**：操作台「皮肤」页签基于官方 `ctx.theme.register/overrideTokens` 一等 API 提供 14 套内置主题（7 浅 7 深，含 4 套紫色：薰衣草、雾紫、星紫夜、水晶紫夜；以及晨雾蓝、樱花粉、纸感暖、森林绿、蜜柑橙、午夜蓝、石墨黑、松林夜、墨玉青、中国红）+ 8 色强调色 + 可选壁纸（本地图片/http(s)/data URL，配遮罩浓度/模糊/显示方式）。选择持久化到 localStorage 跨重启自动跟随，深浅色与 GUI 自带模式自动联动；针对 ThemeRuntime 持久化偏好 schema 不接受第三方皮肤 id 的限制，引导期做 4 次 200ms 重试兜底，状态真相源切换为 `ctx.theme.getTheme().active.id` 保证 active 高亮与 GUI 实际着色始终一致；写入失败时 UI 顶部 banner 提示。

推荐阅读：

- [中文用户手册](docs/用户手册.md)：14 个顶层页签、重要子页、Agent 工具、数据与安全边界。
- [发布与开源指南](docs/发布与开源指南.md)：官网、GitHub、CNB、Awesome DSH Plugin 与 dsh-market 的关系和操作步骤。
- [暂存环境测试约束](docs/插件暂存环境测试约束.md)：隔离 HOME、3081 端口、禁用桌面宠物/飞书桥以及生产重启红线。

## 能力概览

| 领域 | 能力 |
| --- | --- |
| 开发工厂 | 版本化开发规范、`devforge_jobs` 一键生成服务、规范注入、项目上下文和产出目录公约 |
| 模型接入 | 智谱 GLM、MiniMax、火山方舟、硅基流动、OpenAI 兼容中转站、模型目录和用量看板 |
| 知识与记忆 | RAG 知识库、中文全文+向量混合检索、精排、项目索引、会话自动沉淀、主动注入、知识图谱 |
| 工作流 | 查询改写、检索、精排、生成、自评重试、运行记录和来源耗时 |
| 代码托管 | CNB 与 GitHub 账号、仓库、Clone/Pull/Status/Commit/Push；推送默认关闭 |
| 远程运维 | SSH、WinRM、批量执行、PTY/SFTP、端口隧道、Windows 进程和服务管理 |
| 可见自动化 | 前台 Chrome 多标签页、无障碍快照、稳定引用、图片上传、闲鱼/小红书操作 |
| 协作与备份 | 飞书长连接、独立会话、完成通知、CNB 加密备份、跨机预览/同步/恢复 |
| 维护与外观 | 插件更新、DSH 本体版本检查、14 套主题、强调色、壁纸、插件能力总览注入 |
| 直播侧栏 | 抖音直播间连接、弹幕/礼物/点赞/进场等消息筛选、伴侣跟随和语音播报 |

![天工造梦教程页](docs/assets/screenshots/guide.png)

## 安装

### 官网预构建包

官网包不需要在目标机重新构建：

```sh
dsh plugin --profile web add https://modagentai.com/downloads/dsh-devforge-latest.tgz
```

安装后重启 DSH Web Host 才能让 Host 半边生效。已经安装的机器可以进入「天工造梦 → 插件更新」页检查官网清单；官网渠道会校验 `sha256`。

### GitHub 源码

仓库公开后可从 GitHub 安装：

```sh
dsh plugin --profile web add github:andyfan1094/dsh-devforge#main
```

源码安装会执行 `prepare`/构建流程。需要稳定、免构建的安装体验时，使用 GitHub Release 中的预构建 `.tgz` 或官网包。

### CNB 镜像

CNB 用于国内镜像、代码协作和加密备份；dsh-market 的精选目录要求使用 GitHub 仓库地址，因此市场条目的主链接仍应指向 GitHub，CNB 作为同步镜像维护。CNB 的账号、Clone、Pull、Commit 和 Push 见 [CNB/GitHub 发布说明](docs/发布与开源指南.md)。

## 开发与验证

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run build
```

源码不依赖任何机器的绝对路径；`pnpm-workspace.yaml` 不应提交本机 `link:` 覆盖。插件改动在生产前必须按隔离暂存流程验收，生产实例不要直接试验。

## 项目结构

```text
src/index.ts                 Host 入口、配置、路由、工具和生命周期
src/client/                  Web 入口、侧栏入口、面板和主题运行时
src/client/panel/            14 个顶层页签与各工作台子页
src/*/protocol.ts            Host/Client/API 数据契约
standards/                   版本化开发规范
docs/                        中文手册、发布说明、暂存约束和截图
screenshots.json             dsh-market 使用的精选截图清单
cordis.patch.yml             DSH bundle 注册
```

## 截图

完整截图索引在 [中文用户手册](docs/用户手册.md) 中。市场详情页使用仓库根目录的 `screenshots.json`，截图文件存放在 `docs/assets/screenshots/`，不包含 API Key、Token 或 Secret。

## 许可证

项目代码使用 `MIT AND Apache-2.0`；第三方声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，许可证文件见 `LICENSE` 与 `LICENSES/`。
