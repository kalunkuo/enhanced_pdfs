namespace MarkupReview.Core;

public sealed record ModelParameter(string Name, ParamScope Scope, string Storage, string? DisplayValue, bool ReadOnly);

public sealed record ModelElement(
    string UniqueId, string VersionGuid, string Category, string? Family, string? Type, bool IsLinked,
    IReadOnlyList<ModelParameter> Parameters, int TypeInstanceCount);

public sealed record ModelType(string? Family, string Name)
{
    public string FullName => Family is null ? Name : $"{Family}: {Name}";
    /// <summary>Size-defining type parameters as Revit displays them (Width, Height, Thickness…); empty when none apply.</summary>
    public IReadOnlyDictionary<string, string> Sizes { get; init; } = new Dictionary<string, string>();
}

/// <summary>One dimension that differs between an element's current type and the proposed type.</summary>
public sealed record SizeChange(string Name, string? OldValue, string? NewValue);

/// <param name="Storage">Revit storage type: String, Integer, Double, ElementId.</param>
/// <param name="Allowed">Display values Revit can enumerate (yes/no, enums, element references); null when free-form.</param>
public sealed record ParameterOptions(string Storage, IReadOnlyList<string>? Allowed, string? Unit);

/// <summary>Read-only view of the open model. Implementations marshal to Revit's thread; callers may be on any thread.</summary>
public interface IModelGateway
{
    string ModelKey { get; }
    string Title { get; }
    Task<ModelElement?> FindAsync(string uniqueId);
    Task<IReadOnlyList<ModelType>> ListTypesAsync(string uniqueId);
    Task<ParameterOptions> GetOptionsAsync(string uniqueId, string parameter, ParamScope scope);
}

public enum MatchStatus { Matched, ChangedSinceExport, Missing, LinkedModel }

public static class ElementMatcher
{
    public static MatchStatus Match(ExportedElement exported, ModelElement? current)
    {
        if (exported.LinkInstanceId is not null || current?.IsLinked == true) return MatchStatus.LinkedModel;
        if (current is null) return MatchStatus.Missing;
        return current.VersionGuid == exported.VersionGuid ? MatchStatus.Matched : MatchStatus.ChangedSinceExport;
    }
}
