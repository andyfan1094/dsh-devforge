# win-snip-common.ps1 —— 截图小工具公共层
#
# 约定：本文件与其它 win-snip-*.ps1 一律以 UTF-8 with BOM 保存。
# 无 BOM 时 Windows PowerShell 5.1 会按 ANSI 解码中文注释，脚本会静默出错。
#
# 提供：P/Invoke 声明、日志、心跳、屏幕抓取、识别/翻译文件队列、绘图辅助。

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (-not ('WinSnipNative' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WinSnipNative {
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)]
    public struct MSG {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public POINT pt;
    }
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
    [DllImport("user32.dll")]
    public static extern bool PeekMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax, uint wRemoveMsg);
    [DllImport("user32.dll")]
    public static extern bool TranslateMessage(ref MSG lpMsg);
    [DllImport("user32.dll")]
    public static extern IntPtr DispatchMessage(ref MSG lpMsg);
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
}
'@
}

# 低级键盘钩子：别的程序装了键盘钩子时，RegisterHotKey 会"注册成功但收不到按键"。
# 实测（2026-10-18）：开着英雄联盟客户端 / wegame / RustDesk 时，Alt+A 注册返回成功，
# 但按键永远到不了热键，被那些程序的键盘钩子提前消费掉了。
# 后安装的 WH_KEYBOARD_LL 在钩子链上排前面，能先拿到按键，因此作为主通道。
if (-not ('WinSnipHook' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class WinSnipHook {
    public delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll")]
    public static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Auto)]
    public static extern IntPtr GetModuleHandle(string lpModuleName);
    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vKey);

    [StructLayout(LayoutKind.Sequential)]
    public struct KBDLLHOOKSTRUCT {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    public const int WH_KEYBOARD_LL = 13;
    public const int WM_KEYDOWN = 0x0100;
    public const int WM_SYSKEYDOWN = 0x0104;

    static IntPtr hook = IntPtr.Zero;
    static LowLevelKeyboardProc proc;
    static uint mods = 0;
    static uint vk = 0;
    static volatile bool hit = false;
    static volatile int lastError = 0;

    public static void Configure(uint modifiers, uint virtualKey) { mods = modifiers; vk = virtualKey; }
    public static int LastError() { return lastError; }

    // 取走一次命中标记：只触发一次截图，避免长按连发。
    public static bool ConsumeHit() {
        if (hit) { hit = false; return true; }
        return false;
    }

    public static bool Install() {
        if (hook != IntPtr.Zero) return true;
        proc = new LowLevelKeyboardProc(Callback);
        hook = SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(null), 0);
        if (hook == IntPtr.Zero) { lastError = Marshal.GetLastWin32Error(); return false; }
        return true;
    }

    public static void Uninstall() {
        if (hook != IntPtr.Zero) { UnhookWindowsHookEx(hook); hook = IntPtr.Zero; }
        proc = null;
    }

    static bool Down(int vkCode) { return (GetAsyncKeyState(vkCode) & 0x8000) != 0; }

    // 修饰键必须精确匹配：配 Alt+A 时，Ctrl+Alt+A 不会误触发。
    static bool ModifiersMatch() {
        bool alt = Down(0x12);
        bool ctrl = Down(0x11);
        bool shift = Down(0x10);
        bool win = Down(0x5B) || Down(0x5C);
        if (((mods & 1) != 0) != alt) return false;
        if (((mods & 2) != 0) != ctrl) return false;
        if (((mods & 4) != 0) != shift) return false;
        if (((mods & 8) != 0) != win) return false;
        return true;
    }

    static IntPtr Callback(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0) {
            int msg = wParam.ToInt32();
            if (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN) {
                KBDLLHOOKSTRUCT data = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
                if (data.vkCode == vk && ModifiersMatch()) {
                    hit = true;
                    // 返回 1 = 已处理：按键不再传给后面的人和系统，避免同时触发别的程序。
                    return (IntPtr)1;
                }
            }
        }
        return CallNextHookEx(hook, nCode, wParam, lParam);
    }
}
'@
}

# WM_HOTKEY
$script:SnipWmHotkey = 0x0312
# PM_REMOVE
$script:SnipPmRemove = 0x0001

