// 功能选择框的卡片控件（由 win-snip-launcher.ps1 运行时编译加载）。
//
// 为什么用 C# 而不是在 PowerShell 里自绘：
//   hover / 键盘选中都需要即时重绘，PowerShell 解释执行的方法会明显掉帧
//   （与 win-snip-ui.ps1 里 SnipToolButton 的取舍一致）。
//
// 图标规范沿用工具条：1.6px 圆头单线、14×14 方格内绘制，这里整体放大到 20×20。
// 禁 emoji 当图标；图标颜色跟随文字色，选中态只改强调色描边与底色。
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

public class SnipChoiceCard : Control
{
    public string IconId = "capture";
    public string Title = "";
    public string Detail = "";
    public string KeyHint = "1";

    public Color AccentColor = Color.FromArgb(45, 107, 255);
    public Color TextColor = Color.FromArgb(238, 238, 242);
    public Color MutedColor = Color.FromArgb(148, 148, 158);
    public Color BorderColor = Color.FromArgb(66, 66, 74);
    public Color HoverFill = Color.FromArgb(20, 255, 255, 255);
    public Color ActiveFill = Color.FromArgb(26, 45, 107, 255);

    private bool hover;
    private bool pressed;
    private bool active;

    private const int IconSize = 20;
    private const int PadX = 16;
    private const int Radius = 10;

    public bool Active
    {
        get { return active; }
        set { if (active != value) { active = value; Invalidate(); } }
    }

    public SnipChoiceCard()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint
            | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        BackColor = Color.FromArgb(38, 38, 42);
        Cursor = Cursors.Hand;
        Font = new Font("Microsoft YaHei UI", 9f, FontStyle.Regular, GraphicsUnit.Point);
        // 不抢焦点：选择框的键盘处理挂在窗体上，卡片抢焦点会让数字键/Esc 失效。
        SetStyle(ControlStyles.Selectable, false);
        TabStop = false;
        Height = 72;
    }

    protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hover = false; pressed = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnMouseDown(MouseEventArgs e) { pressed = true; Invalidate(); base.OnMouseDown(e); }
    protected override void OnMouseUp(MouseEventArgs e) { pressed = false; Invalidate(); base.OnMouseUp(e); }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

        Rectangle box = new Rectangle(0, 0, Width - 1, Height - 1);
        using (GraphicsPath path = RoundRect(box, Radius))
        {
            if (active) { using (SolidBrush b = new SolidBrush(ActiveFill)) { g.FillPath(b, path); } }
            else if (hover) { using (SolidBrush b = new SolidBrush(HoverFill)) { g.FillPath(b, path); } }
            Color stroke = active ? AccentColor : BorderColor;
            using (Pen pen = new Pen(stroke, active ? 1.5f : 1f)) { g.DrawPath(pen, path); }
        }

        int offset = pressed ? 1 : 0;
        int iconTop = (Height - IconSize) / 2 + offset;
        DrawGlyph(g, IconId, PadX, iconTop, active ? TextColor : (hover ? TextColor : MutedColor));

        int textLeft = PadX + IconSize + 14;
        int textWidth = Width - textLeft - 56;
        using (Font titleFont = new Font("Microsoft YaHei UI", 11.5f, FontStyle.Bold, GraphicsUnit.Point))
        using (Font detailFont = new Font("Microsoft YaHei UI", 9f, FontStyle.Regular, GraphicsUnit.Point))
        {
            Rectangle titleRect = new Rectangle(textLeft, 13 + offset, textWidth, 24);
            TextRenderer.DrawText(g, Title, titleFont, titleRect, TextColor,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);
            Rectangle detailRect = new Rectangle(textLeft, 39 + offset, textWidth, 20);
            TextRenderer.DrawText(g, Detail, detailFont, detailRect, MutedColor,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);
        }

        // 右侧键帽：提示这个功能有数字快捷键，也给出可以"盲按"的锚点。
        int capSize = 22;
        int capLeft = Width - PadX - capSize;
        int capTop = (Height - capSize) / 2 + offset;
        using (GraphicsPath capPath = RoundRect(new Rectangle(capLeft, capTop, capSize, capSize), 6))
        {
            using (SolidBrush fill = new SolidBrush(Color.FromArgb(26, 26, 30))) { g.FillPath(fill, capPath); }
            using (Pen pen = new Pen(active ? AccentColor : BorderColor, 1f)) { g.DrawPath(pen, capPath); }
        }
        TextRenderer.DrawText(g, KeyHint,
            new Font("Segoe UI", 8.5f, FontStyle.Regular, GraphicsUnit.Point),
            new Rectangle(capLeft, capTop, capSize, capSize),
            active ? TextColor : MutedColor,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
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

    // 20×20 方格内的单线图标。
    private static void DrawGlyph(Graphics g, string id, int left, int top, Color fore)
    {
        using (Pen pen = new Pen(fore, 1.6f))
        {
            pen.StartCap = LineCap.Round;
            pen.EndCap = LineCap.Round;
            pen.LineJoin = LineJoin.Round;
            GraphicsState state = g.Save();
            g.TranslateTransform(left, top);
            g.ScaleTransform(20f / 14f, 20f / 14f);
            try
            {
                switch (id)
                {
                    case "clipboard":
                        // 板身 + 顶部夹子：读起来就是"剪贴板"。
                        using (GraphicsPath board = RoundRect(new Rectangle(2, 3, 10, 9), 1))
                        {
                            g.DrawPath(pen, board);
                        }
                        g.DrawRectangle(pen, 5, 1.4f, 4, 2.6f);
                        g.DrawLine(pen, 4.6f, 6.2f, 9.4f, 6.2f);
                        g.DrawLine(pen, 4.6f, 8.6f, 8f, 8.6f);
                        break;
                    case "capture":
                    default:
                        // 四角取景框 + 中间十字：截图/框选的通用语言。
                        g.DrawLine(pen, 3f, 5.2f, 3f, 2.6f); g.DrawLine(pen, 3f, 2.6f, 5.4f, 2.6f);
                        g.DrawLine(pen, 11.4f, 5.2f, 11.4f, 2.6f); g.DrawLine(pen, 11.4f, 2.6f, 9f, 2.6f);
                        g.DrawLine(pen, 3f, 9.2f, 3f, 11.8f); g.DrawLine(pen, 3f, 11.8f, 5.4f, 11.8f);
                        g.DrawLine(pen, 11.4f, 9.2f, 11.4f, 11.8f); g.DrawLine(pen, 11.4f, 11.8f, 9f, 11.8f);
                        g.DrawLine(pen, 5.6f, 7.2f, 8.6f, 7.2f);
                        g.DrawLine(pen, 7.1f, 5.7f, 7.1f, 8.7f);
                        break;
                }
            }
            finally
            {
                g.Restore(state);
            }
        }
    }
}
