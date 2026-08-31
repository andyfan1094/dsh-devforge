# CNB 代码托管对接说明

dsh-devforge 0.8.0 起内置 **CNB 代码托管能力**（cnb.cool，腾讯云原生构建），与既有 GitHub 能力并列，服务工厂的智能体可以直接操作国内仓库。

## 一、能力清单（10 个 cnb_* 工具）

| 工具 | 作用 |
|------|------|
| `cnb_auth_add` | 添加/更新 CNB 账号（保存访问令牌到本机 0600 文件） |
| `cnb_auth_list` | 列出已配置账号（不回显令牌） |
| `cnb_auth_test` | 验证令牌并返回认证用户名 |
| `cnb_auth_remove` | 删除本机账号记录 |
| `cnb_repo_list` | 列出我的仓库（支持名称/描述过滤） |
| `cnb_clone` | 克隆仓库（支持 `owner/repo` 简写） |
| `cnb_pull` | 快进拉取（--ff-only） |
| `cnb_push` | 推送（默认关闭） |
| `cnb_commit` | 本地提交（不推送） |
| `cnb_status` | 本地仓库状态 |

## 二、准备访问令牌（一次性）

1. 登录 [cnb.cool](https://cnb.cool)；
2. 进入 **个人设置 → 访问令牌 → 添加访问令牌**；
3. 按需配置到期时间、使用范围（公开/私有仓库）与授权范围（读写）；
4. 创建后复制令牌，然后让智能体执行 `cnb_auth_add`（或直接告诉智能体令牌，由它保存）。

## 三、平台特性（与 GitHub 的差异）

- **仅支持 HTTPS + 访问令牌**：Git 认证用户名固定为 `cnb`、密码为令牌；**不支持 SSH**；
- **OpenAPI**：`https://api.cnb.cool`，认证头 `Authorization: Bearer <令牌>`；
- **仓库地址**：`https://cnb.cool/<组织路径>/<仓库路径>`，带不带 `.git` 后缀都可以；
- **公开仓库可匿名克隆**：未配置令牌时 `cnb_clone` 也能克隆公开仓库。

## 四、安全边界

- 令牌只存本机 `~/.dsh/dsh-cnb.json`（权限 0600），列表/摘要接口一律不回显；
- Git 操作时令牌经 **临时 HTTP 头** 注入，**绝不写入远端 URL 或仓库配置**；命令输出（stdout/stderr/命令串）自动脱敏为 `[redacted-token]`；
- `/api/dsh-cnb` 路由仅接受本机回环访问；
- **push / force-push 默认关闭**：需在服务工厂设置 → CNB 配置里显式打开。

## 五、配置开关

服务工厂设置 → dsh-devforge → **CNB 配置**：`enabled` 控制是否注册 `cnb_*` 工具与路由（默认开启；未配置令牌时仅影响需要认证的操作）。
