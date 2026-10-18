// 剪贴板写入的 C# 实现（由 win-snip-common.ps1 在需要时编译加载）。
//
// 为什么不用 .NET 的 System.Windows.Forms.Clipboard：
//   1) SetImage 只提供 CF_BITMAP，微信、飞书、Chrome 读的是 CF_DIB / PNG，
//      结果是"点了复制没报错，粘贴却出不来图"；
//   2) SetDataObject 在没有窗口消息泵的宿主里会抛"所请求的剪贴板操作失败"，
//      实测 9 秒后失败，而截图的复制动作正走这条路。
// 纯 Win32 一次写入 CF_DIB + PNG + CF_DIBV5，整屏 2560x1440 实测约 100ms。

using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public static class SnipClipboard
{
    private const uint CF_DIB = 8;
    private const uint GMEM_MOVEABLE = 0x0002;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool OpenClipboard(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool CloseClipboard();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool EmptyClipboard();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetClipboardData(uint uFormat, IntPtr hMem);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GlobalAlloc(uint uFlags, UIntPtr dwBytes);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GlobalLock(IntPtr hMem);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GlobalUnlock(IntPtr hMem);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GlobalFree(IntPtr hMem);

    [DllImport("user32.dll")]
    private static extern uint RegisterClipboardFormat(string format);

    /// <summary>把位图放进剪贴板；失败时 error 带回可读原因。</summary>
    public static bool SetImage(Bitmap bitmap, out string error)
    {
        error = null;
        byte[] dib = ToDib(bitmap);
        byte[] png = ToPng(bitmap);

        // 剪贴板可能被别的程序短暂占用，重试几次再报错。
        bool opened = false;
        for (int attempt = 0; attempt < 12 && !opened; attempt++)
        {
            opened = OpenClipboard(IntPtr.Zero);
            if (!opened) System.Threading.Thread.Sleep(80);
        }
        if (!opened)
        {
            error = "剪贴板被其它程序占用（OpenClipboard 失败）";
            return false;
        }

        try
        {
            EmptyClipboard();
            if (!Put(CF_DIB, dib))
            {
                error = "写入 CF_DIB 失败";
                return false;
            }
            // PNG：微信、Chrome、钉钉优先读它，无损。
            uint pngFormat = RegisterClipboardFormat("PNG");
            if (pngFormat != 0) Put(pngFormat, png);
            // 不写 CF_DIBV5：实测它和 CF_DIB 同时存在时，.NET 的 GetImage() 会优先按
            // DIBV5 解析并失败（读回来是 null），说明这个头还没被正确接受。
            // CF_DIB + PNG 已覆盖画图、Word、微信、飞书、浏览器、钉钉，够用且稳。
            return true;
        }
        finally
        {
            CloseClipboard();
        }
    }

    /// <summary>把一段字节放进指定剪贴板格式。</summary>
    private static bool Put(uint format, byte[] payload)
    {
        if (payload == null || payload.Length == 0) return false;
        IntPtr handle = GlobalAlloc(GMEM_MOVEABLE, (UIntPtr)payload.Length);
        if (handle == IntPtr.Zero) return false;

        IntPtr target = GlobalLock(handle);
        if (target == IntPtr.Zero)
        {
            GlobalFree(handle);
            return false;
        }
        try
        {
            Marshal.Copy(payload, 0, target, payload.Length);
        }
        finally
        {
            GlobalUnlock(handle);
        }

        if (SetClipboardData(format, handle) == IntPtr.Zero)
        {
            GlobalFree(handle);
            return false;
        }
        // 成功后内存所有权移交系统，这里不能再自己释放。
        return true;
    }

    /// <summary>转 CF_DIB：40 字节 BITMAPINFOHEADER + 自底向上 BGR 像素。</summary>
    public static byte[] ToDib(Bitmap bitmap)
    {
        int width = bitmap.Width;
        int height = bitmap.Height;
        int stride = ((width * 3) + 3) / 4 * 4;
        byte[] data = new byte[40 + (long)stride * height];

        using (MemoryStream stream = new MemoryStream(data))
        using (BinaryWriter writer = new BinaryWriter(stream))
        {
            writer.Write(40);                       // biSize
            writer.Write(width);                    // biWidth
            writer.Write(height);                   // biHeight（正数=自底向上）
            writer.Write((short)1);                 // biPlanes
            writer.Write((short)24);                // biBitCount
            writer.Write(0);                        // biCompression = BI_RGB
            writer.Write(stride * height);           // biSizeImage
            writer.Write(2835);                     // biXPelsPerMeter
            writer.Write(2835);                     // biYPelsPerMeter
            writer.Write(0);                        // biClrUsed
            writer.Write(0);                        // biClrImportant
        }

        BitmapData locked = bitmap.LockBits(new Rectangle(0, 0, width, height), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
        try
        {
            for (int y = 0; y < height; y++)
            {
                // DIB 自底向上：输出第 y 行对应源图第 (height-1-y) 行。
                IntPtr source = new IntPtr(locked.Scan0.ToInt64() + (long)(height - 1 - y) * locked.Stride);
                Marshal.Copy(source, data, 40 + y * stride, width * 3);
            }
        }
        finally
        {
            bitmap.UnlockBits(locked);
        }
        return data;
    }

    /// <summary>转 PNG 字节流。</summary>
    public static byte[] ToPng(Bitmap bitmap)
    {
        using (MemoryStream stream = new MemoryStream())
        {
            bitmap.Save(stream, ImageFormat.Png);
            return stream.ToArray();
        }
    }
}
