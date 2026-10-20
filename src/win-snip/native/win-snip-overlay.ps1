# win-snip-overlay.ps1 —— 遮罩框选 + 就地标注编辑器
#
# 交互（参考 Snipaste / 飞书截图 / kImageAnnotator 的做法）：
#   按下热键 → 整屏遮罩（冻结截图） → 拖框选 → 松手进入编辑
#   编辑态：选区可移动/缩放，工具栏浮在选区旁
#
# 关键设计决定（踩坑后修正）：
#   1. 工具栏用**真实 WinForms 控件**（FlowLayoutPanel + Label），不再自绘文字。
#      自绘 DrawString 在 PowerShell 托管的 paint 里出现过"只有底色没有文字"，且命中判定要自己算。
#   2. 按钮用 Label 而不是 Button：Label 默认不接受焦点，点完按钮不会把键盘焦点抢走，
#      Esc / Ctrl+Z 等快捷键始终有效。
#   3. 画布（Form 的 Paint）只负责：冻结截图、遮罩、选区边框、8 个控制点、标注图形。

# 工具定义（顺序即工具条顺序）。
$script:SnipToolDefs = @(
    @{ Id = 'tool-rect'; Label = '矩形'; Key = 'rect'; Icon = 'rect'; Tip = '矩形（R）' },
    @{ Id = 'tool-ellipse'; Label = '椭圆'; Key = 'ellipse'; Icon = 'ellipse'; Tip = '椭圆（E）' },
    @{ Id = 'tool-arrow'; Label = '箭头'; Key = 'arrow'; Icon = 'arrow'; Tip = '箭头（A）' },
    @{ Id = 'tool-pen'; Label = '画笔'; Key = 'pen'; Icon = 'pen'; Tip = '画笔（P）' },
    @{ Id = 'tool-text'; Label = '文字'; Key = 'text'; Icon = 'text'; Tip = '文字（T）' },
    @{ Id = 'tool-mosaic'; Label = '马赛克'; Key = 'mosaic'; Icon = 'mosaic'; Tip = '马赛克（M）' },
    @{ Id = 'tool-number'; Label = '序号'; Key = 'number'; Icon = 'number'; Tip = '序号标注（N）' }
)

# 动作定义（sep 为分隔符）。
$script:SnipActionDefs = @(
    @{ Id = 'undo'; Label = '撤销'; Icon = 'undo'; Tip = '撤销（Ctrl+Z）' },
    @{ Id = 'redo'; Label = '重做'; Icon = 'redo'; Tip = '重做（Ctrl+Y）' },
    @{ Id = 'sep'; Label = '' },
    @{ Id = 'ocr'; Label = '识别'; Icon = 'ocr'; Tip = '识别文字（模型视觉）' },
    @{ Id = 'translate'; Label = '翻译'; Icon = 'translate'; Tip = '翻译成中文（模型视觉）' },
    @{ Id = 'sep'; Label = '' },
    @{ Id = 'copy'; Label = '复制'; Icon = 'copy'; Tip = '复制到剪贴板（Enter）' },
    @{ Id = 'save'; Label = '保存'; Icon = 'save'; Tip = '保存为 PNG（Ctrl+S）' },
    @{ Id = 'pin'; Label = '钉图'; Icon = 'pin'; Tip = '钉在屏幕上' },
    @{ Id = 'sep'; Label = '' },
    @{ Id = 'close'; Label = '关闭'; Icon = 'close'; Tip = '关闭（Esc）' }
)

# 配色（深色工具条，与面板风格一致）。
$script:SnipAccent = [System.Drawing.Color]::FromArgb(226, 164, 92)
$script:SnipTextColor = [System.Drawing.Color]::FromArgb(239, 239, 241)
$script:SnipMutedColor = [System.Drawing.Color]::FromArgb(122, 122, 130)
$script:SnipHoverColor = [System.Drawing.Color]::FromArgb(62, 62, 70)
$script:SnipToolbarBack = [System.Drawing.Color]::FromArgb(27, 27, 31)
$script:SnipToolbarBorder = [System.Drawing.Color]::FromArgb(47, 47, 53)
# 分组竖线比外框略亮一档：外框要"收边"，分隔线要"看得见分组"。
$script:SnipToolbarDivider = [System.Drawing.Color]::FromArgb(62, 62, 70)

<#
.SYNOPSIS
    绘制选区之外的遮挡（分四块画，避免再叠一层整屏遮罩影响选区亮度）。
#>
function Add-SnipDim {
    param($Graphics, [System.Drawing.Rectangle]$Sel, [int]$Width, [int]$Height)
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(112, 0, 0, 0))
    try {
        if ($Sel.Top -gt 0) { $Graphics.FillRectangle($brush, 0, 0, $Width, $Sel.Top) }
        if ($Sel.Bottom -lt $Height) { $Graphics.FillRectangle($brush, 0, $Sel.Bottom, $Width, ($Height - $Sel.Bottom)) }
        if ($Sel.Left -gt 0) { $Graphics.FillRectangle($brush, 0, $Sel.Top, $Sel.Left, $Sel.Height) }
        if ($Sel.Right -lt $Width) { $Graphics.FillRectangle($brush, $Sel.Right, $Sel.Top, ($Width - $Sel.Right), $Sel.Height) }
    } finally {
        $brush.Dispose()
    }
}

<#
.SYNOPSIS
    画一条带箭头的线。
#>
function Add-SnipArrow {
    param($Graphics, $Pen, [System.Drawing.Point]$From, [System.Drawing.Point]$To)
    $Graphics.DrawLine($Pen, $From, $To)
    $angle = [Math]::Atan2(($To.Y - $From.Y), ($To.X - $From.X))
    $size = 14
    $left = New-Object System.Drawing.Point(
        ($To.X - [int]($size * [Math]::Cos($angle - 0.4))),
        ($To.Y - [int]($size * [Math]::Sin($angle - 0.4))))
    $right = New-Object System.Drawing.Point(
        ($To.X - [int]($size * [Math]::Cos($angle + 0.4))),
        ($To.Y - [int]($size * [Math]::Sin($angle + 0.4))))
    $Graphics.DrawLine($Pen, $To, $left)
    $Graphics.DrawLine($Pen, $To, $right)
}

