// 自绘列表（由 win-snip-clipboard-panel.ps1 运行时编译加载）。
//
// 为什么不用 ListBox：ListBox 的垂直滚动条是 17px 白色系统条，带箭头、无法换色；
// 摘 WS_VSCROLL 在部分环境（Windows Server / RDP）会被控件重新加回来。
// 预览区已经改成自绘文本视图，列表也一并自绘，滚动条才真正统一。
//
// 行数据由 PowerShell 侧算好（类型标签 / 摘要 / 时间·来源），控件只负责布局、命中与滚动。
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

public class SnipListView : Control
{
    public Color SurfaceColor = Color.FromArgb(27, 27, 31);
    public Color RaisedColor = Color.FromArgb(35, 35, 40);
    public Color KindColor = Color.FromArgb(163, 163, 171);
    public Color KindSelectedColor = Color.FromArgb(239, 239, 241);
    public Color MainColor = Color.FromArgb(214, 214, 220);
    public Color MainSelectedColor = Color.FromArgb(239, 239, 241);
    public Color MetaColor = Color.FromArgb(111, 111, 120);
    public Color ThumbColor = Color.FromArgb(74, 74, 82);
    public Color ThumbHoverColor = Color.FromArgb(100, 100, 110);
    public Color ThumbActiveColor = Color.FromArgb(124, 124, 136);

    private const int RowHeight = 54;
    private const int BarWidth = 6;
    private const int BarGap = 12;

    private string[] kinds = new string[0];
    private string[] summaries = new string[0];
    private string[] metas = new string[0];

    private int selected = -1;
    private int offset;
    private bool hover;
    private bool dragging;
    private int dragOffset;
    private int thumbTop;
    private int thumbHeight;

    public event EventHandler SelectedIndexChanged;

