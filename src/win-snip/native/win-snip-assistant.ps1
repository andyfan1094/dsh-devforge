# win-snip-assistant.ps1 —— 截图小工具常驻主进程
#
# 职责：注册全局热键 → 收到触发后抓屏 → 调起遮罩编辑器 → 空闲时处理宿主下发的立即截图命令。
# 通信：不接 HTTP，也不持有任何凭据；识别/翻译走 requests/responses 文件队列。
#
# 参数由宿主（src/win-snip/assistant.ts）传入。

param(
    [Parameter(Mandatory = $true)][int]$Modifiers,
    [Parameter(Mandatory = $true)][int]$VirtualKey,
    [Parameter(Mandatory = $true)][string]$HotkeyLabel,
    [Parameter(Mandatory = $true)][string]$BaseDir,
    [string]$SaveDir = '',
    [string]$CopyOnFinish = '1',
    # 热键后先弹功能选择框（1）还是直接截图（0）；由宿主按面板配置传入。
    [string]$HotkeyMenu = '1',
    # 热键优先翻译鼠标选中的文字（1/0）：有选区就翻译，没选区才走选择框/截图。
    [string]$SelectionTranslate = '1',
    # UIA 读不到选区时是否允许用 Ctrl+C 兜底（1/0）。
    [string]$SelectionCopyFallback = '1',
    # 翻译目标语言（auto / zh / en），随文本翻译请求带给宿主。
    [string]$TranslateTarget = 'auto',
    # 是否后台记录剪贴板历史（1/0）。
    [string]$ClipboardEnabled = '1',
    # 剪贴板历史保留天数（宿主已夹取到 1–90）。
    [int]$ClipboardDays = 15,
    # 单实例清理时用于匹配同类实例的脚本名片段。
    # 默认值就是正式脚本名；隔离验收时把脚本另存并传别的 tag，两只助手就能共存，
    # 不会因为"清理孤儿实例"把生产助手一起杀掉。
    [string]$InstanceTag = 'win-snip-assistant'
)

$ErrorActionPreference = 'Continue'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptDir 'win-snip-common.ps1')
. (Join-Path $scriptDir 'win-snip-theme.ps1')

# 先声明 DPI 感知，再创建任何窗口：否则高分屏上坐标与位图会错位。
try { [void][WinSnipNative]::SetProcessDPIAware() } catch { }
[void][System.Windows.Forms.Application]::EnableVisualStyles()

$global:SnipStats.BaseDir = $BaseDir
$global:SnipStats.Hotkey = $HotkeyLabel
$global:SnipStats.StartedAt = (Get-Date).ToString('o')
$global:SnipStats.State = 'idle'

Ensure-SnipDir $BaseDir
Ensure-SnipDir (Join-Path $BaseDir 'commands')
Ensure-SnipDir (Join-Path $BaseDir 'requests')
Ensure-SnipDir (Join-Path $BaseDir 'responses')
Ensure-SnipDir (Join-Path $BaseDir 'logs')

. (Join-Path $scriptDir 'win-snip-float.ps1')
. (Join-Path $scriptDir 'win-snip-result.ps1')
. (Join-Path $scriptDir 'win-snip-overlay.ps1')
. (Join-Path $scriptDir 'win-snip-clipboard-store.ps1')
. (Join-Path $scriptDir 'win-snip-clipboard-watch.ps1')
. (Join-Path $scriptDir 'win-snip-launcher.ps1')
. (Join-Path $scriptDir 'win-snip-clipboard-panel.ps1')
# 选区翻译（0.67.0）：必须在 result/theme/common 之后加载——它要复用结果窗与主题。
. (Join-Path $scriptDir 'win-snip-selection.ps1')

$copyToClipboard = ($CopyOnFinish -ne '0')
$hotkeyId = 1
$script:LastCaptureAt = [DateTime]::MinValue
# 热键行为：true = 先弹「截图 / 剪贴板」选择框；false = 保持老行为直接进遮罩。
$script:SnipMenuMode = ($HotkeyMenu -ne '0')
$global:SnipStats.ClipboardDays = $ClipboardDays
# 选区翻译（2026-10-22）：热键先看有没有文字选区，有就翻译，没有才走上面的老路径。
$script:SnipTranslateSelectionOn = ($SelectionTranslate -ne '0')
$script:SnipSelectionCopyFallbackOn = ($SelectionCopyFallback -ne '0')
$script:SnipTranslateTarget = $TranslateTarget

# 先装异常兜底：之后任何回调出问题都只记日志，不再弹 .NET 崩溃框并结束进程。
Enable-SnipCrashGuard

