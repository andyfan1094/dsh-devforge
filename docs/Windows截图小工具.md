# Windows 截图小工具（win-snip）

> 状态：0.51.0 引入。仅 Windows 生效，macOS/Linux 上不注册入口、不启动进程。

## 一、它是什么

插件内置的一套**原生截图工具**，行为对齐 Snipaste：

1. 任意应用下按 `Alt+A`（可改）→ 全屏半透明遮罩，鼠标框选区域；
2. 松开鼠标就在原地进入编辑：矩形 / 椭圆 / 箭头 / 画笔 / 文字 / 马赛克 / 序号，支持撤销重做；
3. 工具栏一键做**模型识别（OCR）**、**模型翻译**、**钉图（置顶悬浮）**、复制、保存；
4. 钉住的图是**独立置顶窗口**，任何应用之上可见，可拖动、滚轮缩放、Esc 关闭，支持多张。

## 二、为什么是原生而不是网页

截图的价值在于"任何应用里随手可用"。若把编辑放进浏览器页面，每次截图都会打断当前工作、
把窗口切到 DSH，与工具定位冲突。因此：

- **原生（PowerShell + WinForms）** 承担：全局热键、遮罩框选、就地标注、置顶浮窗、剪贴板、落盘；
- **宿主（Node，本插件）** 承担：进程生命周期、配置、日志、以及**唯一**的模型调用通道。

这么分的原因：模型 Key 只能留在宿主侧（受管凭据），绝不进入 PowerShell 进程参数、命令行或日志。

## 三、架构与调用方向

```
Alt+A（RegisterHotKey，助手进程常驻）
   └─ 遮罩框选 → 就地编辑 → 用户点「识别 / 翻译」
        └─ 助手把合成后的 PNG 写入 <root>/requests/<id>.png 与 <id>.json
             └─ 宿主每 200ms 轮询 requests/ → 校验路径 → 调视觉模型
                  └─ 写回 <root>/responses/<id>.json → 助手弹出结果窗（可复制）
```

- 助手不再需要知道 HTTP 端口，也不持有任何凭据：**文件队列即 RPC**。
- 宿主只信任 `<root>/requests/` 之内的图片路径，防止被当成任意文件读取器。
- 助手每 5s 写 `<root>/status.json` 心跳；宿主据此判断存活（不依赖命令行解析）。

目录（均在用户主目录下，随实例隔离）：

```
~/.dsh/devforge/win-snip/
├── status.json          助手心跳（pid / 热键 / 截图次数 / 最近一次时间）
├── commands/            宿主 → 助手（capture = 立即截一张）
├── requests/            助手 → 宿主（ocr / translate + 图片）
├── responses/           宿主 → 助手（识别与译文）
└── logs/assistant.log   助手运行日志（不含凭据）
```

## 四、HTTP 接口（仅本机 GUI）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/dsh-devforge/win-snip/status` | 状态：是否支持、是否运行、热键、截图次数、最近截图时间 |
| GET/PUT | `/api/dsh-devforge/win-snip/settings` | 读取/保存配置（开关、热键、保存目录、模型通道、翻译语言） |
| POST | `/api/dsh-devforge/win-snip/start` | 启动常驻助手 |
| POST | `/api/dsh-devforge/win-snip/stop` | 停止常驻助手（含子窗口） |
| POST | `/api/dsh-devforge/win-snip/capture` | 立即触发一次截图（等价按热键） |

## 五、配置项

存储在 store.db `win-snip.settings` 域：

| 字段 | 默认 | 说明 |
|------|------|------|
| `enabled` | `false` | 是否随插件启动常驻助手 |
| `hotkey` | `Alt+A` | 全局热键，形如 `Alt+A`、`Ctrl+Shift+S` |
| `saveDir` | 图片/DSH截图 | 保存目录，空则用系统图片目录下 DSH截图 |
| `copyOnFinish` | `true` | 框选完成即复制到剪贴板 |
| `visionProvider` | `auto` | `auto` / `minimax` / `openai`（openai = 中转站） |
| `visionModel` | 空 | 走中转站时的视觉模型名 |
| `translateTarget` | `auto` | `auto`（中↔英自动判断）/ `zh` / `en` |

## 六、文件清单

宿主（TypeScript）：

- `src/win-snip/protocol.ts` — 契约：路由常量、配置与状态类型、热键解析
- `src/win-snip/store.ts` — 配置读写与默认值、保存目录解析
- `src/win-snip/paths.ts` — 运行目录与原生脚本定位
- `src/win-snip/vision.ts` — 视觉模型通道（识别/翻译），凭据经受管引用解析
- `src/win-snip/assistant.ts` — 助手进程生命周期、文件队列轮询、状态读取
- `src/win-snip/routes.ts` — 面板 HTTP 路由
- `src/win-snip/activate.ts` — 能力装配（注册路由、按配置启动助手）

原生（PowerShell 5.1 + WinForms）：

- `native/win-snip-common.ps1` — P/Invoke、日志、截屏、DPI、HTTP 无关的文件队列读写
- `native/win-snip-assistant.ps1` — 常驻主进程：注册热键、命令轮询、调起遮罩
- `native/win-snip-overlay.ps1` — 遮罩框选 + 就地标注编辑器 + 工具条
- `native/win-snip-float.ps1` — 置顶浮窗（拖动/缩放/Esc）
- `native/win-snip-result.ps1` — 识别/翻译结果窗

构建：`scripts/postbuild.mjs` 把 `src/win-snip/native` 复制到 `lib/native`，随包发布。

## 七、已知限制

- 仅 Windows：非 win32 平台面板显示"当前平台不支持"，不注册任何进程。
- 全局热键被其他软件占用时注册失败，助手会在 status.json 写明原因，面板可见。
- 高 DPI 下执行的是 Per-Monitor V2 感知，坐标按物理像素处理。
- 识别/翻译走模型视觉，需要至少一条可用的模型通道（MiniMax 订阅 Key 或 OpenAI 中转站）。
- 助手进程随插件生命周期结束而结束；插件被卸载时不会留下常驻进程。

## 八、验收步骤（暂存实例）

1. 面板「截图小工具」页确认状态为"运行中"，热键显示 `Alt+A`；
2. 任意窗口按 `Alt+A`，脱选一块含文字的界面，确认遮罩、尺寸提示、工具条位置正常；
3. 画一个矩形 + 一个箭头 + 一段文字，撤销一次再重做，确认图形正确；
4. 点「识别」拿到文字，点「翻译」拿到译文，均可复制；
5. 点「钉图」，确认浮窗置顶、可拖动、滚轮缩放、Esc 关闭；
6. 点「保存」落到配置目录，点「复制」在别处能粘贴出图。
