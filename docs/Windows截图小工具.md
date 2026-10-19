# Windows 截图小工具（win-snip）

> 状态：0.52.0 引入；0.63.0 增加「热键先弹功能选择框」与「剪贴板历史（默认保留 15 天）」。仅 Windows 生效，macOS/Linux 上不注册入口、不启动进程。

## 一、它是什么

插件内置的一套**原生截图工具**，行为对齐 Snipaste：

0. 按热键（默认 `Alt+A`，可改）先弹出**功能选择框**：`1` 截图 / `2` 剪贴板，也可用方向键 + Enter；
2. 松开鼠标就在原地进入编辑：矩形 / 椭圆 / 箭头 / 画笔 / 文字 / 马赛克 / 序号，支持撤销重做；
3. 工具栏一键做**模型识别（OCR）**、**模型翻译**、**钉图（置顶悬浮）**、复制、保存；
4. 钉住的图是**独立置顶窗口**，任何应用之上可见，可拖动、滚轮缩放、Esc 关闭，支持多张；

## 二、为什么是原生而不是网页

截图的价值在于"任何应用里随手可用"。若把编辑放进浏览器页面，每次截图都会打断当前工作、
把窗口切到 DSH，与工具定位冲突。因此：

- **原生（PowerShell + WinForms）** 承担：全局热键、遮罩框选、就地标注、置顶浮窗、剪贴板、落盘；
- **宿主（Node，本插件）** 承担：进程生命周期、配置、日志、以及**唯一**的模型调用通道。

这么分的原因：模型 Key 只能留在宿主侧（受管凭据），绝不进入 PowerShell 进程参数、命令行或日志。

## 三、工具条为什么是真实控件 + 矢量图标

工具条经历了一次返工，结论值得记下来：

- **不要自绘整个工具条**。最初把按钮画在遮罩窗体的 `OnPaint` 里，文字始终画不出来——`TextRenderer`（GDI）不认 `Graphics` 的坐标变换，而遮罩层为了缩放在用变换矩阵。改成真实 `Control` 子类后问题消失。
- 现在的分工：**遮罩窗体只画**背景图、选区、标注图元、控制点；**工具条是独立控件树**（`SnipToolbarPanel : FlowLayoutPanel` + 14 个 `SnipToolButton`），谁也不用操心对方的重绘。
- 按钮是**矢量单线图标 + 中文文字**，不是 emoji。emoji 在不同机器上字体缺失会变成方块，且与工具类产品的调性不符。
- 按钮不能抢焦点：`SnipToolButton` 设 `ControlStyles.Selectable = false` 且 `TabStop = false`，否则按 Esc / Ctrl+Z / Ctrl+C / Ctrl+S 会被按钮吃掉。
- `FlowLayoutPanel.AutoSize` 在布局完成前返回错误尺寸（实测 87×40），所以宽度必须**自己加**：`Padding.Horizontal + Σ(child.Width + child.Margin.Horizontal)`。

配色：底 `rgb(38,38,42)`、描边 `rgb(66,66,74)`、主色 `rgb(45,107,255)`、正文 `rgb(238,238,242)`、禁用 `rgb(118,118,126)`；图标描边 1.6px 圆头。
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
├── commands/            宿主 → 助手（capture = 截一张，menu = 功能选择框，clipboard = 剪贴板历史）
├── requests/            助手 → 宿主（ocr / translate + 图片）
├── responses/           宿主 → 助手（识别与译文）
├── clipboard/           剪贴板历史（days/ 按天 JSONL + images/ 图片，默认保留 15 天）
```

## 四、HTTP 接口（仅本机 GUI）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/dsh-devforge/win-snip/status` | 状态：是否支持、是否运行、热键、截图次数、最近截图时间 |
| GET/PUT | `/api/dsh-devforge/win-snip/settings` | 读取/保存配置（开关、热键、保存目录、模型通道、翻译语言） |
| POST | `/api/dsh-devforge/win-snip/start` | 启动常驻助手 |
| POST | `/api/dsh-devforge/win-snip/stop` | 停止常驻助手（含子窗口） |
| POST | `/api/dsh-devforge/win-snip/capture` | 立即触发一次截图（等价选择框里选「截图」） |

## 五、配置项

存储在 store.db `win-snip.settings` 域：