# 单实例约束：宿主重启会留下孤儿助手，两个助手会同时响应同一个热键（弹两个遮罩）。
# 匹配规则必须严格：只认 `-File <...>win-snip-assistant.ps1` 形式的命令行。
# 硬教训（2026-10-18）：早先用 -like '*win-snip-assistant.ps1*' 会把"命令行里
# 恰好提到该文件名的 shell"一起杀掉，连排查用的终端都被自己打死。
# 隔离验收用自定义 -InstanceTag 启动的实例不会被正式实例清理（反之亦然）。
$script:SnipInstanceTag = if ([string]::IsNullOrWhiteSpace($InstanceTag)) { 'win-snip-assistant' } else { $InstanceTag }
try {
    $siblingPattern = '-File\s+\S*' + [regex]::Escape($script:SnipInstanceTag) + '\.ps1'
    $siblings = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
        Where-Object {
            $_.ProcessId -ne $PID -and
            $_.CommandLine -and
            $_.CommandLine -match $siblingPattern
        }
    foreach ($sibling in $siblings) {
        try {
            Stop-Process -Id $sibling.ProcessId -Force -ErrorAction Stop
        } catch { }
    }
} catch { }

<#
.SYNOPSIS
    执行一次完整截图流程：抓屏 → 遮罩编辑 → 释放资源。
#>
function Invoke-SnipCapture {
    $stats = $global:SnipStats
    if ($stats.State -ne 'idle') { return }
    # 防抖：连续触发（连按热键或命令堆积）只保留第一次。
    if (((Get-Date) - $script:LastCaptureAt).TotalMilliseconds -lt 250) { return }

    $stats.State = 'capturing'
    $stats.Error = $null
    Update-SnipHeartbeat
    $bitmap = $null
    try {
        $bitmap = Capture-SnipScreen
        $screenRect = Get-SnipVirtualScreen
        $result = Show-SnipOverlay -Bitmap $bitmap -ScreenRect $screenRect -SaveDir $SaveDir -CopyOnFinish $copyToClipboard
        $stats.Captures = [int]$stats.Captures + 1
        $stats.LastCaptureAt = (Get-Date).ToString('o')
        Write-SnipLog ('截图完成：动作=' + [string]$result.Action)
    } catch {
        $stats.Error = '截图失败：' + $_.Exception.Message
        Write-SnipLog $stats.Error
    } finally {
        if ($null -ne $bitmap) { try { $bitmap.Dispose() } catch { } }
        $stats.State = 'idle'
        $script:LastCaptureAt = Get-Date
        Update-SnipHeartbeat
    }
}

<#
.SYNOPSIS
    打开剪贴板历史面板（供选择框与宿主命令调用）。
#>
function Invoke-SnipClipboardPanel {
    $stats = $global:SnipStats
    if ($stats.State -ne 'idle') { return }
    $stats.State = 'clipboard'
    Update-SnipHeartbeat
    try {
        Show-SnipClipboardPanel -Days ([int]$stats.ClipboardDays)
    } catch {
        $stats.Error = '剪贴板历史面板失败：' + $_.Exception.Message
        Write-SnipLog $stats.Error
    } finally {
        $stats.State = 'idle'
        Update-SnipHeartbeat
    }
}

<#
.SYNOPSIS
    热键优先分支：当前窗口有文字选区就翻译它。
.DESCRIPTION
    返回 $true 表示"这次热键已经被选区翻译用掉了"，调用方不要再弹选择框/截图；
    返回 $false 表示没有选区（或开关关着），按老路径继续。
    读选区失败一律当作"没有选区"：用户按下热键的意图是拿到截图/菜单，
    不能因为 UIA 抛了异常就什么都不发生。
#>
function Invoke-SnipSelectionHotkey {
    if (-not $script:SnipTranslateSelectionOn) { return $false }
    $stats = $global:SnipStats
    if ($stats.State -ne 'idle') { return $false }

    # 读选区期间就置成 translate：兜底会补一次 Ctrl+C，
    # 剪贴板采集器看到这个状态就不会把工具自己的复制记进历史。
    $stats.State = 'translate'
    $text = ''
    try {
        $text = Get-SnipSelectedTextAuto -AllowCopy $script:SnipSelectionCopyFallbackOn
    } catch {
        Write-SnipLog ('选区读取失败（按无选区处理）：' + $_.Exception.Message)
        $text = ''
    }
    if ([string]::IsNullOrEmpty($text)) {
        # 没有选区：状态回到 idle，交给调用方走原来的选择框/截图。
        # 顺手记一行窗口信息——用户反馈"选了却没翻译"时，能一眼看出是
        # 该窗口不给 UIA 选区，还是兜底被安全策略（资源管理器类窗口）跳过了。
        try {
            Write-SnipLog ('未读到选区，走原路径：前台类名=' + [SnipSelection]::ForegroundClass() +
                ' 进程=' + [SnipSelection]::ForegroundProcessName() +
                ' 兜底开关=' + $script:SnipSelectionCopyFallbackOn)
        } catch { }
        $stats.State = 'idle'
        return $false
    }

    Write-SnipLog ('热键命中选区：' + $text.Length + ' 字，直接翻译')
    $stats.Error = $null
    Update-SnipHeartbeat
    try {
        Invoke-SnipSelectionTranslate -Text $text -TargetLang $script:SnipTranslateTarget
    } catch {
        $stats.Error = '选区翻译失败：' + $_.Exception.Message
        Write-SnipLog $stats.Error
    } finally {
        $stats.State = 'idle'
        Update-SnipHeartbeat
    }
    return $true
}

