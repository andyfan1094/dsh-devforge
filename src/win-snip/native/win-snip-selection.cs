// 选区读取的 Win32 底座（由 win-snip-selection.ps1 在需要时编译加载）。
//
// 只负责两件事：
//   1) 报告"当前前台窗口是谁"（类名 + 进程名）：资源管理器里选中文件时按 Ctrl+C
//      是把文件放进剪贴板，所以那几类窗口必须提前跳过；
//   2) 发送一次 Ctrl+C（先抬修饰键），把选中文字送进剪贴板。
//
// 读剪贴板不在本类里：那是 SnipClipboardRead 的职责，两处各管一段，互不依赖。
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class SnipSelection
{
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hWnd, StringBuilder name, int count);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    const byte VK_SHIFT = 0x10;
    const byte VK_CONTROL = 0x11;
    const byte VK_MENU = 0x12;
    const byte VK_LWIN = 0x5B;
    const byte VK_RWIN = 0x5C;
    const byte VK_C = 0x43;
    const uint KEYUP = 0x0002;

    /// <summary>前台窗口类名；取不到返回空串（调用方按"未知窗口"处理）。</summary>
    public static string ForegroundClass()
    {
        IntPtr handle = GetForegroundWindow();
        if (handle == IntPtr.Zero) return "";
        StringBuilder name = new StringBuilder(256);
        if (GetClassName(handle, name, name.Capacity) == 0) return "";
        return name.ToString();
    }

    /// <summary>前台窗口所属进程名（如 chrome、WeChat）；取不到返回空串。</summary>
    public static string ForegroundProcessName()
    {
        try
        {
            IntPtr handle = GetForegroundWindow();
            if (handle == IntPtr.Zero) return "";
            uint pid;
            GetWindowThreadProcessId(handle, out pid);
            if (pid == 0) return "";
            using (var process = System.Diagnostics.Process.GetProcessById((int)pid)) return process.ProcessName;
        }
        catch { return ""; }
    }

    /// <summary>
    /// 发一次 Ctrl+C。
    /// 热键是 Alt+A：按下热键那一刻 ALT 往往还按着，此时直接补 Ctrl+C 会被目标程序
    /// 当成 Alt+Ctrl+C（等于没复制）。所以先把 Shift/Ctrl/Alt/Win 各抬一遍再发组合键。
    /// </summary>
    public static bool SendCopy()
    {
        try
        {
            keybd_event(VK_MENU, 0, KEYUP, UIntPtr.Zero);
            keybd_event(VK_SHIFT, 0, KEYUP, UIntPtr.Zero);
            keybd_event(VK_LWIN, 0, KEYUP, UIntPtr.Zero);
            keybd_event(VK_RWIN, 0, KEYUP, UIntPtr.Zero);
            keybd_event(VK_CONTROL, 0, KEYUP, UIntPtr.Zero);
            keybd_event(VK_CONTROL, 0, 0, UIntPtr.Zero);
            keybd_event(VK_C, 0, 0, UIntPtr.Zero);
            keybd_event(VK_C, 0, KEYUP, UIntPtr.Zero);
            keybd_event(VK_CONTROL, 0, KEYUP, UIntPtr.Zero);
            return true;
        }
        catch { return false; }
    }
}
