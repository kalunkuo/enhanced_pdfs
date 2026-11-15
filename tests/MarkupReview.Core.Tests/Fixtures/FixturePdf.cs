using System.Text;
using System.Text.Json;
using Parquet;
using Parquet.Serialization;
using PdfSharp.Pdf;
using PdfSharp.Pdf.Annotations;
using PdfSharp.Pdf.Advanced;

namespace MarkupReview.Core.Tests.Fixtures;

// Write-side rows with the exporter's column names and types (src/EnhancedPdfs/DrawingData.cs).
public sealed class DrawingRowW
{
    public string DrawingId { get; set; } = "";
    public string? ParentDrawingId { get; set; }
    public string ViewUniqueId { get; set; } = "";
    public long ViewId { get; set; }
    public int Page { get; set; }
    public string Name { get; set; } = "";
    public string Kind { get; set; } = "";
    public int? Scale { get; set; }
    public string? SheetNumber { get; set; }
    public string? DetailNumber { get; set; }
    public string? Revision { get; set; }
    public string Model { get; set; } = "";
    public string ModelKey { get; set; } = "";
    public string RevitVersion { get; set; } = "2025";
    public string ExportedUtc { get; set; } = "2026-11-10T09:00:00Z";
    public string? SavedVersion { get; set; }
    public bool HasUnsavedChanges { get; set; }
    public string CollectionMethod { get; set; } = "CustomExporter";
    public int SchemaVersion { get; set; } = 1;
}

public sealed class ElementRowW
{
    public string ElementKey { get; set; } = "";
    public string ModelKey { get; set; } = "";
    public string Model { get; set; } = "";
    public long? LinkInstanceId { get; set; }
    public string UniqueId { get; set; } = "";
    public long ElementId { get; set; }
    public string Category { get; set; } = "";
    public long? CategoryId { get; set; }
    public string Name { get; set; } = "";
    public string? Family { get; set; }
    public string? Type { get; set; }
    public string? TypeKey { get; set; }
    public long? TypeId { get; set; }
    public string? Level { get; set; }
    public string? Mark { get; set; }
    public string? WallFunction { get; set; }
    public string? FireRating { get; set; }
    public string? FireRatingSource { get; set; }
    public string VersionGuid { get; set; } = "";
}

public sealed class AppearanceRowW
{
    public string DrawingId { get; set; } = "";
    public string ElementKey { get; set; } = "";
    public string Source { get; set; } = "";
}

public sealed class ParameterRowW
{
    public string OwnerKey { get; set; } = "";
    public string Scope { get; set; } = "";
    public long ParameterId { get; set; }
    public string? SharedGuid { get; set; }
    public string Name { get; set; } = "";
    public string Storage { get; set; } = "";
    public string? SpecId { get; set; }
    public string? UnitId { get; set; }
    public string? DisplayValue { get; set; }
    public string? TextValue { get; set; }
    public long? IntegerValue { get; set; }
    public double? InternalValue { get; set; }
    public long? ReferenceId { get; set; }
}

// Acrobat plug-in tables (poc/smart-annotations spec, schema version 1).
public sealed class AcrobatAnnotationW
{
    public string AnnotationId { get; set; } = "";
    public string DrawingId { get; set; } = "";
    public int Page { get; set; }
    public string Kind { get; set; } = "";
    public string? Subtype { get; set; }
    public string? Text { get; set; }
    public string? Author { get; set; }
    public string Status { get; set; } = "Open";
    public string? CreatedUtc { get; set; }
    public string? ModifiedUtc { get; set; }
    public List<double> SheetRect { get; set; } = [];
    public int SchemaVersion { get; set; } = 1;
}

public sealed class AcrobatLinkW
{
    public string AnnotationId { get; set; } = "";
    public string ElementKey { get; set; } = "";
    public long ElementId { get; set; }
    public string Relation { get; set; } = "linked";
}

