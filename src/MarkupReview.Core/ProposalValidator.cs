using System.Globalization;

namespace MarkupReview.Core;

/// <param name="Ok">False: reject back to Claude with <see cref="Error"/>; nothing is staged.</param>
/// <param name="BlockReason">Set when Ok: stage the proposal, but it cannot be approved.</param>
public sealed record ValidationResult(bool Ok, string? Error, string? OldValue, string? NormalisedValue, int AffectsCount, string? BlockReason = null)
{
    public static ValidationResult Reject(string error) => new(false, error, null, null, 0);

    /// <summary>For a type swap: the dimensions that differ between the current and the proposed type.</summary>
    public IReadOnlyList<SizeChange> SizeChanges { get; init; } = [];
}

/// <summary>Checks a proposed change against the open model. Used when Claude proposes and again at Approve.</summary>
public static class ProposalValidator
{
    private const int MaxListed = 20;

    public static async Task<ValidationResult> ValidateAsync(Proposal proposal, IModelGateway model, ExportTables tables)
    {
        if (!tables.ElementsByKey.TryGetValue(proposal.ElementKey, out var exported))
            return ValidationResult.Reject($"Element handle '{proposal.ElementKey}' is not in this PDF. Use a handle from list_markups.");

        var current = exported.LinkInstanceId is null ? await model.FindAsync(exported.UniqueId) : null;
        switch (ElementMatcher.Match(exported, current))
        {
            case MatchStatus.LinkedModel:
                return new(true, null, null, null, 0, "Element is in a linked model; change it in that model");
            case MatchStatus.Missing:
                return new(true, null, null, null, 0, "Element no longer in model");
        }

        bool changedSinceExport = current!.VersionGuid != exported.VersionGuid;
        return proposal.Change switch
        {
            SetParameter set => await ValidateParameter(set, exported, current, model, tables, changedSinceExport),
            ChangeType swap => await ValidateType(swap, exported, current, model, changedSinceExport),
            FlipInstance flip => ValidateFlip(flip, current),
            _ => ValidationResult.Reject("Unsupported change kind."),
        };
    }

    private static async Task<ValidationResult> ValidateParameter(SetParameter set, ExportedElement exported, ModelElement current,
        IModelGateway model, ExportTables tables, bool changedSinceExport)
    {
        var candidates = current.Parameters.Where(p => p.Scope == set.Scope).ToList();
        var parameter = candidates.FirstOrDefault(p => string.Equals(p.Name, set.Name.Trim(), StringComparison.OrdinalIgnoreCase));
        if (parameter is null)
            return ValidationResult.Reject($"No {Scope(set.Scope)} parameter '{set.Name}'. {Scope(set.Scope)} parameters: {List(candidates.Select(p => p.Name))}.");
        if (parameter.ReadOnly)
            return ValidationResult.Reject($"Parameter '{parameter.Name}' is read-only.");

        var options = await model.GetOptionsAsync(current.UniqueId, parameter.Name, set.Scope);
        string? value;
        if (options.Storage == "Double" && options.Allowed is not { Count: > 0 })
        {
            // Numbers with units are parsed by the model itself, so "3.5 ft" is stored and shown as Revit formats it.
            var parsed = await model.ParseValueAsync(current.UniqueId, parameter.Name, set.Scope, set.Value);
            if (!parsed.Ok) return ValidationResult.Reject($"'{set.Value}' is not valid for '{parameter.Name}': {parsed.Error}");
            value = parsed.Display;
        }
        else
        {
            value = Normalise(set.Value, options, out string? error);
            if (value is null) return ValidationResult.Reject($"'{set.Value}' is not valid for '{parameter.Name}': {error}");
        }
        if (Same(value, parameter.DisplayValue))
            return ValidationResult.Reject($"'{parameter.Name}' already is '{parameter.DisplayValue}'; no change needed.");

        int affects = set.Scope == ParamScope.Type ? current.TypeInstanceCount : 1;
        string? block = null;
        if (changedSinceExport)
        {
            string owner = set.Scope == ParamScope.Type ? exported.TypeKey ?? "" : exported.ElementKey;
            // The exporter writes populated parameters only: no row means the value was empty at export.
            string exportedValue = tables.ParametersByOwner[owner].FirstOrDefault(p => Same(p.Name, parameter.Name))?.DisplayValue ?? "";
            if (!Same(exportedValue, parameter.DisplayValue))
                block = $"'{parameter.Name}' changed since export (was '{exportedValue}', now '{parameter.DisplayValue}')";
        }
        return new(true, null, parameter.DisplayValue, value, affects, block);
    }

