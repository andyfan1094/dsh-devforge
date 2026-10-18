# win-snip-result.ps1 —— 识别 / 翻译结果窗
#
# 深色只读窗：原文与译文对照展示，支持一键复制、Esc 关闭。
# 文本保留换行，长文本可滚动。

<#
.SYNOPSIS
    显示识别或翻译结果。
.PARAMETER Title
    窗口标题（如「识别结果」「翻译结果」）。
.PARAMETER Text
    识别出的原文；可能为空（翻译失败仅返回译文时）。
.PARAMETER Translation
    译文；为空表示只展示原文。
#>
function Show-SnipResult {
    param(
        [Parameter(Mandatory = $true)][string]$Title,
        [string]$Text = '',
        [string]$Translation = ''
    )
    $hasTranslation = $Translation -ne ''
    $hasText = $Text -ne ''
    if (-not $hasTranslation -and -not $hasText) { $Text = '（没有识别到文字）' ; $hasText = $true }

    # 按原排版显示：用等宽字体 + 关闭自动换行，否则缩进和表格列宽会被"重排"掉。
    $allText = ($Text + "`n" + $Translation)
    $bodyFont = New-SnipMonoFont -Text $allText -Size 10

    $form = New-SnipDarkForm
    $form.Text = $Title
    $form.KeyPreview = $true
    # 宽度跟着最长的行走：短内容不浪费屏，宽表格也不至于一开就要拖滚动条。
    $longest = 0
    foreach ($line in ($allText -split "`r?`n")) {
        if ($line.Length -gt $longest) { $longest = $line.Length }
    }
    $measured = 0
    try { $measured = [System.Windows.Forms.TextRenderer]::MeasureText(('M' * [Math]::Min($longest, 200)), $bodyFont).Width } catch { $measured = 0 }
    if ($measured -le 0) { $measured = [Math]::Min($longest, 120) * 8 }
    $form.Width = [int][Math]::Max(560, [Math]::Min(1280, $measured + 72))
    $form.Height = if ($hasTranslation -and $hasText) { 460 } else { 340 }

    $work = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position).WorkingArea
    $form.Location = New-Object System.Drawing.Point(
        ($work.X + [int](($work.Width - $form.Width) / 2)),
        ($work.Y + [int](($work.Height - $form.Height) / 3))
    )

    $titleLabel = New-Object System.Windows.Forms.Label
    $titleLabel.Text = $Title
    $titleLabel.ForeColor = [System.Drawing.Color]::FromArgb(235, 235, 238)
    $titleLabel.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10, [System.Drawing.FontStyle]::Bold)
    $titleLabel.SetBounds(16, 10, ($form.Width - 80), 24)
    $form.Controls.Add($titleLabel)
    $form.Add_MouseDown({
            param($sender, $e)
            if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
                $sender.Capture = $false
                $sender.Tag = $e.Location
            }
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

    $closeLabel = New-Object System.Windows.Forms.Label
    $closeLabel.Text = '×'
    $closeLabel.ForeColor = [System.Drawing.Color]::FromArgb(180, 180, 186)
    $closeLabel.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 12)
    $closeLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
    $closeLabel.SetBounds(($form.Width - 40), 6, 28, 28)
    $closeLabel.Cursor = [System.Windows.Forms.Cursors]::Hand
    $closeLabel.Add_Click({ param($sender, $e) $form.Close() })
    $form.Controls.Add($closeLabel)

    $y = 40
    $boxHeight = if ($hasTranslation -and $hasText) { 150 } else { 210 }

    if ($hasText) {
        $caption = if ($hasTranslation) { '原文' } else { '识别文字' }
        $label = New-Object System.Windows.Forms.Label
        $label.Text = $caption
        $label.ForeColor = [System.Drawing.Color]::FromArgb(150, 150, 158)
        $label.SetBounds(16, $y, 200, 18)
        $form.Controls.Add($label)
        $y += 20

        $box = New-Object System.Windows.Forms.TextBox
        $box.Multiline = $true
        # 关掉自动换行：换行会破坏原排版，长行改用横向滚动条。
        $box.WordWrap = $false
        $box.ScrollBars = [System.Windows.Forms.ScrollBars]::Both
        $box.ReadOnly = $true
        $box.BorderStyle = [System.Windows.Forms.BorderStyle]::None
        $box.BackColor = [System.Drawing.Color]::FromArgb(24, 24, 26)
        $box.ForeColor = [System.Drawing.Color]::FromArgb(226, 226, 230)
        $box.Font = $bodyFont
        $box.Text = $Text
        $box.SetBounds(16, $y, ($form.Width - 32), $boxHeight)
        $form.Controls.Add($box)
        $y += $boxHeight + 12
    }

    if ($hasTranslation) {
        $label2 = New-Object System.Windows.Forms.Label
        $label2.Text = '译文'
        $label2.ForeColor = [System.Drawing.Color]::FromArgb(150, 150, 158)
        $label2.SetBounds(16, $y, 200, 18)
        $form.Controls.Add($label2)
        $y += 20

        $box2 = New-Object System.Windows.Forms.TextBox
        $box2.Multiline = $true
        # 关掉自动换行：换行会破坏原排版，长行改用横向滚动条。
        $box2.WordWrap = $false
        $box2.ScrollBars = [System.Windows.Forms.ScrollBars]::Both
        $box2.BorderStyle = [System.Windows.Forms.BorderStyle]::None
        $box2.BackColor = [System.Drawing.Color]::FromArgb(24, 24, 26)
        $box2.ForeColor = [System.Drawing.Color]::FromArgb(226, 226, 230)
        $box2.Font = $bodyFont
        $box2.Text = $Translation
        $box2.SetBounds(16, $y, ($form.Width - 32), $boxHeight)
        $form.Controls.Add($box2)
        $y += $boxHeight + 12
    }

    $copyText = if ($hasTranslation) { $Translation } elseif ($hasText) { $Text } else { '' }
    $copyButton = New-Object System.Windows.Forms.Button
    $copyButton.Text = '复制'
    $copyButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $copyButton.FlatAppearance.BorderSize = 0
    $copyButton.BackColor = [System.Drawing.Color]::FromArgb(58, 58, 64)
    $copyButton.ForeColor = [System.Drawing.Color]::FromArgb(235, 235, 238)
    $copyButton.SetBounds(($form.Width - 160), ($form.Height - 46), 68, 30)
    $copyButton.Add_Click({
            param($sender, $e)
            try {
                [System.Windows.Forms.Clipboard]::SetText($copyText)
                $sender.Text = '已复制'
                $timer = New-Object System.Windows.Forms.Timer
                $timer.Interval = 1200
                $timer.Add_Tick({ param($t, $a) $t.Stop(); $copyButton.Text = '复制'; $t.Dispose() })
                $timer.Start()
            } catch {
                [System.Windows.Forms.MessageBox]::Show('复制失败：' + $_.Exception.Message, '截图小工具') | Out-Null
            }
        })
    $form.Controls.Add($copyButton)

    $closeButton = New-Object System.Windows.Forms.Button
    $closeButton.Text = '关闭'
    $closeButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $closeButton.FlatAppearance.BorderSize = 0
    $closeButton.BackColor = [System.Drawing.Color]::FromArgb(45, 107, 255)
    $closeButton.ForeColor = [System.Drawing.Color]::White
    $closeButton.SetBounds(($form.Width - 84), ($form.Height - 46), 68, 30)
    $closeButton.Add_Click({ param($sender, $e) $form.Close() })
    $form.Controls.Add($closeButton)

    $form.Add_KeyDown({
            param($sender, $e)
            if ($e.KeyCode -eq [System.Windows.Forms.Keys]::Escape) { $sender.Close() }
            if ($e.Control -and $e.KeyCode -eq [System.Windows.Forms.Keys]::C) {
                try { [System.Windows.Forms.Clipboard]::SetText($copyText) } catch { }
            }
        })

    $form.Add_Shown({ param($sender, $e) $sender.Activate() })
    $form.ShowDialog() | Out-Null
    $form.Dispose()
}
