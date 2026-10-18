# win-snip-result.ps1 —— 识别 / 翻译结果窗
#
# 设计目标（辉哥反馈"界面很丑"后重做）：
# - 深色卡片 + 圆角 + 1px 描边，标题区 / 正文区 / 操作区分层清楚；
# - 正文左内边距 10px、行距放宽，等宽字体保证缩进与表格列不被重排；
# - 页脚左侧标注"用了哪个模型、花了多久"，右侧主次按钮（复制=强调色，关闭=幽灵按钮）；
# - 全程无 emoji，图标用矢量绘制。

<#
.SYNOPSIS
    生成圆角矩形的 Region（WinForms 没有现成圆角属性）。
#>
function New-SnipRoundedRegion {
    param(
        [Parameter(Mandatory = $true)][System.Drawing.Rectangle]$Bounds,
        [int]$Radius = 10
    )
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $Radius * 2
    $path.AddArc($Bounds.X, $Bounds.Y, $d, $d, 180, 90)
    $path.AddArc($Bounds.Right - $d, $Bounds.Y, $d, $d, 270, 90)
    $path.AddArc($Bounds.Right - $d, $Bounds.Bottom - $d, $d, $d, 0, 90)
    $path.AddArc($Bounds.X, $Bounds.Bottom - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    $region = New-Object System.Drawing.Region($path)
    $path.Dispose()
    return $region
}

<#
.SYNOPSIS
    造一个扁平的深色按钮（主按钮用强调色填充，次按钮只用描边）。
#>
function New-SnipFlatButton {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][System.Drawing.Rectangle]$Bounds,
        [switch]$Accent
    )
    $button = New-Object System.Windows.Forms.Button
    $button.Text = $Text
    $button.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $button.FlatAppearance.BorderSize = if ($Accent) { 0 } else { 1 }
    $button.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(74, 74, 82)
    $button.FlatAppearance.MouseOverBackColor = if ($Accent) { [System.Drawing.Color]::FromArgb(62, 122, 255) } else { [System.Drawing.Color]::FromArgb(52, 52, 58) }
    $button.FlatAppearance.MouseDownBackColor = if ($Accent) { [System.Drawing.Color]::FromArgb(38, 92, 226) } else { [System.Drawing.Color]::FromArgb(60, 60, 66) }
    $button.BackColor = if ($Accent) { [System.Drawing.Color]::FromArgb(45, 107, 255) } else { [System.Drawing.Color]::FromArgb(40, 40, 45) }
    $button.ForeColor = [System.Drawing.Color]::FromArgb(240, 240, 244)
    $button.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)
    $button.Cursor = [System.Windows.Forms.Cursors]::Hand
    $button.UseVisualStyleBackColor = $false
    $button.SetBounds($Bounds.X, $Bounds.Y, $Bounds.Width, $Bounds.Height)
    return $button
}

<#
.SYNOPSIS
    显示识别或翻译结果。
.PARAMETER Title
    窗口标题（如「识别结果」「翻译结果」）。
.PARAMETER Text
    识别出的原文；可能为空（翻译失败仅返回译文时）。
.PARAMETER Translation
    译文；为空表示只展示原文。
.PARAMETER Model
    实际使用的模型名，显示在页脚，便于判断快慢与来源。
.PARAMETER ElapsedMs
    模型耗时（毫秒）。
