# 本地安装要点（2026-08-29 整理）

1. pnpm install && pnpm build（产物 lib/index.js 与 lib/client.js 必须同时存在）
2. 双闸核验（web profile）：
   - ~/.dsh/profiles/web/package.json 的 dependencies 加 "dsh-devforge": "link:D:/项目/dsh-plugins/dsh-devforge"
   - ~/.dsh/profiles/web/dsh.profile（或等价 manifest）的 bundles 数组确认含 dsh-devforge 行
3. Host 重启只走 schtasks dsh-agent-restart 安全路径
4. 验证：面板侧边栏出现"服务工厂"；GET http://127.0.0.1:3080/api/dsh-devforge/standards 返回规范清单
