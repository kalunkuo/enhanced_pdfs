using System.Globalization;
using Autodesk.Revit.DB;
using MarkupReview.Core;

namespace EnhancedPdfs.Review;

/// <summary>Applies one approved proposal in its own named transaction. Must run on Revit's API thread.</summary>
internal static class ApplyChange
{
    /// <returns>Null on success, otherwise the reason it was not applied (the transaction is rolled back).</returns>
    public static string? Apply(Document document, ExportedElement exported, Proposal proposal, Proposal? revertOf = null)
    {
        var element = document.GetElement(exported.UniqueId);
        if (element is null) return "Element no longer in model.";

        using var transaction = new Transaction(document, revertOf is null ? TransactionName(element, proposal) : "Revert " + TransactionName(element, revertOf));
        transaction.Start();
        try
        {
            string? error = proposal.Change switch
            {
                SetParameter set => SetValue(document, element, set, proposal.NewValue ?? set.Value),
                MarkupReview.Core.ChangeType swap => Swap(document, element, proposal.NewValue ?? swap.TypeName),
                FlipInstance flip => Flip(element, flip.Side),
                NewWallType wall => NewWallTypeAtWidth(document, element, wall),
                _ => "Unsupported change.",
            };
            if (error is not null) { transaction.RollBack(); return error; }
            if (revertOf?.Change is NewWallType created) DeleteWallTypeIfUnused(document, created.TypeName);
            if (transaction.Commit() != TransactionStatus.Committed) return "Revit did not commit the change.";
            return null;
        }
        catch (Exception e)
        {
            if (transaction.HasStarted() && !transaction.HasEnded()) transaction.RollBack();
            return e.Message;
        }
    }

    /// <summary>What a change does, for transaction names and card titles.</summary>
    public static string Describe(Change change) => change switch
    {
        SetParameter s => s.Name,
        FlipInstance { Side: FlipSide.Facing } => "Flip facing",
        FlipInstance { Side: FlipSide.Hand } => "Flip hand",
        NewWallType n => $"New type \"{n.TypeName}\"",
        _ => "Type",
    };

    /// <summary>Reverting a "new wall type" leaves the duplicated type behind; remove it when no wall uses it any more.</summary>
    private static void DeleteWallTypeIfUnused(Document document, string? typeName)
    {
        var type = new FilteredElementCollector(document).OfClass(typeof(WallType)).Cast<WallType>()
            .FirstOrDefault(t => string.Equals(t.Name, typeName, StringComparison.OrdinalIgnoreCase));
        if (type is null) return;
        bool used = new FilteredElementCollector(document).OfClass(typeof(Wall)).Any(w => w.GetTypeId() == type.Id);
        if (!used) document.Delete(type.Id);
    }

    private const double MinLayerFeet = 1.0 / 256; // ~1.2 mm: anything thinner is not a real layer

    /// <summary>
    /// Duplicates the wall's (basic) type, widens or narrows its thickest core layer by the width difference, and moves
    /// the wall to the new type. Runs inside Apply's transaction, so a rollback removes the duplicate too.
    /// </summary>
    private static string? NewWallTypeAtWidth(Document document, Element element, NewWallType change)
    {
        if (element is not Wall wall || wall.WallType.Kind != WallKind.Basic) return "Only basic walls can get a new type at a different thickness.";
        if (string.IsNullOrWhiteSpace(change.TypeName)) return "The new type has no name.";
        if (!UnitFormatUtils.TryParse(document.GetUnits(), SpecTypeId.Length, change.Width, out double target))
            return $"Revit could not read '{change.Width}' as a length.";
        bool nameTaken = new FilteredElementCollector(document).OfClass(typeof(WallType)).Cast<WallType>()
            .Any(t => string.Equals(t.Name, change.TypeName, StringComparison.OrdinalIgnoreCase));
        if (nameTaken) return $"A wall type named '{change.TypeName}' already exists.";

        var newType = (WallType)wall.WallType.Duplicate(change.TypeName);
        var structure = newType.GetCompoundStructure();
        if (structure is null) return "This wall type has no layer structure to change.";
        double delta = target - newType.Width;

        // The thickest core layer absorbs the change (the structure); with no core, the thickest layer overall.
        int first = structure.GetFirstCoreLayerIndex(), last = structure.GetLastCoreLayerIndex();
        var candidates = first >= 0 && last >= first ? Enumerable.Range(first, last - first + 1) : Enumerable.Range(0, structure.LayerCount);
        int layer = candidates.OrderByDescending(structure.GetLayerWidth).First();
        double width = structure.GetLayerWidth(layer) + delta;
        if (width < MinLayerFeet) return $"Making the wall {change.Width} would leave its core layer with no thickness.";

        structure.SetLayerWidth(layer, width);
        newType.SetCompoundStructure(structure);
        wall.ChangeTypeId(newType.Id);
        return null;
    }

    private static string? Flip(Element element, FlipSide side)
    {
        if (element is not FamilyInstance instance) return "Only family instances (doors, windows…) can be flipped.";
        if (side == FlipSide.Facing)
        {
            if (!instance.CanFlipFacing) return "Revit does not allow flipping this element's facing.";
            return instance.flipFacing() ? null : "Revit did not flip the facing.";
        }
        if (!instance.CanFlipHand) return "Revit does not allow flipping this element's hand.";
        return instance.flipHand() ? null : "Revit did not flip the hand.";
    }

    public static string TransactionName(Element element, Proposal proposal)
    {
        string what = Describe(proposal.Change);
        return $"Markup: {element.Category?.Name ?? "Element"} {element.Id.Value} {what}";
    }

    private static string? SetValue(Document document, Element element, SetParameter set, string value)
    {
        var p = RevitModelGateway.FindParameter(document, element, set.Name, set.Scope);
        if (p is null) return $"Parameter '{set.Name}' not found.";
        if (p.IsReadOnly) return $"Parameter '{p.Definition.Name}' is read-only.";

        bool ok = p.StorageType switch
        {
            StorageType.String => p.Set(value),
            StorageType.Integer when p.Definition.GetDataType() == SpecTypeId.Boolean.YesNo =>
                p.Set(string.Equals(value, "Yes", StringComparison.OrdinalIgnoreCase) ? 1 : 0),
            StorageType.Integer => p.SetValueString(value) ||
                (int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out int i) && p.Set(i)),
            StorageType.Double => p.SetValueString(value),
            _ => false,
        };
        return ok ? null : $"Revit rejected '{value}' for '{p.Definition.Name}'.";
    }

    private static string? Swap(Document document, Element element, string typeName)
    {
        // typeName is the validator's family-qualified "Family: Name" — match exactly, never by bare name, so the
        // type applied is the one that was validated and shown (names repeat across families).
        var target = element.GetValidTypes()
            .Select(id => document.GetElement(id) as ElementType)
            .FirstOrDefault(t => t is not null && string.Equals($"{t.FamilyName}: {t.Name}", typeName, StringComparison.OrdinalIgnoreCase));
        if (target is null) return $"Type '{typeName}' is not available for this element.";
        element.ChangeTypeId(target.Id);
        return null;
    }
}
