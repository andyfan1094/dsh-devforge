// 自绘只读文本视图（由 win-snip-clipboard-panel.ps1 运行时编译加载）。
//
// 为什么不用 TextBox：多行 TextBox 的垂直滚动条永远是 17px 白色系统条，
// 即使把 WS_VSCROLL 摘掉，滚动行为也会变得不可靠。预览区只是"读文本"，
// 直接自己换行、自己画、自己滚，观感统一，也不再依赖系统主题。
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

public class SnipTextView : Control
{
    public Color TextColor = Color.FromArgb(214, 214, 220);
    public Color ThumbColor = Color.FromArgb(74, 74, 82);
    public Color ThumbHoverColor = Color.FromArgb(100, 100, 110);
    public Color ThumbActiveColor = Color.FromArgb(124, 124, 136);

    private const int BarWidth = 6;
    private const int BarGap = 10;

    private readonly List<string> lines = new List<string>();
    private readonly Dictionary<char, int> charWidths = new Dictionary<char, int>();
    private string content = "";

    private int offset;          // 顶部可见行
    private bool hover;
    private bool dragging;
    private int dragOffset;
    private int thumbTop;
    private int thumbHeight;

    public SnipTextView()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint
            | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        BackColor = Color.FromArgb(27, 27, 31);
        Font = new Font("Microsoft YaHei UI", 10f, FontStyle.Regular, GraphicsUnit.Point);
        // 不抢焦点：面板的键盘操作挂在搜索框与列表上。
        SetStyle(ControlStyles.Selectable, false);
        TabStop = false;
    }

    public int LineCount { get { return lines.Count; } }

    public void SetContent(string text)
    {
        content = text ?? "";
        offset = 0;
        Rebuild();
        Invalidate();
    }

    private int LineHeight { get { return Font.Height + 4; } }

    private void Rebuild()
    {
        lines.Clear();
        int width = Math.Max(40, ClientSize.Width - BarGap);
        string[] rawLines = content.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
        foreach (string raw in rawLines)
        {
            if (raw.Length == 0) { lines.Add(""); continue; }
            int start = 0;
            while (start < raw.Length)
            {
                int used = 0;
                int end = start;
                while (end < raw.Length)
                {
                    int cw = CharWidth(raw[end]);
                    if (used + cw > width && end > start) break;
                    used += cw;
                    end++;
                }
                string piece = raw.Substring(start, end - start);
                // 英文尽量在空格处断行，避免单词被切成两半。
                if (end < raw.Length)
                {
                    int space = piece.LastIndexOf(' ');
                    if (space > 0)
                    {
                        end = start + space + 1;
                        piece = raw.Substring(start, space + 1);
                    }
                }
                lines.Add(piece.TrimEnd());
                start = end;
            }
        }
    }

    private int CharWidth(char ch)
    {
        int w;
        if (charWidths.TryGetValue(ch, out w)) return w;
        w = TextRenderer.MeasureText(ch.ToString(), Font).Width;
        charWidths[ch] = w;
        return w;
    }

    private int VisibleLines
    {
        get { return Math.Max(1, ClientSize.Height / LineHeight); }
    }

    private int MaxOffset
    {
        get { return Math.Max(0, lines.Count - VisibleLines); }
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        Rebuild();
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.Clear(BackColor);

        int lh = LineHeight;
        int visible = VisibleLines;
        offset = Math.Max(0, Math.Min(offset, MaxOffset));

        int last = Math.Min(lines.Count, offset + visible + 1);
        for (int i = offset; i < last; i++)
        {
            TextRenderer.DrawText(g, lines[i], Font, new Point(0, (i - offset) * lh), TextColor,
                TextFormatFlags.Left | TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix);
        }

        if (lines.Count > visible)
        {
            int track = ClientSize.Height - 4;
            if (track > 8)
            {
                thumbHeight = Math.Max(24, (int)(track * (double)visible / lines.Count));
                if (thumbHeight > track) thumbHeight = track;
                thumbTop = 2 + (int)((track - thumbHeight) * (double)offset / Math.Max(1, MaxOffset));
                Color fill = dragging ? ThumbActiveColor : (hover ? ThumbHoverColor : ThumbColor);
                Rectangle box = new Rectangle(ClientSize.Width - BarWidth - 2, thumbTop, BarWidth, thumbHeight);
                using (GraphicsPath path = RoundRect(box, BarWidth / 2))
                using (SolidBrush brush = new SolidBrush(fill))
                {
                    g.FillPath(brush, path);
                }
            }
        }
    }

    protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hover = false; Invalidate(); base.OnMouseLeave(e); }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (MaxOffset <= 0) return;
        if (e.X >= ClientSize.Width - BarWidth - 6 && e.Y >= thumbTop && e.Y <= thumbTop + thumbHeight)
        {
            dragging = true;
            dragOffset = e.Y - thumbTop;
            Capture = true;
            Invalidate();
        }
        else if (e.X < ClientSize.Width - BarWidth - 6)
        {
            offset = Math.Max(0, Math.Min(MaxOffset, offset + (e.Y < thumbTop ? -VisibleLines : VisibleLines)));
            Invalidate();
        }
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        if (!dragging || MaxOffset <= 0) return;
        int track = ClientSize.Height - 4 - thumbHeight;
        if (track <= 0) return;
        int target = e.Y - dragOffset - 2;
        offset = Math.Max(0, Math.Min(MaxOffset, (int)Math.Round((double)target / track * MaxOffset)));
        Invalidate();
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        if (!dragging) return;
        dragging = false;
        Capture = false;
        Invalidate();
    }

    protected override void OnMouseWheel(MouseEventArgs e)
    {
        base.OnMouseWheel(e);
        if (MaxOffset <= 0) return;
        offset = Math.Max(0, Math.Min(MaxOffset, offset - Math.Sign(e.Delta) * 3));
        Invalidate();
    }

    private static GraphicsPath RoundRect(Rectangle bounds, int radius)
    {
        int d = Math.Max(1, radius * 2);
        if (d > bounds.Width) { d = bounds.Width; }
        if (d > bounds.Height) { d = bounds.Height; }
        GraphicsPath path = new GraphicsPath();
        path.AddArc(bounds.X, bounds.Y, d, d, 180, 90);
        path.AddArc(bounds.Right - d, bounds.Y, d, d, 270, 90);
        path.AddArc(bounds.Right - d, bounds.Bottom - d, d, d, 0, 90);
        path.AddArc(bounds.X, bounds.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }
}
