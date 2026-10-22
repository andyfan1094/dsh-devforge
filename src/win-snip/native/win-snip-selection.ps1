# win-snip-selection.ps1 —— 选中文字直接翻译（2026-10-22 辉哥需求）
#
# 交互：鼠标拉选一段文字 → 按热键（默认 Alt+A）→ 直接翻译选区并弹出结果窗；
#       没有选区时才回到原来的「功能选择框 / 截图」路径。
#
# 选区怎么读（两级，先便宜后兜底）：
#   1) UI Automation：读前台窗口焦点元素的 TextPattern 选区。浏览器 / Office / 多数编辑器支持，
#      不改动剪贴板、无副作用，毫秒级返回；
#   2) Ctrl+C 兜底（可选）：微信、终端、部分 Electron 应用不给 UIA 选区，只能模拟一次 Ctrl+C
#      把选中文字送进剪贴板。代价是会临时改写剪贴板，所以取完立刻把原内容写回去；
#      资源管理器里选中文件时 Ctrl+C 复制的是文件，这类窗口直接跳过（见 Test-SnipSelectionCopySafe）。
#
# 为什么不在主循环里同步干等：翻译要几秒，期间必须继续泵消息（进度窗要重绘、
# 键盘钩子回调要靠消息循环），但又不能让 WM_HOTKEY 被消费掉（硬教训见 win-snip-assistant.ps1）。
# 所以用助手主循环同款的"跳过 WM_HOTKEY"的泵，热键消息留在队列里，事后统一丢弃。

<#
.SYNOPSIS
    编译并加载选区底座类型（SnipSelection）。
#>
function Initialize-SnipSelectionType {
    $loaded = [AppDomain]::CurrentDomain.GetAssemblies() |
        ForEach-Object { $_.GetType('SnipSelection', $false) } |
        Where-Object { $null -ne $_ } | Select-Object -First 1
    if ($null -ne $loaded) { return $true }
    $sourcePath = Join-Path $PSScriptRoot 'win-snip-selection.cs'
    if (-not (Test-Path $sourcePath)) { return $false }
    try {
        Add-Type -TypeDefinition ([System.IO.File]::ReadAllText($sourcePath, [System.Text.Encoding]::UTF8)) `
            -ReferencedAssemblies System.Drawing, System.Windows.Forms
        return $true
    } catch {
        Write-SnipLog ('选区底座编译失败：' + $_.Exception.Message)
        return $false
    }
}

<#
.SYNOPSIS
    加载 UI Automation 客户端（只加载一次，失败后不再重试）。
#>
function Initialize-SnipSelectionUia {
    if ($null -ne $script:SnipSelectionUiaReady) { return $script:SnipSelectionUiaReady }
    try {
        Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop
        Add-Type -AssemblyName UIAutomationTypes -ErrorAction Stop
        $script:SnipSelectionUiaReady = $true
    } catch {
        $script:SnipSelectionUiaReady = $false
        # 不抛：UIA 不可用时还有 Ctrl+C 兜底，功能整体不该因此不可用。
        Write-SnipLog ('UI Automation 不可用（选区只能靠 Ctrl+C 兜底）：' + $_.Exception.Message)
    }
    return $script:SnipSelectionUiaReady
}

<#
.SYNOPSIS
    清洗选区文本：统一换行、去首尾空白、超长截断。
.DESCRIPTION
    UIA 偶尔返回只有换行的退化 range，Ctrl+C 也可能拿到带尾随空行的一段，
    这些都当作"没有选区"，否则热键会被一次空翻译吃掉。
#>
function Get-SnipSelectionCleanText {
    param([string]$Text)
    if ([string]::IsNullOrEmpty($Text)) { return '' }
    $clean = ($Text -replace "`r`n", "`n" -replace "`r", "`n").Trim()
    if ($clean -eq '') { return '' }
    # 与宿主侧 WIN_SNIP_TEXT_LIMIT 对齐：再长就不是"选中一段"而是整篇文档了。
    if ($clean.Length -gt 12000) { $clean = $clean.Substring(0, 12000) }
    return $clean
}

<#
.SYNOPSIS
    用 UI Automation 读前台窗口的文字选区。
.OUTPUTS
    选中文字；没有选区、或当前控件不支持 TextPattern 时返回空串。
#>
function Get-SnipSelectedTextUia {
    if (-not (Initialize-SnipSelectionUia)) { return '' }
    try {
        $element = [System.Windows.Automation.AutomationElement]::FocusedElement
        # 焦点常常落在内层控件（编辑框、文档正文）上，从它往上找几层容器才有 TextPattern。
        for ($depth = 0; $depth -lt 6 -and $null -ne $element; $depth++) {
            $patternObject = $null
            $hasPattern = $false
            try {
                $hasPattern = $element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$patternObject)
            } catch {
                $hasPattern = $false
            }
            if ($hasPattern) {
                $pattern = [System.Windows.Automation.TextPattern]$patternObject
                $builder = New-Object System.Text.StringBuilder
                try {
                    foreach ($range in $pattern.GetSelection()) {
                        try {
                            $chunk = $range.GetText(-1)
                            if (-not [string]::IsNullOrEmpty($chunk)) { [void]$builder.Append($chunk) }
                        } catch { }
                    }
                } catch { }
                # 找到 TextPattern 就不再往上找：父容器的选区不是用户这次选中的内容。
                return Get-SnipSelectionCleanText -Text $builder.ToString()
            }
            try {
                $element = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($element)
            } catch {
                $element = $null
            }
        }
    } catch {
        return ''
    }
    return ''
}

