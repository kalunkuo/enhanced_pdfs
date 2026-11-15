using System.Security.Cryptography;
using System.Text.Json;
using Parquet;
using Parquet.Serialization;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;

namespace EnhancedPdfs;

internal static class PdfEnrichment
{
    public static void Write(string sourcePath, string outputPath, DrawingData data)
    {
        using var pdf = PdfReader.Open(sourcePath, PdfDocumentOpenMode.Modify);
        int expectedPages = data.Drawings.Count(drawing => drawing.ParentDrawingId is null);
        if (pdf.PageCount != expectedPages)
            throw new InvalidDataException($"Revit returned {pdf.PageCount} PDF pages for {expectedPages} views and sheets. The BIM data could not be matched to the pages.");

        var text = new PageText(data);
        for (int index = 0; index < pdf.PageCount; index++)
            HiddenText.Append(pdf, pdf.Pages[index], text.Lines(index + 1));

        var tables = new List<TableInfo>
        {
            Attach(pdf, "drawings.parquet", data.Drawings),
            Attach(pdf, "elements.parquet", data.Elements.Values),
            Attach(pdf, "appearances.parquet", data.Appearances.OrderBy(row => row.DrawingId).ThenBy(row => row.ElementKey)),
            Attach(pdf, "parameters.parquet", data.Parameters),
        };
        if (data.ScheduleCells.Count > 0)
            tables.Add(Attach(pdf, "schedule-cells.parquet", data.ScheduleCells));
        AttachManifest(pdf, data, tables);

        pdf.Save(outputPath);
    }

    private static TableInfo Attach<T>(PdfDocument pdf, string name, IEnumerable<T> rows)
    {
        var list = rows as IReadOnlyCollection<T> ?? rows.ToList();
        using var buffer = new MemoryStream();
        var options = new ParquetOptions { CompressionMethod = CompressionMethod.Gzip };
        ParquetSerializer.SerializeAsync(list, buffer, options).GetAwaiter().GetResult();
        byte[] bytes = buffer.ToArray();
        buffer.Position = 0;
        pdf.AddEmbeddedFile(name, buffer);
        return new TableInfo(name, list.Count, bytes.Length, Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant());
    }

    /// <summary>
    /// manifest.json names the model-backed attachments with their row counts and SHA-256 hashes,
    /// together with the model version and export provenance. A reader can tell which attachments
    /// were written by the exporter and whether they are unchanged. Attachments other tools add
    /// later (review markups, links) are deliberately not listed: they are a different layer.
    /// </summary>
    private static void AttachManifest(PdfDocument pdf, DrawingData data, IReadOnlyList<TableInfo> tables)
    {
        var roots = data.Drawings.Where(drawing => drawing.ParentDrawingId is null).OrderBy(drawing => drawing.Page).ToList();
        var first = roots[0];
        var linked = data.Elements.Values.Where(element => element.ModelKey != first.ModelKey)
            .Select(element => (element.ModelKey, element.Model)).Distinct().OrderBy(model => model.Model)
            .Select(model => new { modelKey = model.ModelKey, name = model.Model }).ToList();
        var manifest = new
        {
            format = "enhanced-pdf",
            schemaVersion = DrawingData.SchemaVersion,
            generator = new
            {
                name = "EnhancedPdfs Revit add-in",
                version = typeof(PdfEnrichment).Assembly.GetName().Version?.ToString(3),
                revitVersion = first.RevitVersion,
            },
            exportedUtc = first.ExportedUtc,
            model = new { name = first.Model, modelKey = first.ModelKey, savedVersion = first.SavedVersion, hasUnsavedChanges = first.HasUnsavedChanges },
            linkedModels = linked,
            pages = roots.Select(root => new { page = root.Page, drawingId = root.DrawingId, name = root.Name, kind = root.Kind, sheetNumber = root.SheetNumber }).ToList(),
            tables = tables.Select(table => new { name = table.Name, rows = table.Rows, bytes = table.Bytes, sha256 = table.Sha256 }).ToList(),
        };
        using var json = new MemoryStream(JsonSerializer.SerializeToUtf8Bytes(manifest, new JsonSerializerOptions { WriteIndented = true }));
        pdf.AddEmbeddedFile("manifest.json", json);
    }

    private sealed record TableInfo(string Name, int Rows, int Bytes, string Sha256);
}

internal sealed class PageText(DrawingData data)
{
    private readonly ILookup<int, DrawingRow> _drawingsByPage = data.Drawings.ToLookup(row => row.Page);
    private readonly ILookup<string, AppearanceRow> _appearancesByDrawing = data.Appearances.ToLookup(row => row.DrawingId);
    private readonly ILookup<string, ScheduleCellRow> _cellsByDrawing = data.ScheduleCells.ToLookup(row => row.DrawingId);
    private readonly ILookup<int, DrawingNote> _notesByPage = data.Notes.ToLookup(row => row.Page);