#>
function Show-SnipResult {
    param(
        [Parameter(Mandatory = $true)][string]$Title,
        [string]$Text = '',
        [string]$Translation = '',
        [string]$Model = '',
        [int]$ElapsedMs = 0
    )
    $hasTranslation = $Translation -ne ''
    $hasText = $Text -ne ''
    if (-not $hasTranslation -and -not $hasText) { $Text = '（没有识别到文字）' ; $hasText = $true }

    # 按原排版显示：等宽字体 + 关闭自动换行，否则缩进和表格列宽会被"重排"掉。
    $allText = ($Text + "`n" + $Translation)
    $bodyFont = New-SnipMonoFont -Text $allText -Size 10.5
    $lineCount = ($allText -split "`r?`n").Count

    $form = New-SnipDarkForm
    $form.Text = $Title
    $form.KeyPreview = $true
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
    $form.BackColor = [System.Drawing.Color]::FromArgb(30, 30, 33)

    # 宽度跟着最长的行走：短内容不浪费屏，宽表格也不至于一开就要拖滚动条。
    $longest = 0
    foreach ($line in ($allText -split "`r?`n")) {
        if ($line.Length -gt $longest) { $longest = $line.Length }
    }
    $measured = 0
    try { $measured = [System.Windows.Forms.TextRenderer]::MeasureText(('M' * [Math]::Min($longest, 220)), $bodyFont).Width } catch { $measured = 0 }
    if ($measured -le 0) { $measured = [Math]::Min($longest, 120) * 8 }
    $work = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position).WorkingArea

    $form.Width = [int][Math]::Max(620, [Math]::Min(1180, $measured + 72))
    $form.Width = [int][Math]::Min($form.Width, $work.Width - 80)

    $headerHeight = 52
    $footerHeight = 56
    $captionHeight = if ($hasTranslation -and $hasText) { 20 } else { 0 }
    $bodyTop = $headerHeight + 12
    $boxHeight = if ($hasTranslation -and $hasText) { 168 } else { [int][Math]::Max(180, [Math]::Min(420, $lineCount * 19 + 34)) }
    $bodyHeight = if ($hasTranslation -and $hasText) {
        ($captionHeight + $boxHeight) * 2 + 30
    } else {
        $captionHeight + $boxHeight
    }
    $form.Height = [int][Math]::Min($bodyTop + $bodyHeight + $footerHeight + 16, $work.Height - 80)

    $form.Location = New-Object System.Drawing.Point(
        ($work.X + [int](($work.Width - $form.Width) / 2)),
        ($work.Y + [int](($work.Height - $form.Height) / 3))
    )

    # 圆角 + 1px 描边 + 顶部一条强调色细线，避免"一块糊死的深色矩形"。
    $form.Add_Paint({
            param($sender, $e)
            $e.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
            $rect = New-Object System.Drawing.Rectangle(0, 0, ($sender.Width - 1), ($sender.Height - 1))
            $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(62, 62, 70), 1)
            try { $e.Graphics.DrawRectangle($pen, $rect) } finally { $pen.Dispose() }
            $accent = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(45, 107, 255), 2)
            try { $e.Graphics.DrawLine($accent, 12, 1, ($sender.Width - 13), 1) } finally { $accent.Dispose() }
        })
    $form.Add_Resize({
            param($sender, $e)
            try { $sender.Region = New-SnipRoundedRegion -Bounds (New-Object System.Drawing.Rectangle(0, 0, $sender.Width, $sender.Height)) -Radius 10 } catch { }
        })
    $form.Add_Shown({
            param($sender, $e)
            try { $sender.Region = New-SnipRoundedRegion -Bounds (New-Object System.Drawing.Rectangle(0, 0, $sender.Width, $sender.Height)) -Radius 10 } catch { }
            $sender.Activate()
        })

    # 整窗可拖动（无边框窗必须自己实现，否则用户拖不动）。
    $form.Add_MouseDown({
            param($sender, $e)
            if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) { $sender.Tag = $e.Location }
        })
    $form.Add_MouseMove({
            param($sender, $e)
            if ($null -ne $sender.Tag -and $e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
                $origin = [System.Drawing.Point]$sender.Tag
                $sender.Location = New-Object System.Drawing.Point(
                    ($sender.Location.X + $e.Location.X - $origin.X),
                    ($sender.Location.Y + $e.Location.Y - $origin.Y))
            }
        })
    $form.Add_MouseUp({ param($sender, $e) $sender.Tag = $null })

    # ---- 标题区 ----
    $titleLabel = New-Object System.Windows.Forms.Label
    $titleLabel.Text = $Title
    $titleLabel.BackColor = [System.Drawing.Color]::Transparent
    $titleLabel.ForeColor = [System.Drawing.Color]::FromArgb(240, 240, 244)
    $titleLabel.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 11, [System.Drawing.FontStyle]::Bold)
    $titleLabel.SetBounds(20, 11, ($form.Width - 90), 24)
    $form.Controls.Add($titleLabel)

    # 副标题：模型与耗时。辉哥问过"用的什么模型"，这里直接标出来。
    $subtitleParts = @()
    if ($Model -ne '') { $subtitleParts += $Model }
    if ($ElapsedMs -gt 0) { $subtitleParts += ('耗时 ' + [math]::Round($ElapsedMs / 1000, 1) + ' 秒') }
    $subtitleParts += ($lineCount.ToString() + ' 行')
    $subtitle = New-Object System.Windows.Forms.Label
    $subtitle.Text = ($subtitleParts -join ' · ')
    $subtitle.BackColor = [System.Drawing.Color]::Transparent
    $subtitle.ForeColor = [System.Drawing.Color]::FromArgb(132, 136, 146)
    $subtitle.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 8.5)
    $subtitle.SetBounds(21, 33, ($form.Width - 96), 16)
    $form.Controls.Add($subtitle)

    # 关闭按钮：矢量叉号，悬停变亮（不用 emoji）。
    $closeLabel = New-Object System.Windows.Forms.Label
    $closeLabel.Text = ''
    $closeLabel.BackColor = [System.Drawing.Color]::Transparent
    $closeLabel.SetBounds(($form.Width - 44), 12, 32, 32)
    $closeLabel.Cursor = [System.Windows.Forms.Cursors]::Hand
    $closeLabel.Add_Paint({
            param($sender, $e)
            $e.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
            $color = if ($sender.Tag -eq 'hot') { [System.Drawing.Color]::FromArgb(255, 255, 255) } else { [System.Drawing.Color]::FromArgb(168, 172, 182) }
            $pen = New-Object System.Drawing.Pen($color, 1.6)
            try {
                $e.Graphics.DrawLine($pen, 11, 11, 21, 21)
                $e.Graphics.DrawLine($pen, 21, 11, 11, 21)
            } finally { $pen.Dispose() }
        })
    $closeLabel.Add_MouseEnter({ param($sender, $e) $sender.Tag = 'hot'; $sender.Invalidate() })
    $closeLabel.Add_MouseLeave({ param($sender, $e) $sender.Tag = ''; $sender.Invalidate() })
    $closeLabel.Add_Click({ param($sender, $e) $form.Close() })
    $form.Controls.Add($closeLabel)

    # 标题区与正文区之间的分隔线。
    $divider = New-Object System.Windows.Forms.Panel
    $divider.BackColor = [System.Drawing.Color]::FromArgb(52, 52, 59)
    $divider.SetBounds(1, ($headerHeight - 1), ($form.Width - 2), 1)
    $form.Controls.Add($divider)

    # ---- 正文区 ----
    <#
        用"外层 Panel + 内层 TextBox"做出内边距：
        TextBox 自己不支持 Padding，直接贴边会显得非常挤。
    #>
    $addBody = {
        param([string]$Caption, [string]$Content, [int]$Top, [int]$Height)
        $captionLabel = New-Object System.Windows.Forms.Label
        $captionLabel.Text = $Caption
        $captionLabel.BackColor = [System.Drawing.Color]::Transparent
        $captionLabel.ForeColor = [System.Drawing.Color]::FromArgb(140, 144, 154)
        $captionLabel.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 8.5)
        $captionLabel.SetBounds(22, $Top, 200, 16)
        $form.Controls.Add($captionLabel)

        $panel = New-Object System.Windows.Forms.Panel
        $panel.BackColor = [System.Drawing.Color]::FromArgb(23, 23, 26)
        $panel.SetBounds(20, ($Top + 20), ($form.Width - 40), $Height)
        $panel.Add_Paint({
                param($sender, $e)
                $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(46, 46, 53), 1)
                try { $e.Graphics.DrawRectangle($pen, 0, 0, ($sender.Width - 1), ($sender.Height - 1)) } finally { $pen.Dispose() }
            })
        $form.Controls.Add($panel)

        $box = New-Object System.Windows.Forms.TextBox
        $box.Multiline = $true
        # 关掉自动换行：换行会破坏原排版，长行改用横向滚动条。
        $box.WordWrap = $false
        $box.ScrollBars = [System.Windows.Forms.ScrollBars]::Both
        $box.ReadOnly = $true
        $box.BorderStyle = [System.Windows.Forms.BorderStyle]::None
        $box.BackColor = [System.Drawing.Color]::FromArgb(23, 23, 26)
        $box.ForeColor = [System.Drawing.Color]::FromArgb(228, 230, 236)
        $box.Font = $bodyFont
        $box.Text = $Content
        $box.SetBounds(10, 8, ($panel.Width - 20), ($panel.Height - 16))
        $panel.Controls.Add($box)
        return $box
    }

    $y = $bodyTop
    if ($hasText) {
        $caption = if ($hasTranslation) { '原文' } else { '识别文字' }
        $box = & $addBody $caption $Text $y $(if ($hasTranslation) { $boxHeight - $captionHeight } else { $boxHeight })
        $y += $boxHeight + 12
    }
    if ($hasTranslation) {
        $box2 = & $addBody '译文' $Translation $y $(if ($hasText) { $boxHeight - $captionHeight } else { $boxHeight })
        $y += $boxHeight + 12
    }

    # ---- 页脚 ----
    $footerTop = $form.Height - $footerHeight
    $footerLine = New-Object System.Windows.Forms.Panel
    $footerLine.BackColor = [System.Drawing.Color]::FromArgb(52, 52, 59)
    $footerLine.SetBounds(1, ($footerTop - 1), ($form.Width - 2), 1)
    $form.Controls.Add($footerLine)

    $copyText = if ($hasTranslation) { $Translation } elseif ($hasText) { $Text } else { '' }
    $hint = New-Object System.Windows.Forms.Label
    $hint.Text = 'Esc 关闭 · Ctrl+C 复制'
    $hint.BackColor = [System.Drawing.Color]::Transparent
    $hint.ForeColor = [System.Drawing.Color]::FromArgb(108, 112, 122)
    $hint.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 8.5)
    $hint.SetBounds(22, ($footerTop + 20), 260, 18)
    $form.Controls.Add($hint)

    $buttonY = $footerTop + 13
    $closeButton = New-SnipFlatButton -Text '关闭' -Bounds (New-Object System.Drawing.Rectangle(($form.Width - 96), $buttonY, 76, 30))
    $closeButton.Add_Click({ param($sender, $e) $form.Close() })
    $form.Controls.Add($closeButton)

    $copyButton = New-SnipFlatButton -Text '复制' -Bounds (New-Object System.Drawing.Rectangle(($form.Width - 180), $buttonY, 76, 30))
    $copyButton.Add_Click({
            param($sender, $e)
            try {
                [System.Windows.Forms.Clipboard]::SetText($copyText)
                $sender.Text = '已复制'
                $timer = New-Object System.Windows.Forms.Timer
                $timer.Interval = 1200
                $timer.Add_Tick({
                        param($t, $a)
                        $t.Stop()
                        $copyButton.Text = '复制'
                        $t.Dispose()
                    })
                $timer.Start()
            } catch {
                [System.Windows.Forms.MessageBox]::Show('复制失败：' + $_.Exception.Message, '截图小工具') | Out-Null
            }
        })
    $form.Controls.Add($copyButton)

    $form.Add_KeyDown({
            param($sender, $e)
            if ($e.KeyCode -eq [System.Windows.Forms.Keys]::Escape) { $sender.Close() }
            if ($e.Control -and $e.KeyCode -eq [System.Windows.Forms.Keys]::C) {
                try { [System.Windows.Forms.Clipboard]::SetText($copyText) } catch { }
            }
            if ($e.Control -and $e.KeyCode -eq [System.Windows.Forms.Keys]::Enter) { $form.Close() }
        })

    $form.ShowDialog() | Out-Null
    try { $bodyFont.Dispose() } catch { }
    $form.Dispose()
}
