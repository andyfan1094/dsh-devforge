# dsh-devforge

规范驱动的服务生成插件（DeepSeek Harness 双面插件）。

## 三大能力

1. **开发规范库**：插件内置 standards/ 目录（分版本 markdown），宿主半边通过 systemPrompt 常驻节 + devforge_standards 工具暴露给所有 agent；一键生成时按任务挂载注入子代理。
2. **一键服务生成**：devforge_jobs 工具 / 面板"新建服务"页 → 按模板创建独立子代理会话（ctx.agents.create），规范注入系统提示，首条消息派活；面板实时看状态、可取消。
3. **仿 SSH 面板**：侧边栏"服务工厂"入口，中栏三页签面板（开发规范 / 生成任务 / 新建服务），loopback 围栏 API。

## 面板截图

见 docs/screenshots/（待补）。

## 开发

```sh
pnpm install
pnpm build      # tsdown 双入口构建（lib/index.js + lib/client/index.js）
pnpm typecheck
```

## 安装（web profile）

```sh
dsh plugin --profile web add link:D:/项目/dsh-plugins/dsh-devforge
```

装完按记忆规范核验双闸（package.json dependencies 行 + dsh.profile.bundles 行）并走安全路径重启。

## 规范文件

- standards/v1/common.zh.md 通用（注释铁律/工程/异常/自检）
- standards/v1/api.zh.md API 服务
- standards/v1/web-service.zh.md Web 脚手架
- standards/v1/frontend.zh.md 前端应用

新增规范 = 往 standards/vN/ 丢 md 文件（# 一级标题 + tags: 行），重载插件即生效。
