namespace EnhancedPdfs;

internal sealed class DrawingData
{
    public const int SchemaVersion = 1;
    public List<DrawingRow> Drawings { get; } = [];
    public Dictionary<string, ElementRow> Elements { get; } = [];
    public HashSet<AppearanceRow> Appearances { get; } = [];
    public List<ParameterRow> Parameters { get; } = [];
    public List<ScheduleCellRow> ScheduleCells { get; } = [];
    public List<DrawingNote> Notes { get; } = [];
}

internal sealed record DrawingNote(int Page, string Text);

internal sealed record DrawingRow(
    string DrawingId, string? ParentDrawingId, string ViewUniqueId, long ViewId, int Page,
    string Name, string Kind, int? Scale, string? SheetNumber, string? DetailNumber,
    string? Revision, string Model, string ModelKey, string RevitVersion, string ExportedUtc,
    string? SavedVersion, bool HasUnsavedChanges, string CollectionMethod, int SchemaVersion);

internal sealed record ElementRow(
    string ElementKey, string ModelKey, string Model, long? LinkInstanceId, string UniqueId,
    long ElementId, string Category, long? CategoryId, string Name, string? Family, string? Type,
    string? TypeKey, long? TypeId, string? Level, string? Mark, string? WallFunction,
    string? FireRating, string? FireRatingSource, string VersionGuid);

internal sealed record AppearanceRow(string DrawingId, string ElementKey, string Source);

internal sealed record ParameterRow(
    string OwnerKey, string Scope, long ParameterId, string? SharedGuid,
    string Name, string Storage, string? SpecId, string? UnitId, string? DisplayValue,
    string? TextValue, long? IntegerValue, double? InternalValue, long? ReferenceId);

internal sealed record ScheduleCellRow(
    string DrawingId, string Section, int Row, int Column, string Value);
