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
    [string]$CopyOnFinish = '1'
)

$ErrorActionPreference = 'Continue'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptDir 'win-snip-common.ps1')

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

$copyToClipboard = ($CopyOnFinish -ne '0')
$hotkeyId = 1
$script:LastCaptureAt = [DateTime]::MinValue

# 先装异常兜底：之后任何回调出问题都只记日志，不再弹 .NET 崩溃框并结束进程。
Enable-SnipCrashGuard

# 单实例约束：宿主重启会留下孤儿助手，两个助手会同时响应同一个热键（弹两个遮罩）。
# 这里把自己之外的同类进程结束掉；按脚本名精确匹配，且排除当前进程。
try {
    $siblings = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine -like '*win-snip-assistant.ps1*' }
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
    处理宿主写入的立即截图命令（面板「立即截一张」/ 自检用）。
#>
function Invoke-SnipCommands {
    $dir = Join-Path $global:SnipStats.BaseDir 'commands'
    if (-not (Test-Path $dir)) { return }
    $files = @(Get-ChildItem -Path $dir -Filter '*.json' -File -ErrorAction SilentlyContinue)
    if ($files.Count -eq 0) { return }
    foreach ($file in $files) {
        # 先删再执行：命令是"一次性"的，绝不能因为异常反复触发。
        try { Remove-Item $file.FullName -Force -ErrorAction SilentlyContinue } catch { }
    }
    Invoke-SnipCapture
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
            Invoke-SnipCapture
            # 截图期间钩子可能又累计了命中，丢弃掉，避免关掉编辑器立刻又弹一次。
            if ($hookInstalled) { try { [void][WinSnipHook]::ConsumeHit() } catch { } }
        }

        Invoke-SnipCommands

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