    public IEnumerable<string> Lines(int page)
    {
        var drawings = _drawingsByPage[page];
        var root = drawings.Single(row => row.ParentDrawingId is null);
        yield return "REVIT BIM DATA";
        yield return $"Model: {root.Model} | Revit: {root.RevitVersion} | Exported UTC: {root.ExportedUtc}";
        yield return "Revit element properties as exported. Blank fire ratings are unspecified.";
        foreach (var line in FileDescription())
            yield return line;
        foreach (var note in _notesByPage[page])
            yield return $"Coverage: {note.Text}";

        foreach (var drawing in drawings)
        {
            var members = _appearancesByDrawing[drawing.DrawingId].Select(row => data.Elements[row.ElementKey])
                .OrderBy(element => element.Category, StringComparer.Ordinal)
                .ThenBy(element => element.ElementId).ToArray();
            string detail = drawing.DetailNumber is null ? "" : $" | Detail: {drawing.DetailNumber}";
            string sheet = drawing.SheetNumber is null ? "" : $" | Sheet: {drawing.SheetNumber}";
            yield return $"Drawing: {drawing.Name}{sheet}{detail} | {drawing.Kind} | Revit view ID: {drawing.ViewId}";

            var exteriorWalls = members.Where(element => element.WallFunction == "Exterior")
                .GroupBy(element => (element.Model, element.Type, element.FireRating, element.FireRatingSource));
            foreach (var walls in exteriorWalls)
            {
                yield return $"Exterior walls | {walls.Key.Type} | Fire Rating: {walls.Key.FireRating ?? "unspecified"}"
                    + $" | Source: {walls.Key.FireRatingSource ?? "blank"} | Instances: {walls.Count()} | Model: {walls.Key.Model}";
            }
            foreach (var element in members)
            {
                var fields = new List<string> { $"Element ID: {element.ElementId}", $"UniqueId: {element.UniqueId}", element.Category, element.Name };
                if (element.Family is not null)
                    fields.Add($"Family: {element.Family}");
                if (element.Type is not null && element.Type != element.Name)
                    fields.Add($"Type: {element.Type}");
                if (element.WallFunction is not null)
                    fields.Add($"Function: {element.WallFunction}");
                if (element.FireRating is not null || element.WallFunction is not null)
                    fields.Add($"Fire Rating: {element.FireRating ?? "unspecified"}");
                if (element.Level is not null)
                    fields.Add($"Level: {element.Level}");
                if (element.Mark is not null)
                    fields.Add($"Mark: {element.Mark}");
                if (element.LinkInstanceId is not null)
                    fields.Add($"Linked model: {element.Model} (instance {element.LinkInstanceId})");
                yield return string.Join(" | ", fields);
            }

            foreach (var row in _cellsByDrawing[drawing.DrawingId].GroupBy(cell => (cell.Section, cell.Row)))
            {
                yield return $"Schedule {row.Key.Section} {row.Key.Row}: " +
                    string.Join(" | ", row.OrderBy(cell => cell.Column).Select(cell => cell.Value));
            }
        }
        yield return "Complete instance and type parameter tables are embedded as Parquet attachments.";
    }

    /// <summary>
    /// A plain description of what the file contains and how its tables join. It is a
    /// description of data, written for any reader that extracts page text (people, search,
    /// coding agents), and deliberately contains no instructions.
    /// </summary>
    private IEnumerable<string> FileDescription()
    {
        yield return "About this file: a Revit drawing exported as PDF together with the BIM data of what is drawn on it. "
            + "This invisible text layer lists the elements on this page; the complete data is in the PDF's embedded files (attachments).";
        string scheduleCells = data.ScheduleCells.Count > 0
            ? " schedule-cells.parquet: text of the schedules placed on the sheets (DrawingId, Section, Row, Column, Value)."
            : "";
        yield return "Embedded files (Apache Parquet, gzip): drawings.parquet: one row per sheet, placed view or schedule "
            + "(DrawingId, Page = 1-based PDF page, Name, Kind, SheetNumber, ViewId, Scale, Model, ModelKey, SavedVersion). "
            + "elements.parquet: one row per element (ElementKey, ElementId, UniqueId, Category, Family, Type, TypeKey, Level, Mark, "
            + "WallFunction, FireRating, Model, ModelKey). appearances.parquet: which element is drawn on which drawing (DrawingId, ElementKey). "
            + "parameters.parquet: every populated instance and type parameter (OwnerKey, Scope, Name, DisplayValue, InternalValue, UnitId, Storage)."
            + scheduleCells
            + " manifest.json: the list of these tables with row counts and SHA-256 hashes of their bytes, the model's saved version, "
            + "Revit version and export time, so a reader can check that the tables are unchanged since export.";
        yield return "Joins:appearances.DrawingId = drawings.DrawingId; appearances.ElementKey = elements.ElementKey; "
            + "parameters.OwnerKey = elements.ElementKey for instance parameters (Scope = Instance) and = elements.TypeKey for type parameters (Scope = Type).";
        yield return "Units: DisplayValue is the text Revit displays, in the project's units. InternalValue is Revit's internal value: "
            + "feet for lengths, square feet for areas, cubic feet for volumes, radians for angles. UnitId names the display unit.";
        yield return "Identifiers: ElementId is an integer that is unique only within one model file, so it can repeat across linked models. "
            + "UniqueId is stable and unique across models and is the safe key for the Revit API. ElementKey = ModelKey/link path or 'host'/UniqueId.";
    }
}