# 运行期共享状态：助手主循环与各窗口都写这一份，心跳据此生成。
if ($null -eq $global:SnipStats) {
    $global:SnipStats = @{
        BaseDir         = ''
        Hotkey          = ''
        StartedAt       = (Get-Date).ToString('o')
        Captures        = 0
        LastCaptureAt   = $null
        State           = 'idle'
        Error           = $null
        # 剪贴板历史：条数与最近记录时间由采集层写入，心跳带给宿主面板。
        ClipboardItems  = 0
        LastClipboardAt = $null
        ClipboardDays   = 15
    }
}

# 钉住的浮窗需要持有引用，否则会被回收自动消失。
if ($null -eq $global:SnipFloats) { $global:SnipFloats = New-Object System.Collections.ArrayList }

<#
.SYNOPSIS
    追加一行运行日志（不含任何凭据）。
.DESCRIPTION
    日志超过 2MB 时直接截断重开，避免长期运行把磁盘写满。
#>
function Write-SnipLog {
    param([string]$Message)
    try {
        $baseDir = [string]$global:SnipStats.BaseDir
        if ($baseDir -eq '') { return }
        $dir = Join-Path $baseDir 'logs'
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
        $path = Join-Path $dir 'assistant.log'
        if ((Test-Path $path) -and ((Get-Item $path).Length -gt 2MB)) { Remove-Item $path -Force -ErrorAction SilentlyContinue }
        $line = '{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $Message
        $utf8 = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::AppendAllText($path, $line + [Environment]::NewLine, $utf8)
    } catch { }
}

<#
.SYNOPSIS
    安装进程级异常兜底，避免一个回调出错就直接弹崩溃框终止整个助手。
.DESCRIPTION
    硬教训（2026-10-18）：钉图窗口的鼠标回调里给状态对象赋属性时取不到对象，
    WinForms 把该异常当成未处理异常，弹出 .NET 崩溃对话框并结束进程，
    连带整个桌面端都不稳。装上 ThreadException 兜底后，同类错误只记日志、不再致命。
#>
function Enable-SnipCrashGuard {
    if ($script:SnipCrashGuardInstalled) { return }
    $script:SnipCrashGuardInstalled = $true
    try {
        [System.Windows.Forms.Application]::add_ThreadException({
                param($sender, $e)
                $detail = if ($null -ne $e -and $null -ne $e.Exception) { $e.Exception.Message } else { '未知界面异常' }
                Write-SnipLog ('界面回调异常（已拦截，助手继续运行）：' + $detail)
            })
    } catch { }
    try {
        [AppDomain]::CurrentDomain.add_UnhandledException({
                param($sender, $e)
                $detail = if ($null -ne $e -and $null -ne $e.ExceptionObject) { [string]$e.ExceptionObject } else { '未知异常' }
                Write-SnipLog ('未处理异常（已拦截）：' + $detail)
            })
    } catch { }
}

<#
.SYNOPSIS
    写心跳文件（宿主用它判断助手存活与读取截图次数）。
#>
function Update-SnipHeartbeat {
    try {
        $s = $global:SnipStats
        if ([string]$s.BaseDir -eq '') { return }
        $payload = [ordered]@{
            pid       = $PID
            hotkey    = [string]$s.Hotkey
            startedAt = [string]$s.StartedAt
            captures  = [int]$s.Captures
            state     = [string]$s.State
        }
        if ($null -ne $s.LastCaptureAt) { $payload['lastCaptureAt'] = [string]$s.LastCaptureAt }
        if ($null -ne $s.Error -and ([string]$s.Error) -ne '') { $payload['error'] = [string]$s.Error }
        # 剪贴板历史汇总：宿主面板据此显示「N 条 · 最近一次」。
        if ($null -ne $s.ClipboardItems) { $payload['clipboardItems'] = [int]$s.ClipboardItems }
        if ($null -ne $s.LastClipboardAt) { $payload['lastClipboardAt'] = [string]$s.LastClipboardAt }
        if ($null -ne $s.ClipboardDays) { $payload['clipboardDays'] = [int]$s.ClipboardDays }
        $json = $payload | ConvertTo-Json -Compress
        $utf8 = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText((Join-Path $s.BaseDir 'status.json'), $json, $utf8)
    } catch { }
}

