# win-snip-result.ps1 —— 识别 / 翻译结果窗
#
# 设计定位（Design Read）
#   深色工具型结果检视窗，面向重度桌面用户；
#   语言取向：Linear 式克制深色——单一强调色、1px 描边分层、不堆投影；
#   旋钮：VARIANCE 4 / MOTION 2 / DENSITY 6（密度偏高，要看排版；工具窗不做入场动画）。
#
# 三条硬规则
#   1. 窗口尺寸由内容算出来：多一行就高一行，少一行就矮一行，
#      不用"最小高度"把差别糊住（上一版的病根：MinimumSize 与卡片最小高把 4 行和 8 行都顶到 320）。
#   2. 颜色只从 $script:SnipTheme 取，不写死 RGB。
#   3. 正文等宽且不换行，缩进与表格列才不塌。

$script:SnipTheme = @{
    Window      = [System.Drawing.Color]::FromArgb(25, 27, 33)     # 窗口底
    Header      = [System.Drawing.Color]::FromArgb(32, 35, 43)     # 标题栏，亮一档
    Surface     = [System.Drawing.Color]::FromArgb(18, 20, 25)     # 内容面，暗一档（内凹）
    SurfaceLine = [System.Drawing.Color]::FromArgb(44, 48, 59)
    Hairline    = [System.Drawing.Color]::FromArgb(38, 41, 50)
    WindowLine  = [System.Drawing.Color]::FromArgb(58, 63, 76)
    TextPrimary = [System.Drawing.Color]::FromArgb(232, 235, 242)
    TextBody    = [System.Drawing.Color]::FromArgb(206, 211, 222)
    TextMuted   = [System.Drawing.Color]::FromArgb(151, 160, 180)
    TextFaint   = [System.Drawing.Color]::FromArgb(108, 116, 136)
    Accent      = [System.Drawing.Color]::FromArgb(48, 108, 232)
    AccentHover = [System.Drawing.Color]::FromArgb(63, 121, 242)
    AccentDown  = [System.Drawing.Color]::FromArgb(38, 92, 205)
    Ghost       = [System.Drawing.Color]::FromArgb(38, 42, 52)
    GhostHover  = [System.Drawing.Color]::FromArgb(48, 53, 65)
    GhostDown   = [System.Drawing.Color]::FromArgb(32, 36, 45)
    GhostLine   = [System.Drawing.Color]::FromArgb(58, 63, 76)
    Chip        = [System.Drawing.Color]::FromArgb(34, 38, 47)
    ChipLine    = [System.Drawing.Color]::FromArgb(52, 57, 69)
    ChipText    = [System.Drawing.Color]::FromArgb(176, 184, 200)
    Thumb       = [System.Drawing.Color]::FromArgb(78, 85, 101)
}

<#
.SYNOPSIS
    界面字体（必须含中文字形），逐级回落。
#>
function New-SnipUiFont {
    param([single]$Size = 9, [System.Drawing.FontStyle]$Style = [System.Drawing.FontStyle]::Regular)
    foreach ($name in @('Microsoft YaHei UI', 'Microsoft YaHei', 'Segoe UI', 'MS Gothic')) {
        try {
            $font = New-Object System.Drawing.Font($name, $Size, $Style)
            if ($font.Name -eq $name) { return $font }
            $font.Dispose()
        } catch { }
    }
    return New-Object System.Drawing.Font([System.Drawing.FontFamily]::GenericSansSerif, $Size, $Style)
}

<#
.SYNOPSIS
    圆角矩形路径。