// Nullable twins: tools like DuckDB write every column as optional (definition level 1).
public sealed class DrawingRowN
{
    public string? DrawingId { get; set; }
    public string? ParentDrawingId { get; set; }
    public string? ViewUniqueId { get; set; }
    public long? ViewId { get; set; }
    public int? Page { get; set; }
    public string? Name { get; set; }
    public string? Model { get; set; }
    public string? ModelKey { get; set; }
    public string? ExportedUtc { get; set; }
    public bool? HasUnsavedChanges { get; set; }
    public int? SchemaVersion { get; set; }
}

public sealed class ElementRowN
{
    public string? ElementKey { get; set; }
    public string? ModelKey { get; set; }
    public long? LinkInstanceId { get; set; }
    public string? UniqueId { get; set; }
    public long? ElementId { get; set; }
    public string? Category { get; set; }
    public string? Name { get; set; }
    public string? Family { get; set; }
    public string? Type { get; set; }
    public string? TypeKey { get; set; }
    public string? VersionGuid { get; set; }
}

public sealed class AcrobatAnnotationN
{
    public string? AnnotationId { get; set; }
    public int? Page { get; set; }
    public string? Kind { get; set; }
    public string? Text { get; set; }
    public string? Author { get; set; }
    public string? Status { get; set; }
    public string? CreatedUtc { get; set; }
    public List<double>? SheetRect { get; set; }
    public int? SchemaVersion { get; set; }
}

public sealed class AcrobatLinkN
{
    public string? AnnotationId { get; set; }
    public string? ElementKey { get; set; }
    public long? ElementId { get; set; }
    public string? Relation { get; set; }
}

/// <summary>Builds a synthetic enhanced PDF in memory: one Snowdon-like page plus exporter tables.</summary>
public sealed class FixturePdf
{
    public const string ModelKey = "model-key-1";
    public const string WallKey = "model-key-1:676281";
    public const string DoorKey = "model-key-1:700108";
    public const string DrawingId = "drawing-a101";

    // Snowdon A101 MediaBox.
    public double Left = -1512.12, Bottom = -1080, Right = 1512.12, Top = 1080;

    public List<DrawingRowW> Drawings { get; } =
    [
        new() { DrawingId = DrawingId, ViewUniqueId = "view-uid-a101", ViewId = 1001, Page = 1, Name = "A101 - First Floor Plan", Kind = "Sheet", Model = "Snowdon Towers Sample Architectural", ModelKey = ModelKey },
    ];

    public List<ElementRowW> Elements { get; } =
    [
        new() { ElementKey = WallKey, ModelKey = ModelKey, Model = "Snowdon", UniqueId = "wall-uid", ElementId = 676281, Category = "Walls", Name = "Exterior - Brick", Family = "Basic Wall", Type = "Exterior - Brick", TypeKey = "model-key-1:t1", TypeId = 1, WallFunction = "Exterior", FireRating = "2 HR", VersionGuid = "v-wall-1" },
        new() { ElementKey = DoorKey, ModelKey = ModelKey, Model = "Snowdon", UniqueId = "door-uid", ElementId = 700108, Category = "Doors", Name = "32\" x 84\"", Family = "Single-Flush", Type = "32\" x 84\"", TypeKey = "model-key-1:t2", TypeId = 2, Mark = "108E", VersionGuid = "v-door-1" },
    ];

    public List<ParameterRowW> Parameters { get; } =
    [
        new() { OwnerKey = "model-key-1:t1", Scope = "Type", ParameterId = -1001, Name = "Fire Rating", Storage = "String", DisplayValue = "2 HR", TextValue = "2 HR" },
    ];

    /// <summary>Write drawings, elements and the Acrobat tables with every column optional, as DuckDB does.</summary>
    public bool AllNullable { get; set; }

    public string? ViewerJson { get; set; }
    public List<AcrobatAnnotationW>? AcrobatAnnotations { get; set; }
    public List<AcrobatLinkW>? AcrobatLinks { get; set; }
    public List<(string Contents, PdfSharp.Drawing.XRect Rect)> PageAnnots { get; } = [];

