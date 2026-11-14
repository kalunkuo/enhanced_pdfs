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
        if (pdf.PageCount != 1)
            throw new InvalidDataException($"Expected one page from Revit, but received {pdf.PageCount}.");

        HiddenText.Append(pdf, pdf.Pages[0], PageText.Lines(data));
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

internal static class PageText
{
    public static IEnumerable<string> Lines(DrawingData data)
    {
        var root = data.Drawings[0];
        yield return "REVIT BIM DATA";
        yield return $"Model: {root.Model} | Revit: {root.RevitVersion} | Exported UTC: {root.ExportedUtc}";
        yield return "Revit element properties as exported. Blank fire ratings are unspecified.";
        foreach (var note in data.Notes)
            yield return $"Coverage: {note}";

        var byDrawing = data.Appearances.ToLookup(row => row.DrawingId);
        var scheduleCells = data.ScheduleCells.ToLookup(row => row.DrawingId);
        foreach (var drawing in data.Drawings)
        {
            var members = byDrawing[drawing.DrawingId].Select(row => data.Elements[row.ElementKey])
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
                var fields = new List<string> { $"Element ID: {element.ElementId}", element.Category, element.Name };
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

            foreach (var row in scheduleCells[drawing.DrawingId].GroupBy(cell => (cell.Section, cell.Row)))
            {
                yield return $"Schedule {row.Key.Section} {row.Key.Row}: " +
                    string.Join(" | ", row.OrderBy(cell => cell.Column).Select(cell => cell.Value));
            }
        }
        yield return "Complete instance and type parameter tables are embedded as Parquet attachments.";
    }
}
