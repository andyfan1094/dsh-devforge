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
        BaseDir       = ''
        Hotkey        = ''
        StartedAt     = (Get-Date).ToString('o')
        Captures      = 0
        LastCaptureAt = $null
        State         = 'idle'
        Error         = $null
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
        $Bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
        $payload = [ordered]@{ id = $id; kind = $Kind; imagePath = $pngPath }
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
    生成一个深色小窗（结果窗、浮窗、输入框共用的外观基线）。
#>
function New-SnipDarkForm {
    $form = New-Object System.Windows.Forms.Form
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
    $form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
    $form.BackColor = [System.Drawing.Color]::FromArgb(32, 32, 34)
    $form.TopMost = $true
    $form.ShowInTaskbar = $false
    $form.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)
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