| 字段 | 默认 | 说明 |
|------|------|------|
| `enabled` | `false` | 是否随插件启动常驻助手 |
| `hotkey` | `Alt+A` | 全局热键，形如 `Alt+A`、`Ctrl+Shift+S` |
| `saveDir` | 图片/DSH截图 | 保存目录，空则用系统图片目录下 DSH截图 |
| `copyOnFinish` | `true` | 框选完成即复制到剪贴板 |
| `translateTarget` | `auto` | `auto`（中↔英自动判断）/ `zh` / `en` |

识别与翻译**没有独立配置项**：它们直接走 DSH 当前使用的模型
（`ctx.llm` + `ctx.attachments`），沿用面板里已配好的 provider 与凭据，
不需要另填 Key 或模型名。选模型时按 `inputModalities` 判断是否支持图片，
默认模型看不了图会自动换一个能看图的。

## 六、文件清单

宿主（TypeScript）：

- `src/win-snip/protocol.ts` — 契约：路由常量、配置与状态类型、热键解析
- `src/win-snip/store.ts` — 配置读写与默认值、保存目录解析
- `src/win-snip/paths.ts` — 运行目录与原生脚本定位
- `src/win-snip/vision.ts` — 识别/翻译：截图登记为附件后走 DSH 当前模型，含排版归一化
- `src/win-snip/assistant.ts` — 助手进程生命周期、文件队列轮询、状态读取
- `src/win-snip/routes.ts` — 面板 HTTP 路由
- `src/win-snip/activate.ts` — 能力装配（注册路由、按配置启动助手）

原生（PowerShell 5.1 + WinForms）：

- `native/win-snip-common.ps1` — P/Invoke、日志、截屏、DPI、HTTP 无关的文件队列读写
- `native/win-snip-assistant.ps1` — 常驻主进程：注册热键、命令轮询、调起遮罩
- `native/win-snip-overlay.ps1` — 遮罩框选 + 就地标注编辑器 + 工具条
- `native/win-snip-float.ps1` — 置顶浮窗（拖动/缩放/Esc）
- `native/win-snip-result.ps1` — 识别/翻译结果窗
- `native/win-snip-ui.ps1` — 工具条控件（`SnipToolButton` 自绘矢量图标按钮 + `SnipToolbarPanel` 容器）
- `native/win-snip-launcher.ps1` + `native/win-snip-choice.cs` — 热键功能选择框（两张卡片 + 键盘操作）
- `native/win-snip-clipboard-store.ps1` — 剪贴板历史存储（按天 JSONL、图片落盘、去重、过期清理）
- `native/win-snip-clipboard-watch.ps1` — 剪贴板采集（序列号轮询、文本/图片/文件、hash 去重）
- `native/win-snip-clipboard-read.cs` — 纯 Win32 剪贴板读写（文本 / 文件 / CF_DIB 图片）
- `native/win-snip-clipboard-panel.ps1` — 剪贴板历史窗口（搜索 / 预览 / 复制 / 删除 / 清空）

客户端（React）：

- `src/client/panel/WinSnipTab.tsx` — 面板「截图」页签：开关、热键、保存目录、模型通道、翻译方向、后台状态与启停
- `src/client/api.ts` — `getWinSnipStatus` / `getWinSnipSettings` / `putWinSnipSettings` / `winSnipStart` / `winSnipStop` / `winSnipCapture` / `winSnipClipboard`

构建：`scripts/postbuild.mjs` 把 `src/win-snip/native` 复制到 `lib/native` 并**强制 UTF-8 BOM**，随包发布。

自测：`scripts/win-snip-clipboard-selftest.ps1` 在隔离目录里验证存储层与真实剪贴板采集（`-IncludeClipboard`），不需要宿主、不碰生产数据。

> BOM 不是可选项：Windows PowerShell 5.1 会按 GBK 解码无 BOM 的 UTF-8 脚本，中文字符串直接变成语法错误（`表达式或语句中包含意外的标记`）。因此打包链路必须重新补 BOM，不能依赖源文件保存格式。

## 七、已知限制

- 仅 Windows：非 win32 平台面板显示"当前平台不支持"，不注册任何进程。
- 全局热键被其他软件占用时注册失败，助手会在 status.json 写明原因，面板可见。
- 高 DPI 下执行的是 Per-Monitor V2 感知，坐标按物理像素处理。
- 识别/翻译走模型视觉，需要至少一条可用的模型通道（MiniMax 订阅 Key 或 OpenAI 中转站）。
- 助手进程随插件生命周期结束而结束；插件被卸载时不会留下常驻进程。
- 助手停止时宿主会删掉 `status.json`，面板上的剪贴板条数显示 0，但磁盘历史仍在；
  助手重新启动或打开剪贴板窗口后会回到真实条数。
