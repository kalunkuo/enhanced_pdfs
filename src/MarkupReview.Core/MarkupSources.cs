using System.Text.Json;
using System.Text.RegularExpressions;

namespace MarkupReview.Core;

public sealed record MarkupLink(string ElementKey, string Relation);

public sealed record Markup(
    string Id, int Page, string Kind, string? Text, string? Author, DateTimeOffset? Created,
    PdfRect Rect, IReadOnlyList<MarkupLink> Links);

// Acrobat smart-markup plug-in tables (poc/smart-annotations spec, schema version 1).
public sealed class AcrobatAnnotationRow
{
    public string AnnotationId { get; set; } = "";
    public int Page { get; set; }
    public string Kind { get; set; } = "";
    public string? Text { get; set; }
    public string? Author { get; set; }
    public string? Status { get; set; }
    public string? CreatedUtc { get; set; }
    public List<double>? SheetRect { get; set; }
}

public sealed class AcrobatLinkRow
{
    public string AnnotationId { get; set; } = "";
    public string ElementKey { get; set; } = "";
    public string Relation { get; set; } = "";
}

/// <summary>Reads markups from whichever source a returned PDF carries.</summary>
public static partial class MarkupSources
{
    public const string ViewerFile = "annotations.json";
    public const string AcrobatAnnotationsFile = "annotations.parquet";
    public const string AcrobatLinksFile = "annotation-links.parquet";

    // ASCII digits only: \d would match other scripts' digits, which long.Parse rejects.
    [GeneratedRegex(@"(?<![0-9])[0-9]{4,9}(?![0-9])")]
    private static partial Regex ElementIdPattern();

    public static (IReadOnlyList<Markup> Markups, string Source) Read(ReturnedPdf pdf, ExportTables tables)
    {
        if (pdf.Attachments.ContainsKey(AcrobatAnnotationsFile))
            return (ReadAcrobat(pdf, tables), "acrobat");
        if (pdf.Attachments.TryGetValue(ViewerFile, out var json))
            return (ReadViewer(pdf, json, tables), "viewer");
        return (ReadAnnots(pdf, tables), "annots");
    }

    private static List<Markup> ReadAcrobat(ReturnedPdf pdf, ExportTables tables)
    {
        var links = ExportTables.Rows<AcrobatLinkRow>(pdf, AcrobatLinksFile).ToLookup(l => l.AnnotationId);
        var result = new List<Markup>();
        foreach (var row in ExportTables.Rows<AcrobatAnnotationRow>(pdf, AcrobatAnnotationsFile))
        {
            if (string.Equals(row.Status, "Deleted", StringComparison.OrdinalIgnoreCase)) continue;
            var r = row.SheetRect is { Count: 4 } s ? PdfRect.FromCorners(s[0], s[1], s[2], s[3]) : default;
            var own = links[row.AnnotationId].Select(l => new MarkupLink(l.ElementKey, l.Relation)).ToList();
            result.Add(new Markup(row.AnnotationId, row.Page, row.Kind, row.Text, row.Author, ParseTime(row.CreatedUtc), r,
                WithMentions(own, row.Text, tables)));
        }
        return result;
    }