<#
.SYNOPSIS
    热键后的功能选择框：选截图走遮罩，选剪贴板开历史面板。
#>
function Invoke-SnipMenu {
    $stats = $global:SnipStats
    if ($stats.State -ne 'idle') { return }
    $stats.State = 'menu'
    Update-SnipHeartbeat
    $choice = $null
    try {
        $choice = Show-SnipLauncher -Days ([int]$stats.ClipboardDays)
    } catch {
        $stats.Error = '功能选择框失败：' + $_.Exception.Message
        Write-SnipLog $stats.Error
    } finally {
        $stats.State = 'idle'
        Update-SnipHeartbeat
    }
    if ($choice -eq 'capture') {
        # 必须先回到 idle：Invoke-SnipCapture 自己会判断状态，否则会被这里挡掉。
        Invoke-SnipCapture
    } elseif ($choice -eq 'clipboard') {
        Invoke-SnipClipboardPanel
    }
}

<#
.SYNOPSIS
    处理宿主写入的立即截图命令（面板「立即截一张」/ 自检用）。
.DESCRIPTION
    命令是"一次性"的：先全部删除再按 action 执行，异常绝不会让同一条命令反复触发。
    支持的 action：capture（默认）/ menu（弹选择框）/ clipboard（开剪贴板历史）。
#>
function Invoke-SnipCommands {
    $dir = Join-Path $global:SnipStats.BaseDir 'commands'
    if (-not (Test-Path $dir)) { return }
    $files = @(Get-ChildItem -Path $dir -Filter '*.json' -File -ErrorAction SilentlyContinue)
    if ($files.Count -eq 0) { return }
    $actions = New-Object System.Collections.ArrayList
    foreach ($file in $files) {
        $action = 'capture'
        try {
            $raw = [System.IO.File]::ReadAllText($file.FullName, [System.Text.Encoding]::UTF8)
            $payload = $raw | ConvertFrom-Json
            if ($null -ne $payload -and [string]$payload.action -ne '') { $action = [string]$payload.action }
        } catch { }
        try { Remove-Item $file.FullName -Force -ErrorAction SilentlyContinue } catch { }
        if (-not $actions.Contains($action)) { [void]$actions.Add($action) }
    }
    foreach ($action in $actions) {
        if ($action -eq 'menu') { Invoke-SnipMenu }
        elseif ($action -eq 'clipboard') { Invoke-SnipClipboardPanel }
        else { Invoke-SnipCapture }
    }
}

<#
.SYNOPSIS
    排空并计数线程消息队列里的热键消息。
.DESCRIPTION
    编辑期间消息循环被 ShowDialog 占用，热键消息会在队列里堆积；
    返回计数后只执行一次截图，避免关掉编辑器又立刻弹出新的。
#>
function Receive-SnipHotkeyHits {
    $hits = 0
    $message = [WinSnipNative+MSG]::new()
    while ([WinSnipNative]::PeekMessage([ref]$message, [IntPtr]::Zero, $script:SnipWmHotkey, $script:SnipWmHotkey, $script:SnipPmRemove)) {
        if ($message.wParam -eq [IntPtr]1) { $hits = $hits + 1 }
    }
    return $hits
}

<#
.SYNOPSIS
    泵掉线程消息队列里的非热键消息（热键消息留给 Receive-SnipHotkeyHits 统计）。
.DESCRIPTION
    替代 Application::DoEvents。DoEvents 会把 WM_HOTKEY 一并取走并丢弃，导致热键永久失效；
    这里显式只取 WM_HOTKEY 以外的消息并 Dispatch 给窗口过程，热键消息一律留在队列里。
