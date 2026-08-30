# dsh-devforge 服务工厂

面向 DeepSeek Harness 的规范驱动服务生成插件，采用 Host 与浏览器双面架构：Host 提供规范注入、子代理服务生成、版本管理和本机重启能力；浏览器侧提供“服务工厂”操作台。

## 主要能力

1. **通用开发规范库**：版本化 Markdown 规范存放于 `standards/`，通过系统提示和 `devforge_standards` 工具提供给 Agent；创建服务时按模板注入生成子代理。
2. **一键生成服务**：`devforge_jobs` 工具和“新建服务”页创建独立子代理。后端服务默认注入 Api、Bll/BAL、Dal、Model、Utility/Utils 分层，要求中文注释、通用能力复用、成熟开源包优先、结构化日志和验证后的中文 Git 提交。
3. **服务工厂操作台**：侧边栏“服务工厂”入口提供开发规范、智谱 Coding Plan、生成任务、新建服务、远程运维、GitHub 和飞书能力。
4. **智谱 Coding Plan**：复用 DSH 受管凭据 `ZAI_CODING_CN_API_KEY`，一键补齐 `zai-coding-cn` 的 GLM-5.3 与 GLM-5.3-Flash；Host 直连智谱官方监控接口，展示 5 小时、周额度、重置倒计时、近 24 小时／7 天模型和 MCP 用量。Key 不进入浏览器、日志或普通配置。
5. **本机 DSH 重启**：操作台“重启 DSH”按钮和 `devforge_restart` 工具仅在用户明确要求时使用。重启接口要求 loopback 与同源请求，复用现有启动参数，启动日志写入 `$DSH_HOME/logs/dsh-web-restart.log`。
6. **可见运营浏览器**：本机前台 Chrome 保存持久登录档案，支持多标签页、页面快照、稳定元素操作和安全图片上传；多个会话共用一个浏览器进程，不复制 Cookie，也不另开隐形浏览器。
7. **闲鱼运营助手**：发布商品和消息回复分别使用独立标签页，页面状态互不覆盖；真实发布和真实发送均要求用户明确确认，并核验平台结果。

## 可见运营浏览器

- `browser_tabs`：列出、新建、选择或关闭同一个前台 Chrome 中的标签页。
- `browser_upload`：校验本机图片类型和大小，暂存到 MCP 允许目录后上传。
- 同一个登录档案只启动一个 Playwright MCP 进程；不同会话的页面操作通过统一队列防止引用串页。
- 多个任务可以保留不同标签页并交替推进。Playwright MCP 的点击和输入作用于当前标签页，因此单次页面操作会短暂排队；登录、退出和切换账号属于全局状态变更，操作时必须暂停其它任务。

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

```sh
dsh plugin --profile web add github:andyfan1094/dsh-devforge#main
```

GitHub 安装会执行 `prepare` 构建。安装完成后，确认 web profile 的 `package.json` 依赖项和 `dsh.profile.bundles` 均包含 `dsh-devforge`，再重启 DSH Web Host。

## 规范文件

- `standards/v1/common.zh.md`：职责边界、注释、可读性、复用、开源依赖、日志、安全、验证和版本管理。
- `standards/v1/api.zh.md`：Api、Bll/BAL、Dal、Model、Utility/Utils 的单向分层与后端安全边界。
- `standards/v1/web-service.zh.md`：Web 后端工程结构、日志、健康检查和交付验证。
- `standards/v1/frontend.zh.md`：页面层职责、API 客户端边界、可读性和复用要求。

新增规范时，在 `standards/vN/` 下增加带一级标题和 `tags:` 行的 Markdown 文件；重启或重新加载插件后生效。