<#
.SYNOPSIS
    取整块虚拟桌面矩形（支持多显示器与负坐标）。
#>
function Get-SnipVirtualScreen {
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    return @{ X = $bounds.X; Y = $bounds.Y; Width = $bounds.Width; Height = $bounds.Height }
}

<#
.SYNOPSIS
    抓取整块虚拟桌面。
#>
function Capture-SnipScreen {
    $rect = Get-SnipVirtualScreen
    if ($rect.Width -le 0 -or $rect.Height -le 0) { throw '无法读取虚拟桌面尺寸。' }
    $bmp = New-Object System.Drawing.Bitmap($rect.Width, $rect.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
        $g.CopyFromScreen($rect.X, $rect.Y, 0, 0, $bmp.Size)
    } finally {
        $g.Dispose()
    }
    return $bmp
}

<#
.SYNOPSIS
    确保目录存在。
#>
function Ensure-SnipDir {
    param([string]$Path)
    if (-not (Test-Path $Path)) { New-Item -ItemType Directory -Force -Path $Path | Out-Null }
}

<#
.SYNOPSIS
    把图片交给宿主做识别/翻译，返回待取结果的调用句柄。
.DESCRIPTION
    通信协议：requests/<id>.png + requests/<id>.json 交出去，稍后轮询 responses/<id>.json。
    这里只负责"提交"，等待由界面用定时器完成——在鼠标事件里嵌套消息泵会引入重入风险。
.PARAMETER Kind
    ocr 或 translate。
.PARAMETER Bitmap
    已合成好的图片（选区 + 标注）。
.PARAMETER TargetLang
    翻译目标语言；留空表示由宿主按面板配置决定。
.OUTPUTS
    hashtable：ok / id / responsePath / error
#>
function New-SnipVisionRequest {
    param(
        [Parameter(Mandatory = $true)][string]$Kind,
        [Parameter(Mandatory = $true)][System.Drawing.Bitmap]$Bitmap,
        [string]$TargetLang = ''
    )
    $baseDir = [string]$global:SnipStats.BaseDir
    $requests = Join-Path $baseDir 'requests'
    $responses = Join-Path $baseDir 'responses'
    Ensure-SnipDir $requests
    Ensure-SnipDir $responses
    $id = [Guid]::NewGuid().ToString('N')
    $pngPath = Join-Path $requests ($id + '.png')
    try {
        # 先落原图，再缩一份给模型用：原图要留档，缩图只为提速。
        $Bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
        $sendPath = Resize-SnipImage -SourcePath $pngPath -TargetPath (Join-Path $requests ($id + '-small.png'))
        $payload = [ordered]@{ id = $id; kind = $Kind; imagePath = $sendPath }
        if ($TargetLang -ne '') { $payload['targetLang'] = $TargetLang }
        $utf8 = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText((Join-Path $requests ($id + '.json')), ($payload | ConvertTo-Json -Compress), $utf8)
    } catch {
        return @{ ok = $false; error = ('提交识别请求失败：' + $_.Exception.Message) }
    }
    return @{ ok = $true; id = $id; responsePath = (Join-Path $responses ($id + '.json')) }
}

<#
.SYNOPSIS
    读取宿主回写的识别/翻译结果。
.DESCRIPTION
    文件不存在或尚不可解析时返回 $null（调用方下一轮再试）。
#>
function Read-SnipVisionResponse {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path $Path)) { return $null }
    try {
        $raw = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
        $result = $raw | ConvertFrom-Json
        Remove-Item $Path -Force -ErrorAction SilentlyContinue
        return $result
    } catch {
        # 文件可能正被写入，下一轮再读。
        return $null
    }
}

<#
.SYNOPSIS
    把待识别的图片缩到合适尺寸并返回新路径。
.DESCRIPTION
    整屏 2560x1440 的 PNG 发给模型又慢又贵，而且视觉 token 随像素线性增长。
    实测（2026-10-18，同一张中文表格图）：
      - 900 宽  → GLM-Flash 4.2 秒
      - 1400 宽 → 4.8 秒，但开始混用全角空格
      - 760 宽  → 3.3 秒，半角空格更规整
    所以默认缩到长边不超过 1400、且保持原比例：够清楚，又不至于拖慢。
    缩放失败时返回原路径，识别照常进行（不能因为缩图失败就不干活）。