- 剪贴板历史只在本机：不上传、不联网；复制动作走系统剪贴板，与普通复制等价。

## 八、验收步骤

**桌面版（Electron 托管）下无法用命令行起暂存实例** —— 2026-10-18 实测结论：

- `--profile desktop` 直接被拒：`profile "desktop" is managed exclusively by the Electron application`；
- 换成其它 profile 起 3081，`dsh-devforge` 加载失败：
  `Cannot find package '@deepseek-ai/dsh-credentials' imported from .../dsh-devforge/lib/index.js`；
- 该包只存在于 `app.asar` 内，独立进程无法解析；`dsh-devforge` 从 0.50.0 起就 import 它，与本次改动无关；
- 另外 `~/.dsh-staging/.dsh/profiles` 若是指向生产 `profiles` 的 Junction，暂存写配置会**直接改写生产文件**（已实测证实并修正为真实目录）。

因此桌面版的验收只能走「装进 desktop profile → 重启 Host → 面板与热键实测」：

0. 重启 Host 后，面板导航出现「截图」页签；`/api/dsh-devforge/win-snip/status` 返回 `supported: true`；

1. 面板「截图小工具」页确认状态为"运行中"，热键显示 `Alt+A`；
2. 任意窗口按 `Alt+A`，脱选一块含文字的界面，确认遮罩、尺寸提示、工具条位置正常；
3. 画一个矩形 + 一个箭头 + 一段文字，撤销一次再重做，确认图形正确；
4. 点「识别」拿到文字，点「翻译」拿到译文，均可复制；
5. 点「钉图」，确认浮窗置顶、可拖动、滚轮缩放、Esc 关闭；
6. 点「保存」落到配置目录，点「复制」在别处能粘贴出图。
7. 按 `Alt+A` 先出现「随手工具」选择框（截图 / 剪贴板），按 `2` 打开剪贴板历史、Esc 关闭；
8. 随便复制一段文字，确认它出现在剪贴板列表最前；搜索关键词能过滤；选中按 Enter 能复制回剪贴板；
   Delete 删除单条，「清空历史」有二次确认。

## 九、识别结果怎么做到"按截图排版"

排版能还原是四件事一起做成的，缺一件就会错乱：

1. **提示词约束**：要求一行对一行、保留空行与缩进层级、保留项目符号与编号、
   表格用半角空格补齐列、不要 Markdown 装饰、看不清用「□」不猜。
2. **排版归一化**（`normalizeLayout`）：模型常混用全角空格（U+3000）、制表符、
   不换行空格（U+00A0），这些在等宽字体里宽度不等于半角空格，会让列错位。
   统一换算成半角空格（一个全角 = 两个半角），并去掉行尾空格、压缩多余空行；
   注意**不能用 `trim()`**，那会把首行缩进一起吃掉。
3. **等宽字体**：结果窗用 `New-SnipMonoFont`。含中文时选 `MS Gothic`
   （本机实测没有 NSimSun/SimSun，而 MS Gothic 的中文与半角字符都是定宽，
   实测中文 15px、西文 7.5px，正好 2 倍关系），纯西文用 `Cascadia Mono`。
   GDI+ 找不到字体不抛异常而是静默替换，所以必须用 `font.Name` 比对确认。
4. **关闭自动换行**：TextBox 的 `WordWrap = $false` + `ScrollBars = Both`，
   否则长行被重排，列对齐立刻失效；窗体宽度按最长行自适应。

实测（2026-10-18，经宿主真实模型通道）：

```
|Item        Qty        Price|
|apple       12         3.50|
|banana      7          2.10|
|- first point|
|    nested detail|
```

```
|名称        数量        单价|
|苹果        12          3.50|
|香蕉        7           2.10|
|合计        19          5.60|
|• 第一项|
|  补充说明|
```

## 十、踩过的坑（都别再踩）

- **`Application::DoEvents()` 会吞掉 `WM_HOTKEY`**：主循环早期用 DoEvents 泵消息，
  Alt+A 注册成功却毫无反应；改成显式 `PeekMessage`/`DispatchMessage` 才收得到。
