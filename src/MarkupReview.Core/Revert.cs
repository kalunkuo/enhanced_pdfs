namespace MarkupReview.Core;

/// <summary>
/// Undo for an approved proposal. Revit's API has no "undo this step", so the reviewer's change of mind is applied as
/// the inverse change in its own transaction, after checking the element still holds the approved value.
/// </summary>
public static class Revert
{
    /// <returns>A proposal describing the inverse change (Old/New swapped), or null when there is nothing to revert.</returns>
    public static Proposal? Inverse(Proposal approved)
    {
        if (approved.Status != ProposalStatus.Approved) return null;
        Change? inverse = approved.Change switch
        {
            SetParameter s => s with { Value = approved.OldValue ?? "" },
            ChangeType when approved.OldValue is { Length: > 0 } previous => new ChangeType(previous),
            FlipInstance f => f, // flipping the same side again restores it
            NewWallType { FromType: { Length: > 0 } from } => new ChangeType(from),
            _ => null,
        };
        if (inverse is null) return null;
        return new Proposal
        {
            Id = approved.Id + "-revert", MarkupId = approved.MarkupId, ElementKey = approved.ElementKey,
            Change = inverse, Reason = $"Revert {approved.Id}", OldValue = approved.NewValue,
            // Apply resolves a type swap by NewValue: for a new wall type that is the type it came from, not a width.
            NewValue = inverse is ChangeType back ? back.TypeName : approved.OldValue,
        };
    }

    /// <returns>Null when the element still holds what was approved; otherwise what it holds now (so nothing is overwritten).</returns>
    public static string? ChangedSinceApproval(Proposal approved, ModelElement current)
    {
        string? now = approved.Change switch
        {
            SetParameter s => current.Parameters.FirstOrDefault(p => p.Scope == s.Scope && Same(p.Name, s.Name))?.DisplayValue,
            ChangeType => $"{current.Family}: {current.Type}",
            FlipInstance { Side: FlipSide.Facing } => current.FacingFlipped ? "flipped" : "not flipped",
            FlipInstance { Side: FlipSide.Hand } => current.HandFlipped ? "flipped" : "not flipped",
            NewWallType => current.Type,
            _ => null,
        };
        string? expected = approved.Change is NewWallType n ? n.TypeName : approved.NewValue;
        return Same(now, expected) ? null : $"It changed since you approved it (now '{now}'). Undo with Ctrl+Z or change it by hand.";
    }

    private static bool Same(string? a, string? b) =>
        string.Equals(Squash(a), Squash(b), StringComparison.OrdinalIgnoreCase);

    private static string Squash(string? s) => s is null ? "" : string.Concat(s.Where(c => !char.IsWhiteSpace(c)));
}
