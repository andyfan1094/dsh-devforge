# win-snip-ui.ps1 —— 截图工具条的自绘控件
#
# 为什么用 C# 编译而不是 PowerShell 类：
#   PowerShell 类的方法由解释器执行，鼠标移过按钮就要重绘，解释执行会明显掉帧；
#   用 Add-Type 编译一次（进程生命周期内只编译一次），绘制走原生代码，hover 才跟得上手。
#
# 图标规范（遵循设计资产 craft/anti-ai-slop）：
#   禁止 emoji 当功能图标；统一 1.6px 圆头单线描边矢量图标，颜色跟随文字色。
#   所有图标都画在 14×14 的方格内，用相对坐标，便于统一缩放与对齐。
#
# 2026-10-20 改版（辉哥：工具条再美化点、再小点）：
#   1. 由「图标 + 中文文字」改成**纯图标**，28×28 的方形按钮，整体宽度从约 1145px 降到约 515px；
#      文字说明改由 ToolTip 承担（中文名 + 快捷键），按钮同时设置 AccessibleName，读屏与自动化仍认得出。
#   2. 选中态不再整块填满琥珀色（太重、抢注意力），改成「琥珀 16% 底 + 1px 琥珀描边 + 琥珀图标」。
#   3. 悬停统一成白色 11% 底（与选择框卡片同一语汇），按下再亮一档；关闭按钮悬停转危险色。
#   4. 工具条容器做 10px 圆角 + 发丝描边（Region 硬裁切），浮在截图上像一个独立胶囊，不再是一块方板。