#>
function Flush-SnipMessageQueue {
    $message = [WinSnipNative+MSG]::new()
    # 取"除热键以外的所有消息"：分两段查询，避开 0x0312 这个区间。
    for ($round = 0; $round -lt 64; $round++) {
        $got = $false
        # 段一：0 .. WM_HOTKEY-1
        if ([WinSnipNative]::PeekMessage([ref]$message, [IntPtr]::Zero, 0, [uint32]($script:SnipWmHotkey - 1), $script:SnipPmRemove)) {
            $got = $true
        }
        # 段二：WM_HOTKEY+1 .. 0xFFFF
        elseif ([WinSnipNative]::PeekMessage([ref]$message, [IntPtr]::Zero, [uint32]($script:SnipWmHotkey + 1), [uint32]0xFFFF, $script:SnipPmRemove)) {
            $got = $true
        }
        if (-not $got) { break }
        try {
            [void][WinSnipNative]::TranslateMessage([ref]$message)
            [void][WinSnipNative]::DispatchMessage([ref]$message)
        } catch { }
    }
}

$registered = $false
try {
    $registered = [WinSnipNative]::RegisterHotKey([IntPtr]::Zero, $hotkeyId, [uint32]$Modifiers, [uint32]$VirtualKey)
} catch {
    $registered = $false
}
if ($registered) {
    Write-SnipLog ('已注册全局热键：' + $HotkeyLabel)
}

# 主力通道：低级键盘钩子。
# 只要机器上别的程序（游戏客户端、录屏、远控）装了键盘钩子，RegisterHotKey 就会
# "注册成功但收不到按键"——那些钩子把按键提前消费了。钩子链上后装的先执行，
# 所以我们装的这个能先拿到按键，作为主通道；RegisterHotKey 保留为兜底。
$hookInstalled = $false
try {
    [WinSnipHook]::Configure([uint32]$Modifiers, [uint32]$VirtualKey)
    $hookInstalled = [WinSnipHook]::Install()
} catch {
    $hookInstalled = $false
}
if ($hookInstalled) {
    Write-SnipLog ('已安装键盘钩子：' + $HotkeyLabel)
} elseif (-not $registered) {
    $global:SnipStats.Error = '热键不可用（热键与键盘钩子都失败）：' + $HotkeyLabel
    Write-SnipLog $global:SnipStats.Error
} else {
    Write-SnipLog '键盘钩子安装失败，仅依赖系统热键（可能被其它软件拦截）。'
}
Update-SnipHeartbeat

# 剪贴板采集：主循环之前先起一次，用户"刚复制完就按热键"时历史里已经有这条。
if ($ClipboardEnabled -ne '0') {
    try { Initialize-SnipClipboardWatcher -Days $ClipboardDays -Enabled $true }
    catch { Write-SnipLog ('剪贴板采集初始化失败：' + $_.Exception.Message) }
} else {
    Write-SnipLog '剪贴板采集已关闭（历史面板仍可查看既有记录）'
}

$lastBeat = Get-Date
try {
    while ($true) {
        # 只用 PeekMessage 自己泵消息，绝不调用 Application::DoEvents。
        # 硬教训（2026-10-18）：DoEvents 会把线程消息队列里的消息全部取出，
        # 而 WM_HOTKEY 没有对应窗口过程 → 被它静默丢弃，
        # 表现为「热键注册成功、进程也在跑，但按了永远没反应」。
        # 键盘钩子的回调也依赖本线程泵消息，所以这里必须持续排空队列。
        try { Flush-SnipMessageQueue } catch { }

        $hits = Receive-SnipHotkeyHits
        $hookHit = $false
        if ($hookInstalled) {
            try { $hookHit = [WinSnipHook]::ConsumeHit() } catch { $hookHit = $false }
        }
        if ($hits -gt 0 -or $hookHit) {
            Write-SnipLog ('收到热键：' + $HotkeyLabel)
            # 先看有没有文字选区：有就翻译并结束，没有才走原来的选择框/截图。
            $handled = $false
            try { $handled = Invoke-SnipSelectionHotkey } catch { $handled = $false }
            if (-not $handled) {
                if ($script:SnipMenuMode) { Invoke-SnipMenu } else { Invoke-SnipCapture }
            }
            # 选择框/截图/翻译期间钩子与消息队列可能又累计了命中，丢弃掉，
            # 避免关掉窗口立刻又弹一次。
            if ($hookInstalled) { try { [void][WinSnipHook]::ConsumeHit() } catch { } }
            [void](Receive-SnipHotkeyHits)
        }

        Invoke-SnipCommands

        try { Update-SnipClipboardWatcher } catch { }

        if (((Get-Date) - $lastBeat).TotalSeconds -ge 5) {
            Update-SnipHeartbeat
            $lastBeat = Get-Date
        }

        Start-Sleep -Milliseconds 30
    }
} finally {
    if ($hookInstalled) { try { [WinSnipHook]::Uninstall() } catch { } }
    if ($registered) { try { [void][WinSnipNative]::UnregisterHotKey([IntPtr]::Zero, $hotkeyId) } catch { } }
    Write-SnipLog '截图助手已退出。'
    try { Remove-Item (Join-Path $global:SnipStats.BaseDir 'status.json') -Force -ErrorAction SilentlyContinue } catch { }
}