<#
.SYNOPSIS
    画马赛克块（把源图对应区域缩小再最近邻放大，形成像素化遮盖）。
#>
function Add-SnipMosaic {
    param($Graphics, $Source, [System.Drawing.Rectangle]$Rect)
    if ($Rect.Width -lt 3 -or $Rect.Height -lt 3) { return }
    $block = 9
    $sw = [Math]::Max(1, [int]($Rect.Width / $block))
    $sh = [Math]::Max(1, [int]($Rect.Height / $block))
    $small = New-Object System.Drawing.Bitmap($sw, $sh)
    try {
        $smallGraphics = [System.Drawing.Graphics]::FromImage($small)
        try {
            $smallGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBilinear
            $smallGraphics.DrawImage($Source, (New-Object System.Drawing.Rectangle(0, 0, $sw, $sh)), $Rect, [System.Drawing.GraphicsUnit]::Pixel)
        } finally {
            $smallGraphics.Dispose()
        }
        $previous = $Graphics.InterpolationMode
        $Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
        try {
            $Graphics.DrawImage($small, $Rect)
        } finally {
            $Graphics.InterpolationMode = $previous
        }
    } finally {
        $small.Dispose()
    }
}

<#
.SYNOPSIS
    画一条标注（坐标已换算到目标画布）。
#>
function Add-SnipAnnotation {
    param($Graphics, $Source, $Annotation)
    $pen = New-Object System.Drawing.Pen($Annotation.Color, $Annotation.Width)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    try {
        $p1 = New-Object System.Drawing.Point([int]$Annotation.X1, [int]$Annotation.Y1)
        $p2 = New-Object System.Drawing.Point([int]$Annotation.X2, [int]$Annotation.Y2)
        switch ($Annotation.Kind) {
            'rect' {
                $rect = New-Object System.Drawing.Rectangle(
                    [Math]::Min($p1.X, $p2.X), [Math]::Min($p1.Y, $p2.Y),
                    [Math]::Abs($p2.X - $p1.X), [Math]::Abs($p2.Y - $p1.Y))
                $Graphics.DrawRectangle($pen, $rect)
            }
            'ellipse' {
                $rect = New-Object System.Drawing.Rectangle(
                    [Math]::Min($p1.X, $p2.X), [Math]::Min($p1.Y, $p2.Y),
                    [Math]::Abs($p2.X - $p1.X), [Math]::Abs($p2.Y - $p1.Y))
                $Graphics.DrawEllipse($pen, $rect)
            }
            'arrow' {
                Add-SnipArrow -Graphics $Graphics -Pen $pen -From $p1 -To $p2
            }
            'pen' {
                if ($Annotation.Points.Count -ge 2) {
                    $Graphics.DrawLines($pen, [System.Drawing.Point[]]$Annotation.Points.ToArray())
                }
            }
            'text' {
                $font = New-Object System.Drawing.Font('Microsoft YaHei UI', $Annotation.FontSize, [System.Drawing.FontStyle]::Regular)
                $brush = New-Object System.Drawing.SolidBrush($Annotation.Color)
                try { $Graphics.DrawString([string]$Annotation.Text, $font, $brush, [single]$p1.X, [single]$p1.Y) }
                finally { $font.Dispose(); $brush.Dispose() }
            }
            'mosaic' {
                $rect = New-Object System.Drawing.Rectangle(
                    [Math]::Min($p1.X, $p2.X), [Math]::Min($p1.Y, $p2.Y),
                    [Math]::Abs($p2.X - $p1.X), [Math]::Abs($p2.Y - $p1.Y))
                Add-SnipMosaic -Graphics $Graphics -Source $Source -Rect $rect
            }
            'number' {
                $radius = 15
                $font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10, [System.Drawing.FontStyle]::Bold)
                $brush = New-Object System.Drawing.SolidBrush($Annotation.Color)
                $format = New-Object System.Drawing.StringFormat
                $format.Alignment = [System.Drawing.StringAlignment]::Center
                $format.LineAlignment = [System.Drawing.StringAlignment]::Center
                try {
                    $Graphics.FillEllipse($brush, ($p1.X - $radius), ($p1.Y - $radius), ($radius * 2), ($radius * 2))
                    $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
                    try {
                        $box = New-Object System.Drawing.RectangleF(($p1.X - $radius), ($p1.Y - $radius), ($radius * 2), ($radius * 2))
                        $Graphics.DrawString([string]$Annotation.Text, $font, $textBrush, $box, $format)
                    } finally { $textBrush.Dispose() }
                } finally { $font.Dispose(); $brush.Dispose(); $format.Dispose() }
            }
        }
    } finally {
        $pen.Dispose()
    }
}

<#
.SYNOPSIS
    生成选区合成图（原图裁剪 + 当前全部标注）。
#>
function Get-SnipComposite {
    param($State)
    $sel = $State.Sel
    $width = [Math]::Max(1, $sel.Width)
    $height = [Math]::Max(1, $sel.Height)
    $bitmap = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $source = New-Object System.Drawing.Rectangle($sel.X, $sel.Y, $width, $height)
        $graphics.DrawImage($State.Bitmap, (New-Object System.Drawing.Rectangle(0, 0, $width, $height)), $source, [System.Drawing.GraphicsUnit]::Pixel)
        $graphics.TranslateTransform(-$sel.X, -$sel.Y)
        foreach ($annotation in $State.Annotations) {
            Add-SnipAnnotation -Graphics $graphics -Source $State.Bitmap -Annotation $annotation
        }
    } finally {
        $graphics.Dispose()
    }
    return $bitmap
}

<#
.SYNOPSIS
    取选区四周的缩放控制点。
