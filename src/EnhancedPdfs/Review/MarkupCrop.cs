using System.Windows.Media.Imaging;
using MarkupReview.Core;
using Windows.Data.Pdf;
using Windows.Storage;
using Windows.Storage.Streams;

namespace EnhancedPdfs.Review;

/// <summary>Renders the area around a markup from the returned PDF with Windows' built-in PDF renderer.</summary>
internal static class MarkupCrop
{
    private const double Margin = 0.10;   // of the markup's larger side, each way
    private const double MinSide = 120;   // PDF points, so a sticky note still shows its surroundings

    public static async Task<BitmapSource?> RenderAsync(ReturnedPdf pdf, Markup markup, int pixelWidth)
    {
        var page = pdf.Pages.FirstOrDefault(p => p.Number == markup.Page);
        if (page is null) return null;

        var file = await StorageFile.GetFileFromPathAsync(Path.GetFullPath(pdf.Path));
        var document = await PdfDocument.LoadFromFileAsync(file);
        using var pdfPage = document.GetPage((uint)(markup.Page - 1));

        // PDF user space (y up, page box origin) → the renderer's page space (DIPs, y down, top-left).
        double scale = pdfPage.Size.Width / (page.Box.X1 - page.Box.X0);
        var r = Expand(markup.Rect, page.Box);
        var source = new Windows.Foundation.Rect(
            (r.X0 - page.Box.X0) * scale, (page.Box.Y1 - r.Y1) * scale,
            (r.X1 - r.X0) * scale, (r.Y1 - r.Y0) * scale);

        using var stream = new InMemoryRandomAccessStream();
        await pdfPage.RenderToStreamAsync(stream, new PdfPageRenderOptions
        {
            SourceRect = source,
            DestinationWidth = (uint)pixelWidth,
            BackgroundColor = Windows.UI.Color.FromArgb(255, 255, 255, 255),
        });

        var bitmap = new BitmapImage();
        bitmap.BeginInit();
        bitmap.CacheOption = BitmapCacheOption.OnLoad;
        bitmap.StreamSource = stream.AsStreamForRead();
        bitmap.EndInit();
        bitmap.Freeze();
        return bitmap;
    }

    private static PdfRect Expand(PdfRect r, PdfRect box)
    {
        double side = Math.Max(Math.Max(r.X1 - r.X0, r.Y1 - r.Y0), MinSide);
        double cx = (r.X0 + r.X1) / 2, cy = (r.Y0 + r.Y1) / 2;
        double half = side * (0.5 + Margin);
        return new PdfRect(
            Math.Max(box.X0, cx - half), Math.Max(box.Y0, cy - half * 0.75),
            Math.Min(box.X1, cx + half), Math.Min(box.Y1, cy + half * 0.75));
    }
}
