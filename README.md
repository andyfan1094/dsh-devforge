# dsh-devforge 服务工厂

面向 DeepSeek Harness 的规范驱动服务生成插件，采用 Host 与浏览器双面架构：Host 提供规范注入、子代理服务生成、版本管理和本机重启能力；浏览器侧提供“服务工厂”操作台。

## 主要能力

1. **通用开发规范库**：版本化 Markdown 规范存放于 `standards/`，通过系统提示和 `devforge_standards` 工具提供给 Agent；创建服务时按模板注入生成子代理。
2. **一键生成服务**：`devforge_jobs` 工具和“新建服务”页创建独立子代理。后端服务默认注入 Api、Bll/BAL、Dal、Model、Utility/Utils 分层，要求中文注释、通用能力复用、成熟开源包优先、结构化日志和验证后的中文 Git 提交。
3. **服务工厂操作台**：侧边栏“服务工厂”入口提供开发规范、生成任务、新建服务、远程运维、GitHub 和飞书能力。
4. **本机 DSH 重启**：操作台“重启 DSH”按钮和 `devforge_restart` 工具仅在用户明确要求时使用。重启接口要求 loopback 与同源请求，复用现有启动参数，启动日志写入 `$DSH_HOME/logs/dsh-web-restart.log`。

## 开发

```sh
pnpm install
pnpm run typecheck
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