<#
.SYNOPSIS
    判断"在这个窗口里补一次 Ctrl+C"是否安全。
.DESCRIPTION
    资源管理器 / 桌面里 Ctrl+C 复制的是文件或图标，不是文字——那会把用户的剪贴板
    换成一批文件，属于副作用。这几类窗口直接放弃兜底，交给原行为（选择框/截图）。
#>
function Test-SnipSelectionCopySafe {
    try {
        $class = [SnipSelection]::ForegroundClass()
        if ([string]::IsNullOrEmpty($class)) { return $false }
        $blocked = @('CabinetWClass', 'ExploreWClass', 'Progman', 'WorkerW', 'Shell_TrayWnd', 'SysListView32', 'DirectUIHWND')
        if ($blocked -contains $class) { return $false }
        return $true
    } catch {
        return $false
    }
}

<#
.SYNOPSIS
    用模拟 Ctrl+C 读选区（微信 / 终端这类没有 UIA 选区的窗口）。
.DESCRIPTION
    先记下剪贴板序列号与原文本：序列号不变说明根本没有复制发生（没有选区），
    此时剪贴板没被改过，直接返回空；拿到文字后把原来的文本写回去，
    让用户的剪贴板尽量保持原样。
.PARAMETER TimeoutMs
    等待目标程序处理 Ctrl+C 的时长上限（毫秒）。
.OUTPUTS
    选中文字；没有选区时返回空串。
