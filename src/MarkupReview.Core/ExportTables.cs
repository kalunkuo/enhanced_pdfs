using Parquet.Serialization;

namespace MarkupReview.Core;

// Read-side rows; column names follow src/EnhancedPdfs/DrawingData.cs. Only the columns review needs.
public sealed class ExportedDrawing
{
    public string DrawingId { get; set; } = "";
    public string? ParentDrawingId { get; set; }
    public string ViewUniqueId { get; set; } = "";
    public int Page { get; set; }
    public string Name { get; set; } = "";
    public string Model { get; set; } = "";
    public string ModelKey { get; set; } = "";
    public string ExportedUtc { get; set; } = "";
}

public sealed class ExportedElement
{
    public string ElementKey { get; set; } = "";
    public string ModelKey { get; set; } = "";
    public long? LinkInstanceId { get; set; }
    public string UniqueId { get; set; } = "";
    public long ElementId { get; set; }
    public string Category { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Family { get; set; }
    public string? Type { get; set; }
    public string? TypeKey { get; set; }
    public string VersionGuid { get; set; } = "";
}

public sealed class ExportedParameter
{
    public string OwnerKey { get; set; } = "";
    public string Scope { get; set; } = "";
    public string Name { get; set; } = "";
    public string Storage { get; set; } = "";
    public string? DisplayValue { get; set; }
}

/// <summary>The exporter's attachments, as data the review can join on.</summary>
public sealed class ExportTables
{
    public required IReadOnlyList<ExportedDrawing> Drawings { get; init; }
    public required IReadOnlyDictionary<string, ExportedElement> ElementsByKey { get; init; }
    public required ILookup<long, ExportedElement> ElementsById { get; init; }
    public required ILookup<string, ExportedParameter> ParametersByOwner { get; init; }

    /// <summary>The model the PDF was exported from (root drawing).</summary>
    public string ModelKey => RootDrawing?.ModelKey ?? "";
    public string ModelName => RootDrawing?.Model ?? "";
    private ExportedDrawing? RootDrawing => Drawings.FirstOrDefault(d => d.ParentDrawingId is null) ?? Drawings.FirstOrDefault();

    public static ExportTables Load(ReturnedPdf pdf)
    {
        if (!pdf.Attachments.ContainsKey("elements.parquet"))
            throw new InvalidDataException("This PDF has no Enhanced PDF data (elements.parquet is missing). Export it from Revit with Enhanced PDFs first.");

        var drawings = Rows<ExportedDrawing>(pdf, "drawings.parquet");
        var elements = Rows<ExportedElement>(pdf, "elements.parquet");
        var parameters = Rows<ExportedParameter>(pdf, "parameters.parquet");
        return new ExportTables
        {
            Drawings = [.. drawings],
            ElementsByKey = elements.ToDictionary(e => e.ElementKey, StringComparer.Ordinal),
            ElementsById = elements.ToLookup(e => e.ElementId),
            ParametersByOwner = parameters.ToLookup(p => p.OwnerKey, StringComparer.Ordinal),
        };
    }

    internal static IList<T> Rows<T>(ReturnedPdf pdf, string name) where T : class, new()
    {
        if (!pdf.Attachments.TryGetValue(name, out var bytes)) return [];
        // Off the caller's SynchronizationContext: Revit calls this on its UI thread, where blocking on
        // Parquet.Net's awaits would deadlock.
        var rows = Task.Run(async () =>
        {
            using var stream = new MemoryStream(bytes);
            return (await ParquetSerializer.DeserializeUntypedAsync(stream)).Data;
        }).GetAwaiter().GetResult();
        // Untyped + our own mapping: the exporter writes required columns, other tools (DuckDB) write every column
        // optional, and the typed serializer rejects any nullability mismatch. Missing or null values become defaults.
        var properties = typeof(T).GetProperties().Where(p => p.CanWrite).ToArray();
        var list = new List<T>(rows.Count);
        foreach (var row in rows)
        {
            var item = new T();
            foreach (var p in properties)
                if (row.TryGetValue(p.Name, out var value) && value is not null)
                    p.SetValue(item, ConvertTo(value, p.PropertyType));
            list.Add(item);
        }
        return list;
    }

    private static object? ConvertTo(object value, Type target)
    {
        var type = Nullable.GetUnderlyingType(target) ?? target;
        if (type.IsInstanceOfType(value)) return value;
        if (type == typeof(List<double>) && value is System.Collections.IEnumerable items)
            return items.Cast<object?>().Where(v => v is not null).Select(v => Convert.ToDouble(v, System.Globalization.CultureInfo.InvariantCulture)).ToList();
        return Convert.ChangeType(value, type, System.Globalization.CultureInfo.InvariantCulture);
    }
}
