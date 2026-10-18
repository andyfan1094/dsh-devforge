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

$registered = $false
try {
    $registered = [WinSnipNative]::RegisterHotKey([IntPtr]::Zero, $hotkeyId, [uint32]$Modifiers, [uint32]$VirtualKey)
} catch {
    $registered = $false
}
if (-not $registered) {
    $global:SnipStats.Error = '热键注册失败（可能已被其它软件占用）：' + $HotkeyLabel
    Write-SnipLog $global:SnipStats.Error
} else {
    Write-SnipLog ('已注册全局热键：' + $HotkeyLabel)
}
Update-SnipHeartbeat

$lastBeat = Get-Date
try {
    while ($true) {
        try { [System.Windows.Forms.Application]::DoEvents() } catch { }

        $hits = Receive-SnipHotkeyHits
        if ($hits -gt 0) { Invoke-SnipCapture }

        Invoke-SnipCommands

        if (((Get-Date) - $lastBeat).TotalSeconds -ge 5) {
            Update-SnipHeartbeat
            $lastBeat = Get-Date
        }

        Start-Sleep -Milliseconds 50
    }
} finally {
    if ($registered) { try { [void][WinSnipNative]::UnregisterHotKey([IntPtr]::Zero, $hotkeyId) } catch { } }
    Write-SnipLog '截图助手已退出。'
    try { Remove-Item (Join-Path $global:SnipStats.BaseDir 'status.json') -Force -ErrorAction SilentlyContinue } catch { }
}
