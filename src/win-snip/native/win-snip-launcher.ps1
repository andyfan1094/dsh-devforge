# win-snip-launcher.ps1 —— 热键后的功能选择框
#
# 交互（2026-10-19 引入）：
#   按热键 → 光标旁弹出选择框 → 数字键 1/2（或点卡片、↑↓ + Enter）选「截图 / 剪贴板」→ Esc 取消。
#   点窗口外 = 失焦自动关闭（和系统快捷面板的手感一致）。
#
# 为什么用模态 ShowDialog：
#   选择框生命周期只有几秒，模态能让主循环里的热键消息在关闭后统一丢弃，
#   不会出现「关掉选择框又立刻弹出截图遮罩」的重入。
#   剪贴板历史面板同理，但它内部自带定时器继续采集，所以不会漏记内容。

<#
.SYNOPSIS
    编译并加载功能选择卡片控件（SnipChoiceCard）。
#>
function Initialize-SnipChoiceType {
    $existing = [AppDomain]::CurrentDomain.GetAssemblies() |
        ForEach-Object { $_.GetType('SnipChoiceCard', $false) } |
        Where-Object { $null -ne $_ } |
        Select-Object -First 1
    if ($null -ne $existing) { return $true }
    $sourcePath = Join-Path $PSScriptRoot 'win-snip-choice.cs'
    if (-not (Test-Path $sourcePath)) {
        Write-SnipLog ('选择框控件源码缺失：' + $sourcePath)
        return $false
    }
    Add-Type -TypeDefinition ([System.IO.File]::ReadAllText($sourcePath, [System.Text.Encoding]::UTF8)) `
        -ReferencedAssemblies System.Windows.Forms, System.Drawing, System.Drawing.Primitives
    return $true
}

<#
.SYNOPSIS
    弹出功能选择框，返回 'capture' / 'clipboard' / $null（取消）。
.PARAMETER Days
    剪贴板历史保留天数，用于副标题文案。
#>
function Show-SnipLauncher {
    param([int]$Days = 15)

    if (-not (Initialize-SnipChoiceType)) { return $null }

    $script:SnipLauncherChoice = $null
    $script:SnipLauncherReady = $false
    # 选中后 Close() 会再触发一次 Deactivate；没有这个标记的话，Deactivate 会把刚选好的值清成 $null，
    # 表现就是提交后被当成取消（2026-10-19 实机反馈）。
    $script:SnipLauncherClosing = $false

    $form = New-SnipDarkForm
    $form.Text = '随手工具'
    $form.Width = 360
    $form.Height = 202
    $form.BackColor = (Get-SnipTheme 'Canvas')
    Set-SnipRoundedRegion -Form $form -Radius 12
    $form.KeyPreview = $true

    $title = New-Object System.Windows.Forms.Label
    $title.Text = '随手工具'
    $title.AutoSize = $false
    $title.Location = New-Object System.Drawing.Point(14, 12)
    $title.Size = New-Object System.Drawing.Size(220, 20)
    $title.ForeColor = (Get-SnipTheme 'Text2')
    $title.BackColor = (Get-SnipTheme 'Canvas')
    $title.Font = New-SnipUiFont -Size 9.5 -Style Bold
    $form.Controls.Add($title)

    $hint = New-Object System.Windows.Forms.Label
    $hint.Text = '↑↓ 选择 · Enter 确认 · Esc 取消'
    $hint.AutoSize = $false
    $hint.Location = New-Object System.Drawing.Point(14, 178)
    $hint.Size = New-Object System.Drawing.Size(332, 16)
    $hint.ForeColor = (Get-SnipTheme 'Muted')
    $hint.BackColor = (Get-SnipTheme 'Canvas')
    $hint.Font = New-SnipUiFont -Size 8
    $form.Controls.Add($hint)

    # 主题令牌集中注入：卡片控件的默认色只是兜底，实际观感由这里决定。
    $applyTheme = {
        param($Card)
        $Card.AccentColor = (Get-SnipTheme 'Accent')
        $Card.TextColor = (Get-SnipTheme 'Text')
        $Card.Text2Color = (Get-SnipTheme 'Text2')
        $Card.MutedColor = (Get-SnipTheme 'Muted')
        $Card.BorderColor = (Get-SnipTheme 'Hairline')
        $Card.CanvasColor = (Get-SnipTheme 'Canvas')
        $Card.RaisedColor = (Get-SnipTheme 'Raised')
        $Card.HoverFill = (Get-SnipTheme 'Raised')
        $Card.ActiveFill = [System.Drawing.Color]::FromArgb(24, 226, 164, 92)
    }

    $captureCard = New-Object SnipChoiceCard
    $captureCard.IconId = 'capture'
    $captureCard.Title = '截图'
    $captureCard.Detail = '框选 · 标注 · 识别与翻译'
    $captureCard.KeyHint = '1'
    $captureCard.Location = New-Object System.Drawing.Point(14, 40)
    $captureCard.Size = New-Object System.Drawing.Size(332, 62)
    & $applyTheme $captureCard
    $captureCard.Active = $true
    $form.Controls.Add($captureCard)

    $clipboardCard = New-Object SnipChoiceCard
    $clipboardCard.IconId = 'clipboard'
    $clipboardCard.Title = '剪贴板'
    $clipboardCard.Detail = '最近 ' + $Days + ' 天复制过的内容'
    $clipboardCard.KeyHint = '2'
    $clipboardCard.Location = New-Object System.Drawing.Point(14, 108)
    $clipboardCard.Size = New-Object System.Drawing.Size(332, 62)
    & $applyTheme $clipboardCard
    $form.Controls.Add($clipboardCard)

    $script:SnipLauncherActive = 0
    # 窗体与卡片一律挂脚本作用域：事件回调触发时函数局部变量可能已取不到
    # （2026-10-18 钉图窗踩过：局部 $state 在回调里取不到，直接把进程打崩）。
    $script:SnipLauncherForm = $form
    $script:SnipLauncherCards = @($captureCard, $clipboardCard)

    # 选中态用卡片自己画（强调色描边 + 淡底），不靠标签文字变化——一眼能看出当前会执行哪个。
    $applyActive = {
        $index = [int]$script:SnipLauncherActive
        $cards = $script:SnipLauncherCards
        if ($null -eq $cards -or $cards.Count -lt 2) { return }
        $cards[0].Active = ($index -eq 0)
        $cards[1].Active = ($index -eq 1)
    }

    $choose = {
        param([string]$Choice)
        # 参数声明成 [string] 后传 $null 会被转成空字符串，取消与"选中空项"就分不清了；
        # 这里显式还原 null，保证 Esc/失焦返回 $null（调用方据此不执行任何动作）。
        $script:SnipLauncherChoice = $(if ([string]::IsNullOrEmpty($Choice)) { $null } else { $Choice })
        $script:SnipLauncherClosing = $true
        $target = $script:SnipLauncherForm
        if ($null -ne $target) { $target.Close() }
    }

    $script:SnipLauncherApplyActive = $applyActive
    $script:SnipLauncherChoose = $choose

    $captureCard.Add_Click({ try { & $script:SnipLauncherChoose 'capture' } catch { } })
    $clipboardCard.Add_Click({ try { & $script:SnipLauncherChoose 'clipboard' } catch { } })

    $form.Add_KeyDown({
            param($sender, $e)
            try {
                $key = $e.KeyCode
                if ($key -eq [System.Windows.Forms.Keys]::Escape) { $script:SnipLauncherChoice = $null; & $script:SnipLauncherChoose $null; return }
                if ($key -eq [System.Windows.Forms.Keys]::D1 -or $key -eq [System.Windows.Forms.Keys]::NumPad1) { & $script:SnipLauncherChoose 'capture'; return }
                if ($key -eq [System.Windows.Forms.Keys]::D2 -or $key -eq [System.Windows.Forms.Keys]::NumPad2) { & $script:SnipLauncherChoose 'clipboard'; return }
                if ($key -eq [System.Windows.Forms.Keys]::Up -or $key -eq [System.Windows.Forms.Keys]::Down) {
                    $script:SnipLauncherActive = 1 - [int]$script:SnipLauncherActive
                    & $script:SnipLauncherApplyActive
                    return
                }
                if ($key -eq [System.Windows.Forms.Keys]::Enter) {
                    if ([int]$script:SnipLauncherActive -eq 0) { & $script:SnipLauncherChoose 'capture' } else { & $script:SnipLauncherChoose 'clipboard' }
                }
            } catch {
                Write-SnipLog ('选择框按键处理失败：' + $_.Exception.Message)
            }
        })

    # 失焦自动关闭：延迟 150ms 才 armed，避免个别机器上"刚显示就判定失焦"导致闪退。
    $script:SnipLauncherArmTimer = New-Object System.Windows.Forms.Timer
    $script:SnipLauncherArmTimer.Interval = 150
    $script:SnipLauncherArmTimer.Add_Tick({
            $script:SnipLauncherReady = $true
            $timer = $script:SnipLauncherArmTimer
            if ($null -ne $timer) { $timer.Stop(); $timer.Dispose(); $script:SnipLauncherArmTimer = $null }
        })
    $form.Add_Shown({
            try {
                [void]$script:SnipLauncherForm.Activate()
                if ($null -ne $script:SnipLauncherArmTimer) { $script:SnipLauncherArmTimer.Start() }
            } catch { }
        })
    $form.Add_Deactivate({
            if ($script:SnipLauncherReady -and -not $script:SnipLauncherClosing) {
                $script:SnipLauncherChoice = $null
                $target = $script:SnipLauncherForm
                if ($null -ne $target) { $target.Close() }
            }
        })

    # 位置：以鼠标当前位置为中心（辉哥 2026-10-19 定：不要侧边弹出），贴边时夹进工作区。
    $cursor = [System.Windows.Forms.Cursor]::Position
    $screen = [System.Windows.Forms.Screen]::FromPoint($cursor)
    $work = $screen.WorkingArea
    $x = $cursor.X - [int]($form.Width / 2)
    $y = $cursor.Y - [int]($form.Height / 2)
    if ($x + $form.Width -gt $work.Right) { $x = $work.Right - $form.Width - 8 }
    if ($y + $form.Height -gt $work.Bottom) { $y = $work.Bottom - $form.Height - 8 }
    if ($x -lt $work.Left) { $x = $work.Left + 8 }
    if ($y -lt $work.Top) { $y = $work.Top + 8 }
    $form.Location = New-Object System.Drawing.Point($x, $y)

    [void]$form.ShowDialog()
    $choice = $script:SnipLauncherChoice
    $form.Dispose()
    # 清掉脚本作用域引用：下一次弹出必须从干净状态开始，也避免窗体对象被脚本变量钉住。
    $script:SnipLauncherForm = $null
    $script:SnipLauncherCards = $null
    $script:SnipLauncherArmTimer = $null
    $script:SnipLauncherChoose = $null
    $script:SnipLauncherApplyActive = $null
    Write-SnipLog ('功能选择框结果：' + $(if ($null -eq $choice) { '取消' } else { [string]$choice }))
    return $choice
}