    public static string ViewerAnnotations(params object[] annotations) =>
        JsonSerializer.Serialize(new { app = "enhanced-pdf-viewer", version = 1, annotations });

    public string Save(string directory, string name = "returned.pdf")
    {
        var pdf = new PdfDocument();
        var page = pdf.AddPage();
        page.MediaBox = new PdfRectangle(new PdfSharp.Drawing.XPoint(Left, Bottom), new PdfSharp.Drawing.XPoint(Right, Top));
        foreach (var (contents, rect) in PageAnnots)
        {
            var annot = new PdfTextAnnotation { Contents = contents, Rectangle = new PdfRectangle(rect) };
            page.Annotations.Add(annot);
        }

        if (AllNullable)
        {
            Attach(pdf, "drawings.parquet", Drawings.Select(d => new DrawingRowN { DrawingId = d.DrawingId, ParentDrawingId = d.ParentDrawingId, ViewUniqueId = d.ViewUniqueId, ViewId = d.ViewId, Page = d.Page, Name = d.Name, Model = d.Model, ModelKey = d.ModelKey, ExportedUtc = d.ExportedUtc, HasUnsavedChanges = d.HasUnsavedChanges, SchemaVersion = d.SchemaVersion }));
            Attach(pdf, "elements.parquet", Elements.Select(e => new ElementRowN { ElementKey = e.ElementKey, ModelKey = e.ModelKey, LinkInstanceId = e.LinkInstanceId, UniqueId = e.UniqueId, ElementId = e.ElementId, Category = e.Category, Name = e.Name, Family = e.Family, Type = e.Type, TypeKey = e.TypeKey, VersionGuid = e.VersionGuid }));
        }
        else
        {
            Attach(pdf, "drawings.parquet", Drawings);
            Attach(pdf, "elements.parquet", Elements);
        }
        Attach(pdf, "appearances.parquet", Elements.Select(e => new AppearanceRowW { DrawingId = DrawingId, ElementKey = e.ElementKey, Source = "Exporter" }));
        Attach(pdf, "parameters.parquet", Parameters);
        if (ViewerJson is not null)
            pdf.AddEmbeddedFile("annotations.json", new MemoryStream(Encoding.UTF8.GetBytes(ViewerJson)));
        if (AcrobatAnnotations is not null)
        {
            if (AllNullable)
                Attach(pdf, "annotations.parquet", AcrobatAnnotations.Select(a => new AcrobatAnnotationN { AnnotationId = a.AnnotationId, Page = a.Page, Kind = a.Kind, Text = a.Text, Author = a.Author, Status = a.Status, CreatedUtc = a.CreatedUtc, SheetRect = a.SheetRect, SchemaVersion = a.SchemaVersion }));
            else
                Attach(pdf, "annotations.parquet", AcrobatAnnotations);
        }
        if (AcrobatLinks is not null)
        {
            if (AllNullable)
                Attach(pdf, "annotation-links.parquet", AcrobatLinks.Select(l => new AcrobatLinkN { AnnotationId = l.AnnotationId, ElementKey = l.ElementKey, ElementId = l.ElementId, Relation = l.Relation }));
            else
                Attach(pdf, "annotation-links.parquet", AcrobatLinks);
        }

        string path = Path.Combine(directory, name);
        pdf.Save(path);
        return path;
    }

    private static void Attach<T>(PdfDocument pdf, string name, IEnumerable<T> rows)
    {
        var buffer = new MemoryStream();
        ParquetSerializer.SerializeAsync(rows, buffer, new ParquetOptions { CompressionMethod = CompressionMethod.Gzip }).GetAwaiter().GetResult();
        buffer.Position = 0;
        pdf.AddEmbeddedFile(name, buffer);
    }
}

public sealed class TempDir : IDisposable
{
    public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "mr-tests-" + Guid.NewGuid().ToString("N"));
    public TempDir() => Directory.CreateDirectory(Path);
    public void Dispose() { try { Directory.Delete(Path, true); } catch (IOException) { } }
}