.PARAMETER SourcePath
    原始图片绝对路径。
.PARAMETER TargetPath
    缩放后写出的绝对路径（通常与请求同目录）。
.PARAMETER MaxEdge
    长边上限像素，默认 1400。
#>
function Resize-SnipImage {
    param(
        [Parameter(Mandatory = $true)][string]$SourcePath,
        [Parameter(Mandatory = $true)][string]$TargetPath,
        [int]$MaxEdge = 1400
    )
    try {
        $source = [System.Drawing.Image]::FromFile($SourcePath)
        try {
            $longEdge = [Math]::Max($source.Width, $source.Height)
            # 已经够小就不用重采样，避免白白损失清晰度。
            if ($longEdge -le $MaxEdge) { return $SourcePath }
            $scale = $MaxEdge / $longEdge
            $width = [int][Math]::Round($source.Width * $scale)
            $height = [int][Math]::Round($source.Height * $scale)
            $target = New-Object System.Drawing.Bitmap($width, $height)
            try {
                $graphics = [System.Drawing.Graphics]::FromImage($target)
                try {
                    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                    $graphics.DrawImage($source, 0, 0, $width, $height)
                } finally { $graphics.Dispose() }
                $target.Save($TargetPath, [System.Drawing.Imaging.ImageFormat]::Png)
            } finally { $target.Dispose() }
            return $TargetPath
        } finally { $source.Dispose() }
    } catch {
        # 缩图失败就发原图，功能优先。
        return $SourcePath
    }
}
<#
.SYNOPSIS
    把位图放进剪贴板，让所有程序都能粘贴出图片。
.DESCRIPTION
    辉哥反馈"图像黏贴也不行"。实测下来 .NET 的 Clipboard 类在这个场景根本不可靠：
      - Clipboard::SetImage 只给 CF_BITMAP，微信/飞书/浏览器读的是 CF_DIB 或 PNG，
        于是"复制成功但粘贴没图"；
      - Clipboard::SetDataObject 在无消息泵的宿主里直接抛"所请求的剪贴板操作失败"，
        实测 9 秒后失败，而截图的复制动作就在这条路上。
    所以改用纯 Win32 API：OpenClipboard + EmptyClipboard + SetClipboardData，
    一次写入 CF_DIB、PNG、CF_DIBV5 三种格式。实测整屏 2560x1440 只要约 100ms，
    并且 .NET、画图、浏览器都能读到。
.PARAMETER Bitmap
    要复制的位图；函数内部自己编码，调用方可以安全 Dispose 原图。
.RETURNS
    成功返回 $true，失败返回 $false（原因写入日志，不抛异常打断截图流程）。
#>
function Set-SnipClipboardImage {
    param([Parameter(Mandatory = $true)][System.Drawing.Bitmap]$Bitmap)

    if (-not ('SnipClipboard' -as [type])) {
        <#
            注意：无命名空间的静态类用 '-as [type]' 判断会失效（会每次重新编译，
            实测让单次复制多花 1.6 秒），所以用 AppDomain 里按全名查找。
        #>
        $existing = [AppDomain]::CurrentDomain.GetAssemblies() |
            ForEach-Object { $_.GetType('SnipClipboard', $false) } |
            Where-Object { $null -ne $_ } |
            Select-Object -First 1
        if ($null -eq $existing) {
            # C# 源码放在同目录的 win-snip-clipboard.cs，构建时一并复制过来。
            $sourcePath = Join-Path $PSScriptRoot 'win-snip-clipboard.cs'
            if (-not (Test-Path $sourcePath)) {
                Write-SnipLog ('剪贴板源码缺失：' + $sourcePath)
                return $false
            }
            Add-Type -TypeDefinition ([System.IO.File]::ReadAllText($sourcePath, [System.Text.Encoding]::UTF8)) -ReferencedAssemblies System.Drawing, System.Drawing.Primitives, System.Runtime.InteropServices
        }
    }

    $errorText = ''
    try {
        $ok = [SnipClipboard]::SetImage($Bitmap, [ref]$errorText)
        if (-not $ok) { Write-SnipLog ('复制图片失败：' + $errorText) }
        return $ok
    } catch {
        Write-SnipLog ('复制图片异常：' + $_.Exception.Message)
        return $false
    }
}
<#
.SYNOPSIS
    判断一个字体是否真的"中文恰好是半角的 2 倍宽"。
