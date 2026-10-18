# win-snip-result.ps1 —— 识别 / 翻译结果窗
#
# 视觉方向：参照 Linear 深色系统的结构（明度阶梯分层 + 1px 描边 + 顶部内高光），
# 强调色沿用工具条的蓝，不引入第二种彩色。
#
# 三条硬要求（来自辉哥反馈）：
#   1) 配色和窗体太丑 → 只用下面 $script:SnipTheme 的语义色，圆角 + 描边 + 内高光分层；
#   2) 窗口要随识别内容调整大小 → 先量文字再定窗口尺寸，做到"有多少内容开多大窗"，
#      同时保留最小/最大限制，避免一行字占满屏、或几十行挤成一条缝；
#   3) 手动拖边缘仍能缩放 → 无边框窗口挂 WM_NCHITTEST，四边四角都能拖。

# 语义色板。深色界面靠"明度阶梯 + 1px 描边 + 内高光"分层，
# 不靠大投影（近黑底上黑投影等于看不见）。
$script:SnipTheme = @{
    # 明度阶梯（这是"层次能不能看出来"的关键）：
    #   标题栏 42 > 窗口 33 > 卡片 22 > 页面外 0
    # 之前三档只差 3~6，在近黑底上等于没有台阶，观感就是"糊成一片"。
    Window       = [System.Drawing.Color]::FromArgb(33, 35, 42)    # 窗口底
    TitleBar     = [System.Drawing.Color]::FromArgb(42, 45, 54)    # 标题栏，最亮一档
    Card         = [System.Drawing.Color]::FromArgb(22, 23, 29)    # 正文卡片，明显更暗
    CardBorder   = [System.Drawing.Color]::FromArgb(64, 69, 84)
    WindowBorder = [System.Drawing.Color]::FromArgb(72, 77, 94)
    Hairline     = [System.Drawing.Color]::FromArgb(30, 32, 39)    # 标题栏与正文之间的分隔
    TextPrimary  = [System.Drawing.Color]::FromArgb(242, 244, 248)
    TextMuted    = [System.Drawing.Color]::FromArgb(160, 168, 184)
    TextFaint    = [System.Drawing.Color]::FromArgb(126, 134, 152)
    Accent       = [System.Drawing.Color]::FromArgb(48, 108, 232)
    AccentHover  = [System.Drawing.Color]::FromArgb(66, 126, 246)
    AccentDown   = [System.Drawing.Color]::FromArgb(37, 90, 204)
    Button       = [System.Drawing.Color]::FromArgb(50, 54, 66)
    ButtonHover  = [System.Drawing.Color]::FromArgb(63, 68, 82)
    ButtonDown   = [System.Drawing.Color]::FromArgb(43, 46, 57)
}

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
    扁平按钮：主按钮强调色填充，次按钮深色底 + 1px 描边。
#>
function New-SnipFlatButton {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [switch]$Accent
    )
    $t = $script:SnipTheme
    $button = New-Object System.Windows.Forms.Button
    $button.Text = $Text
    $button.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $button.FlatAppearance.BorderSize = if ($Accent) { 0 } else { 1 }
    $button.FlatAppearance.BorderColor = $t.CardBorder
    $button.FlatAppearance.MouseOverBackColor = if ($Accent) { $t.AccentHover } else { $t.ButtonHover }
    $button.FlatAppearance.MouseDownBackColor = if ($Accent) { $t.AccentDown } else { $t.ButtonDown }
    $button.BackColor = if ($Accent) { $t.Accent } else { $t.Button }
    $button.ForeColor = $t.TextPrimary
    $button.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)
    $button.Cursor = [System.Windows.Forms.Cursors]::Hand
    $button.UseVisualStyleBackColor = $false
    $button.Size = New-Object System.Drawing.Size(84, 32)
    return $button
}

<#
.SYNOPSIS
    量出一段等宽文字需要的像素宽高（用于"按内容定窗口大小"）。