#>
function Get-SnipHandles {
    param([System.Drawing.Rectangle]$Sel)
    $half = 4
    $points = @(
        @{ Id = 'nw'; X = $Sel.Left; Y = $Sel.Top },
        @{ Id = 'n'; X = $Sel.Left + [int]($Sel.Width / 2); Y = $Sel.Top },
        @{ Id = 'ne'; X = $Sel.Right; Y = $Sel.Top },
        @{ Id = 'e'; X = $Sel.Right; Y = $Sel.Top + [int]($Sel.Height / 2) },
        @{ Id = 'se'; X = $Sel.Right; Y = $Sel.Bottom },
        @{ Id = 's'; X = $Sel.Left + [int]($Sel.Width / 2); Y = $Sel.Bottom },
        @{ Id = 'sw'; X = $Sel.Left; Y = $Sel.Bottom },
        @{ Id = 'w'; X = $Sel.Left; Y = $Sel.Top + [int]($Sel.Height / 2) }
    )
    $result = New-Object System.Collections.ArrayList
    foreach ($point in $points) {
        [void]$result.Add(@{
                Id = $point.Id
                Rect = New-Object System.Drawing.Rectangle(($point.X - $half), ($point.Y - $half), ($half * 2), ($half * 2))
            })
    }
    return $result
}

<#
.SYNOPSIS
    弹出单行输入框（文字标注用）。
.OUTPUTS
    输入的文字；取消返回 $null。
#>
function Read-SnipText {
    param([System.Drawing.Point]$Anchor)
    $dialog = New-SnipDarkForm
    $dialog.Width = 340
    $dialog.Height = 118
    $dialog.Location = New-Object System.Drawing.Point(
        ([Math]::Max(0, $Anchor.X - 60)), ([Math]::Max(0, $Anchor.Y - 30)))
    $dialog.ShowInTaskbar = $false

    $box = New-Object System.Windows.Forms.TextBox
    $box.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
    $box.BackColor = [System.Drawing.Color]::FromArgb(24, 24, 26)
    $box.ForeColor = [System.Drawing.Color]::FromArgb(235, 235, 238)
    $box.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10)
    $box.SetBounds(14, 16, 312, 26)
    $dialog.Controls.Add($box)

    $ok = New-Object System.Windows.Forms.Button
    $ok.Text = '确定'
    $ok.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $ok.FlatAppearance.BorderSize = 0
    $ok.BackColor = $script:SnipAccent
    $ok.ForeColor = [System.Drawing.Color]::White
    $ok.SetBounds(186, 62, 66, 30)
    $dialog.Controls.Add($ok)

    $cancel = New-Object System.Windows.Forms.Button
    $cancel.Text = '取消'
    $cancel.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $cancel.FlatAppearance.BorderSize = 0
    $cancel.BackColor = [System.Drawing.Color]::FromArgb(58, 58, 64)
    $cancel.ForeColor = [System.Drawing.Color]::FromArgb(235, 235, 238)
    $cancel.SetBounds(260, 62, 66, 30)
    $dialog.Controls.Add($cancel)

    # 事件处理器在别的运行作用域里执行，必须用脚本级变量交接结果，不能用函数局部变量。
    $script:SnipTextCtx = @{ Dialog = $dialog; Box = $box; Value = $null }
    $ok.Add_Click({ $script:SnipTextCtx.Value = $script:SnipTextCtx.Box.Text; $script:SnipTextCtx.Dialog.Close() })
    $cancel.Add_Click({ $script:SnipTextCtx.Value = $null; $script:SnipTextCtx.Dialog.Close() })
    $dialog.AcceptButton = $ok
    $dialog.CancelButton = $cancel
    $dialog.Add_Shown({ $script:SnipTextCtx.Box.Focus() })
    $dialog.ShowDialog() | Out-Null
    $dialog.Dispose()
    return $script:SnipTextCtx.Value
}

<#
.SYNOPSIS
    判断某个工具条按钮当前是否禁用。
#>
function Test-SnipButtonDisabled {
    param($State, [string]$Id)
    if ($Id -eq 'undo') { return ($State.Annotations.Count -eq 0) }
    if ($Id -eq 'redo') { return ($State.Redo.Count -eq 0) }
    return $false
}

<#
.SYNOPSIS
    创建工具条（真实控件：FlowLayoutPanel + Label 按钮）。
.DESCRIPTION
    Label 不接受焦点，点按钮不会夺走键盘焦点，Esc/Ctrl+Z 等快捷键始终有效；
    文字由系统绘制，避免自绘文字在 paint 中丢失的问题。
#>
function New-SnipToolbar {
    param($State, $Form)
    $panel = New-Object SnipToolbarPanel
    $panel.AutoSize = $false
    $panel.WrapContents = $false
    $panel.FlowDirection = [System.Windows.Forms.FlowDirection]::LeftToRight
    $panel.Padding = New-Object System.Windows.Forms.Padding(4, 3, 4, 3)
    $panel.Margin = New-Object System.Windows.Forms.Padding(0)
    $panel.BackColor = $script:SnipToolbarBack
    $panel.BorderColor = $script:SnipToolbarBorder
    $panel.Visible = $false
    $panel.Tag = 'toolbar'

    # 悬停提示：把快捷键写在提示里，用户不用去看文档。
    $tip = New-Object System.Windows.Forms.ToolTip
    $tip.InitialDelay = 380
    $tip.ReshowDelay = 120
    $tip.AutoPopDelay = 8000

    $buttons = @{}
    foreach ($group in @($script:SnipToolDefs, $script:SnipActionDefs)) {
        foreach ($item in $group) {
            if ($item.Id -eq 'sep') {
                $sep = New-Object System.Windows.Forms.Panel
                # 1px 竖线：比原来 9px 的"占位块"更轻，分组靠留白而不是靠粗线。
                $sep.Size = New-Object System.Drawing.Size(1, 16)
                $sep.BackColor = $script:SnipToolbarBack
                $sep.Margin = New-Object System.Windows.Forms.Padding(4, 7, 4, 7)
                $sep.Add_Paint({
                        param($sender, $e)
                        $pen = New-Object System.Drawing.Pen($script:SnipToolbarDivider, 1)
                        # 落在 0.5px 上才是锐利的 1px 线；画在整数坐标会被抗锯齿抹成两像素浅灰。
                        try { $e.Graphics.DrawLine($pen, 0.5, 1, 0.5, ($sender.Height - 2)) } finally { $pen.Dispose() }
                    })
                $panel.Controls.Add($sep)
                continue
            }
            $button = New-Object SnipToolButton
            # 纯图标按钮：中文名与快捷键交给悬停提示；AccessibleName 让读屏与自动化仍能识别。
            $button.Text = ''
            $button.IconId = [string]$item.Icon
            $button.Tag = [string]$item.Id
            $button.AccessibleName = [string]$item.Label
            if ($null -ne $item.Tip) { $button.AccessibleDescription = [string]$item.Tip }
            # 复制是离开截图时的主操作（Enter），图标常驻琥珀色，其余按钮保持中性。
            $button.Primary = ($item.Id -eq 'copy')
            # 关闭会直接丢弃这次截图，悬停转危险色给出预警。
            $button.DangerOnHover = ($item.Id -eq 'close')
            $button.Margin = New-Object System.Windows.Forms.Padding(1, 0, 1, 0)
            $button.Size = New-Object System.Drawing.Size(30, 30)
            $button.Add_Click({
                    param($sender, $e)
                    Invoke-SnipToolbarAction -State $script:SnipEditor -Id ([string]$sender.Tag)
                })
            if ($null -ne $item.Tip) { $tip.SetToolTip($button, [string]$item.Tip) }
            $panel.Controls.Add($button)
            $buttons[[string]$item.Id] = $button
        }
    }

    $Form.Controls.Add($panel)
    $panel.BringToFront()
    $State.Panel = $panel
    $State.Buttons = $buttons
    $State.ToolTip = $tip
}