#>
function Get-SnipSelectedTextCopy {
    param([int]$TimeoutMs = 800)
    if (-not $script:SnipSelectionTypeReady) { return '' }
    if (-not $script:SnipClipboardReadReady) {
        $init = Get-Command -Name 'Initialize-SnipClipboardReadType' -ErrorAction SilentlyContinue
        if ($null -ne $init) {
            $script:SnipClipboardReadReady = & $init
            if (-not $script:SnipClipboardReadReady) { return '' }
        } else {
            return ''
        }
    }
    if (-not (Test-SnipSelectionCopySafe)) {
        Write-SnipLog ('跳过快照兜底：前台窗口类名=' + [SnipSelection]::ForegroundClass())
        return ''
    }

    $before = [SnipClipboardRead]::SequenceNumber()
    $hasText = $false
    $backup = $null
    try {
        $hasText = [SnipClipboardRead]::HasText()
        if ($hasText) { $backup = [SnipClipboardRead]::ReadText() }
    } catch {
        $backup = $null
    }

    try { [void][SnipSelection]::SendCopy() } catch { return '' }

    # 目标程序要在自己的消息循环里处理 WM_COPY：给到 800ms，一般 40~150ms 就有结果。
    $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
    $sequence = $before
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 40
        try { $sequence = [SnipClipboardRead]::SequenceNumber() } catch { $sequence = $before }
        if ($sequence -ne $before) { break }
    }
    if ($sequence -eq $before) { return '' }

    $text = ''
    try {
        if ([SnipClipboardRead]::HasText()) { $text = [SnipClipboardRead]::ReadText() }
    } catch {
        $text = ''
    }

    # 还原用户原来的剪贴板：只还原文本。原来若是图片/文件，这里还原不了
    # （那种情况本身也已经被这次复制覆盖了），保持"和手动复制一次"同样的结果。
    if ($hasText -and -not [string]::IsNullOrEmpty($backup) -and $backup -ne $text) {
        try {
            $errorText = ''
            [void][SnipClipboardRead]::WriteText($backup, [ref]$errorText)
        } catch { }
    }
    # 这次"复制 + 还原"都是工具自己的动作：把采集器的序列号对齐到当前值，
    # 免得翻译结束后它把这份内容记成一条"用户刚复制的东西"塞进历史。
    try {
        if ($null -ne $script:SnipClipboardState) {
            $script:SnipClipboardState.LastSequence = [SnipClipboardRead]::SequenceNumber()
        }
    } catch { }
    return Get-SnipSelectionCleanText -Text $text
}

<#
.SYNOPSIS
    读当前窗口的文字选区：UIA 优先，允许时用 Ctrl+C 兜底。
.PARAMETER AllowCopy
    是否允许 Ctrl+C 兜底（对应面板的第二个开关）。
.OUTPUTS
    选中文字；没有选区时返回空串（调用方据此走原来的截图/选择框）。
#>
function Get-SnipSelectedTextAuto {
    param([bool]$AllowCopy = $true)
    $text = Get-SnipSelectedTextUia
    if ($text -ne '') { return $text }
    if (-not $AllowCopy) { return '' }
    return Get-SnipSelectedTextCopy
}

<#
.SYNOPSIS
    翻译等待期的进度窗：一个小深色卡片，告诉用户"已经在干活了"。
#>
function New-SnipSelectionProgressForm {
    $form = New-SnipDarkForm
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
    $form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
    $form.TopMost = $true
    $form.ShowInTaskbar = $false
    $form.BackColor = Get-SnipTheme 'Surface'
    $form.Size = New-Object System.Drawing.Size(336, 112)

    $title = New-Object System.Windows.Forms.Label
    $title.Text = '正在翻译选中的文字…'
    $title.AutoSize = $false
    $title.SetBounds(20, 22, 296, 24)
    $title.Font = New-SnipUiFont -Size 10.5 -Style Bold
    $title.ForeColor = Get-SnipTheme 'Text'
    $title.BackColor = [System.Drawing.Color]::Transparent

    $hint = New-Object System.Windows.Forms.Label
    $hint.Text = '模型返回后会自动弹出译文 · Esc 可取消等待'
    $hint.AutoSize = $false
    $hint.SetBounds(20, 52, 296, 20)
    $hint.Font = New-SnipTextFont -Size 8.5
    $hint.ForeColor = Get-SnipTheme 'Text2'
    $hint.BackColor = [System.Drawing.Color]::Transparent

    $form.Controls.Add($title)
    $form.Controls.Add($hint)

    $script:SnipSelectionCancel = $false
    $form.Add_KeyDown({
            param($sender, $e)
            if ($e.KeyCode -eq [System.Windows.Forms.Keys]::Escape) {
                $script:SnipSelectionCancel = $true
                $e.Handled = $true
            }
        })
    $form.Add_Shown({
            try {
                $rounded = Get-Command -Name 'Set-SnipRoundedRegion' -ErrorAction SilentlyContinue
                if ($null -ne $rounded) { & $rounded -Form $form -Radius 12 }
            } catch { }
            $form.Activate()
        })
    return $form
}

