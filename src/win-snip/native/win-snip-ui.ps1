# win-snip-ui.ps1 —— 截图工具条的自绘控件
#
# 为什么用 C# 编译而不是 PowerShell 类：
#   PowerShell 类的方法由解释器执行，鼠标移过按钮就要重绘，解释执行会明显掉帧；
#   用 Add-Type 编译一次（进程生命周期内只编译一次），绘制走原生代码，hover 才跟得上手。
#
# 图标规范（遵循设计资产 craft/anti-ai-slop）：
#   禁止 emoji 当功能图标；统一 1.6px 圆头单线描边矢量图标，颜色跟随文字色。
#   所有图标都画在 14×14 的方格内，用相对坐标，便于统一缩放与对齐。

if (-not ('SnipToolButton' -as [type])) {
    Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

// 截图工具条上的单个按钮：矢量图标 + 文字，带 hover / 选中 / 禁用三态。
public class SnipToolButton : Control
{
    // 图标标识，对应 DrawGlyph 里的分支。
    public string IconId = "";
    // 是否为当前选中的绘图工具（选中态用强调色填充）。
    public bool Active = false;
    // 是否禁用（撤销/重做在无可撤销内容时禁用）。
    public bool Disabled = false;

    public Color AccentColor = Color.FromArgb(226, 164, 92);
    public Color TextColor = Color.FromArgb(239, 239, 241);
    public Color MutedColor = Color.FromArgb(111, 111, 120);
    public Color HoverFill = Color.FromArgb(35, 35, 40);

    private const int IconSize = 14;
    private const int IconGap = 6;
    private const int PadX = 9;
    private const int Radius = 7;
    private const float StrokeWidth = 1.6f;

    private bool hover;
    private bool pressed;

    public SnipToolButton()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint
            | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        // 不用透明背景：透明需要父窗体反复重绘，浮在截图上会闪。按钮与工具条同色，圆角处看不出接缝。
        BackColor = Color.FromArgb(27, 27, 31);
        Cursor = Cursors.Hand;
        Font = new Font("Microsoft YaHei UI", 9f, FontStyle.Regular, GraphicsUnit.Point);
        // 关键：不接受焦点，点完按钮键盘焦点仍留在遮罩窗体上，Esc / Ctrl+Z 才不会失效。
        SetStyle(ControlStyles.Selectable, false);
        TabStop = false;
        Height = 30;
    }

    // 宽度按文字实际宽度计算，图标和文字一起算进内边距。
    public override Size GetPreferredSize(Size proposed)
    {
        int textWidth = TextRenderer.MeasureText(Text, Font).Width;
        return new Size(PadX * 2 + IconSize + IconGap + textWidth, 30);
    }

    protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hover = false; pressed = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnMouseDown(MouseEventArgs e) { pressed = true; Invalidate(); base.OnMouseDown(e); }
    protected override void OnMouseUp(MouseEventArgs e) { pressed = false; Invalidate(); base.OnMouseUp(e); }
    protected override void OnEnabledChanged(EventArgs e) { Invalidate(); base.OnEnabledChanged(e); }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;

        bool off = Disabled;
        Color fore = Active ? Color.FromArgb(26, 20, 8) : (off ? MutedColor : TextColor);
        Rectangle box = new Rectangle(0, 0, Width - 1, Height - 1);

        using (GraphicsPath path = RoundRect(box, Radius))
        {
            if (Active)
            {
                using (SolidBrush brush = new SolidBrush(AccentColor)) { g.FillPath(brush, path); }
            }
            else if (hover && !off)
            {
                using (SolidBrush brush = new SolidBrush(HoverFill)) { g.FillPath(brush, path); }
            }
        }

        // 按下时整体下沉 1px，给一个能感觉到的点击反馈。
        int offset = pressed ? 1 : 0;
        int iconTop = (Height - IconSize) / 2 + offset;
        DrawGlyph(g, IconId, PadX, iconTop, fore);

        int textLeft = PadX + IconSize + IconGap;
        Rectangle textRect = new Rectangle(textLeft, offset, Width - textLeft - PadX, Height);
        TextRenderer.DrawText(g, Text, Font, textRect, fore,
            TextFormatFlags.Left | TextFormatFlags.VerticalCenter
            | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);
    }

    // 圆角矩形路径（半径自动收敛，避免小尺寸算出非法弧）。
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

    // 画图标：所有坐标都在 14×14 方格内。
    private static void DrawGlyph(Graphics g, string id, int left, int top, Color fore)
    {
        using (Pen pen = new Pen(fore, StrokeWidth))
        {
            pen.StartCap = LineCap.Round;
            pen.EndCap = LineCap.Round;
            pen.LineJoin = LineJoin.Round;
            GraphicsState state = g.Save();
            g.TranslateTransform(left, top);
            try
            {
                switch (id)
                {
                    case "rect":
                        using (GraphicsPath p = RoundRect(new Rectangle(2, 3, 10, 8), 2)) { g.DrawPath(pen, p); }
                        break;
                    case "ellipse":
                        g.DrawEllipse(pen, 1.8f, 3.2f, 10.4f, 7.6f);
                        break;
                    case "arrow":
                        g.DrawLine(pen, 2.4f, 11.6f, 10.6f, 3.4f);
                        g.DrawLine(pen, 10.6f, 3.4f, 6.6f, 3.9f);
                        g.DrawLine(pen, 10.6f, 3.4f, 10.1f, 7.4f);
                        break;
                    case "pen":
                        // 笔身 + 笔尖三角，读起来像"画笔"而不是"斜线"。
                        g.DrawLine(pen, 4.6f, 9.4f, 10.4f, 3.6f);
                        g.DrawLine(pen, 4.6f, 9.4f, 6.6f, 10.4f);
                        g.DrawLine(pen, 2.6f, 11.4f, 4.6f, 9.4f);
                        g.DrawLine(pen, 10.4f, 3.6f, 11.4f, 2.6f);
                        break;
                    case "text":
                        g.DrawLine(pen, 2.8f, 3.4f, 11.2f, 3.4f);
                        g.DrawLine(pen, 7f, 3.4f, 7f, 11.2f);
                        break;
                    case "mosaic":
                        using (SolidBrush brush = new SolidBrush(Color.FromArgb(150, fore)))
                        {
                            g.FillRectangle(brush, 2f, 2f, 4f, 4f);
                            g.FillRectangle(brush, 8f, 6f, 4f, 4f);
                        }
                        g.DrawRectangle(pen, 2f, 2f, 4f, 4f);
                        g.DrawRectangle(pen, 8f, 2f, 4f, 4f);
                        g.DrawRectangle(pen, 2f, 6f, 4f, 4f);
                        g.DrawRectangle(pen, 8f, 6f, 4f, 4f);
                        break;
                    case "number":
                        g.DrawEllipse(pen, 2f, 2f, 10f, 10f);
                        g.DrawLine(pen, 6.6f, 5.2f, 7.6f, 4.6f);
                        g.DrawLine(pen, 7.6f, 4.6f, 7.6f, 9.6f);
                        break;
                    case "undo":
                        g.DrawArc(pen, 2.2f, 3.4f, 10f, 9f, 20, 160);
                        g.DrawLine(pen, 4.4f, 9.8f, 4.4f, 6.2f);
                        g.DrawLine(pen, 4.4f, 6.2f, 7.6f, 7.6f);
                        break;
                    case "redo":
                        g.DrawArc(pen, 2.2f, 3.4f, 10f, 9f, 0, 160);
                        g.DrawLine(pen, 10f, 9.8f, 10f, 6.2f);
                        g.DrawLine(pen, 10f, 6.2f, 6.8f, 7.6f);
                        break;
                    case "ocr":
                        // 四角取景框 + 中间三行文字，表示"从图里取字"。
                        g.DrawLine(pen, 3f, 5.2f, 3f, 2.6f); g.DrawLine(pen, 3f, 2.6f, 5.4f, 2.6f);
                        g.DrawLine(pen, 11.4f, 5.2f, 11.4f, 2.6f); g.DrawLine(pen, 11.4f, 2.6f, 9f, 2.6f);
                        g.DrawLine(pen, 3f, 9.2f, 3f, 11.8f); g.DrawLine(pen, 3f, 11.8f, 5.4f, 11.8f);
                        g.DrawLine(pen, 11.4f, 9.2f, 11.4f, 11.8f); g.DrawLine(pen, 11.4f, 11.8f, 9f, 11.8f);
                        g.DrawLine(pen, 5.4f, 5.6f, 9f, 5.6f);
                        g.DrawLine(pen, 5.4f, 7.4f, 9f, 7.4f);
                        g.DrawLine(pen, 5.4f, 9.2f, 7.2f, 9.2f);
                        break;
                    case "translate":
                        // 左侧字母 A + 右侧三行短横，表示"换一种语言"。
                        g.DrawLine(pen, 2.2f, 11.2f, 5f, 3.2f);
                        g.DrawLine(pen, 5f, 3.2f, 7.8f, 11.2f);
                        g.DrawLine(pen, 3.4f, 8.2f, 6.6f, 8.2f);
                        g.DrawLine(pen, 9.4f, 4.6f, 12.4f, 4.6f);
                        g.DrawLine(pen, 9.4f, 7.4f, 12.4f, 7.4f);
                        g.DrawLine(pen, 9.4f, 10.2f, 11.4f, 10.2f);
                        break;
                    case "copy":
                        g.DrawRectangle(pen, 2f, 2f, 7.4f, 7.4f);
                        g.DrawRectangle(pen, 5.6f, 5.6f, 7.4f, 7.4f);
                        break;
                    case "save":
                        g.DrawLine(pen, 2.6f, 8.6f, 2.6f, 11.6f);
                        g.DrawLine(pen, 2.6f, 11.6f, 11.4f, 11.6f);
                        g.DrawLine(pen, 11.4f, 11.6f, 11.4f, 8.6f);
                        g.DrawLine(pen, 7f, 2.4f, 7f, 8.4f);
                        g.DrawLine(pen, 5.2f, 6.6f, 7f, 8.4f);
                        g.DrawLine(pen, 8.8f, 6.6f, 7f, 8.4f);
                        break;
                    case "pin":
                        g.DrawRectangle(pen, 4.6f, 2.4f, 4.8f, 3.4f);
                        g.DrawLine(pen, 7f, 5.8f, 7f, 10.4f);
                        g.DrawLine(pen, 4.6f, 11.6f, 9.4f, 11.6f);
                        break;
                    case "close":
                        g.DrawLine(pen, 3.4f, 3.4f, 10.6f, 10.6f);
                        g.DrawLine(pen, 10.6f, 3.4f, 3.4f, 10.6f);
                        break;
                    case "trash":
                        // 垃圾桶：盖 + 提手 + 桶身 + 两条竖线。删除剪贴板历史条目用。
                        g.DrawLine(pen, 3f, 4.4f, 11f, 4.4f);
                        g.DrawLine(pen, 5.6f, 4.4f, 5.6f, 2.8f);
                        g.DrawLine(pen, 5.6f, 2.8f, 8.4f, 2.8f);
                        g.DrawLine(pen, 8.4f, 2.8f, 8.4f, 4.4f);
                        g.DrawLine(pen, 4.4f, 4.4f, 5f, 11.8f);
                        g.DrawLine(pen, 9.6f, 4.4f, 9f, 11.8f);
                        g.DrawLine(pen, 5f, 11.8f, 9f, 11.8f);
                        g.DrawLine(pen, 6.4f, 6.4f, 6.6f, 10f);
                        g.DrawLine(pen, 7.6f, 6.4f, 7.4f, 10f);
                        break;
                    default:
                        g.DrawEllipse(pen, 3f, 3f, 8f, 8f);
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

// 工具条容器：不透明深色面板 + 1px 内描边。
// 刻意不做圆角：圆角需要透明背景，而它浮在截图上会反复触发父窗体重绘导致闪烁。
public class SnipToolbarPanel : FlowLayoutPanel
{
    public Color BorderColor = Color.FromArgb(47, 47, 53);

    public SnipToolbarPanel()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
        BackColor = Color.FromArgb(27, 27, 31);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        using (Pen pen = new Pen(BorderColor, 1f))
        {
            e.Graphics.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);
        }
    }
}
'@
}
