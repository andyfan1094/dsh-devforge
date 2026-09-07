# dsh-devforge 天工造梦

`dsh-devforge` 是面向 DeepSeek Harness（DSH）的规范驱动服务工厂与本机智能体工作台。它同时提供 Host 能力和 Web 面板：Host 负责路由、工具、凭据、SQLite 持久化、子代理和外部服务；浏览器侧负责操作台、配置页和可视化状态。

当前源码版本：`0.23.1`。已发布到自有官网的稳定包以 [版本清单](https://modagentai.com/downloads/index.json) 为准；完整页面说明、截图和发布流程见：

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