<#
.SYNOPSIS
    刷新工具条：位置（贴选区下方或上方）、禁用态、当前工具高亮。
#>
function Update-SnipToolbar {
    param($State)
    $panel = $State.Panel
    if ($null -eq $panel) { return }
    if ($State.Phase -ne 'edit') { $panel.Visible = $false; return }
    $wasVisible = $panel.Visible

    foreach ($key in $State.Buttons.Keys) {
        $button = $State.Buttons[$key]
        $disabled = Test-SnipButtonDisabled -State $State -Id $key
        $isTool = $key.StartsWith('tool-')
        $button.Active = $isTool -and ($State.Tool -eq $key.Substring(5))
        $button.Disabled = $disabled
        $button.Enabled = -not $disabled
        $button.Invalidate()
    }

    $panel.Visible = $true
    $form = $State.Form
    $clientWidth = $form.ClientSize.Width
    $clientHeight = $form.ClientSize.Height
    # 显式累加：不依赖 FlowLayoutPanel 的 AutoSize（它在未完成布局时会算出 87 这种错误宽度）
    $panelWidth = $panel.Padding.Horizontal
    $panelHeight = 0
    foreach ($child in $panel.Controls) {
        $panelWidth += $child.Width + $child.Margin.Horizontal
        $panelHeight = [Math]::Max($panelHeight, $child.Height + $child.Margin.Vertical)
    }
    $panelHeight += $panel.Padding.Vertical
    $panel.Size = New-Object System.Drawing.Size([int]$panelWidth, [int]$panelHeight)
    # 尺寸变了要重建圆角 Region，否则圆角会按上一次的尺寸裁切。
    $panel.ApplyCornerRegion()
    $sel = $State.Sel

    # 优先贴选区下方；下方放不下放上方；都放不下贴窗口底边。
    $top = $sel.Bottom + 8
    if (($top + $panelHeight) -gt ($clientHeight - 4)) { $top = $sel.Top - $panelHeight - 8 }
    if ($top -lt 4) { $top = [Math]::Max(4, $clientHeight - $panelHeight - 4) }
    $left = $sel.Left
    if (($left + $panelWidth) -gt ($clientWidth - 4)) { $left = $clientWidth - $panelWidth - 4 }
    if ($left -lt 4) { $left = 4 }

    $panel.Location = New-Object System.Drawing.Point([int]$left, [int]$top)
    if (-not $wasVisible) { Write-SnipLog ('工具条显示 位置=' + $left + ',' + $top + ' 尺寸=' + $panelWidth + 'x' + $panelHeight) }
}
<#
.SYNOPSIS
    开始一次识别/翻译（结果由定时器异步取回，不阻塞界面）。
#>
function Start-SnipVision {
    param($State, [string]$Kind)
    if ($null -ne $State.Pending) { return }
    $composite = Get-SnipComposite -State $State
    try {
        $request = New-SnipVisionRequest -Kind $Kind -Bitmap $composite
    } finally {
        $composite.Dispose()
    }
    if (-not $request.ok) {
        [System.Windows.Forms.MessageBox]::Show([string]$request.error, '截图小工具') | Out-Null
        return
    }
    $State.Pending = @{
        Kind         = $Kind
        ResponsePath = [string]$request.responsePath
        Deadline     = (Get-Date).AddSeconds(120)
        Title        = $(if ($Kind -eq 'ocr') { '识别结果' } else { '翻译结果' })
    }
    $State.BusyText = $(if ($Kind -eq 'ocr') { '识别中…' } else { '翻译中…' })
    $State.Form.Invalidate()
    $State.Timer.Start()
}

<#
.SYNOPSIS
    执行工具条动作。
