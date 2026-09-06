# dsh-devforge 服务工厂

面向 DeepSeek Harness 的规范驱动服务生成插件，采用 Host 与浏览器双面架构：Host 提供规范注入、子代理服务生成、版本管理和本机重启能力；浏览器侧提供“服务工厂”操作台。

## 主要能力

1. **通用开发规范库**：版本化 Markdown 规范存放于 `standards/`，通过系统提示和 `devforge_standards` 工具提供给 Agent；创建服务时按模板注入生成子代理。
2. **一键生成服务**：`devforge_jobs` 工具和“新建服务”页创建独立子代理。后端服务默认注入 Api、Bll/BAL、Dal、Model、Utility/Utils 分层，要求中文注释、通用能力复用、成熟开源包优先、结构化日志和验证后的中文 Git 提交。
3. **服务工厂操作台**：侧边栏“服务工厂”入口提供开发规范、智谱 Coding Plan、生成任务、新建服务、记忆中枢、记忆工作台、工作流、远程运维、项目、代码仓库、飞书、插件更新和皮肤换肤能力。
4. **智谱 Coding Plan**：复用 DSH 受管凭据 `ZAI_CODING_CN_API_KEY`，一键补齐 `zai-coding-cn` 的 GLM-5.3 与 GLM-5.3-Flash；Host 直连智谱官方监控接口，展示 5 小时、周额度、重置倒计时、近 24 小时／7 天模型和 MCP 用量。支持多把 Key 池：主 Key 用于聊天模型路由，附加槽位 `ZAI_CODING_CN_API_KEY_2…_6` 承担容灾；MCP 工具、额度看板、官方模型拉取在 401/403/429 时自动切换下一把 Key，用量页可按 Key 分别查看，RAG 向量化/精排取池内第一把已配置 Key。Key 不进入浏览器、日志或普通配置。
5. **火山方舟 Agent Plan**：使用 Plan Key 调用官方套餐模型并同步推理档位；用受管控制面 AK/SK 经火山 OpenAPI V4 签名查询 Agent Plan/Coding Plan 的 5 小时、周、月额度。操作步骤见[火山方舟用量看板教程](docs/火山方舟用量看板教程.md)。
6. **OpenAI 兼容中转站**：在 Coding Plan 页配置中转站地址和受管 API Key，通过 `GET /v1/models` 获取模型并注册为 `openai-gateway` 聊天路由；可从模型目录指定全局 `generate_image` 的生图模型，生成结果写入工作区并在聊天中内联展示。旧 `dsh-sub2api` 的 OpenAI 地址、凭据引用、模型元数据和生图模型会自动迁移，Key 明文不会被读取或复制。
7. **本机 DSH 重启**：操作台“重启 DSH”按钮和 `devforge_restart` 工具仅在用户明确要求时使用。重启接口要求 loopback 与同源请求，复用现有启动参数，启动日志写入 `$DSH_HOME/logs/dsh-web-restart.log`。
8. **可见运营浏览器**：本机前台 Chrome 保存持久登录档案，支持多标签页、页面快照、稳定元素操作和安全图片上传；多个会话共用一个浏览器进程，不复制 Cookie，也不另开隐形浏览器。
9. **闲鱼运营助手**：发布商品和消息回复分别使用独立标签页，页面状态互不覆盖；真实发布和真实发送均要求用户明确确认，并核验平台结果。
10. **已安装插件功能总览注入**：自动枚举 Loader 中用户安装的插件并读取各包描述，把「每个插件是干什么的」以动态系统提示节注入所有会话上下文；插件装卸、启停后实时跟随，官方核心内置模块仅汇总计数以防上下文膨胀。可通过设置里的「已安装插件功能总览注入开关」关闭，访问 `GET /api/dsh-devforge/plugin-brief` 可查看当前实际注入文本。
11. **插件更新**：操作台「插件更新」页签对比官网（modagentai.com）版本清单检查更新源登记表里的插件（默认登记 dsh-devforge 自己，可在设置里加包名→官网清单或 GitHub 仓库），一键升级走下载 tgz（官网渠道强制 sha256 校验）→ `dsh plugin add` 的同一条人工验证路径；升级后提示重启 DSH 生效（重启仍需用户确认）。
12. **DSH 全 GUI 换肤**：操作台「皮肤」页签基于官方 `ctx.theme.register/overrideTokens` 一等 API 提供 14 套内置主题（7 浅 7 深，含 4 套紫色：薰衣草、雾紫、星紫夜、水晶紫夜；以及晨雾蓝、樱花粉、纸感暖、森林绿、蜜柑橙、午夜蓝、石墨黑、松林夜、墨玉青、中国红）+ 8 色强调色 + 可选壁纸（本地图片/http(s)/data URL，配遮罩浓度/模糊/显示方式）。选择持久化到 localStorage 跨重启自动跟随，深浅色与 GUI 自带模式自动联动；针对 ThemeRuntime 持久化偏好 schema 不接受第三方皮肤 id 的限制，引导期做 4 次 200ms 重试兜底，状态真相源切换为 `ctx.theme.getTheme().active.id` 保证 active 高亮与 GUI 实际着色始终一致；写入失败时 UI 顶部 banner 提示。