<#
.SYNOPSIS
    翻译期间泵一次窗口消息。
.DESCRIPTION
    优先复用助手主循环里的 Flush-SnipMessageQueue：它显式跳过 WM_HOTKEY，
    热键消息留在队列里，等这次翻译结束再统一丢弃，不会"关掉结果窗又弹一张截图"。
#>
function Invoke-SnipSelectionPump {
    $flush = Get-Command -Name 'Flush-SnipMessageQueue' -ErrorAction SilentlyContinue
    if ($null -ne $flush) {
        try { & $flush; return } catch { }
    }
    [System.Windows.Forms.Application]::DoEvents()
}

<#
.SYNOPSIS
    翻译一段选中文字并显示结果窗。
.DESCRIPTION
    流程：提交文本翻译请求 → 显示进度窗并轮询宿主响应 → 关闭进度窗 → 弹结果窗（原文 / 译文）。
    失败与超时都落在结果窗里说清楚，不弹 .NET 错误框。
.PARAMETER Text
    选中的文字（已由 Get-SnipSelectedTextAuto 清洗）。
.PARAMETER TargetLang
    翻译目标语言；留空表示由宿主按面板配置决定。
#>
function Invoke-SnipSelectionTranslate {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [string]$TargetLang = ''
    )

    $request = New-SnipTextVisionRequest -Text $Text -TargetLang $TargetLang
    if (-not $request.ok) {
        [System.Windows.Forms.MessageBox]::Show([string]$request.error, '选区翻译') | Out-Null
        return
    }

    $progress = $null
    $response = $null
    try {
        $progress = New-SnipSelectionProgressForm
        $progress.Show()
        # 与宿主侧 TIMEOUT_MS(120s) 留一点余量：宁可我们先放弃等待，也不让窗口永远转下去。
        $deadline = (Get-Date).AddSeconds(125)
        while ($null -eq $response -and -not $script:SnipSelectionCancel -and (Get-Date) -lt $deadline) {
            Invoke-SnipSelectionPump
            Start-Sleep -Milliseconds 50
            $response = Read-SnipVisionResponse -Path $request.responsePath
        }
    } catch {
        Write-SnipLog ('选区翻译等待失败：' + $_.Exception.Message)
    } finally {
        if ($null -ne $progress) {
            try { $progress.Close() } catch { }
            try { $progress.Dispose() } catch { }
        }
    }

    if ($script:SnipSelectionCancel -and $null -eq $response) {
        Write-SnipLog '选区翻译已取消（用户按了 Esc）'
        return
    }
    if ($null -eq $response) {
        Show-SnipResult -Title '选区翻译' -Text $Text -Translation '（超时：模型 120 秒内没有返回，请稍后再试）'
        return
    }
    if ([bool]$response.ok -ne $true) {
        Show-SnipResult -Title '选区翻译' -Text $Text -Translation ('翻译失败：' + [string]$response.error)
        return
    }
    $model = [string]$response.model
    $elapsed = 0
    try { $elapsed = [int]$response.elapsedMs } catch { $elapsed = 0 }
    Write-SnipLog ('选区翻译完成：模型=' + $model + ' 耗时=' + $elapsed + 'ms 字数=' + $Text.Length)
    Show-SnipResult -Title '选区翻译' -Text $Text -Translation ([string]$response.translation) -Model $model -ElapsedMs $elapsed
}

$script:SnipSelectionUiaReady = $null
$script:SnipSelectionCancel = $false
$script:SnipSelectionTypeReady = Initialize-SnipSelectionType
if (-not $script:SnipSelectionTypeReady) {
    Write-SnipLog '选区底座不可用：选区翻译将退化为只用 UIA（读取失败即按无选区处理）'
}