#>
function Invoke-SnipToolbarAction {
    param($State, [string]$Id)
    if ($null -eq $State) { return }

    if ($Id.StartsWith('tool-')) {
        $key = $Id.Substring(5)
        $State.Tool = $(if ($State.Tool -eq $key) { 'none' } else { $key })
        Update-SnipToolbar -State $State
        return
    }

    switch ($Id) {
        'undo' {
            if ($State.Annotations.Count -gt 0) {
                $last = $State.Annotations[$State.Annotations.Count - 1]
                $State.Annotations.RemoveAt($State.Annotations.Count - 1)
                [void]$State.Redo.Add($last)
                Update-SnipToolbar -State $State
                $State.Form.Invalidate()
            }
        }
        'redo' {
            if ($State.Redo.Count -gt 0) {
                $last = $State.Redo[$State.Redo.Count - 1]
                $State.Redo.RemoveAt($State.Redo.Count - 1)
                [void]$State.Annotations.Add($last)
                Update-SnipToolbar -State $State
                $State.Form.Invalidate()
            }
        }
        'ocr' { Start-SnipVision -State $State -Kind 'ocr' }
        'translate' { Start-SnipVision -State $State -Kind 'translate' }
        'copy' {
            $bitmap = Get-SnipComposite -State $State
            try {
                if (-not (Set-SnipClipboardImage -Bitmap $bitmap)) {
                    [System.Windows.Forms.MessageBox]::Show('复制到剪贴板失败：剪贴板可能被其它程序占用，请稍后重试。', '截图小工具') | Out-Null
                    return
                }
                $State.Action = 'copy'
            } catch {
                [System.Windows.Forms.MessageBox]::Show('复制到剪贴板失败：' + $_.Exception.Message, '截图小工具') | Out-Null
                return
            } finally {
                $bitmap.Dispose()
            }
            $State.Form.Close()
        }
        'save' {
            $bitmap = Get-SnipComposite -State $State
            try {
                $dialog = New-Object System.Windows.Forms.SaveFileDialog
                $dialog.Filter = 'PNG 图片 (*.png)|*.png'
                $dialog.FileName = '截图-' + (Get-Date).ToString('yyyyMMdd-HHmmss') + '.png'
                if ([string]$State.SaveDir -ne '' -and (Test-Path ([string]$State.SaveDir))) {
                    $dialog.InitialDirectory = [string]$State.SaveDir
                }
                $wasTopMost = $State.Form.TopMost
                $State.Form.TopMost = $false
                $choice = $dialog.ShowDialog()
                $State.Form.TopMost = $wasTopMost
                if ($choice -eq [System.Windows.Forms.DialogResult]::OK) {
                    $bitmap.Save($dialog.FileName, [System.Drawing.Imaging.ImageFormat]::Png)
                    $State.Action = 'save'
                    $State.Form.Close()
                }
            } catch {
                [System.Windows.Forms.MessageBox]::Show('保存失败：' + $_.Exception.Message, '截图小工具') | Out-Null
            } finally {
                $bitmap.Dispose()
            }
        }
        'pin' {
            $bitmap = Get-SnipComposite -State $State
            Show-SnipFloat -Bitmap $bitmap
            $State.Action = 'pin'
            $State.Form.Close()
        }
        'close' { $State.Form.Close() }
        default { }
    }
}

<#
.SYNOPSIS
    给遮罩窗体挂键盘绑定：Esc / 撤销重做 / 复制保存 / 工具字母快捷键。
.DESCRIPTION
    单独成函数有两个原因：
      1. 快捷键是真实交互里最容易被改坏的一环，独立后才能被自测脚本直接覆盖
         （0.65.1 之前悬停提示里写了 R/E/A/P/T/M/N，代码里其实没有实现）。
      2. 处理器里一律通过 $script:SnipEditor 取状态：事件回调执行时函数局部变量可能已经取不到
         （2026-10-18 钉图窗崩溃就是这个原因），所以这里不依赖外部局部变量。
#>
function Add-SnipKeyBindings {
    param([Parameter(Mandatory = $true)]$Form)
    $Form.Add_KeyDown({
            param($sender, $e)
            $s = $script:SnipEditor
            if ($e.KeyCode -eq [System.Windows.Forms.Keys]::Escape) {
                if ($null -eq $s.Pending) { $sender.Close() }
                return
            }
            if ($null -ne $s.Pending) { return }
            if ($e.Control -and $e.KeyCode -eq [System.Windows.Forms.Keys]::Z) {
                Invoke-SnipToolbarAction -State $s -Id 'undo'
                return
            }
            if ($e.Control -and $e.KeyCode -eq [System.Windows.Forms.Keys]::Y) {
                Invoke-SnipToolbarAction -State $s -Id 'redo'
                return
            }
            if ($e.Control -and $e.KeyCode -eq [System.Windows.Forms.Keys]::C) {
                Invoke-SnipToolbarAction -State $s -Id 'copy'
                return
            }
            if ($e.Control -and $e.KeyCode -eq [System.Windows.Forms.Keys]::S) {
                Invoke-SnipToolbarAction -State $s -Id 'save'
                return
            }
            # 工具字母快捷键：工具条改成纯图标后，键盘切换比找按钮更快（提示里承诺的字母就是这套）。
            if (-not $e.Control -and -not $e.Alt -and $s.Phase -eq 'edit') {
                $toolKeys = @{
                    'R' = 'tool-rect'; 'E' = 'tool-ellipse'; 'A' = 'tool-arrow'; 'P' = 'tool-pen'
                    'T' = 'tool-text'; 'M' = 'tool-mosaic'; 'N' = 'tool-number'
                }
                $pressed = $e.KeyCode.ToString()
                if ($toolKeys.ContainsKey($pressed)) {
                    Invoke-SnipToolbarAction -State $s -Id $toolKeys[$pressed]
                    return
                }
            }
            if ($e.KeyCode -eq [System.Windows.Forms.Keys]::Enter -and $s.Phase -eq 'edit') {
                Invoke-SnipToolbarAction -State $s -Id 'copy'
            }
        })
}

<#
.SYNOPSIS
    显示框选遮罩并进入就地编辑，阻塞到用户结束。
.PARAMETER Bitmap
    整屏截图（虚拟桌面）。
.PARAMETER ScreenRect
    虚拟桌面矩形（X/Y 可能为负，多显示器场景）。
.PARAMETER SaveDir
    默认保存目录。
.PARAMETER CopyOnFinish
    框选完成后是否自动复制到剪贴板。
.OUTPUTS
    hashtable：Action = cancel / copy / save / pin