    public SnipListView()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint
            | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        BackColor = SurfaceColor;
        Font = new Font("Microsoft YaHei UI", 9.5f, FontStyle.Regular, GraphicsUnit.Point);
        TabStop = true;
    }

    public int Count { get { return kinds.Length; } }

    public int SelectedIndex
    {
        get { return selected; }
        set { SetSelected(value, true); }
    }

    public int TopIndex
    {
        get { return offset; }
        set { offset = Math.Max(0, Math.Min(MaxOffset, value)); Invalidate(); }
    }

    private int VisibleRows { get { return Math.Max(1, ClientSize.Height / RowHeight); } }
    private int MaxOffset { get { return Math.Max(0, kinds.Length - VisibleRows); } }

    public void ClearRows()
    {
        kinds = new string[0];
        summaries = new string[0];
        metas = new string[0];
        selected = -1;
        offset = 0;
        Invalidate();
    }

    public void SetRows(string[] kindList, string[] summaryList, string[] metaList)
    {
        kinds = kindList ?? new string[0];
        summaries = summaryList ?? new string[0];
        metas = metaList ?? new string[0];
        int n = Math.Min(kinds.Length, Math.Min(summaries.Length, metas.Length));
        if (n < kinds.Length)
        {
            Array.Resize(ref kinds, n);
            Array.Resize(ref summaries, n);
            Array.Resize(ref metas, n);
        }
        if (selected >= n) selected = n > 0 ? n - 1 : -1;
        offset = Math.Max(0, Math.Min(MaxOffset, offset));
        Invalidate();
    }

    private void SetSelected(int value, bool raise)
    {
        if (value < -1 || value >= kinds.Length) return;
        if (value == selected) return;
        selected = value;
        EnsureVisible();
        Invalidate();
        if (raise && SelectedIndexChanged != null) SelectedIndexChanged(this, EventArgs.Empty);
    }

    private void EnsureVisible()
    {
        if (selected < 0) return;
        if (selected < offset) offset = selected;
        else if (selected >= offset + VisibleRows) offset = selected - VisibleRows + 1;
        offset = Math.Max(0, Math.Min(MaxOffset, offset));
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        g.Clear(BackColor);
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

        int visible = VisibleRows;
        offset = Math.Max(0, Math.Min(offset, MaxOffset));

        using (Font kindFont = new Font("Microsoft YaHei UI", 8.5f, FontStyle.Regular, GraphicsUnit.Point))
        using (Font mainFont = new Font("Microsoft YaHei UI", 9.5f, FontStyle.Regular, GraphicsUnit.Point))
        using (Font metaFont = new Font("Microsoft YaHei UI", 8.5f, FontStyle.Regular, GraphicsUnit.Point))
        {
            for (int i = offset; i < Math.Min(kinds.Length, offset + visible); i++)
            {
                int top = (i - offset) * RowHeight;
                bool sel = (i == selected);
                if (sel)
                {
                    using (SolidBrush b = new SolidBrush(RaisedColor)) { g.FillRectangle(b, 0, top, ClientSize.Width, RowHeight); }
                }
                int textLeft = 58;
                int textWidth = Math.Max(20, ClientSize.Width - textLeft - BarGap - 12);
                TextRenderer.DrawText(g, kinds[i], kindFont, new Rectangle(12, top + 9, 44, 18),
                    sel ? KindSelectedColor : KindColor,
                    TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
                TextRenderer.DrawText(g, summaries[i], mainFont, new Rectangle(textLeft, top + 8, textWidth, 20),
                    sel ? MainSelectedColor : MainColor,
                    TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);
                TextRenderer.DrawText(g, metas[i], metaFont, new Rectangle(textLeft, top + 30, textWidth, 18),
                    MetaColor,
                    TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis);
            }
        }

        if (kinds.Length > visible)
        {
            int track = ClientSize.Height - 4;
            if (track > 8)
            {
                thumbHeight = Math.Max(24, (int)(track * (double)visible / kinds.Length));
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
        else
        {
            thumbTop = 0;
            thumbHeight = 0;
        }
    }

    protected override void OnMouseLeave(EventArgs e) { hover = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        Focus();
        int barX = ClientSize.Width - BarWidth - 6;
        bool inBar = e.X >= barX && kinds.Length > VisibleRows;
        if (inBar)
        {
            if (e.Y >= thumbTop && e.Y <= thumbTop + thumbHeight)
            {
                dragging = true;
                dragOffset = e.Y - thumbTop;
                Capture = true;
            }
            else
            {
                offset = Math.Max(0, Math.Min(MaxOffset, offset + (e.Y < thumbTop ? -VisibleRows : VisibleRows)));
                Invalidate();
            }
            return;
        }
        int row = offset + e.Y / RowHeight;
        if (row >= 0 && row < kinds.Length) SetSelected(row, true);
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

    protected override bool IsInputKey(Keys keyData)
    {
        // 方向键必须进到 OnKeyDown，否则会被窗体的 Tab 导航吃掉。
        if (keyData == Keys.Up || keyData == Keys.Down || keyData == Keys.Home || keyData == Keys.End
            || keyData == Keys.PageUp || keyData == Keys.PageDown) return true;
        return base.IsInputKey(keyData);
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (kinds.Length == 0) return;
        if (e.KeyCode == Keys.Down) { SetSelected(Math.Min(kinds.Length - 1, selected + 1), true); e.Handled = true; }
        else if (e.KeyCode == Keys.Up) { SetSelected(Math.Max(0, selected - 1), true); e.Handled = true; }
        else if (e.KeyCode == Keys.PageDown) { SetSelected(Math.Min(kinds.Length - 1, selected + VisibleRows), true); e.Handled = true; }
        else if (e.KeyCode == Keys.PageUp) { SetSelected(Math.Max(0, selected - VisibleRows), true); e.Handled = true; }
        else if (e.KeyCode == Keys.Home) { SetSelected(0, true); e.Handled = true; }
        else if (e.KeyCode == Keys.End) { SetSelected(kinds.Length - 1, true); e.Handled = true; }
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
