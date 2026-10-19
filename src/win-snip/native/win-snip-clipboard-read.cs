// 剪贴板读取与写回（由 win-snip-clipboard-read.ps1 在需要时编译加载）。
//
// 为什么不用 .NET 的 Clipboard 类：
//   1) win-snip-common.ps1 里已记录：无窗口消息泵的宿主里 Clipboard.SetDataObject
//      会抛「所请求的剪贴板操作失败」；读取侧同样受宿主线程模型影响，不可靠。
//   2) 这里改用纯 Win32：OpenClipboard + GetClipboardData + GlobalLock。
//      实测（2026-10-19，PowerShell 5.1）文本、CF_DIB、CF_HDROP 全部可读。
//
// 与 SnipClipboard（写图片）的分工：
//   SnipClipboard 负责「截图 → 剪贴板」这条热路径，已稳定；
//   本类只负责「剪贴板 → 历史记录 / 历史记录 → 剪贴板」，互不依赖。
//
// 约定：读取失败只返回 null（原因通过 error 出参带回），绝不抛异常打断助手主循环。
using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class SnipClipboardRead
{
    [DllImport("user32.dll", SetLastError = true)] static extern bool OpenClipboard(IntPtr hWndNewOwner);
    [DllImport("user32.dll", SetLastError = true)] static extern bool CloseClipboard();
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr GetClipboardData(uint uFormat);
    [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();
    [DllImport("user32.dll")] static extern IntPtr GetClipboardOwner();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] static extern bool IsClipboardFormatAvailable(uint format);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr GlobalLock(IntPtr hMem);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GlobalUnlock(IntPtr hMem);
    [DllImport("kernel32.dll", SetLastError = true)] static extern UIntPtr GlobalSize(IntPtr hMem);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr GlobalAlloc(uint uFlags, UIntPtr dwBytes);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr GlobalFree(IntPtr hMem);
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetClipboardData(uint uFormat, IntPtr hMem);
    [DllImport("user32.dll", SetLastError = true)] static extern bool EmptyClipboard();

    const uint CF_UNICODETEXT = 13;
    const uint CF_DIB = 8;
    const uint CF_DIBV5 = 17;
    const uint CF_HDROP = 15;
    const uint GMEM_MOVEABLE = 0x0002;

    [StructLayout(LayoutKind.Sequential)]
    struct DROPFILES
    {
        public uint pFiles;
        public int x;
        public int y;
        public int fNC;
        public int fWide;
    }

    /// <summary>剪贴板序列号：内容每变一次就递增，轮询它比反复打开剪贴板便宜得多。</summary>
    public static uint SequenceNumber() { return GetClipboardSequenceNumber(); }

    /// <summary>当前剪贴板数据的来源进程名（浏览器复制时通常是 chrome）；取不到返回空串。</summary>
    public static string OwnerProcessName()
    {
        try
        {
            IntPtr owner = GetClipboardOwner();
            if (owner == IntPtr.Zero) return "";
            uint pid;
            GetWindowThreadProcessId(owner, out pid);
            if (pid == 0) return "";
            using (var p = System.Diagnostics.Process.GetProcessById((int)pid)) return p.ProcessName;
        }
        catch { return ""; }
    }

    /// <summary>剪贴板里是否有文本格式（只读探测，不打开剪贴板）。</summary>
    public static bool HasText() { return IsClipboardFormatAvailable(CF_UNICODETEXT); }
    /// <summary>剪贴板里是否有位图格式。</summary>
    public static bool HasImage() { return IsClipboardFormatAvailable(CF_DIB) || IsClipboardFormatAvailable(CF_DIBV5); }
    /// <summary>剪贴板里是否有文件列表格式。</summary>
    public static bool HasFiles() { return IsClipboardFormatAvailable(CF_HDROP); }

    /// <summary>读取剪贴板文本；没有文本返回 null（空字符串是合法的复制内容）。</summary>
    public static string ReadText()
    {
        if (!OpenClipboard(IntPtr.Zero)) return null;
        try
        {
            IntPtr h = GetClipboardData(CF_UNICODETEXT);
            if (h == IntPtr.Zero) return null;
            IntPtr p = GlobalLock(h);
            if (p == IntPtr.Zero) return null;
            try { return Marshal.PtrToStringUni(p); }
            finally { GlobalUnlock(h); }
        }
        finally { CloseClipboard(); }
    }

    /// <summary>读取剪贴板文件列表（资源管理器复制文件）；没有文件返回 null。</summary>
    public static string[] ReadFiles()
    {
        if (!OpenClipboard(IntPtr.Zero)) return null;
        try
        {
            IntPtr h = GetClipboardData(CF_HDROP);
            if (h == IntPtr.Zero) return null;
            IntPtr p = GlobalLock(h);
            if (p == IntPtr.Zero) return null;
            try
            {
                DROPFILES df = (DROPFILES)Marshal.PtrToStructure(p, typeof(DROPFILES));
                var list = new List<string>();
                long basePtr = p.ToInt64();
                if (df.fWide != 0)
                {
                    long cursor = basePtr + df.pFiles;
                    while (true)
                    {
                        string item = Marshal.PtrToStringUni(new IntPtr(cursor));
                        if (string.IsNullOrEmpty(item)) break;
                        list.Add(item);
                        cursor += (item.Length + 1) * 2;
                    }
                }
                else
                {
                    long cursor = basePtr + df.pFiles;
                    while (true)
                    {
                        string item = Marshal.PtrToStringAnsi(new IntPtr(cursor));
                        if (string.IsNullOrEmpty(item)) break;
                        list.Add(item);
                        cursor += item.Length + 1;
                    }
                }
                return list.Count == 0 ? null : list.ToArray();
            }
            finally { GlobalUnlock(h); }
        }
        finally { CloseClipboard(); }
    }

    /// <summary>
    /// 读取剪贴板位图。
    /// 优先 CF_DIB：它与 SnipClipboard 自己写出的格式一致，实测解码稳定；
    /// CF_DIBV5 作为兜底（部分程序只给 V5，V4/V5 头已内含掩码）。
    /// </summary>
    public static Bitmap ReadImage(out string error)
    {
        error = "";
        if (!OpenClipboard(IntPtr.Zero)) { error = "剪贴板被其它程序占用（OpenClipboard 失败）"; return null; }
        try
        {
            foreach (uint format in new uint[] { CF_DIB, CF_DIBV5 })
            {
                IntPtr h = GetClipboardData(format);
                if (h == IntPtr.Zero) continue;
                IntPtr p = GlobalLock(h);
                if (p == IntPtr.Zero) continue;
                try
                {
                    int size = (int)GlobalSize(h).ToUInt64();
                    if (size <= 0) continue;
                    byte[] dib = new byte[size];
                    Marshal.Copy(p, dib, 0, size);
                    Bitmap decoded = DibToBitmap(dib, out error);
                    if (decoded != null) return decoded;
                }
                finally { GlobalUnlock(h); }
            }
            if (error == "") error = "剪贴板没有位图";
            return null;
        }
        finally { CloseClipboard(); }
    }

    static Bitmap DibToBitmap(byte[] dib, out string error)
    {
        error = "";
        if (dib.Length < 40) { error = "DIB 头不完整"; return null; }
        int biSize = BitConverter.ToInt32(dib, 0);
        int bitCount = BitConverter.ToInt16(dib, 14);
        int compression = BitConverter.ToInt32(dib, 16);
        int clrUsed = BitConverter.ToInt32(dib, 32);
        int paletteEntries = clrUsed;
        if (paletteEntries == 0 && bitCount <= 8) paletteEntries = 1 << bitCount;
        int offset = 14 + biSize + paletteEntries * 4;
        // BI_BITFIELDS(3) / BI_ALPHABITFIELDS(6) 的掩码在 40 字节头之后；V4/V5 头已自带。
        if (biSize == 40)
        {
            if (compression == 3) offset += 12;
            else if (compression == 6) offset += 16;
        }
        int total = 14 + dib.Length;
        byte[] bmp = new byte[total];
        bmp[0] = (byte)'B';
        bmp[1] = (byte)'M';
        BitConverter.GetBytes(total).CopyTo(bmp, 2);
        BitConverter.GetBytes(0).CopyTo(bmp, 6);
        BitConverter.GetBytes(offset).CopyTo(bmp, 10);
        Buffer.BlockCopy(dib, 0, bmp, 14, dib.Length);
        try
        {
            using (var ms = new MemoryStream(bmp))
            using (var img = Image.FromStream(ms))
            {
                return new Bitmap(img);
            }
        }
        catch (Exception ex)
        {
            error = "DIB 解码失败：" + ex.Message;
            return null;
        }
    }

    /// <summary>把文本写回剪贴板（历史面板的「复制」走这条路）。</summary>
    public static bool WriteText(string text, out string error)
    {
        error = "";
        if (!OpenClipboard(IntPtr.Zero)) { error = "剪贴板被其它程序占用"; return false; }
        try
        {
            EmptyClipboard();
            byte[] bytes = Encoding.Unicode.GetBytes((text ?? "") + "\0");
            IntPtr h = GlobalAlloc(GMEM_MOVEABLE, (UIntPtr)bytes.Length);
            if (h == IntPtr.Zero) { error = "分配剪贴板内存失败"; return false; }
            IntPtr p = GlobalLock(h);
            if (p == IntPtr.Zero) { GlobalFree(h); error = "锁定剪贴板内存失败"; return false; }
            Marshal.Copy(bytes, 0, p, bytes.Length);
            GlobalUnlock(h);
            if (SetClipboardData(CF_UNICODETEXT, h) == IntPtr.Zero) { GlobalFree(h); error = "写入剪贴板失败"; return false; }
            return true;
        }
        finally { CloseClipboard(); }
    }

    /// <summary>把文件列表写回剪贴板（CF_HDROP，资源管理器可直接粘贴）。</summary>
    public static bool WriteFiles(string[] paths, out string error)
    {
        error = "";
        if (paths == null || paths.Length == 0) { error = "没有文件路径"; return false; }
        if (!OpenClipboard(IntPtr.Zero)) { error = "剪贴板被其它程序占用"; return false; }
        try
        {
            EmptyClipboard();
            var sb = new StringBuilder();
            foreach (string path in paths) sb.Append(path).Append('\0');
            sb.Append('\0');
            byte[] names = Encoding.Unicode.GetBytes(sb.ToString());
            int headerSize = Marshal.SizeOf(typeof(DROPFILES));
            byte[] block = new byte[headerSize + names.Length];
            BitConverter.GetBytes((uint)headerSize).CopyTo(block, 0);
            BitConverter.GetBytes(1).CopyTo(block, 16); // fWide = 1
            Buffer.BlockCopy(names, 0, block, headerSize, names.Length);
            IntPtr h = GlobalAlloc(GMEM_MOVEABLE, (UIntPtr)block.Length);
            if (h == IntPtr.Zero) { error = "分配剪贴板内存失败"; return false; }
            IntPtr p = GlobalLock(h);
            if (p == IntPtr.Zero) { GlobalFree(h); error = "锁定剪贴板内存失败"; return false; }
            Marshal.Copy(block, 0, p, block.Length);
            GlobalUnlock(h);
            if (SetClipboardData(CF_HDROP, h) == IntPtr.Zero) { GlobalFree(h); error = "写入剪贴板失败"; return false; }
            return true;
        }
        finally { CloseClipboard(); }
    }
}