#>
function Measure-SnipTextBlock {
    param(
        [Parameter(Mandatory = $true)][string]$Content,
        [Parameter(Mandatory = $true)][System.Drawing.Font]$Font
    )
    $normalized = [regex]::Replace($Content, "`r?`n", "`r`n")
    $lines = $normalized -split "`r`n"
    $lineCount = [Math]::Max(1, $lines.Count)

    # 行高按字体实测取，不写死；宽度取最长一行的实测值（表格列已按字宽补齐，量出来就是真宽）。
    $lineHeight = [System.Windows.Forms.TextRenderer]::MeasureText('Mg', $Font).Height
    $maxWidth = 0
    foreach ($line in $lines) {
        if ($line.Length -eq 0) { continue }
        $w = [System.Windows.Forms.TextRenderer]::MeasureText($line, $Font, (New-Object System.Drawing.Size(4000, 200)), [System.Windows.Forms.TextFormatFlags]::NoPadding).Width
        if ($w -gt $maxWidth) { $maxWidth = $w }
    }
    if ($maxWidth -le 0) { $maxWidth = 120 }

    return [pscustomobject]@{
        Width      = $maxWidth
        LineCount  = $lineCount
        LineHeight = $lineHeight
        Height     = ($lineCount * $lineHeight)
    }
}

<#
.SYNOPSIS
    显示识别或翻译结果。
.DESCRIPTION
    窗口尺寸由内容决定（识别到几行就开多大），但设上下限：
    最少 560x300，最多不超过屏幕工作区的 78%，超出的部分用滚动条。
.PARAMETER Title
    窗口标题（识别结果 / 翻译结果）。
.PARAMETER Text
    识别出的原文；可能为空（翻译失败仅返回译文时）。
.PARAMETER Translation
    译文；为空表示只展示原文。
