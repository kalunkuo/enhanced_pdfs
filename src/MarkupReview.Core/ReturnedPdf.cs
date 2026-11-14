using PdfSharp.Pdf;
using PdfSharp.Pdf.Advanced;
using PdfSharp.Pdf.IO;

namespace MarkupReview.Core;

/// <summary>An axis-aligned rectangle in PDF user space (x0 ≤ x1, y0 ≤ y1).</summary>
public readonly record struct PdfRect(double X0, double Y0, double X1, double Y1)
{
    public static PdfRect FromCorners(double ax, double ay, double bx, double by) =>
        new(Math.Min(ax, bx), Math.Min(ay, by), Math.Max(ax, bx), Math.Max(ay, by));
}

public sealed record PdfPageInfo(int Number, PdfRect Box, int Rotation);

/// <summary>A native PDF markup annotation found in a page's /Annots.</summary>
public sealed record PdfAnnot(int Page, string Id, string Subtype, string? Contents, string? Author, PdfRect Rect);

/// <summary>A returned enhanced PDF, read once into memory. The file is never modified.</summary>
public sealed class ReturnedPdf
{
    private const int MaxNameTreeNodes = 10_000;
    private static readonly HashSet<string> NonMarkupSubtypes = ["/Link", "/Widget", "/Popup"];

    public required string Path { get; init; }
    public required IReadOnlyDictionary<string, byte[]> Attachments { get; init; }
    public required IReadOnlyList<PdfPageInfo> Pages { get; init; }
    public required IReadOnlyList<PdfAnnot> Annots { get; init; }
    public int PageCount => Pages.Count;

    public static ReturnedPdf Open(string path)
    {
        using var pdf = PdfReader.Open(path, PdfDocumentOpenMode.Import);
        var pages = new List<PdfPageInfo>();
        var annots = new List<PdfAnnot>();
        for (int i = 0; i < pdf.PageCount; i++)
        {
            var page = pdf.Pages[i];
            var box = page.Elements.ContainsKey("/CropBox") ? page.CropBox : page.MediaBox;
            pages.Add(new PdfPageInfo(i + 1, PdfRect.FromCorners(box.X1, box.Y1, box.X2, box.Y2), page.Elements.GetInteger("/Rotate")));
            ReadAnnots(page, i + 1, annots);
        }

        return new ReturnedPdf { Path = path, Attachments = ReadAttachments(pdf), Pages = pages, Annots = annots };
    }

    private static void ReadAnnots(PdfPage page, int number, List<PdfAnnot> into)
    {
        if (page.Elements.GetObject("/Annots") is null) return;
        for (int i = 0; i < page.Annotations.Count; i++)
        {
            var annot = page.Annotations[i];
            string subtype = annot.Elements.GetName("/Subtype");
            if (NonMarkupSubtypes.Contains(subtype)) continue;
            var r = annot.Rectangle;
            string id = annot.Elements.GetString("/NM");
            if (string.IsNullOrEmpty(id)) id = $"annot-p{number}-{i}";
            into.Add(new PdfAnnot(number, id, subtype, NullIfEmpty(annot.Contents), NullIfEmpty(annot.Elements.GetString("/T")),
                PdfRect.FromCorners(r.X1, r.Y1, r.X2, r.Y2)));
        }
    }

    private static Dictionary<string, byte[]> ReadAttachments(PdfDocument pdf)
    {
        var result = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        var names = pdf.Internals.Catalog.Elements.GetDictionary("/Names");
        var root = names?.Elements.GetDictionary("/EmbeddedFiles");
        if (root is null) return result;

        // Bounded walk: a malformed tree must not loop forever.
        var pending = new Stack<PdfDictionary>([root]);
        int visited = 0;
        while (pending.Count > 0 && visited++ < MaxNameTreeNodes)
        {
            var node = pending.Pop();
            if (node.Elements.GetArray("/Kids") is { } kids)
                foreach (var kid in kids.Elements)
                    if (Resolve(kid) is PdfDictionary child) pending.Push(child);

            if (node.Elements.GetArray("/Names") is not { } entries) continue;
            for (int i = 0; i + 1 < entries.Elements.Count; i += 2)
            {
                if (Resolve(entries.Elements[i]) is not PdfString name) continue;
                if (Resolve(entries.Elements[i + 1]) is not PdfDictionary spec) continue;
                var stream = spec.Elements.GetDictionary("/EF")?.Elements.GetDictionary("/F")?.Stream;
                if (stream is not null) result[name.Value] = stream.UnfilteredValue;
            }
        }
        return result;
    }

    private static PdfItem? Resolve(PdfItem? item) => item is PdfReference reference ? reference.Value : item;
    private static string? NullIfEmpty(string? s) => string.IsNullOrEmpty(s) ? null : s;
}
