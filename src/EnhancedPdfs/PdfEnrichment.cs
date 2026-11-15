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

        Attach(pdf, "drawings.parquet", data.Drawings);
        Attach(pdf, "elements.parquet", data.Elements.Values);
        Attach(pdf, "appearances.parquet", data.Appearances.OrderBy(row => row.DrawingId).ThenBy(row => row.ElementKey));
        Attach(pdf, "parameters.parquet", data.Parameters);
        if (data.ScheduleCells.Count > 0)
            Attach(pdf, "schedule-cells.parquet", data.ScheduleCells);

        pdf.Save(outputPath);
    }

    private static void Attach<T>(PdfDocument pdf, string name, IEnumerable<T> rows)
    {
        using var buffer = new MemoryStream();
        var options = new ParquetOptions { CompressionMethod = CompressionMethod.Gzip };
        ParquetSerializer.SerializeAsync(rows, buffer, options).GetAwaiter().GetResult();
        buffer.Position = 0;
        pdf.AddEmbeddedFile(name, buffer);
    }
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
            + scheduleCells;
        yield return "Joins: appearances.DrawingId = drawings.DrawingId; appearances.ElementKey = elements.ElementKey; "
            + "parameters.OwnerKey = elements.ElementKey for instance parameters (Scope = Instance) and = elements.TypeKey for type parameters (Scope = Type).";
        yield return "Units: DisplayValue is the text Revit displays, in the project's units. InternalValue is Revit's internal value: "
            + "feet for lengths, square feet for areas, cubic feet for volumes, radians for angles. UnitId names the display unit.";
        yield return "Identifiers: ElementId is an integer that is unique only within one model file, so it can repeat across linked models. "
            + "UniqueId is stable and unique across models and is the safe key for the Revit API. ElementKey = ModelKey/link path or 'host'/UniqueId.";
    }
}
