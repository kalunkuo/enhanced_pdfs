using System.Globalization;
using Parquet;
using Parquet.Serialization;
using PdfSharp.Pdf;
using PdfSharp.Pdf.Advanced;
using PdfSharp.Pdf.IO;

namespace MarkupReview.Core;

/// <summary>One row of review-decisions.parquet (schema version 1).</summary>
public sealed class DecisionRow
{
    public string ProposalId { get; set; } = "";
    public string AnnotationId { get; set; } = "";
    public string? ElementKey { get; set; }
    public string ChangeKind { get; set; } = "";
    public string? Parameter { get; set; }
    public string? Scope { get; set; }
    public string? OldValue { get; set; }
    public string? NewValue { get; set; }
    public string? Reason { get; set; }
    public string Decision { get; set; } = "";
    public string? DecisionReason { get; set; }
    public string? Reviewer { get; set; }
    public string? DecidedUtc { get; set; }
    public int SchemaVersion { get; set; } = 1;
}

/// <summary>Writes a reviewed copy of the returned PDF. The source file is never modified.</summary>
public static class DecisionsWriter
{
    public const string FileName = "review-decisions.parquet";
    private const string Suffix = "-reviewed";

    public static string OutputPath(string sourcePath)
    {
        string name = Path.GetFileNameWithoutExtension(sourcePath);
        if (!name.EndsWith(Suffix, StringComparison.OrdinalIgnoreCase)) name += Suffix;
        return Path.Combine(Path.GetDirectoryName(sourcePath) ?? "", name + ".pdf");
    }

    public static string Write(ReturnedPdf source, ReviewSession session, string reviewer)
    {
        string output = OutputPath(source.Path);
        // Read from memory so writing over an existing "-reviewed" source is safe.
        using var pdf = PdfReader.Open(new MemoryStream(File.ReadAllBytes(source.Path)), PdfDocumentOpenMode.Modify);

        var entries = CollectEntries(pdf).Where(e => e.Name != FileName).ToList();
        entries.Add(new Entry(FileName, NewFileSpec(pdf, FileName, Serialize(Rows(session, reviewer)).ToArray())));
        SetFlatTree(pdf, [.. entries.OrderBy(e => e.Name, StringComparer.Ordinal)]);

        string temp = output + ".tmp";
        pdf.Save(temp);
        File.Move(temp, output, overwrite: true);
        return output;
    }

    internal static IEnumerable<DecisionRow> Rows(ReviewSession session, string reviewer)
    {
        foreach (var p in session.Proposals)
        {
            var (kind, parameter, scope) = p.Change switch
            {
                SetParameter s => ("set_parameter", s.Name, s.Scope.ToString()),
                ChangeType => ("change_type", (string?)"Type", (string?)null),
                _ => ("unknown", null, null),
            };
            yield return new DecisionRow
            {
                ProposalId = p.Id, AnnotationId = p.MarkupId, ElementKey = p.ElementKey, ChangeKind = kind,
                Parameter = parameter, Scope = scope, OldValue = p.OldValue, NewValue = p.NewValue, Reason = p.Reason,
                Decision = p.Status.ToString().ToLowerInvariant(), DecisionReason = p.DecisionReason ?? p.BlockReason,
                Reviewer = p.Status is ProposalStatus.Approved or ProposalStatus.Rejected ? reviewer : null,
                DecidedUtc = p.DecidedUtc?.ToString("O", CultureInfo.InvariantCulture),
            };
        }
        foreach (var n in session.Notes)
            yield return new DecisionRow { ProposalId = n.Id, AnnotationId = n.MarkupId, ChangeKind = "note", Reason = n.Text, Decision = "note" };
    }

    private static MemoryStream Serialize(IEnumerable<DecisionRow> rows)
    {
        var buffer = new MemoryStream();
        ParquetSerializer.SerializeAsync(rows.ToList(), buffer, new ParquetOptions { CompressionMethod = CompressionMethod.Gzip }).GetAwaiter().GetResult();
        buffer.Position = 0;
        return buffer;
    }

    private sealed record Entry(string Name, PdfItem FileSpec);

    /// <summary>An /EmbeddedFile stream plus its /Filespec, added as indirect objects (PDF 32000 §7.11.4).</summary>
    private static PdfReference NewFileSpec(PdfDocument pdf, string name, byte[] data)
    {
        var file = new PdfDictionary(pdf);
        file.Elements["/Type"] = new PdfName("/EmbeddedFile");
        file.Elements["/Subtype"] = new PdfName("/application#2Fvnd.apache.parquet");
        var parameters = new PdfDictionary(pdf);
        parameters.Elements["/Size"] = new PdfInteger(data.Length);
        file.Elements["/Params"] = parameters;
        file.CreateStream(data);
        pdf.Internals.AddObject(file);

        var ef = new PdfDictionary(pdf);
        ef.Elements["/F"] = file.Reference;
        var spec = new PdfDictionary(pdf);
        spec.Elements["/Type"] = new PdfName("/Filespec");
        spec.Elements["/F"] = new PdfString(name);
        spec.Elements["/UF"] = new PdfString(name);
        spec.Elements["/EF"] = ef;
        pdf.Internals.AddObject(spec);
        return spec.Reference!;
    }

    private static List<Entry> CollectEntries(PdfDocument pdf)
    {
        var result = new List<Entry>();
        var root = pdf.Internals.Catalog.Elements.GetDictionary("/Names")?.Elements.GetDictionary("/EmbeddedFiles");
        if (root is null) return result;
        var seen = new HashSet<PdfDictionary>(ReferenceEqualityComparer.Instance);
        var pending = new Stack<PdfDictionary>([root]);
        while (pending.Count > 0)
        {
            var node = pending.Pop();
            if (!seen.Add(node) || seen.Count > ReturnedPdf.MaxNameTreeNodes) continue;
            if (node.Elements.GetArray("/Kids") is { } kids)
                foreach (var kid in kids.Elements)
                    if ((kid is PdfReference r ? r.Value : kid) is PdfDictionary child) pending.Push(child);
            if (node.Elements.GetArray("/Names") is not { } names) continue;
            for (int i = 0; i + 1 < names.Elements.Count; i += 2)
                if ((names.Elements[i] is PdfReference r ? r.Value : names.Elements[i]) is PdfString name)
                    result.Add(new Entry(name.Value, names.Elements[i + 1]));
        }
        return result;
    }

    /// <summary>Replaces the EmbeddedFiles tree with a single flat, ordered /Names array.</summary>
    private static void SetFlatTree(PdfDocument pdf, List<Entry> entries)
    {
        var catalog = pdf.Internals.Catalog;
        var names = catalog.Elements.GetDictionary("/Names");
        if (names is null) { names = new PdfDictionary(pdf); catalog.Elements["/Names"] = names; }
        var tree = new PdfDictionary(pdf);
        var array = new PdfArray(pdf);
        foreach (var e in entries) { array.Elements.Add(new PdfString(e.Name)); array.Elements.Add(e.FileSpec); }
        tree.Elements["/Names"] = array;
        names.Elements["/EmbeddedFiles"] = tree;
    }
}
