using Autodesk.Revit.DB;
using MarkupReview.Core;

namespace EnhancedPdfs.Review;

/// <summary>Read-only view of the open host document for the review tools. Every Revit call runs on the API thread.</summary>
internal sealed class RevitModelGateway(RevitDispatcher dispatcher, Document document) : IModelGateway
{
    public Document Document { get; } = document;
    public string ModelKey { get; } = document.ProjectInformation?.UniqueId ?? "";
    public string Title { get; } = document.Title;

    public Task<ModelElement?> FindAsync(string uniqueId) => dispatcher.InvokeAsync(_ =>
    {
        var element = Document.GetElement(uniqueId);
        if (element is null || !element.IsValidObject) return null;
        var type = Document.GetElement(element.GetTypeId()) as ElementType;
        var parameters = Read(element, ParamScope.Instance).Concat(type is null ? [] : Read(type, ParamScope.Type)).ToList();
        return new ModelElement(element.UniqueId, element.VersionGuid.ToString(), element.Category?.Name ?? "",
            type?.FamilyName, type?.Name, false, parameters, type is null ? 1 : InstanceCount(element, type))
        {
            CanFlipFacing = element is FamilyInstance { CanFlipFacing: true },
            CanFlipHand = element is FamilyInstance { CanFlipHand: true },
            FacingFlipped = element is FamilyInstance { FacingFlipped: true },
            HandFlipped = element is FamilyInstance { HandFlipped: true },
        };
    });

    public Task<IReadOnlyList<ModelType>> ListTypesAsync(string uniqueId) => dispatcher.InvokeAsync<IReadOnlyList<ModelType>>(_ =>
    {
        var element = Document.GetElement(uniqueId);
        if (element is null) return [];
        return element.GetValidTypes()
            .Select(id => Document.GetElement(id) as ElementType)
            .OfType<ElementType>()
            .Select(t => new ModelType(t.FamilyName, t.Name) { Sizes = Sizes(t) })
            .OrderBy(t => t.FullName, StringComparer.OrdinalIgnoreCase)
            .ToList();
    });

    public Task<ParameterOptions> GetOptionsAsync(string uniqueId, string parameter, ParamScope scope) => dispatcher.InvokeAsync(_ =>
    {
        var p = FindParameter(Document, Document.GetElement(uniqueId), parameter, scope)
            ?? throw new InvalidOperationException($"No {scope.ToString().ToLowerInvariant()} parameter '{parameter}'.");
        var spec = p.Definition.GetDataType();
        if (spec == SpecTypeId.Boolean.YesNo) return new ParameterOptions("Integer", ["Yes", "No"], null);
        string? unit = UnitUtils.IsMeasurableSpec(spec) ? LabelUtils.GetLabelForUnit(p.GetUnitTypeId()) : null;
        return new ParameterOptions(p.StorageType.ToString(), null, unit);
    });

    public Task<ParsedValue> ParseValueAsync(string uniqueId, string parameter, ParamScope scope, string raw) => dispatcher.InvokeAsync(_ =>
    {
        var p = FindParameter(Document, Document.GetElement(uniqueId), parameter, scope);
        if (p is null) return new ParsedValue(false, null, $"No {scope.ToString().ToLowerInvariant()} parameter '{parameter}'.");
        var spec = p.Definition.GetDataType();
        if (!UnitUtils.IsMeasurableSpec(spec))
            return double.TryParse(raw.Trim(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out double plain)
                ? new ParsedValue(true, plain.ToString(System.Globalization.CultureInfo.InvariantCulture), null)
                : new ParsedValue(false, null, "expected a number");
        var units = Document.GetUnits();
        if (!UnitFormatUtils.TryParse(units, spec, raw, out double value, out string message))
            return new ParsedValue(false, null, $"Revit could not read it as {LabelUtils.GetLabelForSpec(spec).ToLowerInvariant()}{(string.IsNullOrEmpty(message) ? "" : $" ({message})")}.");
        return new ParsedValue(true, UnitFormatUtils.Format(units, spec, value, false), null);
    });

    public Task<ParsedValue> ParseLengthAsync(string raw) => dispatcher.InvokeAsync(_ =>
    {
        var units = Document.GetUnits();
        return UnitFormatUtils.TryParse(units, SpecTypeId.Length, raw, out double feet, out string message)
            ? new ParsedValue(true, UnitFormatUtils.Format(units, SpecTypeId.Length, feet, false), null)
            : new ParsedValue(false, null, $"Revit could not read it as a length{(string.IsNullOrEmpty(message) ? "" : $" ({message})")}.");
    });

    internal static Parameter? FindParameter(Document document, Element? element, string name, ParamScope scope)
    {
        if (element is null) return null;
        Element? owner = scope == ParamScope.Type ? document.GetElement(element.GetTypeId()) : element;
        return owner?.Parameters.Cast<Parameter>()
            .Where(p => string.Equals(p.Definition?.Name, name.Trim(), StringComparison.OrdinalIgnoreCase))
            .OrderBy(p => p.IsReadOnly) // prefer a writable one when names repeat
            .FirstOrDefault();
    }

    private static IEnumerable<ModelParameter> Read(Element owner, ParamScope scope) =>
        owner.Parameters.Cast<Parameter>()
            .Where(p => p.Definition is not null && p.StorageType != StorageType.None)
            .GroupBy(p => p.Definition.Name)
            .Select(g => g.OrderBy(p => p.IsReadOnly).First())
            .Select(p => new ModelParameter(p.Definition.Name, scope, Storage(p), p.AsValueString() ?? p.AsString(), p.IsReadOnly));

    // Size-defining type parameters, by built-in id so they resolve in any Revit language. First hit per label wins.
    private static readonly (string Label, BuiltInParameter Id)[] SizeParameters =
    [
        ("Width", BuiltInParameter.FAMILY_WIDTH_PARAM),
        ("Width", BuiltInParameter.WALL_ATTR_WIDTH_PARAM),
        ("Height", BuiltInParameter.FAMILY_HEIGHT_PARAM),
        ("Thickness", BuiltInParameter.FAMILY_THICKNESS_PARAM),
        ("Thickness", BuiltInParameter.FLOOR_ATTR_DEFAULT_THICKNESS_PARAM),
        ("Rough Width", BuiltInParameter.FAMILY_ROUGH_WIDTH_PARAM),
        ("Rough Height", BuiltInParameter.FAMILY_ROUGH_HEIGHT_PARAM),
    ];

    private static Dictionary<string, string> Sizes(ElementType type)
    {
        var sizes = new Dictionary<string, string>();
        foreach (var (label, id) in SizeParameters)
        {
            if (sizes.ContainsKey(label)) continue;
            if (type.get_Parameter(id)?.AsValueString() is { Length: > 0 } value) sizes[label] = value;
        }
        return sizes;
    }

    private static string Storage(Parameter p) =>
        p.Definition.GetDataType() == SpecTypeId.Boolean.YesNo ? "Integer" : p.StorageType.ToString();

    private int InstanceCount(Element element, ElementType type)
    {
        if (element.Category is null) return 1;
        return new FilteredElementCollector(Document)
            .OfCategoryId(element.Category.Id)
            .WhereElementIsNotElementType()
            .Count(e => e.GetTypeId() == type.Id);
    }
}
