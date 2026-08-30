# 从 GitHub 安装与验证

## 发布前

1. 在独立源仓库修改代码，不直接修改 `~/.dsh/plugins/` 下的运行时安装目录。
2. 执行 `pnpm run typecheck`、`pnpm run build` 和 `pnpm pack --dry-run`。
3. 检查工作树，只暂存本次改动；不得提交 `logs/`、私有配置、数据库、密钥、令牌或无关文件。
4. 使用中文提交信息提交并推送 GitHub。

## 安装

```sh
dsh plugin --profile web add github:andyfan1094/dsh-devforge#main
```

GitHub 安装会运行插件的 `prepare` 脚本构建产物。若 pnpm 提示需要批准构建脚本，按提示在 web profile 的 `pnpm-workspace.yaml` 中仅加入对应包名后重试。

## 安装后验证

1. 检查 `~/.dsh/profiles/web/package.json` 的 dependencies 中存在 `dsh-devforge`。
2. 检查 `~/.dsh/profiles/web/dsh.profile` 或等价 manifest 的 bundles 中存在 `dsh-devforge`。
3. 重启 DSH Web Host，刷新浏览器后确认侧边栏出现“服务工厂”。
4. 本机访问 `http://127.0.0.1:3080/api/dsh-devforge/standards`，确认返回规范清单。
5. 在服务工厂查看“开发规范”，确认显示通用开发规范标题；使用“重启 DSH”时，确认页面短暂断开后能够恢复。