.DESCRIPTION
    layout.ts 是按"全角=2、半角=1"这个假设补空格的，字体比例不对，列就会错位。
    光看字体名不可靠：不同 Windows 版本、不同语言版本装的字体集合完全不同
    （本机是 zh-CN，微软雅黑 msyh.ttc 在；英文版 Windows 则可能只有 Segoe UI）。
    所以这里直接量字宽做判断。允许 1.85~2.15 的偏差，覆盖 GDI 取整误差。
#>
function Test-SnipMonoFont {
    param([Parameter(Mandatory = $true)][System.Drawing.Font]$Font)

    $flags = [System.Windows.Forms.TextFormatFlags]::NoPadding
    $measure = {
        param([string]$Chars, [int]$Repeat)
        $text = $Chars * $Repeat
        $size = New-Object System.Drawing.Size(9000, 200)
        return [double][System.Windows.Forms.TextRenderer]::MeasureText($text, $Font, $size, $flags).Width / $Repeat
    }

    # 全角、半角各量 20 个字符取平均，单字测量有取整误差，会误判。
    $full = & $measure '名' 20
    $half = & $measure 'M' 20
    if ($half -le 0) { return $false }

    # 半角必须彼此等宽（M 与数字 8 等宽），否则是比例字体。
    $digit = & $measure '8' 20
    if ([Math]::Abs($half - $digit) -gt 0.3) { return $false }

    $ratio = $full / $half
    return ($ratio -ge 1.85 -and $ratio -le 2.15)
}

<#
.SYNOPSIS
    取一个用于"按原排版看文字"的等宽字体。
.DESCRIPTION
    识别结果要还原截图的排版（缩进、表格列对齐），比例字体会让空格宽度不等，
    排版必然错乱，所以结果窗必须用等宽字体。
    候选里既有 MS Gothic（英文版 Windows 自带），也有 NSimSun 新宋体 /
    SimSun 宋体（中文版 Windows 常见），逐个用 Test-SnipMonoFont 实测，
    只有真满足"全角=2 半角"才采用，避免换台机器列就错位。
    所有候选都不合格时，退回系统 UI 字体：排版可能不完美，但窗口一定能打开。
.PARAMETER Text
    用来判断是否需要中文字形的正文。
.PARAMETER Size
    字号，默认 10。
#>
function New-SnipMonoFont {
    param(
        [string]$Text = '',
        [single]$Size = 10
    )
    $hasCjk = $Text -match '[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]'
    # 中文字体排在 MS Gothic 前面：MS Gothic 是日文字体，中文用它渲染是日文字形。
    $candidates = if ($hasCjk) {
        @('NSimSun', 'SimSun', 'MS Gothic', 'Cascadia Mono', 'Consolas')
    } else {
        @('Cascadia Mono', 'Consolas', 'Courier New')
    }
    foreach ($name in $candidates) {
        try {
            $font = New-Object System.Drawing.Font($name, $Size)
            # GDI+ 找不到字体不抛异常，而是静默换成别的字体，所以要看名字。
            # 注意本地化字体名：请求 NSimSun 拿到的是"新宋体"，此时用字宽实测来确认。
            $nameOk = ($font.Name -eq $name) -or (Test-SnipMonoFont -Font $font)
            if (-not $nameOk) { $font.Dispose(); continue }
            # 纯西文场景不要求全角比例；有中文时必须实测通过，否则换下一个候选。
            if (-not $hasCjk -or (Test-SnipMonoFont -Font $font)) { return $font }
            $font.Dispose()
        } catch { }
    }
    foreach ($fallback in @('Microsoft YaHei UI', 'Microsoft YaHei', 'Segoe UI')) {
        try {
            $font = New-Object System.Drawing.Font($fallback, $Size)
            if ($font.Name -eq $fallback) { return $font }
            $font.Dispose()
        } catch { }
    }
    return New-Object System.Drawing.Font([System.Drawing.FontFamily]::GenericMonospace, $Size)
}

<#
.SYNOPSIS
    取界面与正文字体：优先微软雅黑。