#>
function Show-SnipOverlay {
    param(
        [Parameter(Mandatory = $true)][System.Drawing.Bitmap]$Bitmap,
        [Parameter(Mandatory = $true)][hashtable]$ScreenRect,
        [string]$SaveDir = '',
        [bool]$CopyOnFinish = $true
    )

    $state = @{
        Bitmap      = $Bitmap
        Phase       = 'select'
        Sel         = New-Object System.Drawing.Rectangle(0, 0, 0, 0)
        Anchor      = [System.Drawing.Point]::Empty
        Tool        = 'none'
        Color       = [System.Drawing.Color]::FromArgb(255, 72, 72)
        PenWidth    = 3
        FontSize    = 14
        Annotations = New-Object System.Collections.ArrayList
        Redo        = New-Object System.Collections.ArrayList
        NumberNext  = 1
        Drag        = $null
        BusyText    = $null
        Pending     = $null
        Timer       = $null
        Action      = 'cancel'
        SaveDir     = $SaveDir
        Panel       = $null
        Buttons     = @{}
        Form        = $null
        AutoTimer   = $null
        AutoDone    = $false
    }
    $script:SnipEditor = $state

    $form = New-Object System.Windows.Forms.Form
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
    $form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
    $form.Location = New-Object System.Drawing.Point($ScreenRect.X, $ScreenRect.Y)
    $form.Size = New-Object System.Drawing.Size($ScreenRect.Width, $ScreenRect.Height)
    $form.TopMost = $true
    $form.ShowInTaskbar = $false
    $form.KeyPreview = $true
    Set-SnipDoubleBuffered -Form $form
    $form.Cursor = [System.Windows.Forms.Cursors]::Cross
    $form.BackColor = [System.Drawing.Color]::Black
    $form.Text = '截图'
    $state.Form = $form

    New-SnipToolbar -State $state -Form $form

    # ---------- 绘制：只画截图、遮罩、选区、控制点、标注 ----------
    $form.Add_Paint({
            param($sender, $e)
            $s = $script:SnipEditor
            $g = $e.Graphics
            $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
            $w = $sender.ClientSize.Width
            $h = $sender.ClientSize.Height
            # WinForms 会吞掉 paint 里的异常（表现为"少画了一块"），显式记录便于排查。
            try {
                $g.DrawImage($s.Bitmap, 0, 0, $w, $h)
                Add-SnipDim -Graphics $g -Sel $s.Sel -Width $w -Height $h

                if ($s.Phase -eq 'select') {
                    if ($s.Sel.Width -gt 0 -and $s.Sel.Height -gt 0) {
                        $pen = New-Object System.Drawing.Pen($script:SnipAccent, 1)
                        try { $g.DrawRectangle($pen, $s.Sel) } finally { $pen.Dispose() }
                        $label = '{0} × {1}' -f $s.Sel.Width, $s.Sel.Height
                        $font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)
                        $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
                        try { $g.DrawString($label, $font, $brush, ($s.Sel.Left + 6), ($s.Sel.Top + 6)) }
                        finally { $font.Dispose(); $brush.Dispose() }
                    } else {
                        $font = New-Object System.Drawing.Font('Microsoft YaHei UI', 11)
                        $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(220, 255, 255, 255))
                        $format = New-Object System.Drawing.StringFormat
                        $format.Alignment = [System.Drawing.StringAlignment]::Center
                        try {
                            $box = New-Object System.Drawing.RectangleF(0, ($h / 2 - 30), $w, 30)
                            $g.DrawString('拖动框选截图区域 · Esc 取消', $font, $brush, $box, $format)
                        } finally { $font.Dispose(); $brush.Dispose(); $format.Dispose() }
                    }
                } else {
                    # 标注只在选区内显示（超出部分被裁掉，和最终成图一致）。
                    $clip = $g.Clip
                    $g.SetClip($s.Sel)
                    foreach ($annotation in $s.Annotations) {
                        Add-SnipAnnotation -Graphics $g -Source $s.Bitmap -Annotation $annotation
                    }
                    $drag = $s.Drag
                    if ($null -ne $drag -and $drag.Mode -eq 'draw') {
                        Add-SnipAnnotation -Graphics $g -Source $s.Bitmap -Annotation $drag.Annotation
                    }
                    $g.Clip = $clip

                    $pen = New-Object System.Drawing.Pen($script:SnipAccent, 1)
                    try { $g.DrawRectangle($pen, $s.Sel) } finally { $pen.Dispose() }

                    $handleBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
                    $handlePen = New-Object System.Drawing.Pen($script:SnipAccent, 1)
                    try {
                        foreach ($handle in (Get-SnipHandles -Sel $s.Sel)) {
                            $g.FillRectangle($handleBrush, $handle.Rect)
                            $g.DrawRectangle($handlePen, $handle.Rect)
                        }
                    } finally { $handleBrush.Dispose(); $handlePen.Dispose() }
                }

                if ($null -ne $s.BusyText) {
                    $font = New-Object System.Drawing.Font('Microsoft YaHei UI', 11)
                    $back = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(232, 32, 32, 34))
                    $text = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
                    $format = New-Object System.Drawing.StringFormat
                    $format.Alignment = [System.Drawing.StringAlignment]::Center
                    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
                    try {
                        $box = New-Object System.Drawing.Rectangle([int]($w / 2 - 90), [int]($h / 2 - 24), 180, 48)
                        $g.FillRectangle($back, $box)
                        $textRect = New-Object System.Drawing.RectangleF($box.X, $box.Y, $box.Width, $box.Height)
                        $g.DrawString($s.BusyText, $font, $text, $textRect, $format)
                    } finally { $font.Dispose(); $back.Dispose(); $text.Dispose(); $format.Dispose() }
                }
            } catch {
                Write-SnipLog ('绘制异常：' + $_.Exception.Message + ' | ' + $_.ScriptStackTrace)
            }
        })

    # ---------- 鼠标 ----------
    $form.Add_MouseDown({
            param($sender, $e)
            $s = $script:SnipEditor
            if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Right) { $sender.Close(); return }
            if ($e.Button -ne [System.Windows.Forms.MouseButtons]::Left) { return }
            $point = $e.Location
            if ($s.Phase -eq 'select') {
                $s.Anchor = $point
                $s.Sel = New-Object System.Drawing.Rectangle($point.X, $point.Y, 0, 0)
                $sender.Invalidate()
                return
            }
            if ($null -ne $s.Pending) { return }

            foreach ($handle in (Get-SnipHandles -Sel $s.Sel)) {
                if ($handle.Rect.Contains($point)) {
                    $s.Drag = @{ Mode = 'resize'; Handle = $handle.Id; Start = $point; StartSel = $s.Sel }
                    return
                }
            }

            if ($s.Tool -eq 'none') {
                if ($s.Sel.Contains($point)) { $s.Drag = @{ Mode = 'move'; Start = $point; StartSel = $s.Sel } }
                return
            }

            switch ($s.Tool) {
                'text' {
                    $text = Read-SnipText -Anchor ($sender.PointToScreen($point))
                    if (-not [string]::IsNullOrWhiteSpace($text)) {
                        [void]$s.Annotations.Add([pscustomobject]@{
                                Kind = 'text'; X1 = $point.X; Y1 = $point.Y; X2 = $point.X; Y2 = $point.Y
                                Text = $text; Color = $s.Color; Width = $s.PenWidth; FontSize = $s.FontSize
                                Points = (New-Object System.Collections.ArrayList)
                            })
                        $s.Redo.Clear()
                        Update-SnipToolbar -State $s
                    }
                    $sender.Invalidate()
                }
                'number' {
                    [void]$s.Annotations.Add([pscustomobject]@{
                            Kind = 'number'; X1 = $point.X; Y1 = $point.Y; X2 = $point.X; Y2 = $point.Y
                            Text = [string]$s.NumberNext; Color = $s.Color; Width = $s.PenWidth; FontSize = $s.FontSize
                            Points = (New-Object System.Collections.ArrayList)
                        })
                    $s.NumberNext = $s.NumberNext + 1
                    $s.Redo.Clear()
                    Update-SnipToolbar -State $s
                    $sender.Invalidate()
                }
                default {
                    $points = New-Object System.Collections.ArrayList
                    [void]$points.Add($point)
                    $annotation = [pscustomobject]@{
                        Kind = $s.Tool; X1 = $point.X; Y1 = $point.Y; X2 = $point.X; Y2 = $point.Y
                        Text = ''; Color = $s.Color; Width = $s.PenWidth; FontSize = $s.FontSize
                        Points = $points
                    }
                    $s.Drag = @{ Mode = 'draw'; Annotation = $annotation }
                    $sender.Invalidate()
                }
            }
        })

    $form.Add_MouseMove({
            param($sender, $e)
            $s = $script:SnipEditor
            $point = $e.Location
            if ($s.Phase -eq 'select') {
                if ($null -ne $s.Anchor -and ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left)) {
                    $s.Sel = New-Object System.Drawing.Rectangle(
                        [Math]::Min($s.Anchor.X, $point.X), [Math]::Min($s.Anchor.Y, $point.Y),
                        [Math]::Abs($point.X - $s.Anchor.X), [Math]::Abs($point.Y - $s.Anchor.Y))
                    $sender.Invalidate()
                }
                return
            }

            if ($null -eq $s.Drag) { return }
            $drag = $s.Drag
            if ($drag.Mode -eq 'draw') {
                $annotation = $drag.Annotation
                if ($annotation.Kind -eq 'pen') { [void]$annotation.Points.Add($point) }
                $annotation.X2 = $point.X
                $annotation.Y2 = $point.Y
                $sender.Invalidate()
                return
            }
            if ($drag.Mode -eq 'move') {
                $dx = $point.X - $drag.Start.X
                $dy = $point.Y - $drag.Start.Y
                $x = [Math]::Max(0, [Math]::Min($sender.ClientSize.Width - $drag.StartSel.Width, $drag.StartSel.X + $dx))
                $y = [Math]::Max(0, [Math]::Min($sender.ClientSize.Height - $drag.StartSel.Height, $drag.StartSel.Y + $dy))
                $s.Sel = New-Object System.Drawing.Rectangle($x, $y, $drag.StartSel.Width, $drag.StartSel.Height)
                Update-SnipToolbar -State $s
                $sender.Invalidate()
                return
            }
            if ($drag.Mode -eq 'resize') {
                $dx = $point.X - $drag.Start.X
                $dy = $point.Y - $drag.Start.Y
                $left = $drag.StartSel.Left
                $top = $drag.StartSel.Top
                $right = $drag.StartSel.Right
                $bottom = $drag.StartSel.Bottom
                if ($drag.Handle.Contains('w')) { $left = $drag.StartSel.Left + $dx }
                if ($drag.Handle.Contains('e')) { $right = $drag.StartSel.Right + $dx }
                if ($drag.Handle.Contains('n')) { $top = $drag.StartSel.Top + $dy }
                if ($drag.Handle.Contains('s')) { $bottom = $drag.StartSel.Bottom + $dy }
                if ($right -lt $left) { $swap = $left; $left = $right; $right = $swap }
                if ($bottom -lt $top) { $swap = $top; $top = $bottom; $bottom = $swap }
                $left = [Math]::Max(0, $left)
                $top = [Math]::Max(0, $top)
                $right = [Math]::Min($sender.ClientSize.Width, $right)
                $bottom = [Math]::Min($sender.ClientSize.Height, $bottom)
                if (($right - $left) -ge 4 -and ($bottom - $top) -ge 4) {
                    $s.Sel = New-Object System.Drawing.Rectangle($left, $top, ($right - $left), ($bottom - $top))
                    Update-SnipToolbar -State $s
                }
                $sender.Invalidate()
            }
        })

    $form.Add_MouseUp({
            param($sender, $e)
            $s = $script:SnipEditor
            if ($e.Button -ne [System.Windows.Forms.MouseButtons]::Left) { return }
            if ($s.Phase -eq 'select') {
                if ($s.Sel.Width -ge 6 -and $s.Sel.Height -ge 6) {
                    $s.Phase = 'edit'
                    Write-SnipLog ('进入编辑态 选区=' + $s.Sel.X + ',' + $s.Sel.Y + ' ' + $s.Sel.Width + 'x' + $s.Sel.Height)
                    if ($CopyOnFinish) {
                        $copy = Get-SnipComposite -State $s
                        try { [void](Set-SnipClipboardImage -Bitmap $copy) } finally { $copy.Dispose() }
                    }
                    Update-SnipToolbar -State $s
                } else {
                    $s.Sel = New-Object System.Drawing.Rectangle(0, 0, 0, 0)
                }
                $sender.Invalidate()
                return
            }
            if ($null -ne $s.Drag) {
                $drag = $s.Drag
                if ($drag.Mode -eq 'draw') {
                    $annotation = $drag.Annotation
                    $tooSmall = ([Math]::Abs($annotation.X2 - $annotation.X1) -lt 3) -and ([Math]::Abs($annotation.Y2 - $annotation.Y1) -lt 3)
                    if ($annotation.Kind -eq 'pen') { $tooSmall = $annotation.Points.Count -lt 2 }
                    if (-not $tooSmall) {
                        [void]$s.Annotations.Add($annotation)
                        $s.Redo.Clear()
                        Update-SnipToolbar -State $s
                    }
                }
                $s.Drag = $null
                $sender.Invalidate()
            }
        })

    Add-SnipKeyBindings -Form $form

    # 识别/翻译结果异步取回（定时器轮询响应文件，避免嵌套消息循环）
    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = 150
    $state.Timer = $timer
    $timer.Add_Tick({
            $s = $script:SnipEditor
            $pending = $s.Pending
            if ($null -eq $pending) { $s.Timer.Stop(); return }
            $result = Read-SnipVisionResponse -Path $pending.ResponsePath
            if ($null -ne $result) {
                $s.Timer.Stop()
                $s.Pending = $null
                $s.BusyText = $null
                $s.Form.Invalidate()
                if ($result.ok) {
                    # 把模型名与耗时传给结果窗：页脚要标出来，慢的时候一眼看到是谁。
                    $modelName = if ($null -ne $result.model) { [string]$result.model } else { '' }
                    $elapsed = 0
                    if ($null -ne $result.elapsedMs) { [void][int]::TryParse([string]$result.elapsedMs, [ref]$elapsed) }
                    Show-SnipResult -Title $pending.Title -Text ([string]$result.text) -Translation ([string]$result.translation) -Model $modelName -ElapsedMs $elapsed
                } else {
                    [System.Windows.Forms.MessageBox]::Show([string]$result.error, '截图小工具') | Out-Null
                }
                return
            }
            if ((Get-Date) -gt $pending.Deadline) {
                $s.Timer.Stop()
                $s.Pending = $null
                $s.BusyText = $null
                $s.Form.Invalidate()
                [System.Windows.Forms.MessageBox]::Show('等待模型响应超时（120 秒），请检查模型通道配置。', '截图小工具') | Out-Null
            }
        })

    $form.Add_FormClosed({
            $script:SnipEditor.Timer.Stop()
            # 自测定时器若仍在跑，会在窗体销毁后继续截屏，必须显式停。
            if ($null -ne $script:SnipEditor.AutoTimer) { $script:SnipEditor.AutoTimer.Stop() }
        })

    # ---- 自动化自测钩子（仅当环境变量 DSH_WIN_SNIP_AUTOTEST 存在时生效）----
    # 用途：在没有人工拖框的情况下验证「选择态 → 编辑态 → 工具条出现」这条链路，
    # 并且把真实渲染结果的屏幕截图落盘，验证完自动关闭窗口。
    # 用户正常使用时该变量不存在，下面整段都不会执行。
    $autoTest = [Environment]::GetEnvironmentVariable('DSH_WIN_SNIP_AUTOTEST')
    if (-not [string]::IsNullOrWhiteSpace($autoTest)) {
        # 钩子只做三件事：给一个固定选区、切到编辑态、延时截屏后退出。
        $state.Sel = New-Object System.Drawing.Rectangle(
            [int]($ScreenRect.Width * 0.12), [int]($ScreenRect.Height * 0.15),
            [int]($ScreenRect.Width * 0.55), [int]($ScreenRect.Height * 0.45))
        $state.Phase = 'edit'
        $state.Tool = 'rect'
        $state.Annotations.Add(@{ Kind = 'rect'; Rect = (New-Object System.Drawing.Rectangle(96, 78, 320, 150)); Color = [System.Drawing.Color]::FromArgb(255, 72, 72); PenWidth = 3 }) | Out-Null
        $state.Annotations.Add(@{ Kind = 'arrow'; Start = (New-Object System.Drawing.Point(120, 300)); End = (New-Object System.Drawing.Point(360, 210)); Color = [System.Drawing.Color]::FromArgb(255, 72, 72); PenWidth = 3 }) | Out-Null

        $autoTimer = New-Object System.Windows.Forms.Timer
        $autoTimer.Interval = 900
        $autoTimer.Add_Tick({
                $s = $script:SnipEditor
                # 一次性：立刻停表并置位，否则 Close() 期间消息循环还会再触发多次。
                $s.AutoTimer.Stop()
                if ($s.AutoDone) { return }
                $s.AutoDone = $true
                $target = [Environment]::GetEnvironmentVariable('DSH_WIN_SNIP_AUTOTEST')
                try {
                    Update-SnipToolbar -State $s
                    $bounds = $s.Form.Bounds
                    $shot = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
                    $g = [System.Drawing.Graphics]::FromImage($shot)
                    try { $g.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bounds.Size) } finally { $g.Dispose() }
                    $shot.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
                    $shot.Dispose()
                    Write-SnipLog ('自测截图已保存：' + $target + ' 选区=' + $s.Sel.Width + 'x' + $s.Sel.Height + ' 工具条可见=' + $s.Panel.Visible)
                } catch {
                    Write-SnipLog ('自测截图失败：' + $_.Exception.Message)
                }
                $s.Action = 'cancel'
                $s.Form.Close()
            })
        $state.Action = 'cancel'
        $form.Add_Shown({ $state.AutoTimer = $autoTimer; $autoTimer.Start() })
    }

    $form.ShowDialog() | Out-Null
    $form.Dispose()
    return @{ Action = $state.Action }
}