- **低层键盘钩子才是兜底**：LOL、wegame、RustDesk、NVIDIA Overlay 等程序也挂着
  `WH_KEYBOARD_LL` 并抢先吃掉 Alt+A，`RegisterHotKey` 收不到。助手额外装一个
  更晚注册的钩子，匹配成功就记一次命中并吞掉事件。
- **WinForms 未处理异常会弹 .NET 崩溃框并结束进程**：钉图窗早期在事件回调里访问
  局部 `$state`（函数已返回），抛"在此对象上找不到属性 Drag"，整进程退出。
  修法：状态放 `$script:SnipFloatStates[$form]`，每个回调包 try/catch，
  再加 `Enable-SnipCrashGuard` 注册 `Application.ThreadException` 与
  `AppDomain.UnhandledException` 兜底。
- **单实例清理不能按文件名模糊匹配**：曾用 `-like '*win-snip-assistant.ps1*'`
  匹配命令行，把"命令行里恰好提到该文件名的排查终端"一起杀掉
  （表现为命令莫名 exit code 4294967295）。只能匹配
  `-File\s+\S*win-snip-assistant\.ps1` 这种真正的启动形式。
- **`.ps1` 必须是 UTF-8 带 BOM**：PowerShell 5.1 把无 BOM 当 GBK 解，直接报
  "表达式或语句中包含意外的标记"；队列与状态 JSON 反之必须无 BOM。
  `edit`/`write` 会丢 BOM，需用 `[System.IO.File]::WriteAllText` 显式补回。

## 十一、功能选择框与剪贴板历史

**功能选择框**（`win-snip-launcher.ps1` + `win-snip-choice.cs`）：

- 热键触发后 150ms 才 arm 失焦自动关闭，避免刚显示就被判定失焦闪退；
- 数字键 1/2、↑↓ 切换、Enter 确认、Esc 取消，点卡片也可以；
- 返回 `'capture'` / `'clipboard'` / `$null`，`$null` 表示取消（不执行任何动作）；
- 位置跟随光标，贴边时自动翻到左上，保证整个框都在工作区内。

**剪贴板历史**（`win-snip-clipboard-*.ps1/.cs`）：

- 采集：主循环每 30ms 比对 `GetClipboardSequenceNumber()`，变了才读；纯 Win32
  （`OpenClipboard` / `GetClipboardData` / `GlobalLock`），不用 .NET `Clipboard` 类
  （后者会抛"剪贴板被占用"，也拿不到 CF_HDROP 的原始路径）；
- 优先级：文件 > 图片 > 文本；图片存 `clipboard/images/<id>.png`，JSONL 只存相对文件名；
- 去重：内容 SHA1，同一内容重复复制不会重复记录；
- 保留：按日期文件 + 引用集合清理。超过 `clipboardDays`（默认 15）的日期文件删除，
  不再被任何保留记录引用的图片一并删除（跨天复制的图不会被误删）；
- 上限：单条文本 200k 字符、文件列表 200 项、图片 16MB；
- 隐私：只写本机 `~/.dsh/devforge/win-snip/clipboard/`，不联网、不上传；
- 面板：搜索（内容 / 来源应用）、预览（文本 / 图片 / 文件）、Enter 或双击复制回剪贴板、
  Delete 删除、Ctrl+F 聚焦搜索、F5 刷新、Esc 关闭；「清空历史」在底部并有二次确认。
- **`[string]` 参数会把 `$null` 变成空串**：选择框的 `$choose` 原来写成
  `param([string]$Choice)`，Esc 取消传 `$null` 被转成 `''`，调用方拿到的不是 `null`。
  参数要么不声明类型，要么显式判空还原 `$null`。
- **PowerShell 返回单元素集合会被展开成标量**：剪贴板历史只有 1 条时 `$items[0]`
  取不到（读回 0 条）；`HashSet` 直接 `return` 会被展开成定长数组，`Remove` 抛
  `Collection was of a fixed size`。统一用 `@(...)` 包住集合，返回 HashSet 用 `return ,$set`。
- **`edit` / `write` 写回会丢 UTF-8 BOM**：改完 `.ps1` 必须复核补 BOM，
  否则 PowerShell 5.1 按 GBK 解出乱码并报语法错误（本次实测踩到）。
- **锁屏 / RDP 断开时 `CopyFromScreen` 报"句柄无效"**：UI 验收改用
  `PrintWindow(hwnd, hdc, 2)` 离屏渲染；键盘交互用 `PostMessage` 发给**焦点控件**
  （剪贴板面板里是 ListBox，不是顶层窗体）。