    private static List<Markup> ReadViewer(ReturnedPdf pdf, byte[] json, ExportTables tables)
    {
        using var doc = JsonDocument.Parse(json);
        var result = new List<Markup>();
        if (!doc.RootElement.TryGetProperty("annotations", out var annotations)) return result;
        foreach (var a in annotations.EnumerateArray())
        {
            int pageNumber = a.GetProperty("page").GetInt32();
            var page = pdf.Pages.FirstOrDefault(p => p.Number == pageNumber)
                ?? throw new InvalidDataException($"Markup {Str(a, "id")} is on page {pageNumber}, which this PDF does not have.");
            if (page.Rotation % 360 != 0)
                throw new InvalidDataException($"Page {pageNumber} is rotated; rotated pages are not supported yet.");

            var points = new List<(double X, double Y)> { Point(a.GetProperty("from")), Point(a.GetProperty("to")) };
            if (a.TryGetProperty("points", out var extra) && extra.ValueKind == JsonValueKind.Array)
                points.AddRange(extra.EnumerateArray().Select(Point));
            // Viewer space: top-left origin of the visible page box, y down, scale 1.
            var xs = points.Select(p => page.Box.X0 + p.X).ToList();
            var ys = points.Select(p => page.Box.Y1 - p.Y).ToList();
            var rect = new PdfRect(xs.Min(), ys.Min(), xs.Max(), ys.Max());

            string? text = WithReplies(Str(a, "text"), a);
            var own = new List<MarkupLink>();
            if (Str(a, "elementKey") is { } key) own.Add(new MarkupLink(key, "linked"));
            // Revision clouds list what they cover; elements only partly inside are "overlapping".
            if (a.TryGetProperty("contained", out var contained) && contained.ValueKind == JsonValueKind.Array)
                foreach (var c in contained.EnumerateArray())
                    if (Str(c, "key") is { } k && own.All(l => l.ElementKey != k))
                        own.Add(new MarkupLink(k, c.TryGetProperty("fully", out var f) && f.ValueKind == JsonValueKind.False ? "overlapping" : "linked"));

            string? author = a.TryGetProperty("author", out var au) && au.ValueKind == JsonValueKind.Object ? Str(au, "name") : null;
            result.Add(new Markup(Str(a, "id") ?? $"viewer-{result.Count}", pageNumber, Str(a, "kind") ?? "unknown",
                text, author, ParseTime(Str(a, "createdAt")), rect, WithMentions(own, text, tables)));
        }
        return result;
    }

    private static List<Markup> ReadAnnots(ReturnedPdf pdf, ExportTables tables) =>
        pdf.Annots.Select(a => new Markup(a.Id, a.Page, a.Subtype.TrimStart('/'), a.Contents, a.Author, null, a.Rect,
            WithMentions([], a.Contents, tables))).ToList();

    /// <summary>Adds <c>referenced</c> links for 4–9 digit element IDs in the text that are not already linked.</summary>
    private static IReadOnlyList<MarkupLink> WithMentions(List<MarkupLink> links, string? text, ExportTables tables)
    {
        if (string.IsNullOrEmpty(text)) return links;
        var known = links.Select(l => l.ElementKey).ToHashSet(StringComparer.Ordinal);
        foreach (Match match in ElementIdPattern().Matches(text))
        {
            if (!long.TryParse(match.Value, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out long id)) continue;
            foreach (var element in tables.ElementsById[id])
                if (known.Add(element.ElementKey))
                    links.Add(new MarkupLink(element.ElementKey, "referenced"));
        }
        return links;
    }

    /// <summary>Comment threads: replies often carry the actual instruction ("agreed, use 36in"), so Claude reads them too.</summary>
    private static string? WithReplies(string? text, JsonElement a)
    {
        if (!a.TryGetProperty("replies", out var replies) || replies.ValueKind != JsonValueKind.Array) return text;
        var lines = new List<string>();
        if (!string.IsNullOrEmpty(text)) lines.Add(text);
        foreach (var r in replies.EnumerateArray())
        {
            if (Str(r, "text") is not { Length: > 0 } reply) continue;
            string who = r.TryGetProperty("author", out var au) && au.ValueKind == JsonValueKind.Object ? Str(au, "name") ?? "someone" : "someone";
            lines.Add($"— reply from {who}: {reply}");
        }
        return lines.Count == 0 ? null : string.Join("\n", lines);
    }

    private static (double X, double Y) Point(JsonElement p) => (p.GetProperty("x").GetDouble(), p.GetProperty("y").GetDouble());
    private static string? Str(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    private static DateTimeOffset? ParseTime(string? s) => DateTimeOffset.TryParse(s, out var t) ? t : null;
}
