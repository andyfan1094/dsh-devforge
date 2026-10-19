# win-snip-theme.ps1 —— 「石墨 · 琥珀」主题令牌
#
# 设计定调（2026-10-19 重设计）：Windows 桌面截图/剪贴板小工具，安静、利落、可信，
# 观感对齐系统级工具（Raycast / Spotlight 那类），而不是营销页或「AI 仪表盘」。
# 三旋钮：DESIGN_VARIANCE 4 / MOTION_INTENSITY 2 / VISUAL_DENSITY 4。
#
# 规则（不做的事）：
#   - 不用默认靛蓝当强调色；全工具只有一个强调色（琥珀 #E2A45C），选中/主操作才用。
#   - 不用纯黑/纯白做底；深灰偏暖，正文对比度 ≥ 4.5:1。
#   - 不用渐变、发光、emoji 图标；层与层之间靠 1px 发丝描边和轻微底色差区分。
#   - 圆角统一：卡片 10、控件 7、键帽 4。
#   - 原生窗口不做花哨动效：只有 hover / active 的瞬时变化（MOTION_INTENSITY 2）。

if (-not ('SnipThemeMarker' -as [type])) {
    Add-Type -TypeDefinition @'
public static class SnipThemeMarker { }
'@
}

$script:SnipTheme = [ordered]@{
    Canvas     = [System.Drawing.Color]::FromArgb(20, 20, 22)
    Surface    = [System.Drawing.Color]::FromArgb(27, 27, 31)
    Raised     = [System.Drawing.Color]::FromArgb(35, 35, 40)
    Hairline   = [System.Drawing.Color]::FromArgb(47, 47, 53)
    Text       = [System.Drawing.Color]::FromArgb(239, 239, 241)
    Text2      = [System.Drawing.Color]::FromArgb(163, 163, 171)
    Muted      = [System.Drawing.Color]::FromArgb(111, 111, 120)
    Accent     = [System.Drawing.Color]::FromArgb(226, 164, 92)
    AccentInk  = [System.Drawing.Color]::FromArgb(26, 20, 8)
    Danger     = [System.Drawing.Color]::FromArgb(224, 106, 91)
    RadiusCard = 10
    RadiusCtrl = 7
}

<#
.SYNOPSIS
    取主题色；名字不存在时返回中灰，避免一个笔误把界面变成黑块。
#>
function Get-SnipTheme {
    param([Parameter(Mandatory = $true)][string]$Name)
    if ($script:SnipTheme.Contains($Name)) { return $script:SnipTheme[$Name] }
    return [System.Drawing.Color]::FromArgb(128, 128, 128)
}

<#
.SYNOPSIS
    统一字体入口：中文一律 Microsoft YaHei UI（系统自带，不需要额外安装）。
#>
function New-SnipUiFont {
    param(
        [single]$Size = 9,
        [ValidateSet('Regular', 'Bold')][string]$Style = 'Regular'
    )
    $fontStyle = if ($Style -eq 'Bold') { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
    return New-Object System.Drawing.Font('Microsoft YaHei UI', $Size, $fontStyle, [System.Drawing.GraphicsUnit]::Point)
}

<#
.SYNOPSIS
    圆角矩形路径（半径自动收敛，避免小尺寸算出非法弧）。
#>
function New-SnipRoundPath {
    param(
        [Parameter(Mandatory = $true)][System.Drawing.Rectangle]$Bounds,
        [int]$Radius = 8
    )
    $d = [Math]::Max(1, $Radius * 2)
    if ($d -gt $Bounds.Width) { $d = $Bounds.Width }
    if ($d -gt $Bounds.Height) { $d = $Bounds.Height }
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($Bounds.X, $Bounds.Y, $d, $d, 180, 90)
    $path.AddArc($Bounds.Right - $d, $Bounds.Y, $d, $d, 270, 90)
    $path.AddArc($Bounds.Right - $d, $Bounds.Bottom - $d, $d, $d, 0, 90)
    $path.AddArc($Bounds.X, $Bounds.Bottom - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

<#
.SYNOPSIS
    给无边框窗体切圆角。Region 是硬裁切，边角会有轻微锯齿，但比直角更贴整体语言。
#>
function Set-SnipRoundedRegion {
    param(
        [Parameter(Mandatory = $true)]$Form,
        [int]$Radius = 12
    )
    try {
        $rect = New-Object System.Drawing.Rectangle(0, 0, $Form.Width, $Form.Height)
        $path = New-SnipRoundPath -Bounds $rect -Radius $Radius
        $old = $Form.Region
        $Form.Region = New-Object System.Drawing.Region($path)
        if ($null -ne $old) { $old.Dispose() }
        $path.Dispose()
    } catch {
        # 圆角失败只影响观感，不影响功能。
    }
}