#>
function New-SnipRoundPath {
    param([single]$X, [single]$Y, [single]$W, [single]$H, [single]$Radius = 8)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $Radius * 2
    if ($d -gt $W) { $d = $W }
    if ($d -gt $H) { $d = $H }
    $path.AddArc($X, $Y, $d, $d, 180, 90)
    $path.AddArc(($X + $W - $d), $Y, $d, $d, 270, 90)
    $path.AddArc(($X + $W - $d), ($Y + $H - $d), $d, $d, 0, 90)
    $path.AddArc($X, ($Y + $H - $d), $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

<#
.SYNOPSIS
    窗体圆角区域（无边框窗口自己切圆角）。
#>
function New-SnipRoundedRegion {
    param([System.Drawing.Rectangle]$Bounds, [int]$Radius = 12)
    return New-Object System.Drawing.Region (New-SnipRoundPath -X 0 -Y 0 -W $Bounds.Width -H $Bounds.Height -Radius $Radius)
}

<#
.SYNOPSIS
    量文本：行数、行高、最宽行、总高。
.DESCRIPTION
    行数要按"所有行"算（含段落间的空行），空行同样占高度；
    只去掉末尾多余的空行。行高用单行实测，避免用字号估算导致的逐行漂移。
#>
function Measure-SnipTextBlock {
    param([string]$Content, [System.Drawing.Font]$Font)

    $flags = [System.Windows.Forms.TextFormatFlags]::NoPadding
    $probe = New-Object System.Drawing.Size(20000, 200)
    # 行高取单行实测值（高度不受水平边缘留白影响，这里不需要重复取样）。
    $metrics = [System.Windows.Forms.TextRenderer]::MeasureText('国Ag', $Font, $probe, $flags)

    $lines = [System.Collections.ArrayList]@([regex]::Split($Content, "`r?`n"))
    while ($lines.Count -gt 1 -and ([string]$lines[$lines.Count - 1]).Trim() -eq '') { $lines.RemoveAt($lines.Count - 1) }

    # 行宽按字符推进累加，避免短行（如"合计"）被 GDI 边缘留白虚高。
    $cache = @{}
    $width = 0.0
    foreach ($line in $lines) {
        $lineWidth = Measure-SnipLineWidth -Line ([string]$line) -Font $Font -Cache $cache
        if ($lineWidth -gt $width) { $width = $lineWidth }
    }

    return [pscustomobject]@{
        Width      = [int]$width
        LineCount  = [int]$lines.Count
        LineHeight = [int]$metrics.Height
        Height     = [int]($metrics.Height * $lines.Count)
    }
}

<#
.SYNOPSIS
    自绘按钮：圆角 8、hover/press 三态、强调与幽灵两种。
#>
function New-SnipFlatButton {
    param([string]$Text, [bool]$Accent = $false, [int]$Width = 88, [int]$Height = 34)

    $t = $script:SnipTheme
    $button = New-Object System.Windows.Forms.Panel
    $button.Size = New-Object System.Drawing.Size($Width, $Height)
    $button.Cursor = [System.Windows.Forms.Cursors]::Hand
    $button.BackColor = [System.Drawing.Color]::Transparent
    $button.Font = New-SnipUiFont -Size 9

    $palette = if ($Accent) {
        @{ Normal = $t.Accent; Hot = $t.AccentHover; Down = $t.AccentDown; Line = [System.Drawing.Color]::Transparent; Fore = [System.Drawing.Color]::White }
    } else {
        @{ Normal = $t.Ghost; Hot = $t.GhostHover; Down = $t.GhostDown; Line = $t.GhostLine; Fore = $t.TextBody }
    }

    $button.Tag = @{ Hot = $false; Down = $false; Text = $Text; Palette = $palette }

    $button.Add_Paint({
            param($sender, $e)
            $state = $sender.Tag
            $key = if ($state.Down) { 'Down' } elseif ($state.Hot) { 'Hot' } else { 'Normal' }
            $palette = $state.Palette
            $e.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

            $path = New-SnipRoundPath -X 0.5 -Y 0.5 -W ($sender.Width - 1) -H ($sender.Height - 1) -Radius 8
            $brush = New-Object System.Drawing.SolidBrush($palette[$key])
            try { $e.Graphics.FillPath($brush, $path) } finally { $brush.Dispose() }
            if ($palette.Line.A -ne 0) {
                $pen = New-Object System.Drawing.Pen($palette.Line, 1)
                try { $e.Graphics.DrawPath($pen, $path) } finally { $pen.Dispose() }
            }
            $path.Dispose()

            $flags = [System.Windows.Forms.TextFormatFlags]::HorizontalCenter -bor [System.Windows.Forms.TextFormatFlags]::VerticalCenter -bor [System.Windows.Forms.TextFormatFlags]::NoPadding
            $rect = New-Object System.Drawing.Rectangle(0, 0, $sender.Width, $sender.Height)
            [System.Windows.Forms.TextRenderer]::DrawText($e.Graphics, $state.Text, $sender.Font, $rect, $palette.Fore, $flags)
        })

    $button.Add_MouseEnter({ param($s, $e) $s.Tag.Hot = $true; $s.Invalidate() })
    $button.Add_MouseLeave({ param($s, $e) $s.Tag.Hot = $false; $s.Tag.Down = $false; $s.Invalidate() })
    $button.Add_MouseDown({ param($s, $e) if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) { $s.Tag.Down = $true; $s.Invalidate() } })
    $button.Add_MouseUp({ param($s, $e) $s.Tag.Down = $false; $s.Invalidate() })
    Set-SnipDoubleBuffered -Form $button
    return $button
}

<#
.SYNOPSIS
    显示识别结果窗。
#>
function Show-SnipResult {
    param(
        [string]$Title = '识别结果',
        [string]$Text = '',
        [string]$Translation = '',
        [string]$Model = '',
        [int]$ElapsedMs = 0
    )

    $t = $script:SnipTheme

    if (-not ('SnipResizeWindow' -as [type])) {
        $chromePath = Join-Path $PSScriptRoot 'win-snip-chrome.cs'
        if (Test-Path $chromePath) {
            Add-Type -TypeDefinition ([System.IO.File]::ReadAllText($chromePath, [System.Text.Encoding]::UTF8)) `
                -ReferencedAssemblies System.Drawing, System.Windows.Forms, System.Drawing.Primitives, System.Runtime.InteropServices
        }
    }

    $hasText = -not [string]::IsNullOrWhiteSpace($Text)
    $hasTranslation = -not [string]::IsNullOrWhiteSpace($Translation)
    if (-not $hasText -and -not $hasTranslation) { $Text = '（没有内容）'; $hasText = $true }

    # ---- 先量内容，再定窗 ----
    $allText = ($Text + "`n" + $Translation)
    $bodyFont = New-SnipTextFont -Size 10.5
    # 雅黑不是等宽，先把"靠空格对齐"的原文按雅黑实测字宽重排，列位置才不散。
    # 显示用重排后的文本，复制时仍给原始文本（粘到别处不会多出空格）。
    $displayText = if ($hasText) { Format-SnipAlignedText -Content $Text -Font $bodyFont } else { '' }
    $displayTranslation = if ($hasTranslation) { Format-SnipAlignedText -Content $Translation -Font $bodyFont } else { '' }

    $measureText = if ($hasText) { Measure-SnipTextBlock -Content $displayText -Font $bodyFont } else { $null }
    $measureTranslation = if ($hasTranslation) { Measure-SnipTextBlock -Content $displayTranslation -Font $bodyFont } else { $null }
    $lineH = if ($null -ne $measureText) { $measureText.LineHeight } else { $measureTranslation.LineHeight }

    # ---- 尺寸常量 ----
    $headerH = 56          # 标题栏
    $footerH = 64          # 页脚
    $padX = 20             # 左右留白
    $padTop = 16           # 标题栏到第一块
    $padBottom = 20        # 最后一块到页脚
    $labelH = 16           # 小标题行
    $labelGap = 7          # 小标题到卡片
    $cardPadY = 13         # 卡片内上下留白
    $cardGap = 14          # 双卡时卡片间距
    $minCardH = 54
    $minWidth = 380

    $blocks = New-Object System.Collections.ArrayList
    if ($null -ne $measureText) {
        [void]$blocks.Add([pscustomobject]@{
                Caption = $(if ($hasTranslation) { '原文' } else { '识别文字' })
                Content = $displayText
                Original = $Text
                Measure = $measureText
            })
    }
    if ($null -ne $measureTranslation) {
        [void]$blocks.Add([pscustomobject]@{
                Caption = '译文'
                Content = $displayTranslation
                Original = $Translation
                Measure = $measureTranslation
            })
    }
    foreach ($block in $blocks) {
        $block | Add-Member -NotePropertyName CardH `
            -NotePropertyValue ([int][Math]::Max($minCardH, ($cardPadY * 2 + $block.Measure.LineCount * $lineH)))
    }

    $bodyH = 0
    foreach ($block in $blocks) { $bodyH += $labelH + $labelGap + $block.CardH }
    if ($blocks.Count -gt 1) { $bodyH += $cardGap * ($blocks.Count - 1) }

    $contentW = 0
    foreach ($block in $blocks) { if ($block.Measure.Width -gt $contentW) { $contentW = $block.Measure.Width } }

    # 尺寸策略（按辉哥要求：尽量大，把文字全部显示出来）：
    #   1) 先按内容算出"刚好装下"的宽高；
    #   2) 再取"屏幕的 55%"作为下限——窗口不要开得像个小气泡；
    #   3) 上限是整屏减 24px：内容再多也尽量塞进一屏，塞不下才用滚动条。
    $work = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position).WorkingArea
    $margin = 24
    $maxW = [int]($work.Width - $margin)
    $maxH = [int]($work.Height - $margin)
    $floorW = [int][Math]::Min($maxW, $work.Width * 0.55)
    $floorH = [int][Math]::Min($maxH, $work.Height * 0.55)

    $naturalW = [int]($contentW + $padX * 2 + 26)
    $naturalH = [int]($headerH + $padTop + $bodyH + $padBottom + $footerH)

    $formW = [int][Math]::Max($minWidth, [Math]::Min($maxW, [Math]::Max($naturalW, $floorW)))
    $formH = [int][Math]::Max($floorH, [Math]::Min($maxH, $naturalH))
    # 只剩一行时也得容下一块卡片，否则卡片会被压没。
    if ($formH -lt ($headerH + $footerH + 108)) { $formH = $headerH + $footerH + 108 }

    # ---- 窗体 ----
    $form = New-SnipDarkForm
    $form.Text = $Title
    $form.KeyPreview = $true
    $form.BackColor = $t.Window
    $form.Size = New-Object System.Drawing.Size($formW, $formH)
    $form.MinimumSize = New-Object System.Drawing.Size($minWidth, ($headerH + $footerH + 108))
    $form.Location = New-Object System.Drawing.Point(
        ($work.X + [int](($work.Width - $formW) / 2)),
        ($work.Y + [int](($work.Height - $formH) / 2))
    )

    $applyCorners = {
        param($sender)
        try { $sender.Region = New-SnipRoundedRegion -Bounds (New-Object System.Drawing.Rectangle(0, 0, $sender.Width, $sender.Height)) -Radius 12 } catch { }
    }
    $form.Add_Resize({ param($sender, $e) & $applyCorners $sender })
    $form.Add_Shown({ param($sender, $e) & $applyCorners $sender; $sender.Activate() })
    $form.Add_Paint({
            param($sender, $e)
            $e.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
            $theme = $script:SnipTheme
            $pen = New-Object System.Drawing.Pen($theme.WindowLine, 1)
            try { $e.Graphics.DrawRectangle($pen, 0, 0, ($sender.Width - 1), ($sender.Height - 1)) } finally { $pen.Dispose() }
            $gloss = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(28, 255, 255, 255), 1)
            try { $e.Graphics.DrawLine($gloss, 16, 1, ($sender.Width - 17), 1) } finally { $gloss.Dispose() }
        })
    if ('SnipResizeWindow' -as [type]) { [SnipResizeWindow]::Attach($form, 8) }

    # ---- 标题栏 ----
    $header = New-Object System.Windows.Forms.Panel
    $header.BackColor = $t.Header
    $header.Add_Paint({
            param($sender, $e)
            $theme = $script:SnipTheme
            $pen = New-Object System.Drawing.Pen($theme.Hairline, 1)
            try { $e.Graphics.DrawLine($pen, 0, ($sender.Height - 1), $sender.Width, ($sender.Height - 1)) } finally { $pen.Dispose() }
        })

    $titleLabel = New-Object System.Windows.Forms.Label
    $titleLabel.Text = $Title
    $titleLabel.AutoSize = $false
    $titleLabel.BackColor = [System.Drawing.Color]::Transparent
    $titleLabel.ForeColor = $t.TextPrimary
    $titleLabel.Font = New-SnipUiFont -Size 11.5 -Style ([System.Drawing.FontStyle]::Bold)
    $titleLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
    $header.Controls.Add($titleLabel)

    $meta = @()
    if ($Model) { $meta += $Model }
    if ($ElapsedMs -gt 0) { $meta += ('{0:0.0} 秒' -f ($ElapsedMs / 1000)) }
    $totalLines = 0
    foreach ($block in $blocks) { $totalLines += $block.Measure.LineCount }
    $meta += "$totalLines 行"

    $subtitle = New-Object System.Windows.Forms.Label
    $subtitle.Text = ($meta -join '   ·   ')
    $subtitle.AutoSize = $false
    $subtitle.BackColor = [System.Drawing.Color]::Transparent
    $subtitle.ForeColor = $t.TextMuted
    $subtitle.Font = New-SnipUiFont -Size 8.5
    $subtitle.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
    $header.Controls.Add($subtitle)

    $closeBox = New-Object System.Windows.Forms.Panel
    $closeBox.Size = New-Object System.Drawing.Size(28, 28)
    $closeBox.Cursor = [System.Windows.Forms.Cursors]::Hand
    $closeBox.BackColor = [System.Drawing.Color]::Transparent
    $closeBox.Tag = @{ Hot = $false }
    $closeBox.Add_Paint({
            param($sender, $e)
            $e.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
            $color = if ($sender.Tag.Hot) { [System.Drawing.Color]::White } else { [System.Drawing.Color]::FromArgb(203, 209, 220) }
            $pen = New-Object System.Drawing.Pen($color, 1.6)
            $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
            $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
            try {
                $c = [int]($sender.Width / 2); $r = 5
                $e.Graphics.DrawLine($pen, ($c - $r), ($c - $r), ($c + $r), ($c + $r))
                $e.Graphics.DrawLine($pen, ($c + $r), ($c - $r), ($c - $r), ($c + $r))
            } finally { $pen.Dispose() }
        })
    $closeBox.Add_MouseEnter({ param($s, $e) $s.Tag.Hot = $true; $s.Invalidate() })
    $closeBox.Add_MouseLeave({ param($s, $e) $s.Tag.Hot = $false; $s.Invalidate() })
    $closeBox.Add_MouseUp({ param($s, $e) if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) { $s.FindForm().Close() } })
    Set-SnipDoubleBuffered -Form $closeBox
    $header.Controls.Add($closeBox)

    $drag = @{ Active = $false; Origin = $null; Start = $null }
    $onDown = { param($s, $e) if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) { $drag.Active = $true; $drag.Start = [System.Windows.Forms.Cursor]::Position; $drag.Origin = $form.Location } }
    $onMove = {
        param($s, $e)
        if (-not $drag.Active) { return }
        $now = [System.Windows.Forms.Cursor]::Position
        $form.Location = New-Object System.Drawing.Point(
            ($drag.Origin.X + ($now.X - $drag.Start.X)),
            ($drag.Origin.Y + ($now.Y - $drag.Start.Y))
        )
    }
    $onUp = { param($s, $e) $drag.Active = $false }
    foreach ($zone in @($header, $titleLabel, $subtitle)) {
        $zone.Add_MouseDown($onDown); $zone.Add_MouseMove($onMove); $zone.Add_MouseUp($onUp)
    }
    $form.Controls.Add($header)

    # ---- 内容区 ----
    $sections = New-Object System.Collections.ArrayList
    foreach ($block in $blocks) {
        $caption = New-Object System.Windows.Forms.Label
        $caption.Text = $block.Caption
        $caption.AutoSize = $false
        $caption.BackColor = [System.Drawing.Color]::Transparent
        $caption.ForeColor = $t.TextMuted
        $caption.Font = New-SnipUiFont -Size 9 -Style ([System.Drawing.FontStyle]::Bold)
        $caption.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
        $form.Controls.Add($caption)

        $card = New-Object System.Windows.Forms.Panel
        $card.BackColor = $t.Surface
        $card.Tag = @{ Thumb = $false; Ratio = 0.0; Progress = 0.0 }
        $card.Add_Paint({
                param($sender, $e)
                $theme = $script:SnipTheme
                $e.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
                $pen = New-Object System.Drawing.Pen($theme.SurfaceLine, 1)
                try { $e.Graphics.DrawRectangle($pen, 0, 0, ($sender.Width - 1), ($sender.Height - 1)) } finally { $pen.Dispose() }


            })

        $box = New-Object System.Windows.Forms.TextBox
        $box.Multiline = $true
        $box.ReadOnly = $true
        $box.WordWrap = $false
        $box.BorderStyle = [System.Windows.Forms.BorderStyle]::None
        $box.BackColor = $t.Surface
        $box.ForeColor = $t.TextBody
        $box.Font = $bodyFont
        $box.ScrollBars = [System.Windows.Forms.ScrollBars]::None
        $box.TabStop = $false
        $box.HideSelection = $true
        # TextBox 只认 CRLF；单独的 \n 会被并成一行，排版就全塌了。
        $box.Text = [regex]::Replace($block.Content, "`r?`n", "`r`n")
        $box.SelectionStart = 0
        $box.SelectionLength = 0
        $card.Controls.Add($box)
        $form.Controls.Add($card)

        [void]$sections.Add([pscustomobject]@{
                Caption = $caption
                Card    = $card
                Box     = $box
                Lines   = $block.Measure.LineCount
                LineH   = $block.Measure.LineHeight
                CardH   = $block.CardH
                WantWidth = $block.Measure.Width
                Original = $block.Original
            })
    }

    # ---- 页脚 ----
    # 键帽与提示文字用的小字体，必须在页脚 Paint 之前建好（闭包会立即引用）。
    $script:snipKeyFont = New-SnipTextFont -Size 8.5
    $script:snipHintFont = New-SnipUiFont -Size 8.5

    $footer = New-Object System.Windows.Forms.Panel
    $footer.BackColor = $t.Header
    $footer.Add_Paint({
            param($sender, $e)
            $theme = $script:SnipTheme
            $e.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
            $pen = New-Object System.Drawing.Pen($theme.Hairline, 1)
            try { $e.Graphics.DrawLine($pen, 0, 0, $sender.Width, 0) } finally { $pen.Dispose() }

            # 快捷键提示做成键帽，比一行灰字更像成品，也更省认知。
            $x = $padX
            $y = [int](($sender.Height - 20) / 2)
            foreach ($hint in @(@{ Key = 'Esc'; Label = '关闭' }, @{ Key = 'Ctrl+C'; Label = '复制' })) {
                $keySize = [System.Windows.Forms.TextRenderer]::MeasureText($hint.Key, $script:snipKeyFont, (New-Object System.Drawing.Size(400, 40)), [System.Windows.Forms.TextFormatFlags]::NoPadding)
                $chipW = $keySize.Width + 14
                $chipPath = New-SnipRoundPath -X ([single]$x) -Y ([single]$y) -W ([single]$chipW) -H 20 -Radius 5
                $chipBrush = New-Object System.Drawing.SolidBrush($theme.Chip)
                $chipPen = New-Object System.Drawing.Pen($theme.ChipLine, 1)
                try {
                    $e.Graphics.FillPath($chipBrush, $chipPath)
                    $e.Graphics.DrawPath($chipPen, $chipPath)
                } finally { $chipBrush.Dispose(); $chipPen.Dispose() }
                $chipPath.Dispose()
                $keyRect = New-Object System.Drawing.Rectangle($x, $y, $chipW, 20)
                [System.Windows.Forms.TextRenderer]::DrawText($e.Graphics, $hint.Key, $script:snipKeyFont, $keyRect, $theme.ChipText,
                    ([System.Windows.Forms.TextFormatFlags]::HorizontalCenter -bor [System.Windows.Forms.TextFormatFlags]::VerticalCenter -bor [System.Windows.Forms.TextFormatFlags]::NoPadding))
                $x += $chipW + 7

                $labelSize = [System.Windows.Forms.TextRenderer]::MeasureText($hint.Label, $script:snipHintFont, (New-Object System.Drawing.Size(400, 40)), [System.Windows.Forms.TextFormatFlags]::NoPadding)
                $labelRect = New-Object System.Drawing.Rectangle($x, $y, ($labelSize.Width + 4), 20)
                [System.Windows.Forms.TextRenderer]::DrawText($e.Graphics, $hint.Label, $script:snipHintFont, $labelRect, $theme.TextFaint,
                    ([System.Windows.Forms.TextFormatFlags]::VerticalCenter -bor [System.Windows.Forms.TextFormatFlags]::NoPadding))
                $x += $labelSize.Width + 18
            }
        })
    $copyButton = New-SnipFlatButton -Text '复制' -Accent $true -Width 84 -Height 34
    $closeButton = New-SnipFlatButton -Text '关闭' -Accent $false -Width 84 -Height 34
    $footer.Controls.Add($copyButton)
    $footer.Controls.Add($closeButton)
    $form.Controls.Add($footer)

    # ---- 布局 ----
    $layout = {
        $w = $form.Width
        $h = $form.Height

        $header.SetBounds(1, 1, ($w - 2), ($headerH - 1))
        $titleLabel.SetBounds($padX, 8, ($w - 110), 24)
        $subtitle.SetBounds(($padX + 1), 32, ($w - 120), 16)
        $closeBox.SetBounds(($w - 28 - 11), ([int](($headerH - 28) / 2)), 28, 28)

        $footer.SetBounds(1, ($h - $footerH), ($w - 2), $footerH)
        $copyButton.SetBounds(($w - 84 - $padX), ([int](($footerH - 34) / 2)), 84, 34)
        $closeButton.SetBounds(($w - 84 - $padX - 8 - 84), ([int](($footerH - 34) / 2)), 84, 34)

        # 可用高度；窗口被手动拉大时，多出来的空间按行数比例补给各卡片，
        # 但绝不低于内容需求，避免"内容少却留一片死白"。
        $available = ($h - $footerH) - ($headerH + $padTop) - $padBottom
        $chrome = 0
        foreach ($section in $sections) { $chrome += $labelH + $labelGap }
        if ($sections.Count -gt 1) { $chrome += $cardGap * ($sections.Count - 1) }
        $forCards = $available - $chrome

        $sumWant = 0
        foreach ($section in $sections) { $sumWant += $section.CardH }
        $totalLines = 0
        foreach ($section in $sections) { $totalLines += $section.Lines }
        if ($totalLines -le 0) { $totalLines = 1 }

        $offset = $headerH + $padTop
        foreach ($section in $sections) {
            $want = $section.CardH
            if ($forCards -gt $sumWant) {
                # 空间有富余：多出来的高度按行数分摊，卡片撑满窗口
                $extra = $forCards - $sumWant
                $want = [int]($section.CardH + $extra * ($section.Lines / $totalLines))
            } elseif ($forCards -lt $sumWant) {
                # 空间不够：卡片必须压回窗口内，否则卡片超出窗口底部被裁掉，
                # 而且"内容比卡片高"这个条件永远不成立，滚动条也不会出现，文字就看不到了。
                $want = [int]($section.CardH * ($forCards / [double]$sumWant))
            }
            if ($want -lt $minCardH) { $want = $minCardH }

            $section.Caption.SetBounds($padX, $offset, 220, $labelH)
            $section.Card.SetBounds($padX, ($offset + $labelH + $labelGap), ($w - $padX * 2), $want)

            $boxW = ($w - $padX * 2) - 26
            $innerH = $want - ($cardPadY * 2)
            $contentH = $section.Lines * $section.LineH
            $contentWid = $section.WantWidth

            # 装不下就开滚动条：宁可出现滚动条，也不能让文字悄无声息地被截掉。
            $needV = ($contentH -gt ($innerH + 2))
            $needH = ($contentWid -gt ($boxW + 2))
            $bars = if ($needV -and $needH) { [System.Windows.Forms.ScrollBars]::Both }
                    elseif ($needV) { [System.Windows.Forms.ScrollBars]::Vertical }
                    elseif ($needH) { [System.Windows.Forms.ScrollBars]::Horizontal }
                    else { [System.Windows.Forms.ScrollBars]::None }
            if ($section.Box.ScrollBars -ne $bars) { $section.Box.ScrollBars = $bars }
            # 竖向滚动条会占宽度，留 18px 给它，免得最后一列被压住。
            if ($bars -eq [System.Windows.Forms.ScrollBars]::Vertical -or $bars -eq [System.Windows.Forms.ScrollBars]::Both) { $boxW -= 18 }
            $section.Box.SetBounds(14, $cardPadY, $boxW, $innerH)

            $offset += $labelH + $labelGap + $want + $cardGap
        }
    }

    & $layout
    $form.Add_Resize({ param($sender, $e) & $layout })

    # ---- 交互 ----
    $doCopy = {
        $parts = @()
        foreach ($section in $sections) { $parts += $section.Original }
        $payload = ($parts -join "`r`n`r`n")
        try { [System.Windows.Forms.Clipboard]::SetText($payload) } catch { }
        $copyButton.Tag.Text = '已复制'
        $copyButton.Invalidate()
        # 1.2 秒后把按钮文字改回来。
        $revert = New-Object System.Windows.Forms.Timer
        $revert.Interval = 1200
        $revert.Add_Tick({
                param($timer, $e)
                $timer.Stop()
                $copyButton.Tag.Text = '复制'
                $copyButton.Invalidate()
                $timer.Dispose()
            })
        $revert.Start()
    }
    $copyButton.Add_MouseUp({ param($s, $e) if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) { & $doCopy } })
    $closeButton.Add_MouseUp({ param($s, $e) if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) { $form.Close() } })

    # TextBox 有焦点时会自行消费 Ctrl+C / Esc，窗体 KeyDown 收不到，这里补挂一遍。
    foreach ($section in $sections) {
        $target = $section
        $target.Box.Add_KeyDown({
                param($s, $e)
                if ($e.KeyCode -eq [System.Windows.Forms.Keys]::Escape) { $form.Close() }
                elseif ($e.Control -and $e.KeyCode -eq [System.Windows.Forms.Keys]::C) { & $doCopy; $e.SuppressKeyPress = $true }
                elseif ($e.Control -and $e.KeyCode -eq [System.Windows.Forms.Keys]::Enter) { & $doCopy; $e.SuppressKeyPress = $true }
            })
    }

    $form.Add_KeyDown({
            param($sender, $e)
            if ($e.KeyCode -eq [System.Windows.Forms.Keys]::Escape) { $sender.Close() }
            elseif ($e.Control -and $e.KeyCode -eq [System.Windows.Forms.Keys]::C) { & $doCopy }
            elseif ($e.Control -and $e.KeyCode -eq [System.Windows.Forms.Keys]::Enter) { & $doCopy }
        })

    [void]$form.ShowDialog()
}