.PARAMETER Model
    实际使用的模型名，显示在标题栏副标题里。
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
    $t = $script:SnipTheme
    $hasTranslation = $Translation -ne ''
    $hasText = $Text -ne ''
    if (-not $hasTranslation -and -not $hasText) { $Text = '（没有识别到文字）'; $hasText = $true }

    # 无边框窗口的缩放能力（C# 辅助，只加载一次）。
    if (-not ('SnipResizeWindow' -as [type])) {
        $existing = [AppDomain]::CurrentDomain.GetAssemblies() |
            ForEach-Object { $_.GetType('SnipResizeWindow', $false) } |
            Where-Object { $null -ne $_ } | Select-Object -First 1
        if ($null -eq $existing) {
            $chromePath = Join-Path $PSScriptRoot 'win-snip-chrome.cs'
            if (Test-Path $chromePath) {
                Add-Type -TypeDefinition ([System.IO.File]::ReadAllText($chromePath, [System.Text.Encoding]::UTF8)) `
                    -ReferencedAssemblies System.Drawing, System.Windows.Forms, System.Drawing.Primitives, System.Runtime.InteropServices
            }
        }
    }

    $allText = ($Text + "`n" + $Translation)
    $bodyFont = New-SnipMonoFont -Text $allText -Size 10.5
    $lineCount = @(($allText -split "`r?`n") | Where-Object { $_.Trim() -ne '' }).Count; if ($lineCount -le 0) { $lineCount = 1 }

    # 先量内容，再定窗口：这是"按内容变大小"的关键。
    $measureText = if ($hasText) { Measure-SnipTextBlock -Content $Text -Font $bodyFont } else { $null }
    $measureTranslation = if ($hasTranslation) { Measure-SnipTextBlock -Content $Translation -Font $bodyFont } else { $null }

    $headerHeight = 56
    $footerHeight = 60
    $captionBlock = 22      # 小标题 + 间距
    $cardPaddingY = 26      # 卡片内上下留白
    $gapBetween = 10
    $sidePadding = 44       # 左右各 22
    $scrollAllowance = 26   # 预留竖向滚动条宽度，避免刚好差几像素就出现横向滚动条

    # 每块卡片的高度 = 文字高度 + 内边距，单块限制在 84..340 之间（再多就滚动）。
    $cardHeightText = 0
    if ($null -ne $measureText) { $cardHeightText = [int][Math]::Max(84, [Math]::Min(340, $measureText.Height + $cardPaddingY)) }
    $cardHeightTranslation = 0
    if ($null -ne $measureTranslation) { $cardHeightTranslation = [int][Math]::Max(84, [Math]::Min(340, $measureTranslation.Height + $cardPaddingY)) }

    $bodyHeight = 0
    if ($null -ne $measureText) { $bodyHeight += $captionBlock + $cardHeightText }
    if ($null -ne $measureText -and $null -ne $measureTranslation) { $bodyHeight += $gapBetween }
    if ($null -ne $measureTranslation) { $bodyHeight += $captionBlock + $cardHeightTranslation }

    $contentWidth = 0
    if ($null -ne $measureText) { $contentWidth = [Math]::Max($contentWidth, $measureText.Width) }
    if ($null -ne $measureTranslation) { $contentWidth = [Math]::Max($contentWidth, $measureTranslation.Width) }

    $work = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position).WorkingArea
    $maxWidth = [int][Math]::Min(1100, $work.Width - 80)
    $maxHeight = [int][Math]::Min(860, [int]($work.Height * 0.86))

    # 窗口尺寸 = 内容 + 边距，并夹在 [最小, 屏幕上限] 之间。
    $formWidth = [int][Math]::Max(620, [Math]::Min($maxWidth, $contentWidth + $sidePadding + $scrollAllowance))
    $formHeight = [int][Math]::Max(300, [Math]::Min($maxHeight, $headerHeight + 14 + $bodyHeight + $footerHeight + 18))

    $form = New-SnipDarkForm
    $form.Text = $Title
    $form.KeyPreview = $true
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
    $form.BackColor = $t.Window
    $form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
    $form.Size = New-Object System.Drawing.Size($formWidth, $formHeight)
    $form.MinimumSize = New-Object System.Drawing.Size(620, 320)
    $form.Location = New-Object System.Drawing.Point(
        ($work.X + [int](($work.Width - $formWidth) / 2)),
        ($work.Y + [int](($work.Height - $formHeight) / 2))
    )

    # 外框：圆角 + 1px 描边 + 顶部内高光。
    $form.Add_Paint({
            param($sender, $e)
            $e.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
            $theme = $script:SnipTheme
            $rect = New-Object System.Drawing.Rectangle(0, 0, ($sender.Width - 1), ($sender.Height - 1))
            $border = New-Object System.Drawing.Pen($theme.WindowBorder, 1)
            try { $e.Graphics.DrawRectangle($border, $rect) } finally { $border.Dispose() }
            $gloss = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(64, 255, 255, 255), 1)
            try { $e.Graphics.DrawLine($gloss, 14, 1, ($sender.Width - 15), 1) } finally { $gloss.Dispose() }
        })
    $applyCorners = {
        param($sender)
        try { $sender.Region = New-SnipRoundedRegion -Bounds (New-Object System.Drawing.Rectangle(0, 0, $sender.Width, $sender.Height)) -Radius 12 } catch { }
    }
    $form.Add_Resize({ param($sender, $e) & $applyCorners $sender })
    $form.Add_Shown({ param($sender, $e) & $applyCorners $sender; $sender.Activate() })
    if ('SnipResizeWindow' -as [type]) { [SnipResizeWindow]::Attach($form, 8) }

    # ---- 标题栏 ----
    $header = New-Object System.Windows.Forms.Panel
    $header.BackColor = $t.TitleBar
    $header.SetBounds(1, 1, ($form.Width - 2), ($headerHeight - 1))
    $header.Anchor = [System.Windows.Forms.AnchorStyles]'Top, Left, Right'
    $form.Controls.Add($header)
    $header.Add_Paint({
            param($sender, $e)
            $theme = $script:SnipTheme
            $pen = New-Object System.Drawing.Pen($theme.Hairline, 1)
            try { $e.Graphics.DrawLine($pen, 0, ($sender.Height - 1), $sender.Width, ($sender.Height - 1)) } finally { $pen.Dispose() }
        })

    $titleLabel = New-Object System.Windows.Forms.Label
    $titleLabel.Text = $Title
    $titleLabel.BackColor = [System.Drawing.Color]::Transparent
    $titleLabel.ForeColor = $t.TextPrimary
    $titleLabel.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 11.5, [System.Drawing.FontStyle]::Bold)
    $titleLabel.SetBounds(22, 9, 340, 26)
    $header.Controls.Add($titleLabel)

    # 副标题：模型 · 耗时 · 行数。回答"用的什么模型、快不快"。
    $subtitleParts = @()
    if ($Model -ne '') { $subtitleParts += $Model }
    if ($ElapsedMs -gt 0) { $subtitleParts += ([math]::Round($ElapsedMs / 1000, 1).ToString() + ' 秒') }
    $subtitleParts += ($lineCount.ToString() + ' 行')
    $subtitle = New-Object System.Windows.Forms.Label
    $subtitle.Text = ($subtitleParts -join '  ·  ')
    $subtitle.BackColor = [System.Drawing.Color]::Transparent
    $subtitle.ForeColor = $t.TextMuted
    $subtitle.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 8.5)
    $subtitle.SetBounds(23, 34, 460, 16)
    $header.Controls.Add($subtitle)

    # 关闭按钮：矢量叉号，悬停变亮（不用 emoji）。
    $closeLabel = New-Object System.Windows.Forms.Label
    $closeLabel.Text = ''
    $closeLabel.BackColor = [System.Drawing.Color]::Transparent
    $closeLabel.Anchor = [System.Windows.Forms.AnchorStyles]'Top, Right'
    $closeLabel.SetBounds(($form.Width - 52), 14, 36, 28)
    $closeLabel.Cursor = [System.Windows.Forms.Cursors]::Hand
    $closeLabel.Add_Paint({
            param($sender, $e)
            $e.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
            $hot = $sender.Tag -eq 'hot'
            if ($hot) {
                $bg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(56, 60, 72))
                try { $e.Graphics.FillRectangle($bg, 0, 0, ($sender.Width - 1), ($sender.Height - 1)) } finally { $bg.Dispose() }
            }
            $color = if ($hot) { [System.Drawing.Color]::FromArgb(255, 255, 255) } else { [System.Drawing.Color]::FromArgb(198, 205, 218) }
            $pen = New-Object System.Drawing.Pen($color, 1.8)
            try {
                $cx = [int]($sender.Width / 2); $cy = [int]($sender.Height / 2)
                $e.Graphics.DrawLine($pen, ($cx - 5), ($cy - 5), ($cx + 5), ($cy + 5))
                $e.Graphics.DrawLine($pen, ($cx + 5), ($cy - 5), ($cx - 5), ($cy + 5))
            } finally { $pen.Dispose() }
        })
    $closeLabel.Add_MouseEnter({ param($sender, $e) $sender.Tag = 'hot'; $sender.Invalidate() })
    $closeLabel.Add_MouseLeave({ param($sender, $e) $sender.Tag = ''; $sender.Invalidate() })
    $closeLabel.Add_Click({ param($sender, $e) $form.Close() })
    $header.Controls.Add($closeLabel)

    # 标题栏拖动整窗（无边框窗必须自己实现）。
    $drag = @{ Offset = $null }
    $onDown = {
        param($sender, $e)
        $drag.Offset = [System.Windows.Forms.Cursor]::Position
    }
    $onMove = {
        param($sender, $e)
        if ($null -ne $drag.Offset -and $e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
            $now = [System.Windows.Forms.Cursor]::Position
            $form.Location = New-Object System.Drawing.Point(
                ($form.Location.X + $now.X - $drag.Offset.X),
                ($form.Location.Y + $now.Y - $drag.Offset.Y))
            $drag.Offset = $now
        }
    }
    $onUp = { param($sender, $e) $drag.Offset = $null }
    foreach ($target in @($header, $titleLabel, $subtitle)) {
        $target.Add_MouseDown($onDown)
        $target.Add_MouseMove($onMove)
        $target.Add_MouseUp($onUp)
    }

    # ---- 正文区：卡片按内容高度铺，窗口拉大时按行数比例分配空间 ----
    $sections = New-Object System.Collections.ArrayList

    <#
        卡片 = Panel 画底 + 1px 描边，内层 TextBox 留 12px 内边距。
        TextBox 自己不支持 Padding，直接贴边会显得非常挤。
    #>
    $addCard = {
        param([string]$Caption, [string]$Content, [int]$Lines, [int]$ContentWidth, [int]$ContentHeight)
        $captionLabel = New-Object System.Windows.Forms.Label
        $captionLabel.Text = $Caption
        $captionLabel.BackColor = [System.Drawing.Color]::Transparent
        $captionLabel.ForeColor = $t.TextFaint
        $captionLabel.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 8.5)
        $form.Controls.Add($captionLabel)

        $card = New-Object System.Windows.Forms.Panel
        $card.BackColor = $t.Card
        $card.Add_Paint({
                param($sender, $e)
                $theme = $script:SnipTheme
                $pen = New-Object System.Drawing.Pen($theme.CardBorder, 1)
                try { $e.Graphics.DrawRectangle($pen, 0, 0, ($sender.Width - 1), ($sender.Height - 1)) } finally { $pen.Dispose() }
            })
        $form.Controls.Add($card)

        $box = New-Object System.Windows.Forms.TextBox
        $box.Multiline = $true
        # 关自动换行：换行会破坏原排版（缩进、表格列），长行改用横向滚动条。
        $box.WordWrap = $false
        # 滚动条按需显示（见 $layout 里的判断），先给 None，
        # 否则 ScrollBars=Both 会画出一条永远存在的空横条，非常像半成品。
        $box.ScrollBars = [System.Windows.Forms.ScrollBars]::None
        $box.ReadOnly = $true
        $box.BorderStyle = [System.Windows.Forms.BorderStyle]::None
        $box.BackColor = $t.Card
        $box.ForeColor = $t.TextPrimary
        $box.Font = $bodyFont
        <#
            关键：WinForms 的 TextBox 只把 \r\n 当换行，单独的 \n 会被忽略，
            整段内容会挤成一行（辉哥反馈"还是没按排版来"就是这个原因）。
        #>
        $box.Text = [regex]::Replace($Content, "`r?`n", "`r`n")
        # 不要抢焦点、不要默认全选：否则整段文字会变成蓝底选中，既难读又像出错。
        $box.TabStop = $false
        $box.HideSelection = $true
        $box.SelectionStart = 0
        $box.SelectionLength = 0
        $card.Controls.Add($box)

        [void]$sections.Add([pscustomobject]@{
                Caption    = $captionLabel
                Card       = $card
                Box        = $box
                Lines      = [Math]::Max(1, $Lines)
                ContentWidth = $ContentWidth
                ContentHeight = $ContentHeight
            })
    }

    if ($hasText) {
        $caption = if ($hasTranslation) { '原文' } else { '识别文字' }
        & $addCard $caption $Text `
            $(if ($null -ne $measureText) { $measureText.LineCount } else { 1 }) `
            $(if ($null -ne $measureText) { $measureText.Width } else { 120 }) `
            $(if ($null -ne $measureText) { $measureText.Height } else { 16 })
    }
    if ($hasTranslation) {
        & $addCard '译文' $Translation `
            $(if ($null -ne $measureTranslation) { $measureTranslation.LineCount } else { 1 }) `
            $(if ($null -ne $measureTranslation) { $measureTranslation.Width } else { 120 }) `
            $(if ($null -ne $measureTranslation) { $measureTranslation.Height } else { 16 })
    }

    # ---- 页脚 ----
    $copyText = if ($hasTranslation) { $Translation } elseif ($hasText) { $Text } else { '' }
    $hint = New-Object System.Windows.Forms.Label
    $hint.Text = 'Esc 关闭　·　Ctrl+C 复制'
    $hint.BackColor = [System.Drawing.Color]::Transparent
    $hint.ForeColor = $t.TextFaint
    $hint.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 8.5)
    $hint.Anchor = [System.Windows.Forms.AnchorStyles]'Bottom, Left'
    $form.Controls.Add($hint)

    $closeButton = New-SnipFlatButton -Text '关闭'
    $closeButton.Anchor = [System.Windows.Forms.AnchorStyles]'Bottom, Right'
    $closeButton.Add_Click({ param($sender, $e) $form.Close() })
    $form.Controls.Add($closeButton)

    $copyButton = New-SnipFlatButton -Text '复制' -Accent
    $copyButton.Anchor = [System.Windows.Forms.AnchorStyles]'Bottom, Right'
    $copyButton.Add_Click({
            param($sender, $e)
            try {
                [System.Windows.Forms.Clipboard]::SetText($copyText)
                $sender.Text = '已复制'
                $timer = New-Object System.Windows.Forms.Timer
                $timer.Interval = 1200
                $timer.Add_Tick({
                        param($clock, $args)
                        $clock.Stop()
                        $copyButton.Text = '复制'
                        $clock.Dispose()
                    })
                $timer.Start()
            } catch {
                [System.Windows.Forms.MessageBox]::Show('复制失败：' + $_.Exception.Message, '截图小工具') | Out-Null
            }
        })
    $form.Controls.Add($copyButton)

    <#
        统一布局：窗口尺寸变化时重算卡片位置与高度。
        两块卡片时按行数比例分配可用高度（行多的那块给得多），
        这样"内容自适应"和"手动拉大窗口"两种情况下都不会出现大片空白或挤成一条缝。
    #>
    $layout = {
        $w = $form.ClientSize.Width
        $h = $form.ClientSize.Height
        $header.SetBounds(1, 1, ($w - 2), ($headerHeight - 1))
        $titleLabel.SetBounds(22, 9, ($w - 96), 26)
        $subtitle.SetBounds(23, 34, ($w - 96), 16)
        $closeLabel.SetBounds(($w - 52), 14, 36, 28)

        $bodyTop = $headerHeight + 14
        $bodyBottom = $h - $footerHeight - 14
        $available = [Math]::Max(120, $bodyBottom - $bodyTop)
        $count = $sections.Count
        if ($count -le 0) { return }

        $gap = if ($count -gt 1) { $gapBetween } else { 0 }
        $usable = $available - ($captionBlock * $count) - $gap
        if ($usable -lt 60) { $usable = 60 }

        $totalLines = 0
        foreach ($section in $sections) { $totalLines += $section.Lines }
        if ($totalLines -le 0) { $totalLines = 1 }

        $offset = $bodyTop
        foreach ($section in $sections) {
            # 按行数比例分配，单块最少 84、最多不超过可用空间的 78%。
            $share = $section.Lines / $totalLines
            $cardHeight = [int]($usable * $share)
            if ($cardHeight -lt 84) { $cardHeight = 84 }
            if ($cardHeight -gt ($usable * 0.78)) { $cardHeight = [int]($usable * 0.78) }

            $section.Caption.SetBounds(24, $offset, 200, 16)
            $section.Card.SetBounds(22, ($offset + 18), ($w - 44), $cardHeight)

            <#
                滚动条只在真溢出时才出现。
                TextBox 的滚动条一旦设为 Both，即使内容没超出也会画出一条空横条，
                看着非常像没做完——所以这里按内容实测宽高逐块决定。
            #>
            $boxWidth = $w - 44 - 36
            $boxHeight = $cardHeight - 28
            $needVertical = $section.ContentHeight -gt $boxHeight
            $needHorizontal = $section.ContentWidth -gt $boxWidth
            $bars = if ($needVertical -and $needHorizontal) { [System.Windows.Forms.ScrollBars]::Both }
                elseif ($needVertical) { [System.Windows.Forms.ScrollBars]::Vertical }
                elseif ($needHorizontal) { [System.Windows.Forms.ScrollBars]::Horizontal }
                else { [System.Windows.Forms.ScrollBars]::None }
            if ($section.Box.ScrollBars -ne $bars) { $section.Box.ScrollBars = $bars }
            $section.Box.SetBounds(18, 14, $boxWidth, $boxHeight)
            $offset += $captionBlock + $cardHeight + $gap
        }

        $hint.SetBounds(24, ($h - 40), 280, 18)
        $closeButton.SetBounds(($w - 108), ($h - 48), 84, 32)
        $copyButton.SetBounds(($w - 200), ($h - 48), 84, 32)
    }

    $form.Add_Resize({ param($sender, $e) & $layout })
    & $layout

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