.DESCRIPTION
    辉哥要求正文也用微软雅黑。雅黑不是等宽字体：实测汉字 14.45px、空格 4.45px
    （空格只有汉字的 0.31 宽），所以"用空格对齐"的识别结果直接显示会往前缩、列错位。
    解决办法不是换字体，而是保留雅黑、按实测字宽重算空格（见 Format-SnipAlignedText）。
#>
function New-SnipTextFont {
    param(
        [single]$Size = 10.5,
        [System.Drawing.FontStyle]$Style = [System.Drawing.FontStyle]::Regular
    )
    foreach ($name in @('Microsoft YaHei UI', 'Microsoft YaHei', 'DengXian', 'SimSun', 'Segoe UI')) {
        try {
            $font = New-Object System.Drawing.Font($name, $Size, $Style)
            # GDI+ 找不到字体不报错，会静默替换；比对名字确认真的拿到了。
            if ($font.Name -eq $name) { return $font }
            $font.Dispose()
        } catch { }
    }
    return New-Object System.Drawing.Font([System.Drawing.FontFamily]::GenericSansSerif, $Size, $Style)
}

<#
.SYNOPSIS
    判断一个字符占几格（识别结果按"全角=2 格、半角=1 格"排版）。
#>
function Get-SnipCellWidth {
    param([char]$Char)
    $code = [int]$Char
    if (($code -ge 0x2E80 -and $code -le 0xA4CF) -or
        ($code -ge 0xAC00 -and $code -le 0xD7A3) -or
        ($code -ge 0xF900 -and $code -le 0xFAFF) -or
        ($code -ge 0xFE30 -and $code -le 0xFE6F) -or
        ($code -ge 0xFF00 -and $code -le 0xFF60) -or
        ($code -ge 0xFFE0 -and $code -le 0xFFE6)) {
        return 2
    }
    return 1
}

<#
.SYNOPSIS
    量一个字符的推进宽度（重复 20 次取平均）。
.DESCRIPTION
    必须重复取平均：GDI 对极短字符串会加上边缘留白，单字符测量严重虚高
    （微软雅黑 10.5 号下，单个空格量出 13px，真实值只有 4.45px；
    单个汉字量出 23px，真实 14.45px）。用单字符读数算出来的排版必然是错的。
.PARAMETER Cache
    调用方传入并复用同一个哈希表，避免每次重算。
#>
function Get-SnipCharAdvance {
    param(
        [Parameter(Mandatory = $true)][System.Drawing.Font]$Font,
        [Parameter(Mandatory = $true)][hashtable]$Cache,
        [Parameter(Mandatory = $true)][char]$Char
    )
    $key = [string]$Char
    if ($Cache.ContainsKey($key)) { return [double]$Cache[$key] }

    $flags = [System.Windows.Forms.TextFormatFlags]::NoPadding
    $probe = New-Object System.Drawing.Size(20000, 200)
    $width = [double][System.Windows.Forms.TextRenderer]::MeasureText(($key * 20), $Font, $probe, $flags).Width / 20.0
    $Cache[$key] = $width
    return $width
}

<#
.SYNOPSIS
    按字符推进宽度累加，算出一行文本的渲染宽度。
.DESCRIPTION
    比直接 MeasureText 整行更稳：短行不会被边缘留白虚高（"合计" 这种两字行尤其明显），
    结果窗宽度是按最长行算的，虚高会让窗口无谓变宽。
#>
function Measure-SnipLineWidth {
    param(
        [string]$Line,
        [System.Drawing.Font]$Font,
        [hashtable]$Cache
    )
    if ([string]::IsNullOrEmpty($Line)) { return 0.0 }
    $total = 0.0
    foreach ($ch in $Line.ToCharArray()) { $total += Get-SnipCharAdvance -Font $Font -Cache $Cache -Char $ch }
    return $total
}

<#
.SYNOPSIS
    把"靠空格对齐"的识别文本，按目标字体的实测字宽重算每段空格数。
