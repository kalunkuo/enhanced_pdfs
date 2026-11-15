using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using WpfDrawingContext = System.Windows.Media.DrawingContext;
using Color = System.Windows.Media.Color;
using Colors = System.Windows.Media.Colors;
using Brushes = System.Windows.Media.Brushes;
using Pen = System.Windows.Media.Pen;
using Point = System.Windows.Point;
using Rect = System.Windows.Rect;

namespace EnhancedPdfs;

/// <summary>Ribbon icons drawn in code (no image files to ship): a PDF page plus a badge per command.</summary>
internal static class RibbonIcons
{
    private static readonly Color PdfRed = Color.FromRgb(0xD7, 0x26, 0x26);
    private static readonly Color Ink = Color.FromRgb(0x2B, 0x3A, 0x4A);
    private static readonly Color Accent = Color.FromRgb(0xE8, 0x59, 0x0C);
    private static readonly Color Green = Color.FromRgb(0x2F, 0x9E, 0x44);

    public static BitmapSource Export(int size) => Render(size, (dc, s) =>
    {
        Page(dc, s, 0, 0);
        Arrow(dc, s, down: true);
    });

    public static BitmapSource ExportSet(int size) => Render(size, (dc, s) =>
    {
        Page(dc, s, 4, -3, faded: true);
        Page(dc, s, 0, 0);
        Arrow(dc, s, down: true);
    });

    public static BitmapSource ImportMarkups(int size) => Render(size, (dc, s) =>
    {
        Page(dc, s, 0, 0);
        // Red revision cloud over the drawing, and a green check: "review the markups".
        var cloud = new Pen(new SolidColorBrush(PdfRed), 1.4 * s);
        for (int i = 0; i < 4; i++)
            dc.DrawEllipse(null, cloud, new Point((7.5 + i * 3.5) * s, 13 * s), 2.2 * s, 2.2 * s);
        for (int i = 0; i < 4; i++)
            dc.DrawEllipse(null, cloud, new Point((7.5 + i * 3.5) * s, 19 * s), 2.2 * s, 2.2 * s);
        dc.DrawEllipse(new SolidColorBrush(Colors.White), null, new Point(12.75 * s, 16 * s), 5.5 * s, 2.4 * s);
        var badge = new SolidColorBrush(Green);
        dc.DrawEllipse(badge, new Pen(Brushes.White, 1.2 * s), new Point(24 * s, 24 * s), 6.5 * s, 6.5 * s);
        var check = new Pen(Brushes.White, 1.8 * s) { StartLineCap = PenLineCap.Round, EndLineCap = PenLineCap.Round };
        dc.DrawLine(check, new Point(21 * s, 24 * s), new Point(23.2 * s, 26.3 * s));
        dc.DrawLine(check, new Point(23.2 * s, 26.3 * s), new Point(27.3 * s, 21.6 * s));
    });

    /// <summary>A page with a folded corner and a red "PDF" band, on a 32-unit grid scaled by <paramref name="s"/>.</summary>
    private static void Page(WpfDrawingContext dc, double s, double dx, double dy, bool faded = false)
    {
        var fill = new SolidColorBrush(faded ? Color.FromRgb(0xE9, 0xEC, 0xEF) : Colors.White);
        var edge = new Pen(new SolidColorBrush(faded ? Color.FromRgb(0x9A, 0xA5, 0xB1) : Ink), 1.2 * s);
        var outline = new StreamGeometry();
        using (var g = outline.Open())
        {
            g.BeginFigure(new Point((4 + dx) * s, (2 + dy) * s), true, true);
            g.LineTo(new Point((18 + dx) * s, (2 + dy) * s), true, false);
            g.LineTo(new Point((24 + dx) * s, (8 + dy) * s), true, false);
            g.LineTo(new Point((24 + dx) * s, (29 + dy) * s), true, false);
            g.LineTo(new Point((4 + dx) * s, (29 + dy) * s), true, false);
        }
        dc.DrawGeometry(fill, edge, outline);
        dc.DrawLine(edge, new Point((18 + dx) * s, (2 + dy) * s), new Point((18 + dx) * s, (8 + dy) * s));
        dc.DrawLine(edge, new Point((18 + dx) * s, (8 + dy) * s), new Point((24 + dx) * s, (8 + dy) * s));
        if (faded) return;
        dc.DrawRectangle(new SolidColorBrush(PdfRed), null, new Rect((4 + dx) * s, (3.5 + dy) * s, 9 * s, 4 * s));
    }

    private static void Arrow(WpfDrawingContext dc, double s, bool down)
    {
        var badge = new SolidColorBrush(Accent);
        dc.DrawEllipse(badge, new Pen(Brushes.White, 1.2 * s), new Point(24 * s, 24 * s), 6.5 * s, 6.5 * s);
        var pen = new Pen(Brushes.White, 1.8 * s) { StartLineCap = PenLineCap.Round, EndLineCap = PenLineCap.Round };
        double tip = down ? 27.5 : 20.5, tail = down ? 20.5 : 27.5, wing = down ? 25 : 23;
        dc.DrawLine(pen, new Point(24 * s, tail * s), new Point(24 * s, tip * s));
        dc.DrawLine(pen, new Point(21.5 * s, wing * s), new Point(24 * s, tip * s));
        dc.DrawLine(pen, new Point(26.5 * s, wing * s), new Point(24 * s, tip * s));
    }

    private static BitmapSource Render(int size, Action<WpfDrawingContext, double> draw)
    {
        var visual = new DrawingVisual();
        using (var dc = visual.RenderOpen()) draw(dc, size / 32.0);
        var bitmap = new RenderTargetBitmap(size, size, 96, 96, PixelFormats.Pbgra32);
        bitmap.Render(visual);
        bitmap.Freeze();
        return bitmap;
    }
}
