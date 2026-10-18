// 无边框窗口的边框拖拽缩放（由 win-snip-common.ps1 在需要时编译加载）。
//
// 为什么需要：结果窗去掉了系统标题栏（为了自定义配色），但 FormBorderStyle=None
// 之后窗口就没法用鼠标拖边缘缩放了。这里挂一个 NativeWindow，在 WM_NCHITTEST
// 里把边缘 8px 区域返回成 HTLEFT/HTTOP/... 让系统按原生方式处理缩放，
// 这样最小尺寸（Form.MinimumSize）、双击标题栏等行为都还是系统的，不用自己实现。

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public sealed class SnipResizeWindow : NativeWindow
{
    private const int WM_NCHITTEST = 0x0084;
    private const int HTCLIENT = 1;
    private const int HTLEFT = 10;
    private const int HTRIGHT = 11;
    private const int HTTOP = 12;
    private const int HTTOPLEFT = 13;
    private const int HTTOPRIGHT = 14;
    private const int HTBOTTOM = 15;
    private const int HTBOTTOMLEFT = 16;
    private const int HTBOTTOMRIGHT = 17;

    // NativeWindow 不会被窗体持有引用，必须自己保活，否则会被 GC 回收导致缩放失效。
    private static readonly List<SnipResizeWindow> Live = new List<SnipResizeWindow>();

    private readonly Form form;
    private readonly int grip;

    private SnipResizeWindow(Form form, int grip)
    {
        this.form = form;
        this.grip = grip;
        AssignHandle(form.Handle);
        Live.Add(this);
        form.HandleDestroyed += OnHandleDestroyed;
    }

    /// <summary>给窗体挂上四边四角缩放能力，grip 为边缘热区宽度（像素）。</summary>
    public static void Attach(Form form, int grip)
    {
        new SnipResizeWindow(form, grip);
    }

    private void OnHandleDestroyed(object sender, EventArgs e)
    {
        Live.Remove(this);
        ReleaseHandle();
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    protected override void WndProc(ref Message m)
    {
        if (m.Msg != WM_NCHITTEST)
        {
            base.WndProc(ref m);
            return;
        }

        base.WndProc(ref m);
        if ((int)m.Result != HTCLIENT) return;

        // lParam 里是屏幕坐标（低 16 位 X，高 16 位 Y），按有符号短整型还原。
        int screenX = unchecked((short)(long)m.LParam);
        int screenY = unchecked((short)((long)m.LParam >> 16));

        RECT rect;
        if (!GetWindowRect(Handle, out rect)) return;
        int width = rect.Right - rect.Left;
        int height = rect.Bottom - rect.Top;
        if (width <= 0 || height <= 0) return;

        int x = screenX - rect.Left;
        int y = screenY - rect.Top;

        bool left = x < grip;
        bool right = x >= width - grip;
        bool top = y < grip;
        bool bottom = y >= height - grip;

        if (!left && !right && !top && !bottom) return;

        // 角优先，其次边。
        if (top && left) m.Result = (IntPtr)HTTOPLEFT;
        else if (top && right) m.Result = (IntPtr)HTTOPRIGHT;
        else if (bottom && left) m.Result = (IntPtr)HTBOTTOMLEFT;
        else if (bottom && right) m.Result = (IntPtr)HTBOTTOMRIGHT;
        else if (left) m.Result = (IntPtr)HTLEFT;
        else if (right) m.Result = (IntPtr)HTRIGHT;
        else if (top) m.Result = (IntPtr)HTTOP;
        else m.Result = (IntPtr)HTBOTTOM;
    }
}