.DESCRIPTION
    模型按"全角=2 格"补空格，等宽字体下正好列对齐。微软雅黑的空格只有汉字的 0.31 宽
    （4.45px vs 14.45px），直接显示会让每列往前缩、表格散架。这里逐行重算：
      1. 按格子数算出每个空格段结束时应到达的横向位置（格数 × 半字宽）；
      2. 用当前已排宽度与目标位置之差，除以目标字体空格的真实宽度，得到要补几个空格。
    每一列都按绝对位置对齐，误差不会累积（最大不超过一个空格宽）。
    所有宽度都来自"按字符测量累加"，不量前缀字符串，避免短串虚高。
    注意：只有显示用这份重排后的文本；复制走的仍是原始文本。
#>
function Format-SnipAlignedText {
    param([string]$Content, [System.Drawing.Font]$Font)

    if ([string]::IsNullOrEmpty($Content)) { return $Content }
    # 字体本身就满足"全角=2 半角"时，原空格已经能对齐，不动它。
    if (Test-SnipMonoFont -Font $Font) { return $Content }

    $cache = @{}
    $cell = (Get-SnipCharAdvance -Font $Font -Cache $cache -Char '名') / 2.0
    $spaceW = Get-SnipCharAdvance -Font $Font -Cache $cache -Char ' '
    if ($cell -le 0 -or $spaceW -le 0) { return $Content }

    $result = New-Object System.Collections.ArrayList
    foreach ($line in [regex]::Split($Content, "`r?`n")) {
        # 没有连续空格的行不用补（缩进与分栏都靠连续空格）。
        if ($line -notmatch '  ') { [void]$result.Add($line); continue }

        $sb = New-Object System.Text.StringBuilder
        $cells = 0
        $current = 0.0
        $i = 0
        while ($i -lt $line.Length) {
            $ch = $line[$i]
            if ($ch -eq ' ') {
                while ($i -lt $line.Length -and $line[$i] -eq ' ') { $cells += 1; $i++ }
                $target = $cells * $cell
                $count = [int][Math]::Round(($target - $current) / $spaceW)
                if ($count -lt 1) { $count = 1 }
                [void]$sb.Append(' ' * $count)
                $current += $count * $spaceW
            } else {
                [void]$sb.Append($ch)
                $current += Get-SnipCharAdvance -Font $Font -Cache $cache -Char $ch
                $cells += Get-SnipCellWidth -Char $ch
                $i++
            }
        }
        [void]$result.Add($sb.ToString())
    }
    return ($result -join "`r`n")
}
<#
.SYNOPSIS
    生成一个深色小窗（结果窗、浮窗、输入框共用的外观基线）。
#>
function New-SnipDarkForm {
    $form = New-Object System.Windows.Forms.Form
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
    $form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
    $form.BackColor = [System.Drawing.Color]::FromArgb(32, 32, 34)
    $form.TopMost = $true
    $form.ShowInTaskbar = $false
    $form.Font = New-SnipTextFont -Size 9
    return $form
}

<#
.SYNOPSIS
    给窗口开启双缓冲。
.DESCRIPTION
    Control.DoubleBuffered 是 protected 属性，PowerShell 不能直接赋值，只能走反射；
    自绘窗口不开双缓冲会明显闪烁。
#>
function Set-SnipDoubleBuffered {
    param([Parameter(Mandatory = $true)]$Form)
    try {
        $flags = [System.Reflection.BindingFlags]::Instance -bor [System.Reflection.BindingFlags]::NonPublic -bor [System.Reflection.BindingFlags]::Public
        $property = $Form.GetType().GetProperty('DoubleBuffered', $flags)
        if ($null -ne $property -and $property.CanWrite) { $property.SetValue($Form, $true, $null) }
    } catch {
        # 开不起来只影响观感，不影响功能。
    }
}

<#
.SYNOPSIS
    把截图保存为 PNG 并返回路径。
#>
function Save-SnipBitmap {
    param(
        [Parameter(Mandatory = $true)][System.Drawing.Bitmap]$Bitmap,
        [Parameter(Mandatory = $true)][string]$Directory
    )
    Ensure-SnipDir $Directory
    $name = '截图-' + (Get-Date).ToString('yyyyMMdd-HHmmss') + '.png'
    $path = Join-Path $Directory $name
    $Bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    return $path
}

# 控件库（自定义图标按钮/工具条容器），必须在使用之前加载。
. (Join-Path $PSScriptRoot 'win-snip-ui.ps1')