if (-not ('SnipToolButton' -as [type])) {
    Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

// 圆角矩形路径：两个控件类共用，避免各写一份。
internal static class SnipUiGeometry
{
    public static GraphicsPath RoundRect(Rectangle bounds, int radius)
    {
        int d = Math.Max(1, radius * 2);
        if (d > bounds.Width) { d = bounds.Width; }
        if (d > bounds.Height) { d = bounds.Height; }
        GraphicsPath path = new GraphicsPath();
        if (d <= 1 || bounds.Width <= 1 || bounds.Height <= 1)
        {
            path.AddRectangle(bounds);
            return path;
        }
        path.AddArc(bounds.X, bounds.Y, d, d, 180, 90);
        path.AddArc(bounds.Right - d, bounds.Y, d, d, 270, 90);
        path.AddArc(bounds.Right - d, bounds.Bottom - d, d, d, 0, 90);
        path.AddArc(bounds.X, bounds.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }
}

// 截图工具条上的单个按钮：只有矢量图标，带 hover / 选中 / 禁用三态。
public class SnipToolButton : Control
{
    // 图标标识，对应 DrawGlyph 里的分支。
    public string IconId = "";
    // 是否为当前选中的绘图工具（选中态用琥珀底 + 琥珀描边强调）。
    public bool Active = false;
    // 是否禁用（撤销/重做在无可撤销内容时禁用）。
    public bool Disabled = false;
    // 主操作（复制）：图标常驻琥珀色，但不用底色，避免和"工具选中"混淆。
    public bool Primary = false;
    // 悬停时转危险色（关闭按钮：这一步会退出编辑）。
    public bool DangerOnHover = false;

    public Color AccentColor = Color.FromArgb(226, 164, 92);
    public Color TextColor = Color.FromArgb(239, 239, 241);
    public Color MutedColor = Color.FromArgb(111, 111, 120);
    public Color DangerColor = Color.FromArgb(224, 106, 91);
    public Color Surface = Color.FromArgb(27, 27, 31);

    // 状态底色：与选择框卡片同一套语汇（白色低透明度叠加，随底色自然分层）。
    private static readonly Color HoverFill = Color.FromArgb(28, 255, 255, 255);
    private static readonly Color PressFill = Color.FromArgb(46, 255, 255, 255);
    private static readonly Color ActiveFill = Color.FromArgb(41, 226, 164, 92);
    private static readonly Color ActiveEdge = Color.FromArgb(120, 226, 164, 92);
    private static readonly Color PrimaryFill = Color.FromArgb(24, 226, 164, 92);
    private static readonly Color DangerFill = Color.FromArgb(34, 224, 106, 91);

    private const int IconSize = 17;
    // 图标坐标都以这个方格为基准，按 IconSize 等比缩放。
    private const float GlyphBase = 14f;
    private const int Radius = 7;
    private const float StrokeWidth = 1.6f;

    private bool hover;
    private bool pressed;

    public SnipToolButton()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint
            | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        // 不用透明背景：透明需要父窗体反复重绘，浮在截图上会闪。按钮与工具条同色，圆角处看不出接缝。
        BackColor = Surface;
        Cursor = Cursors.Hand;
        // 关键：不接受焦点，点完按钮键盘焦点仍留在遮罩窗体上，Esc / Ctrl+Z 才不会失效。
        SetStyle(ControlStyles.Selectable, false);
        TabStop = false;
        Width = 30;
        Height = 30;
    }

    // 纯图标按钮：宽度只由图标与内边距决定。
    public override Size GetPreferredSize(Size proposed)
    {
        return new Size(30, 30);
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
        bool danger = DangerOnHover && hover && !off;
        Color fore;
        if (off) { fore = MutedColor; }
        else if (danger) { fore = DangerColor; }
        else if (Active || Primary) { fore = AccentColor; }
        else { fore = TextColor; }

        Color fill = Color.Empty;
        if (Active) { fill = ActiveFill; }
        else if (off) { fill = Color.Empty; }
        else if (danger) { fill = pressed ? Color.FromArgb(52, 224, 106, 91) : DangerFill; }
        else if (hover) { fill = pressed ? PressFill : (Primary ? PrimaryFill : HoverFill); }

        Rectangle box = new Rectangle(0, 0, Width - 1, Height - 1);
        using (GraphicsPath path = SnipUiGeometry.RoundRect(box, Radius))
        {
            if (fill != Color.Empty)
            {
                using (SolidBrush brush = new SolidBrush(fill)) { g.FillPath(brush, path); }
            }
            if (Active)
            {
                using (Pen pen = new Pen(ActiveEdge, 1f)) { g.DrawPath(pen, path); }
            }
        }

        // 按下时整体下沉 1px，给一个能感觉到的点击反馈。
        int offset = pressed ? 1 : 0;
        int left = (Width - IconSize) / 2 + offset;
        int top = (Height - IconSize) / 2 + offset;
        DrawGlyph(g, IconId, left, top, fore);
    }

    // 画图标：所有坐标都在 14×14 方格内，按 IconSize 等比缩放；线宽反向补偿，视觉粗细恒定。
    private static void DrawGlyph(Graphics g, string id, int left, int top, Color fore)
    {
        float scale = IconSize / GlyphBase;
        using (Pen pen = new Pen(fore, StrokeWidth / scale))
        {
            pen.StartCap = LineCap.Round;
            pen.EndCap = LineCap.Round;
            pen.LineJoin = LineJoin.Round;
            GraphicsState state = g.Save();
            g.TranslateTransform(left, top);
            g.ScaleTransform(scale, scale);
            try
            {
                switch (id)
                {
                    case "rect":
                        using (GraphicsPath p = SnipUiGeometry.RoundRect(new Rectangle(2, 3, 10, 8), 2)) { g.DrawPath(pen, p); }
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
                        // 软盘：外框 + 上方写保护滑片 + 下方标签。比"下箭头 + 托盘"更像"保存"，
                        // 后者在工具条里会被读成"下载/导出"。
                        using (GraphicsPath p = SnipUiGeometry.RoundRect(new Rectangle(2, 2, 10, 10), 2)) { g.DrawPath(pen, p); }
                        g.DrawRectangle(pen, 4.6f, 2.2f, 4.8f, 3.6f);
                        g.DrawRectangle(pen, 4.2f, 8.4f, 5.6f, 3.4f);
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

// 工具条容器：胶囊形深色面板 + 1px 发丝描边。
// 圆角靠 Region 硬裁切实现：面板本身绘制不透明圆角底与描边，四角之外露出截图，
// 观感上是一个浮在截图上的独立胶囊，仍然是子控件（不需要透明背景，不会反复触发父窗体重绘）。
public class SnipToolbarPanel : FlowLayoutPanel
{
    public Color BorderColor = Color.FromArgb(47, 47, 53);
    public int CornerRadius = 10;

    public SnipToolbarPanel()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
        BackColor = Color.FromArgb(27, 27, 31);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        // 不调用 base.OnPaint：默认实现会先铺满一个直角矩形底，圆角会被它填掉。
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        Rectangle box = new Rectangle(0, 0, Width - 1, Height - 1);
        using (GraphicsPath path = SnipUiGeometry.RoundRect(box, CornerRadius))
        {
            using (SolidBrush brush = new SolidBrush(BackColor)) { g.FillPath(brush, path); }
            using (Pen pen = new Pen(BorderColor, 1f)) { g.DrawPath(pen, path); }
        }
    }

    protected override void OnSizeChanged(EventArgs e)
    {
        base.OnSizeChanged(e);
        ApplyCornerRegion();
    }

    // 按当前尺寸重建圆角 Region；Region 半径比绘制半径大 1px，避免裁切锯齿啃掉描边。
    public void ApplyCornerRegion()
    {
        try
        {
            if (Width <= 2 || Height <= 2) { return; }
            Rectangle rect = new Rectangle(0, 0, Width, Height);
            using (GraphicsPath path = SnipUiGeometry.RoundRect(rect, CornerRadius + 1))
            {
                Region old = Region;
                Region = new Region(path);
                if (old != null) { old.Dispose(); }
            }
        }
        catch
        {
            // 裁切失败只是回到直角，不影响功能。
        }
    }
}
'@
}