## 可见运营浏览器

- `browser_open`：每次为调用智能体新建独立标签页，返回的元素引用自动绑定标签身份与快照代次。
- `browser_tabs`：列出、新建、选择或关闭同一个前台 Chrome 中的标签页。
- `browser_snapshot`、`browser_click`、`browser_type`：使用 `t<标签>g<代次>:<元素>` 作用域引用；操作前自动切回所属标签页，引用失效时直接拒绝，不会猜测或落到其它页面。
- `browser_upload`：在引用所属标签页内原子完成点击上传、文件校验、暂存上传和快照刷新。
- 同一个登录档案只启动一个 Playwright MCP 进程；所有智能体共享 Host 级操作队列，因此单次操作会短暂排队，但各自标签页和页面状态相互隔离。
- 登录、退出和切换账号属于全局档案状态变更，操作时仍必须暂停其它任务。

## 闲鱼运营助手

- `xianyu_messages_list`：读取当前账号的会话列表、最后一条消息、时间和未读状态。
- `xianyu_conversation_read`：按联系人显示名打开并读取完整对话；打开未读会话会触发闲鱼自身的已读状态。
- `xianyu_reply`：真实发送前必须由用户确认联系人和完整正文，并传入绑定具体联系人的确认短语，例如“确认发送给‘张三’”。同一联系人和内容五分钟内不会重复发送。
- `xianyu_publish`：上传商品图片、把标题写入描述首行、填写价格并点击发布；必须传入“确认发布”，且只有跳转到 `/item?id=` 商品详情页才报告成功。平台要求手机认证时停止并提示用户在前台完成。
- 发布页和消息页使用独立标签页，统一复用一个可见 Chrome 和持久登录档案；闲鱼登录、认证、切换账号由用户在前台完成。插件不读取、保存或输出密码、Cookie 和令牌。

## 开发

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
```

源仓库不依赖任何机器的绝对路径。`pnpm-workspace.yaml` 不允许提交本机 DSH 的 `link:` 覆盖；依赖必须可由发布版本解析。

## 从 GitHub 安装

方式一（推荐，Release 直链免构建，其他电脑一条命令）：

```sh
dsh plugin --profile web add https://github.com/andyfan1094/dsh-devforge/releases/latest/download/dsh-devforge-0.13.0.tgz
```

每次发版 tgz 文件名带版本号，新版本请到 [Releases 页](https://github.com/andyfan1094/dsh-devforge/releases) 复制对应直链替换；装完重启 DSH Web Host 生效。已装好的机器也可以直接在「天工造梦 → 插件更新」页签一键检查并升级。

方式二（源码安装，目标机执行 `prepare` 构建）：

```sh
dsh plugin --profile web add github:andyfan1094/dsh-devforge#main
```

源码安装会执行 `prepare` 构建。安装完成后，确认 web profile 的 `package.json` 依赖项和 `dsh.profile.bundles` 均包含 `dsh-devforge`，再重启 DSH Web Host。

## 规范文件

- `standards/v1/common.zh.md`：职责边界、注释、可读性、复用、开源依赖、日志、安全、验证和版本管理。
- `standards/v1/api.zh.md`：Api、Bll/BAL、Dal、Model、Utility/Utils 的单向分层与后端安全边界。
- `standards/v1/web-service.zh.md`：Web 后端工程结构、日志、健康检查和交付验证。
- `standards/v1/frontend.zh.md`：页面层职责、API 客户端边界、可读性和复用要求。

新增规范时，在 `standards/vN/` 下增加带一级标题和 `tags:` 行的 Markdown 文件；重启或重新加载插件后生效。
