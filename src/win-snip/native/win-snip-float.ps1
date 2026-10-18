# win-snip-float.ps1 —— 钉图浮窗
#
# 置顶无边框窗口：拖动移动、滚轮缩放、Esc / 双击 / 右键关闭。
# 支持多张同时钉住；窗口引用挂在 $global:SnipFloats，避免被回收。

<#
.SYNOPSIS
    钉一张图到桌面最上层。
.PARAMETER Bitmap
    要显示的位图（调用方不再复用它）。
.PARAMETER Origin
    初始左上角坐标；缺省时按已钉数量错开摆放。
#>
function Show-SnipFloat {
    param(
        [Parameter(Mandatory = $true)][System.Drawing.Bitmap]$Bitmap,
        [System.Drawing.Point]$Origin = ([System.Drawing.Point]::Empty)
    )
    $form = New-SnipDarkForm
    $form.Text = '钉图'
    $form.Cursor = [System.Windows.Forms.Cursors]::SizeAll
    $form.KeyPreview = $true

    $state = @{
        Bitmap = $Bitmap
        Scale  = 1.0
        Drag   = $false
        Offset = [System.Drawing.Point]::Empty
    }

    # 初始尺寸：默认 1:1，超过屏幕可用区域的 85% 时按比例缩小。
    $work = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position).WorkingArea
    $maxWidth = [int]($work.Width * 0.85)
    $maxHeight = [int]($work.Height * 0.85)
    $scale = 1.0
    if ($Bitmap.Width -gt $maxWidth) { $scale = [Math]::Min($scale, $maxWidth / $Bitmap.Width) }
    if ($Bitmap.Height -gt $maxHeight) { $scale = [Math]::Min($scale, $maxHeight / $Bitmap.Height) }
    $state.Scale = $scale
    $form.Width = [Math]::Max(40, [int]($Bitmap.Width * $scale))
    $form.Height = [Math]::Max(40, [int]($Bitmap.Height * $scale))

    if ($Origin -eq [System.Drawing.Point]::Empty) {
        $offset = 40 * ($global:SnipFloats.Count % 8)
        $x = $work.X + [int](($work.Width - $form.Width) / 2) + $offset
        $y = $work.Y + [int](($work.Height - $form.Height) / 2) + $offset
        $form.Location = New-Object System.Drawing.Point($x, $y)
    } else {
        $form.Location = $Origin
    }

    $form.Add_Paint({
            param($sender, $e)
            $g = $e.Graphics
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $target = New-Object System.Drawing.Rectangle(0, 0, $sender.ClientSize.Width, $sender.ClientSize.Height)
            $g.DrawImage($state.Bitmap, $target)
            $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(90, 255, 255, 255), 1)
            try { $g.DrawRectangle($pen, 0, 0, $sender.ClientSize.Width - 1, $sender.ClientSize.Height - 1) } finally { $pen.Dispose() }
        })

    $form.Add_MouseDown({
            param($sender, $e)
            if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Right) { $sender.Close(); return }
            if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
                $state.Drag = $true
                $state.Offset = $e.Location
                $sender.Activate()
            }
        })

    $form.Add_MouseMove({
            param($sender, $e)
            if ($state.Drag) {
                $screenPoint = $sender.PointToScreen($e.Location)
                $sender.Location = New-Object System.Drawing.Point(($screenPoint.X - $state.Offset.X), ($screenPoint.Y - $state.Offset.Y))
            }
        })

    $form.Add_MouseUp({
            param($sender, $e)
            $state.Drag = $false
        })

    $form.Add_MouseWheel({
            param($sender, $e)
            $factor = if ($e.Delta -gt 0) { 1.1 } else { 0.9 }
            $next = [Math]::Min(6.0, [Math]::Max(0.15, $state.Scale * $factor))
            if ([Math]::Abs($next - $state.Scale) -lt 0.001) { return }
            $state.Scale = $next
            $sender.Width = [Math]::Max(40, [int]($state.Bitmap.Width * $next))
            $sender.Height = [Math]::Max(40, [int]($state.Bitmap.Height * $next))
            $sender.Invalidate()
        })

    $form.Add_KeyDown({
            param($sender, $e)
            if ($e.KeyCode -eq [System.Windows.Forms.Keys]::Escape) { $sender.Close() }
        })

    $form.Add_DoubleClick({
            param($sender, $e)
            $sender.Close()
        })

    $form.Add_FormClosed({
            param($sender, $e)
            [void]$global:SnipFloats.Remove($sender)
            try { $state.Bitmap.Dispose() } catch { }
        })

    [void]$global:SnipFloats.Add($form)
    $form.Show()
    $form.Activate()
    Write-SnipLog ('钉图窗口已创建：' + $form.Width + 'x' + $form.Height)
}