    private static async Task<ValidationResult> ValidateType(ChangeType swap, ExportedElement exported, ModelElement current,
        IModelGateway model, bool changedSinceExport)
    {
        var types = await model.ListTypesAsync(current.UniqueId);
        // Type names repeat across families (36" x 84" in several door families): identity is "Family: Name".
        var target = types.FirstOrDefault(t => Same(t.FullName, swap.TypeName));
        if (target is null)
        {
            var byName = types.Where(t => Same(t.Name, swap.TypeName)).ToList();
            target = byName.FirstOrDefault(t => Same(t.Family, current.Family)) ?? (byName.Count == 1 ? byName[0] : null);
            if (target is null && byName.Count > 1)
                return ValidationResult.Reject($"'{swap.TypeName}' exists in several families: {List(byName.Select(t => t.FullName))}. Pass the family-qualified name.");
        }
        if (target is null)
            return ValidationResult.Reject($"No type '{swap.TypeName}' is available for this element. Available: {List(types.Select(t => t.FullName))}.");

        string currentName = current.Family is null ? current.Type ?? "" : $"{current.Family}: {current.Type}";
        if (Same(target.FullName, currentName))
            return ValidationResult.Reject($"The element already is type '{currentName}'; no change needed.");
        string? block = changedSinceExport && !Same(exported.Type, current.Type)
            ? $"Type changed since export (was '{exported.Type}', now '{current.Type}')"
            : null;
        var from = types.FirstOrDefault(t => Same(t.FullName, currentName)) ?? types.FirstOrDefault(t => Same(t.Name, current.Type));
        return new(true, null, currentName, target.FullName, 1, block) { SizeChanges = SizeDiff(from, target) };
    }

    private static ValidationResult ValidateFlip(FlipInstance flip, ModelElement current)
    {
        bool can = flip.Side == FlipSide.Facing ? current.CanFlipFacing : current.CanFlipHand;
        if (!can)
            return ValidationResult.Reject($"This {current.Category.ToLowerInvariant()} cannot be flipped ({flip.Side.ToString().ToLowerInvariant()}) in Revit. Use add_review_note.");
        bool flipped = flip.Side == FlipSide.Facing ? current.FacingFlipped : current.HandFlipped;
        // Revit knows "flipped or not", not "inside/outside": the card says what changes, the reviewer judges the direction.
        return new(true, null, flipped ? "flipped" : "not flipped", flipped ? "not flipped" : "flipped", 1);
    }

    private static List<SizeChange> SizeDiff(ModelType? from, ModelType to)
    {
        var names = to.Sizes.Keys.Concat(from?.Sizes.Keys ?? []).Distinct(StringComparer.OrdinalIgnoreCase);
        var changes = new List<SizeChange>();
        foreach (var name in names)
        {
            string? before = from?.Sizes.GetValueOrDefault(name), after = to.Sizes.GetValueOrDefault(name);
            if (!Same(before, after)) changes.Add(new SizeChange(name, before, after));
        }
        return changes;
    }

    /// <summary>Returns the value to apply, or null with an error. Never passes a non-numeric string to a numeric parameter.</summary>
    private static string? Normalise(string raw, ParameterOptions options, out string? error)
    {
        error = null;
        string value = raw.Trim();
        if (options.Allowed is { Count: > 0 } allowed)
        {
            var match = allowed.FirstOrDefault(a => Same(a, value));
            if (match is null) error = $"allowed values are {List(allowed)}";
            return match;
        }
        switch (options.Storage)
        {
            case "Integer":
                if (long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out _)) return value;
                error = "expected a whole number";
                return null;
            case "Double":
                // Revit parses display strings with units (e.g. 3' 6"); require at least one ASCII digit.
                if (value.Any(c => c is >= '0' and <= '9')) return value;
                error = options.Unit is null ? "expected a number" : $"expected a number in {options.Unit}";
                return null;
            case "ElementId":
                error = "this parameter references another element and has no listed values";
                return null;
            default:
                return value;
        }
    }

    private static bool Same(string? a, string? b) =>
        string.Equals(Squash(a), Squash(b), StringComparison.OrdinalIgnoreCase);

    private static string Squash(string? s) => s is null ? "" : string.Concat(s.Where(c => !char.IsWhiteSpace(c)));
    private static string Scope(ParamScope scope) => scope == ParamScope.Type ? "type" : "instance";

    private static string List(IEnumerable<string> names)
    {
        var all = names.ToList();
        var shown = string.Join(", ", all.Take(MaxListed).Select(n => $"'{n}'"));
        return all.Count > MaxListed ? $"{shown} (and {all.Count - MaxListed} more)" : shown.Length == 0 ? "none" : shown;
    }
}
